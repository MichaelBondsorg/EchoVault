import { describe, it, expect, vi } from 'vitest';

// Provide a fixed key so signing is deterministic across sign/verify.
vi.mock('../config/index.js', () => ({
  config: {
    whoopTokenEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  },
}));

const { signState, verifyState } = await import('../services/whoop/oauthState.js');

describe('whoop oauth state signing', () => {
  it('round-trips a signed state and recovers the userId', () => {
    const state = signState('user-123');
    const payload = verifyState(state);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('user-123');
    expect(typeof payload?.timestamp).toBe('number');
  });

  it('rejects a state with a tampered payload (userId swap)', () => {
    const state = signState('victim-uid');
    const [, sig] = state.split('.');
    // Attacker keeps the signature but swaps in their own payload.
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: 'attacker-uid', timestamp: Date.now() }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyState(forged)).toBeNull();
  });

  it('rejects a state with a garbage signature', () => {
    const state = signState('user-123');
    const [payloadB64] = state.split('.');
    expect(verifyState(`${payloadB64}.not-a-real-signature`)).toBeNull();
  });

  it('rejects a completely unsigned base64 blob (old format)', () => {
    const legacy = Buffer.from(
      JSON.stringify({ userId: 'x', timestamp: Date.now() })
    ).toString('base64');
    expect(verifyState(legacy)).toBeNull();
  });

  it('rejects an expired state', () => {
    const realNow = Date.now;
    try {
      // Mint a state 6 minutes in the past (TTL is 5 min).
      Date.now = () => realNow.call(Date) - 6 * 60 * 1000;
      const state = signState('user-123');
      Date.now = realNow;
      expect(verifyState(state)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('returns null for malformed input', () => {
    expect(verifyState('')).toBeNull();
    expect(verifyState('nodot')).toBeNull();
    // @ts-expect-error testing non-string input
    expect(verifyState(null)).toBeNull();
  });
});
