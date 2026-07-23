/**
 * useClaims — R4 Phase 1 claim-backed Quick Insights data hook (Task 10).
 *
 * Loads the current user's live claims (`listActiveClaims`: verified +
 * candidate, unsuperseded, sorted createdAt desc — see claimsService.js)
 * once on mount and whenever `user` changes, then filters to
 * `status === 'verified'` here — this page surface (Quick Insights) only
 * ever shows claims that have already cleared verification, unlike an
 * admin/debug surface that might also want candidates. No insight-budget
 * application is applied here, matching the legacy Quick Insights surface
 * this replaces (also unbudgeted).
 *
 * Internally gated on `getFlag('insightClaims')`: when the flag is off,
 * `listActiveClaims` is never called — the hook owns this gate itself so
 * every call site gets the "flag off => zero reads" guarantee for free,
 * rather than needing to remember to check the flag before calling
 * `refresh`/mounting the hook. Proven in InsightsPage.claims.test.jsx.
 */
import { useCallback, useEffect, useState } from 'react';
import { db } from '../config/firebase';
import { getFlag } from '../config/flags';
import { listActiveClaims } from '../services/insights/claims/claimsService';

export function useClaims(user) {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);

  const uid = user?.uid || null;

  const refresh = useCallback(async () => {
    if (!uid || !getFlag('insightClaims')) {
      setClaims([]);
      return;
    }
    setLoading(true);
    try {
      const active = await listActiveClaims(db, uid);
      setClaims(active.filter((claim) => claim.status === 'verified'));
    } catch (error) {
      console.error('[useClaims] failed to load claims:', error);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { claims, loading, refresh };
}

export default useClaims;
