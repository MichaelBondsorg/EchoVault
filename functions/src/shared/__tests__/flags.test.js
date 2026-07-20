/**
 * Tests for the server-side feature-flag reader (config/flags, 60s cache).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getServerFlag, _clearFlagCacheForTest } = await import('../flags.js');

/** Build a fake db whose `config/flags` doc read returns `data` (null = missing). */
function makeDb(data, { throwOnGet = false } = {}) {
  const get = vi.fn(async () => {
    if (throwOnGet) throw new Error('firestore unavailable');
    return {
      exists: data !== null && data !== undefined,
      data: () => data,
    };
  });
  const doc = vi.fn(() => ({ get }));
  return { doc, get };
}

describe('getServerFlag', () => {
  beforeEach(() => {
    _clearFlagCacheForTest();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the field value from config/flags when present', async () => {
    const db = makeDb({ coreFirstSave: true });
    expect(await getServerFlag(db, 'coreFirstSave', false)).toBe(true);
    expect(db.doc).toHaveBeenCalledWith('config/flags');
  });

  it('returns defaultValue when the field is absent from the doc', async () => {
    const db = makeDb({ someOtherFlag: true });
    expect(await getServerFlag(db, 'coreFirstSave', false)).toBe(false);
  });

  it('returns defaultValue when the doc does not exist', async () => {
    const db = makeDb(null);
    expect(await getServerFlag(db, 'coreFirstSave', 'fallback')).toBe('fallback');
  });

  it('returns defaultValue (never throws) when the read fails', async () => {
    const db = makeDb(null, { throwOnGet: true });
    await expect(getServerFlag(db, 'coreFirstSave', false)).resolves.toBe(false);
  });

  it('caches the doc for 60s: a second call within the window does not re-read', async () => {
    const db = makeDb({ coreFirstSave: true });
    await getServerFlag(db, 'coreFirstSave', false);
    await getServerFlag(db, 'coreFirstSave', false);
    await getServerFlag(db, 'serverAnalysisOrchestrator', false);
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the 60s cache window expires', async () => {
    vi.useFakeTimers();
    const db = makeDb({ coreFirstSave: true });
    await getServerFlag(db, 'coreFirstSave', false);
    vi.advanceTimersByTime(60_001);
    await getServerFlag(db, 'coreFirstSave', false);
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed read: a retry after failure hits Firestore again', async () => {
    const db = makeDb(null, { throwOnGet: true });
    await getServerFlag(db, 'coreFirstSave', false);
    await getServerFlag(db, 'coreFirstSave', false);
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it('_clearFlagCacheForTest forces a fresh read on the next call', async () => {
    const db = makeDb({ coreFirstSave: true });
    await getServerFlag(db, 'coreFirstSave', false);
    _clearFlagCacheForTest();
    await getServerFlag(db, 'coreFirstSave', false);
    expect(db.get).toHaveBeenCalledTimes(2);
  });
});
