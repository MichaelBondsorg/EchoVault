import { describe, it, expect } from 'vitest';
import { normalizeMarkers } from '../chapterMarkers';

describe('normalizeMarkers', () => {
  it('converts raw number[] (web shape) to canonical [{tMs}]', () => {
    expect(normalizeMarkers([1200, 3400])).toEqual([{ tMs: 1200 }, { tMs: 3400 }]);
  });

  it('passes [{tMs}] (native shape) through as the same canonical shape', () => {
    expect(normalizeMarkers([{ tMs: 1200 }, { tMs: 3400 }])).toEqual([{ tMs: 1200 }, { tMs: 3400 }]);
  });

  it('produces an identical result for the web and native shapes of the same markers', () => {
    const webShape = [1200, 3400];
    const nativeShape = [{ tMs: 1200 }, { tMs: 3400 }];
    expect(normalizeMarkers(webShape)).toEqual(normalizeMarkers(nativeShape));
  });

  it('returns undefined for undefined input (no stuffing)', () => {
    expect(normalizeMarkers(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty array (no stuffing)', () => {
    expect(normalizeMarkers([])).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(normalizeMarkers(null)).toBeUndefined();
  });

  it('drops malformed entries, returning undefined if nothing valid remains', () => {
    expect(normalizeMarkers([{ foo: 1 }, 'nope', null, NaN])).toBeUndefined();
  });

  it('drops malformed entries but keeps the valid ones', () => {
    expect(normalizeMarkers([1000, { foo: 1 }, { tMs: 2000 }])).toEqual([{ tMs: 1000 }, { tMs: 2000 }]);
  });
});
