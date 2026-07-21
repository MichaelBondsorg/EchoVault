/**
 * enrichmentRunner — post-save, fire-and-forget enrichment for a durable entry.
 *
 * Part of the "core-first save" redesign (flag: coreFirstSave). The core
 * journal entry is persisted FIRST (see buildCoreEntry). This runner then
 * derives every OPTIONAL context — health, environment (weather/sun), temporal
 * context, and native local-analysis — against the moment of capture and
 * writes it back with a single updateDoc. It is invoked AFTER addDoc
 * resolves and AFTER the UI reset/dismiss, so no user-visible latency depends
 * on it.
 *
 * Guarantees:
 *  - Never throws (best-effort; a failure must never break capture).
 *  - Never creates the entry (no addDoc) — it only updateDoc's an existing ref.
 *  - Missing context stays ABSENT/null and is NEVER fabricated. Each group's
 *    failure records `enrichment.reasons.<field> = <errorCode>` and downgrades
 *    the final `enrichment.status` to 'partial'.
 *  - The doc always ends with enrichment { status: 'complete' | 'partial',
 *    requestedAt, enrichedAt, enrichmentVersion: 1 }.
 *
 * `deps` injects the enrichment functions for testability; real modules are
 * lazy-loaded (dynamic import) only when a dep is not supplied, so unit tests
 * that inject every dep never pull the heavy AI/native modules.
 */
import { updateDoc as fsUpdateDoc } from 'firebase/firestore';
import { recordStage as realRecordStage, STAGES } from '../telemetry/captureTelemetry';
import { removeUndefined } from '../../utils/string';

// Temporal detection can be slow (server Gemini call). Bound it so a hung call
// can't leave enrichment perpetually incomplete — matches the legacy 45s cap.
const TEMPORAL_TIMEOUT_MS = 45000;
const TIMEOUT_SENTINEL = Symbol('temporal-timeout');

const withTimeout = (promise, ms, fallback) =>
  Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

async function resolveDep(deps, name) {
  if (deps && deps[name]) return deps[name];
  switch (name) {
    case 'getEntryHealthContext':
      return (await import('../health')).getEntryHealthContext;
    case 'getEntryEnvironmentContext':
      return (await import('../environment')).getEntryEnvironmentContext;
    case 'getCurrentLocation':
      return (await import('../environment')).getCurrentLocation;
    case 'detectTemporalContext':
      return (await import('../temporal')).detectTemporalContext;
    case 'performLocalAnalysis':
      return (await import('../analysis')).performLocalAnalysis;
    default:
      return undefined;
  }
}

// ---- enrichment groups (each resolves; never rejects) -------------------

async function healthGroup(getEntryHealthContext) {
  try {
    const ctx = await getEntryHealthContext();
    return ctx ? { fields: { healthContext: ctx }, reasons: {} } : { fields: {}, reasons: {} };
  } catch (e) {
    return { fields: {}, reasons: { health: e?.code || 'health_error' } };
  }
}

async function environmentGroup({ getEntryEnvironmentContext, getCurrentLocation, coarseLocation, capturedAt }) {
  const fields = {};
  const reasons = {};

  // Location provenance: prefer the pre-save coarse snapshot; if it timed out
  // (null), retry fresh here — enrichment is off the critical path so the extra
  // latency is invisible to the user.
  let location = coarseLocation;
  if (!location?.latitude) {
    try {
      location = await getCurrentLocation();
    } catch {
      location = null;
    }
  }
  if (location?.latitude && location?.longitude) {
    fields.location = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      cached: location.cached || false,
    };
  }

  // Weather + sun. getEntryEnvironmentContext ONLY supports "now" (it takes no
  // date argument and reads current conditions), so we cannot fetch historical
  // weather for `capturedAt`. We still stamp `observedFor = capturedAt` next to
  // `fetchedAt` so downstream consumers have honest provenance for what moment
  // this observation is attributed to vs. when it was actually fetched.
  try {
    const env = await getEntryEnvironmentContext();
    if (env) {
      fields.environmentContext = {
        ...env,
        observedFor: capturedAt,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    reasons.environment = e?.code || 'environment_error';
  }

  return { fields, reasons };
}

async function temporalGroup({ detectTemporalContext, text }) {
  try {
    const temporal = await withTimeout(detectTemporalContext(text), TEMPORAL_TIMEOUT_MS, TIMEOUT_SENTINEL);
    if (temporal === TIMEOUT_SENTINEL) {
      return { fields: {}, reasons: { temporal: 'temporal_timeout' } };
    }

    const fields = {};
    // Field shapes copied EXACTLY from App.jsx#doSaveEntry so the write
    // contract is unchanged (consumers migrate in a later phase).
    if (temporal?.detected && temporal?.reference) {
      fields.temporalContext = {
        detected: true,
        reference: temporal.reference,
        originalPhrase: temporal.originalPhrase,
        confidence: temporal.confidence,
        // effectiveDate always == now under the temporal redesign, so an entry
        // is never backdated — matches the legacy runtime value.
        backdated: false,
      };
    }
    // futureMentions is intentionally no longer persisted (retired — Open
    // Loops replaced it in R1). The temporal service still produces the
    // data in memory above; we just stop writing it to Firestore.
    return { fields, reasons: {} };
  } catch (e) {
    return { fields: {}, reasons: { temporal: e?.code || 'temporal_error' } };
  }
}

async function localAnalysisGroup({ isNative, precomputed, performLocalAnalysis, text, voiceTone }) {
  // Local analysis is a native-only immediate-feedback signal in the legacy
  // path. It is intentionally NOT re-writing entry_type/title/analysis here:
  // the server analysis pipeline (fired concurrently) owns those authoritative
  // fields, and racing it from two fire-and-forget updates could clobber good
  // results with provisional local ones. We persist only localAnalysis +
  // hasLocalAnalysis (EntryCard still gets immediate mood via localAnalysis).
  if (!isNative) return { fields: {}, reasons: {} };
  try {
    const la = precomputed ?? (performLocalAnalysis ? performLocalAnalysis(text, { voiceTone }) : null);
    if (!la) return { fields: {}, reasons: {} };
    return {
      fields: {
        localAnalysis: {
          entry_type: la.entry_type,
          mood_score: la.mood_score,
          classification_confidence: la.classification_confidence,
          sentiment_confidence: la.sentiment_confidence,
          extracted_tasks: la.extracted_tasks || [],
          analyzed_at: new Date().toISOString(),
          analysis_time_ms: la.local_analysis_time_ms,
        },
        hasLocalAnalysis: true,
      },
      reasons: {},
    };
  } catch (e) {
    return { fields: {}, reasons: { localAnalysis: e?.code || 'local_analysis_error' } };
  }
}

/**
 * Run all post-save enrichment groups and write results back to the entry.
 *
 * @param {Object} args
 * @param {Object} args.entryRef        Firestore DocumentReference of the saved entry.
 * @param {Object} args.entryData       The core entry object (from buildCoreEntry).
 * @param {Object} [args.captureContext] { capturedAt, captureTimezone, coarseLocation,
 *                                        localAnalysis, voiceTone } — capture-time snapshot.
 *                                        coarseLocation / localAnalysis / voiceTone are not on the
 *                                        core entry, so they arrive here rather than via entryData.
 * @param {Object} [args.deps]          Injected enrichment fns (see module doc). Defaults are the
 *                                        real modules, lazy-loaded.
 * @returns {Promise<void>}
 */
export async function runPostSaveEnrichment({ entryRef, entryData, captureContext = {}, deps = {} } = {}) {
  try {
    const updateDoc = deps.updateDoc || fsUpdateDoc;
    const recordStage = deps.recordStage || realRecordStage;

    const ownerUid = entryData?.userId;
    const entryId = entryRef?.id;
    const operationId = entryData?.operationId ?? entryId;
    const capturedAt = entryData?.capturedAt ?? captureContext.capturedAt;
    const text = entryData?.text;
    const platform = entryData?.createdOnPlatform;
    const isNative = platform === 'ios' || platform === 'android';

    const start = Date.now();
    await recordStage(ownerUid, operationId, STAGES.ENRICH_START, {});

    const [
      getEntryHealthContext,
      getEntryEnvironmentContext,
      getCurrentLocation,
      detectTemporalContext,
      performLocalAnalysis,
    ] = await Promise.all([
      resolveDep(deps, 'getEntryHealthContext'),
      resolveDep(deps, 'getEntryEnvironmentContext'),
      resolveDep(deps, 'getCurrentLocation'),
      resolveDep(deps, 'detectTemporalContext'),
      resolveDep(deps, 'performLocalAnalysis'),
    ]);

    const settled = await Promise.allSettled([
      healthGroup(getEntryHealthContext),
      environmentGroup({
        getEntryEnvironmentContext,
        getCurrentLocation,
        coarseLocation: captureContext.coarseLocation,
        capturedAt,
      }),
      temporalGroup({ detectTemporalContext, text }),
      localAnalysisGroup({
        isNative,
        precomputed: captureContext.localAnalysis,
        performLocalAnalysis,
        text,
        voiceTone: captureContext.voiceTone,
      }),
    ]);

    const update = {};
    const reasons = {};
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        Object.assign(update, s.value.fields || {});
        Object.assign(reasons, s.value.reasons || {});
      } else if (s.status === 'rejected') {
        // A group should never reject (each catches internally); record a
        // generic reason so the entry is honestly marked partial if one does.
        reasons.unknown = 'enrichment_group_error';
      }
    }

    const hadFailure = Object.keys(reasons).length > 0;
    update.enrichment = {
      status: hadFailure ? 'partial' : 'complete',
      requestedAt: entryData?.enrichment?.requestedAt,
      enrichedAt: new Date().toISOString(),
      enrichmentVersion: 1,
      ...(hadFailure ? { reasons } : {}),
    };

    try {
      await updateDoc(entryRef, removeUndefined(update));
    } catch (e) {
      console.warn('[enrichmentRunner] updateDoc failed (non-blocking):', e?.message);
    }

    await recordStage(ownerUid, operationId, STAGES.ENRICH_END, { durationMs: Date.now() - start });
  } catch (e) {
    // Fire-and-forget: enrichment must never break the capture flow.
    console.error('[enrichmentRunner] fatal (non-blocking):', e?.message);
  }
}

export default runPostSaveEnrichment;
