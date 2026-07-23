/**
 * Versioned cutover tests (R4 Task 6, ratified decision 2 — "legacy
 * artifact cutover, not migration").
 *
 * Mirrors the mocking harness in orchestrator.exclusions.test.js /
 * orchestrator.receipts.test.js exactly (path-aware `doc()` mock so
 * `getDoc` can tell the `nexus/insights` existing-doc read apart from the
 * `settings/nexus` read — orchestrator.js calls real getDoc for both).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => ({ __path: args.slice(1).join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn((...args) => ({ __path: args.slice(1).join('/') })),
  query: vi.fn((...args) => ({ __args: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [], forEach: () => {} })),
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

vi.mock('../gapDetector', () => ({ detectGaps: vi.fn(async () => []) }));

vi.mock('../layer1/threadManager', () => ({
  getActiveThreads: vi.fn(async () => []),
  identifyThreadAssociation: vi.fn(async () => ({})),
}));

vi.mock('../layer1/somaticExtractor', () => ({ extractSomaticSignals: vi.fn(() => []) }));

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

// beliefDissonance.js / counterfactual.js mocks deleted R4-P3 per P3-D1
// (superseded by claims+experiments; legacy Firestore belief docs may
// remain, harmless). layer4/interventionTracker.js mock deleted R4-P3
// Task 5 per P3-D1 — the module is deleted whole; orchestrator.js no
// longer imports it.

vi.mock('../layer4/recommendationEngine', () => ({ generateRecommendations: vi.fn(async () => []) }));

const getExcludedEntryIds = vi.fn(async () => new Set());
vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: (...a) => getExcludedEntryIds(...a),
}));

const { getDocs, getDoc, setDoc, collection } = await import('firebase/firestore');
const { generateInsights, generatorVersion } = await import('../orchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

function mockEntriesSnapshot(entries) {
  return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
}

// Same fixture shape as orchestrator.receipts.test.js: enough real entries
// for Layer 1 pattern detection + the orchestrator's own entity-correlation
// math to produce at least one genuinely new insight, so "new actives get
// stamped" isn't a vacuous check against an empty array.
function buildFixtureEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [];
  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `interview-${i}`,
      createdAt: new Date(now - i * DAY_MS).toISOString(),
      text: `Had another interview today, feeling good about it. Entry number ${i}.`,
      analysis: { mood_score: 0.80 },
    });
  }
  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
      analysis: { mood_score: 0.85 },
    });
  }
  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 8) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 0.50 },
    });
  }
  return entries;
}

beforeEach(() => {
  getDocs.mockReset();
  getDoc.mockReset();
  setDoc.mockClear();
  collection.mockClear();
  getExcludedEntryIds.mockReset();
  getExcludedEntryIds.mockResolvedValue(new Set());
  getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  getDocs.mockResolvedValue({ docs: [], forEach: () => {} });
});

describe('generatorVersion export', () => {
  it('is a positive integer starting at 2 (version 1 = the pre-R4 engines, never stamped anywhere)', () => {
    expect(typeof generatorVersion).toBe('number');
    expect(Number.isInteger(generatorVersion)).toBe(true);
    expect(generatorVersion).toBe(2);
  });
});

describe('saveInsights — versioned cutover (R4 Task 6)', () => {
  it('every persisted `active` insight is stamped with the current generatorVersion', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));

    const result = await generateInsights('user-cutover-1');
    expect(result.success).toBe(true);

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();
    expect(persistCall[1].active.length).toBeGreaterThan(0);
    for (const insight of persistCall[1].active) {
      expect(insight.generatorVersion).toBe(generatorVersion);
    }
  });

  it('a legacy active insight (no generatorVersion at all) is archived into history with legacyVersion:true — not silently dropped, not left active', async () => {
    const legacyInsight = {
      id: 'pattern_legacy_one',
      type: 'pattern_correlation',
      title: 'A pre-R4 pattern',
      summary: 'legacy summary',
      priority: 3,
      // no generatorVersion field at all — implicit version 1
    };

    getDoc.mockImplementation(async (ref) => {
      if (ref?.__path?.endsWith('nexus/insights')) {
        return { exists: () => true, data: () => ({ active: [legacyInsight], history: [] }) };
      }
      return { exists: () => false, data: () => ({}) };
    });
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));

    await generateInsights('user-cutover-2');

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();

    // Not left in `active` under its own steam (active is wholesale-replaced
    // by this generation's own new insights, unchanged pre-existing
    // behavior) —
    expect(persistCall[1].active.find((i) => i.id === 'pattern_legacy_one')).toBeUndefined();

    // — but archived into `history`, marked, nothing deleted.
    const archived = persistCall[1].history.find((i) => i.id === 'pattern_legacy_one');
    expect(archived).toBeTruthy();
    expect(archived.legacyVersion).toBe(true);
    expect(archived.title).toBe('A pre-R4 pattern');
  });

  it('an active insight already stamped with the CURRENT version is left alone (no legacyVersion mark) even though it still falls out of `active` on overwrite', async () => {
    const currentInsight = {
      id: 'pattern_current_one',
      type: 'pattern_correlation',
      title: 'An R4-generation pattern',
      summary: 'current summary',
      priority: 3,
      generatorVersion,
    };

    getDoc.mockImplementation(async (ref) => {
      if (ref?.__path?.endsWith('nexus/insights')) {
        return { exists: () => true, data: () => ({ active: [currentInsight], history: [] }) };
      }
      return { exists: () => false, data: () => ({}) };
    });
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));

    await generateInsights('user-cutover-3');

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    const archived = persistCall[1].history.find((i) => i.id === 'pattern_current_one');
    // Mutation-check control: proves the version filter is real (only
    // UNVERSIONED/stale items get the archive treatment), not "archive
    // everything from the old active array."
    expect(archived).toBeUndefined();
  });

  it('cutover paths never write insightLearning, insight_exclusions, or source_exclusions — feedback/exclusions are preserved by construction', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));
    await generateInsights('user-cutover-4');

    const writtenPaths = setDoc.mock.calls
      .map((call) => call[0]?.__path)
      .filter(Boolean);
    for (const path of writtenPaths) {
      expect(path).not.toMatch(/insightLearning|insight_exclusions|source_exclusions/);
    }
    // The only real write in this pipeline is the nexus/insights doc itself.
    expect(writtenPaths.some((p) => p.endsWith('nexus/insights'))).toBe(true);
  });
});
