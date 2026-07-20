import { describe, it, expect, vi, beforeEach } from 'vitest';

const pluginMock = vi.hoisted(() => ({
  requestPermission: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  listDrafts: vi.fn(),
  readDraft: vi.fn(),
  deleteDraft: vi.fn(),
  updateDraftStatus: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => pluginMock,
}));

import {
  recoverNativeDrafts, nativeCaptureAdapter, __resetActiveSessionTrackingForTest,
} from '../nativeCaptureAdapter';
import { markPendingReview, clearPendingReview } from '../pendingReviewDrafts';

const OWNER = 'user-a';
const isoMsAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  pluginMock.deleteDraft.mockResolvedValue(undefined);
  pluginMock.updateDraftStatus.mockResolvedValue({ draftId: 'd1', status: 'needsReview' });
  __resetActiveSessionTrackingForTest();

  const store = new Map<string, string>();
  const mockLocalStorage = localStorage as unknown as {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  mockLocalStorage.getItem.mockImplementation((k: string) => (store.has(k) ? store.get(k) : null));
  mockLocalStorage.setItem.mockImplementation((k: string, v: string) => { store.set(k, String(v)); });
  mockLocalStorage.removeItem.mockImplementation((k: string) => { store.delete(k); });
});

describe('recoverNativeDrafts', () => {
  it('still auto-adopts stored/needsReview/interrupted drafts (unchanged ground truth)', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{ draftId: 'd1', status: 'stored', createdAt: isoMsAgo(0) }],
    });
    pluginMock.readDraft.mockResolvedValue({ base64: 'QUJD', mime: 'audio/mp4' });
    const adopt = vi.fn().mockResolvedValue('rec_1');

    const count = await recoverNativeDrafts(OWNER, adopt);

    expect(count).toBe(1);
    expect(adopt).toHaveBeenCalledWith('QUJD', 'audio/mp4');
    expect(pluginMock.deleteDraft).toHaveBeenCalledWith({ ownerUid: OWNER, draftId: 'd1' });
    expect(pluginMock.updateDraftStatus).not.toHaveBeenCalled();
  });

  it('flags a stale "recording" draft (>30s old, has duration, no active session) as needsReview without adopting', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{
        draftId: 'd1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000,
      }],
    });
    const adopt = vi.fn();

    const count = await recoverNativeDrafts(OWNER, adopt);

    expect(count).toBe(0);
    expect(pluginMock.updateDraftStatus).toHaveBeenCalledWith({
      ownerUid: OWNER, draftId: 'd1', status: 'needsReview',
    });
    expect(adopt).not.toHaveBeenCalled();
    expect(pluginMock.readDraft).not.toHaveBeenCalled();
    expect(pluginMock.deleteDraft).not.toHaveBeenCalled();
  });

  it('does not flag a "recording" draft younger than the 30s threshold', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{
        draftId: 'd1', status: 'recording', createdAt: isoMsAgo(5_000), durationMilliseconds: 3_000,
      }],
    });

    const count = await recoverNativeDrafts(OWNER, vi.fn());

    expect(count).toBe(0);
    expect(pluginMock.updateDraftStatus).not.toHaveBeenCalled();
  });

  it('does not flag a "recording" draft with no captured duration (trivial/empty file)', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{
        draftId: 'd1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 0,
      }],
    });

    const count = await recoverNativeDrafts(OWNER, vi.fn());

    expect(count).toBe(0);
    expect(pluginMock.updateDraftStatus).not.toHaveBeenCalled();
  });

  it('does not flag the currently active capture session draft even if it looks stale', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{
        draftId: 'active-1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000,
      }],
    });

    const count = await recoverNativeDrafts(OWNER, vi.fn(), { activeDraftId: 'active-1' });

    expect(count).toBe(0);
    expect(pluginMock.updateDraftStatus).not.toHaveBeenCalled();
  });

  it('falls back to durationMs when durationMilliseconds is absent', async () => {
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{ draftId: 'd1', status: 'recording', createdAt: isoMsAgo(60_000), durationMs: 4_000 }],
    });

    await recoverNativeDrafts(OWNER, vi.fn());

    expect(pluginMock.updateDraftStatus).toHaveBeenCalledWith({
      ownerUid: OWNER, draftId: 'd1', status: 'needsReview',
    });
  });

  it('a converted draft is not auto-adopted on a second recovery pass (pending-review tracking)', async () => {
    const staleRecording = {
      draftId: 'd1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000,
    };
    pluginMock.listDrafts.mockResolvedValueOnce({ drafts: [staleRecording] });
    const adopt = vi.fn();

    const firstCount = await recoverNativeDrafts(OWNER, adopt);
    expect(firstCount).toBe(0);
    expect(pluginMock.updateDraftStatus).toHaveBeenCalledTimes(1);

    // Simulate the native store now reporting the same draft as needsReview
    // (what updateDraftStatus above would have persisted) — the pre-existing
    // stored/needsReview/interrupted auto-adopt branch would normally pick
    // this straight up.
    pluginMock.listDrafts.mockResolvedValueOnce({
      drafts: [{ draftId: 'd1', status: 'needsReview', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000 }],
    });
    const secondCount = await recoverNativeDrafts(OWNER, adopt);

    expect(secondCount).toBe(0);
    expect(adopt).not.toHaveBeenCalled();
    expect(pluginMock.readDraft).not.toHaveBeenCalled();
    expect(pluginMock.deleteDraft).not.toHaveBeenCalled();
  });

  it('acting on a pending-review draft (clearing the tracking entry) allows a later pass to adopt it', async () => {
    markPendingReview(OWNER, 'd1');
    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{ draftId: 'd1', status: 'needsReview', createdAt: isoMsAgo(0) }],
    });
    pluginMock.readDraft.mockResolvedValue({ base64: 'QUJD', mime: 'audio/mp4' });
    const adopt = vi.fn().mockResolvedValue('rec_2');

    const countWhilePending = await recoverNativeDrafts(OWNER, adopt);
    expect(countWhilePending).toBe(0);
    expect(adopt).not.toHaveBeenCalled();

    clearPendingReview(OWNER, 'd1');
    const countAfterClear = await recoverNativeDrafts(OWNER, adopt);
    expect(countAfterClear).toBe(1);
    expect(adopt).toHaveBeenCalledWith('QUJD', 'audio/mp4');
  });

  it('a recording started <60s ago (via this adapter) suppresses all recording-status flagging that pass', async () => {
    pluginMock.requestPermission.mockResolvedValue({ granted: true });
    pluginMock.start.mockResolvedValue({ draftId: 'live-1', startedAt: new Date().toISOString() });
    await nativeCaptureAdapter.start(OWNER, 'req-1');

    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{ draftId: 'stale-1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000 }],
    });
    const count = await recoverNativeDrafts(OWNER, vi.fn());

    expect(count).toBe(0);
    expect(pluginMock.updateDraftStatus).not.toHaveBeenCalled();
  });

  it('the active-session fallback clears after stop(), so a later pass can flag stale drafts again', async () => {
    pluginMock.requestPermission.mockResolvedValue({ granted: true });
    pluginMock.start.mockResolvedValue({ draftId: 'live-1', startedAt: new Date().toISOString() });
    pluginMock.stop.mockResolvedValue({
      draftId: 'live-1', assetId: 'live-1', mime: 'audio/mp4', durationMs: 1_000, base64: 'QUJD',
    });
    await nativeCaptureAdapter.start(OWNER, 'req-1');
    await nativeCaptureAdapter.stop(OWNER, 'live-1');

    pluginMock.listDrafts.mockResolvedValue({
      drafts: [{ draftId: 'stale-1', status: 'recording', createdAt: isoMsAgo(60_000), durationMilliseconds: 5_000 }],
    });
    await recoverNativeDrafts(OWNER, vi.fn());

    expect(pluginMock.updateDraftStatus).toHaveBeenCalledWith({
      ownerUid: OWNER, draftId: 'stale-1', status: 'needsReview',
    });
  });
});
