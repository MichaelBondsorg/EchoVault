/**
 * R4 T2b — thread classification honesty (DR finding 9) + prompt privacy
 * (DR finding 5, prompt-text variant).
 *
 * Bug 1 (classification): the LLM classification switch had no first-class
 * `none` outcome. An unmatched `continue` (LLM says "continues thread X"
 * but no active thread named X exists) had no `break` and fell straight
 * into the `metamorphosis` case — silently creating a brand-new thread with
 * a fabricated predecessor search, when the honest outcome is "nothing
 * meaningfully happened for thread tracking." Any unrecognized/malformed
 * `action` value also silently created a new thread via the shared
 * `case 'new': default:` block. This meant nearly every substantial entry
 * became a thread candidate (DR finding 9).
 *
 * Fix: `none` is now a first-class outcome, explicitly offered to the LLM
 * as the DEFAULT choice in the prompt, AND is the code-level fallback for
 * both the unmatched-continue case and any unrecognized action — no
 * Firestore write happens on either path.
 *
 * Bug 2 (prompt privacy): buildThreadIdentificationPrompt's METAMORPHOSIS
 * example used real personal/brand literals ("Databricks" evolving to
 * "Anthropic") inside the actual text sent to the Gemini API on every
 * thread-identification call — a live third-party data leak, not just a
 * client-side trigger-list issue. Fixed with a fully generic example.
 *
 * Approach for the privacy assertion (per the coordinator's guidance):
 * buildThreadIdentificationPrompt is module-private (not exported), and a
 * plain source-text scan already burned us once on this file (a doc
 * comment matched our own lint regex in the earlier round). So instead we
 * mock `callGemini` and capture the ACTUAL prompt string
 * identifyThreadAssociation builds and sends — the real built prompt, with
 * synthetic active/archived thread inputs — and denylist-scan that
 * captured string. This tests what actually ships to the third-party API,
 * not just the static template source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PERSONAL_TOKEN_DENYLIST } from '../genericTriggers';

const mockCallGemini = vi.fn();
const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));
vi.mock('../../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'test-app' }));
vi.mock('../../../ai/gemini', () => ({ callGemini: (...args) => mockCallGemini(...args) }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __collection: true })),
  doc: vi.fn((...args) => ({ __ref: true, __path: args.slice(1).join('/') })),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  query: vi.fn((...args) => args),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  arrayUnion: (v) => ({ __arrayUnion: v }),
  Timestamp: {
    now: () => ({
      toDate: () => new Date('2026-07-22T00:00:00Z'),
      toMillis: () => Date.parse('2026-07-22T00:00:00Z'),
    }),
  },
}));

const {
  identifyThreadAssociation,
} = await import('../threadManager');

const LONG_ENTRY = 'A'.repeat(60) + ' some journal entry text about something that happened today.';

function mockLLMResponse(obj) {
  mockCallGemini.mockResolvedValue(JSON.stringify(obj));
}

function mockActiveThreads(threads) {
  // getActiveThreads() is called first inside identifyThreadAssociation,
  // then the archived-threads query. Queue responses in that order.
  mockGetDocs
    .mockResolvedValueOnce({ docs: threads.map((t) => ({ id: t.id, data: () => t })) })
    .mockResolvedValueOnce({ docs: [] }); // no archived threads
}

beforeEach(() => {
  mockCallGemini.mockReset();
  mockGenerateEmbeddingFn.mockReset();
  mockGetFlag.mockReset();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockSetDoc.mockClear();
  mockUpdateDoc.mockClear();
  mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 0, 0], space: 'v2' } });
});

describe('identifyThreadAssociation — none-default classification (R4 T2b)', () => {
  it('LLM explicit action:"none" → returns action "none", writes nothing to Firestore', async () => {
    mockActiveThreads([]);
    mockLLMResponse({
      thread: { action: 'none' },
      somaticSignals: [],
      sentiment: 0.5,
      confidence: 0.7,
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('none');
    expect(result.threadId).toBeNull();
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('unmatched "continue" (no matching active thread) returns "none" — does NOT fall through to metamorphosis/new-thread creation', async () => {
    mockActiveThreads([{ id: 't1', displayName: 'Totally Different Thread', category: 'growth' }]);
    mockLLMResponse({
      thread: { action: 'continue', existingThreadName: 'A Thread That Does Not Exist' },
      somaticSignals: [],
      sentiment: 0.5,
      confidence: 0.7,
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('none');
    expect(result.threadId).toBeNull();
    // The bug: this used to silently create a NEW thread via fall-through.
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('an unrecognized/malformed action value falls back to "none", not silent thread creation', async () => {
    mockActiveThreads([]);
    mockLLMResponse({
      thread: { action: 'sideways_shuffle', proposedName: 'Should Not Be Created' },
      somaticSignals: [],
      sentiment: 0.5,
      confidence: 0.7,
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('none');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('regression: matched "continue" still appends to the existing thread', async () => {
    mockActiveThreads([{ id: 't1', displayName: 'Career Search', category: 'career', sentimentHistory: [] }]);
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: 't1', displayName: 'Career Search', category: 'career', sentimentHistory: [], entryCount: 1 }),
    });
    mockLLMResponse({
      thread: { action: 'continue', existingThreadName: 'Career Search' },
      somaticSignals: [],
      sentiment: 0.6,
      confidence: 0.8,
      arcEvent: 'Follow-up',
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('appended');
    expect(result.threadId).toBe('t1');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('regression: "metamorphosis" still creates a new thread with predecessor linkage', async () => {
    mockActiveThreads([{ id: 't1', displayName: 'Old Direction', category: 'career' }]);
    mockLLMResponse({
      thread: {
        action: 'metamorphosis',
        proposedName: 'New Direction',
        category: 'career',
        metamorphosis: {
          predecessorName: 'Old Direction',
          evolutionType: 'pivot',
          evolutionContext: 'Shifted focus',
        },
      },
      somaticSignals: [],
      sentiment: 0.6,
      confidence: 0.8,
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('metamorphosis');
    expect(result.predecessorId).toBe('t1');
    expect(mockSetDoc).toHaveBeenCalledTimes(1); // createThread
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1); // predecessor status update
  });

  it('regression: "new" still creates a new thread when no similar thread exists', async () => {
    mockActiveThreads([]);
    mockLLMResponse({
      thread: { action: 'new', proposedName: 'Brand New Topic', category: 'growth' },
      somaticSignals: [],
      sentiment: 0.5,
      confidence: 0.7,
    });

    const result = await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
});

describe('buildThreadIdentificationPrompt — no personal/brand literals shipped to the LLM (R4 T2b)', () => {
  it('the actual prompt sent to callGemini contains no denylisted personal token', async () => {
    mockActiveThreads([{ id: 't1', displayName: 'Some Existing Thread', category: 'career' }]);
    mockLLMResponse({
      thread: { action: 'none' },
      somaticSignals: [],
      sentiment: 0.5,
      confidence: 0.7,
    });

    await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    expect(mockCallGemini).toHaveBeenCalledTimes(1);
    const [sentPrompt] = mockCallGemini.mock.calls[0];
    const lowerPrompt = sentPrompt.toLowerCase();
    for (const token of PERSONAL_TOKEN_DENYLIST) {
      expect(lowerPrompt.includes(token), `prompt must not contain "${token}"`).toBe(false);
    }
    // Explicit regression guard for the exact literals that were there.
    expect(sentPrompt).not.toMatch(/Databricks/i);
    expect(sentPrompt).not.toMatch(/\bAnthropic\b/i);
  });

  it('the prompt offers "none" as an explicit action option', async () => {
    mockActiveThreads([]);
    mockLLMResponse({ thread: { action: 'none' }, somaticSignals: [], sentiment: 0.5, confidence: 0.7 });

    await identifyThreadAssociation('user-1', 'entry-1', LONG_ENTRY);

    const [sentPrompt] = mockCallGemini.mock.calls[0];
    expect(sentPrompt).toMatch(/"none"/);
  });
});
