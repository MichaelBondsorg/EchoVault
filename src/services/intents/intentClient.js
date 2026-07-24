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
 *
 * INT-02 (atomic + failure-visible actions): every action below that pairs an
 * intent-state change with a user_decisions append does so via ONE
 * `writeBatch` — commitIntentDecision() — so the two writes land together or
 * not at all (never "state flipped, no audit row" or the reverse). The
 * exported functions still return the underlying promise so callers MUST
 * await + handle rejection (no fire-and-forget); on a commit failure nothing
 * was written, so the caller's own optimistic UI state is the only thing to
 * roll back. Repeat-safety is structural, not a dedup check here:
 * firestore.rules' intentTransitionAllowed (mirrored in
 * functions/src/intents/intentSchema.js isClientTransitionAllowed) permits
 * `from == to`, so re-running e.g. dismissIntent on an already-dismissed
 * intent commits cleanly — it just appends a second (harmless, append-only)
 * decision row. Preventing that second row on a double-tap is a UI concern
 * (disable the control while the batch is in flight), deliberately not
 * solved here.
 *
 * INT-02 part 2 item 1: every action function below also takes an optional
 * trailing `versions` arg — the intent doc's own `versions` field, as held
 * by the calling component from its live subscription — copied onto the
 * paired user_decisions row. See decisionPayload() for the omit-when-absent
 * behavior that keeps this backward compatible with legacy intents that
 * predate the field.
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
  writeBatch,
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

/**
 * Build a user_decisions payload. Field shape is intentionally identical to
 * (and must stay in lockstep with) functions/src/intents/intentSchema.js
 * buildUserDecision and firestore.rules' user_decisions create allowlist
 * (targetId/targetType/action/reasonCode/createdAt/reversible/versions,
 * hasOnly — NOT duplicated via import because functions/src is a separate
 * Cloud Functions bundle, not part of the client build).
 *
 * `versions` (INT-02 item 1) is optional — the caller (a tray/toast/widget
 * component that already holds the subscribed intent doc in memory) may
 * pass that doc's own `versions` field through so the decision row is
 * self-describing about which extraction produced the intent it decided on.
 * Omitted entirely (never `versions: null`/`undefined` written into the
 * object) when the caller doesn't supply one — legacy intents extracted
 * before this field existed have no `versions` to copy, and that must stay
 * a no-op, not a write of a bogus value.
 */
function decisionPayload({ targetId, action, reasonCode = null, createdAt, versions }) {
  const payload = {
    targetId,
    targetType: 'intent',
    action,
    reasonCode: reasonCode ?? null,
    createdAt: createdAt || nowIso(),
    reversible: true,
  };
  if (versions !== undefined && versions !== null) payload.versions = versions;
  return payload;
}

/**
 * INT-02: commit an intent-state update and its paired user_decisions append
 * as ONE Firestore batch. Either both writes land or neither does — callers
 * must await this and treat a rejection as "nothing changed" (safe to
 * restore any optimistic UI state).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {object} intentUpdate - fields to merge onto the intent doc.
 * @param {object} decision - a decisionPayload() result.
 */
async function commitIntentDecision(db, uid, id, intentUpdate, decision) {
  const batch = writeBatch(db);
  batch.update(doc(db, intentsPath(uid), id), intentUpdate);
  batch.set(doc(collection(db, decisionsPath(uid))), decision);
  await batch.commit();
}

/**
 * Keep a suggested intent: suggested -> active (+ 'kept' decision), one batch.
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {object} [versions] - the intent doc's own `versions` field
 *   (INT-02 item 1), copied onto the decision when the caller has it.
 */
export async function keepIntent(db, uid, id, versions) {
  const now = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { state: 'active', updatedAt: now },
    decisionPayload({ targetId: id, action: 'kept', createdAt: now, versions }),
  );
}

/**
 * Dismiss an intent: any -> dismissed (+ 'not_a_task' decision), one batch.
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string|null} [reasonCode]
 * @param {object} [versions] - see {@link keepIntent}.
 */
export async function dismissIntent(db, uid, id, reasonCode = null, versions) {
  const now = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { state: 'dismissed', updatedAt: now },
    decisionPayload({ targetId: id, action: 'not_a_task', reasonCode, createdAt: now, versions }),
  );
}

/**
 * Complete an active intent: active -> completed_state (+ 'completed' decision), one batch.
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {object} [versions] - see {@link keepIntent}.
 */
export async function completeIntent(db, uid, id, versions) {
  const now = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { state: 'completed_state', updatedAt: now },
    decisionPayload({ targetId: id, action: 'completed', createdAt: now, versions }),
  );
}

/**
 * Snooze an open loop until a future instant: no state change, just
 * `snoozedUntil` (+ a reversible 'snoozed' decision), one batch.
 * Client-filtered out of {@link subscribeDueOpenLoops} until that instant
 * passes.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string} untilIso
 * @param {object} [versions] - see {@link keepIntent}.
 */
export async function snoozeLoop(db, uid, id, untilIso, versions) {
  const now = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { snoozedUntil: untilIso, updatedAt: now },
    decisionPayload({ targetId: id, action: 'snoozed', createdAt: now, versions }),
  );
}

/**
 * Close an open loop because it was answered by another entry: active ->
 * completed_state, with `outcome.kind = 'answered'` (+ 'answered' decision),
 * one batch. Writes only the intent doc — the source entry (answerEntryId
 * just records its id) is never touched.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {string|null} [answerEntryId]
 * @param {object} [versions] - see {@link keepIntent}.
 */
export async function answerLoop(db, uid, id, answerEntryId = null, versions) {
  const closedAt = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { state: 'completed_state', outcome: { closedAt, kind: 'answered', answerEntryId }, updatedAt: closedAt },
    decisionPayload({ targetId: id, action: 'answered', createdAt: closedAt, versions }),
  );
}

/**
 * Close an open loop with no answering entry (user closed it directly):
 * active -> completed_state, with `outcome.kind = 'closed'` (+ 'closed'
 * decision), one batch.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} id
 * @param {object} [versions] - see {@link keepIntent}.
 */
export async function closeLoop(db, uid, id, versions) {
  const closedAt = nowIso();
  await commitIntentDecision(
    db, uid, id,
    { state: 'completed_state', outcome: { closedAt, kind: 'closed', answerEntryId: null }, updatedAt: closedAt },
    decisionPayload({ targetId: id, action: 'closed', createdAt: closedAt, versions }),
  );
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
