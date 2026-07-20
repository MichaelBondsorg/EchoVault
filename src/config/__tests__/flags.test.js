import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const docMock = vi.fn((db, ...segments) => ({ __path: segments.join('/') }));
const getDocMock = vi.fn();
vi.mock('../firebase', () => ({
  doc: (...args) => docMock(...args),
  getDoc: (...args) => getDocMock(...args),
}));

const {
  FLAG_DEFAULTS,
  initFlags,
  getFlag,
  _resetFlagsForTest,
} = await import('../flags.js');

const fakeDb = {};

const LOCAL_PREFIX = 'engram:flag:';

describe('config/flags', () => {
  beforeEach(() => {
    _resetFlagsForTest();
    docMock.mockClear();
    getDocMock.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.getItem.mockImplementation(() => null);
    localStorage.setItem.mockImplementation(() => {});
    localStorage.removeItem.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('FLAG_DEFAULTS', () => {
    it('matches the spec defaults exactly', () => {
      expect(FLAG_DEFAULTS).toEqual({
        coreFirstSave: false,
        serverAnalysisOrchestrator: false,
        nativeBackgroundUpload: false,
        webChunkPersistence: true,
        intentExtraction: false,
        'model.gemini35flash': false,
        'model.embeddingV2Read': false,
        'model.fusedTranscription35': false,
      });
    });
  });

  describe('getFlag before initFlags resolves', () => {
    it('returns the default value', () => {
      expect(getFlag('coreFirstSave')).toBe(false);
      expect(getFlag('webChunkPersistence')).toBe(true);
    });

    it('still honours a localStorage dev override', () => {
      localStorage.getItem.mockImplementation((key) =>
        key === `${LOCAL_PREFIX}coreFirstSave` ? 'true' : null
      );
      expect(getFlag('coreFirstSave')).toBe(true);
    });
  });

  describe('initFlags', () => {
    it('fetches config/flags and merges it over the defaults', async () => {
      getDocMock.mockResolvedValue({
        exists: () => true,
        data: () => ({ coreFirstSave: true, 'model.gemini35flash': true }),
      });

      await initFlags(fakeDb);

      expect(docMock).toHaveBeenCalledWith(fakeDb, 'config', 'flags');
      expect(getFlag('coreFirstSave')).toBe(true);
      expect(getFlag('model.gemini35flash')).toBe(true);
      // Untouched defaults still apply.
      expect(getFlag('webChunkPersistence')).toBe(true);
      expect(getFlag('intentExtraction')).toBe(false);
    });

    it('falls back to defaults (no throw) when the doc does not exist', async () => {
      getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });

      await expect(initFlags(fakeDb)).resolves.toBeUndefined();
      expect(getFlag('coreFirstSave')).toBe(false);
    });

    it('falls back to defaults and logs once (no throw) when the read fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getDocMock.mockRejectedValue(new Error('firestore unavailable'));

      await expect(initFlags(fakeDb)).resolves.toBeUndefined();
      expect(getFlag('coreFirstSave')).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('only performs a single getDoc even when called multiple times concurrently', async () => {
      let resolveGetDoc;
      getDocMock.mockReturnValue(
        new Promise((resolve) => {
          resolveGetDoc = resolve;
        })
      );

      const p1 = initFlags(fakeDb);
      const p2 = initFlags(fakeDb);
      resolveGetDoc({ exists: () => true, data: () => ({}) });
      await Promise.all([p1, p2]);

      expect(getDocMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFlag after initFlags resolves', () => {
    it('a localStorage override wins over the fetched doc value', async () => {
      getDocMock.mockResolvedValue({
        exists: () => true,
        data: () => ({ coreFirstSave: true }),
      });
      await initFlags(fakeDb);

      localStorage.getItem.mockImplementation((key) =>
        key === `${LOCAL_PREFIX}coreFirstSave` ? 'false' : null
      );
      expect(getFlag('coreFirstSave')).toBe(false);
    });

    it('unknown flag name throws in DEV', async () => {
      vi.stubEnv('DEV', true);
      getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
      await initFlags(fakeDb);
      expect(() => getFlag('notARealFlag')).toThrow();
    });

    it('unknown flag name returns false in PROD (no throw)', async () => {
      vi.stubEnv('DEV', false);
      getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
      await initFlags(fakeDb);
      expect(getFlag('notARealFlag')).toBe(false);
    });
  });

  describe('_resetFlagsForTest', () => {
    it('clears cached fetched flags so getFlag reverts to defaults', async () => {
      getDocMock.mockResolvedValue({
        exists: () => true,
        data: () => ({ coreFirstSave: true }),
      });
      await initFlags(fakeDb);
      expect(getFlag('coreFirstSave')).toBe(true);

      _resetFlagsForTest();
      expect(getFlag('coreFirstSave')).toBe(false);
    });

    it('allows initFlags to run again (fetches a second time)', async () => {
      getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
      await initFlags(fakeDb);
      _resetFlagsForTest();
      await initFlags(fakeDb);
      expect(getDocMock).toHaveBeenCalledTimes(2);
    });
  });
});
