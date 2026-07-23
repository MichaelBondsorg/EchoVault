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
import { getServerFlag } from '../shared/flags.js';
import { isAiAllowed } from '../consent/consentGate.js';
import { runIntentExtraction } from '../intents/extractIntents.js';
import {
  classifyEntry,
  analyzeEntry,
  extractEnhancedContext,
  generateInsight,
} from './analysisHelpers.js';
import { generateEmbeddingV2, cosineSimilarity, EMBEDDING_V2_QUERY_TASK_TYPE } from '../ai/embeddingV2.js';

const ORCHESTRATOR_VERSION = 1;
const PROMPT_VERSION = 1;
const CONTEXT_VERSION = 1; // mirrors src/config/constants.js CURRENT_CONTEXT_VERSION
const RECENT_CONTEXT_LIMIT = 15;

// R4 Phase 2 Task 7: multi-channel contextual retrieval. The raw Firestore
// fetch is widened beyond RECENT_CONTEXT_LIMIT (same query SHAPE/index as
// before — where(spaceId)?.orderBy(createdAt desc), just a bigger `.limit`)
// so the entity/tag/semantic channels below have candidates to search beyond
// the most-recent RECENT_CONTEXT_LIMIT window. The FINAL assembled context
// still caps at RECENT_CONTEXT_LIMIT entries — "capped at the existing
// context size" per the plan task.
const CANDIDATE_POOL_LIMIT = 40;
const SEMANTIC_CHANNEL_SIMILARITY_THRESHOLD = 0.3; // mirrors src/services/analysis/index.js's client-side threshold
const ENTITY_TAG_PREFIXES = ['@person:', '@place:'];

function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** True for entries that must never appear in an assembled AI context. */
function isSensitiveEntry(d) {
  return d?.safety_flagged === true || d?.has_warning_indicators === true;
}

/** A candidate is usable in ANY channel iff it has text and isn't sensitive. */
function isUsableCandidate(d) {
  return typeof d?.text === 'string' && d.text.trim().length > 0 && !isSensitiveEntry(d);
}

/** @person:/@place: tags are "resolved entities"; everything else (@goal:, @situation:, plain topic tags) is a weaker topical tag. */
function splitEntityAndTopicTags(tags) {
  const entity = [];
  const topic = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    if (typeof t !== 'string') continue;
    if (ENTITY_TAG_PREFIXES.some((p) => t.startsWith(p))) entity.push(t);
    else topic.push(t);
  }
  return { entity, topic };
}

function formatContextLine(d) {
  const when = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString() : 'recent';
  return `[${when}] ${d.text}`;
}

/**
 * Best-effort recent-entries context string for the insight/context stages.
 * The client passes rich, pre-computed context; server-side we assemble a
 * lightweight recent-text window. Any read failure degrades to '' (no throw).
 *
 * Context Spaces (R1 plan task 10): when the `contextSpaces` server flag is
 * on AND the entry being analyzed has a `spaceId`, the candidate query is
 * scoped to that space (`where('spaceId','==',entry.spaceId)`) so a
 * Work-space entry's insight/context stages never see Personal-space text.
 * Otherwise (flag off, or the entry is unscoped) the legacy all-entries
 * query runs unchanged. This scoping is applied at the QUERY itself, i.e.
 * FIRST — before any of the multi-channel selection below ever sees a
 * candidate.
 *
 * R4 Phase 2 Task 7 (multi-channel contextual retrieval): four channels,
 * merged and deduped by entry id, capped at RECENT_CONTEXT_LIMIT:
 *   1. recent window   — the original behavior: the most-recent
 *      RECENT_CONTEXT_LIMIT candidates from the (scoped) query. Also the
 *      FALLBACK — when the other three channels find nothing, the merged
 *      result is exactly this channel, in the same order, so a corpus with
 *      no entity/tag/semantic signal degrades to byte-for-byte legacy
 *      behavior (modulo the sensitive-entry exclusion below, which is new).
 *   2. entity-overlap  — candidates sharing an @person:/@place: tag with the
 *      new entry. The new entry's own tags are whatever's been computed on
 *      it so far (often none yet, pre-analysis — the channel is then simply
 *      empty, not an error).
 *   3. tag-overlap     — candidates sharing any OTHER tag (@goal:,
 *      @situation:, plain topic tags) with the new entry.
 *   4. semantic        — cosine similarity over stored `embeddingV2`
 *      vectors. Skipped silently (never throws) when the new entry has no
 *      text to embed, no apiKey is available, the embedding call fails, or
 *      no candidate in the pool has a stored vector.
 * `safety_flagged`/`has_warning_indicators` candidates are excluded from
 * EVERY channel before ranking — they must never reach the assembled
 * context text (previously they were NOT excluded here; this is the fix).
 * Priority when the cap is reached: entity > tag > semantic > recent
 * backfill, so the strongest relevance signals win a slot first while
 * recency still fills any remaining room.
 */
async function buildRecentContext(db, entryRef, currentId, entry, apiKey) {
  try {
    const col = entryRef.parent;
    if (!col || typeof col.orderBy !== 'function') return '';

    const spaceId = entry?.spaceId;
    const scoped = !!spaceId && (await getServerFlag(db, 'contextSpaces', false));

    // Wider raw fetch (same query shape/index as before — just a bigger
    // limit) so channels 2-4 have room to look past the most-recent
    // RECENT_CONTEXT_LIMIT candidates. createdAt-desc order is stable, so
    // this changes nothing about WHICH docs occupy the first
    // RECENT_CONTEXT_LIMIT positions (channel 1, below).
    const q = scoped
      ? col.where('spaceId', '==', spaceId).orderBy('createdAt', 'desc').limit(CANDIDATE_POOL_LIMIT)
      : col.orderBy('createdAt', 'desc').limit(CANDIDATE_POOL_LIMIT);

    const snap = await q.get();
    const rawDocs = [];
    snap.forEach((doc) => {
      if (doc.id === currentId) return;
      rawDocs.push({ id: doc.id, ...(doc.data() || {}) });
    });

    // Channel 1: recent window + fallback. Exactly the raw slice a plain
    // limit(RECENT_CONTEXT_LIMIT) query would have returned, filtered the
    // same way the legacy code filtered (usable text), PLUS the new
    // sensitive-entry exclusion.
    const recentWindow = rawDocs.slice(0, RECENT_CONTEXT_LIMIT).filter(isUsableCandidate);

    // Wider filtered pool for channels 2-4.
    const pool = rawDocs.filter(isUsableCandidate);

    const newEntryTags = Array.isArray(entry?.tags) ? entry.tags : [];
    const { entity: newEntityTags, topic: newTopicTags } = splitEntityAndTopicTags(newEntryTags);
    const entityTagSet = new Set(newEntityTags);
    const topicTagSet = new Set(newTopicTags);

    const entityMatches = entityTagSet.size > 0
      ? pool.filter((d) => (Array.isArray(d.tags) ? d.tags : []).some((t) => entityTagSet.has(t)))
      : [];
    const tagMatches = topicTagSet.size > 0
      ? pool.filter((d) => (Array.isArray(d.tags) ? d.tags : []).some((t) => topicTagSet.has(t)))
      : [];

    // Channel 4: semantic. Only attempted when there's SOMETHING to embed
    // against — skips the embedding API call entirely if no pool candidate
    // has a stored vector.
    let semanticMatches = [];
    const vectorCandidates = pool.filter((d) => Array.isArray(d.embeddingV2) && d.embeddingV2.length > 0);
    if (vectorCandidates.length > 0 && apiKey && typeof entry?.text === 'string' && entry.text.trim()) {
      try {
        const v2Model = await getModel(db, 'embeddingV2');
        const queryVector = await generateEmbeddingV2(entry.text, apiKey, {
          model: v2Model,
          taskType: EMBEDDING_V2_QUERY_TASK_TYPE,
        });
        if (queryVector?.embedding) {
          semanticMatches = vectorCandidates
            .map((d) => ({ d, score: cosineSimilarity(queryVector.embedding, d.embeddingV2) }))
            .filter((s) => s.score > SEMANTIC_CHANNEL_SIMILARITY_THRESHOLD)
            .sort((a, b) => b.score - a.score)
            .map((s) => s.d);
        }
      } catch {
        semanticMatches = []; // best-effort — never fail the analysis over a semantic-channel error
      }
    }

    // Merge -> dedupe by id -> cap at RECENT_CONTEXT_LIMIT (the existing
    // context size). Priority order: entity, tag, semantic, then recent
    // backfill — see doc comment above for the fallback guarantee.
    const seen = new Set();
    const merged = [];
    for (const d of [...entityMatches, ...tagMatches, ...semanticMatches, ...recentWindow]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push(d);
      if (merged.length >= RECENT_CONTEXT_LIMIT) break;
    }

    return merged.map(formatContextLine).join('\n\n');
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
  const recentContext = entryType === 'task' ? '' : await buildRecentContext(db, entryRef, opId, entry, gemini);
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

  // Precision-first intent extraction (PRD 0B), behind the `intentExtraction`
  // server flag. Best-effort: a failure here must NEVER fail the analysis
  // publish. When ON, the intent system OWNS `extracted_tasks` — it replaces
  // the legacy classifier's list (policy-qualified active task intents only,
  // or nothing at all: silence is a correct result).
  if (await getServerFlag(db, 'intentExtraction', false)) {
    try {
      const intentModel = await getModel(db, 'intentExtraction');
      const { extractedTasks } = await runIntentExtraction({ db, entryRef, entry, modelId: intentModel, apiKey: gemini });
      if (Array.isArray(extractedTasks)) {
        if (extractedTasks.length > 0) payload.extracted_tasks = extractedTasks;
        else delete payload.extracted_tasks;
      }
    } catch (e) {
      logStage(opId, 'intent_extraction_error', { error: (e?.message || String(e)).slice(0, 200) });
    }
  }

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
