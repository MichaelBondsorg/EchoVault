import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture addDoc calls without touching real Firestore. serverTimestamp is
// stubbed to a sentinel so we can assert it was used.
const addDoc = vi.fn();
const collection = vi.fn((...args) => ({ __path: args.slice(1) }));
const serverTimestamp = vi.fn(() => '__SERVER_TS__');

vi.mock('firebase/firestore', () => ({
  addDoc: (...args) => addDoc(...args),
  collection: (...args) => collection(...args),
  serverTimestamp: (...args) => serverTimestamp(...args),
}));

vi.mock('../../../config', () => ({
  db: { __db: true },
  APP_COLLECTION_ID: 'test-collection',
}));

const { recordInsightEngagement } = await import('../insightEngagement.js');

describe('recordInsightEngagement', () => {
  beforeEach(() => {
    addDoc.mockReset();
    addDoc.mockResolvedValue({ id: 'evt1' });
    collection.mockClear();
    serverTimestamp.mockClear();
  });

  it('writes an "explored" event with id/type/action shape', async () => {
    const insight = { id: 'ins-1', type: 'causal_synthesis', title: 'secret PII text' };
    const ok = await recordInsightEngagement('user-1', insight, 'explored');

    expect(ok).toBe(true);
    expect(addDoc).toHaveBeenCalledTimes(1);

    // Correct collection path (per-user subcollection).
    expect(collection).toHaveBeenCalledWith(
      { __db: true }, 'artifacts', 'test-collection', 'users', 'user-1', 'insight_engagement_events'
    );

    const [, payload] = addDoc.mock.calls[0];
    expect(payload).toEqual({
      insightId: 'ins-1',
      insightType: 'causal_synthesis',
      action: 'explored',
      recordedAt: '__SERVER_TS__',
    });
    // No insight text / PII leaked.
    expect(JSON.stringify(payload)).not.toContain('secret PII text');
  });

  it('writes a "dismissed" event and falls back to source/null for type/id', async () => {
    const insight = { source: 'recommendation' };
    const ok = await recordInsightEngagement('user-2', insight, 'dismissed');

    expect(ok).toBe(true);
    const [, payload] = addDoc.mock.calls[0];
    expect(payload).toMatchObject({
      insightId: null,
      insightType: 'recommendation',
      action: 'dismissed',
    });
  });

  it('returns false without throwing when addDoc rejects', async () => {
    addDoc.mockRejectedValueOnce(new Error('firestore down'));
    const ok = await recordInsightEngagement('user-3', { id: 'x', type: 'y' }, 'explored');
    expect(ok).toBe(false);
  });

  it('returns false for missing args without calling addDoc', async () => {
    expect(await recordInsightEngagement(null, { id: 'x' }, 'explored')).toBe(false);
    expect(await recordInsightEngagement('user', null, 'explored')).toBe(false);
    expect(await recordInsightEngagement('user', { id: 'x' }, undefined)).toBe(false);
    expect(addDoc).not.toHaveBeenCalled();
  });
});
