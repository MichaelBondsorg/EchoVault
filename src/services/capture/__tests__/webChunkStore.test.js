import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeIndexedDb } from '../../../test/mocks/fakeIndexedDb';
import { __resetCaptureDb } from '../idbCaptureDb';

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

let fakeIdb;

beforeEach(() => {
  fakeIdb = createFakeIndexedDb();
  globalThis.indexedDB = fakeIdb;
  globalThis.IDBKeyRange = fakeIdb.IDBKeyRange;
  __resetCaptureDb();
});

afterEach(() => {
  delete globalThis.indexedDB;
  delete globalThis.IDBKeyRange;
});

describe('webChunkStore', () => {
  it('appendChunk + listDrafts reports chunk count and started-at per draft', async () => {
    const { appendChunk, listDrafts } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['a']), 'audio/webm');
    await appendChunk(OWNER, 'draft-1', 1, new Blob(['b']), 'audio/webm');

    const drafts = await listDrafts(OWNER);
    expect(drafts).toEqual([
      expect.objectContaining({ draftId: 'draft-1', mimeType: 'audio/webm', chunkCount: 2 }),
    ]);
    expect(typeof drafts[0].startedAt).toBe('number');
  });

  it('readDraftBlob assembles chunks in seq order into a single Blob', async () => {
    const { appendChunk, readDraftBlob } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 1, new Blob(['second']), 'audio/webm');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['first']), 'audio/webm');

    const blob = await readDraftBlob(OWNER, 'draft-1');
    expect(blob).toBeInstanceOf(Blob);
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toBe('firstsecond');
  });

  it('readDraftBlob returns null for a draft with no chunks', async () => {
    const { readDraftBlob } = await import('../webChunkStore');
    expect(await readDraftBlob(OWNER, 'missing-draft')).toBeNull();
  });

  it('deleteDraft removes chunks and meta so the draft no longer lists', async () => {
    const { appendChunk, listDrafts, deleteDraft, readDraftBlob } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['a']), 'audio/webm');
    await deleteDraft(OWNER, 'draft-1');

    expect(await listDrafts(OWNER)).toEqual([]);
    expect(await readDraftBlob(OWNER, 'draft-1')).toBeNull();
  });

  it('keeps drafts isolated per owner', async () => {
    const { appendChunk, listDrafts } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['a']), 'audio/webm');
    await appendChunk(OTHER_OWNER, 'draft-2', 0, new Blob(['b']), 'audio/webm');

    expect(await listDrafts(OWNER)).toHaveLength(1);
    expect(await listDrafts(OTHER_OWNER)).toHaveLength(1);
    expect((await listDrafts(OWNER))[0].draftId).toBe('draft-1');
  });

  it('recoverWebDrafts adopts a chunked draft then deletes it on success', async () => {
    const { appendChunk, recoverWebDrafts, listDrafts } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['audio-bytes']), 'audio/webm');

    const adopt = vi.fn().mockResolvedValue('rec_123');
    const recovered = await recoverWebDrafts(OWNER, adopt);

    expect(recovered).toBe(1);
    expect(adopt).toHaveBeenCalledWith(expect.any(String), 'audio/webm');
    expect(await listDrafts(OWNER)).toEqual([]);
  });

  it('recoverWebDrafts keeps the chunk draft when adoption fails', async () => {
    const { appendChunk, recoverWebDrafts, listDrafts } = await import('../webChunkStore');
    await appendChunk(OWNER, 'draft-1', 0, new Blob(['audio-bytes']), 'audio/webm');

    const adopt = vi.fn().mockResolvedValue(null);
    const recovered = await recoverWebDrafts(OWNER, adopt);

    expect(recovered).toBe(0);
    expect(await listDrafts(OWNER)).toHaveLength(1);
  });

  it('recoverWebDrafts is a no-op when there is nothing to recover', async () => {
    const { recoverWebDrafts } = await import('../webChunkStore');
    const adopt = vi.fn();
    expect(await recoverWebDrafts(OWNER, adopt)).toBe(0);
    expect(adopt).not.toHaveBeenCalled();
  });

  it('is a no-op returning null when IndexedDB is unavailable', async () => {
    delete globalThis.indexedDB;
    delete globalThis.IDBKeyRange;
    __resetCaptureDb();
    vi.resetModules();
    const { appendChunk, listDrafts, readDraftBlob, deleteDraft } = await import('../webChunkStore');

    expect(await appendChunk(OWNER, 'draft-1', 0, new Blob(['a']), 'audio/webm')).toBeNull();
    expect(await listDrafts(OWNER)).toBeNull();
    expect(await readDraftBlob(OWNER, 'draft-1')).toBeNull();
    expect(await deleteDraft(OWNER, 'draft-1')).toBeNull();
  });
});
