/**
 * Adversarial scope-filter test for the Nexus recent-entries retrieval seam
 * (R1 plan task 10): fetchRecentEntries gains an optional scope param
 * applied AFTER the Firestore fetch. Every current caller passes
 * null/omits it (Nexus stays all-spaces until R2's receipts land) — this
 * test proves the param works AND that its absence is a true no-op.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  query: vi.fn((...args) => ({ __args: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  Timestamp: { now: vi.fn(() => ({})), fromMillis: vi.fn(() => ({})) },
}));

const { getDocs } = await import('firebase/firestore');
const { fetchRecentEntries } = await import('../orchestrator');

function mixedSnapshot() {
  return {
    docs: [
      { id: 'work-1', data: () => ({ spaceId: 'work', text: 'work entry' }) },
      { id: 'personal-1', data: () => ({ spaceId: 'personal', text: 'personal entry' }) },
      { id: 'unscoped-1', data: () => ({ text: 'unscoped entry' }) },
    ],
  };
}

describe('fetchRecentEntries - scope filter seam', () => {
  it('Work-scoped call never returns Personal-space or unscoped entry ids', async () => {
    getDocs.mockResolvedValueOnce(mixedSnapshot());
    const result = await fetchRecentEntries('user1', 30, { spaceId: 'work' });
    expect(result.map((e) => e.id)).toEqual(['work-1']);
  });

  it('null scope is a true no-op: identical to omitting the scope arg (Nexus stays all-spaces in R1)', async () => {
    getDocs.mockResolvedValueOnce(mixedSnapshot());
    const withNullScope = await fetchRecentEntries('user1', 30, null);

    getDocs.mockResolvedValueOnce(mixedSnapshot());
    const withoutScopeArg = await fetchRecentEntries('user1', 30);

    expect(withNullScope.map((e) => e.id).sort()).toEqual(withoutScopeArg.map((e) => e.id).sort());
    expect(withoutScopeArg.map((e) => e.id).sort()).toEqual(['personal-1', 'unscoped-1', 'work-1']);
  });
});
