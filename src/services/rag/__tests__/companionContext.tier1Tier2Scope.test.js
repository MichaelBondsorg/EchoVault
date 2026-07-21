/**
 * R2 plan task 5: companionContext Tier1 (memory graph) and Tier2 (session
 * buffer) scope-blind seam closure.
 *
 * R1 scoped Tiers 3-5 via filterEntriesByScope, but Tier 1 (memory graph,
 * cross-space-derived) and Tier 2 (session buffer's volatile `recentEntry`)
 * bypassed scoping entirely: a just-captured entry from another Space could
 * leak into a scoped conversation. This closes both:
 *  - Tier 1: OMITTED entirely when `scope` is non-null, replaced by a
 *    one-line note.
 *  - Tier 2: `recentEntry` included only when `recentEntry.spaceId` strictly
 *    equals `scope.spaceId` (unscoped `recentEntry` excluded, same as R1's
 *    strict-scoping precedent).
 *  - `scope: null` must remain byte-identical to legacy (pre-fix) behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same isolation strategy as companionContext.scopeFilter.test.js: avoid the
// real '../../config' -> firebase.js chain, and keep the memory/sessionBuffer
// mocks controllable per-test via mockReturnValueOnce/mockResolvedValueOnce.
vi.mock('../../ai/embeddings', () => ({
  cosineSimilarity: () => 0,
}));

vi.mock('../../memory', () => ({
  getMemoryGraph: vi.fn(async () => null),
  formatMemoryForContext: vi.fn(() => null),
}));
vi.mock('../../memory/sessionBuffer', () => ({
  getSessionBuffer: vi.fn(() => null),
  formatBufferForContext: vi.fn(() => null),
  isExpired: vi.fn(() => true),
}));

const { getCompanionContext } = await import('../companionContext');
const { getMemoryGraph, formatMemoryForContext } = await import('../../memory');
const { formatBufferForContext, isExpired } = await import('../../memory/sessionBuffer');

const baseArgs = {
  userId: 'u1',
  query: 'anything',
  queryEmbedding: null,
  entries: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCompanionContext — Tier 1 (memory graph) scope seam', () => {
  it('omits Tier 1 entirely and never calls getMemoryGraph when scope is set', async () => {
    const result = await getCompanionContext({
      ...baseArgs,
      scope: { spaceId: 'work' },
    });

    expect(getMemoryGraph).not.toHaveBeenCalled();
    expect(formatMemoryForContext).not.toHaveBeenCalled();
    expect(result.context.memory).toBe('(Long-term memory omitted: scoped conversation)');
  });

  it('null scope: Tier 1 behaves like legacy — calls getMemoryGraph and uses formatMemoryForContext', async () => {
    getMemoryGraph.mockResolvedValueOnce({ core: {} });
    formatMemoryForContext.mockReturnValueOnce('YOUR MEMORY OF THIS USER content');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: null,
    });

    expect(getMemoryGraph).toHaveBeenCalledWith('u1', { excludeArchived: true });
    expect(result.context.memory).toBe('YOUR MEMORY OF THIS USER content');
  });

  it('omitting scope entirely (undefined) is identical to scope: null for Tier 1', async () => {
    getMemoryGraph.mockResolvedValue({ core: {} });
    formatMemoryForContext.mockReturnValue('legacy memory text');

    const withNull = await getCompanionContext({ ...baseArgs, scope: null });
    const withUndefined = await getCompanionContext({ ...baseArgs });

    expect(withNull.context.memory).toBe(withUndefined.context.memory);
    expect(withNull.context.memory).toBe('legacy memory text');
  });
});

describe('getCompanionContext — Tier 2 (session buffer) scope seam', () => {
  const workBuffer = () => ({
    recentEntry: { id: 'buf-work-1', spaceId: 'work', text: 'work note' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const personalBuffer = () => ({
    recentEntry: { id: 'buf-personal-1', spaceId: 'personal', text: 'personal note' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const unscopedBuffer = () => ({
    recentEntry: { id: 'buf-unscoped-1', text: 'unscoped note' }, // no spaceId
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  it('adversarial: a Personal-space recentEntry is never included in a Work-scoped context', async () => {
    isExpired.mockReturnValue(false);
    formatBufferForContext.mockReturnValue('[JUST JOURNALED] personal note');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: { spaceId: 'work' },
      sessionBuffer: personalBuffer(),
    });

    expect(result.context.sessionBuffer).toBeNull();
  });

  it('excludes an unscoped recentEntry (no spaceId field) from a scoped context — strict, not permissive', async () => {
    isExpired.mockReturnValue(false);
    formatBufferForContext.mockReturnValue('[JUST JOURNALED] unscoped note');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: { spaceId: 'work' },
      sessionBuffer: unscopedBuffer(),
    });

    expect(result.context.sessionBuffer).toBeNull();
  });

  it('includes a recentEntry from the SAME space as a scoped context', async () => {
    isExpired.mockReturnValue(false);
    formatBufferForContext.mockReturnValue('[JUST JOURNALED] work note');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: { spaceId: 'work' },
      sessionBuffer: workBuffer(),
    });

    expect(result.context.sessionBuffer).toBe('[JUST JOURNALED] work note');
  });

  it('null scope: recentEntry included regardless of spaceId (legacy identity)', async () => {
    isExpired.mockReturnValue(false);
    formatBufferForContext.mockReturnValue('[JUST JOURNALED] personal note');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: null,
      sessionBuffer: personalBuffer(),
    });

    expect(result.context.sessionBuffer).toBe('[JUST JOURNALED] personal note');
  });

  it('expired buffer is still excluded regardless of scope (pre-existing behavior preserved)', async () => {
    isExpired.mockReturnValue(true);
    formatBufferForContext.mockReturnValue('should not appear');

    const result = await getCompanionContext({
      ...baseArgs,
      scope: { spaceId: 'work' },
      sessionBuffer: workBuffer(),
    });

    expect(result.context.sessionBuffer).toBeNull();
  });
});

describe('getCompanionContext — null-scope structural identity (Tier1 + Tier2 combined)', () => {
  it('assembles the same memory + sessionBuffer sections whether scope is explicitly null or omitted', async () => {
    getMemoryGraph.mockResolvedValue({ core: { people: ['Sarah'] } });
    formatMemoryForContext.mockReturnValue('formatted memory graph');
    isExpired.mockReturnValue(false);
    formatBufferForContext.mockReturnValue('formatted session buffer');

    const buffer = personalBufferLike();

    const explicitNull = await getCompanionContext({
      ...baseArgs,
      scope: null,
      sessionBuffer: buffer,
    });
    const omitted = await getCompanionContext({
      ...baseArgs,
      sessionBuffer: buffer,
    });

    expect(explicitNull.context.memory).toEqual(omitted.context.memory);
    expect(explicitNull.context.sessionBuffer).toEqual(omitted.context.sessionBuffer);
    expect(explicitNull.context.memory).toBe('formatted memory graph');
    expect(explicitNull.context.sessionBuffer).toBe('formatted session buffer');
  });
});

function personalBufferLike() {
  return {
    recentEntry: { id: 'buf-x', spaceId: 'personal', text: 'x' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
