/**
 * Report Narrative Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini helper
vi.mock('../../shared/gemini.js', () => ({
  callGemini: vi.fn(),
}));

// Mock the model registry (entryRefs/model tests don't need real flag reads)
vi.mock('../../models/registry.js', () => ({
  getModel: vi.fn(),
}));

import { generateWeeklyTemplate, generatePremiumNarrative, callGeminiWithRetry, selectRepresentativeEntries } from '../narrative.js';
import { callGemini } from '../../shared/gemini.js';
import { getModel } from '../../models/registry.js';

const fakeDb = { __fake: 'db' };

// A minimal verified-claim fixture (P2-D6) — only the fields
// formatClaimLine/buildHeldUpSection/buildSectionPrompt actually read.
// readVerifiedClaims (generator.js) is what enforces the full
// status/supersededByClaimId/ranking contract before a claim ever reaches
// narrative.js, so these narrative-layer tests don't need buildClaim's full
// shape (analysisPlan, receipt, etc.).
function claimFixture(overrides = {}) {
  return {
    id: 'claim_gym_v1',
    claimType: 'pattern_to_watch',
    status: 'verified',
    supersededByClaimId: null,
    wording: 'On days you logged gym, your recorded mood averaged 7 points higher.',
    limitations: ['Same-day association only, not causation.'],
    evidence: {
      exposedDayCount: 9,
      comparisonDayCount: 15,
      effectMoodPoints: 7.2,
      sourceEntryIds: ['claim-e1', 'claim-e2'],
    },
    createdAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateWeeklyTemplate', () => {
  it('produces 3 sections without calling Gemini', () => {
    const analytics = { entryCount: 5, moodAvg: 7.2, topTheme: 'personal growth' };
    const nexus = { insights: [{ content: 'You tend to journal more on weekends.' }] };

    const sections = generateWeeklyTemplate(analytics, nexus);

    expect(sections).toHaveLength(3);
    expect(sections[0].id).toBe('summary');
    expect(sections[1].id).toBe('held_up');
    expect(sections[2].id).toBe('mood_trend');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('includes entry count in summary', () => {
    const sections = generateWeeklyTemplate({ entryCount: 3 }, {});
    expect(sections[0].narrative).toContain('3 journal entries');
  });

  it('handles singular entry count', () => {
    const sections = generateWeeklyTemplate({ entryCount: 1 }, {});
    expect(sections[0].narrative).toContain('1 journal entry');
  });

  it('nexusData no longer feeds the held_up section — even a populated Nexus insights array is ignored (P2-D6)', () => {
    const nexusWithInsights = { insights: [{ id: 'insight_1', summary: 'NEXUS-PROSE-SHOULD-NOT-APPEAR', title: 'x' }] };
    const sections = generateWeeklyTemplate({ entryCount: 2 }, nexusWithInsights, [], []);
    const heldUp = sections.find(s => s.id === 'held_up');
    expect(heldUp.narrative).not.toContain('NEXUS-PROSE-SHOULD-NOT-APPEAR');
  });

  describe('held_up section — verified claims only (P2-D6)', () => {
    it('zero claims -> explicit "no verified patterns" copy, never a nexus-prose fallback', () => {
      const sections = generateWeeklyTemplate({ entryCount: 2 }, { insights: [{ summary: 'nexus prose' }] }, [], []);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.narrative).toContain('No verified patterns');
      expect(heldUp.narrative).not.toContain('nexus prose');
    });

    it('renders the top-ranked claim\'s wording + day-count line + first limitation', () => {
      const claim = claimFixture();
      const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], [claim]);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.narrative).toContain(claim.wording);
      expect(heldUp.narrative).toContain('9 vs 15 days');
      expect(heldUp.narrative).toContain(claim.limitations[0]);
    });

    it('uses only the FIRST claim when multiple are passed (single top-ranked claim per section)', () => {
      const top = claimFixture({ wording: 'TOP claim wording.' });
      const second = claimFixture({ id: 'claim_2', wording: 'SECOND claim wording.' });
      const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], [top, second]);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.narrative).toContain('TOP claim wording.');
      expect(heldUp.narrative).not.toContain('SECOND claim wording.');
    });

    it('entryRefs cites the claim\'s own evidence.sourceEntryIds when present', () => {
      const claim = claimFixture();
      const entries = [{ id: 'period-e1' }, { id: 'period-e2' }];
      const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, entries, [claim]);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.entryRefs).toEqual(['claim-e1', 'claim-e2']);
    });

    it('entryRefs falls back to the full period id list when there are zero claims', () => {
      const entries = [{ id: 'period-e1' }, { id: 'period-e2' }];
      const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, entries, []);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.entryRefs).toEqual(['period-e1', 'period-e2']);
    });
  });

  it('labels mood correctly', () => {
    const positive = generateWeeklyTemplate({ entryCount: 1, moodAvg: 8 }, {});
    expect(positive[0].narrative).toContain('positive');

    const mixed = generateWeeklyTemplate({ entryCount: 1, moodAvg: 5 }, {});
    expect(mixed[0].narrative).toContain('mixed');

    const challenging = generateWeeklyTemplate({ entryCount: 1, moodAvg: 3 }, {});
    expect(challenging[0].narrative).toContain('challenging');
  });

  describe('entryRefs receipts', () => {
    const entries = [
      { id: 'e1', moodScore: 7 },
      { id: 'e2', moodScore: null },
      { id: 'e3', moodScore: 4 },
    ];

    it('defaults to empty entryRefs when no entries passed (back-compat)', () => {
      const sections = generateWeeklyTemplate({ entryCount: 3 }, {});
      expect(sections[0].entryRefs).toEqual([]);
      expect(sections[1].entryRefs).toEqual([]);
      expect(sections[2].entryRefs).toEqual([]);
    });

    it('summary and held_up (zero-claims fallback) sections get the full period entry id list', () => {
      const sections = generateWeeklyTemplate({ entryCount: 3 }, {}, entries);
      const summary = sections.find(s => s.id === 'summary');
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(summary.entryRefs).toEqual(['e1', 'e2', 'e3']);
      expect(heldUp.entryRefs).toEqual(['e1', 'e2', 'e3']);
    });

    it('mood_trend section only references entries with a mood score', () => {
      const sections = generateWeeklyTemplate({ entryCount: 3 }, {}, entries);
      const moodSection = sections.find(s => s.id === 'mood_trend');
      expect(moodSection.entryRefs).toEqual(['e1', 'e3']);
    });

    it('mood_trend entryRefs is empty when no entries have a mood score', () => {
      const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [
        { id: 'a', moodScore: null },
        { id: 'b', moodScore: undefined },
      ]);
      const moodSection = sections.find(s => s.id === 'mood_trend');
      expect(moodSection.entryRefs).toEqual([]);
    });
  });
});

describe('current_context section — non-period-overlapping claims (REP-01 fix #2)', () => {
  it('generateWeeklyTemplate omits the current_context section when currentClaims is empty/absent (back-compat: 3 sections)', () => {
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], []);
    expect(sections).toHaveLength(3);
    expect(sections.find((s) => s.id === 'current_context')).toBeUndefined();
  });

  it('generateWeeklyTemplate adds a current_context section, labeled "Current verified insights (not period-specific)", when currentClaims is non-empty', () => {
    const staleClaim = claimFixture({ wording: 'STALE claim wording.' });
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], [], [staleClaim]);
    const current = sections.find((s) => s.id === 'current_context');
    expect(current).toBeTruthy();
    expect(current.title).toBe('Current verified insights (not period-specific)');
    expect(current.narrative).toContain('STALE claim wording.');
  });

  it('current_context renders only the top-ranked current claim when multiple are passed', () => {
    const top = claimFixture({ id: 'c_top', wording: 'TOP current wording.' });
    const second = claimFixture({ id: 'c_second', wording: 'SECOND current wording.' });
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], [], [top, second]);
    const current = sections.find((s) => s.id === 'current_context');
    expect(current.narrative).toContain('TOP current wording.');
    expect(current.narrative).not.toContain('SECOND current wording.');
  });

  it("current_context entryRefs is the claim's own evidence.sourceEntryIds, NEVER the period's entry id list (no cross-period attribution via receipts)", () => {
    const claim = claimFixture();
    const periodEntries = [{ id: 'period-e1' }, { id: 'period-e2' }];
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, periodEntries, [], [claim]);
    const current = sections.find((s) => s.id === 'current_context');
    expect(current.entryRefs).toEqual(claim.evidence.sourceEntryIds);
    expect(current.entryRefs).not.toContain('period-e1');
    expect(current.entryRefs).not.toContain('period-e2');
  });

  it('current_context entryRefs is [] (not the period fallback) when the current claim has no sourceEntryIds', () => {
    const claim = claimFixture({
      evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 5, sourceEntryIds: [] },
    });
    const periodEntries = [{ id: 'period-e1' }];
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, periodEntries, [], [claim]);
    const current = sections.find((s) => s.id === 'current_context');
    expect(current.entryRefs).toEqual([]);
  });

  it('held_up (period claims) and current_context (non-overlapping claims) are independent and can both appear at once', () => {
    const periodClaim = claimFixture({ id: 'p1', wording: 'PERIOD claim wording.' });
    const currentClaim = claimFixture({ id: 'c1', wording: 'CURRENT claim wording.' });
    const sections = generateWeeklyTemplate({ entryCount: 2 }, {}, [], [periodClaim], [currentClaim]);
    expect(sections.find((s) => s.id === 'held_up').narrative).toContain('PERIOD claim wording.');
    const current = sections.find((s) => s.id === 'current_context');
    expect(current.narrative).toContain('CURRENT claim wording.');
    expect(current.narrative).not.toContain('PERIOD claim wording.');
  });

  describe('generatePremiumNarrative', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      getModel.mockResolvedValue('registry-insight-model-x');
      callGemini.mockResolvedValue('Generated narrative text.');
    });

    it('appends a current_context section when contextData.currentClaims is non-empty', async () => {
      const staleClaim = claimFixture({ wording: 'STALE not-period-specific claim.' });
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
        claims: [],
        currentClaims: [staleClaim],
      };

      const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
      const current = sections.find((s) => s.id === 'current_context');
      expect(current).toBeTruthy();
      expect(current.title).toBe('Current verified insights (not period-specific)');
      expect(current.narrative).toContain('STALE not-period-specific claim.');
    });

    it('omits current_context entirely when contextData.currentClaims is empty/absent', async () => {
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
        claims: [],
      };

      const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
      expect(sections.find((s) => s.id === 'current_context')).toBeUndefined();
    });

    it('currentClaims never reaches the LLM prompt (only contextData.claims — the period-overlapping half — does)', async () => {
      const staleClaim = claimFixture({ wording: 'CURRENT-CLAIM-SHOULD-NOT-REACH-PROMPT' });
      const periodClaim = claimFixture({ id: 'period_c', wording: 'PERIOD-CLAIM-SHOULD-REACH-PROMPT' });
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
        claims: [periodClaim],
        currentClaims: [staleClaim],
      };

      await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);

      expect(callGemini.mock.calls.length).toBeGreaterThan(0);
      for (const call of callGemini.mock.calls) {
        const userPrompt = call[2];
        expect(userPrompt).not.toContain('CURRENT-CLAIM-SHOULD-NOT-REACH-PROMPT');
        expect(userPrompt).toContain('PERIOD-CLAIM-SHOULD-REACH-PROMPT');
      }
    });
  });
});

describe('selectRepresentativeEntries (R4 Task 4)', () => {
  it('returns all entries unchanged when entries.length <= windowCount (sparse fixture)', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectRepresentativeEntries(entries, 8)).toEqual(entries);
  });

  it('returns [] for an empty array', () => {
    expect(selectRepresentativeEntries([], 8)).toEqual([]);
  });

  it('picks exactly one entry per window for a fixture spanning 8 evenly-sized windows', () => {
    // 8 weeks, 7 entries each, chronologically ordered (mirrors
    // generator.js's readEntries() ascending order guarantee).
    const entries = Array.from({ length: 56 }, (_, i) => ({ id: `e${i + 1}`, week: Math.floor(i / 7) }));
    const selected = selectRepresentativeEntries(entries, 8);

    expect(selected).toHaveLength(8);
    // One entry from each of the 8 weeks, in chronological (week) order.
    expect(selected.map(e => e.week)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('is deterministic — same input always produces the same output (no randomness)', () => {
    const entries = Array.from({ length: 23 }, (_, i) => ({ id: `e${i + 1}` }));
    const first = selectRepresentativeEntries(entries, 8).map(e => e.id);
    const second = selectRepresentativeEntries(entries, 8).map(e => e.id);
    expect(second).toEqual(first);
  });

  it('never fabricates entries — every selected item is a reference from the input array', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: `e${i + 1}` }));
    const selected = selectRepresentativeEntries(entries, 8);
    for (const item of selected) {
      expect(entries).toContain(item);
    }
  });

  it('returns entries.length items unchanged when entries.length === windowCount', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({ id: `e${i + 1}` }));
    expect(selectRepresentativeEntries(entries, 8)).toEqual(entries);
  });
});

describe('generatePremiumNarrative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  it('calls Gemini for monthly reports', async () => {
    callGemini.mockResolvedValue('Generated narrative text.');

    const contextData = {
      entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
      analytics: { entryCount: 10, moodAvg: 6.5 },
      signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] },
      health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
    expect(sections.length).toBeGreaterThan(0);
    expect(callGemini).toHaveBeenCalled();
  });

  it('returns partial sections on Gemini failure', async () => {
    let callCount = 0;
    callGemini.mockImplementation(() => {
      callCount++;
      // Fail on first section (3 retries), succeed on rest
      if (callCount <= 3) return null;
      return 'Success text.';
    });

    const contextData = {
      entries: [], analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] }, health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
    // First section should have fallback text
    expect(sections[0].narrative).toContain('could not be generated');
    // Later sections should have generated text
    const successSections = sections.filter(s => s.narrative === 'Success text.');
    expect(successSections.length).toBeGreaterThan(0);
  });

  it('throws for unknown cadence', async () => {
    await expect(generatePremiumNarrative('biweekly', {}, 'key', fakeDb))
      .rejects.toThrow('Unknown cadence');
  });

  it('resolves the model via the registry (workload "insight") and forwards it to Gemini', async () => {
    callGemini.mockResolvedValue('Generated narrative text.');
    getModel.mockResolvedValue('registry-insight-model-x');

    const contextData = {
      entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
      analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] }, health: {},
    };

    await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);

    expect(getModel).toHaveBeenCalledWith(fakeDb, 'insight');
    // Every callGemini invocation should carry the registry-resolved model
    // (4th positional arg), not a hardcoded/default model id.
    for (const call of callGemini.mock.calls) {
      expect(call[3]).toBe('registry-insight-model-x');
    }
  });

  it('every section entryRefs equals the representative-sampled entry ids (uniform builder input, R4 Task 4)', async () => {
    callGemini.mockResolvedValue('Generated narrative text.');
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `e${i + 1}`, date: '2026-01-01', text: 'x' }));
    const expectedIds = selectRepresentativeEntries(entries, 8).map(e => e.id);

    const contextData = {
      entries, analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] }, health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.entryRefs).toEqual(expectedIds);
    }
    // Proves this is genuinely NOT the old first-8-chronological slice.
    expect(expectedIds).not.toEqual(entries.slice(0, 8).map(e => e.id));
  });

  describe('held_up section + claims-fed prompt (P2-D6)', () => {
    it('appends a "held_up" section rendering the top verified claim, never LLM-authored', async () => {
      callGemini.mockResolvedValue('Generated narrative text.');
      const claim = claimFixture();
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
        claims: [claim],
      };

      const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp).toBeTruthy();
      expect(heldUp.title).toBe('What held up this period');
      expect(heldUp.narrative).toContain(claim.wording);
      expect(heldUp.narrative).toContain('9 vs 15 days');
      expect(heldUp.narrative).toContain(claim.limitations[0]);
      // Deterministic — this section's text does not come from a Gemini call.
      expect(heldUp.narrative).not.toBe('Generated narrative text.');
    });

    it('zero claims -> held_up renders the explicit "no verified patterns" copy, never a nexus-prose fallback', async () => {
      callGemini.mockResolvedValue('Generated narrative text.');
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [{ id: 'pattern_x', summary: 'NEXUS-PROSE-SHOULD-NOT-APPEAR' }] },
        health: {},
        claims: [],
      };

      const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
      const heldUp = sections.find(s => s.id === 'held_up');
      expect(heldUp.narrative).toContain('No verified patterns');
      expect(heldUp.narrative).not.toContain('NEXUS-PROSE-SHOULD-NOT-APPEAR');
    });

    it('feeds claims wording into the LLM prompt and NEVER a nexus fixture\'s summary (negative assertion)', async () => {
      callGemini.mockResolvedValue('Generated narrative text.');
      const claim = claimFixture();
      const contextData = {
        entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
        analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        // Populated nexus fixture — its summary must NEVER reach the prompt
        // (P2-D6: nexusInsightLabel's "Detected patterns:" injection removed).
        nexus: { patterns: [{ id: 'pattern_x', summary: 'NEXUS-FIXTURE-SUMMARY-TEXT', title: 'Nexus Pattern' }] },
        health: {},
        claims: [claim],
      };

      await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);

      expect(callGemini.mock.calls.length).toBeGreaterThan(0);
      for (const call of callGemini.mock.calls) {
        const userPrompt = call[2];
        expect(userPrompt).not.toContain('NEXUS-FIXTURE-SUMMARY-TEXT');
        expect(userPrompt).toContain(claim.wording);
      }
    });
  });

  describe('entryRefs — quarterly/annual union with month-sampled ids (finding 1, R4 Task 4)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      getModel.mockResolvedValue('registry-insight-model-x');
      callGemini.mockResolvedValue('Generated narrative text.');
    });

    // 5 entries in January (all sampled by preSummarizeByMonth's per-month
    // cap of 10), 12 entries in February (only the first 10 are sampled —
    // over the cap).
    function buildEntries() {
      const jan = Array.from({ length: 5 }, (_, i) => ({ id: `id${i + 1}`, date: '2026-01-10', text: 'jan' }));
      const feb = Array.from({ length: 12 }, (_, i) => ({ id: `id${i + 6}`, date: '2026-02-10', text: 'feb' }));
      return [...jan, ...feb];
    }

    it.each(['quarterly', 'annual'])('%s entryRefs = union(representative-sampled ids, all month-sampled ids)', async (cadence) => {
      const entries = buildEntries();
      const contextData = {
        entries, analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
      };

      const sections = await generatePremiumNarrative(cadence, contextData, 'test-key', fakeDb);
      expect(sections.length).toBeGreaterThan(0);

      const representativeIds = selectRepresentativeEntries(entries, 8).map(e => e.id);
      // Month sampling: Jan (5 entries) is entirely within the per-month
      // cap of 10; Feb (12) is capped to its first 10.
      const monthSampleIds = [
        ...entries.filter(e => e.date.startsWith('2026-01')).map(e => e.id),
        ...entries.filter(e => e.date.startsWith('2026-02')).slice(0, 10).map(e => e.id),
      ];
      const expectedIds = new Set([...representativeIds, ...monthSampleIds]);

      for (const section of sections) {
        expect(new Set(section.entryRefs)).toEqual(expectedIds);
        // Proves this isn't just slice(0,8): more than 8 ids cited.
        expect(section.entryRefs.length).toBeGreaterThan(8);
      }
      // The 2 entries never sampled by either mechanism must stay absent —
      // no fabricated/over-claimed provenance.
      const allIds = new Set(entries.map(e => e.id));
      const neverSampled = [...allIds].filter(id => !expectedIds.has(id));
      expect(neverSampled.length).toBeGreaterThan(0);
      for (const section of sections) {
        for (const id of neverSampled) {
          expect(section.entryRefs).not.toContain(id);
        }
      }
    });

    it('monthly does NOT pre-summarize by month, so entryRefs stays the plain representative sample (no month-sample union)', async () => {
      const entries = buildEntries();
      const contextData = {
        entries, analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
        nexus: { patterns: [] }, health: {},
      };

      const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
      const expectedIds = selectRepresentativeEntries(entries, 8).map(e => e.id);
      for (const section of sections) {
        expect(section.entryRefs).toEqual(expectedIds);
      }
    });
  });

  it('entryRefs is still populated on the fallback ("could not be generated") path', async () => {
    // Only the first section exhausts its retries (3 nulls); the rest
    // succeed — mirrors 'returns partial sections on Gemini failure' above,
    // bounding this test's real retry-delay wall time.
    let callCount = 0;
    callGemini.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return null;
      return 'Success text.';
    });
    const entries = [{ id: 'e1', date: '2026-01-01', text: 'x' }, { id: 'e2', date: '2026-01-02', text: 'y' }];

    const contextData = {
      entries, analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] }, health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
    expect(sections[0].narrative).toContain('could not be generated');
    expect(sections[0].entryRefs).toEqual(['e1', 'e2']);
  });
});

describe('callGeminiWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result on first success', async () => {
    callGemini.mockResolvedValue('Success');
    const result = await callGeminiWithRetry('key', 'sys', 'user');
    expect(result).toBe('Success');
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it('retries on null result', async () => {
    callGemini
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('Success');

    const result = await callGeminiWithRetry('key', 'sys', 'user', 'model-id', 3);
    expect(result).toBe('Success');
    expect(callGemini).toHaveBeenCalledTimes(2);
  });

  it('returns null after all retries exhausted', async () => {
    callGemini.mockResolvedValue(null);
    const result = await callGeminiWithRetry('key', 'sys', 'user', 'model-id', 2);
    expect(result).toBeNull();
    expect(callGemini).toHaveBeenCalledTimes(2);
  });

  it('forwards the model id to callGemini', async () => {
    callGemini.mockResolvedValue('Success');
    await callGeminiWithRetry('key', 'sys', 'user', 'registry-model-y');
    expect(callGemini).toHaveBeenCalledWith('key', 'sys', 'user', 'registry-model-y');
  });
});
