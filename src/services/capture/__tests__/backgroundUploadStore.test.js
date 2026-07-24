import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordQueued, clearByOperationId, clearByDraftId, markFailedByDraftId, findByDraftId, listPending,
} from '../backgroundUploadStore';

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

beforeEach(() => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
});

describe('backgroundUploadStore', () => {
  it('recordQueued then listPending round-trips a record', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    const pending = listPending(OWNER);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ operationId: 'op-1', draftId: 'draft-1', status: 'queued' });
  });

  it('recordQueued replaces a stale record for the same operationId', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    expect(listPending(OWNER)).toHaveLength(1);
  });

  it('clearByOperationId removes exactly one record', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    recordQueued(OWNER, { operationId: 'op-2', draftId: 'draft-2' });
    clearByOperationId(OWNER, 'op-1');
    const pending = listPending(OWNER);
    expect(pending).toHaveLength(1);
    expect(pending[0].operationId).toBe('op-2');
  });

  it('clearByDraftId removes exactly one record', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    clearByDraftId(OWNER, 'draft-1');
    expect(listPending(OWNER)).toHaveLength(0);
  });

  it('markFailedByDraftId sets status + errorCode, content-free (no message/text fields)', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    markFailedByDraftId(OWNER, 'draft-1', 'http_403');
    const record = findByDraftId(OWNER, 'draft-1');
    expect(record).toMatchObject({ status: 'failed', errorCode: 'http_403' });
    expect(Object.keys(record).sort()).toEqual(
      ['draftId', 'errorCode', 'operationId', 'queuedAt', 'status', 'updatedAt'].sort()
    );
  });

  it('markFailedByDraftId on an unknown draftId no-ops', () => {
    markFailedByDraftId(OWNER, 'does-not-exist', 'http_500');
    expect(listPending(OWNER)).toHaveLength(0);
  });

  it('findByDraftId returns null for a miss', () => {
    expect(findByDraftId(OWNER, 'nope')).toBeNull();
  });

  it('owner isolation: records for one owner never appear under another owner key', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    expect(listPending(OTHER_OWNER)).toHaveLength(0);
    expect(findByDraftId(OTHER_OWNER, 'draft-1')).toBeNull();
  });

  it('every write is scoped under a capture_bg_uploads::{uid} key', () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    expect(localStorage.setItem).toHaveBeenCalledWith('capture_bg_uploads::user-a', expect.any(String));
  });

  it('no-ops safely with missing arguments', () => {
    expect(() => recordQueued(null, { operationId: 'op-1', draftId: 'd1' })).not.toThrow();
    expect(() => recordQueued(OWNER, { operationId: null, draftId: 'd1' })).not.toThrow();
    expect(() => clearByOperationId(null, 'op-1')).not.toThrow();
    expect(() => clearByDraftId(OWNER, null)).not.toThrow();
    expect(listPending(null)).toEqual([]);
    expect(findByDraftId(null, 'd1')).toBeNull();
  });

  it('survives a corrupted localStorage value', () => {
    localStorage.getItem.mockImplementation(() => '{not json');
    expect(listPending(OWNER)).toEqual([]);
  });

  it('survives localStorage throwing (private browsing / quota)', () => {
    localStorage.setItem.mockImplementation(() => { throw new Error('quota exceeded'); });
    expect(() => recordQueued(OWNER, { operationId: 'op-1', draftId: 'd1' })).not.toThrow();
  });
});
