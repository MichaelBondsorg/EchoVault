/**
 * Client Context Spaces service (Trustworthy Capture plan, task 8).
 *
 * Client CRUD + starter-seed + archive/reassign flow over user-defined
 * "spaces" (e.g. Personal / Work / Family) used to scope journal entries.
 * Journal content is never deleted by any operation here: spaces are
 * archived (never client-deleted, per firestore.rules), and reassigning
 * entries away from an archived space only ever touches the entry's
 * `spaceId` + `updatedAt` fields.
 *
 * Storage:
 *   artifacts/{APP}/users/{uid}/spaces/{autoId}          {name, state, createdAt, updatedAt}
 *   artifacts/{APP}/users/{uid}/entries/{id}              (spaceId field only, reassigned)
 *   artifacts/{APP}/users/{uid}/settings/spacePrefs       {lastCaptureSpaceId, updatedAt}
 *
 * firestore.rules require spaces docs to hasOnly(['name','state','createdAt','updatedAt']),
 * name <= 40 chars, state in ['active','archived']; settings/spacePrefs
 * hasOnly(['lastCaptureSpaceId','updatedAt']). Every payload built here
 * matches those shapes exactly.
 */
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

const MAX_NAME_LENGTH = 40;
const STARTER_SPACE_NAMES = ['Personal', 'Work', 'Family', 'Health'];

function spacesPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/spaces`;
}

function entriesPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/entries`;
}

function settingsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/settings`;
}

function nowIso() {
  return new Date().toISOString();
}

/** Trim + validate a space name against the firestore.rules shape (<=40 chars, non-empty). */
function normalizeSpaceName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('Space name is required.');
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Space name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Subscribe to the user's active spaces, alphabetical by name. Returns the
 * onSnapshot unsubscribe function.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(spaces:Array)=>void} cb  called with [{ id, ...data }]
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeSpaces(db, uid, cb, onError) {
  const q = query(
    collection(db, spacesPath(uid)),
    where('state', '==', 'active'),
    orderBy('name', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const spaces = [];
      snap.forEach((d) => spaces.push({ id: d.id, ...d.data() }));
      cb(spaces);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Create a new active space.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} name  trimmed; rejected if empty or over 40 characters
 * @returns {Promise<{id:string, name:string, state:'active', createdAt:string, updatedAt:string}>}
 */
export async function createSpace(db, uid, name) {
  const trimmed = normalizeSpaceName(name);
  const now = nowIso();
  const payload = { name: trimmed, state: 'active', createdAt: now, updatedAt: now };
  const docRef = await addDoc(collection(db, spacesPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

/**
 * Rename an existing space.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string} name  trimmed; rejected if empty or over 40 characters
 */
export async function renameSpace(db, uid, id, name) {
  const trimmed = normalizeSpaceName(name);
  await updateDoc(doc(db, spacesPath(uid), id), { name: trimmed, updatedAt: nowIso() });
}

/**
 * Archive a space (never deleted — firestore.rules forbid delete on this
 * collection). Entries already assigned to it are left untouched here; the
 * archive UI flow separately offers {@link reassignEntriesSpace}.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 */
export async function archiveSpace(db, uid, id) {
  await updateDoc(doc(db, spacesPath(uid), id), { state: 'archived', updatedAt: nowIso() });
}

/**
 * Create the starter spaces (Personal/Work/Family/Health) the first time the
 * user opens Space management, but ONLY if they have zero spaces of any
 * state (active or archived). Never fires automatically — callers must only
 * invoke this from that explicit entry point.
 *
 * NOT wrapped in `runTransaction`: the modular Firestore Web SDK's
 * `Transaction.get()` only accepts a `DocumentReference` (see
 * `@firebase/firestore/dist/index.d.ts`), not a `Query`/`CollectionReference`
 * — so the "is this collection empty" check this function needs cannot run
 * inside a transaction at all. The check-then-write here is therefore
 * inherently racy across concurrent calls (two simultaneous "open Space
 * management for the first time" calls could both see zero docs and both
 * seed), same as `firestore.rules` can enforce structurally (docs
 * hasOnly(...)) but not exclusively. Acceptable: this only runs from a
 * single explicit, rare, user-initiated entry point, and duplicate starter
 * spaces are a minor annoyance (renameable/archivable), not data loss.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<number>} count of spaces created (0 or 4)
 */
export async function seedStarterSpaces(db, uid) {
  const snap = await getDocs(collection(db, spacesPath(uid)));
  if (snap.docs.length > 0) {
    return 0;
  }

  const now = nowIso();
  const batch = writeBatch(db);
  const collectionRef = collection(db, spacesPath(uid));
  for (const name of STARTER_SPACE_NAMES) {
    const ref = doc(collectionRef);
    batch.set(ref, { name, state: 'active', createdAt: now, updatedAt: now });
  }
  await batch.commit();
  return STARTER_SPACE_NAMES.length;
}

/**
 * Reassign every entry currently scoped to `fromSpaceId` to `toSpaceIdOrNull`
 * (null = "Keep unscoped"), in batches. Only `{spaceId, updatedAt}` is ever
 * written — the entry's content (createdAt, effectiveDate, transcription,
 * etc.) is never touched. Used by the archive flow's Move entries /
 * Keep unscoped choice.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} fromSpaceId
 * @param {string|null} toSpaceIdOrNull
 * @param {{batchSize?:number}} [options]
 * @returns {Promise<number>} total entries updated
 */
export async function reassignEntriesSpace(db, uid, fromSpaceId, toSpaceIdOrNull, { batchSize = 200 } = {}) {
  // Guard: a self-reassign (from === to, null-safe via strict equality) would
  // write {spaceId: fromSpaceId, ...} onto docs that already match
  // where('spaceId','==',fromSpaceId) — a no-op update that never removes
  // them from the next page's filter, so the loop below would run forever
  // (and re-write the same docs) once matches >= batchSize. Short-circuit
  // before any query/write.
  if (fromSpaceId === toSpaceIdOrNull) {
    return 0;
  }

  let total = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const q = query(
      collection(db, entriesPath(uid)),
      where('spaceId', '==', fromSpaceId),
      limit(batchSize),
    );
    const snap = await getDocs(q);
    const docs = snap.docs;
    if (docs.length === 0) break;

    const now = nowIso();
    const batch = writeBatch(db);
    docs.forEach((d) => {
      batch.update(doc(db, entriesPath(uid), d.id), { spaceId: toSpaceIdOrNull, updatedAt: now });
    });
    await batch.commit();
    total += docs.length;

    if (docs.length < batchSize) break;
  }

  return total;
}

/**
 * Read the last space used for capture (settings/spacePrefs doc).
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<string|null>} null when the pref doc doesn't exist, or
 *   the field is missing
 */
export async function getLastCaptureSpaceId(db, uid) {
  const snap = await getDoc(doc(db, settingsPath(uid), 'spacePrefs'));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data?.lastCaptureSpaceId ?? null;
}

/**
 * Persist the last space used for capture (settings/spacePrefs doc, merged).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string|null} spaceIdOrNull
 */
export async function setLastCaptureSpaceId(db, uid, spaceIdOrNull) {
  await setDoc(
    doc(db, settingsPath(uid), 'spacePrefs'),
    { lastCaptureSpaceId: spaceIdOrNull, updatedAt: nowIso() },
    { merge: true },
  );
}

export default {
  subscribeSpaces,
  createSpace,
  renameSpace,
  archiveSpace,
  seedStarterSpaces,
  reassignEntriesSpace,
  getLastCaptureSpaceId,
  setLastCaptureSpaceId,
};
