import { CaptureService, type CaptureAdapter } from '../captureService';

const adapter = (): CaptureAdapter => ({
  start: vi.fn().mockResolvedValue({ draftId: 'draft-1', startedAt: '2026-07-18T12:00:00.000Z' }),
  stop: vi.fn().mockResolvedValue({
    draftId: 'draft-1', assetId: 'draft-1', durationMs: 2_000, mime: 'audio/mp4', base64: 'QUJD',
  }),
  markChapter: vi.fn().mockResolvedValue({ tMs: 1500 }),
});

describe('CaptureService', () => {
  it('does not report recording until the adapter confirms', async () => {
    let confirm;
    const deferred = new Promise<{ draftId: string; startedAt: string }>((resolve) => { confirm = resolve; });
    const fake = adapter();
    fake.start = vi.fn().mockReturnValue(deferred);
    const service = new CaptureService('owner-a', fake);

    const start = service.start();
    expect(service.getState().status).toBe('preparing');
    confirm!({ draftId: 'draft-1', startedAt: '2026-07-18T12:00:00.000Z' });
    await start;
    expect(service.getState().status).toBe('recording');
  });

  it('makes duplicate start and stop commands idempotent', async () => {
    const fake = adapter();
    const service = new CaptureService('owner-a', fake);
    await service.start();
    await service.start();
    expect(fake.start).toHaveBeenCalledTimes(1);
    await service.stop();
    await service.stop();
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it('stores before it exposes a completed recording', async () => {
    const fake = adapter();
    const service = new CaptureService('owner-a', fake);
    await service.start();
    const stored = await service.stop();
    expect(stored?.assetId).toBe('draft-1');
    expect(service.getState()).toMatchObject({ status: 'stored', assetId: 'draft-1' });
  });

  it('surfaces markers on the stop() payload when the adapter returns them (additive field, no reducer change)', async () => {
    const fake = adapter();
    fake.stop = vi.fn().mockResolvedValue({
      draftId: 'draft-1', assetId: 'draft-1', durationMs: 2_000, mime: 'audio/mp4', base64: 'QUJD',
      markers: [{ tMs: 1000 }, { tMs: 1800 }],
    });
    const service = new CaptureService('owner-a', fake);
    await service.start();
    const stored = await service.stop();
    expect(stored?.markers).toEqual([{ tMs: 1000 }, { tMs: 1800 }]);
  });

  describe('markChapter (Voice Chapters, flag: voiceChapters)', () => {
    it('calls adapter.markChapter with the owner and current draftId while recording, without touching state', async () => {
      const fake = adapter();
      const service = new CaptureService('owner-a', fake);
      await service.start();
      const stateBefore = service.getState();

      await service.markChapter();

      expect(fake.markChapter).toHaveBeenCalledWith('owner-a', 'draft-1');
      expect(service.getState()).toEqual(stateBefore);
    });

    it('is a no-op when not currently recording', async () => {
      const fake = adapter();
      const service = new CaptureService('owner-a', fake);

      await service.markChapter();

      expect(fake.markChapter).not.toHaveBeenCalled();
    });

    it('never throws when the adapter call rejects', async () => {
      const fake = adapter();
      fake.markChapter = vi.fn().mockRejectedValue(new Error('native call failed'));
      const service = new CaptureService('owner-a', fake);
      await service.start();

      await expect(service.markChapter()).resolves.toBeUndefined();
    });

    it('is a no-op when the adapter does not implement markChapter', async () => {
      const fake = adapter();
      delete (fake as Partial<CaptureAdapter>).markChapter;
      const service = new CaptureService('owner-a', fake);
      await service.start();

      await expect(service.markChapter()).resolves.toBeUndefined();
    });
  });
});
