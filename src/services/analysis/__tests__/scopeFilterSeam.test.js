/**
 * Adversarial scope-filter test for the analysis retrieval seam (R1 plan
 * task 10): getSmartChatContext / askJournalAI must apply
 * filterEntriesByScope FIRST, before semantic/tag/recent candidate
 * selection, so a Work-scoped call can never surface a Personal-space or
 * unscoped entry as a candidate — even when that entry would otherwise be
 * the strongest semantic/tag/recency match.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { askJournalAIFn } = await import('../../../config/firebase');
const { getSmartChatContext, askJournalAI, generateDaySummary } = await import('../index');

// Identical embedding across all entries -> similarity 1.0 for every one of
// them pre-filter, so this deliberately maximizes semantic-match leakage risk.
const SHARED_EMBEDDING = [1, 0, 0];

function mixedCorpus() {
  return [
    {
      id: 'work-1',
      spaceId: 'work',
      text: 'Sarah and I discussed the roadmap for the Q3 launch',
      tags: ['@person:sarah', '@goal:launch_q3'],
      embedding: SHARED_EMBEDDING,
    },
    {
      id: 'personal-1',
      spaceId: 'personal',
      text: 'Sarah and I had dinner and talked about the wedding',
      tags: ['@person:sarah', '@goal:launch_q3'],
      embedding: SHARED_EMBEDDING,
    },
    {
      id: 'unscoped-1',
      // No spaceId at all — pre-Context-Spaces legacy entry.
      text: 'Sarah mentioned the launch again today',
      tags: ['@person:sarah', '@goal:launch_q3'],
      embedding: SHARED_EMBEDDING,
    },
  ];
}

describe('getSmartChatContext - scope filter seam', () => {
  it('Work-scoped call never returns Personal-space or unscoped candidate ids', async () => {
    const entries = mixedCorpus();
    const result = await getSmartChatContext(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING, { spaceId: 'work' });
    const ids = result.map((e) => e.id);
    expect(ids).toContain('work-1');
    expect(ids).not.toContain('personal-1');
    expect(ids).not.toContain('unscoped-1');
  });

  it('null scope preserves legacy behavior: same candidates as an unscoped call', async () => {
    const entries = mixedCorpus();
    const withNullScope = await getSmartChatContext(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING, null);
    const withoutScopeArg = await getSmartChatContext(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING);
    expect(withNullScope.map((e) => e.id).sort()).toEqual(withoutScopeArg.map((e) => e.id).sort());
    // Sanity: legacy (unscoped) behavior surfaces all three candidates.
    expect(withoutScopeArg.map((e) => e.id).sort()).toEqual(['personal-1', 'unscoped-1', 'work-1']);
  });
});

describe('askJournalAI - scope filter seam', () => {
  it('Work-scoped call never embeds Personal-space or unscoped entry text into the AI context', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'ok' } });
    const entries = mixedCorpus();

    await askJournalAI(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING, { spaceId: 'work' });

    expect(askJournalAIFn).toHaveBeenCalledTimes(1);
    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).toContain('roadmap for the Q3 launch');
    expect(entriesContext).not.toContain('talked about the wedding');
    expect(entriesContext).not.toContain('Sarah mentioned the launch again today');
  });

  it('null scope preserves legacy behavior byte-for-byte', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'ok' } });
    const entries = mixedCorpus();

    await askJournalAI(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING, null);
    const withNullScope = askJournalAIFn.mock.calls[0][0].entriesContext;

    askJournalAIFn.mockClear();
    await askJournalAI(entries, 'What did Sarah say about the launch?', SHARED_EMBEDDING);
    const withoutScopeArg = askJournalAIFn.mock.calls[0][0].entriesContext;

    expect(withNullScope).toEqual(withoutScopeArg);
  });
});

// generateDaySummary(dayEntries, scope) — the "30-Day Journey" modal summary
// (a SEPARATE function from prompts/index.js's generateDaySummary), called
// by src/components/zen/DaySummaryModal.jsx:74 with no scope arg today.
function mixedDayCorpus() {
  const createdAt = new Date('2026-07-20T12:00:00Z');
  return [
    { id: 'work-1', spaceId: 'work', text: 'Shipped the Q3 launch roadmap at work', createdAt },
    { id: 'personal-1', spaceId: 'personal', text: 'Had a lovely dinner about the wedding', createdAt },
    { id: 'unscoped-1', text: 'Legacy entry mentioning the launch again', createdAt },
  ];
}

describe('generateDaySummary (30-Day Journey) - scope filter seam', () => {
  it('Work-scoped call never embeds Personal-space or unscoped entry text into the AI context', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'A good day.' } });
    const dayEntries = mixedDayCorpus();

    await generateDaySummary(dayEntries, { spaceId: 'work' });

    expect(askJournalAIFn).toHaveBeenCalledTimes(1);
    const { question } = askJournalAIFn.mock.calls[0][0];
    expect(question).toContain('Shipped the Q3 launch roadmap at work');
    expect(question).not.toContain('lovely dinner about the wedding');
    expect(question).not.toContain('Legacy entry mentioning the launch again');
  });

  it('unscoped (legacy) call DOES surface all three entries — anchor proving the corpus would leak without the filter', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'A good day.' } });
    const dayEntries = mixedDayCorpus();

    await generateDaySummary(dayEntries);

    expect(askJournalAIFn).toHaveBeenCalledTimes(1);
    const { question } = askJournalAIFn.mock.calls[0][0];
    expect(question).toContain('Shipped the Q3 launch roadmap at work');
    expect(question).toContain('lovely dinner about the wedding');
    expect(question).toContain('Legacy entry mentioning the launch again');
  });

  it('Work-scoped call over an all-Personal/unscoped corpus returns null (nothing left after filtering)', async () => {
    const dayEntries = mixedDayCorpus().filter((e) => e.id !== 'work-1');
    const result = await generateDaySummary(dayEntries, { spaceId: 'work' });
    expect(result).toBeNull();
    expect(askJournalAIFn).not.toHaveBeenCalled();
  });

  it('null scope preserves legacy behavior: identical to omitting the scope arg', async () => {
    askJournalAIFn.mockResolvedValue({ data: { response: 'A good day.' } });
    const dayEntries = mixedDayCorpus();

    const withoutScopeArg = await generateDaySummary(dayEntries);
    askJournalAIFn.mockClear();
    askJournalAIFn.mockResolvedValue({ data: { response: 'A good day.' } });
    const withNullScope = await generateDaySummary(dayEntries, null);

    expect(withNullScope).toEqual(withoutScopeArg);
  });
});
