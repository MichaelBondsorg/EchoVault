/**
 * Recipe run engine + reflection block editing (R2 Task 16).
 *
 * A "recipe run" turns a `recipes/{id}` definition into a `reflections/{id}`
 * doc: one `type:'ai'` block per recipe question, each carrying the real
 * source entry ids Ask Journal actually used (receipts), never a
 * fabricated/empty list.
 *
 * Pipeline (binding order, each step narrows the candidate pool):
 *   1. `filterEntriesByScope(entries, recipe.scope)` — Context Space seam.
 *   2. Date range: `timeRangeDays` back from "now", inclusive.
 *   3. Drop `getExcludedEntryIds(db, uid)` — source-exclusion seam.
 *   4. Per question: `askJournalAI(filtered, question, qEmbedding, recipe.scope, {returnSources:true})`.
 *
 * The filtered-and-scoped pool is passed into `askJournalAI` (which itself
 * re-applies `filterEntriesByScope` internally via `getSmartChatContext`).
 * That's intentional, not redundant: it's the same "strict filter at every
 * retrieval seam" defense-in-depth the codebase already uses everywhere
 * else (see `scopeFilter.js`'s doc comment) — even though the entries are
 * already scoped by the time they reach `askJournalAI` here, a future
 * caller of `askJournalAI` must not be able to accidentally skip scoping by
 * relying on an upstream filter it doesn't own.
 *
 * Insight Budget does NOT gate recipe runs. A recipe run is a user-initiated
 * pull (the user tapped "Run"), exactly like Ask Journal chat — not a
 * proactive home-surface insight — so `insightBudget.js`'s daily/weekly cap
 * does not apply here, matching the plan's explicit scoping of that budget
 * to proactive surfaces only. Consent is enforced server-side by the
 * `askJournalAI` Cloud Function (`assertAiConsent`) — this module has no
 * client-side consent check of its own, by design; it defers entirely to
 * the existing gate `askJournalAI`/`askJournalAIFn` already enforce.
 *
 * Embeddings: `runRecipe` does NOT generate embeddings itself. Callers pass
 * a pre-computed `{[question]: number[]}` map (mirroring the
 * `generateEmbedding(text)` call UnifiedConversation.jsx makes before its
 * own Ask Journal call) — this keeps `runRecipe` free of a direct Cloud
 * Function dependency for embedding generation and makes it straightforward
 * to unit test without mocking that seam too. A missing/omitted embedding
 * for a question just means that question's `askJournalAI` call skips
 * semantic matching (tag/recency matching still applies) — never an error.
 */
import { filterEntriesByScope } from '../spaces/scopeFilter';
import { getExcludedEntryIds } from '../insights/sourceExclusions';
import { askJournalAI } from '../analysis';
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  addDoc,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

function reflectionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/reflections`;
}

function nowIso() {
  return new Date().toISOString();
}

function newBlockId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `block_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function entryDate(entry) {
  return toDate(entry?.effectiveDate || entry?.createdAt);
}

/**
 * `timeRangeDays` back from `now`, inclusive on both ends.
 * @returns {{start: Date, end: Date}}
 */
function computeDateRange(timeRangeDays, now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - timeRangeDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

function isWithinRange(date, start, end) {
  if (!date) return false;
  return date >= start && date <= end;
}

function filterByDateRange(entries, start, end) {
  return entries.filter((e) => isWithinRange(entryDate(e), start, end));
}

/**
 * Preview exactly what a recipe run will use, WITHOUT running it — no
 * network/db calls, pure function of its inputs (PRD: "preview exactly
 * what will be used before first run").
 *
 * @param {{scope:{spaceId:string}|null, timeRangeDays:number}} recipe
 * @param {Array} entries - Candidate entries (pre-scope-filter, same pool
 *   the real run would receive).
 * @param {Set<string>} [exclusions] - Excluded entry ids, e.g. from
 *   `getExcludedEntryIds` (caller fetches this once and passes it in — kept
 *   out of this function to preserve purity/testability).
 * @param {Array<{id:string, name:string}>} [spaces] - Known spaces, for
 *   resolving `recipe.scope.spaceId` to a display name. Optional: with no
 *   match (or omitted), a scoped recipe falls back to showing the raw
 *   spaceId rather than silently mislabeling it "All spaces".
 * @returns {{entryCount:number, start:string, end:string, spaceName:string}}
 *   `start`/`end` are ISO strings, matching the `period` shape `runRecipe`
 *   writes to the reflection doc.
 */
export function previewRecipe(recipe, entries, exclusions = new Set(), spaces = []) {
  const scope = recipe?.scope ?? null;
  const scoped = filterEntriesByScope(entries || [], scope);
  const { start, end } = computeDateRange(recipe.timeRangeDays);
  const inRange = filterByDateRange(scoped, start, end);
  const kept = inRange.filter((e) => !exclusions?.has?.(e.id));

  const spaceName = scope?.spaceId
    ? (spaces.find((s) => s.id === scope.spaceId)?.name ?? scope.spaceId)
    : 'All spaces';

  return {
    entryCount: kept.length,
    start: start.toISOString(),
    end: end.toISOString(),
    spaceName,
  };
}

/**
 * Run a recipe: scope → date-range → exclusions → per-question
 * `askJournalAI`, then write a `reflections/{id}` doc.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{id:string, name:string, questions:string[], scope:{spaceId:string}|null, timeRangeDays:number, definitionVersion:number}} recipe
 * @param {{entries?:Array, embeddings?:Record<string, number[]>}} [options]
 *   `entries` — the full candidate pool (pre-scope-filter). `embeddings` —
 *   pre-computed `{[questionText]: embeddingVector}` map, see module doc.
 * @returns {Promise<object>} the created reflection, `{id, ...payload}`
 */
export async function runRecipe(db, uid, recipe, { entries = [], embeddings = {} } = {}) {
  if (!recipe || !Array.isArray(recipe.questions) || recipe.questions.length === 0) {
    throw new Error('runRecipe: recipe with at least one question is required.');
  }

  const scope = recipe.scope ?? null;
  const scoped = filterEntriesByScope(entries, scope);
  const { start, end } = computeDateRange(recipe.timeRangeDays);
  const inRange = filterByDateRange(scoped, start, end);

  const excludedIds = await getExcludedEntryIds(db, uid);
  const filtered = inRange.filter((e) => !excludedIds.has(e.id));

  const blocks = [];
  for (const question of recipe.questions) {
    const qEmbedding = embeddings?.[question] ?? null;
    if (qEmbedding == null) {
      // eslint-disable-next-line no-console -- intentional degrade signal, see module doc.
      console.warn('[runRecipe] no embedding for question — retrieval degrades to recency/tags:', question.slice(0, 40));
    }
    // eslint-disable-next-line no-await-in-loop -- questions must run
    // sequentially against the same filtered pool; no shared mutable state
    // to race, but the Cloud Function calls are not parallelized here to
    // keep behavior easy to reason about/test (small, bounded question
    // counts — rules cap recipes at 5 questions).
    const { text, entryIds } = await askJournalAI(filtered, question, qEmbedding, scope, { returnSources: true });
    blocks.push({
      id: newBlockId(),
      type: 'ai',
      question,
      text: text ?? null,
      sources: entryIds ?? [],
      editedByUser: false,
    });
  }

  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const payload = {
    kind: 'recipe_run',
    recipeId: recipe.id,
    definitionVersion: recipe.definitionVersion,
    scope,
    period: { start: start.toISOString(), end: end.toISOString() },
    title: `${recipe.name} — ${monthYear}`,
    blocks,
    status: 'draft',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const docRef = await addDoc(collection(db, reflectionsPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

async function loadReflection(db, uid, reflectionId) {
  const snap = await getDoc(doc(db, reflectionsPath(uid), reflectionId));
  if (!snap.exists()) {
    throw new Error(`Reflection ${reflectionId} not found.`);
  }
  return { id: snap.id, ...snap.data() };
}

async function writeBlocks(db, uid, reflectionId, blocks) {
  const updatedAt = nowIso();
  await updateDoc(doc(db, reflectionsPath(uid), reflectionId), { blocks, updatedAt });
  return { blocks, updatedAt };
}

/**
 * Edit a block's text. AI blocks (`type:'ai'`) get `editedByUser:true` and
 * KEEP their `sources` (the receipt is still valid — only the wording
 * changed). User blocks keep whatever `sources`/`editedByUser` they already
 * have (they're already user-authored from creation).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} reflectionId
 * @param {string} blockId
 * @param {{text:string}} updates
 * @returns {Promise<object>} the updated reflection
 */
export async function updateBlock(db, uid, reflectionId, blockId, { text } = {}) {
  const reflection = await loadReflection(db, uid, reflectionId);
  let found = false;
  const blocks = (reflection.blocks || []).map((b) => {
    if (b.id !== blockId) return b;
    found = true;
    return {
      ...b,
      text,
      editedByUser: b.type === 'ai' ? true : b.editedByUser,
    };
  });
  if (!found) {
    throw new Error(`Block ${blockId} not found on reflection ${reflectionId}.`);
  }
  const { updatedAt } = await writeBlocks(db, uid, reflectionId, blocks);
  return { ...reflection, blocks, updatedAt };
}

/**
 * Append a user-authored note block. Always `type:'user'`, `sources:[]` —
 * user blocks never carry AI receipts.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} reflectionId
 * @param {string} text
 * @returns {Promise<object>} the updated reflection
 */
export async function addUserBlock(db, uid, reflectionId, text) {
  const reflection = await loadReflection(db, uid, reflectionId);
  const block = { id: newBlockId(), type: 'user', text: text ?? '', sources: [], editedByUser: false };
  const blocks = [...(reflection.blocks || []), block];
  const { updatedAt } = await writeBlocks(db, uid, reflectionId, blocks);
  return { ...reflection, blocks, updatedAt };
}

/**
 * Remove a block (AI or user) from a reflection.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} reflectionId
 * @param {string} blockId
 * @returns {Promise<object>} the updated reflection
 */
export async function removeBlock(db, uid, reflectionId, blockId) {
  const reflection = await loadReflection(db, uid, reflectionId);
  const blocks = (reflection.blocks || []).filter((b) => b.id !== blockId);
  const { updatedAt } = await writeBlocks(db, uid, reflectionId, blocks);
  return { ...reflection, blocks, updatedAt };
}

/**
 * Reorder blocks to match `orderedBlockIds` (must be a permutation of the
 * reflection's current block ids).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} reflectionId
 * @param {string[]} orderedBlockIds
 * @returns {Promise<object>} the updated reflection
 */
export async function reorderBlocks(db, uid, reflectionId, orderedBlockIds) {
  const reflection = await loadReflection(db, uid, reflectionId);
  const current = reflection.blocks || [];
  const byId = new Map(current.map((b) => [b.id, b]));
  const isPermutation = Array.isArray(orderedBlockIds)
    && orderedBlockIds.length === current.length
    && orderedBlockIds.every((id) => byId.has(id));
  if (!isPermutation) {
    throw new Error('reorderBlocks: orderedBlockIds must be a permutation of the reflection\'s current block ids.');
  }
  const blocks = orderedBlockIds.map((id) => byId.get(id));
  const { updatedAt } = await writeBlocks(db, uid, reflectionId, blocks);
  return { ...reflection, blocks, updatedAt };
}

export default {
  previewRecipe,
  runRecipe,
  updateBlock,
  addUserBlock,
  removeBlock,
  reorderBlocks,
};
