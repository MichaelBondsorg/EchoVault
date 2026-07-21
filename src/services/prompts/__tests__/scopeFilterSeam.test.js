/**
 * Adversarial scope-filter test for the dashboard-prompts retrieval seam (R1
 * plan task 10): generateDaySummary must apply filterEntriesByScope AFTER
 * the existing category filter (both compose), so a Work-scoped call can
 * never surface Personal-space or unscoped entry content in the AI-facing
 * prompt text.
 *
 * generateDashboardPrompts's scope-filter coverage was removed here (R2 Task
 * 6, 2026-07-21): that function itself was retired as dead code (no
 * production importer anywhere — it was only ever reachable via the
 * extractTodayFollowUps/futureMentions reader chain that Open Loops replaced
 * in R1). See src/services/prompts/index.js and task-6-report.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../ai', () => ({ callGemini: vi.fn() }));
vi.mock('../../nexus/compat', () => ({
  generateProactiveContext: vi.fn(() => []),
  computeActivitySentiment: vi.fn(() => []),
}));
// generateDaySummary pulls in '../analysis', which imports the real
// '../../config/firebase' — avoid it here (it triggers an unhandled
// Firebase Messaging rejection under jsdom, same as
// analysis/__tests__/analysisFailure.test.js works around).
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { callGemini } = await import('../../ai');
const { generateDaySummary } = await import('../index');

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
