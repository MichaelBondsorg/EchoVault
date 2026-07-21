import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so the durable op records are actually
// exercised (the default aliased test mock is a no-op). Mirrors the pattern
// used in captureTelemetry.test.js / offlineStore.test.js.
const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); },
  },
}));

const {
  createOperation,
  advance,
  listIncomplete,
  completeOperation,
  abandonOperation,
  recordAttempt,
  markNeedsAttention,
  findByRecordingId,
} = await import('../operationStore');

const OWNER = 'user-a';
const OTHER = 'user-b';
const KEY = (uid: string) => `capture_ops::${uid}`;

const seed = (uid: string, ops: unknown[]) => { store.set(KEY(uid), JSON.stringify(ops)); };
const raw = (uid: string) => JSON.parse(store.get(KEY(uid)) || '[]');

describe('operationStore', () => {
  beforeEach(() => { store.clear(); });

  it('createOperation persists a local_ready op with a uuid and zero attempts', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_1_abcdef' });
    expect(op.stage).toBe('local_ready');
    expect(op.ownerUid).toBe(OWNER);
    expect(op.recordingId).toBe('rec_1_abcdef');
    expect(op.attempts).toBe(0);
    expect(typeof op.opId).toBe('string');
    expect(op.opId.length).toBeGreaterThan(0);
    expect(op.createdAt).toBeGreaterThan(0);
    expect(op.updatedAt).toBe(op.createdAt);

    const persisted = raw(OWNER);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].opId).toBe(op.opId);
  });

  it('createOperation stores optional markers/durationMs when provided (Voice Chapters)', async () => {
    const op = await createOperation(OWNER, {
      recordingId: 'rec_ch_abcdef',
      markers: [{ tMs: 1200 }, { tMs: 3400 }],
      durationMs: 5000,
    });
    expect(op.markers).toEqual([{ tMs: 1200 }, { tMs: 3400 }]);
    expect(op.durationMs).toBe(5000);

    const [stored] = raw(OWNER);
    expect(stored.markers).toEqual([{ tMs: 1200 }, { tMs: 3400 }]);
    expect(stored.durationMs).toBe(5000);
  });

  it('createOperation omits markers/durationMs when not provided (no behavior change)', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_nm_abcdef' });
    expect(op).not.toHaveProperty('markers');
    expect(op).not.toHaveProperty('durationMs');

    const [stored] = raw(OWNER);
    expect(stored).not.toHaveProperty('markers');
    expect(stored).not.toHaveProperty('durationMs');
  });

  it('advance updates stage, updatedAt and merges entryId', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_2_abcdef' });
    await advance(OWNER, op.opId, 'transcribing');
    await advance(OWNER, op.opId, 'entry_saved', { entryId: 'entry-42' });

    const [stored] = raw(OWNER);
    expect(stored.stage).toBe('entry_saved');
    expect(stored.entryId).toBe('entry-42');
    expect(stored.updatedAt).toBeGreaterThanOrEqual(stored.createdAt);
  });

  it('advance on an unknown opId no-ops safely', async () => {
    await createOperation(OWNER, { recordingId: 'rec_3_abcdef' });
    await expect(advance(OWNER, 'does-not-exist', 'transcribing')).resolves.toBeUndefined();
    expect(raw(OWNER)).toHaveLength(1);
    expect(raw(OWNER)[0].stage).toBe('local_ready');
  });

  it('listIncomplete excludes complete AND abandoned (needs_attention IS returned)', async () => {
    const a = await createOperation(OWNER, { recordingId: 'rec_a_aaaaaa' });
    const b = await createOperation(OWNER, { recordingId: 'rec_b_bbbbbb' });
    const c = await createOperation(OWNER, { recordingId: 'rec_c_cccccc' });
    const d = await createOperation(OWNER, { recordingId: 'rec_d_dddddd' });
    await advance(OWNER, b.opId, 'transcribing');
    await markNeedsAttention(OWNER, c.opId, 'io');
    await abandonOperation(OWNER, d.opId, 'no-speech');
    await completeOperation(OWNER, a.opId);

    const incomplete = await listIncomplete(OWNER);
    const ids = incomplete.map((o) => o.opId).sort();
    expect(ids).toEqual([b.opId, c.opId].sort());
  });

  it('abandonOperation moves an op to the terminal abandoned state with the real error code', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_ab_aaaaaa' });
    await abandonOperation(OWNER, op.opId, 'no-speech');
    const [stored] = raw(OWNER);
    expect(stored.stage).toBe('abandoned');
    expect(stored.lastError).toBe('no-speech');
    expect(await listIncomplete(OWNER)).toEqual([]);
  });

  it('completeOperation prunes both complete AND abandoned ops older than 24h', async () => {
    const now = Date.now();
    seed(OWNER, [
      { opId: 'old-complete', ownerUid: OWNER, stage: 'complete', createdAt: now - 100000, updatedAt: now - 25 * 60 * 60 * 1000, attempts: 0 },
      { opId: 'old-abandoned', ownerUid: OWNER, stage: 'abandoned', createdAt: now - 100000, updatedAt: now - 25 * 60 * 60 * 1000, attempts: 1, lastError: 'no-speech' },
      { opId: 'recent-abandoned', ownerUid: OWNER, stage: 'abandoned', createdAt: now, updatedAt: now - 60 * 1000, attempts: 1 },
      { opId: 'live', ownerUid: OWNER, stage: 'transcribing', createdAt: now, updatedAt: now, attempts: 0 },
    ]);

    await completeOperation(OWNER, 'live');

    const ids = raw(OWNER).map((o: { opId: string }) => o.opId).sort();
    expect(ids).toEqual(['live', 'recent-abandoned'].sort());
  });

  it('recordAttempt bumps attempts without changing the stage', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_at_aaaaaa' });
    await advance(OWNER, op.opId, 'transcribing');
    await recordAttempt(OWNER, op.opId);
    await recordAttempt(OWNER, op.opId);
    const [stored] = raw(OWNER);
    expect(stored.stage).toBe('transcribing');
    expect(stored.attempts).toBe(2);
  });

  it('completeOperation sets complete and prunes completed ops older than 24h', async () => {
    const now = Date.now();
    seed(OWNER, [
      { opId: 'old', ownerUid: OWNER, stage: 'complete', createdAt: now - 100000, updatedAt: now - 25 * 60 * 60 * 1000, attempts: 0 },
      { opId: 'recent-complete', ownerUid: OWNER, stage: 'complete', createdAt: now, updatedAt: now - 60 * 1000, attempts: 0 },
      { opId: 'live', ownerUid: OWNER, stage: 'transcribing', createdAt: now, updatedAt: now, attempts: 0 },
    ]);

    await completeOperation(OWNER, 'live');

    const ids = raw(OWNER).map((o: { opId: string }) => o.opId).sort();
    // 'old' pruned; 'recent-complete', 'live' (now complete) remain
    expect(ids).toEqual(['live', 'recent-complete'].sort());
    expect(raw(OWNER).find((o: { opId: string }) => o.opId === 'live').stage).toBe('complete');
  });

  it('markNeedsAttention bumps attempts and records the error code each call', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_n_nnnnnn' });
    await markNeedsAttention(OWNER, op.opId, 'io');
    await markNeedsAttention(OWNER, op.opId, 'audio-missing');

    const [stored] = raw(OWNER);
    expect(stored.stage).toBe('needs_attention');
    expect(stored.attempts).toBe(2);
    expect(stored.lastError).toBe('audio-missing');
  });

  it('findByRecordingId returns the matching op or null', async () => {
    const op = await createOperation(OWNER, { recordingId: 'rec_f_ffffff' });
    expect((await findByRecordingId(OWNER, 'rec_f_ffffff'))?.opId).toBe(op.opId);
    expect(await findByRecordingId(OWNER, 'rec_missing')).toBeNull();
  });

  it('is owner-scoped: one owner never sees another owner ops', async () => {
    await createOperation(OWNER, { recordingId: 'rec_o_oooooo' });
    expect(await listIncomplete(OTHER)).toEqual([]);
    expect(await findByRecordingId(OTHER, 'rec_o_oooooo')).toBeNull();
  });
});
