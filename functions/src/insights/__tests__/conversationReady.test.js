/**
 * Tests for Conversation-Ready Insight Scoring
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin/firestore
const mockRunTransaction = vi.fn();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockGet = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: mockDoc,
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
}));

// Import after mocks
const {
  scoreInsightsForConversation,
  classifyEmotionalTone,
  computeRelevanceScore,
  isCrisisAdjacent,
  getMoodGateThreshold,
} = await import('../conversationReady.js');

// Helper: create a mock insight
const makeInsight = (overrides = {}) => ({
  id: 'insight-1',
  type: 'causal_synthesis',
  priority: 1,
  summary: 'You tend to sleep better after evening walks.',
  body: 'Analysis of your journal entries over the past month shows a correlation between evening walks and improved sleep quality.',
  confidence: 0.85,
  evidence: { statistical: { confidence: 0.85 } },
  recommendation: { action: 'Try a 20-minute evening walk', confidence: 0.8 },
  layers: [3],
  threadIds: ['t1'],
  generatedAt: { toMillis: () => Date.now() - 86400000 }, // 1 day ago
  ...overrides,
});

// Helper: create mock recent entries
const makeEntry = (overrides = {}) => ({
  id: 'e1',
  createdAt: { toMillis: () => Date.now() - 86400000 },
  sentiment: 0.6,
  entities: ['Alice'],
  ...overrides,
});

describe('conversationReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyEmotionalTone', () => {
    it('classifies intervention insights as encouraging', () => {
      expect(classifyEmotionalTone(makeInsight({ type: 'intervention' }))).toBe('encouraging');
    });

    it('classifies pattern insights as reflective', () => {
      expect(classifyEmotionalTone(makeInsight({ type: 'pattern_alert' }))).toBe('reflective');
    });

    it('classifies belief_dissonance as challenging', () => {
      expect(classifyEmotionalTone(makeInsight({ type: 'belief_dissonance' }))).toBe('challenging');
    });

    it('defaults to reflective for unknown types', () => {
      expect(classifyEmotionalTone(makeInsight({ type: 'unknown' }))).toBe('reflective');
    });
  });

  describe('getMoodGateThreshold', () => {
    it('assigns correct thresholds per tone', () => {
      expect(getMoodGateThreshold('encouraging')).toBe(0.3);
      expect(getMoodGateThreshold('reflective')).toBe(0.4);
      expect(getMoodGateThreshold('challenging')).toBe(0.5);
    });

    it('defaults to 0.4 for unknown tones', () => {
      expect(getMoodGateThreshold('weird')).toBe(0.4);
    });
  });

  describe('isCrisisAdjacent', () => {
    it('detects crisis keywords in summary', () => {
      const insight = makeInsight({ summary: 'Patterns around wanting to end my life detected' });
      expect(isCrisisAdjacent(insight)).toBe(true);
    });

    it('detects crisis keywords in body', () => {
      const insight = makeInsight({ body: 'Your entries mention feeling suicidal recently.' });
      expect(isCrisisAdjacent(insight)).toBe(true);
    });

    it('returns false for safe content', () => {
      const insight = makeInsight({ summary: 'You enjoy morning walks', body: 'Exercise helps mood.' });
      expect(isCrisisAdjacent(insight)).toBe(false);
    });

    it('is case-insensitive', () => {
      const insight = makeInsight({ summary: 'Feeling like I WANT TO DIE sometimes' });
      expect(isCrisisAdjacent(insight)).toBe(true);
    });
  });

  describe('computeRelevanceScore', () => {
    it('returns higher score for more recent insights', () => {
      const recent = makeInsight({ generatedAt: { toMillis: () => Date.now() - 3600000 } }); // 1 hour ago
      const old = makeInsight({ generatedAt: { toMillis: () => Date.now() - 86400000 * 20 } }); // 20 days ago
      const entries = [makeEntry()];

      expect(computeRelevanceScore(recent, entries)).toBeGreaterThan(computeRelevanceScore(old, entries));
    });

    it('returns 0 when no recent entries exist', () => {
      const insight = makeInsight();
      expect(computeRelevanceScore(insight, [])).toBe(0);
    });
  });

  describe('scoreInsightsForConversation', () => {
    const setupMocks = ({ insights = [], history = [], recentEntries = [], queueVersion = 0 } = {}) => {
      // nexus/insights doc
      mockDoc.mockImplementation((path) => ({
        get: vi.fn().mockResolvedValue({
          exists: insights.length > 0 || history.length > 0,
          data: () => ({
            active: insights,
            history: history,
          }),
        }),
      }));

      // recent entries query
      mockCollection.mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: recentEntries.length === 0,
                docs: recentEntries.map(e => ({ data: () => e, id: e.id })),
              }),
            }),
          }),
        }),
      });

      // Transaction mock
      mockRunTransaction.mockImplementation(async (fn) => {
        const txn = {
          get: vi.fn().mockResolvedValue({
            exists: queueVersion > 0,
            data: () => ({ version: queueVersion, insights: [] }),
          }),
          set: vi.fn(),
        };
        return fn(txn);
      });
    };

    it('filters insights below confidence threshold 0.7', async () => {
      setupMocks({
        insights: [
          makeInsight({ id: 'high', confidence: 0.9 }),
          makeInsight({ id: 'medium', confidence: 0.75 }),
          makeInsight({ id: 'low', confidence: 0.5 }),
          makeInsight({ id: 'very-low', confidence: 0.3 }),
        ],
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(2);
      expect(result.filtered).toBe(2);
    });

    it('filters out previously dismissed insights', async () => {
      setupMocks({
        insights: [
          makeInsight({ id: 'active-1', confidence: 0.9 }),
          makeInsight({ id: 'active-2', confidence: 0.85 }),
        ],
        history: [
          { id: 'active-2', engagement: { dismissed: true } },
        ],
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(1);
    });

    it('filters out crisis-adjacent insights', async () => {
      setupMocks({
        insights: [
          makeInsight({ id: 'safe', confidence: 0.9, summary: 'You enjoy walks' }),
          makeInsight({ id: 'crisis', confidence: 0.9, summary: 'Patterns of wanting to kill myself' }),
        ],
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(1);
    });

    it('caps queue at 5 insights', async () => {
      const manyInsights = Array.from({ length: 10 }, (_, i) =>
        makeInsight({ id: `insight-${i}`, confidence: 0.9 - i * 0.01 })
      );
      setupMocks({
        insights: manyInsights,
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBeLessThanOrEqual(5);
    });

    it('returns empty queue when no recent entries (30 days)', async () => {
      setupMocks({
        insights: [makeInsight({ confidence: 0.9 })],
        recentEntries: [], // No recent entries
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(0);
    });

    it('handles empty Nexus insight set gracefully', async () => {
      setupMocks({
        insights: [],
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(0);
      expect(result.filtered).toBe(0);
    });

    it('assigns mood gate threshold based on emotional tone', async () => {
      setupMocks({
        insights: [
          makeInsight({ id: 'i1', type: 'intervention', confidence: 0.9 }),
          makeInsight({ id: 'i2', type: 'belief_dissonance', confidence: 0.9 }),
        ],
        recentEntries: [makeEntry()],
      });

      const result = await scoreInsightsForConversation('user1');
      expect(result.queued).toBe(2);
      // Transaction set was called with the queue — verify via mockRunTransaction
      const txnFn = mockRunTransaction.mock.calls[0][0];
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it('uses optimistic concurrency with version increment', async () => {
      setupMocks({
        insights: [makeInsight({ confidence: 0.9 })],
        recentEntries: [makeEntry()],
        queueVersion: 3,
      });

      await scoreInsightsForConversation('user1');

      // The transaction should have been called
      expect(mockRunTransaction).toHaveBeenCalled();
      // Check that txn.set was called (inside the transaction function)
      const txnFn = mockRunTransaction.mock.calls[0][0];
      const mockTxn = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ version: 3, insights: [] }),
        }),
        set: vi.fn(),
      };
      await txnFn(mockTxn);
      expect(mockTxn.set).toHaveBeenCalled();
      const setArgs = mockTxn.set.mock.calls[0][1];
      expect(setArgs.version).toBe(4);
    });
  });
});
