/**
 * Client Gentle Revisit service (R2 Task 19).
 *
 * Opt-in prefs + exclusions + the day's queued candidate. Candidate
 * SELECTION is entirely server-side (`functions/src/revisit/selectRevisits.js`,
 * flag `gentleRevisit`) — this module never writes a `revisit_queue` doc; it
 * only reads/subscribes to it and makes the narrow status transitions
 * firestore.rules allows (`shown`/`dismissed`).
 *
 * Storage:
 *   artifacts/{APP}/users/{uid}/settings/revisitPrefs   {enabled, optInAt, updatedAt}
 *   artifacts/{APP}/users/{uid}/revisit_exclusions/{id} {dimension, value, reason, permanent, createdAt, expiresAt}
 *   artifacts/{APP}/users/{uid}/revisit_queue/{id}      (server-written; client may read/delete/limited-update)
 *
 * firestore.rules shapes this module writes char-exact to:
 *   - settings/revisitPrefs: hasOnly(['enabled','optInAt','updatedAt']), enabled is bool.
 *   - revisit_exclusions create: hasOnly(['dimension','value','reason','permanent','createdAt','expiresAt']),
 *     dimension in ['entry','date','person','tag','space','family'],
 *     value is string, reason in ['never_show','less_like_this','hidden_dim'].
 *     NO update — delete is the only restore path (mirrors source_exclusions.js).
 *   - revisit_queue update: diff().affectedKeys() hasOnly(['status','updatedAt']),
 *     status in ['shown','dismissed'] — the server-written 'queued' status is
 *     never a client-writable target.
 *
 * `setRevisitEnabled(db, uid, false)` also deletes every `status=='queued'`
 * revisit_queue doc (PRD: disabling is an immediate cancel, not a fade-out).
 */
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  updateDoc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

const VALID_DIMENSIONS = ['entry', 'date', 'person', 'tag', 'space', 'family'];
const VALID_REASONS = ['never_show', 'less_like_this', 'hidden_dim'];

function settingsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/settings`;
}

function exclusionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/revisit_exclusions`;
}

function queuePath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/revisit_queue`;
}

function nowIso() {
  return new Date().toISOString();
}

function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocalDateString() {
  return localDateString(new Date());
}

/**
 * Device-local date ± 1 day, as three 'YYYY-MM-DD' strings (yesterday,
 * today, tomorrow). See `subscribeTodayRevisit`'s doc comment for why this
 * window exists.
 */
function toleranceDateWindow(now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return [localDateString(yesterday), localDateString(now), localDateString(tomorrow)];
}

/** Coerce a Firestore Timestamp/ISO-string/Date `selectedAt` to epoch ms (0 if missing/uncoercible). */
function selectedAtMs(item) {
  const v = item?.selectedAt;
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

/**
 * Opt a user in/out of Gentle Revisit. Preserves an existing `optInAt` across
 * repeat enable calls (first-opt-in timestamp, not "last enabled"); disabling
 * clears `optInAt`'s relevance by simply omitting it from the write (never
 * overwritten to null — `optInAt` is only ever set once, on first opt-in).
 *
 * Disabling is an IMMEDIATE cancel (PRD): every `status=='queued'`
 * revisit_queue doc is deleted in the same call, not left to expire.
 *
 * @param {object} db
 * @param {string} uid
 * @param {boolean} enabled
 */
export async function setRevisitEnabled(db, uid, enabled) {
  if (typeof enabled !== 'boolean') {
    throw new Error('setRevisitEnabled: enabled must be a boolean');
  }

  const prefsRef = doc(db, settingsPath(uid), 'revisitPrefs');

  if (enabled) {
    const existing = await getDoc(prefsRef);
    const payload = { enabled: true, updatedAt: nowIso() };
    if (!existing.exists() || !existing.data()?.optInAt) {
      payload.optInAt = nowIso();
    }
    await setDoc(prefsRef, payload, { merge: true });
    return;
  }

  await setDoc(prefsRef, { enabled: false, updatedAt: nowIso() }, { merge: true });

  const queuedQuery = query(collection(db, queuePath(uid)), where('status', '==', 'queued'));
  const queuedSnap = await getDocs(queuedQuery);
  if (queuedSnap.docs.length === 0) return;

  const batch = writeBatch(db);
  queuedSnap.docs.forEach((d) => {
    batch.delete(doc(db, queuePath(uid), d.id));
  });
  await batch.commit();
}

/**
 * Read the user's current revisitPrefs (for initial render before the
 * subscription-based UI, if any, takes over).
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<{enabled: boolean, optInAt: ?string}>} `enabled: false`
 *   when the doc doesn't exist (default off).
 */
export async function getRevisitPrefs(db, uid) {
  const snap = await getDoc(doc(db, settingsPath(uid), 'revisitPrefs'));
  if (!snap.exists()) return { enabled: false, optInAt: null };
  const data = snap.data() || {};
  return { enabled: data.enabled === true, optInAt: data.optInAt ?? null };
}

/**
 * Subscribe to today's revisit_queue doc, if any. The server job
 * (`runGentleRevisitDaily`, `functions/src/revisit/selectRevisits.js`)
 * stamps `dueDate` as an LA-LOCAL (`America/Los_Angeles`) 'YYYY-MM-DD' — job
 * cadence is intentionally LA-pinned, unchanged by this fix. A device
 * running far enough ahead of LA time (e.g. Australia/Sydney, UTC+10/11)
 * can see `dueDate` stamped "yesterday" relative to its own local calendar
 * day; a device far enough behind can see it stamped "tomorrow" — either
 * way, a strict `dueDate == deviceLocalToday` query would never match, and
 * the widget would silently never show a card for that device (Minor 3+6,
 * R2 final review).
 *
 * Fix: subscribe to a ±1-day window around the DEVICE's local date
 * (`dueDate IN [yesterday, today, tomorrow]`, all device-local) instead of
 * an exact match. At most one `revisit_queue` doc is expected per LA day by
 * construction, so more than one doc qualifying only happens right at the
 * ±1-day boundary — when that occurs, the most recently `selectedAt` doc
 * wins. No status filter here — a widget consuming this decides whether a
 * `dismissed` doc should still render (this service only surfaces what
 * exists).
 *
 * Server side is deliberately UNCHANGED: the job's LA-pinned cadence is by
 * design (see the module's own doc comment in `selectRevisits.js`), so the
 * tolerance lives entirely on the read side here.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(item: object|null) => void} cb
 * @param {(err: Error) => void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeTodayRevisit(db, uid, cb, onError) {
  const dates = toleranceDateWindow();
  const q = query(collection(db, queuePath(uid)), where('dueDate', 'in', dates));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) { cb(null); return; }
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => selectedAtMs(b) - selectedAtMs(a));
      cb(docs[0]);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Mark a revisit_queue item as shown (user clicked "Show"). Touches only
 * status/updatedAt, the only fields firestore.rules allows a client to
 * change on this collection.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} queueId
 */
export async function markShown(db, uid, queueId) {
  await updateDoc(doc(db, queuePath(uid), queueId), { status: 'shown', updatedAt: nowIso() });
}

/**
 * Dismiss a revisit_queue item ("Not now" — no exclusion recorded, just
 * closes today's card). Touches only status/updatedAt.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} queueId
 */
export async function dismissRevisit(db, uid, queueId) {
  await updateDoc(doc(db, queuePath(uid), queueId), { status: 'dismissed', updatedAt: nowIso() });
}

/**
 * Add a Gentle Revisit exclusion. Validates dimension/reason client-side
 * against the same allow-lists firestore.rules enforces, so a bad call fails
 * fast with a clear error instead of a bare permission-denied.
 *
 * `expiresAt` is omitted from the write entirely when not provided (no
 * null-stuffing, matching the codebase convention) — a permanent exclusion
 * (`permanent: true`) has no expiry; a temporary one (e.g. "Less like this",
 * Task 20) passes its own `expiresAt`.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{dimension: string, value: string, reason: string, permanent?: boolean, expiresAt?: ?string}} params
 * @returns {Promise<{id: string, dimension: string, value: string, reason: string, permanent: boolean, createdAt: string}>}
 */
export async function addRevisitExclusion(db, uid, { dimension, value, reason, permanent = false, expiresAt } = {}) {
  if (!VALID_DIMENSIONS.includes(dimension)) {
    throw new Error(`addRevisitExclusion: dimension must be one of ${VALID_DIMENSIONS.join(', ')}`);
  }
  if (typeof value !== 'string' || !value) {
    throw new Error('addRevisitExclusion: value is required and must be a string');
  }
  if (!VALID_REASONS.includes(reason)) {
    throw new Error(`addRevisitExclusion: reason must be one of ${VALID_REASONS.join(', ')}`);
  }

  const payload = {
    dimension,
    value,
    reason,
    permanent: !!permanent,
    createdAt: nowIso(),
  };
  if (expiresAt !== undefined) payload.expiresAt = expiresAt;

  const docRef = await addDoc(collection(db, exclusionsPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

/**
 * List all of the user's Gentle Revisit exclusions.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<Array<{id: string}>>}
 */
export async function listRevisitExclusions(db, uid) {
  const snap = await getDocs(collection(db, exclusionsPath(uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Remove (restore) a Gentle Revisit exclusion. Delete is the only restore
 * path — firestore.rules denies any update to this collection.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} exclusionId
 */
export async function removeRevisitExclusion(db, uid, exclusionId) {
  await deleteDoc(doc(db, exclusionsPath(uid), exclusionId));
}

export default {
  setRevisitEnabled,
  getRevisitPrefs,
  subscribeTodayRevisit,
  markShown,
  dismissRevisit,
  addRevisitExclusion,
  listRevisitExclusions,
  removeRevisitExclusion,
};
