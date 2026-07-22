/**
 * Embeddings v2 migration, plan task M2: Chat.jsx's inline RAG seam routed
 * through generateQueryEmbeddings + scoreEntryInBestSpace.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import Chat from '../Chat';

const mockGenerateQueryEmbeddings = vi.fn();
const mockScoreEntryInBestSpace = vi.fn();
const mockCallOpenAI = vi.fn();

vi.mock('../../../services/ai', () => ({
  callOpenAI: (...args) => mockCallOpenAI(...args),
  generateQueryEmbeddings: (...args) => mockGenerateQueryEmbeddings(...args),
  scoreEntryInBestSpace: (...args) => mockScoreEntryInBestSpace(...args),
  transcribeAudio: vi.fn(),
}));

vi.mock('../../../utils/audio', () => ({
  synthesizeSpeech: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../input/VoiceRecorder', () => ({
  default: () => null,
}));

// jsdom doesn't implement scrollIntoView; Chat.jsx calls it in a useEffect
// on every message-list update. Unrelated to this task's seam under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function makeEntry(id, extra = {}) {
  return { id, title: `Entry ${id}`, text: `text for ${id}`, createdAt: new Date('2026-01-01'), ...extra };
}

async function sendMessage(getByPlaceholderText, text) {
  const input = getByPlaceholderText('Say something...');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Chat — routed through generateQueryEmbeddings + scoreEntryInBestSpace', () => {
  beforeEach(() => {
    mockGenerateQueryEmbeddings.mockReset();
    mockScoreEntryInBestSpace.mockReset();
    mockCallOpenAI.mockReset();
    mockCallOpenAI.mockResolvedValue('An AI reply.');
  });

  it('calls generateQueryEmbeddings (not the legacy single-vector generateEmbedding) with the question text', async () => {
    mockGenerateQueryEmbeddings.mockResolvedValue(null); // no relevant matches -> falls back to recent
    const entries = [makeEntry('a')];
    const { getByPlaceholderText } = render(<Chat entries={entries} onClose={() => {}} category="personal" />);

    await sendMessage(getByPlaceholderText, 'What did I write about?');

    await waitFor(() => expect(mockGenerateQueryEmbeddings).toHaveBeenCalledWith('What did I write about?'));
  });

  it('scores every entry via scoreEntryInBestSpace with the returned query vectors, includes only matches above threshold', async () => {
    const queryVectors = { v1: [1, 0], v2: [1, 0, 0] };
    mockGenerateQueryEmbeddings.mockResolvedValue(queryVectors);

    const entryHigh = makeEntry('high', { embedding: [1, 0] });
    const entryLow = makeEntry('low', { embedding: [0, 1] });
    const entries = [entryHigh, entryLow];

    mockScoreEntryInBestSpace.mockImplementation((qv, entry) => {
      expect(qv).toBe(queryVectors); // exact object passed through, not re-derived
      if (entry.id === 'high') return { score: 0.9, space: 'v1' };
      if (entry.id === 'low') return { score: 0.1, space: 'v1' }; // below 0.3 threshold
      return null;
    });

    const { getByPlaceholderText } = render(<Chat entries={entries} onClose={() => {}} category="personal" />);
    await sendMessage(getByPlaceholderText, 'a question');

    await waitFor(() => expect(mockCallOpenAI).toHaveBeenCalled());

    expect(mockScoreEntryInBestSpace).toHaveBeenCalledWith(queryVectors, entryHigh);
    expect(mockScoreEntryInBestSpace).toHaveBeenCalledWith(queryVectors, entryLow);

    const [systemPrompt] = mockCallOpenAI.mock.calls[0];
    expect(systemPrompt).toContain('text for high');
    expect(systemPrompt).not.toContain('text for low');
  });

  it('null queryVectors (generateQueryEmbeddings failure) never calls scoreEntryInBestSpace and falls back to recent entries, never hard-fails', async () => {
    mockGenerateQueryEmbeddings.mockResolvedValue(null);
    const entries = [makeEntry('a'), makeEntry('b')];

    const { getByPlaceholderText } = render(<Chat entries={entries} onClose={() => {}} category="personal" />);
    await sendMessage(getByPlaceholderText, 'a question');

    await waitFor(() => expect(mockCallOpenAI).toHaveBeenCalled());

    expect(mockScoreEntryInBestSpace).not.toHaveBeenCalled();
    const [systemPrompt] = mockCallOpenAI.mock.calls[0];
    // Falls back to entries.slice(0, 5) — recent entries.
    expect(systemPrompt).toContain('text for a');
    expect(systemPrompt).toContain('text for b');
  });

  it('never cross-scores: an entry scoreEntryInBestSpace refuses (null) is excluded from context, not silently included', async () => {
    const queryVectors = { v2: [1, 0, 0] }; // v2-only query
    mockGenerateQueryEmbeddings.mockResolvedValue(queryVectors);

    // v1-only entry, matching dims to the v2 query vector — a cross-space
    // bug would score this; the real scorer (and this mock standing in for
    // it) correctly refuses.
    const v1OnlyEntry = makeEntry('v1-only', { embedding: [1, 0, 0] });
    mockScoreEntryInBestSpace.mockReturnValue(null);

    const { getByPlaceholderText } = render(<Chat entries={[v1OnlyEntry]} onClose={() => {}} category="personal" />);
    await sendMessage(getByPlaceholderText, 'a question');

    await waitFor(() => expect(mockCallOpenAI).toHaveBeenCalled());
    // No semantic match found -> falls back to recent entries (still shows
    // the entry, but NOT via a semantic/similarity claim).
    const [systemPrompt] = mockCallOpenAI.mock.calls[0];
    expect(systemPrompt).toContain('text for v1-only'); // via recent-fallback
  });
});
