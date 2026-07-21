import { describe, it, expect, vi } from 'vitest';
import { prepareDurableRecording } from '../prepareDurableRecording';

const OWNER = 'user-a';

const makeVault = (result) => ({
  saveRecording: vi.fn().mockResolvedValue(result),
});

describe('prepareDurableRecording', () => {
  it('retry path: existingRecordingId returns ok immediately without touching the vault or native draft', async () => {
    const audioVault = makeVault({ id: 'ignored' });
    const deleteNativeDraft = vi.fn();

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      existingRecordingId: 'rec_1_abcdef',
      audioVault,
      nativeDraftId: 'draft-1',
      deleteNativeDraft,
    });

    expect(out).toEqual({ ok: true, recordingId: 'rec_1_abcdef' });
    expect(audioVault.saveRecording).not.toHaveBeenCalled();
    expect(deleteNativeDraft).not.toHaveBeenCalled();
  });

  it('vault save succeeds: returns ok and THEN deletes the native draft (draft removed only after vault confirm)', async () => {
    const audioVault = makeVault({ id: 'rec_2_abcdef' });
    const order = [];
    audioVault.saveRecording.mockImplementation(async () => {
      order.push('save');
      return { id: 'rec_2_abcdef' };
    });
    const deleteNativeDraft = vi.fn(async () => { order.push('deleteDraft'); });

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
      nativeDraftId: 'draft-9',
      deleteNativeDraft,
    });

    expect(out).toEqual({ ok: true, recordingId: 'rec_2_abcdef' });
    expect(deleteNativeDraft).toHaveBeenCalledWith(OWNER, 'draft-9');
    expect(order).toEqual(['save', 'deleteDraft']);
  });

  it('vault save fails (error object): blocks and does NOT delete the native draft', async () => {
    const audioVault = makeVault({ error: 'quota' });
    const deleteNativeDraft = vi.fn();

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
      nativeDraftId: 'draft-9',
      deleteNativeDraft,
    });

    expect(out).toEqual({ ok: false, blocked: true, reason: 'quota' });
    expect(deleteNativeDraft).not.toHaveBeenCalled();
  });

  it('vault save fails (null legacy shim): blocks with reason io', async () => {
    const audioVault = makeVault(null);
    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
    });
    expect(out).toEqual({ ok: false, blocked: true, reason: 'io' });
  });

  it('vault save succeeds with no native draft: returns ok, never calls deleteNativeDraft', async () => {
    const audioVault = makeVault({ id: 'rec_3_abcdef' });
    const deleteNativeDraft = vi.fn();

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
      deleteNativeDraft,
    });

    expect(out).toEqual({ ok: true, recordingId: 'rec_3_abcdef' });
    expect(deleteNativeDraft).not.toHaveBeenCalled();
  });

  it('passes markers/durationMs through to audioVault.saveRecording when provided (Voice Chapters)', async () => {
    const audioVault = makeVault({ id: 'rec_5_abcdef' });

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      markers: [1200, 3400],
      durationMs: 5000,
      audioVault,
    });

    expect(out).toEqual({ ok: true, recordingId: 'rec_5_abcdef' });
    expect(audioVault.saveRecording).toHaveBeenCalledWith(
      OWNER, 'QUJD', 'audio/webm', { markers: [1200, 3400], durationMs: 5000 }
    );
  });

  it('omits markers/durationMs from the saveRecording call when not provided (no behavior change)', async () => {
    const audioVault = makeVault({ id: 'rec_6_abcdef' });

    await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
    });

    expect(audioVault.saveRecording).toHaveBeenCalledWith(OWNER, 'QUJD', 'audio/webm', {});
  });

  it('native draft deletion failure does not fail the durable commit', async () => {
    const audioVault = makeVault({ id: 'rec_4_abcdef' });
    const deleteNativeDraft = vi.fn().mockRejectedValue(new Error('draft gone'));

    const out = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJD',
      mimeType: 'audio/webm',
      audioVault,
      nativeDraftId: 'draft-x',
      deleteNativeDraft,
    });

    expect(out).toEqual({ ok: true, recordingId: 'rec_4_abcdef' });
  });
});
