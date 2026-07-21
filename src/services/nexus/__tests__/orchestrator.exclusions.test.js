/**
 * Source-exclusion-honoring regeneration + version-preservation tests
 * (R2 Task 10).
 *
 * Mirrors the mocking harness in orchestrator.receipts.test.js: Layer 1
 * pattern detection and `computeEntityMoodCorrelations` run for REAL so an
 * excluded entry's absence genuinely propagates into stats/receipts, not
 * just past a mocked stand-in. Everything with a Firestore or LLM
 * dependency is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  // Embeds the doc path in the returned ref so `getDoc` mocks below can
  // distinguish the `nexus/insights` read (saveInsights' existing-history
  // check) from the `settings/nexus` read (getUserSettings) — orchestrator.js
  // calls real (unmocked) getDoc for BOTH, so a single undifferentiated
  // mock return value would corrupt whichever one consumes it first.
  doc: vi.fn((...args) => ({ __path: args.slice(1).join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  query: vi.fn((...args) => ({ __args: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

vi.mock('../../health/whoop', () => ({
  isWhoopLinked: vi.fn(async () => false),
  getWhoopSummary: vi.fn(async () => null),
  getWhoopHistory: vi.fn(async () => ({ available: false, days: [] })),
}));

vi.mock('../gapDetector', () => ({
  detectGaps: vi.fn(async () => []),
}));

vi.mock('../layer1/threadManager', () => ({
  getActiveThreads: vi.fn(async () => []),
  identifyThreadAssociation: vi.fn(async () => ({})),
}));

vi.mock('../layer1/somaticExtractor', () => ({
  extractSomaticSignals: vi.fn(() => []),
}));

vi.mock('../layer2/stateDetector', () => ({
  detectCurrentState: vi.fn(async () => ({})),
  updateCurrentState: vi.fn(async () => {}),
}));

vi.mock('../layer2/baselineManager', () => ({
  getBaselines: vi.fn(async () => null),
  calculateAndSaveBaselines: vi.fn(async () => {}),
  compareToBaseline: vi.fn(() => ({})),
}));

vi.mock('../layer3/synthesizer', () => ({
  INSIGHT_TYPES: {},
  generateCausalSynthesis: vi.fn(async () => ({ success: false })),
  generateNarrativeArcInsight: vi.fn(async () => null),
}));

vi.mock('../layer3/crossThreadDetector', () => ({
  detectMetaPatterns: vi.fn(async () => []),
  generateMetaPatternInsight: vi.fn(async () => null),
}));

vi.mock('../layer3/beliefDissonance', () => ({
  extractBeliefsFromEntry: vi.fn(() => []),
  refineBeliefsWithLLM: vi.fn(async () => []),
  validateBeliefAgainstData: vi.fn(async () => ({ dissonanceScore: 0 })),
  generateDissonanceInsight: vi.fn(async () => null),
  saveBeliefs: vi.fn(async () => {}),
  getBeliefs: vi.fn(async () => []),
}));

vi.mock('../layer3/counterfactual', () => ({
  identifyMissingInterventions: vi.fn(() => []),
  generateCounterfactualInsight: vi.fn(async () => null),
  findGoodDayActivities: vi.fn(() => []),
}));

vi.mock('../layer4/interventionTracker', () => ({
  updateInterventionData: vi.fn(async () => {}),
  getInterventionData: vi.fn(async () => ({})),
}));

vi.mock('../layer4/recommendationEngine', () => ({
  generateRecommendations: vi.fn(async () => []),
}));

const getExcludedEntryIds = vi.fn(async () => new Set());
vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: (...a) => getExcludedEntryIds(...a),
}));

const { getDocs, getDoc, setDoc } = await import('firebase/firestore');
const { generateInsights } = await import('../orchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

function mockEntriesSnapshot(entries) {
  return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
}

/**
 * Adversarial fixture: `yoga-excluded` is a mis-tagged/neutral entry
 * (mood=50, same as the neutral baseline) that happens to mention "yoga".
 * Verified by hand against `computeEntityMoodCorrelations`'s exact
 * arithmetic (baselineMood = round(mean of ALL entries), entity average =
 * round(mean of matching entries), moodDelta = averageMood - baselineMood,
 * only surfaced as an insight when `abs(moodDelta) >= 10`):
 *
 *   WITH `yoga-excluded` (12 entries, moods
 *     [65,65,65,50, 50x8]):
 *       baseline = round(645/12) = 54
 *       yoga avg = round(245/4)  = 61        -> moodDelta = 7  (< 10: SUPPRESSED,
 *                                                no entity_correlation insight at all)
 *   WITHOUT it (11 entries, moods [65,65,65, 50x8]):
 *       baseline = round(595/11) = 54
 *       yoga avg = round(195/3)  = 65        -> moodDelta = 11 (>= 10: insight appears,
 *                                                "boosts", sampleSize 3)
 *
 * So the wrongly-tagged entry doesn't just skew the correlation — it masks
 * a real one entirely. Excluding it is what reveals the true signal.
 */
function buildSuppressionEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [
    {
      id: 'yoga-excluded',
      createdAt: new Date(now).toISOString(),
      text: 'Mentioned yoga in passing, a totally average day otherwise.',
      analysis: { mood_score: 50 },
    },
  ];
  for (let i = 0; i < 3; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - (i + 1) * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid and strong. Entry number ${i}.`,
      analysis: { mood_score: 65 },
    });
  }
  for (let i = 0; i < 8; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 50 },
    });
  }
  return entries;
}

/**
 * Simpler fixture for the restore test: the excluded entry has an
 * extreme-low mood among otherwise-high yoga entries. Both WITH and
 * WITHOUT the exclusion clear the significance gate (same direction,
 * different magnitude/sampleSize), so restoring is provable as "the entry
 * is back in the computation" without crossing a suppression boundary:
 *
 *   WITH  (12 entries): baseline = round(675/12) = 56, yoga avg =
 *     round(275/4) = 69 -> moodDelta 13, sampleSize 4.
 *   WITHOUT (11 entries): baseline = round(670/11) = 61, yoga avg =
 *     round(270/3) = 90 -> moodDelta 29, sampleSize 3.
 */
function buildRestoreEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [
    {
      id: 'yoga-excluded',
      createdAt: new Date(now).toISOString(),
      text: 'Did yoga but felt awful and defeated the whole time.',
      analysis: { mood_score: 5 },
    },
  ];
  for (let i = 0; i < 3; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - (i + 1) * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid and strong. Entry number ${i}.`,
      analysis: { mood_score: 90 },
    });
  }
  for (let i = 0; i < 8; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 50 },
    });
  }
  return entries;
}

beforeEach(() => {
  getDocs.mockReset();
  getDoc.mockReset();
  setDoc.mockClear();
  getExcludedEntryIds.mockReset();
  getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
});

describe('generateInsights - exclusion-honoring regeneration (R2 Task 10)', () => {
  it('WITHOUT exclusion: the mis-tagged entry dilutes the correlation below significance — no entity_correlation insight at all', async () => {
    getExcludedEntryIds.mockResolvedValueOnce(new Set());
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildSuppressionEntries()));

    const result = await generateInsights('user-1');
    const entityInsight = result.insights.find((i) => i.type === 'entity_correlation');
    expect(entityInsight).toBeFalsy();
  });

  it('adversarial: excluding the mis-tagged entry reveals the correlation, which NEVER cites the excluded entryId and whose stats reflect its absence exactly', async () => {
    getExcludedEntryIds.mockResolvedValueOnce(new Set(['yoga-excluded']));
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildSuppressionEntries()));

    const result = await generateInsights('user-1');

    // (a) never cited in ANY receipt.sources, across every insight.
    for (const insight of result.insights) {
      const sourceIds = insight.receipt?.sources?.map((s) => s.entryId) || [];
      expect(sourceIds).not.toContain('yoga-excluded');
    }

    // (b) stats/direction reflect its absence exactly: sampleSize 3 (not
    // 4), moodDelta computed purely over the 3 real yoga entries (11),
    // positive/"boosts" direction, now clearing the significance gate that
    // the mis-tagged entry had suppressed.
    const entityInsight = result.insights.find((i) => i.type === 'entity_correlation');
    expect(entityInsight).toBeTruthy();
    expect(entityInsight.evidence.statistical.sampleSize).toBe(3);
    expect(entityInsight.evidence.statistical.moodDelta).toBe(11);
    expect(entityInsight.summary).toMatch(/boosts/);

    const sourceIds = entityInsight.receipt.sources.map((s) => s.entryId).sort();
    expect(sourceIds).toEqual(['yoga-0', 'yoga-1', 'yoga-2']);

    // Also check the pattern_correlation family (Layer 1, real detector),
    // if Layer 1 happened to produce one from this fixture: the excluded
    // entry must not appear in its sources either.
    const patternInsight = result.insights.find((i) => i.type === 'pattern_correlation');
    if (patternInsight) {
      const patternSourceIds = patternInsight.receipt.sources.map((s) => s.entryId);
      expect(patternSourceIds).not.toContain('yoga-excluded');
    }

    // The excluded entry must also be entirely absent from the persisted
    // doc (via applyReceiptDefaults' windowEntries), not just the
    // precise-source generators.
    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();
    for (const insight of persistCall[1].active) {
      const ids = insight.receipt?.sources?.map((s) => s.entryId) || [];
      expect(ids).not.toContain('yoga-excluded');
    }
  });

  it('restore: once the exclusion is lifted, the next generation includes the entry again (larger sampleSize, entry re-cited)', async () => {
    // First generation: excluded.
    getExcludedEntryIds.mockResolvedValueOnce(new Set(['yoga-excluded']));
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildRestoreEntries()));
    const excluded = await generateInsights('user-1');
    const excludedEntity = excluded.insights.find((i) => i.type === 'entity_correlation');
    expect(excludedEntity).toBeTruthy();
    expect(excludedEntity.evidence.statistical.sampleSize).toBe(3);
    expect(excludedEntity.receipt.sources.map((s) => s.entryId)).not.toContain('yoga-excluded');

    // Second generation: restored (exclusion doc deleted -> empty Set).
    getExcludedEntryIds.mockResolvedValueOnce(new Set());
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildRestoreEntries()));
    const restored = await generateInsights('user-1');
    const restoredEntity = restored.insights.find((i) => i.type === 'entity_correlation');

    expect(restoredEntity).toBeTruthy();
    expect(restoredEntity.evidence.statistical.sampleSize).toBe(4);
    const restoredSourceIds = restoredEntity.receipt.sources.map((s) => s.entryId);
    expect(restoredSourceIds).toContain('yoga-excluded');
  });
});

describe('generateInsights - version preservation (R2 Task 10)', () => {
  it('regenerate keeps prior insights in `history` (existing 50-cap) for audit', async () => {
    const priorHistoryInsight = {
      id: 'pattern_career_anticipation',
      type: 'pattern_correlation',
      title: 'Career Anticipation Pattern',
      summary: 'prior summary',
      priority: 3,
      lastSeen: { toMillis: () => Date.now() - 100000 },
    };

    getDoc.mockImplementation(async (ref) => {
      if (ref?.__path?.endsWith('nexus/insights')) {
        return { exists: () => true, data: () => ({ active: [], history: [priorHistoryInsight] }) };
      }
      return { exists: () => false, data: () => ({}) };
    });
    getExcludedEntryIds.mockResolvedValueOnce(new Set());
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildRestoreEntries()));

    await generateInsights('user-1');

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].history));
    expect(persistCall).toBeTruthy();
    const persistedIds = persistCall[1].history.map((i) => i.id);
    // The prior insight survives the regenerate for audit, even though this
    // generation's fixture doesn't happen to re-produce the exact same
    // career_anticipation pattern (entries here are yoga/neutral, not
    // interview entries).
    expect(persistedIds).toContain('pattern_career_anticipation');
  });
});
