/**
 * Client intent service (PRD 0B, plan task I4).
 *
 * Typed reads/updates over the precision-first intent system. The server owns
 * creation and the activation decision; the client may only make the narrow set
 * of transitions the firestore.rules `intents` block permits (keep / dismiss /
 * complete), each paired with an append to `user_decisions` for a reversible
 * audit trail.
 *
 * Storage:
 *   artifacts/{APP}/users/{uid}/intents/{id}
 *   artifacts/{APP}/users/{uid}/user_decisions/{autoId}
 */
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  addDoc,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

function intentsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/intents`;
}

function decisionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/user_decisions`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Subscribe to the user's policy-qualified ACTIVE task intents (newest first,
 * capped at 20). Returns the onSnapshot unsubscribe function.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(intents:Array)=>void} cb  called with [{ id, ...data }]
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeActiveTaskIntents(db, uid, cb, onError) {
  const q = query(
    collection(db, intentsPath(uid)),
    where('kind', '==', 'task'),
    where('state', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const intents = [];
      snap.forEach((d) => intents.push({ id: d.id, ...d.data() }));
      cb(intents);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Subscribe to due open-loop intents (targetAt <= now, capped at 20, ascending
 * so the soonest-overdue leads). `now` is captured once at subscribe time; the
 * caller (widget) resubscribes on mount/foreground to refresh it. Docs whose
 * `snoozedUntil` is still in the future (relative to that same `now`) are
 * dropped client-side rather than filtered server-side.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(intents:Array)=>void} cb
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeDueOpenLoops(db, uid, cb, onError) {
  const now = nowIso();
  const q = query(
    collection(db, intentsPath(uid)),
    where('kind', '==', 'open_loop'),
    where('state', '==', 'active'),
    where('targetAt', '<=', now),
    orderBy('targetAt', 'asc'),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const intents = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.snoozedUntil && data.snoozedUntil > now) return;
        intents.push({ id: d.id, ...data });
      });
      cb(intents);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Subscribe to upcoming (not-yet-due) open-loop intents for the full-queue
 * view. Same shape as {@link subscribeDueOpenLoops} but `targetAt > now`, and
 * no client-side snooze filtering (the whole queue is shown here).
 *
 * @param {object} db
 * @param {string} uid
 * @param {(intents:Array)=>void} cb
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeUpcomingOpenLoops(db, uid, cb, onError) {
  const now = nowIso();
  const q = query(
    collection(db, intentsPath(uid)),
    where('kind', '==', 'open_loop'),
    where('state', '==', 'active'),
    where('targetAt', '>', now),
    orderBy('targetAt', 'asc'),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const intents = [];
      snap.forEach((d) => intents.push({ id: d.id, ...d.data() }));
      cb(intents);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Subscribe to suggested intents extracted from a single entry (the entry's
 * suggestion tray). No orderBy/limit: the result set per entry is tiny.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} entryId
 * @param {(intents:Array)=>void} cb
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeSuggestedIntentsForEntry(db, uid, entryId, cb, onError) {
  const q = query(
    collection(db, intentsPath(uid)),
    where('entryId', '==', entryId),
    where('state', '==', 'suggested'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const intents = [];
      snap.forEach((d) => intents.push({ id: d.id, ...d.data() }));
      cb(intents);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Subscribe to the most recently created active intents of any kind, for the
 * "Captured" row (newest first, capped at 5).
 *
 * @param {object} db
 * @param {string} uid
 * @param {(intents:Array)=>void} cb
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeRecentActiveIntents(db, uid, cb, onError) {
  const q = query(
    collection(db, intentsPath(uid)),
    where('state', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(5),
  );
  return onSnapshot(
    q,
    (snap) => {
      const intents = [];
      snap.forEach((d) => intents.push({ id: d.id, ...d.data() }));
      cb(intents);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/** Append a reversible user_decisions record. Shape matches firestore.rules. */
async function appendDecision(db, uid, { targetId, action, reasonCode = null }) {
  await addDoc(collection(db, decisionsPath(uid)), {
    targetId,
    targetType: 'intent',
    action,
    reasonCode: reasonCode ?? null,
    createdAt: nowIso(),
    reversible: true,
  });
}

/** Keep a suggested intent: suggested -> active (+ 'kept' decision). */
export async function keepIntent(db, uid, id) {
  await updateDoc(doc(db, intentsPath(uid), id), { state: 'active', updatedAt: nowIso() });
  await appendDecision(db, uid, { targetId: id, action: 'kept' });
}

/** Dismiss an intent: any -> dismissed (+ 'not_a_task' decision). */
export async function dismissIntent(db, uid, id, reasonCode = null) {
  await updateDoc(doc(db, intentsPath(uid), id), { state: 'dismissed', updatedAt: nowIso() });
  await appendDecision(db, uid, { targetId: id, action: 'not_a_task', reasonCode });
}

/** Complete an active intent: active -> completed_state (+ 'completed' decision). */
export async function completeIntent(db, uid, id) {
  await updateDoc(doc(db, intentsPath(uid), id), { state: 'completed_state', updatedAt: nowIso() });
  await appendDecision(db, uid, { targetId: id, action: 'completed' });
}

/**
 * Snooze an open loop until a future instant: no state change, just
 * `snoozedUntil` (+ a reversible 'snoozed' decision). Client-filtered out of
 * {@link subscribeDueOpenLoops} until that instant passes.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string} untilIso
 */
export async function snoozeLoop(db, uid, id, untilIso) {
  await updateDoc(doc(db, intentsPath(uid), id), { snoozedUntil: untilIso, updatedAt: nowIso() });
  await appendDecision(db, uid, { targetId: id, action: 'snoozed' });
}

/**
 * Close an open loop because it was answered by another entry: active ->
 * completed_state, with `outcome.kind = 'answered'` (+ 'answered' decision).
 * Writes only the intent doc — the source entry (answerEntryId just records
 * its id) is never touched.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string|null} [answerEntryId]
 */
export async function answerLoop(db, uid, id, answerEntryId = null) {
  const closedAt = nowIso();
  await updateDoc(doc(db, intentsPath(uid), id), {
    state: 'completed_state',
    outcome: { closedAt, kind: 'answered', answerEntryId },
    updatedAt: closedAt,
  });
  await appendDecision(db, uid, { targetId: id, action: 'answered' });
}

/**
 * Close an open loop with no answering entry (user closed it directly):
 * active -> completed_state, with `outcome.kind = 'closed'` (+ 'closed'
 * decision).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 */
export async function closeLoop(db, uid, id) {
  const closedAt = nowIso();
  await updateDoc(doc(db, intentsPath(uid), id), {
    state: 'completed_state',
    outcome: { closedAt, kind: 'closed', answerEntryId: null },
    updatedAt: closedAt,
  });
  await appendDecision(db, uid, { targetId: id, action: 'closed' });
}

/**
 * Set/clear the user-authored free-text note on an intent. No state change
 * and no decision record: this is metadata editing, not a lifecycle action.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string|null} text
 */
export async function setIntentUserText(db, uid, id, text) {
  await updateDoc(doc(db, intentsPath(uid), id), { userText: text, updatedAt: nowIso() });
}

export default {
  subscribeActiveTaskIntents,
  subscribeDueOpenLoops,
  subscribeUpcomingOpenLoops,
  subscribeSuggestedIntentsForEntry,
  subscribeRecentActiveIntents,
  keepIntent,
  dismissIntent,
  completeIntent,
  snoozeLoop,
  answerLoop,
  closeLoop,
  setIntentUserText,
};
