/**
 * Reflection Recipes service (R2 Task 16).
 *
 * Client CRUD over user-defined, reusable question sets ("recipes") that
 * drive `recipe_run` reflections (see `runRecipe.js`). Mirrors the
 * `spacesService.js` pattern: `(db, uid, ...)` signatures, ISO-string
 * timestamps, `subscribeX(db, uid, cb, onError)` live listeners.
 *
 * Storage: artifacts/{APP}/users/{uid}/recipes/{autoId}
 *   {name, questions, scope, timeRangeDays, cadence:'manual', state, definitionVersion, createdAt, updatedAt}
 *
 * firestore.rules require the resulting doc to
 * `hasOnly(['name','questions','scope','timeRangeDays','cadence','state','definitionVersion','createdAt','updatedAt'])`,
 * `name.size() <= 60`, `questions is list && questions.size() <= 5`,
 * `state in ['active','archived']`, `cadence in ['manual']`. Every payload
 * built here matches that shape exactly (partial `updateDoc` writes are
 * safe against `hasOnly` because Firestore rules evaluate the FULL merged
 * document, not just the changed fields — same pattern as
 * `spacesService.renameSpace`/`archiveSpace`).
 *
 * `updateRecipe` ALWAYS bumps `definitionVersion`, even for cosmetic-only
 * edits. Reflections already generated under a prior version snapshot their
 * own `definitionVersion` and are NEVER touched by a recipe edit — this
 * module never reads or writes the `reflections` collection at all, so
 * "recipe edits never mutate prior reflections" holds structurally, not
 * just by convention.
 *
 * Recipes are archived, never deleted (mirrors spaces) — `archiveRecipe`
 * only flips `state`; existing `reflections` docs referencing the recipe's
 * id are left completely alone (delete cascade is out of scope for v1, and
 * the PRD explicitly requires archived recipes to keep their reflections).
 */
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

const MAX_NAME_LENGTH = 60;
const MAX_QUESTIONS = 5;
const VALID_TIME_RANGES = [7, 30, 90, 365];

function recipesPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/recipes`;
}

function nowIso() {
  return new Date().toISOString();
}

/** Trim + validate recipe fields against the firestore.rules shape. */
function normalizeRecipeInput({ name, questions, scope = null, timeRangeDays } = {}) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    throw new Error('Recipe name is required.');
  }
  if (trimmedName.length > MAX_NAME_LENGTH) {
    throw new Error(`Recipe name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Recipe must have at least one question.');
  }
  if (questions.length > MAX_QUESTIONS) {
    throw new Error(`Recipe may have at most ${MAX_QUESTIONS} questions.`);
  }
  if (!VALID_TIME_RANGES.includes(timeRangeDays)) {
    throw new Error(`timeRangeDays must be one of ${VALID_TIME_RANGES.join(', ')}.`);
  }
  return {
    name: trimmedName,
    questions: [...questions],
    scope: scope ?? null,
    timeRangeDays,
  };
}

/**
 * Subscribe to the user's active recipes, alphabetical by name. Returns the
 * onSnapshot unsubscribe function.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(recipes:Array)=>void} cb  called with [{ id, ...data }]
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeRecipes(db, uid, cb, onError) {
  const q = query(
    collection(db, recipesPath(uid)),
    where('state', '==', 'active'),
    orderBy('name', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const recipes = [];
      snap.forEach((d) => recipes.push({ id: d.id, ...d.data() }));
      cb(recipes);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Create a new active recipe at `definitionVersion: 1`.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{name:string, questions:string[], scope?:{spaceId:string}|null, timeRangeDays:7|30|90|365}} input
 * @returns {Promise<object>} the created recipe, `{id, ...payload}`
 */
export async function createRecipe(db, uid, input) {
  const normalized = normalizeRecipeInput(input);
  const now = nowIso();
  const payload = {
    ...normalized,
    cadence: 'manual',
    state: 'active',
    definitionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await addDoc(collection(db, recipesPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

/**
 * Update an existing recipe's definition. ALWAYS bumps `definitionVersion`
 * (even if the edit is purely cosmetic), because a recipe's
 * `definitionVersion` is the thing reflections snapshot to stay
 * reproducible/immutable — see module doc comment.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{id:string, name:string, questions:string[], scope:{spaceId:string}|null, timeRangeDays:number, definitionVersion:number}} recipe
 *   The full CURRENT recipe (as returned by `subscribeRecipes`/`createRecipe`) —
 *   required so the new `definitionVersion` can be derived from the current
 *   one without an extra read.
 * @param {{name?:string, questions?:string[], scope?:{spaceId:string}|null, timeRangeDays?:number}} updates
 *   Partial fields to change; omitted fields keep their current value.
 * @returns {Promise<object>} the updated recipe
 */
export async function updateRecipe(db, uid, recipe, updates = {}) {
  if (!recipe || !recipe.id) {
    throw new Error('updateRecipe: the current recipe (with id) is required.');
  }
  const normalized = normalizeRecipeInput({
    name: 'name' in updates ? updates.name : recipe.name,
    questions: 'questions' in updates ? updates.questions : recipe.questions,
    scope: 'scope' in updates ? updates.scope : recipe.scope,
    timeRangeDays: 'timeRangeDays' in updates ? updates.timeRangeDays : recipe.timeRangeDays,
  });
  const updatedAt = nowIso();
  const definitionVersion = (recipe.definitionVersion || 1) + 1;
  const payload = { ...normalized, definitionVersion, updatedAt };
  await updateDoc(doc(db, recipesPath(uid), recipe.id), payload);
  return { ...recipe, ...payload, id: recipe.id };
}

/**
 * Archive a recipe (never deleted). Existing `reflections` docs generated
 * from it are left completely untouched.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 */
export async function archiveRecipe(db, uid, id) {
  await updateDoc(doc(db, recipesPath(uid), id), { state: 'archived', updatedAt: nowIso() });
}

export default {
  subscribeRecipes,
  createRecipe,
  updateRecipe,
  archiveRecipe,
};
