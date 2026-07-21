import { describe, it, expect } from 'vitest';
import { filterEntriesByScope } from '../scopeFilter';

describe('filterEntriesByScope', () => {
  it('returns the SAME array reference (identity) when scope is null', () => {
    const entries = [{ id: '1' }, { id: '2', spaceId: 'work' }];
    expect(filterEntriesByScope(entries, null)).toBe(entries);
  });

  it('returns the SAME array reference (identity) when scope is undefined', () => {
    const entries = [{ id: '1' }, { id: '2', spaceId: 'work' }];
    expect(filterEntriesByScope(entries, undefined)).toBe(entries);
  });

  it('strictly includes only entries whose spaceId matches scope.spaceId', () => {
    const entries = [
      { id: 'w1', spaceId: 'work' },
      { id: 'p1', spaceId: 'personal' },
      { id: 'w2', spaceId: 'work' },
    ];
    const result = filterEntriesByScope(entries, { spaceId: 'work' });
    expect(result.map((e) => e.id)).toEqual(['w1', 'w2']);
  });

  it('excludes unscoped entries (no spaceId field) — scoping is strict, not permissive', () => {
    const entries = [
      { id: 'w1', spaceId: 'work' },
      { id: 'u1' }, // no spaceId at all
      { id: 'u2', spaceId: undefined },
    ];
    const result = filterEntriesByScope(entries, { spaceId: 'work' });
    expect(result.map((e) => e.id)).toEqual(['w1']);
  });

  it('returns an empty array when no entries match the scope', () => {
    const entries = [{ id: 'p1', spaceId: 'personal' }];
    expect(filterEntriesByScope(entries, { spaceId: 'work' })).toEqual([]);
  });

  it('does not mutate the original entries array', () => {
    const entries = [{ id: 'w1', spaceId: 'work' }, { id: 'p1', spaceId: 'personal' }];
    const snapshot = [...entries];
    filterEntriesByScope(entries, { spaceId: 'work' });
    expect(entries).toEqual(snapshot);
  });
});
