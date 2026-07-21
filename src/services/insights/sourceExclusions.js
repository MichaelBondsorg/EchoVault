/**
 * Source Exclusions service (R2 Task 10).
 *
 * Lets a user permanently exclude a specific entry from feeding future
 * insight/report generation — either entirely (`appliesTo: 'all'`, the
 * default) or from a specific pattern type only (`appliesTo: <patternType>`,
 * reserved for a future generator-scoped consumer; only 'all' exclusions
 * currently remove an entry from `getExcludedEntryIds`, mirroring the
 * server-side precedent in `functions/src/reports/generator.js#readEntries`).
 *
 * Storage: artifacts/{APP}/users/{uid}/source_exclusions/{id}
 *   {entryId, appliesTo, reason, permanent:true, createdAt}
 *
 * firestore.rules: owner create/read/delete, NO update — deleting the doc
 * IS the "restore" action (a client can never edit an exclusion in place).
 * `reason` must be 'wrong_source' | 'excluded_by_user'; `permanent` must be
 * `true`. This module validates the same shape client-side before writing,
 * so a bad call fails fast with a clear error instead of a bare
 * permission-denied from the rules.
 *
 * Both mutators fan out staleness via `onSourcesChanged` (recompute.js) and
 * AWAIT it before resolving, per the PRD's "stale within 10 seconds"
 * acceptance criterion.
 */
import { collection, doc, addDoc, deleteDoc, getDocs } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { onSourcesChanged } from './recompute';

const VALID_REASONS = ['wrong_source', 'excluded_by_user'];

function exclusionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/source_exclusions`;
}

/**
 * Exclude an entry from future insight/report generation.
 *
 * @param {object} db
 * @param {string} uid
 * @param {{entryId: string, appliesTo?: string, reason: 'wrong_source'|'excluded_by_user'}} params
 * @returns {Promise<{id:string, entryId:string, appliesTo:string, reason:string, permanent:true, createdAt:string}>}
 */
export async function excludeSource(db, uid, { entryId, appliesTo = 'all', reason } = {}) {
  if (!entryId || typeof entryId !== 'string') {
    throw new Error('excludeSource: entryId is required');
  }
  if (!VALID_REASONS.includes(reason)) {
    throw new Error(`excludeSource: reason must be one of ${VALID_REASONS.join(', ')}`);
  }

  const payload = {
    entryId,
    appliesTo,
    reason,
    permanent: true,
    createdAt: new Date().toISOString(),
  };

  const docRef = await addDoc(collection(db, exclusionsPath(uid)), payload);
  await onSourcesChanged(db, uid);
  return { id: docRef.id, ...payload };
}

/**
 * Restore a previously excluded entry (delete = restore; no update path
 * exists per firestore.rules). The next generation includes the entry
 * again.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} exclusionId
 */
export async function restoreSource(db, uid, exclusionId) {
  await deleteDoc(doc(db, exclusionsPath(uid), exclusionId));
  await onSourcesChanged(db, uid);
}

/**
 * List all of the user's source exclusions (for a future Control Center UI —
 * Task 12).
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<Array<{id:string}>>}
 */
export async function listSourceExclusions(db, uid) {
  const snap = await getDocs(collection(db, exclusionsPath(uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Entry ids excluded from the general (all-surfaces) entry pool —
 * `appliesTo === 'all'` only. Computed fresh on each call (not memoized
 * across calls); callers that generate insights should call this ONCE per
 * generation and thread the resulting Set through, rather than re-reading
 * per generator.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<Set<string>>}
 */
export async function getExcludedEntryIds(db, uid) {
  const snap = await getDocs(collection(db, exclusionsPath(uid)));
  const ids = new Set();
  snap.forEach((d) => {
    const data = d.data();
    if (data?.appliesTo === 'all' && data?.entryId) {
      ids.add(data.entryId);
    }
  });
  return ids;
}

export default {
  excludeSource,
  restoreSource,
  listSourceExclusions,
  getExcludedEntryIds,
};
