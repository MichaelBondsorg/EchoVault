/**
 * Report Narrative Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini helper
vi.mock('../../shared/gemini.js', () => ({
  callGemini: vi.fn(),
}));

import { generateWeeklyTemplate, generatePremiumNarrative, callGeminiWithRetry } from '../narrative.js';
import { callGemini } from '../../shared/gemini.js';

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
});

describe('generatePremiumNarrative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Gemini for monthly reports', async () => {
    callGemini.mockResolvedValue('Generated narrative text.');

    const contextData = {
      entries: [{ date: '2026-01-15', text: 'Test entry' }],
      analytics: { entryCount: 10, moodAvg: 6.5 },
      signals: { activeGoals: [], achievedGoals: [] },
      nexus: { patterns: [] },
      health: {},
    };

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key');
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

    const sections = await generatePremiumNarrative('monthly', contextData, 'test-key');
    // First section should have fallback text
    expect(sections[0].narrative).toContain('could not be generated');
    // Later sections should have generated text
    const successSections = sections.filter(s => s.narrative === 'Success text.');
    expect(successSections.length).toBeGreaterThan(0);
  });

  it('throws for unknown cadence', async () => {
    await expect(generatePremiumNarrative('biweekly', {}, 'key'))
      .rejects.toThrow('Unknown cadence');
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

    const result = await callGeminiWithRetry('key', 'sys', 'user', 3);
    expect(result).toBe('Success');
    expect(callGemini).toHaveBeenCalledTimes(2);
  });

  it('returns null after all retries exhausted', async () => {
    callGemini.mockResolvedValue(null);
    const result = await callGeminiWithRetry('key', 'sys', 'user', 2);
    expect(result).toBeNull();
    expect(callGemini).toHaveBeenCalledTimes(2);
  });
});
