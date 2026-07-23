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
import {
  INTENT_KINDS,
  INTENT_ATTRIBUTE_KEYS,
  ASSERTION_TENSES,
  buildIntent,
  deriveAssertion,
  isValidIsoOrNull,
} from './intentSchema.js';
import { decideActivation } from './activationPolicy.js';
import { getServerFlag } from '../shared/flags.js';

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
- tense: one of ${ASSERTION_TENSES.join(', ')} — tense of the assertion relative to writing time; 'recurring' for habitual statements; 'unknown' if unclear

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
      // tense is the only model-authoritative slice of the typed assertion —
      // never reject a candidate for a bad/missing value, just default it.
      tense: ASSERTION_TENSES.includes(cand.tense) ? cand.tense : 'unknown',
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
export async function extractIntentCandidates({ apiKey, entry, modelId, callModel = defaultGeminiJsonCall } = {}) {
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
 * Single shared read of this entry's existing intent docs, keyed by id. Feeds
 * BOTH the dismissal-preservation check and the stale-intent reap below so a
 * re-extraction never issues more than one `where(entryId==)` query.
 */
async function readExistingIntentsById(intentsCol, entryId) {
  const byId = new Map();
  try {
    const snap = await intentsCol.where('entryId', '==', entryId).get();
    snap.forEach((doc) => byId.set(doc.id, doc.data() || {}));
  } catch {
    // best-effort; treat as no existing docs when the read fails
  }
  return byId;
}

const DISMISSAL_STATES = new Set(['dismissed', 'completed_state']);
const DISMISSAL_DECISION_ACTIONS = new Set(['not_a_task', 'dismissed']);

// Firestore caps an `in` filter at 30 values — chunk any larger id list.
const FIRESTORE_IN_LIMIT = 30;

/**
 * Resolve, for a batch of ids, which ones have a user_decisions entry with a
 * dismissal-shaped action (`not_a_task`/`dismissed`). Issues exactly ONE query
 * (or one per 30-id chunk, Firestore's `in` limit) for the WHOLE batch — never
 * a per-id query — so the preservation check below never becomes an N+1 read.
 */
async function fetchDismissalDecisionIds(decisionsCol, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += FIRESTORE_IN_LIMIT) {
    const chunk = ids.slice(i, i + FIRESTORE_IN_LIMIT);
    try {
      const snap = await decisionsCol.where('targetId', 'in', chunk).get();
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if (DISMISSAL_DECISION_ACTIONS.has(d.action)) found.add(d.targetId);
      });
    } catch {
      // best-effort; a failed chunk simply yields no matches for those ids
    }
  }
  return found;
}

/**
 * A dismissed/completed loop must never be silently resurrected by a later
 * re-extraction — "a dismissed loop/task can only return if the user
 * explicitly restores it." The existing doc's own `state` is the primary
 * signal (cheap: already in hand from `readExistingIntentsById`); the
 * `dismissedDecisionIds` set (from ONE shared `fetchDismissalDecisionIds` call
 * covering every candidate in this run) is only consulted as a fallback when
 * the state alone doesn't already confirm it (e.g. a doc left in some other
 * state by a prior decision that hasn't propagated to `state` yet).
 */
function shouldPreserveDismissal(existingDoc, id, dismissedDecisionIds) {
  if (!existingDoc) return false; // brand-new id: nothing to preserve
  if (DISMISSAL_STATES.has(existingDoc.state)) return true;
  return dismissedDecisionIds.has(id);
}

/**
 * Reap intents left behind by an earlier extraction of this entry at an OLDER
 * inputVersion. A user edit that shifts spans mints NEW deterministic ids, so
 * the old-version docs (including a possibly-active one) would otherwise linger
 * and render as phantom tasks. For each stale doc: hard-DELETE it, unless a
 * user_decision references its id — in which case retire it to `superseded`
 * (never delete something a decision audit points at). Mutates `batch`.
 */
async function reapStaleIntents(batch, intentsCol, decisionsCol, inputVersion, writtenIds, existingById) {
  const stale = [];
  for (const [id, d] of existingById) {
    // Skip ids this run already wrote/merged (a span that didn't shift keeps
    // its id and was just refreshed to the new version) — never write the same
    // doc twice in one batch.
    if (writtenIds.has(id)) continue;
    if ((d.inputVersion ?? 0) < inputVersion) stale.push(id);
  }
  for (const id of stale) {
    let referenced = false;
    try {
      const dref = await decisionsCol.where('targetId', '==', id).get();
      referenced = (dref.size ?? 0) > 0;
    } catch {
      referenced = false;
    }
    if (referenced) {
      batch.set(intentsCol.doc(id), { state: 'superseded', updatedAt: new Date().toISOString() }, { merge: true });
    } else {
      batch.delete(intentsCol.doc(id));
    }
  }
}

/**
 * Full extraction pass for one entry. Idempotent via deterministic intent IDs
 * plus a versioned dedup marker (`processing.intentsExtractedForVersion`)
 * committed in the SAME batch as the intents, so it only latches on success and
 * a transient failure can be retried. The same batch reaps stale-version
 * intents (orphan reap) so an edited entry never leaves phantom tasks live.
 *
 * Abstain candidates are persisted ONLY when the server flag
 * `intentAbstainAudit` is on (default off) — the widget never reads abstains,
 * so by default we do not grow the collection with silent context. Active and
 * suggested intents are always persisted.
 *
 * @returns {Promise<{ran:boolean, extractedTasks:Array}>}  extractedTasks is the
 *   legacy-compat active-task list for the orchestrator to publish.
 */
export async function runIntentExtraction({ db, entryRef, entry, modelId, apiKey, extractCandidates = extractIntentCandidates }) {
  const inputVersion = entry?.entryInputVersion ?? 0;
  const entryId = entry?.id || entryRef?.id;
  const ownerId = entryRef?.parent?.parent?.id;
  const intentsCol = entryRef.parent.parent.collection('intents');
  const decisionsCol = entryRef.parent.parent.collection('user_decisions');

  // Dedup: already extracted for this exact version -> rebuild the compat list
  // from stored intents rather than re-calling the model.
  if (entry?.processing?.intentsExtractedForVersion === inputVersion) {
    const existing = await readExistingActiveTaskIntents(intentsCol, entryId);
    return { ran: false, extractedTasks: toLegacyTasks(existing) };
  }

  const persistAbstain = await getServerFlag(db, 'intentAbstainAudit', false);
  const candidates = await extractCandidates({ apiKey, entry, modelId });

  // Single shared read of this entry's existing intents — serves both the
  // dismissal-preservation check below and the stale-intent reap.
  const existingById = await readExistingIntentsById(intentsCol, entryId);

  // Pass 1: decide activation + look up each candidate's existing doc (if
  // any). Collect the ids whose existing state alone does NOT already confirm
  // a dismissal — only those need the user_decisions fallback.
  const writtenIds = new Set();
  const evaluated = [];
  const needsDecisionCheck = new Set();
  for (const cand of candidates) {
    let { state, reason } = decideActivation(cand);
    let targetAt = cand.targetAt ?? null;

    // I3 (targetAt canonicalization): a model-produced targetAt that isn't a
    // real, parseable ISO-8601 instant (buildIntent's validateIsoOrNull) must
    // never reach buildIntent as-is. An open_loop's entire due-surfacing
    // mechanism (subscribeDueOpenLoops) is a `targetAt` range query, so an
    // unparseable due time must NEVER activate — force it to abstain outright
    // rather than let a broken/missing due date slip through as "active".
    // Any other kind doesn't gate its surfacing on targetAt, so it simply
    // loses the bad value and proceeds through the normal activation
    // decision unaffected.
    if (!isValidIsoOrNull(targetAt)) {
      if (cand.kind === 'open_loop') {
        state = 'abstain';
        reason = 'invalid-targetAt';
      }
      targetAt = null;
    }

    // Silent context (abstain) is only persisted under the audit flag.
    if (state === 'abstain' && !persistAbstain) continue;
    const id = deterministicIntentId(entryId, cand.sourceSpan.start, cand.kind);
    writtenIds.add(id);
    const existingDoc = existingById.get(id);
    if (existingDoc && !DISMISSAL_STATES.has(existingDoc.state)) needsDecisionCheck.add(id);
    evaluated.push({ cand, state, reason, id, existingDoc, targetAt });
  }

  // ONE shared decisions query (chunked at 30) covers every candidate in this
  // run — never a per-candidate read.
  const dismissedDecisionIds = await fetchDismissalDecisionIds(decisionsCol, [...needsDecisionCheck]);

  // Pass 2: build the batch writes using the resolved preservation set.
  const batch = db.batch();
  const activeTaskIntents = [];
  for (const { cand, state, reason, id, existingDoc, targetAt } of evaluated) {
    if (shouldPreserveDismissal(existingDoc, id, dismissedDecisionIds)) {
      // Dismissed/completed is user-terminal: never overwrite state or
      // user-set fields here — only bump the reap-relevant version marker so
      // the reaper above never treats this doc as stale.
      batch.set(intentsCol.doc(id), { inputVersion, updatedAt: new Date().toISOString() }, { merge: true });
      continue;
    }

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
      targetAt,
      model: modelId,
      inputVersion,
      assertion: deriveAssertion(cand.kind, cand.attributes, { tense: cand.tense }),
    });
    batch.set(intentsCol.doc(id), intent);
    if (state === 'active' && cand.kind === 'task') activeTaskIntents.push(intent);
  }

  // Reap intents from any earlier (older-version) extraction of this entry.
  await reapStaleIntents(batch, intentsCol, decisionsCol, inputVersion, writtenIds, existingById);

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
