/**
 * Server-owned AI model registry (PRD 0A, plan task M1).
 *
 * Single source of truth for every AI model id the Cloud Functions use. Call
 * sites resolve a *workload* (what the call is for) rather than hardcoding a
 * provider model string, so a model retirement/bump is one edit here (code) or
 * a `config/flags` field change (data, no redeploy).
 *
 * Resolution order for getModel():
 *   1. `config/flags` doc field `model.<workload>` (string override)  ->
 *   2. MODEL_DEFAULTS[workload]
 * An unknown workload throws (fail loud — a typo must not silently pick a
 * default). Flag reads inherit getServerFlag's 60s in-process cache, so a hot
 * callable path does not hit Firestore on every invocation.
 *
 * getModelSync() returns the compiled default only (no flag override) for the
 * few synchronous call sites without a db handle. Prefer the async getModel
 * wherever a db is already in scope.
 */
import { getServerFlag } from '../shared/flags.js';

// The set of AI workloads. Values are identical to keys so callers can pass
// either WORKLOADS.digest or the bare string 'digest'.
export const WORKLOADS = Object.freeze({
  classify: 'classify',
  analyze: 'analyze',
  chat: 'chat',
  chatFallback: 'chatFallback',
  embedding: 'embedding',
  embeddingV2: 'embeddingV2',
  transcriptionFallback: 'transcriptionFallback',
  fusedTranscription: 'fusedTranscription',
  tone: 'tone',
  digest: 'digest',
  temporal: 'temporal',
  entityResolution: 'entityResolution',
  insight: 'insight',
  intentExtraction: 'intentExtraction',
  // realtime voice model is owned by the relay-server (env var REALTIME_MODEL);
  // recorded here for documentation/inventory completeness only.
  realtimeNA: 'realtimeNA',
});

/**
 * Current production defaults. Shut-down Gemini 2.0 paths (digest/tone) and the
 * ignored client temporal arg resolve to gemini-3.5-flash here (see plan M2).
 */
export const MODEL_DEFAULTS = Object.freeze({
  classify: 'gemini-3-flash-preview',
  analyze: 'gemini-3-flash-preview',
  chat: 'gpt-4o-mini',
  chatFallback: 'gpt-4o',
  embedding: 'text-embedding-004',
  embeddingV2: 'gemini-embedding-2',
  transcriptionFallback: 'whisper-1',
  fusedTranscription: 'gemini-2.5-flash',
  tone: 'gemini-3.5-flash',
  digest: 'gemini-3.5-flash',
  temporal: 'gemini-3.5-flash',
  entityResolution: 'gemini-3-flash-preview',
  insight: 'gemini-3-flash-preview',
  intentExtraction: 'gemini-3.5-flash',
  realtimeNA: 'gpt-realtime-2.1',
});

/**
 * Server-side model flags and their safe defaults. Overridable via the
 * `config/flags` doc (Admin SDK/console only). Both default OFF so the
 * gemini-embedding-2 dual-index migration is dark until explicitly enabled.
 */
export const MODEL_FLAG_DEFAULTS = Object.freeze({
  'model.embeddingWriteV2': false,
  'model.embeddingV2Read': false,
});

function assertKnownWorkload(workload) {
  if (!Object.prototype.hasOwnProperty.call(MODEL_DEFAULTS, workload)) {
    throw new Error(`Unknown model workload: ${String(workload)}`);
  }
}

/**
 * Resolve the model id for a workload, honouring a `config/flags` string
 * override. Never throws for a missing/failed flag read (getServerFlag returns
 * the default); DOES throw for an unknown workload.
 *
 * @param {object} db - Firestore instance (admin SDK).
 * @param {string} workload - One of WORKLOADS.
 * @returns {Promise<string>} Resolved model id.
 */
export async function getModel(db, workload) {
  assertKnownWorkload(workload);
  const override = await getServerFlag(db, `model.${workload}`, null);
  if (typeof override === 'string' && override.trim()) {
    return override.trim();
  }
  return MODEL_DEFAULTS[workload];
}

/**
 * Defaults-only accessor for synchronous call sites without a db handle.
 * @param {string} workload - One of WORKLOADS.
 * @returns {string} Default model id.
 */
export function getModelSync(workload) {
  assertKnownWorkload(workload);
  return MODEL_DEFAULTS[workload];
}

/** Read a server-side model flag with its registered default. */
export async function getModelFlag(db, name) {
  const fallback = Object.prototype.hasOwnProperty.call(MODEL_FLAG_DEFAULTS, name)
    ? MODEL_FLAG_DEFAULTS[name]
    : false;
  return getServerFlag(db, name, fallback);
}

export default {
  WORKLOADS,
  MODEL_DEFAULTS,
  MODEL_FLAG_DEFAULTS,
  getModel,
  getModelSync,
  getModelFlag,
};
