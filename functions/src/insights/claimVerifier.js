/**
 * Claim wording verifier (R4 Phase 2). The trust core of the LLM-wording
 * path: a future writer proposes `wording` for an InsightClaim; THIS module
 * decides whether it is entailed by the deterministic evidence bundle.
 * Nothing unverified may ever persist.
 *
 * Two independent layers, composed cheap-first:
 *   1. `verifyDeterministic` — fast, pure, no I/O. Regex/string checks
 *      against the bundle. Any failure here is a hard fail — the LLM
 *      entailment check never even runs (skip on obvious rejection).
 *   2. `verifyWithModel` — an independent model is asked whether every
 *      factual assertion in the wording is entailed by the evidence
 *      bundle's JSON. FAILS CLOSED: a thrown error, a network failure, or
 *      unparseable/malformed model output is treated as NOT entailed, never
 *      as "skip the check". There is no silent-pass path.
 *
 * `verifyWording` requires BOTH layers to pass before a `wording` may be
 * used to build a claim (see claimSchema.js's buildClaim, which separately
 * still hard-rejects causal language as a second, independent gate).
 *
 * Pure module: the LLM caller is INJECTED (`{ callModel }`) — this file
 * imports no model/api code, so it is fully unit-testable without network
 * access and without knowing which provider/model is wired in.
 */

export const VERIFIER_VERSION = 1;
export const MAX_WORDING_SENTENCES = 2;
export const MAX_WORDING_CHARS = 320;

// Sync: byte-identical copy of the client's causal-language regex in
// src/services/insights/claims/claimSchema.js (search for CAUSAL_RE there).
// This is a cross-package duplicate, same precedent as
// functions/src/reports/dismissalKey.js <-> src/services/nexus/insightDismissal.js:
// the client and server are separate deployable packages, so the pattern is
// intentionally duplicated rather than imported. A parity test (Task 9)
// asserts the two stay identical — if you change one, change both AND keep
// this comment pair honest.
export const CAUSAL_RE = /\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i;

// Case-insensitive substring match against the wording. Any hit is a hard
// fail (`banned_phrase`) — these are words that either overclaim certainty
// ('proves', 'guarantees', 'always', 'never fails', 'definitely'),
// prescribe behavior ('you should', 'you must'), or invent a clinical frame
// ('diagnos', 'disorder') that a personal pattern-to-watch card must never
// carry.
export const BANNED_PHRASES = Object.freeze([
  'proves', 'guarantees', 'you should', 'you must', 'diagnos', 'disorder',
  'always', 'never fails', 'definitely',
]);

const NUMERAL_RE = /\d+(?:\.\d+)?/g;
const SENTENCE_SPLIT_RE = /[.!?]+\s/;
const SENSITIVE_WORDS = ['hidden', 'sensitive', 'flagged'];

/** Round to 1 decimal place, avoiding floating-point string artifacts. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Build the set of numeral strings (as rounded-to-1-decimal numbers) that
 * are legitimately entailed by the bundle: the bundle's own day/span
 * counts, the effect size (both its 1-decimal and rounded-to-integer
 * forms, since deterministic wording rounds to 1 decimal but an LLM may
 * reasonably round further for readability), and the fixed 0/100 pair that
 * a "0-100 scale" phrasing is allowed to cite regardless of the bundle's
 * actual numbers.
 */
function entailedNumbers(bundle) {
  const n = bundle?.numbers || {};
  const effect = Math.abs(Number(n.effectMoodPoints));
  const values = [
    n.exposedDayCount, n.comparisonDayCount, n.observedSpanDays,
    n.hiddenSensitiveSourceCount,
    100, 0,
  ].filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (Number.isFinite(effect)) {
    values.push(effect, Math.round(effect));
  }
  return new Set(values.map(round1));
}

function checkCausalLanguage(wording, reasons) {
  if (CAUSAL_RE.test(wording)) reasons.push('causal_language');
}

function checkBannedPhrase(wording, reasons) {
  const lower = wording.toLowerCase();
  if (BANNED_PHRASES.some((p) => lower.includes(p))) reasons.push('banned_phrase');
}

function checkUnentailedNumeral(wording, bundle, reasons) {
  // I2: Known limitation — word-numerals ('twelve points higher') bypass
  // this digit-regex check by design. The fail-closed LLM entailment layer
  // is the backstop for spelled-out magnitudes. DO NOT silently expand this
  // regex without updating the Task-9 parity/matrix rows.
  const found = wording.match(NUMERAL_RE) || [];
  if (found.length === 0) return;
  const allowed = entailedNumbers(bundle);
  const ok = found.every((raw) => {
    const rounded = round1(Number(raw));
    for (const allowedValue of allowed) {
      if (Math.abs(rounded - allowedValue) <= 0.05) return true;
    }
    return false;
  });
  if (!ok) reasons.push('unentailed_numeral');
}

function checkSubjectMissing(wording, bundle, reasons) {
  const subject = String(bundle?.subject || '').toLowerCase();
  if (!subject || !wording.toLowerCase().includes(subject)) reasons.push('subject_missing');
}

function checkDirectionMismatch(wording, bundle, reasons) {
  const lower = wording.toLowerCase();
  // I1: Detect better/worse in addition to higher/lower
  const mentionsHigher = /\b(higher|better)\b/.test(lower) || /\b(more|better)\b(?=[^.!?]*\bmood\b)|\bmood\b[^.!?]*\b(more|better)\b/.test(lower);
  const mentionsLower = /\b(lower|worse)\b/.test(lower) || /\b(less|worse)\b(?=[^.!?]*\bmood\b)|\bmood\b[^.!?]*\b(less|worse)\b/.test(lower);
  if (!mentionsHigher && !mentionsLower) return;
  const wantsPositive = bundle?.direction === 'positive';
  if (mentionsHigher && !wantsPositive) reasons.push('direction_mismatch');
  if (mentionsLower && wantsPositive) reasons.push('direction_mismatch');
}

function checkTooLong(wording, reasons) {
  const sentences = wording.split(SENTENCE_SPLIT_RE).filter((s) => s.trim() !== '');
  if (wording.length > MAX_WORDING_CHARS || sentences.length > MAX_WORDING_SENTENCES) {
    reasons.push('too_long');
  }
}

function checkSensitiveReference(wording, bundle, reasons) {
  const lower = wording.toLowerCase();
  const mentionsSensitive = SENSITIVE_WORDS.some((w) => lower.includes(w));
  if (!mentionsSensitive) return;
  const hiddenCount = Number(bundle?.numbers?.hiddenSensitiveSourceCount) || 0;
  if (hiddenCount <= 0) reasons.push('sensitive_reference');
}

/**
 * Deterministic checks only — cheap, pure, no I/O. Accumulates every
 * failing reason token rather than short-circuiting on the first, so
 * callers/logs see the full picture of what a candidate wording got wrong.
 *
 * @param {string} wording
 * @param {Object} bundle - deterministic evidence bundle (subject, outcome,
 *   direction, numbers{...}, limitations, excerpts, deterministicWording)
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function verifyDeterministic(wording, bundle) {
  const reasons = [];
  // M3: NFKC-normalize once at the top so fullwidth digits (e.g. １２)
  // hit the numeral extractor and homoglyph tricks lose cheap cover.
  const text = String(wording || '').normalize('NFKC');
  checkCausalLanguage(text, reasons);
  checkBannedPhrase(text, reasons);
  checkUnentailedNumeral(text, bundle, reasons);
  checkSubjectMissing(text, bundle, reasons);
  checkDirectionMismatch(text, bundle, reasons);
  checkTooLong(text, reasons);
  checkSensitiveReference(text, bundle, reasons);
  return { pass: reasons.length === 0, reasons };
}

export const MODEL_SYSTEM_PROMPT = 'Here is a JSON evidence bundle and one candidate sentence. '
  + 'Answer strict JSON {"entailed": true|false, "offending": string|null} '
  + '— entailed is false if ANY factual assertion (number, comparison, '
  + 'event, causal implication) is not directly supported by the bundle.';

/**
 * Independent-model entailment check. FAILS CLOSED: any thrown error,
 * network failure, or output that isn't strict parseable JSON with a
 * boolean `entailed` field is treated as NOT entailed — there is no
 * silent-pass path when the model is unavailable or misbehaves.
 *
 * @param {string} wording
 * @param {Object} bundle
 * @param {{ callModel: (input: { systemPrompt: string, wording: string, bundle: Object }) => Promise<string> }} deps
 * @returns {Promise<{ pass: boolean, reason: string|null }>}
 */
export async function verifyWithModel(wording, bundle, { callModel }) {
  let raw;
  try {
    raw = await callModel({ systemPrompt: MODEL_SYSTEM_PROMPT, wording, bundle });
  } catch {
    return { pass: false, reason: 'llm_entailment_rejected' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { pass: false, reason: 'llm_entailment_rejected' };
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.entailed !== 'boolean') {
    return { pass: false, reason: 'llm_entailment_rejected' };
  }
  if (parsed.entailed !== true) {
    return { pass: false, reason: 'llm_entailment_rejected' };
  }
  return { pass: true, reason: null };
}

/**
 * Compose both layers, cheap-first: the LLM entailment check runs ONLY if
 * the deterministic layer passes (deterministic failures never spend a
 * model call). Verdict is 'pass' only if BOTH layers pass.
 *
 * @param {string} wording
 * @param {Object} bundle
 * @param {{ callModel: Function }} deps
 * @returns {Promise<{ verdict: 'pass'|'fail', reasons: string[] }>}
 */
export async function verifyWording(wording, bundle, { callModel }) {
  const det = verifyDeterministic(wording, bundle);
  if (!det.pass) {
    return { verdict: 'fail', reasons: det.reasons };
  }
  const llm = await verifyWithModel(wording, bundle, { callModel });
  if (!llm.pass) {
    return { verdict: 'fail', reasons: [llm.reason] };
  }
  return { verdict: 'pass', reasons: [] };
}
