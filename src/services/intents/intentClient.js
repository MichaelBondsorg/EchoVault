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

export default {
  subscribeActiveTaskIntents,
  keepIntent,
  dismissIntent,
  completeIntent,
};
