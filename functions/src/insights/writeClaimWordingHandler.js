/**
 * `writeClaimWording` callable handler (R4 Phase 2, plan task P2-T3).
 *
 * Composes the writer (`claimWriter.js`, T2) and verifier (`claimVerifier.js`,
 * T1) server-side: the writer proposes wording from a deterministic evidence
 * bundle, the verifier polices it, and ONE rewrite is attempted (with the
 * verifier's reasons appended to the prompt) before failing closed.
 *
 * This module owns ONLY the compose-and-retry logic and bundle-shape
 * validation. Auth/consent/rate-limit guards live in the thin `onCall`
 * wrapper in `functions/index.js` (mirrors `executePrompt`/`askJournalAI`) —
 * this handler never assumes it was reached through them, but also never
 * re-checks them; it is dependency-injected so it is fully unit-testable
 * without a live Firestore/Gemini connection.
 *
 * Two `callModel` adapters are built around the server's `callGemini` here,
 * one per role, because `claimWriter.writeWording`'s `callModel` receives
 * `{systemPrompt, userPrompt} -> Promise<string>` while
 * `claimVerifier.verifyWording`'s `callModel` receives
 * `{systemPrompt, wording, bundle} -> Promise<string>` — the shapes differ,
 * so one adapter cannot serve both.
 */
import { getModel as defaultGetModel, WORKLOADS } from '../models/registry.js';
import { writeWording } from './claimWriter.js';
import { verifyWording } from './claimVerifier.js';

// Mirrors claimVerifier's MAX_WRITER_ATTEMPTS from the plan's shared
// contracts: writer -> verify; on fail, ONE rewrite attempt; second fail ->
// null wording.
export const MAX_WRITER_ATTEMPTS = 2;

const MAX_BUNDLE_EXCERPTS = 8;
const MAX_EXCERPT_CHARS = 200;

// Top-level bundle keys the writer/verifier contract recognizes (see the
// plan's "Evidence bundle sent to the writer" shape). Anything else is
// rejected outright — the bundle is server-built, so an unknown key means
// something upstream is wrong, not a shape we should tolerate.
const ALLOWED_BUNDLE_KEYS = new Set([
  'subject', 'outcome', 'direction', 'claimType',
  'numbers', 'limitations', 'excerpts', 'deterministicWording',
]);

/**
 * Validate the bundle shape BEFORE any model call: reject unknown top-level
 * keys, more than 8 excerpts, or any excerpt longer than 200 chars.
 * @param {*} bundle
 * @returns {boolean}
 */
export function isValidBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return false;

  for (const key of Object.keys(bundle)) {
    if (!ALLOWED_BUNDLE_KEYS.has(key)) return false;
  }

  const { excerpts } = bundle;
  if (excerpts !== undefined) {
    if (!Array.isArray(excerpts)) return false;
    if (excerpts.length > MAX_BUNDLE_EXCERPTS) return false;
    for (const item of excerpts) {
      const text = item?.excerpt;
      if (typeof text === 'string' && text.length > MAX_EXCERPT_CHARS) return false;
    }
  }

  return true;
}

/**
 * Build the writer-role `callModel` adapter: `{systemPrompt, userPrompt} ->
 * Promise<string>`, exactly what `claimWriter.writeWording` expects.
 */
function buildWriterCallModel({ apiKey, model, callGeminiImpl }) {
  return async ({ systemPrompt, userPrompt }) => callGeminiImpl(apiKey, systemPrompt, userPrompt, model);
}

/**
 * Build the verifier-role `callModel` adapter: `{systemPrompt, wording,
 * bundle} -> Promise<string>`, exactly what `claimVerifier.verifyWithModel`
 * expects. The bundle+wording pair is JSON-stringified into the user prompt
 * since `callGemini` only takes a flat system/user prompt pair.
 */
function buildVerifierCallModel({ apiKey, model, callGeminiImpl }) {
  return async ({ systemPrompt, wording, bundle }) => {
    const userPrompt = JSON.stringify({ bundle, wording });
    return callGeminiImpl(apiKey, systemPrompt, userPrompt, model);
  };
}

/**
 * Compose the writer and verifier for one `writeClaimWording` request.
 *
 * @param {object} args
 * @param {object} args.bundle - Evidence bundle (see plan's writer-bundle shape).
 * @param {object} deps
 * @param {object} [deps.db] - Firestore instance, forwarded to getModelImpl.
 * @param {{gemini: string}} deps.apiKeys - Provider API keys. Both writer and
 *   verifier call Gemini (per the registry's current defaults) so only the
 *   `gemini` key is used, but the model id differs per role.
 * @param {function} deps.callGeminiImpl - Injectable `callGemini` (test seam
 *   in tests; the real `functions/src/shared/gemini.js#callGemini` in
 *   production — see `functions/index.js`'s `writeClaimWording` callable).
 *   REQUIRED, no default (R4 Phase 3 backlog burn-down, P3-D7): a silent
 *   fallback to the real Gemini client here would let a caller that forgot
 *   to inject it accidentally fire real, uncontrolled API calls from a test
 *   or a future call site — a missing injection must throw clearly instead.
 * @param {function} [deps.getModelImpl] - Injectable `getModel` (test seam).
 * @returns {Promise<{verdict:'pass'|'fail', wording:string|null, reasons:string[], writerModel:string|null, verifierModel:string|null}>}
 */
export async function handleWriteClaimWording(
  { bundle },
  { db, apiKeys, callGeminiImpl, getModelImpl = defaultGetModel } = {}
) {
  if (typeof callGeminiImpl !== 'function') {
    throw new Error(
      'handleWriteClaimWording: callGeminiImpl is required (no default — every caller must inject it explicitly).'
    );
  }
  if (!isValidBundle(bundle)) {
    return {
      verdict: 'fail',
      wording: null,
      reasons: ['invalid_bundle'],
      writerModel: null,
      verifierModel: null,
    };
  }

  const [writerModel, verifierModel] = await Promise.all([
    getModelImpl(db, WORKLOADS.insightWriter),
    getModelImpl(db, WORKLOADS.insightVerifier),
  ]);

  const apiKey = apiKeys?.gemini;
  const writerCallModel = buildWriterCallModel({ apiKey, model: writerModel, callGeminiImpl });
  const verifierCallModel = buildVerifierCallModel({ apiKey, model: verifierModel, callGeminiImpl });

  let reasons = [];
  for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
    // On a rewrite, append the previous verifier reasons to the writer's
    // user prompt (built fresh from the bundle each attempt) so the model
    // sees exactly what it needs to fix, without mutating the bundle itself.
    const retryNote = attempt > 1
      ? `Your previous attempt failed verification for: ${reasons.join(', ')}. Rewrite obeying the contract.`
      : null;

    const wording = await writeWording(bundle, {
      callModel: async ({ systemPrompt, userPrompt }) => writerCallModel({
        systemPrompt,
        userPrompt: retryNote ? `${userPrompt}\n\n${retryNote}` : userPrompt,
      }),
    });

    if (!wording) {
      reasons = ['writer_error'];
      continue;
    }

    const verdict = await verifyWording(wording, bundle, { callModel: verifierCallModel });
    if (verdict.verdict === 'pass') {
      return { verdict: 'pass', wording, reasons: [], writerModel, verifierModel };
    }
    reasons = verdict.reasons;
  }

  return { verdict: 'fail', wording: null, reasons, writerModel, verifierModel };
}

export default { MAX_WRITER_ATTEMPTS, isValidBundle, handleWriteClaimWording };
