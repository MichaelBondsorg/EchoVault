/**
 * Pinned model manifest generator (product review MOD-01, builds on MOD-02's
 * registry — see `registry.js`'s doc comment; this file never becomes a
 * parallel system, it only reads MOD-02's own source of truth).
 *
 * `generateManifest()` is a PURE function of `registry.js`'s `WORKLOADS` +
 * `MODEL_DEFAULTS` (plus the small, explicitly-sourced `promptVersion` map
 * below) — no I/O, no Firestore, no network, no Date.now(). That purity is
 * what makes the checked-in `model-manifest.json` drift-detectable: running
 * `generateManifest()` twice in the same process, or in two different
 * processes on the same source tree, produces byte-identical output. If a
 * future edit changes a `MODEL_DEFAULTS` entry without regenerating the
 * checked-in JSON (via `scripts/generate-model-manifest.mjs`), the drift
 * test in `__tests__/manifestDrift.test.js` fails CI.
 *
 * Deliberately records DEFAULTS only, not `config/flags` runtime overrides —
 * an override is a live, per-environment operational fact (see
 * `scripts/flip-flag.mjs`), not a pinned/reviewed deployment decision. The
 * manifest answers "what does the reviewed source say this workload runs
 * on", which is exactly what a benchmark-before-flip governance process
 * needs to diff against a candidate.
 */
import { WORKLOADS, MODEL_DEFAULTS } from './registry.js';

/**
 * Prompt/schema version per workload, where the codebase has an explicit,
 * unambiguous version constant scoped to THAT workload's own prompt
 * assembly. Left `null` for every workload without one — a guessed or
 * inherited version number would be worse than an honest gap. Each entry
 * below cites its source constant so a future changer can find and bump it.
 */
export const WORKLOAD_PROMPT_VERSIONS = Object.freeze({
  // analysis/orchestrator.js's PROMPT_VERSION, stamped into
  // analysisMeta().promptVersion alongside the analyze-stage modelId.
  analyze: 1,
  // intents/intentSchema.js's PROMPT_VERSION, stamped into the intent
  // schema's `versions.prompt` field.
  intentExtraction: 1,
  // insights/claimVerifier.js's VERIFIER_VERSION.
  insightVerifier: 1,
});

/**
 * Build the pinned manifest: one entry per registry workload, sorted by
 * workload name for a stable diff/serialization order regardless of
 * `WORKLOADS`' declaration order.
 *
 * @returns {{ workloads: Array<{ workload: string, modelId: string, promptVersion: number|null }> }}
 */
export function generateManifest() {
  const workloads = Object.values(WORKLOADS)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((workload) => ({
      workload,
      modelId: MODEL_DEFAULTS[workload],
      promptVersion: Object.prototype.hasOwnProperty.call(WORKLOAD_PROMPT_VERSIONS, workload)
        ? WORKLOAD_PROMPT_VERSIONS[workload]
        : null,
    }));
  return { workloads };
}

/** Deterministic JSON serialization used by both the generator script and the drift test — 2-space indent, trailing newline, stable key order (matches the object literal order in generateManifest's map above). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export default { generateManifest, serializeManifest, WORKLOAD_PROMPT_VERSIONS };
