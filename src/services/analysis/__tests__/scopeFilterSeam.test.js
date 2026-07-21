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
const { getSmartChatContext, askJournalAI } = await import('../index');

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
