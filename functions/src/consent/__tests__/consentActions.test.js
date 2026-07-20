/**
 * Tests for grantConsent / revokeConsent (the logic behind the
 * grantAiProcessing / revokeAiProcessing callables).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

const { grantConsent, revokeConsent } = await import('../consentGate.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('grantConsent', () => {
  it('writes an authoritative grant doc (merge) and returns granted', async () => {
    const setSpy = vi.fn(async () => {});
    const db = { doc: () => ({ set: setSpy }) };

    const res = await grantConsent(db, 'u1');

    expect(res).toEqual({ granted: true });
    expect(setSpy).toHaveBeenCalledTimes(1);
    const [payload, opts] = setSpy.mock.calls[0];
    expect(payload.aiProcessing).toBe(true);
    expect(payload.grantedAt).toBe('__ts__');
    expect(payload.policyVersion).toBe(1);
    expect(opts).toEqual({ merge: true });
  });
});

describe('revokeConsent', () => {
  it('writes a revoke doc and cancels all pending entries in batches', async () => {
    const setSpy = vi.fn(async () => {});
    const updates = [];
    const commit = vi.fn(async () => {});
    const batch = {
      update: (ref, data) => updates.push({ ref, data }),
      commit,
    };

    // First pending query returns 2 docs; second returns empty.
    let queryCall = 0;
    const entriesCollection = {
      where: () => ({
        limit: () => ({
          get: async () => {
            queryCall += 1;
            if (queryCall === 1) {
              return { empty: false, size: 2, docs: [{ ref: 'e1' }, { ref: 'e2' }] };
            }
            return { empty: true, size: 0, docs: [] };
          },
        }),
      }),
    };

    const db = {
      doc: () => ({ set: setSpy }),
      collection: () => entriesCollection,
      batch: () => batch,
    };

    const res = await revokeConsent(db, 'u1');

    expect(res).toEqual({ cancelled: 2 });

    const [payload] = setSpy.mock.calls[0];
    expect(payload.aiProcessing).toBe(false);
    expect(payload.revokedAt).toBe('__ts__');
    expect(payload.policyVersion).toBe(1);

    expect(updates).toHaveLength(2);
    updates.forEach((u) => expect(u.data).toEqual({ analysisStatus: 'disabled' }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled:0 when there are no pending entries', async () => {
    const setSpy = vi.fn(async () => {});
    const entriesCollection = {
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }) }),
    };
    const db = {
      doc: () => ({ set: setSpy }),
      collection: () => entriesCollection,
      batch: () => ({ update: vi.fn(), commit: vi.fn(async () => {}) }),
    };

    const res = await revokeConsent(db, 'u1');
    expect(res).toEqual({ cancelled: 0 });
  });
});
