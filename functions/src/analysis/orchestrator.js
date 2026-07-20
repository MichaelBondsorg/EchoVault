/**
 * Server-owned single-pass post-save analysis orchestrator (plan task C3).
 *
 * Replaces the fragile CLIENT-owned promise chain (App.jsx post-save IIFE) that
 * dies on app suspension and classifies twice. This runs ONCE, server-side,
 * behind the `serverAnalysisOrchestrator` flag:
 *
 *   1. classify ONCE (reusing the exact classifyEntry helper/prompt)
 *   2. in parallel (Promise.allSettled): therapeutic analysis, contextual
 *      insight, enhanced-context extraction (the same helpers the callable uses)
 *   3. a single final publish (transactional) mirroring the field names the
 *      client chain writes today, PLUS analysisMeta provenance.
 *
 * Guarantees layered on top of the client chain:
 *   - consent (isAiAllowed) re-checked before EACH provider stage; revoked
 *     mid-flight aborts before the next provider call (entry left 'disabled').
 *   - stale-version guard: if the entry's entryInputVersion changed while we
 *     were analysing, the result is DISCARDED (no write) and re-enqueued exactly
 *     once (analysisStatus -> 'pending') for the watchdog to pick up.
 *   - failure is honest: analysisStatus 'failed', NO fabricated mood_score.
 *
 * Never logs journal text — only ids and structured status.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getModel } from '../models/registry.js';
import { isAiAllowed } from '../consent/consentGate.js';
import {
  classifyEntry,
  analyzeEntry,
  extractEnhancedContext,
  generateInsight,
} from './analysisHelpers.js';

const ORCHESTRATOR_VERSION = 1;
const PROMPT_VERSION = 1;
const CONTEXT_VERSION = 1; // mirrors src/config/constants.js CURRENT_CONTEXT_VERSION
const RECENT_CONTEXT_LIMIT = 15;

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Best-effort recent-entries context string for the insight/context stages.
 * The client passes rich, pre-computed context; server-side we assemble a
 * lightweight recent-text window. Any read failure degrades to '' (no throw).
 */
async function buildRecentContext(entryRef, currentId) {
  try {
    const col = entryRef.parent;
    if (!col || typeof col.orderBy !== 'function') return '';
    const snap = await col
      .orderBy('createdAt', 'desc')
      .limit(RECENT_CONTEXT_LIMIT)
      .get();
    const parts = [];
    snap.forEach((doc) => {
      if (doc.id === currentId) return;
      const d = doc.data() || {};
      if (typeof d.text === 'string' && d.text.trim()) {
        const when = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString() : 'recent';
        parts.push(`[${when}] ${d.text}`);
      }
    });
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

function truncateTitle(text) {
  const t = String(text || '');
  return t.substring(0, 50) + (t.length > 50 ? '...' : '');
}

/**
 * Final publish, stale-version-guarded. Runs in a transaction that re-reads the
 * entry: if entryInputVersion drifted from `inputVersion` the write is DISCARDED
 * and the entry re-enqueued exactly once (only if not already 'pending').
 */
async function publishFinal(db, entryRef, inputVersion, payload) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(entryRef);
    if (!snap.exists) return { outcome: 'discarded', reason: 'deleted', reEnqueued: false };

    const cur = snap.data() || {};
    const curVersion = cur.entryInputVersion ?? 0;

    if (curVersion !== inputVersion) {
      // The entry was edited while we analysed stale text — never publish it.
      if (cur.analysisStatus !== 'pending') {
        tx.update(entryRef, { analysisStatus: 'pending' }); // preserves analysisRetryCount
        return { outcome: 'discarded', reason: 'stale', reEnqueued: true };
      }
      return { outcome: 'discarded', reason: 'stale', reEnqueued: false };
    }

    tx.update(entryRef, payload);
    return { outcome: 'published', reEnqueued: false };
  });
}

/**
 * Run the full single-pass analysis for one entry.
 *
 * @param {object}   args
 * @param {object}   args.db        Firestore instance (admin SDK).
 * @param {object}   args.entryRef  DocumentReference for the entry.
 * @param {object}   args.entry     Entry snapshot at trigger/claim time (incl. id, text, entryInputVersion).
 * @param {object}   args.apiKeys   { gemini, openai } — resolved secret values.
 * @param {Function} args.logStage  Stage telemetry logger (operationId, stage, meta).
 * @returns {Promise<{outcome:'published'|'failed'|'disabled'|'discarded', reEnqueued?:boolean, reason?:string}>}
 */
export async function runEntryAnalysis({ db, entryRef, entry, apiKeys, logStage }) {
  const startedAt = Date.now();
  const opId = entry?.id || entryRef?.id || null;
  const inputVersion = entry?.entryInputVersion ?? 0;
  const uid = entryRef?.parent?.parent?.id ?? null;
  const gemini = apiKeys?.gemini;
  const text = entry?.text;

  // Resolve every workload's model ONCE per run (flag-aware; getServerFlag's
  // 60s cache means these share a single Firestore read). The models are
  // threaded into the actual provider calls below, and the analyze model is the
  // one stamped into provenance/telemetry — so analysisMeta.modelId always
  // matches the model the analyze call really used.
  const [classifyModel, analyzeModel, insightModel] = await Promise.all([
    getModel(db, 'classify'),
    getModel(db, 'analyze'),
    getModel(db, 'insight'),
  ]);
  const modelId = analyzeModel;

  const end = (retryCount, extra) => {
    logStage(opId, 'analysis_end', {
      durationMs: Date.now() - startedAt,
      modelId,
      retryCount,
      ...extra,
    });
  };

  logStage(opId, 'analysis_start', { modelId });

  // Consent gate before ANY provider work (fail closed).
  if (!(await isAiAllowed(db, uid, { entrySnapshot: entry }))) {
    await entryRef.update({ analysisStatus: 'disabled' });
    end(0, { errorCode: 'ai-consent-revoked' });
    return { outcome: 'disabled', reason: 'ai-consent-revoked' };
  }

  if (!text || typeof text !== 'string') {
    await publishFinal(db, entryRef, inputVersion, buildFailedPayload('', inputVersion, 'missing text', modelId));
    end(0, { errorCode: 'missing-text' });
    return { outcome: 'failed', reason: 'missing-text' };
  }

  // Stage 1: classify ONCE.
  let classification;
  try {
    classification = await classifyEntry(gemini, text, { modelId: classifyModel });
  } catch (e) {
    await publishFinal(db, entryRef, inputVersion, buildFailedPayload(text, inputVersion, e?.message || 'classify-failed', modelId));
    end(1, { errorCode: 'classify-failed' });
    return { outcome: 'failed', reason: 'classify-failed' };
  }
  const entryType = classification?.entry_type || 'reflection';

  // Consent re-check before the next provider stage (revoked mid-flight aborts).
  if (!(await isAiAllowed(db, uid, { entrySnapshot: entry }))) {
    await entryRef.update({ analysisStatus: 'disabled' });
    end(0, { errorCode: 'ai-consent-revoked' });
    return { outcome: 'disabled', reason: 'ai-consent-revoked' };
  }

  // Stage 2: analyze + (non-task) insight + enhanced context, in parallel.
  // The client skips insight/context for pure 'task' entries — mirror that.
  const recentContext = entryType === 'task' ? '' : await buildRecentContext(entryRef, opId);
  const stageTasks = [analyzeEntry(gemini, text, entryType, entry?.userLocalHour ?? null, { modelId: analyzeModel })];
  if (entryType !== 'task') {
    stageTasks.push(generateInsight(gemini, text, recentContext, null, null, [], { modelId: insightModel }));
    stageTasks.push(extractEnhancedContext(gemini, text, recentContext, { modelId: classifyModel }));
  }
  const settled = await Promise.allSettled(stageTasks);
  const retryCount = settled.filter((s) => s.status === 'rejected').length;

  const analyzeSettled = settled[0];
  const insight = entryType !== 'task' && settled[1]?.status === 'fulfilled' ? settled[1].value : null;
  const enhancedContext = entryType !== 'task' && settled[2]?.status === 'fulfilled' ? settled[2].value : null;

  // Failure semantics mirror the client: a thrown analyze OR an analysis that
  // couldn't produce a result (analysisStatus:'failed') is an honest failure —
  // never fabricate a mood.
  const analysisFailed =
    analyzeSettled.status === 'rejected' ||
    !analyzeSettled.value ||
    analyzeSettled.value.analysisStatus === 'failed';

  if (analysisFailed) {
    const reason =
      analyzeSettled.status === 'rejected'
        ? analyzeSettled.reason?.message || String(analyzeSettled.reason)
        : analyzeSettled.value?.analysisError || 'analysis-failed';
    const result = await publishFinal(db, entryRef, inputVersion, buildFailedPayload(text, inputVersion, reason, modelId));
    end(retryCount, { errorCode: 'analysis-failed' });
    if (result.outcome !== 'published') return result;
    return { outcome: 'failed', reason };
  }

  const analysis = analyzeSettled.value;
  const payload = buildSuccessPayload({ text, entryType, classification, analysis, insight, enhancedContext, inputVersion, modelId });
  const result = await publishFinal(db, entryRef, inputVersion, payload);
  end(retryCount);
  if (result.outcome !== 'published') return result;
  return { outcome: 'published' };
}

function analysisMeta(inputVersion, modelId) {
  return {
    modelId,
    promptVersion: PROMPT_VERSION,
    orchestratorVersion: ORCHESTRATOR_VERSION,
    inputVersion,
    completedAt: new Date().toISOString(),
  };
}

function buildFailedPayload(text, inputVersion, errorMessage, modelId) {
  return {
    title: truncateTitle(text),
    tags: [],
    analysisStatus: 'failed',
    analysisError: String(errorMessage || 'analysis-failed').slice(0, 200),
    entry_type: 'reflection',
    analysisLease: FieldValue.delete(),
    analysisMeta: analysisMeta(inputVersion, modelId),
  };
}

function buildSuccessPayload({ text, entryType, classification, analysis, insight, enhancedContext, inputVersion, modelId }) {
  const topicTags = analysis?.tags || [];
  const structuredTags = enhancedContext?.structured_tags || [];
  const contextTopicTags = enhancedContext?.topic_tags || [];
  const allTags = [...new Set([...topicTags, ...structuredTags, ...contextTopicTags])];

  const analysisField = pruneUndefined({
    mood_score: analysis?.mood_score,
    framework: analysis?.framework || 'general',
  });
  if (analysis?.cbt_breakdown && Object.keys(analysis.cbt_breakdown).length > 0) {
    analysisField.cbt_breakdown = analysis.cbt_breakdown;
  }
  if (analysis?.act_analysis && Object.keys(analysis.act_analysis).length > 0) {
    analysisField.act_analysis = analysis.act_analysis;
  }
  if (analysis?.vent_support) analysisField.vent_support = analysis.vent_support;
  if (analysis?.celebration && typeof analysis.celebration === 'object') {
    analysisField.celebration = analysis.celebration;
  }
  if (analysis?.task_acknowledgment) analysisField.task_acknowledgment = analysis.task_acknowledgment;

  const payload = pruneUndefined({
    title: analysis?.title || 'New Memory',
    tags: allTags,
    analysisStatus: 'complete',
    entry_type: entryType,
    classification_confidence: classification?.confidence,
    context_version: CONTEXT_VERSION,
    analysis: analysisField,
    analysisLease: FieldValue.delete(),
    analysisMeta: analysisMeta(inputVersion, modelId),
  });

  if (enhancedContext?.continues_situation) payload.continues_situation = enhancedContext.continues_situation;
  // Derived-data stamp (plan task C4): records which entryInputVersion this
  // goal_update was computed from, so a later downstream consumer can tell a
  // stale goal_update (computed pre-correction) apart from a fresh one.
  if (enhancedContext?.goal_update?.tag) {
    payload.goal_update = { ...enhancedContext.goal_update, derivedFromInputVersion: inputVersion };
  }

  const tasks = classification?.extracted_tasks;
  if (Array.isArray(tasks) && tasks.length > 0) {
    payload.extracted_tasks = tasks.map((t) => ({
      text: typeof t === 'string' ? t : t.text || t,
      completed: t.completed ?? false,
    }));
  }

  if (insight?.found) payload.contextualInsight = insight;

  return payload;
}

export default { runEntryAnalysis };
