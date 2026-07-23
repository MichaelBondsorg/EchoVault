/**
 * Basic Insights orchestrator — claims pipeline hook (R4 Phase 1).
 *
 * `generateBasicInsights` fires the flag-gated, error-contained
 * `generateClaims` call after legacy insights are computed/cached: OFF ->
 * never called; ON -> called once with (db, userId, entries); a pipeline
 * throw must never surface as a failed basicInsights generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: { __fakeDb: true } }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// Feedback learning touches Firestore internally; stub to a pure pass-through
// so this test stays focused on the claims hook, matching the receipts test
// precedent's isolation strategy.
vi.mock('../feedbackLearning', () => ({
  filterFalsePositiveCandidates: vi.fn(async (userId, insights) => insights),
  filterInsightsByLearning: vi.fn(async (userId, insights) =>
    insights.map((i) => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1 } }))
  ),
}));

const getFlagMock = vi.fn(() => false);
vi.mock('../../../config/flags', () => ({ getFlag: (...args) => getFlagMock(...args) }));

const generateClaimsMock = vi.fn(async () => ({ written: 0, superseded: 0, candidatesTested: 0, eligible: 0 }));
vi.mock('../../insights/claims/claimsPipeline', () => ({ generateClaims: (...args) => generateClaimsMock(...args) }));

const { generateBasicInsights } = await import('../basicInsightsOrchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - i * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
      analysis: { mood_score: 0.9 },
    });
  }
  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 5) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 0.5 },
    });
  }
  return entries;
}

beforeEach(() => {
  getFlagMock.mockReset().mockReturnValue(false);
  generateClaimsMock.mockReset().mockResolvedValue({ written: 0, superseded: 0, candidatesTested: 0, eligible: 0 });
});

describe('generateBasicInsights — claims pipeline hook (R4 Phase 1)', () => {
  it('flag OFF: generateClaims is never called', async () => {
    getFlagMock.mockReturnValue(false);
    const result = await generateBasicInsights('user-1', buildEntries());

    expect(result.success).toBe(true);
    expect(getFlagMock).toHaveBeenCalledWith('insightClaims');
    expect(generateClaimsMock).not.toHaveBeenCalled();
  });

  it('flag ON: generateClaims is called once with (db, userId, entries)', async () => {
    getFlagMock.mockReturnValue(true);
    const entries = buildEntries();
    const result = await generateBasicInsights('user-1', entries);

    expect(result.success).toBe(true);
    expect(generateClaimsMock).toHaveBeenCalledTimes(1);
    const [dbArg, userIdArg, entriesArg] = generateClaimsMock.mock.calls[0];
    expect(dbArg).toEqual({ __fakeDb: true });
    expect(userIdArg).toBe('user-1');
    expect(entriesArg).toBe(entries);
  });

  it('flag ON, pipeline throws: orchestrator still returns success (legacy insights unaffected)', async () => {
    getFlagMock.mockReturnValue(true);
    generateClaimsMock.mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateBasicInsights('user-1', buildEntries());

    expect(result.success).toBe(true);
    expect(result.insights.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('RED: flag ON, pipeline throws: result includes claims.ok === false (binding gap)', async () => {
    getFlagMock.mockReturnValue(true);
    generateClaimsMock.mockRejectedValue(new Error('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateBasicInsights('user-1', buildEntries());

    // Legacy insights still succeed
    expect(result.success).toBe(true);
    expect(result.insights.length).toBeGreaterThan(0);
    // BUT: claims outcome is captured, not swallowed
    expect(result.claims).toBeDefined();
    expect(result.claims.ok).toBe(false);
    expect(result.claims.error).toBe('Error'); // Error name from mocked error
    expect(warnSpy).toHaveBeenCalled();
  });

  it('RED: flag ON, pipeline succeeds: result includes claims.ok === true', async () => {
    getFlagMock.mockReturnValue(true);
    generateClaimsMock.mockResolvedValue({ written: 2, superseded: 0, candidatesTested: 5, eligible: 3 });

    const result = await generateBasicInsights('user-1', buildEntries());

    expect(result.success).toBe(true);
    expect(result.claims).toBeDefined();
    expect(result.claims.ok).toBe(true);
    expect(result.claims.written).toBe(2);
    expect(result.claims.eligible).toBe(3);
  });
});
