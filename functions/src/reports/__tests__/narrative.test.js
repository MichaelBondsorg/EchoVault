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

import { generateWeeklyTemplate, generatePremiumNarrative, callGeminiWithRetry } from '../narrative.js';
import { callGemini } from '../../shared/gemini.js';
import { getModel } from '../../models/registry.js';

const fakeDb = { __fake: 'db' };

describe('generateWeeklyTemplate', () => {
  it('produces 3 sections without calling Gemini', () => {
    const analytics = { entryCount: 5, moodAvg: 7.2, topTheme: 'personal growth' };
    const nexus = { insights: [{ content: 'You tend to journal more on weekends.' }] };

    const sections = generateWeeklyTemplate(analytics, nexus);

    expect(sections).toHaveLength(3);
    expect(sections[0].id).toBe('summary');
    expect(sections[1].id).toBe('insight');
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

  it('uses fallback text when no insights available', () => {
    const sections = generateWeeklyTemplate({ entryCount: 2 }, { insights: [] });
    expect(sections[1].narrative).toContain('Keep journaling');
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

    it('summary and insight sections get the full period entry id list', () => {
      const sections = generateWeeklyTemplate({ entryCount: 3 }, {}, entries);
      const summary = sections.find(s => s.id === 'summary');
      const insight = sections.find(s => s.id === 'insight');
      expect(summary.entryRefs).toEqual(['e1', 'e2', 'e3']);
      expect(insight.entryRefs).toEqual(['e1', 'e2', 'e3']);
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

  it('every section entryRefs equals the first 8 source entry ids (uniform builder input)', async () => {
    callGemini.mockResolvedValue('Generated narrative text.');
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `e${i + 1}`, date: '2026-01-01', text: 'x' }));
    const expectedIds = entries.slice(0, 8).map(e => e.id);

    const contextData = {
      entries, analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] }, health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key', fakeDb);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.entryRefs).toEqual(expectedIds);
    }
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
