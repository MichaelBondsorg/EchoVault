/**
 * Ask Journal claims context block (R4 Phase 2 Task 7, decision P2-D6).
 *
 * askJournalAI, when the `insightClaims` flag is on, loads the current
 * user's verified claims and PREPENDS a labeled "VERIFIED PATTERNS" block
 * to entriesContext, ranked (claimType weight -> |effectMoodPoints| ->
 * createdAt) and capped at 5. Flag off, no signed-in user, or a claims-load
 * failure must all degrade to the pre-claims context untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));
vi.mock('../../../config/firebase', () => ({
  askJournalAIFn: vi.fn(),
  auth: { currentUser: { uid: 'user-1' } },
  db: {},
}));
vi.mock('../../../config/flags', () => ({ getFlag: vi.fn() }));
vi.mock('../../insights/claims/claimsService', () => ({ listActiveClaims: vi.fn() }));

const { askJournalAIFn, auth } = await import('../../../config/firebase');
const { getFlag } = await import('../../../config/flags');
const { listActiveClaims } = await import('../../insights/claims/claimsService');
const { askJournalAI } = await import('../index');

function entries() {
  return [
    { id: 'e1', title: 'Morning', text: 'Had a good run today.', tags: [], createdAt: new Date('2026-07-20') },
  ];
}

function makeClaim({
  id, claimType = 'observation', effectMoodPoints = 1, createdAt = '2026-07-01T00:00:00.000Z',
  wording = `Wording for ${id}`, status = 'verified',
  exposedDayCount = 5, comparisonDayCount = 10,
}) {
  return {
    id,
    claimType,
    status,
    wording,
    createdAt,
    evidence: { effectMoodPoints, exposedDayCount, comparisonDayCount },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  askJournalAIFn.mockResolvedValue({ data: { response: 'ok' } });
  auth.currentUser = { uid: 'user-1' };
});

describe('askJournalAI - verified claims block (flag OFF)', () => {
  it('flag off: context is byte-identical to the no-claims baseline; claims never loaded', async () => {
    getFlag.mockReturnValue(false);

    await askJournalAI(entries(), 'How am I doing?', null, null);

    expect(listActiveClaims).not.toHaveBeenCalled();
    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).not.toContain('VERIFIED PATTERNS');
    expect(entriesContext.startsWith('[')).toBe(true); // starts directly with the entry line, no prepended block
  });
});

describe('askJournalAI - verified claims block (flag ON)', () => {
  it('prepends a labeled VERIFIED PATTERNS block using claim wording verbatim, with day-count numbers', async () => {
    getFlag.mockReturnValue(true);
    listActiveClaims.mockResolvedValue([
      makeClaim({ id: 'c1', wording: 'Sleep under 6 hours is associated with lower next-day mood.', exposedDayCount: 8, comparisonDayCount: 22 }),
    ]);

    await askJournalAI(entries(), 'How am I doing?', null, null);

    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext.startsWith("VERIFIED PATTERNS (associations from this user's recorded days — never causal):\n")).toBe(true);
    expect(entriesContext).toContain('- Sleep under 6 hours is associated with lower next-day mood. [8 vs 22 days]');
  });

  it('caps at 5 claims and ranks by claimType weight, then |effectMoodPoints|, then createdAt', async () => {
    getFlag.mockReturnValue(true);
    listActiveClaims.mockResolvedValue([
      makeClaim({ id: 'observation-small', claimType: 'observation', effectMoodPoints: 0.5, createdAt: '2025-12-01T00:00:00.000Z' }),
      makeClaim({ id: 'experiment-1', claimType: 'experiment_result', effectMoodPoints: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
      makeClaim({ id: 'pattern-1', claimType: 'pattern_to_watch', effectMoodPoints: 2, createdAt: '2026-01-01T00:00:00.000Z' }),
      makeClaim({ id: 'pattern-2-bigger-effect', claimType: 'pattern_to_watch', effectMoodPoints: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
      makeClaim({ id: 'observation-newer', claimType: 'observation', effectMoodPoints: 0.5, createdAt: '2026-06-01T00:00:00.000Z' }),
      makeClaim({ id: 'observation-older', claimType: 'observation', effectMoodPoints: 0.5, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    await askJournalAI(entries(), 'How am I doing?', null, null);

    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    const block = entriesContext.split('\n\n')[0];
    const lines = block.split('\n').slice(1); // drop the "VERIFIED PATTERNS..." header line
    expect(lines).toHaveLength(5);
    // experiment_result (weight 3) > pattern_to_watch (weight 2, bigger effect first) > observation (weight 1, newer first)
    expect(lines[0]).toContain('experiment-1');
    expect(lines[1]).toContain('pattern-2-bigger-effect');
    expect(lines[2]).toContain('pattern-1');
    expect(lines[3]).toContain('observation-newer');
    expect(lines[4]).toContain('observation-older');
    // observation-small dropped by the cap (6th by rank, same createdAt as observation-older but no reason to outrank it)
    expect(entriesContext).not.toContain('observation-small');
  });

  it('only includes claims with status "verified" (candidate claims excluded)', async () => {
    getFlag.mockReturnValue(true);
    listActiveClaims.mockResolvedValue([
      makeClaim({ id: 'candidate-1', status: 'candidate' }),
    ]);

    await askJournalAI(entries(), 'How am I doing?', null, null);

    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).not.toContain('VERIFIED PATTERNS');
    expect(entriesContext).not.toContain('candidate-1');
  });

  it('no verified claims: no block prepended, context falls back to entries only', async () => {
    getFlag.mockReturnValue(true);
    listActiveClaims.mockResolvedValue([]);

    await askJournalAI(entries(), 'How am I doing?', null, null);

    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).not.toContain('VERIFIED PATTERNS');
  });

  it('no signed-in user: claims never loaded, context unchanged', async () => {
    getFlag.mockReturnValue(true);
    auth.currentUser = null;

    await askJournalAI(entries(), 'How am I doing?', null, null);

    expect(listActiveClaims).not.toHaveBeenCalled();
    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).not.toContain('VERIFIED PATTERNS');
  });

  it('claims-load failure: contained — proceeds without the block, question still answered', async () => {
    getFlag.mockReturnValue(true);
    listActiveClaims.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await askJournalAI(entries(), 'How am I doing?', null, null);

    expect(result).toBe('ok');
    const { entriesContext } = askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).not.toContain('VERIFIED PATTERNS');
  });
});
