/**
 * Embeddings v2 migration, plan task M2 (review follow-up): UnifiedConversation
 * is a real production caller of the query-embedding seam — it must be
 * upgraded to `generateQueryEmbeddings` (not the legacy single-vector
 * `generateEmbedding`), and that call must actually reach the real
 * `getCompanionContext` Tier 4 scorer end to end.
 *
 * Unlike UnifiedConversation.test.jsx (which stubs out `services/ai` and
 * `services/rag/companionContext` entirely to focus on the scope-chip UI),
 * this file keeps BOTH real — only the innermost Cloud Function callable
 * and the flags doc are mocked — so the assertions are about the real
 * production code path, not a stand-in.
 *
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UnifiedConversation from '../UnifiedConversation';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();

const { mockVoiceConnect } = vi.hoisted(() => ({ mockVoiceConnect: vi.fn() }));
vi.mock('../../../hooks/useVoiceRelay', () => ({
  useVoiceRelay: () => ({
    status: 'disconnected',
    transcript: [],
    error: null,
    connect: mockVoiceConnect,
    disconnect: vi.fn(),
    startRecording: vi.fn(),
    endTurn: vi.fn(),
    endSession: vi.fn(),
    clearError: vi.fn(),
    clearTranscript: vi.fn(),
  }),
}));

// Real `services/ai` (generateQueryEmbeddings + embeddingSpaces) and real
// `services/rag/companionContext` (Tier 4 scorer) — only the innermost
// Cloud Function callable is mocked.
const mockAskJournalAIFn = vi.fn().mockResolvedValue({ data: { response: 'A reply.' } });
vi.mock('../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
  askJournalAIFn: (...args) => mockAskJournalAIFn(...args),
}));
vi.mock('../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));

vi.mock('../../../services/memory', () => ({
  getMemoryGraph: vi.fn().mockResolvedValue(null),
  formatMemoryForContext: vi.fn(() => null),
}));
vi.mock('../../../services/memory/sessionBuffer', () => ({
  getSessionBuffer: vi.fn(() => null),
  setSessionBuffer: vi.fn(),
  formatBufferForContext: vi.fn(() => null),
  isExpired: vi.fn(() => true),
}));

vi.mock('../../../services/guided/sessions', () => ({
  GUIDED_SESSIONS: [],
  getRecommendedSessions: vi.fn(() => []),
  formatSessionAsEntry: vi.fn(),
  generateDynamicPrompt: vi.fn(),
}));
vi.mock('../../../services/guided/mindfulness', () => ({
  MINDFULNESS_EXERCISES: [],
  getRecommendedExercises: vi.fn(() => []),
  personalizeLovingKindness: vi.fn(),
}));
vi.mock('../../../utils/audio', () => ({ synthesizeSpeech: vi.fn() }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn((_db, _uid, cb) => { cb([]); return () => {}; }),
  getLastCaptureSpaceId: vi.fn().mockResolvedValue(null),
}));

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const USER_ID = 'user-1';

const sendMessage = async (text) => {
  const input = screen.getByPlaceholderText('Message your companion…');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
};

beforeEach(() => {
  mockGenerateEmbeddingFn.mockReset();
  mockGetFlag.mockReset();
  mockGetFlag.mockReturnValue(false); // default: every flag off, incl. contextSpaces + embeddingV2Read
});

describe('UnifiedConversation — generateQueryEmbeddings caller upgrade (flag OFF, byte-identical)', () => {
  it('calls the callable exactly once with no version field', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 0, 0], space: 'v1' } });
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    await sendMessage('What did I write recently?');

    await waitFor(() => expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1));
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'What did I write recently?' });
  });
});

describe('UnifiedConversation — generateQueryEmbeddings caller upgrade (flag ON, dual-space)', () => {
  beforeEach(() => {
    mockGetFlag.mockImplementation((name) => name === 'model.embeddingV2Read');
  });

  it('requests both v1 and v2 via two callable invocations', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });
    render(<UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" />);

    await sendMessage('What did I write recently?');

    await waitFor(() => expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2));
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'What did I write recently?', version: 'v1' });
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'What did I write recently?', version: 'v2' });
  });

  it('integration: a v2-covered entry is scored via the REAL getCompanionContext Tier 4 in v2 space (end to end from the component)', async () => {
    // v1 and v2 query vectors point in DIFFERENT directions on purpose, so
    // this is a real proof of space-correct pairing, not a coincidence of
    // both spaces agreeing.
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });

    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // outside Tier 3's 7-day window
    const entries = [
      {
        id: 'v2-covered',
        embedding: [0, 1, 0],   // orthogonal to the v1 query [1,0,0] -> cosine 0, EXCLUDED if scored in v1 space
        embeddingV2: [0, 1, 0], // identical to the v2 query [0,1,0] -> cosine 1, INCLUDED if scored in v2 space
        createdAt: oldDate,
        text: 'the-v2-only-discoverable-entry-text',
        tags: [],
      },
    ];

    render(
      <UnifiedConversation userId={USER_ID} onClose={vi.fn()} initialMode="chat" entries={entries} />
    );

    await sendMessage('Tell me about that entry');

    // Dual-space request happened...
    await waitFor(() => expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2));
    // ...and the real getCompanionContext -> formatContextForChat pipeline
    // surfaced the entry's text into the AI call, proving Tier 4 scored it
    // via v2 (a v1-only implementation would have scored this entry 0 —
    // orthogonal — and excluded it below the 0.25 threshold).
    await waitFor(() => expect(mockAskJournalAIFn).toHaveBeenCalled());
    const { entriesContext } = mockAskJournalAIFn.mock.calls[0][0];
    expect(entriesContext).toContain('the-v2-only-discoverable-entry-text');
  });
});
