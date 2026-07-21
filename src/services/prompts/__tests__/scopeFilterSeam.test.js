/**
 * Adversarial scope-filter test for the dashboard-prompts retrieval seam (R1
 * plan task 10): generateDashboardPrompts / generateDaySummary must apply
 * filterEntriesByScope AFTER the existing category filter (both compose),
 * so a Work-scoped call can never surface Personal-space or unscoped entry
 * content in the AI-facing prompt text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../ai', () => ({ callGemini: vi.fn() }));
vi.mock('../../nexus/compat', () => ({
  generateProactiveContext: vi.fn(() => []),
  computeActivitySentiment: vi.fn(() => []),
}));
// generateDashboardPrompts/generateDaySummary pull in '../analysis', which
// imports the real '../../config/firebase' — avoid it here (it triggers an
// unhandled Firebase Messaging rejection under jsdom, same as
// analysis/__tests__/analysisFailure.test.js works around).
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { callGemini } = await import('../../ai');
const { generateDashboardPrompts, generateDaySummary } = await import('../index');

const DAY_SUMMARY_JSON = JSON.stringify({
  wins: { items: [], tone: 'encouraging' },
  challenges: { items: [], cbt_reframe: null, tone: 'supportive' },
  action_items: { today: [], carried_forward: [], suggested: [] },
  patterns: { observations: [], mood_note: null },
  overall_mood: 0.5,
  one_liner: 'ok',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateDashboardPrompts - scope filter seam', () => {
  it('Work-scoped call never surfaces Personal-space or unscoped goal content, even within the same category', async () => {
    // All three entries share category:'work' so the pre-existing category
    // filter alone cannot separate them — only the scope filter can.
    const entries = [
      { id: 'work-1', category: 'work', spaceId: 'work-space', tags: ['@goal:ship_feature'], text: 'Shipping the feature', createdAt: new Date() },
      { id: 'personal-1', category: 'work', spaceId: 'personal-space', tags: ['@goal:secret_personal_goal'], text: 'Secret personal goal', createdAt: new Date() },
      { id: 'unscoped-1', category: 'work', tags: ['@goal:unscoped_goal'], text: 'Unscoped entry', createdAt: new Date() },
    ];
    callGemini.mockResolvedValue(JSON.stringify(['Still working on ship feature?']));

    const prompts = await generateDashboardPrompts(entries, 'work', { spaceId: 'work-space' });

    expect(callGemini).toHaveBeenCalledTimes(1);
    const promptArg = callGemini.mock.calls[0][0];
    expect(promptArg).toContain('ship feature');
    expect(promptArg).not.toContain('secret personal goal');
    expect(promptArg).not.toContain('unscoped goal');
    expect(prompts.some((p) => p.prompt?.includes('ship feature'))).toBe(true);
  });

  it('null scope preserves legacy behavior: identical to omitting the scope arg', async () => {
    const entries = [
      { id: 'work-1', category: 'work', spaceId: 'work-space', tags: ['@goal:ship_feature'], text: 'Shipping the feature', createdAt: new Date() },
    ];
    callGemini.mockResolvedValue(JSON.stringify(['Still working on ship feature?']));

    const withoutScopeArg = await generateDashboardPrompts(entries, 'work');
    const withNullScope = await generateDashboardPrompts(entries, 'work', null);

    expect(withNullScope).toEqual(withoutScopeArg);
  });
});

describe('generateDaySummary - scope filter seam', () => {
  it('Work-scoped call excludes Personal-space entry text from the AI-facing prompt', async () => {
    const todayEntries = [
      { id: 'work-1', category: 'work', spaceId: 'work-space', text: 'Work entry today', createdAt: new Date() },
      { id: 'personal-1', category: 'work', spaceId: 'personal-space', text: 'PERSONAL_SECRET entry today', createdAt: new Date() },
    ];
    callGemini.mockResolvedValue(DAY_SUMMARY_JSON);

    await generateDaySummary(todayEntries, todayEntries, 'work', { spaceId: 'work-space' });

    expect(callGemini).toHaveBeenCalledTimes(1);
    const promptArg = callGemini.mock.calls[0][0];
    expect(promptArg).toContain('Work entry today');
    expect(promptArg).not.toContain('PERSONAL_SECRET');
  });

  it('Work-scoped call with ONLY Personal-space entries returns null (nothing left after filtering)', async () => {
    const todayEntries = [
      { id: 'personal-1', category: 'work', spaceId: 'personal-space', text: 'PERSONAL_SECRET entry today', createdAt: new Date() },
    ];

    const result = await generateDaySummary(todayEntries, todayEntries, 'work', { spaceId: 'work-space' });

    expect(result).toBeNull();
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('null scope preserves legacy behavior: identical to omitting the scope arg', async () => {
    const todayEntries = [
      { id: 'work-1', category: 'work', text: 'Only entry', createdAt: new Date() },
    ];
    callGemini.mockResolvedValue(DAY_SUMMARY_JSON);

    const withoutScopeArg = await generateDaySummary(todayEntries, todayEntries, 'work');
    const withNullScope = await generateDaySummary(todayEntries, todayEntries, 'work', null);

    expect(withNullScope).toEqual(withoutScopeArg);
  });
});
