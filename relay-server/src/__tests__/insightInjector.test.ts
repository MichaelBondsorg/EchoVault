/**
 * insightInjector.test.ts
 *
 * Tests for the relay server insight injection module.
 * Uses Vitest. All Firestore and voiceTone dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationReadyInsight } from '../insights/insightInjector.js';

// Mock firebase admin and Firestore access
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ get: mockGet, set: mockSet });
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBatch = vi.fn().mockReturnValue({ set: mockBatchSet, commit: mockBatchCommit });

vi.mock('../auth/firebase.js', () => ({
  firestore: {
    collection: vi.fn().mockReturnThis(),
    doc: mockDoc,
    batch: mockBatch,
  },
  APP_COLLECTION_ID: 'echo-vault-v5-fresh',
}));

// Import after mocks
const { InsightInjector } = await import('../insights/insightInjector.js');

function makeInsight(overrides: Partial<ConversationReadyInsight> = {}): ConversationReadyInsight {
  return {
    insightId: 'insight-1',
    summary: 'You tend to feel more energetic after morning exercise.',
    fullContext: 'Based on entries from the past 3 weeks, mornings with exercise correlate with higher mood scores.',
    confidence: 0.85,
    emotionalTone: 'encouraging',
    relatedEntryIds: ['entry-1', 'entry-2'],
    suggestedTiming: 'natural_pause',
    moodGateThreshold: 0.3,
    ...overrides,
  };
}

describe('InsightInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize / fetchConversationQueue', () => {
    it('fetches conversation queue on session start', async () => {
      const insights = [makeInsight(), makeInsight({ insightId: 'insight-2' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      expect(injector.getInsights()).toHaveLength(2);
      expect(injector.getInsights()[0].insightId).toBe('insight-1');
    });

    it('handles missing conversation queue gracefully', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      expect(injector.getInsights()).toHaveLength(0);
    });

    it('filters out malformed insights from Firestore data', async () => {
      const validInsight = makeInsight();
      const malformedInsights = [
        validInsight,
        { summary: 'missing insightId' },
        { insightId: 'x', confidence: 0.5 }, // missing summary
        { insightId: 'y', summary: 'ok' }, // missing confidence
        null,
        'not an object',
      ];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights: malformedInsights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      expect(injector.getInsights()).toHaveLength(1);
      expect(injector.getInsights()[0].insightId).toBe('insight-1');
    });

    it('handles Firestore errors gracefully', async () => {
      mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      expect(injector.getInsights()).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('buildInsightSystemPrompt', () => {
    it('injects insight context into system prompt', async () => {
      const insights = [
        makeInsight(),
        makeInsight({ insightId: 'insight-2', summary: 'Your sleep patterns correlate with stress levels.' }),
      ];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      const prompt = injector.buildInsightSystemPrompt();
      expect(prompt).toContain('Insights About This User');
      expect(prompt).toContain('You tend to feel more energetic');
      expect(prompt).toContain('Your sleep patterns correlate');
      expect(prompt).toContain('AT MOST');
    });

    it('returns empty string when no insights available', () => {
      const injector = new InsightInjector('user-1', 'session-1');
      // Not initialized — no insights loaded
      const prompt = injector.buildInsightSystemPrompt();
      expect(prompt).toBe('');
    });
  });

  describe('session delivery limits', () => {
    it('enforces max 2 insights per session', async () => {
      const insights = [
        makeInsight({ insightId: 'i1' }),
        makeInsight({ insightId: 'i2' }),
        makeInsight({ insightId: 'i3' }),
      ];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      expect(injector.canSurfaceInsight()).toBe(true);
      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);
      expect(injector.canSurfaceInsight()).toBe(true);
      injector.markInsightSurfaced('i2', 'session_end', 0.6);
      expect(injector.canSurfaceInsight()).toBe(false);
    });

    it('allows surfacing when under the limit', () => {
      const injector = new InsightInjector('user-1', 'session-1');
      expect(injector.canSurfaceInsight()).toBe(true);
      expect(injector.getSurfacedCount()).toBe(0);
    });
  });

  describe('mood gating', () => {
    it('checks moodScore against threshold before surfacing', () => {
      const injector = new InsightInjector('user-1', 'session-1');
      const insight = makeInsight({ moodGateThreshold: 0.4 });

      expect(injector.checkMoodGate(insight, 0.6)).toBe(true);
    });

    it('blocks insight delivery when moodScore below threshold', () => {
      const injector = new InsightInjector('user-1', 'session-1');
      const insight = makeInsight({ moodGateThreshold: 0.5 });

      expect(injector.checkMoodGate(insight, 0.3)).toBe(false);
    });

    it('allows delivery when no mood data available for encouraging/reflective', () => {
      const injector = new InsightInjector('user-1', 'session-1');

      const encouraging = makeInsight({ emotionalTone: 'encouraging', moodGateThreshold: 0.3 });
      expect(injector.checkMoodGate(encouraging, null)).toBe(true);

      const reflective = makeInsight({ emotionalTone: 'reflective', moodGateThreshold: 0.4 });
      expect(injector.checkMoodGate(reflective, null)).toBe(true);
    });

    it('blocks delivery when no mood data available for challenging', () => {
      const injector = new InsightInjector('user-1', 'session-1');

      const challenging = makeInsight({ emotionalTone: 'challenging', moodGateThreshold: 0.5 });
      expect(injector.checkMoodGate(challenging, null)).toBe(false);
    });
  });

  describe('engagement tracking', () => {
    it('tracks "explored" user responses', async () => {
      const insights = [makeInsight({ insightId: 'i1' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);
      injector.markInsightExplored('i1', 3);

      expect(injector.getSurfacedCount()).toBe(1);
    });

    it('tracks "dismissed" user responses', async () => {
      const insights = [makeInsight({ insightId: 'i1' }), makeInsight({ insightId: 'i2' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);
      injector.markInsightDismissed('i1');

      // Dismissed insight counts toward surfaced
      expect(injector.getSurfacedCount()).toBe(1);
    });

    it('writes engagement data to Firestore on session end', async () => {
      const insights = [makeInsight({ insightId: 'i1' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);
      injector.markInsightExplored('i1', 3);

      await injector.flushEngagement();

      expect(mockBatch).toHaveBeenCalled();
      expect(mockBatchSet).toHaveBeenCalledTimes(1);
      expect(mockBatchCommit).toHaveBeenCalled();

      // Verify the engagement record shape
      const setCall = mockBatchSet.mock.calls[0];
      const record = setCall[1];
      expect(record.insightId).toBe('i1');
      expect(record.sessionId).toBe('session-1');
      expect(record.userResponse).toBe('explored');
      expect(record.explorationDepth).toBe(3);
      expect(record.deliveryTiming).toBe('natural_pause');
    });

    it('does not write to Firestore when no insights were surfaced', async () => {
      const injector = new InsightInjector('user-1', 'session-1');
      await injector.flushEngagement();

      expect(mockBatch).not.toHaveBeenCalled();
    });

    it('is idempotent — double flush does not write twice', async () => {
      const insights = [makeInsight({ insightId: 'i1' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();

      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);

      await injector.flushEngagement();
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);

      // Second flush should be a no-op (records cleared after first commit)
      vi.clearAllMocks();
      await injector.flushEngagement();
      expect(mockBatch).not.toHaveBeenCalled();
    });

    it('handles Firestore write errors gracefully on flush', async () => {
      const insights = [makeInsight({ insightId: 'i1' })];
      mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ insights }) });
      mockBatchCommit.mockRejectedValueOnce(new Error('Write failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const injector = new InsightInjector('user-1', 'session-1');
      await injector.initialize();
      injector.markInsightSurfaced('i1', 'natural_pause', 0.7);

      // Should not throw
      await injector.flushEngagement();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
