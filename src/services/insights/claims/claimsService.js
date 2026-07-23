/**
 * InsightClaim store (R4 Phase 1). Claims are immutable facts: app code may
 * only (a) create, (b) set supersededByClaimId when a newer version replaces
 * one, (c) flip status verified<->suppressed (user feedback). History is
 * never deleted by the app (owner delete stays possible in rules — user
 * data rights — but no code path calls it).
 */
import {
  collection, doc, getDocs, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { buildClaim } from './claimSchema';

const claimsCol = (db, uid) => collection(db, 'artifacts', APP_COLLECTION_ID, 'users', uid, 'insight_claims');
const claimRef = (db, uid, id) => doc(db, 'artifacts', APP_COLLECTION_ID, 'users', uid, 'insight_claims', id);

export async function writeClaim(db, uid, claim) {
  const validated = buildClaim(claim); // construction path is the validator
  await setDoc(claimRef(db, uid, validated.id), validated);
  return validated;
}

export async function listActiveClaims(db, uid) {
  const snap = await getDocs(claimsCol(db, uid));
  return snap.docs.map((d) => d.data())
    .filter((c) => c.supersededByClaimId == null && (c.status === 'verified' || c.status === 'candidate'))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listAllClaims(db, uid) {
  const snap = await getDocs(claimsCol(db, uid));
  return snap.docs.map((d) => d.data());
}

export async function supersedeClaim(db, uid, oldClaim, newClaim) {
  if (oldClaim.supersededByClaimId != null) {
    throw new Error('supersedeClaim: oldClaim is already superseded (a claim may be superseded at most once)');
  }
  if (newClaim.parentClaimId !== oldClaim.id) {
    throw new Error('supersedeClaim: newClaim.parentClaimId must link the old claim (lineage is explicit, never implicit)');
  }
  const validated = buildClaim(newClaim);
  const batch = writeBatch(db);
  batch.set(claimRef(db, uid, validated.id), validated);
  batch.update(claimRef(db, uid, oldClaim.id), {
    supersededByClaimId: validated.id, updatedAt: validated.updatedAt,
  });
  await batch.commit();
  return validated;
}

export async function setClaimStatus(db, uid, claimId, status, { now } = {}) {
  if (status !== 'suppressed' && status !== 'verified') {
    throw new Error(`setClaimStatus: app code may only toggle suppressed/verified, got "${status}"`);
  }
  await updateDoc(claimRef(db, uid, claimId), {
    status, updatedAt: now || new Date().toISOString(),
  });
}

/** Same discovery? (used to avoid claim churn when evidence barely moves) */
export function evidenceEquivalent(a, b) {
  return a.direction === b.direction
    && a.evidence.exposedDayCount === b.evidence.exposedDayCount
    && a.evidence.comparisonDayCount === b.evidence.comparisonDayCount
    && Math.abs(a.evidence.effectMoodPoints - b.evidence.effectMoodPoints) <= 0.5;
}
