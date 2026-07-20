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

import { recoverNativeDrafts } from '../nativeCaptureAdapter';

const OWNER = 'user-a';
const isoMsAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  pluginMock.deleteDraft.mockResolvedValue(undefined);
  pluginMock.updateDraftStatus.mockResolvedValue({ draftId: 'd1', status: 'needsReview' });
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
});
