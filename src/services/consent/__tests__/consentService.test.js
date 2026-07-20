import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so the outbox's persistence logic is
// actually exercised (the default aliased test mock is a no-op). Mirrors the
// pattern used in src/services/offline/__tests__/offlineStore.test.js.
const prefsStore = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: prefsStore.has(key) ? prefsStore.get(key) : null }),
    set: async ({ key, value }) => { prefsStore.set(key, value); },
    remove: async ({ key }) => { prefsStore.delete(key); },
  },
}));

const revokeAiProcessingFn = vi.fn();
const grantAiProcessingFn = vi.fn();
vi.mock('../../../config/firebase', () => ({
  revokeAiProcessingFn: (...args) => revokeAiProcessingFn(...args),
  grantAiProcessingFn: (...args) => grantAiProcessingFn(...args),
}));

const {
  revokeAiConsent,
  grantAiConsent,
  declineAiConsent,
  flushConsentOutbox,
  isAiLocallyEnabled,
} = await import('../consentService.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

const localMarker = (uid) => localStorage.getItem(`engram:aiConsent::${uid}`);
const outboxRaw = (uid) => prefsStore.get(`consent_outbox::${uid}`);
const outboxOp = (uid) => {
  const raw = outboxRaw(uid);
  return raw ? JSON.parse(raw) : null;
};

// The project's global test setup (src/test/setup.js) replaces
// window.localStorage with plain vi.fn() stubs (no-ops with no backing
// store) — see src/utils/__tests__/darkMode.test.js for the established
// convention of driving them with an in-memory Map via mockImplementation.
let localStore;

describe('consentService', () => {
  beforeEach(() => {
    prefsStore.clear();
    localStore = new Map();
    localStorage.getItem.mockImplementation((key) => (localStore.has(key) ? localStore.get(key) : null));
    localStorage.setItem.mockImplementation((key, value) => { localStore.set(key, String(value)); });
    localStorage.removeItem.mockImplementation((key) => { localStore.delete(key); });
    localStorage.clear.mockImplementation(() => { localStore.clear(); });
    revokeAiProcessingFn.mockReset();
    grantAiProcessingFn.mockReset();
  });

  describe('isAiLocallyEnabled', () => {
    it('defaults to enabled when no marker has ever been written', () => {
      expect(isAiLocallyEnabled(OWNER_A)).toBe(true);
    });

    it('returns false once revoked', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      await revokeAiConsent(OWNER_A);
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });

    it('returns true again after a subsequent grant', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      grantAiProcessingFn.mockResolvedValue({ data: { granted: true } });
      await revokeAiConsent(OWNER_A);
      await grantAiConsent(OWNER_A);
      expect(isAiLocallyEnabled(OWNER_A)).toBe(true);
    });

    it('treats two owners independently', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      await revokeAiConsent(OWNER_A);
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
      expect(isAiLocallyEnabled(OWNER_B)).toBe(true);
    });
  });

  describe('revokeAiConsent — fail-closed semantics', () => {
    it('flips the local marker synchronously even when the callable rejects', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('network down'));

      await revokeAiConsent(OWNER_A);

      expect(localMarker(OWNER_A)).toBe('revoked');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });

    it('never throws, even when the callable rejects', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('network down'));
      await expect(revokeAiConsent(OWNER_A)).resolves.toBeUndefined();
    });

    it('never re-enables local state after a rejected callable', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('network down'));
      await revokeAiConsent(OWNER_A);
      // Simulate a second, unrelated attempt to flush also failing — local
      // state must remain revoked throughout.
      revokeAiProcessingFn.mockRejectedValue(new Error('still down'));
      await flushConsentOutbox(OWNER_A);
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });

    it('clears the legacy first-run consent markers on revoke', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      localStorage.setItem(`engram:v2:owner:${OWNER_A}:consent%2FaiVersion`, '1');
      await revokeAiConsent(OWNER_A);
      expect(localStorage.getItem(`engram:v2:owner:${OWNER_A}:consent%2FaiVersion`)).toBeNull();
      expect(localStorage.getItem(`engram:v2:owner:${OWNER_A}:consent%2FaiDeclinedVersion`)).toBe('1');
    });

    it('queues a retryable outbox op when the callable fails, and drains it once the callable is called again', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await revokeAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued).toMatchObject({ type: 'revoke', uid: OWNER_A });
      expect(queued.attempts).toBeGreaterThanOrEqual(1);

      // Reconfigure to succeed and flush — as would happen on next launch,
      // 'online', or visibilitychange.
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 2 } });
      await flushConsentOutbox(OWNER_A);

      expect(outboxRaw(OWNER_A)).toBeUndefined();
      expect(revokeAiProcessingFn).toHaveBeenCalled();
    });

    it('removes the outbox op immediately when the callable succeeds', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      await revokeAiConsent(OWNER_A);
      expect(outboxRaw(OWNER_A)).toBeUndefined();
    });
  });

  describe('grantAiConsent', () => {
    it('sets the granted local marker and legacy markers', async () => {
      grantAiProcessingFn.mockResolvedValue({ data: { granted: true } });
      await grantAiConsent(OWNER_A);
      expect(localMarker(OWNER_A)).toBe('granted');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(true);
      expect(localStorage.getItem(`engram:v2:owner:${OWNER_A}:consent%2FaiVersion`)).toBe('1');
    });

    it('never throws, even when the callable rejects', async () => {
      grantAiProcessingFn.mockRejectedValue(new Error('network down'));
      await expect(grantAiConsent(OWNER_A)).resolves.toBeUndefined();
      // Fail-closed applies to the outgoing call, not the local grant intent —
      // the user's local marker still reflects what they asked for so the UI
      // is consistent; the outbox retries the server call.
      expect(localMarker(OWNER_A)).toBe('granted');
    });
  });

  describe('declineAiConsent — first-run "Continue without AI"', () => {
    it('sets a disabled local marker synchronously even when the callable rejects', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));

      await declineAiConsent(OWNER_A);

      expect(localMarker(OWNER_A)).toBe('declined');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });

    it('never throws, even when the callable rejects', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await expect(declineAiConsent(OWNER_A)).resolves.toBeUndefined();
    });

    it('queues the same revoke outbox op the server revokeAiProcessing callable understands, and drains it on a later flush', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await declineAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued).toMatchObject({ type: 'revoke', uid: OWNER_A });
      expect(queued.attempts).toBeGreaterThanOrEqual(1);
      expect(revokeAiProcessingFn).toHaveBeenCalled();
      expect(grantAiProcessingFn).not.toHaveBeenCalled();

      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      await flushConsentOutbox(OWNER_A);
      expect(outboxRaw(OWNER_A)).toBeUndefined();
    });

    it('clears the legacy first-run consent markers, same as revoke', async () => {
      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      localStorage.setItem(`engram:v2:owner:${OWNER_A}:consent%2FaiVersion`, '1');
      await declineAiConsent(OWNER_A);
      expect(localStorage.getItem(`engram:v2:owner:${OWNER_A}:consent%2FaiVersion`)).toBeNull();
      expect(localStorage.getItem(`engram:v2:owner:${OWNER_A}:consent%2FaiDeclinedVersion`)).toBe('1');
    });

    it('last-wins: a grant queued after a still-pending decline leaves a single grant op', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await declineAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).type).toBe('revoke');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);

      grantAiProcessingFn.mockRejectedValue(new Error('still offline'));
      await grantAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued.type).toBe('grant');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(true);
    });

    it('last-wins: a decline queued after a still-pending grant leaves a single revoke op', async () => {
      grantAiProcessingFn.mockRejectedValue(new Error('offline'));
      await grantAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).type).toBe('grant');

      revokeAiProcessingFn.mockRejectedValue(new Error('still offline'));
      await declineAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued.type).toBe('revoke');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });
  });

  describe('outbox last-wins across grant/revoke', () => {
    it('a grant queued after a still-pending revoke leaves a single grant op', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await revokeAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).type).toBe('revoke');

      grantAiProcessingFn.mockRejectedValue(new Error('still offline'));
      await grantAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued.type).toBe('grant');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(true);
    });

    it('a revoke queued after a still-pending grant leaves a single revoke op', async () => {
      grantAiProcessingFn.mockRejectedValue(new Error('offline'));
      await grantAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).type).toBe('grant');

      revokeAiProcessingFn.mockRejectedValue(new Error('still offline'));
      await revokeAiConsent(OWNER_A);

      const queued = outboxOp(OWNER_A);
      expect(queued.type).toBe('revoke');
      expect(isAiLocallyEnabled(OWNER_A)).toBe(false);
    });
  });

  describe('flushConsentOutbox', () => {
    it('is a no-op when nothing is queued', async () => {
      await expect(flushConsentOutbox(OWNER_A)).resolves.toBeUndefined();
      expect(revokeAiProcessingFn).not.toHaveBeenCalled();
      expect(grantAiProcessingFn).not.toHaveBeenCalled();
    });

    it('is a no-op for a falsy uid', async () => {
      await expect(flushConsentOutbox(undefined)).resolves.toBeUndefined();
    });

    it('survives a simulated app reload: a fresh module import still drains the persisted op', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline at revoke time'));
      await revokeAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).type).toBe('revoke');

      // Simulate an app restart by re-importing the module fresh. The
      // Preferences-backed store (prefsStore) is untouched by this, exactly
      // as real Capacitor Preferences persists across process restarts.
      vi.resetModules();
      const fresh = await import('../consentService.js');

      revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
      await fresh.flushConsentOutbox(OWNER_A);

      expect(outboxRaw(OWNER_A)).toBeUndefined();
    });

    it('bumps attempts on repeated failures without dropping the op', async () => {
      revokeAiProcessingFn.mockRejectedValue(new Error('offline'));
      await revokeAiConsent(OWNER_A);
      expect(outboxOp(OWNER_A).attempts).toBe(1);

      await flushConsentOutbox(OWNER_A);
      expect(outboxOp(OWNER_A).attempts).toBe(2);
    });
  });
});
