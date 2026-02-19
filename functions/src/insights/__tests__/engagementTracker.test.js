/**
 * Tests for Insight Engagement Tracking Pipeline
 *
 * The engagementTracker receives engagement data from the relay server
 * after a voice session ends, writes engagement records to Firestore,
 * and updates the Nexus Layer 4 Intervention Optimizer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firestore
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBatch = vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }));
const mockDoc = vi.fn().mockReturnValue({ id: 'auto-id' });
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    batch: mockBatch,
    doc: mockDoc,
    collection: mockCollection,
  }),
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    increment: (n) => ({ __increment: n }),
  },
  Timestamp: {
    fromMillis: (ms) => ({ _seconds: Math.floor(ms / 1000), _nanoseconds: 0, toMillis: () => ms }),
  },
}));

// Import after mocks
const {
  processEngagement,
  validateEngagementPayload,
  clampMood,
  computeOptimizerUpdate,
  sanitizeInsightType,
} = await import('../engagementTracker.js');

// Helper: create valid engagement payload
const makePayload = (overrides = {}) => ({
  userId: 'user-123',
  engagements: [
    {
      insightId: 'insight-abc',
      sessionId: 'session-xyz',
      deliveryTiming: 'natural_pause',
      userResponse: 'explored',
      explorationDepth: 3,
      moodBefore: 0.5,
      moodAfter: 0.7,
      timestamp: Date.now(),
      insightType: 'causal_synthesis',
    },
  ],
  ...overrides,
});

describe('engagementTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('engagement record writing', () => {
    it('writes engagement record with all required fields', async () => {
      const payload = makePayload();
      const result = await processEngagement(payload);

      expect(result.success).toBe(true);
      expect(result.recordsWritten).toBe(1);
      // 1 engagement record + 1 optimizer update = 2 batch.set calls
      expect(mockBatchSet).toHaveBeenCalledTimes(2);

      const [, data] = mockBatchSet.mock.calls[0];
      expect(data.insightId).toBe('insight-abc');
      expect(data.sessionId).toBe('session-xyz');
      expect(data.deliveryTiming).toBe('natural_pause');
      expect(data.userResponse).toBe('explored');
      expect(data.explorationDepth).toBe(3);
      expect(data.moodBefore).toBe(0.5);
      expect(data.moodAfter).toBe(0.7);
      expect(data.timestamp).toBeDefined();
    });

    it('generates unique document refs for each record', async () => {
      const payload = makePayload({
        engagements: [
          {
            insightId: 'insight-1',
            sessionId: 'session-1',
            deliveryTiming: 'session_start',
            userResponse: 'explored',
            explorationDepth: 2,
            moodBefore: 0.4,
            moodAfter: 0.6,
            timestamp: Date.now(),
            insightType: 'pattern_correlation',
          },
          {
            insightId: 'insight-2',
            sessionId: 'session-1',
            deliveryTiming: 'session_end',
            userResponse: 'dismissed',
            explorationDepth: 0,
            moodBefore: 0.6,
            moodAfter: 0.5,
            timestamp: Date.now(),
            insightType: 'narrative_arc',
          },
        ],
      });

      const result = await processEngagement(payload);
      expect(result.recordsWritten).toBe(2);
      // 2 engagement records + 1 optimizer update = 3 batch.set calls
      expect(mockBatchSet).toHaveBeenCalledTimes(3);
    });

    it('handles batch engagement data from a single session', async () => {
      const payload = makePayload({
        engagements: [
          {
            insightId: 'insight-1',
            sessionId: 'session-1',
            deliveryTiming: 'session_start',
            userResponse: 'explored',
            explorationDepth: 4,
            moodBefore: 0.5,
            moodAfter: 0.8,
            timestamp: Date.now(),
            insightType: 'intervention',
          },
          {
            insightId: 'insight-2',
            sessionId: 'session-1',
            deliveryTiming: 'natural_pause',
            userResponse: 'deferred',
            explorationDepth: 1,
            moodBefore: 0.8,
            moodAfter: 0.7,
            timestamp: Date.now(),
            insightType: 'belief_dissonance',
          },
        ],
      });

      const result = await processEngagement(payload);
      expect(result.success).toBe(true);
      expect(result.recordsWritten).toBe(2);
      // Single batch commit for both
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      // 2 engagement records + 1 optimizer update = 3 batch.set calls
      expect(mockBatchSet).toHaveBeenCalledTimes(3);
    });

    it('handles empty engagements array', async () => {
      const payload = makePayload({ engagements: [] });
      const result = await processEngagement(payload);

      expect(result.success).toBe(true);
      expect(result.recordsWritten).toBe(0);
      expect(mockBatchCommit).not.toHaveBeenCalled();
    });

    it('clamps mood values before writing to Firestore', async () => {
      const payload = makePayload();
      payload.engagements[0].moodBefore = 1.5;
      payload.engagements[0].moodAfter = -0.2;

      await processEngagement(payload);

      const [, data] = mockBatchSet.mock.calls[0];
      expect(data.moodBefore).toBe(1);
      expect(data.moodAfter).toBe(0);
    });
  });

  describe('intervention optimizer updates', () => {
    it('writes optimizer update with delivery outcome via batch', async () => {
      const payload = makePayload();
      await processEngagement(payload);

      // Last batch.set call is the optimizer update (merge: true)
      const lastCall = mockBatchSet.mock.calls[mockBatchSet.mock.calls.length - 1];
      const [, fields, options] = lastCall;
      expect(options).toEqual({ merge: true });
      expect(fields['insightTypeStats.causal_synthesis.totalDelivered']).toEqual({ __increment: 1 });
      expect(fields['insightTypeStats.causal_synthesis.explored']).toEqual({ __increment: 1 });
    });

    it('computes mood delta correctly', () => {
      const update = computeOptimizerUpdate({
        insightType: 'causal_synthesis',
        deliveryTiming: 'natural_pause',
        userResponse: 'explored',
        explorationDepth: 3,
        moodBefore: 0.6,
        moodAfter: 0.8,
      });

      expect(update.moodDelta).toBeCloseTo(0.2);
    });

    it('tracks insight type stats in optimizer update', () => {
      const update = computeOptimizerUpdate({
        insightType: 'causal_synthesis',
        deliveryTiming: 'natural_pause',
        userResponse: 'explored',
        explorationDepth: 3,
        moodBefore: 0.5,
        moodAfter: 0.7,
      });

      expect(update.insightType).toBe('causal_synthesis');
      expect(update.userResponse).toBe('explored');
      expect(update.explorationDepth).toBe(3);
    });

    it('tracks delivery timing in optimizer update', () => {
      const update = computeOptimizerUpdate({
        insightType: 'intervention',
        deliveryTiming: 'session_end',
        userResponse: 'dismissed',
        explorationDepth: 0,
        moodBefore: 0.4,
        moodAfter: 0.3,
      });

      expect(update.deliveryTiming).toBe('session_end');
      expect(update.moodDelta).toBeCloseTo(-0.1);
    });

    it('includes mood delta and exploration depth in optimizer fields', async () => {
      const payload = makePayload();
      payload.engagements[0].moodBefore = 0.5;
      payload.engagements[0].moodAfter = 0.8;
      payload.engagements[0].explorationDepth = 4;

      await processEngagement(payload);

      const lastCall = mockBatchSet.mock.calls[mockBatchSet.mock.calls.length - 1];
      const [, fields] = lastCall;
      expect(fields['insightTypeStats.causal_synthesis.totalMoodDelta']).toEqual({ __increment: expect.any(Number) });
      expect(fields['insightTypeStats.causal_synthesis.totalExplorationDepth']).toEqual({ __increment: 4 });
      expect(fields['timingStats.natural_pause.totalMoodDelta']).toEqual({ __increment: expect.any(Number) });
    });
  });

  describe('input validation', () => {
    it('rejects engagement data with missing required fields', () => {
      const invalid = { userId: 'user-123', engagements: [{ insightId: 'abc' }] };
      expect(() => validateEngagementPayload(invalid)).toThrow();
    });

    it('rejects invalid userResponse values', () => {
      const payload = makePayload();
      payload.engagements[0].userResponse = 'unknown';
      expect(() => validateEngagementPayload(payload)).toThrow(/userResponse/);
    });

    it('rejects invalid deliveryTiming values', () => {
      const payload = makePayload();
      payload.engagements[0].deliveryTiming = 'middle_of_session';
      expect(() => validateEngagementPayload(payload)).toThrow(/deliveryTiming/);
    });

    it('rejects explorationDepth below zero', () => {
      const payload = makePayload();
      payload.engagements[0].explorationDepth = -1;
      expect(() => validateEngagementPayload(payload)).toThrow(/explorationDepth/);
    });

    it('rejects missing userId', () => {
      const payload = makePayload({ userId: undefined });
      expect(() => validateEngagementPayload(payload)).toThrow(/userId/);
    });
  });

  describe('insightType sanitization', () => {
    it('allows valid snake_case insight types', () => {
      expect(sanitizeInsightType('causal_synthesis')).toBe('causal_synthesis');
      expect(sanitizeInsightType('pattern_alert')).toBe('pattern_alert');
    });

    it('rejects insight types with dots (path injection)', () => {
      expect(sanitizeInsightType('foo.bar.baz')).toBe('unknown');
    });

    it('rejects insight types with slashes', () => {
      expect(sanitizeInsightType('foo/bar')).toBe('unknown');
    });

    it('falls back to unknown for null/undefined', () => {
      expect(sanitizeInsightType(null)).toBe('unknown');
      expect(sanitizeInsightType(undefined)).toBe('unknown');
    });

    it('rejects uppercase or mixed case', () => {
      expect(sanitizeInsightType('CausalSynthesis')).toBe('unknown');
    });
  });

  describe('mood clamping', () => {
    it('clamps mood scores above 1 to 1', () => {
      expect(clampMood(1.5)).toBe(1);
    });

    it('clamps mood scores below 0 to 0', () => {
      expect(clampMood(-0.3)).toBe(0);
    });

    it('preserves valid mood scores', () => {
      expect(clampMood(0.65)).toBe(0.65);
    });
  });

  describe('error handling', () => {
    it('retries on transient Firestore errors', async () => {
      mockBatchCommit
        .mockRejectedValueOnce({ code: 14, message: 'UNAVAILABLE' })
        .mockRejectedValueOnce({ code: 14, message: 'UNAVAILABLE' })
        .mockResolvedValueOnce(undefined);

      const payload = makePayload();
      const result = await processEngagement(payload);

      expect(result.success).toBe(true);
      // 3 batch calls total (2 retries + 1 success)
      expect(mockBatchCommit).toHaveBeenCalledTimes(3);
    });

    it('does not accumulate optimizer updates across retries', async () => {
      mockBatchCommit
        .mockRejectedValueOnce({ code: 14, message: 'UNAVAILABLE' })
        .mockResolvedValueOnce(undefined);

      const payload = makePayload();
      await processEngagement(payload);

      // On the successful attempt (2nd), batch.set should have exactly 2 calls:
      // 1 engagement record + 1 optimizer update
      // First attempt: 2 set calls, then fail. Second attempt: 2 new set calls.
      // mockBatchSet accumulates across both attempts: 4 total
      expect(mockBatchSet).toHaveBeenCalledTimes(4);

      // But the optimizer increment on the successful call should be 1, not 2
      const lastOptimizerCall = mockBatchSet.mock.calls[3];
      const [, fields] = lastOptimizerCall;
      expect(fields['insightTypeStats.causal_synthesis.totalDelivered']).toEqual({ __increment: 1 });
    });

    it('logs and returns failure on persistent errors without crashing', async () => {
      mockBatchCommit.mockRejectedValue({ code: 14, message: 'UNAVAILABLE' });

      const payload = makePayload();
      const result = await processEngagement(payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('write_failed');
    });
  });
});
