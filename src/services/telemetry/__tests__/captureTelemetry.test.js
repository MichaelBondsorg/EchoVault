import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so the ring-buffer persistence is actually
// exercised (the default aliased test mock is a no-op). Mirrors the pattern
// used in src/services/offline/__tests__/offlineStore.test.js.
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
  },
}));

const {
  recordStage,
  getRecentStages,
  STAGES,
} = await import('../captureTelemetry.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

describe('captureTelemetry', () => {
  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
  });

  describe('STAGES', () => {
    it('exports the full set of stage name constants', () => {
      expect(STAGES).toMatchObject({
        LOCAL_READY: 'local_ready',
        UPLOADING: 'uploading',
        UPLOADED: 'uploaded',
        TRANSCRIBE_START: 'transcribe_start',
        TRANSCRIBE_END: 'transcribe_end',
        ENTRY_SAVED: 'entry_saved',
        ENRICH_START: 'enrich_start',
        ENRICH_END: 'enrich_end',
        ANALYSIS_START: 'analysis_start',
        ANALYSIS_END: 'analysis_end',
        NEEDS_ATTENTION: 'needs_attention',
        RETRY: 'retry',
        COLD_START: 'cold_start',
        COMPLETE: 'complete',
      });
    });
  });

  describe('recordStage', () => {
    it('appends a stage entry to the owner-scoped ring buffer', async () => {
      await recordStage(OWNER_A, 'op-1', STAGES.LOCAL_READY, { durationMs: 12 });
      const recent = await getRecentStages(OWNER_A);
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ opId: 'op-1', stage: 'local_ready', durationMs: 12 });
      expect(typeof recent[0].at).toBe('number');
    });

    it('persists under the documented owner-scoped Preferences key', async () => {
      await recordStage(OWNER_A, 'op-1', STAGES.LOCAL_READY);
      expect(store.has(`capture_stages::${OWNER_A}`)).toBe(true);
    });

    it('strips non-whitelisted meta keys (e.g. "text")', async () => {
      await recordStage(OWNER_A, 'op-1', STAGES.ENTRY_SAVED, {
        durationMs: 5,
        text: 'the actual journal content',
        transcript: 'more content',
      });
      const [entry] = await getRecentStages(OWNER_A);
      expect(entry.durationMs).toBe(5);
      expect(entry.text).toBeUndefined();
      expect(entry.transcript).toBeUndefined();
      expect(JSON.stringify(entry)).not.toContain('journal content');
    });

    it('keeps every whitelisted meta key', async () => {
      const meta = {
        durationMs: 100,
        bytes: 2048,
        engine: 'gemini',
        retryCount: 1,
        errorCode: 'E_TIMEOUT',
        platform: 'ios',
        queueDepth: 3,
      };
      await recordStage(OWNER_A, 'op-1', STAGES.UPLOADED, meta);
      const [entry] = await getRecentStages(OWNER_A);
      expect(entry).toMatchObject(meta);
    });

    it('logs the stage via console.info without leaking meta values', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await recordStage(OWNER_A, 'op-1', STAGES.TRANSCRIBE_START, { text: 'secret content' });
      expect(infoSpy).toHaveBeenCalledWith('[capture-stage]', 'transcribe_start', 'op-1');
      const loggedText = infoSpy.mock.calls.map((args) => args.join(' ')).join(' ');
      expect(loggedText).not.toContain('secret content');
    });

    it('caps the ring buffer at 200 entries, dropping the oldest', async () => {
      for (let i = 0; i < 205; i++) {
        await recordStage(OWNER_A, `op-${i}`, STAGES.COMPLETE);
      }
      const recent = await getRecentStages(OWNER_A, 500);
      expect(recent).toHaveLength(200);
      expect(recent[0].opId).toBe('op-5');
      expect(recent[recent.length - 1].opId).toBe('op-204');
    });

    it('keeps two owners independent', async () => {
      await recordStage(OWNER_A, 'op-a', STAGES.LOCAL_READY);
      await recordStage(OWNER_B, 'op-b', STAGES.LOCAL_READY);
      expect(await getRecentStages(OWNER_A)).toHaveLength(1);
      expect(await getRecentStages(OWNER_B)).toHaveLength(1);
      expect((await getRecentStages(OWNER_A))[0].opId).toBe('op-a');
    });

    it('never throws (best-effort) when Preferences.set fails', async () => {
      const { Preferences } = await import('@capacitor/preferences');
      const setSpy = vi.spyOn(Preferences, 'set').mockRejectedValue(new Error('disk full'));
      await expect(recordStage(OWNER_A, 'op-1', STAGES.LOCAL_READY)).resolves.toBeUndefined();
      setSpy.mockRestore();
    });

    it('is a no-op (does not throw) for a falsy ownerUid', async () => {
      await expect(recordStage(undefined, 'op-1', STAGES.LOCAL_READY)).resolves.toBeUndefined();
    });
  });

  describe('getRecentStages', () => {
    it('returns the most recent `limit` entries, most-recent-last', async () => {
      for (let i = 0; i < 10; i++) {
        await recordStage(OWNER_A, `op-${i}`, STAGES.COMPLETE);
      }
      const recent = await getRecentStages(OWNER_A, 3);
      expect(recent.map((e) => e.opId)).toEqual(['op-7', 'op-8', 'op-9']);
    });

    it('defaults to a limit of 50', async () => {
      for (let i = 0; i < 60; i++) {
        await recordStage(OWNER_A, `op-${i}`, STAGES.COMPLETE);
      }
      const recent = await getRecentStages(OWNER_A);
      expect(recent).toHaveLength(50);
    });

    it('returns an empty array when nothing has been recorded', async () => {
      expect(await getRecentStages(OWNER_A)).toEqual([]);
    });

    it('returns an empty array for a falsy ownerUid', async () => {
      expect(await getRecentStages(undefined)).toEqual([]);
    });
  });
});
