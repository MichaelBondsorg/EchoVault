/**
 * Server-side capture-stage telemetry (non-content).
 *
 * Emits a single structured JSON log line per stage event so pipeline
 * progress (transcribe start/end, analysis start/end, ...) is
 * grep/queryable in Cloud Logging without ever including journal content.
 *
 * Whitelist mirrors the client (src/services/telemetry/captureTelemetry.js)
 * plus `modelId`, `uidHash`, and raw `uid` — functions logs elsewhere
 * already include raw uid (e.g. consent-denied logs in
 * src/consent/consentGate.js's callers), so it's allowed here too;
 * content fields (transcript, text, etc.) are never whitelisted.
 */

// KEEP IN SYNC with src/services/telemetry/captureTelemetry.js's
// META_WHITELIST — the first 7 entries below must match that client-side
// list exactly; modelId/uidHash/uid are server-only additions with no
// client-side equivalent. Adding a shared (non-server-only) field here
// should also be added there.
const META_WHITELIST = [
  'durationMs',
  'bytes',
  'engine',
  'retryCount',
  'errorCode',
  'platform',
  'queueDepth',
  'modelId',
  'uidHash',
  'uid',
];

function pickWhitelisted(meta) {
  const picked = {};
  for (const key of META_WHITELIST) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) {
      picked[key] = meta[key];
    }
  }
  return picked;
}

/**
 * Log a single capture-pipeline stage event.
 * @param {string|null} operationId - Client-supplied operation id, or null.
 * @param {string} stage - Stage name (see client STAGES constants).
 * @param {object} [meta] - Non-content metadata; only whitelisted keys are logged.
 */
export function logStage(operationId, stage, meta = {}) {
  console.log(JSON.stringify({
    type: 'stage',
    opId: operationId,
    stage,
    at: Date.now(),
    ...pickWhitelisted(meta),
  }));
}

export default logStage;
