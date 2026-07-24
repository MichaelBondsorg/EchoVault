import { describe, it, expect, vi, beforeEach } from 'vitest';

const pluginMock = vi.hoisted(() => ({
  enqueueUpload: vi.fn(),
  addListener: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock('../nativeCaptureAdapter', () => ({
  NativeCapture: pluginMock,
}));

vi.mock('../../../config/flags', () => ({
  getFlag: vi.fn(),
}));

vi.mock('../../../config/firebase', () => ({
  issueCaptureUploadTicketFn: vi.fn(),
  db: { __db: true },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'ENTRIES_COL'),
  query: vi.fn((...args) => args),
  where: vi.fn((...args) => args),
  limit: vi.fn((...args) => args),
  getDocs: vi.fn(),
}));

import { getFlag } from '../../../config/flags';
import { issueCaptureUploadTicketFn } from '../../../config/firebase';
import { getDocs } from 'firebase/firestore';
import {
  enqueueNativeBackgroundUpload,
  attachNativeBackgroundUploadListeners,
  detachNativeBackgroundUploadListeners,
  reconcileNativeBackgroundUploads,
  __resetListenerTrackingForTest,
} from '../nativeBackgroundUpload';
import { recordQueued, listPending, findByDraftId } from '../backgroundUploadStore';

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';
const DRAFT_ID = 'draft-1';

beforeEach(() => {
  vi.clearAllMocks();
  __resetListenerTrackingForTest();

  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });

  pluginMock.enqueueUpload.mockResolvedValue({ draftId: DRAFT_ID });
  pluginMock.addListener.mockImplementation(async () => ({ remove: vi.fn() }));
  pluginMock.deleteDraft.mockResolvedValue(undefined);
  issueCaptureUploadTicketFn.mockResolvedValue({
    data: {
      uploadUrl: 'https://signed.example/put',
      objectPath: `capture-uploads/${OWNER}/op-1.m4a`,
      requiredHeaders: { 'Content-Type': 'audio/mp4' },
    },
  });
});

describe('enqueueNativeBackgroundUpload — flag-off inertness', () => {
  it('makes ZERO calls when the flag is off (the live, default-off production state)', async () => {
    getFlag.mockReturnValue(false);
    const queued = await enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4' });

    expect(queued).toBe(false);
    expect(issueCaptureUploadTicketFn).not.toHaveBeenCalled();
    expect(pluginMock.enqueueUpload).not.toHaveBeenCalled();
    expect(listPending(OWNER)).toHaveLength(0);
  });
});

describe('enqueueNativeBackgroundUpload — flag on', () => {
  beforeEach(() => { getFlag.mockReturnValue(true); });

  it('no-ops when required arguments are missing', async () => {
    expect(await enqueueNativeBackgroundUpload({ ownerUid: '', draftId: DRAFT_ID, mimeType: 'audio/mp4' })).toBe(false);
    expect(await enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: '', mimeType: 'audio/mp4' })).toBe(false);
    expect(await enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: '' })).toBe(false);
    expect(issueCaptureUploadTicketFn).not.toHaveBeenCalled();
  });

  it('mints a ticket, enqueues via the native plugin, and records a queued breadcrumb', async () => {
    const queued = await enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4' });

    expect(queued).toBe(true);
    expect(issueCaptureUploadTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/mp4', operationId: expect.any(String) })
    );
    expect(pluginMock.enqueueUpload).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUid: OWNER, draftId: DRAFT_ID, signedUrl: 'https://signed.example/put', contentType: 'audio/mp4' })
    );
    // Content-Type stripped from the extra headers (already carried by contentType).
    const call = pluginMock.enqueueUpload.mock.calls[0][0];
    expect(call.headers).not.toHaveProperty('Content-Type');

    const pending = listPending(OWNER);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ draftId: DRAFT_ID, status: 'queued' });
  });

  it('forwards optional provenance only when provided', async () => {
    await enqueueNativeBackgroundUpload({
      ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4',
      capturedAt: '2026-07-20T10:00:00Z', captureTimezone: 'America/Los_Angeles', spaceId: 'space-1',
    });
    expect(issueCaptureUploadTicketFn).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAt: '2026-07-20T10:00:00Z', captureTimezone: 'America/Los_Angeles', spaceId: 'space-1' })
    );
  });

  it('returns false and records nothing when the ticket callable returns no uploadUrl', async () => {
    issueCaptureUploadTicketFn.mockResolvedValue({ data: {} });
    const queued = await enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4' });
    expect(queued).toBe(false);
    expect(pluginMock.enqueueUpload).not.toHaveBeenCalled();
    expect(listPending(OWNER)).toHaveLength(0);
  });

  it('returns false (never throws) when the ticket callable rejects', async () => {
    issueCaptureUploadTicketFn.mockRejectedValue(new Error('network'));
    await expect(
      enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4' })
    ).resolves.toBe(false);
  });

  it('returns false (never throws) when the native plugin rejects', async () => {
    pluginMock.enqueueUpload.mockRejectedValue(new Error('plugin unavailable'));
    await expect(
      enqueueNativeBackgroundUpload({ ownerUid: OWNER, draftId: DRAFT_ID, mimeType: 'audio/mp4' })
    ).resolves.toBe(false);
    expect(listPending(OWNER)).toHaveLength(0);
  });
});

describe('attachNativeBackgroundUploadListeners / detach — flag-off inertness', () => {
  it('makes ZERO addListener calls when the flag is off', async () => {
    getFlag.mockReturnValue(false);
    await attachNativeBackgroundUploadListeners(OWNER);
    expect(pluginMock.addListener).not.toHaveBeenCalled();
  });
});

describe('attachNativeBackgroundUploadListeners / detach — flag on', () => {
  beforeEach(() => { getFlag.mockReturnValue(true); });

  it('attaches captureUploadComplete and captureUploadFailed listeners', async () => {
    await attachNativeBackgroundUploadListeners(OWNER);
    expect(pluginMock.addListener).toHaveBeenCalledTimes(2);
    expect(pluginMock.addListener).toHaveBeenCalledWith('captureUploadComplete', expect.any(Function));
    expect(pluginMock.addListener).toHaveBeenCalledWith('captureUploadFailed', expect.any(Function));
  });

  it('is idempotent for the same owner (no duplicate listeners)', async () => {
    await attachNativeBackgroundUploadListeners(OWNER);
    await attachNativeBackgroundUploadListeners(OWNER);
    expect(pluginMock.addListener).toHaveBeenCalledTimes(2);
  });

  it('tears down the previous owner’s listeners before attaching a new owner’s (owner isolation)', async () => {
    const removeA = vi.fn();
    pluginMock.addListener.mockResolvedValueOnce({ remove: removeA }).mockResolvedValueOnce({ remove: removeA });
    await attachNativeBackgroundUploadListeners(OWNER);

    await attachNativeBackgroundUploadListeners(OTHER_OWNER);
    expect(removeA).toHaveBeenCalledTimes(2);
    expect(pluginMock.addListener).toHaveBeenCalledTimes(4); // 2 for owner A, 2 for owner B
  });

  it('captureUploadComplete handler clears the breadcrumb and deletes the native draft', async () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: DRAFT_ID });
    await attachNativeBackgroundUploadListeners(OWNER);
    const onComplete = pluginMock.addListener.mock.calls.find((c) => c[0] === 'captureUploadComplete')[1];

    await onComplete({ draftId: DRAFT_ID, httpStatus: 200 });

    expect(findByDraftId(OWNER, DRAFT_ID)).toBeNull();
    expect(pluginMock.deleteDraft).toHaveBeenCalledWith({ ownerUid: OWNER, draftId: DRAFT_ID });
  });

  it('captureUploadFailed handler marks the breadcrumb failed and does NOT delete the native draft', async () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: DRAFT_ID });
    await attachNativeBackgroundUploadListeners(OWNER);
    const onFailed = pluginMock.addListener.mock.calls.find((c) => c[0] === 'captureUploadFailed')[1];

    await onFailed({ draftId: DRAFT_ID, errorCode: 'http_403' });

    expect(findByDraftId(OWNER, DRAFT_ID)).toMatchObject({ status: 'failed', errorCode: 'http_403' });
    expect(pluginMock.deleteDraft).not.toHaveBeenCalled();
  });

  it('detach removes all attached handles', async () => {
    const remove = vi.fn();
    pluginMock.addListener.mockResolvedValue({ remove });
    await attachNativeBackgroundUploadListeners(OWNER);
    await detachNativeBackgroundUploadListeners();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('reconcileNativeBackgroundUploads — flag-off inertness', () => {
  it('makes ZERO Firestore calls when the flag is off', async () => {
    getFlag.mockReturnValue(false);
    recordQueued(OWNER, { operationId: 'op-1', draftId: DRAFT_ID });
    const result = await reconcileNativeBackgroundUploads({ ownerUid: OWNER });
    expect(result).toEqual({ resolved: 0, pending: 0 });
    expect(getDocs).not.toHaveBeenCalled();
  });
});

describe('reconcileNativeBackgroundUploads — flag on', () => {
  beforeEach(() => { getFlag.mockReturnValue(true); });

  it('returns zero/zero with nothing pending', async () => {
    const result = await reconcileNativeBackgroundUploads({ ownerUid: OWNER });
    expect(result).toEqual({ resolved: 0, pending: 0 });
  });

  it('resolves a pending record whose entry already exists server-side (missed event)', async () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: DRAFT_ID });
    const findEntryByOperationId = vi.fn().mockResolvedValue('entry-123');

    const result = await reconcileNativeBackgroundUploads({ ownerUid: OWNER, findEntryByOperationId });

    expect(result).toEqual({ resolved: 1, pending: 0 });
    expect(findByDraftId(OWNER, DRAFT_ID)).toBeNull();
    expect(pluginMock.deleteDraft).toHaveBeenCalledWith({ ownerUid: OWNER, draftId: DRAFT_ID });
  });

  it('leaves a pending record in place when no entry exists yet', async () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: DRAFT_ID });
    const findEntryByOperationId = vi.fn().mockResolvedValue(null);

    const result = await reconcileNativeBackgroundUploads({ ownerUid: OWNER, findEntryByOperationId });

    expect(result).toEqual({ resolved: 0, pending: 1 });
    expect(findByDraftId(OWNER, DRAFT_ID)).not.toBeNull();
    expect(pluginMock.deleteDraft).not.toHaveBeenCalled();
  });

  it('one record failing its probe does not stop reconciliation of the rest', async () => {
    recordQueued(OWNER, { operationId: 'op-1', draftId: 'draft-1' });
    recordQueued(OWNER, { operationId: 'op-2', draftId: 'draft-2' });
    const findEntryByOperationId = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('entry-456');

    const result = await reconcileNativeBackgroundUploads({ ownerUid: OWNER, findEntryByOperationId });

    expect(result.resolved).toBe(1);
  });
});
