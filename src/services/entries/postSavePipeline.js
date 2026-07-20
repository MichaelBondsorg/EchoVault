/**
 * postSavePipeline — decides which of the three post-save, fire-and-forget
 * pipelines run after a durable entry write (plan task C3-client).
 *
 * `doSaveEntry` (App.jsx) always needs signal extraction (DetectedStrip) and
 * the Nexus insight update — neither is server-owned yet. The CLIENT analysis
 * chain (classify/analyze/insight/context + updateDoc), however, duplicates
 * work the server-side `onEntryCreatedAnalysis` trigger now owns end-to-end
 * once `serverAnalysisOrchestrator` is enabled (functions/src/analysis/orchestrator.js).
 * When that flag is on, the client must NOT also run its chain — the server
 * publish arrives via the existing entries `onSnapshot` listener and the UI
 * (analysisStatus 'pending' -> 'complete') already tolerates the wait.
 *
 * Extracted as a small pure function (rather than left inline in App.jsx,
 * which is otherwise untested) so the flag branch has direct unit coverage.
 * `runSignals`/`runNexus`/`runAnalysisChain` are injected as already-bound,
 * fire-and-forget async callbacks (each swallows its own errors) — this
 * function never awaits them, matching the pre-existing IIFE behaviour.
 */

/**
 * @param {object} args
 * @param {Function} args.runSignals - Fires signal extraction. Always called.
 * @param {Function} args.runNexus - Fires the Nexus insight update. Always called.
 * @param {Function} args.runAnalysisChain - Fires the client classify/analyze/
 *   insight/context chain. Skipped when the server owns analysis.
 * @param {Function} args.getFlag - Synchronous flag reader, e.g. `getFlag('name')`.
 * @returns {{ analysisChainSkipped: boolean }}
 */
export function runPostSavePipelines({ runSignals, runNexus, runAnalysisChain, getFlag }) {
  runSignals();
  runNexus();

  if (getFlag('serverAnalysisOrchestrator')) {
    return { analysisChainSkipped: true };
  }

  runAnalysisChain();
  return { analysisChainSkipped: false };
}

export default { runPostSavePipelines };
