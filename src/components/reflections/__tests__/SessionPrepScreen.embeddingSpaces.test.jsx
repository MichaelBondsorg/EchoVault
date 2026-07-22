/**
 * Embeddings v2 migration, plan task M2 (review follow-up): SessionPrepScreen
 * is a real production caller of the per-question query-embedding seam
 * (both the "Generate" flow and per-block "Regenerate") — confirm it's
 * upgraded to `generateQueryEmbeddings` with real callable-level spying.
 *
 * Unlike SessionPrepScreen.test.jsx (which stubs `services/ai` entirely),
 * this file keeps it REAL — only the innermost Cloud Function callable and
 * the flags doc are mocked.
 *
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionPrepScreen from '../SessionPrepScreen';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { buildSessionBrief, SESSION_PREP_QUESTIONS } from '../../../services/reflections/sessionPrep';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();

vi.mock('../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));
vi.mock('../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));

const mockFirebase = vi.hoisted(() => ({
  db: { __db: true },
  collection: vi.fn((_db, path) => ({ __col: path })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((...args) => ({ __where: args })),
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
}));
vi.mock('../../../config/firebase', () => mockFirebase);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
}));
vi.mock('../../../services/reflections/runRecipe', () => ({
  updateBlock: vi.fn(),
  addUserBlock: vi.fn(),
  removeBlock: vi.fn(),
}));
vi.mock('../../../services/reflections/sessionPrep', () => ({
  buildSessionBrief: vi.fn(),
  regenerateSection: vi.fn(),
  composeSessionPrepPdf: vi.fn(),
  DEFAULT_SINCE_DAYS_BACK: 14,
  SESSION_PREP_QUESTIONS: [
    'What changed since my last session?',
    'Which moments do I want to bring up?',
    'What patterns came up, and what am I unsure about?',
    'What open questions do I want to ask?',
  ],
}));

const UID = 'user-a';

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => { cb(spaces); return () => {}; });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFlag.mockReturnValue(false);
  withSpaces([]);
  mockFirebase.getDocs.mockResolvedValue({ forEach: () => {} });
  buildSessionBrief.mockResolvedValue({ id: 'brief-1', title: 'Session prep', period: {}, blocks: [] });
});

describe('SessionPrepScreen — generateQueryEmbeddings caller upgrade, flag OFF (byte-identical)', () => {
  it('calls the callable once per question with no version field', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 0, 0], space: 'v1' } });
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(SESSION_PREP_QUESTIONS.length);
    SESSION_PREP_QUESTIONS.forEach((q) => {
      expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: q });
    });

    const options = buildSessionBrief.mock.calls[0][2];
    expect(options.embeddings[SESSION_PREP_QUESTIONS[0]]).toEqual({ v1: [1, 0, 0] });
  });
});

describe('SessionPrepScreen — generateQueryEmbeddings caller upgrade, flag ON (dual-space)', () => {
  beforeEach(() => {
    mockGetFlag.mockImplementation((name) => name === 'model.embeddingV2Read');
  });

  it('calls the callable TWICE per question (v1 + v2), threading a {v1,v2} object per question into buildSessionBrief', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(SESSION_PREP_QUESTIONS.length * 2);
    const options = buildSessionBrief.mock.calls[0][2];
    SESSION_PREP_QUESTIONS.forEach((q) => {
      expect(options.embeddings[q]).toEqual({ v1: [1, 0, 0], v2: [0, 1, 0] });
    });
  });
});
