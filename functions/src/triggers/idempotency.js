/**
 * Idempotency primitives for Firestore triggers / scheduled sweeps.
 *
 * Firestore triggers are at-least-once: the same create/update event can be
 * delivered more than once, and scheduled sweeps can overlap. These helpers
 * make AI side-effects run exactly once per entry.
 */
import { FieldValue } from 'firebase-admin/firestore';

const DEFAULT_LEASE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Transactionally claim a one-time processing marker on `ref`.
 *
 * `markerField` is a one- or two-level dotted path (e.g. `'processing.memoryExtractedAt'`).
 * Returns true if THIS call set the marker (proceed), false if it was already
 * present (duplicate/redelivered event — skip).
 */
export async function claimProcessingMarker(db, ref, markerField) {
  const [group, field] = String(markerField).split('.');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};

    if (field) {
      if (data[group] && data[group][field]) return false;
      tx.set(ref, { [group]: { [field]: FieldValue.serverTimestamp() } }, { merge: true });
    } else {
      if (data[group]) return false;
      tx.set(ref, { [group]: FieldValue.serverTimestamp() }, { merge: true });
    }
    return true;
  });
}

/**
 * Transactionally acquire a lease on `ref`. Wins only when no lease exists or
 * the existing lease is older than `leaseMs`. When `requireStatus` is given the
 * lease is refused unless `analysisStatus` still equals it (someone else may
 * have already finished the work). Returns true if the lease was won.
 */
export async function acquireEntryLease(
  db,
  ref,
  invocationId,
  { leaseMs = DEFAULT_LEASE_MS, requireStatus } = {}
) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};

    if (requireStatus && data.analysisStatus !== requireStatus) return false;

    const leaseAt = data.analysisLease?.at?.toMillis
      ? data.analysisLease.at.toMillis()
      : 0;
    if (leaseAt && Date.now() - leaseAt < leaseMs) return false;

    tx.update(ref, {
      analysisLease: { at: FieldValue.serverTimestamp(), by: invocationId },
    });
    return true;
  });
}

export const LEASE_MS = DEFAULT_LEASE_MS;

export default { claimProcessingMarker, acquireEntryLease, LEASE_MS };
