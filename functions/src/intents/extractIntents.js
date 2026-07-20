/**
 * Server intent extraction (PRD 0B, plan task I3).
 *
 * Flagged (`intentExtraction`), best-effort, async. Given an entry, ask the
 * model for a set of *candidate* intents — each carrying a REQUIRED evidence
 * span and the ten structural attributes — then run every candidate through the
 * pure activation policy (never the model's confidence) to decide its state,
 * persist each as an intent document under deterministic IDs (idempotent), and
 * derive the legacy `extracted_tasks` compat list (active task intents only)
 * for the orchestrator to publish in its single final update.
 *
 * The model may only PROPOSE. The policy decides. Abstaining (an empty array)
 * is an explicitly-correct outcome and must never be treated as an error.
 *
 * Never logs journal text — only ids, counts, and structured status.
 */
import { createHash } from 'crypto';
import { INTENT_KINDS, INTENT_ATTRIBUTE_KEYS, buildIntent } from './intentSchema.js';
import { decideActivation } from './activationPolicy.js';

const LLM_TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `You extract CANDIDATE intents from a personal journal entry for a precision-first task system.

CRITICAL: You only PROPOSE candidates. A separate deterministic policy — NOT your confidence — decides what becomes a task. Your job is to label structure honestly. When in doubt, DO NOT invent an actionable task; returning an empty array is the correct, expected answer when nothing is clearly actionable.

For each candidate output an object with:
- kind: one of ${INTENT_KINDS.join(', ')}
    task            = a concrete, self-owned, one-time action the writer will do
    open_loop       = an unresolved thread / an explicit "follow up with me later" request
    event           = something scheduled/happening (a meeting, therapy) — context only
    goal_habit      = an ongoing intention/habit ("exercise more") — context only
    reflection      = feeling/processing — context only
    external_action = an action owned by someone else — context only
    conditional     = gated on an "if" — context only
    completed       = already done — context only
- text: the EXACT verbatim substring of the entry that is the evidence (REQUIRED; a candidate with no locatable span is discarded)
- sourceSpan: { start, end } character offsets of that substring in the entry
- attributes (ALL booleans, judged honestly):
    agency       = the WRITER owns this action (first-person, self-directed)
    concrete     = a specific one-time action, not a vague wish
    unfinished   = not yet done
    temporalFit  = time reference (if any) is a plausible future, or there is none
    negated      = the statement is negated ("don't need to ... anymore")
    quoted       = it is reported/quoted speech, not the writer's own commitment
    conditional  = gated on a condition ("if I have time")
    goalLanguage = ongoing-goal/aspiration language ("should ... more", "want to ... more")
    otherOwned   = the action is owned by someone else ("Sam has to ...")
    completed    = already done ("I remembered to ...")
- confidence: 0..1 (advisory only)
- targetAt: ISO-8601 string if a specific time is stated, else null
- explicitCommand: true ONLY for explicit task-list syntax ("TODO:", "- [ ]") or an explicit follow-up request ("ask me Friday how it went")

Return ONLY a JSON array (possibly empty). No prose.`;

/**
 * Default model call: Gemini generateContent constrained to a JSON array. Throws
 * on a hard API/network failure (so the caller can retry) — returns the raw
 * text on success (empty/absent -> '[]').
 */
async function defaultGeminiJsonCall({ apiKey, model, systemPrompt, userText }) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`gemini-intent-extract ${res.status}: ${errorData?.error?.message || 'error'}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
}

/** Parse a model JSON response into a raw candidate array. Never throws. */
export function parseCandidatesResponse(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.candidates)) return parsed.candidates;
    return [];
  } catch {
    return [];
  }
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Locate a candidate's evidence span in the entry text. Prefers the model's
 * offsets when they actually contain the claimed text; otherwise falls back to
 * indexOf. Returns a `{start,end,text}` span or null when the span cannot be
 * located (such candidates are DROPPED — no span, no intent).
 */
function locateSpan(cand, entryText) {
  const text = typeof cand?.text === 'string' ? cand.text.trim() : '';
  if (!text) return null;
  if (typeof entryText !== 'string' || entryText === '') return null;

  const ss = cand.sourceSpan || {};
  const s = Number(ss.start);
  const e = Number(ss.end);
  if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && e <= entryText.length) {
    if (entryText.slice(s, e) === text) return { start: s, end: e, text };
  }
  const idx = entryText.indexOf(text);
  if (idx >= 0) return { start: idx, end: idx + text.length, text };
  return null;
}

/**
 * Normalize + validate raw model candidates into policy-ready candidates.
 * Drops anything with an unknown kind or an unlocatable evidence span, and
 * coerces each of the ten attributes to a strict boolean (missing => false, so
 * a partial model response can never smuggle a truthy activation).
 */
export function normalizeCandidates(rawCandidates, entryText) {
  const out = [];
  for (const cand of Array.isArray(rawCandidates) ? rawCandidates : []) {
    if (!cand || typeof cand !== 'object') continue;
    if (!INTENT_KINDS.includes(cand.kind)) continue;
    const span = locateSpan(cand, entryText);
    if (!span) continue;

    const attributes = {};
    const src = cand.attributes || {};
    for (const key of INTENT_ATTRIBUTE_KEYS) attributes[key] = src[key] === true;

    out.push({
      kind: cand.kind,
      sourceSpan: span,
      attributes,
      confidence: clamp01(cand.confidence),
      targetAt: typeof cand.targetAt === 'string' && cand.targetAt.trim() ? cand.targetAt : null,
      explicitCommand: cand.explicitCommand === true,
    });
  }
  return out;
}

/** Deterministic intent id — stable across redeliveries for idempotent writes. */
export function deterministicIntentId(entryId, spanStart, kind) {
  return createHash('sha1').update(`${entryId}:${spanStart}:${kind}`).digest('hex').slice(0, 20);
}

/**
 * Ask the model for candidate intents for one entry.
 * @returns {Promise<Array>} normalized, policy-ready candidates (possibly empty).
 * @throws on a hard model/API failure (lets the caller decide whether to retry).
 */
export async function extractIntentCandidates({ apiKey, entry, modelId, callModel = defaultGeminiJsonCall }) {
  const text = entry?.text;
  if (typeof text !== 'string' || !text.trim()) return [];
  const raw = await callModel({ apiKey, model: modelId, systemPrompt: SYSTEM_PROMPT, userText: text });
  return normalizeCandidates(parseCandidatesResponse(raw), text);
}

/** Map active task intents to the legacy `extracted_tasks` widget shape. */
function toLegacyTasks(activeTaskIntents) {
  return activeTaskIntents.map((intent, index) => ({
    text: intent.sourceSpan.text,
    completed: false,
    index,
  }));
}

async function readExistingActiveTaskIntents(intentsCol, entryId) {
  try {
    const snap = await intentsCol.where('entryId', '==', entryId).get();
    const results = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (d.kind === 'task' && d.state === 'active') results.push(d);
    });
    return results;
  } catch {
    return [];
  }
}

/**
 * Full extraction pass for one entry. Idempotent via deterministic intent IDs
 * plus a versioned dedup marker (`processing.intentsExtractedForVersion`)
 * committed in the SAME batch as the intents, so it only latches on success and
 * a transient failure can be retried.
 *
 * @returns {Promise<{ran:boolean, extractedTasks:Array}>}  extractedTasks is the
 *   legacy-compat active-task list for the orchestrator to publish.
 */
export async function runIntentExtraction({ db, entryRef, entry, modelId, apiKey, extractCandidates = extractIntentCandidates }) {
  const inputVersion = entry?.entryInputVersion ?? 0;
  const entryId = entry?.id || entryRef?.id;
  const ownerId = entryRef?.parent?.parent?.id;
  const intentsCol = entryRef.parent.parent.collection('intents');

  // Dedup: already extracted for this exact version -> rebuild the compat list
  // from stored intents rather than re-calling the model.
  if (entry?.processing?.intentsExtractedForVersion === inputVersion) {
    const existing = await readExistingActiveTaskIntents(intentsCol, entryId);
    return { ran: false, extractedTasks: toLegacyTasks(existing) };
  }

  const candidates = await extractCandidates({ db, apiKey, entry, modelId });

  const batch = db.batch();
  const activeTaskIntents = [];
  for (const cand of candidates) {
    const { state, reason } = decideActivation(cand);
    const id = deterministicIntentId(entryId, cand.sourceSpan.start, cand.kind);
    const intent = buildIntent({
      id,
      ownerId,
      entryId,
      kind: cand.kind,
      state,
      sourceSpan: cand.sourceSpan,
      attributes: cand.attributes,
      confidence: cand.confidence,
      activationReason: reason,
      targetAt: cand.targetAt ?? null,
      model: modelId,
    });
    batch.set(intentsCol.doc(id), intent);
    if (state === 'active' && cand.kind === 'task') activeTaskIntents.push(intent);
  }

  // Version marker in the same batch: latches only on a successful commit.
  batch.set(entryRef, { processing: { intentsExtractedForVersion: inputVersion } }, { merge: true });
  await batch.commit();

  return { ran: true, extractedTasks: toLegacyTasks(activeTaskIntents) };
}

export default {
  extractIntentCandidates,
  runIntentExtraction,
  normalizeCandidates,
  parseCandidatesResponse,
  deterministicIntentId,
};
