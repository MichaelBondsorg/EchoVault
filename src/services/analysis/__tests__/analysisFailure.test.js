import { vi } from 'vitest';

vi.mock('../../ai/gemini', () => ({
  analyzeJournalEntryCloud: vi.fn(),
}));
vi.mock('../../ai/embeddings', () => ({ cosineSimilarity: vi.fn() }));
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { analyzeJournalEntryCloud } = await import('../../ai/gemini');
const { analyzeEntry, classifyEntry } = await import('../index');

describe('analysis failure semantics', () => {
  it('returns null mood and failed status when analysis has no result', async () => {
    analyzeJournalEntryCloud.mockResolvedValueOnce(null);
    expect(await analyzeEntry('I feel unsettled')).toMatchObject({
      mood_score: null,
      analysisStatus: 'failed',
      entry_type: 'unknown',
    });
  });

  it('returns unknown classification rather than reflection on classifier failure', async () => {
    analyzeJournalEntryCloud.mockRejectedValueOnce(new Error('offline'));
    expect(await classifyEntry('I am furious')).toMatchObject({
      classification: { entry_type: 'unknown', confidence: 0 },
    });
  });
});
