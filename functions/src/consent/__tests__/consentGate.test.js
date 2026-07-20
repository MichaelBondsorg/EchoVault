/**
 * Tests for the server-authoritative AI consent gate (policy + read helpers).
 */
import { describe, it, expect, vi } from 'vitest';

// FieldValue is only needed by the grant/revoke actions; a light mock lets the
// module import cleanly. HttpsError stays real so `.code` behaves like prod.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

const { assertAiConsent, isAiAllowed, readConsent } = await import('../consentGate.js');

/** Build a fake db whose consent doc read returns `consentData` (null = missing). */
function makeDb(consentData, { throwOnGet = false } = {}) {
  return {
    doc: () => ({
      get: async () => {
        if (throwOnGet) throw new Error('firestore unavailable');
        return {
          exists: consentData !== null && consentData !== undefined,
          data: () => consentData,
        };
      },
    }),
  };
}

describe('assertAiConsent', () => {
  it('denies when consent doc has aiProcessing:false', async () => {
    const db = makeDb({ aiProcessing: false });
    await expect(assertAiConsent(db, 'u1')).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'ai-consent-revoked',
    });
  });

  it('allows with source "settings" when aiProcessing:true', async () => {
    const db = makeDb({ aiProcessing: true });
    const res = await assertAiConsent(db, 'u1');
    expect(res.allowed).toBe(true);
    expect(res.source).toBe('settings');
    expect(typeof res.checkedAt).toBe('string');
  });

  it('denies when doc missing and entrySnapshot opts out (aiProcessingConsent:false)', async () => {
    const db = makeDb(null);
    await expect(
      assertAiConsent(db, 'u1', { entrySnapshot: { aiProcessingConsent: false } })
    ).rejects.toMatchObject({ code: 'failed-precondition', message: 'ai-consent-revoked' });
  });

  it('allows with source "legacy-default" when doc missing and no entry opt-out', async () => {
    const db = makeDb(null);
    const res = await assertAiConsent(db, 'u1');
    expect(res.allowed).toBe(true);
    expect(res.source).toBe('legacy-default');
  });

  it('allows legacy-default when doc missing and entry consent is not false', async () => {
    const db = makeDb(null);
    const res = await assertAiConsent(db, 'u1', {
      entrySnapshot: { aiProcessingConsent: true },
    });
    expect(res.allowed).toBe(true);
    expect(res.source).toBe('legacy-default');
  });

  it('fails closed with "unavailable" when the read errors', async () => {
    const db = makeDb(null, { throwOnGet: true });
    await expect(assertAiConsent(db, 'u1')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'ai-consent-check-failed',
    });
  });

  it('rejects a missing uid', async () => {
    const db = makeDb({ aiProcessing: true });
    await expect(assertAiConsent(db, '')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('isAiAllowed', () => {
  it('returns true when consent granted', async () => {
    expect(await isAiAllowed(makeDb({ aiProcessing: true }), 'u1')).toBe(true);
  });

  it('returns false when consent revoked', async () => {
    expect(await isAiAllowed(makeDb({ aiProcessing: false }), 'u1')).toBe(false);
  });

  it('returns false (fail closed) when the read errors', async () => {
    expect(await isAiAllowed(makeDb(null, { throwOnGet: true }), 'u1')).toBe(false);
  });

  it('returns false when doc missing and entry opts out', async () => {
    const db = makeDb(null);
    expect(await isAiAllowed(db, 'u1', { entrySnapshot: { aiProcessingConsent: false } })).toBe(false);
  });

  it('returns true when doc missing and no opt-out (legacy default)', async () => {
    expect(await isAiAllowed(makeDb(null), 'u1')).toBe(true);
  });
});

describe('readConsent', () => {
  it('returns raw doc data when present', async () => {
    const data = { aiProcessing: true, policyVersion: 1 };
    expect(await readConsent(makeDb(data), 'u1')).toEqual(data);
  });

  it('returns null when the doc does not exist', async () => {
    expect(await readConsent(makeDb(null), 'u1')).toBeNull();
  });
});
