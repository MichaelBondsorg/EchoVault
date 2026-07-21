/**
 * Insight Receipts unit tests (R2 Task 8).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildReceipt,
  applyReceiptDefaults,
  sourceFromEntry,
  excerptFromText,
  toISOTimestamp,
  computeTimeWindow,
  computeMissingness,
  RECEIPT_COMPUTATION_VERSION,
  WINDOW_FALLBACK_MAX_SOURCES,
} from '../receipts';

describe('excerptFromText', () => {
  it('returns null for empty/missing text', () => {
    expect(excerptFromText(null)).toBeNull();
    expect(excerptFromText(undefined)).toBeNull();
    expect(excerptFromText('')).toBeNull();
    expect(excerptFromText('   ')).toBeNull();
  });

  it('collapses newlines/whitespace to a single line', () => {
    expect(excerptFromText('line one\nline two\n\nline three')).toBe('line one line two line three');
  });

  it('truncates to 120 chars, never more', () => {
    const long = 'x'.repeat(200);
    const excerpt = excerptFromText(long);
    expect(excerpt.length).toBe(120);
    expect(excerpt).toBe('x'.repeat(120));
  });

  it('leaves short text untouched (minus whitespace collapse)', () => {
    expect(excerptFromText('short entry')).toBe('short entry');
  });
});

describe('toISOTimestamp', () => {
  it('passes through valid ISO strings', () => {
    expect(toISOTimestamp('2026-07-01T00:00:00.000Z')).toBe('2026-07-01T00:00:00.000Z');
  });

  it('returns null for unparsable strings', () => {
    expect(toISOTimestamp('not-a-date')).toBeNull();
  });

  it('converts epoch ms numbers', () => {
    expect(toISOTimestamp(0)).toBe(new Date(0).toISOString());
  });

  it('converts Date instances', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(toISOTimestamp(d)).toBe(d.toISOString());
  });

  it('converts Firestore-Timestamp-like objects (toDate/toMillis)', () => {
    const toDateObj = { toDate: () => new Date('2026-02-02T00:00:00.000Z') };
    expect(toISOTimestamp(toDateObj)).toBe('2026-02-02T00:00:00.000Z');

    const toMillisObj = { toMillis: () => 0 };
    expect(toISOTimestamp(toMillisObj)).toBe(new Date(0).toISOString());
  });

  it('returns null for null/undefined/unrecognized shapes', () => {
    expect(toISOTimestamp(null)).toBeNull();
    expect(toISOTimestamp(undefined)).toBeNull();
    expect(toISOTimestamp({})).toBeNull();
  });
});

describe('sourceFromEntry', () => {
  it('returns null when entry has no id', () => {
    expect(sourceFromEntry(null)).toBeNull();
    expect(sourceFromEntry({ text: 'hi' })).toBeNull();
  });

  it('builds {entryId, date, excerpt} from a raw entry', () => {
    const entry = {
      id: 'entry-1',
      createdAt: '2026-07-01T12:00:00.000Z',
      text: 'A journal entry about the day.',
    };
    expect(sourceFromEntry(entry)).toEqual({
      entryId: 'entry-1',
      date: '2026-07-01T12:00:00.000Z',
      excerpt: 'A journal entry about the day.',
    });
  });

  it('falls back to entryId/content/date/timestamp fields', () => {
    const entry = { entryId: 'e2', date: '2026-01-01T00:00:00.000Z', content: 'body text' };
    expect(sourceFromEntry(entry)).toEqual({
      entryId: 'e2',
      date: '2026-01-01T00:00:00.000Z',
      excerpt: 'body text',
    });
  });

  it('produces a null excerpt (not empty string) when entry has no text', () => {
    const source = sourceFromEntry({ id: 'e3', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(source.excerpt).toBeNull();
  });
});

describe('computeTimeWindow', () => {
  it('spans `days` back from `now`', () => {
    const now = Date.parse('2026-07-21T00:00:00.000Z');
    const window = computeTimeWindow(30, now);
    expect(window.end).toBe(new Date(now).toISOString());
    expect(window.start).toBe(new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
  });
});

describe('computeMissingness', () => {
  it('returns null when timeWindow is missing/invalid', () => {
    expect(computeMissingness([], null)).toBeNull();
    expect(computeMissingness([], { start: null, end: null })).toBeNull();
    expect(computeMissingness([], { start: '2026-07-01T00:00:00.000Z', end: '2026-06-01T00:00:00.000Z' })).toBeNull();
  });

  it('counts distinct calendar days with entries against the window span', () => {
    const timeWindow = { start: '2026-07-01T00:00:00.000Z', end: '2026-07-11T00:00:00.000Z' }; // 10 days
    const entries = [
      { id: 'a', createdAt: '2026-07-05T09:00:00.000Z' },
      { id: 'b', createdAt: '2026-07-05T18:00:00.000Z' }, // same day as a
      { id: 'c', createdAt: '2026-07-08T09:00:00.000Z' },
    ];
    expect(computeMissingness(entries, timeWindow)).toBe('2 of 10 days have entries');
  });
});

describe('buildReceipt', () => {
  it('throws when `generator` is missing (validation)', () => {
    expect(() => buildReceipt({ sources: [] })).toThrow(/generator/);
  });

  it('produces the documented shape with sensible defaults', () => {
    const receipt = buildReceipt({ generator: 'test_generator' });
    expect(receipt).toEqual({
      sources: [],
      scope: null,
      timeWindow: { start: null, end: null },
      sampleSize: 0,
      missingness: null,
      versions: {
        generator: 'test_generator',
        computationVersion: RECEIPT_COMPUTATION_VERSION,
        generatedAt: expect.any(String),
        model: null,
        promptVersion: null,
      },
    });
    expect(() => new Date(receipt.versions.generatedAt).toISOString()).not.toThrow();
  });

  it('normalizes, sorts sources most-recent-first, and caps to maxSources', () => {
    const sources = [
      { entryId: 'old', date: '2026-01-01T00:00:00.000Z', excerpt: 'old' },
      { entryId: 'newest', date: '2026-03-01T00:00:00.000Z', excerpt: 'newest' },
      { entryId: 'mid', date: '2026-02-01T00:00:00.000Z', excerpt: 'mid' },
    ];
    const receipt = buildReceipt({ sources, generator: 'g', maxSources: 2 });
    expect(receipt.sources.map((s) => s.entryId)).toEqual(['newest', 'mid']);
  });

  it('drops sources without an entryId', () => {
    const sources = [{ entryId: 'a', date: null, excerpt: null }, { date: '2026-01-01T00:00:00.000Z' }, null];
    const receipt = buildReceipt({ sources, generator: 'g' });
    expect(receipt.sources).toEqual([{ entryId: 'a', date: null, excerpt: null }]);
  });

  it('defaults sampleSize to the (post-cap) source count when not provided', () => {
    const sources = [{ entryId: 'a' }, { entryId: 'b' }];
    const receipt = buildReceipt({ sources, generator: 'g' });
    expect(receipt.sampleSize).toBe(2);
  });

  it('honors an explicit sampleSize larger than the cited sources (fallback receipts)', () => {
    const sources = [{ entryId: 'a' }];
    const receipt = buildReceipt({ sources, generator: 'g', sampleSize: 30 });
    expect(receipt.sampleSize).toBe(30);
    expect(receipt.sources.length).toBe(1);
  });

  it('stamps scope through unchanged, defaulting to null', () => {
    expect(buildReceipt({ generator: 'g' }).scope).toBeNull();
    expect(buildReceipt({ generator: 'g', scope: { spaceId: 'work' } }).scope).toEqual({ spaceId: 'work' });
  });

  it('carries model/promptVersion only when explicitly passed (LLM-produced insights)', () => {
    const statistical = buildReceipt({ generator: 'entity_correlation' });
    expect(statistical.versions.model).toBeNull();
    expect(statistical.versions.promptVersion).toBeNull();

    const llmProduced = buildReceipt({ generator: 'causal_synthesis', model: 'gemini-1.5-pro', promptVersion: 'v3' });
    expect(llmProduced.versions.model).toBe('gemini-1.5-pro');
    expect(llmProduced.versions.promptVersion).toBe('v3');
  });
});

describe('applyReceiptDefaults', () => {
  it('is a no-op (returns the same insight) when a receipt is already attached', () => {
    const insight = { id: 'i1', type: 'entity_correlation', receipt: { sources: [], scope: null } };
    const result = applyReceiptDefaults(insight, { windowEntries: [{ id: 'e1' }] });
    expect(result).toBe(insight); // reference-identical, not just deep-equal
  });

  it('returns falsy insight unchanged', () => {
    expect(applyReceiptDefaults(null, {})).toBeNull();
    expect(applyReceiptDefaults(undefined, {})).toBeUndefined();
  });

  it('attaches a window-level receipt when insight.receipt is missing', () => {
    const windowEntries = [
      { id: 'e1', createdAt: '2026-07-01T00:00:00.000Z', text: 'entry one' },
      { id: 'e2', createdAt: '2026-07-02T00:00:00.000Z', text: 'entry two' },
    ];
    const insight = { id: 'i1', type: 'causal_synthesis', title: 'Synthesis' };
    const result = applyReceiptDefaults(insight, { windowEntries });

    expect(result).not.toBe(insight); // pure: original untouched
    expect(insight.receipt).toBeUndefined();
    expect(result.receipt).toBeTruthy();
    expect(result.receipt.sampleSize).toBe(2);
    expect(result.receipt.sources.map((s) => s.entryId).sort()).toEqual(['e1', 'e2']);
    expect(result.receipt.versions.generator).toBe('causal_synthesis'); // uses insight.type
  });

  it('caps window-level sources to WINDOW_FALLBACK_MAX_SOURCES most-recent, but keeps sampleSize as the full window count', () => {
    const windowEntries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      text: `entry ${i}`,
    }));
    const insight = { id: 'i1', type: 'intervention' };
    const result = applyReceiptDefaults(insight, { windowEntries });

    expect(result.receipt.sources.length).toBe(WINDOW_FALLBACK_MAX_SOURCES);
    expect(result.receipt.sampleSize).toBe(15);
    // most-recent-first: e14 (Jan 15) should be first
    expect(result.receipt.sources[0].entryId).toBe('e14');
  });

  it('falls back to generator param when insight.type is missing', () => {
    const result = applyReceiptDefaults({ id: 'i1' }, { windowEntries: [] });
    expect(result.receipt.versions.generator).toBe('window_fallback');
  });

  it('stamps scope onto the fallback receipt', () => {
    const result = applyReceiptDefaults(
      { id: 'i1', type: 'calibration' },
      { windowEntries: [], scope: { spaceId: 'work' } }
    );
    expect(result.receipt.scope).toEqual({ spaceId: 'work' });
  });

  it('uses the provided timeWindow, or a sane 30-day default when omitted', () => {
    const timeWindow = { start: '2026-06-01T00:00:00.000Z', end: '2026-07-01T00:00:00.000Z' };
    const withWindow = applyReceiptDefaults({ id: 'i1', type: 't' }, { windowEntries: [], timeWindow });
    expect(withWindow.receipt.timeWindow).toEqual(timeWindow);

    const withoutWindow = applyReceiptDefaults({ id: 'i2', type: 't' }, { windowEntries: [] });
    expect(withoutWindow.receipt.timeWindow.start).toEqual(expect.any(String));
    expect(withoutWindow.receipt.timeWindow.end).toEqual(expect.any(String));
  });
});
