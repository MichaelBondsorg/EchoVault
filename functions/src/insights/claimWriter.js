/**
 * Claim wording writer (R4 Phase 2, plan task P2-T2).
 *
 * Proposes claim wording from a deterministic evidence bundle. This module
 * ONLY writes — it never verifies its own output. A separate, independently
 * modeled verifier (`claimVerifier.js`) polices the wording before it can
 * ever reach a user; see the registry comment on `insightWriter`/
 * `insightVerifier` for why those default to different models.
 *
 * The bundle is built server-side from the claim input and NOTHING else
 * (see the plan's "Evidence bundle sent to the writer" shape) — this module
 * never has access to raw journal text, so it structurally cannot leak
 * anything beyond what the bundle already carries.
 */

// Contract lines below are asserted verbatim by tests — keep the phrasing
// stable; the verifier's LLM entailment check is calibrated against this
// framing too.
const SYSTEM_PROMPT = `You write a short piece of claim wording for a personal journaling app, from ONE evidence bundle only. Follow this contract exactly:

- Explain ONLY the provided evidence bundle. Do not add outside knowledge, speculation, or anything not present in the bundle.
- Write one or two sentences. No more.
- Use non-causal co-movement phrasing: describe associations, never cause. Never state, imply, or use cause, causes, or caused — describe what tends to occur alongside what.
- Every number must come from the bundle. Never invent, round differently, or estimate a number that is not in the bundle.
- Never mention hidden or sensitive material, even indirectly. Do not use the words hidden, sensitive, or flagged unless the bundle's hiddenSensitiveSourceCount is greater than zero.
- Write in second person ("you"), warm but plain. No clinical jargon, no hype.
- Return strict JSON only, in exactly this shape: {"wording": "..."}. No prose, no markdown, no code fences.`;

/**
 * Build the {systemPrompt, userPrompt} pair sent to the writer model.
 * The user prompt is the JSON-stringified bundle verbatim — every number and
 * excerpt the writer may reference is therefore present by construction.
 *
 * @param {object} bundle - Evidence bundle (see plan's writer-bundle shape).
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildWriterPrompt(bundle) {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(bundle),
  };
}

/**
 * Parse a writer model response into a trimmed wording string, or null.
 * Tolerates fenced (```json ... ``` or ``` ... ```) and bare JSON. Never
 * throws — any malformed/garbage input, or a missing/blank/non-string
 * `wording` field, yields null.
 *
 * @param {*} raw - Raw model output (expected to be a string).
 * @returns {string|null}
 */
export function parseWriterResponse(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  if (!cleaned) return null;
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const wording = parsed?.wording;
  if (typeof wording !== 'string') return null;
  const trimmed = wording.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Compose the writer prompt, call the model, and parse the result.
 * Never throws — any failure (model call, parse) resolves to null so the
 * caller can fall back to `bundle.deterministicWording` or fail closed.
 *
 * @param {object} bundle - Evidence bundle.
 * @param {{callModel: function({systemPrompt: string, userPrompt: string}): Promise<string>}} deps
 * @returns {Promise<string|null>}
 */
export async function writeWording(bundle, { callModel }) {
  try {
    const { systemPrompt, userPrompt } = buildWriterPrompt(bundle);
    const raw = await callModel({ systemPrompt, userPrompt });
    return parseWriterResponse(raw);
  } catch {
    return null;
  }
}

export default {
  buildWriterPrompt,
  parseWriterResponse,
  writeWording,
};
