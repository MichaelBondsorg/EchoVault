import { registerPlugin } from '@capacitor/core';
import type { CaptureAdapter, StoredCapture } from './captureService';

type NativeCapturePlugin = {
  requestPermission(): Promise<{ granted: boolean }>;
  start(options: { ownerUid: string; requestId: string }): Promise<{ draftId: string; startedAt: string }>;
  stop(options: { ownerUid: string; draftId: string }): Promise<StoredCapture>;
  listDrafts(options: { ownerUid: string }): Promise<{ drafts: Array<Record<string, unknown>> }>;
  readDraft(options: { ownerUid: string; draftId: string }): Promise<StoredCapture>;
  deleteDraft(options: { ownerUid: string; draftId: string }): Promise<void>;
};

export const recoverNativeDrafts = async (
  ownerUid: string,
  adopt: (base64: string, mime: string) => Promise<string | null>
): Promise<number> => {
  const { drafts } = await NativeCapture.listDrafts({ ownerUid });
  let recovered = 0;
  for (const candidate of drafts) {
    if (!['stored', 'needsReview', 'interrupted'].includes(String(candidate.status))) continue;
    const draftId = String(candidate.draftId || '');
    if (!draftId) continue;
    const recording = await NativeCapture.readDraft({ ownerUid, draftId });
    const adoptedId = await adopt(recording.base64, recording.mime);
    if (adoptedId) {
      await NativeCapture.deleteDraft({ ownerUid, draftId });
      recovered += 1;
    }
  }
  return recovered;
};

export const deleteNativeDraft = (ownerUid: string, draftId: string): Promise<void> =>
  NativeCapture.deleteDraft({ ownerUid, draftId });

export const NativeCapture = registerPlugin<NativeCapturePlugin>('Capture');

export const nativeCaptureAdapter: CaptureAdapter = {
  async start(ownerUid, requestId) {
    const permission = await NativeCapture.requestPermission();
    if (!permission.granted) throw new Error('microphone_permission_denied');
    return NativeCapture.start({ ownerUid, requestId });
  },

  async stop(ownerUid, draftId) {
    return NativeCapture.stop({ ownerUid, draftId });
  },
};
