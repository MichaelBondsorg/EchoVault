import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markPendingReview, isPendingReview, clearPendingReview } from '../pendingReviewDrafts';

beforeEach(() => {
  const store = new Map<string, string>();
  const mockLocalStorage = localStorage as unknown as {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  mockLocalStorage.getItem.mockImplementation((k: string) => (store.has(k) ? store.get(k) : null));
  mockLocalStorage.setItem.mockImplementation((k: string, v: string) => { store.set(k, String(v)); });
  mockLocalStorage.removeItem.mockImplementation((k: string) => { store.delete(k); });
});

describe('pendingReviewDrafts', () => {
  it('marks and reports a draft as pending review', () => {
    expect(isPendingReview('user-a', 'draft-1')).toBe(false);
    markPendingReview('user-a', 'draft-1');
    expect(isPendingReview('user-a', 'draft-1')).toBe(true);
  });

  it('is idempotent — marking the same draft twice does not duplicate it', () => {
    markPendingReview('user-a', 'draft-1');
    markPendingReview('user-a', 'draft-1');
    clearPendingReview('user-a', 'draft-1');
    expect(isPendingReview('user-a', 'draft-1')).toBe(false);
  });

  it('tracks multiple drafts for the same owner independently', () => {
    markPendingReview('user-a', 'draft-1');
    markPendingReview('user-a', 'draft-2');
    clearPendingReview('user-a', 'draft-1');
    expect(isPendingReview('user-a', 'draft-1')).toBe(false);
    expect(isPendingReview('user-a', 'draft-2')).toBe(true);
  });

  it('scopes tracking per owner', () => {
    markPendingReview('user-a', 'draft-1');
    expect(isPendingReview('user-b', 'draft-1')).toBe(false);
  });

  it('clearPendingReview on an untracked draft is a no-op', () => {
    expect(() => clearPendingReview('user-a', 'never-marked')).not.toThrow();
    expect(isPendingReview('user-a', 'never-marked')).toBe(false);
  });
});
