/**
 * Non-content stage telemetry for the capture pipeline.
 *
 * Records structured, content-free progress events ("local_ready",
 * "uploading", "transcribe_end", ...) for a capture operation into an
 * owner-scoped ring buffer in Capacitor Preferences, so later
 * debugging/observability work (core-first save, server orchestrator,
 * background upload, model registry) has a shared, cheap place to log
 * pipeline progress without ever touching journal content.
 *
 * `meta` is whitelisted on the way in — only structural/perf fields are
 * ever persisted or logged; anything else (e.g. a stray `text` or
 * `transcript` key) is silently dropped.
 */
import { Preferences } from '@capacitor/preferences';

export const STAGES = {
  LOCAL_READY: 'local_ready',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  TRANSCRIBE_START: 'transcribe_start',
  TRANSCRIBE_END: 'transcribe_end',
  ENTRY_SAVED: 'entry_saved',
  ENRICH_START: 'enrich_start',
  ENRICH_END: 'enrich_end',
  ANALYSIS_START: 'analysis_start',
  ANALYSIS_END: 'analysis_end',
  NEEDS_ATTENTION: 'needs_attention',
  RETRY: 'retry',
  COLD_START: 'cold_start',
  COMPLETE: 'complete',
};

// Only these meta fields are ever persisted or logged — never content.
const META_WHITELIST = [
  'durationMs',
  'bytes',
  'engine',
  'retryCount',
  'errorCode',
  'platform',
  'queueDepth',
];

const MAX_RING_ENTRIES = 200;

const ringKey = (ownerUid) => `capture_stages::${ownerUid}`;

function pickWhitelisted(meta) {
  const picked = {};
  for (const key of META_WHITELIST) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) {
      picked[key] = meta[key];
    }
  }
  return picked;
}

async function readRing(ownerUid) {
  try {
    const { value } = await Preferences.get({ key: ringKey(ownerUid) });
    if (!value) return [];
    const ring = JSON.parse(value);
    return Array.isArray(ring) ? ring : [];
  } catch {
    return [];
  }
}

/**
 * Append a stage event to `ownerUid`'s capture-stage ring buffer (capped at
 * 200 entries, oldest dropped first). Also logs
 * `console.info('[capture-stage]', stage, opId)` — the log line never
 * includes meta values. Best-effort: never throws, no-ops for a falsy
 * `ownerUid`.
 */
export async function recordStage(ownerUid, operationId, stage, meta = {}) {
  console.info('[capture-stage]', stage, operationId);

  if (!ownerUid) return;

  try {
    const whitelisted = pickWhitelisted(meta);
    const ring = await readRing(ownerUid);
    ring.push({ opId: operationId, stage, at: Date.now(), ...whitelisted });
    const capped = ring.length > MAX_RING_ENTRIES
      ? ring.slice(ring.length - MAX_RING_ENTRIES)
      : ring;
    await Preferences.set({ key: ringKey(ownerUid), value: JSON.stringify(capped) });
  } catch {
    // Best-effort telemetry — a persistence failure must never break capture.
  }
}

/**
 * Read the most recent `limit` stage events for `ownerUid`, oldest first.
 * Never throws; returns `[]` on any failure or falsy `ownerUid`.
 */
export async function getRecentStages(ownerUid, limit = 50) {
  if (!ownerUid) return [];
  const ring = await readRing(ownerUid);
  return ring.slice(-limit);
}

export default { STAGES, recordStage, getRecentStages };
