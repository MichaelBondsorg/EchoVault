/**
 * Hypothesis-family testing ledger (R4 Phase 1, DR stat-req 9).
 * Every candidate hypothesis is registered BEFORE analysis, so inconclusive
 * and abstained candidates still count toward the family's multiple-testing
 * burden. m = number of DISTINCT candidates ever tested in the family;
 * reruns of the same candidate (new window, new data) do not inflate m.
 * Storage: artifacts/{APP}/users/{uid}/testing_ledger/{ledgerDocIdFor(familyId)}
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../config/constants';

export const LEDGER_ALPHA = 0.05;

export function familyIdForBasic(engineKey, exposureKey) {
  return `basic:${engineKey}:${exposureKey}:mood`;
}

export function familyIdForExperiment(templateId, tag) {
  return tag == null
    ? `experiment:${templateId}`
    : `experiment:${templateId}:tag:${String(tag).toLowerCase()}`;
}

export function bonferroniCiLevel(testedCount, alpha = LEDGER_ALPHA) {
  const m = Number.isFinite(testedCount) && testedCount > 1 ? testedCount : 1;
  return 1 - alpha / m;
}

export function ledgerDocIdFor(familyId) {
  return String(familyId).replace(/\//g, '__');
}

function ledgerRef(db, uid, familyId) {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', uid,
    'testing_ledger', ledgerDocIdFor(familyId));
}

/**
 * Idempotently add candidateIds to the family ledger. Returns {testedCount}
 * AFTER the merge — callers freeze this count (and the ciLevel derived from
 * it) into the analysis plan BEFORE running the estimator.
 */
export async function registerCandidates(db, uid, familyId, candidateIds, { now } = {}) {
  const at = now || new Date().toISOString();
  const ref = ledgerRef(db, uid, familyId);
  let testedCount = 0;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? snap.data() : null;
    const candidates = { ...(existing?.candidates || {}) };
    for (const id of candidateIds) {
      const prior = candidates[id];
      candidates[id] = prior
        ? { ...prior, lastTestedAt: at, timesTested: (prior.timesTested || 1) + 1 }
        : { firstTestedAt: at, lastTestedAt: at, timesTested: 1 };
    }
    testedCount = Object.keys(candidates).length;
    tx.set(ref, {
      familyId, candidates, testedCount,
      createdAt: existing?.createdAt || at, updatedAt: at,
    });
  });
  return { testedCount };
}

export async function readLedgerCounts(db, uid, familyIds) {
  const out = new Map();
  await Promise.all(familyIds.map(async (familyId) => {
    const snap = await getDoc(ledgerRef(db, uid, familyId));
    out.set(familyId, snap.exists() ? (snap.data().testedCount || 0) : 0);
  }));
  return out;
}
