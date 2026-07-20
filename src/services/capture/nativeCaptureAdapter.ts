import { registerPlugin } from '@capacitor/core';
import type { CaptureAdapter, StoredCapture } from './captureService';

type NativeCapturePlugin = {
  requestPermission(): Promise<{ granted: boolean }>;
  start(options: { ownerUid: string; requestId: string }): Promise<{ draftId: string; startedAt: string }>;
  stop(options: { ownerUid: string; draftId: string }): Promise<StoredCapture>;
  listDrafts(options: { ownerUid: string }): Promise<{ drafts: Array<Record<string, unknown>> }>;
  readDraft(options: { ownerUid: string; draftId: string }): Promise<StoredCapture>;
  deleteDraft(options: { ownerUid: string; draftId: string }): Promise<void>;
  updateDraftStatus(
    options: { ownerUid: string; draftId: string; status: string }
  ): Promise<{ draftId: string; status: string }>;
};

// A draft still in 'recording' status means the app died mid-recording (no
// clean stop() call, and no AVAudioSession interruption handler fired — that
// path already finalizes the file and sets 'needsReview' natively). The file
// may be partial or corrupt, so — unlike stored/needsReview/interrupted — it
// must never be silently auto-adopted into the vault. Recovery instead flips
// it to 'needsReview' (CaptureCoordinator.CaptureDraft.Status) so it surfaces
// in CaptureReliabilityCenter for an explicit Transcribe/Discard decision.
const STALE_RECORDING_THRESHOLD_MS = 30_000;

const isStaleRecordingDraft = (
  candidate: Record<string, unknown>,
  activeDraftId?: string | null
): boolean => {
  const draftId = String(candidate.draftId || '');
  if (!draftId || draftId === activeDraftId) return false;
  // Non-trivial duration/file: a draft with no captured audio yet (duration
  // 0) isn't a recoverable recording — leave it alone rather than flag it.
  const durationMs = Number(candidate.durationMilliseconds ?? candidate.durationMs ?? 0);
  if (!(durationMs > 0)) return false;
  const createdAt = Date.parse(String(candidate.createdAt || ''));
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > STALE_RECORDING_THRESHOLD_MS;
};

export const recoverNativeDrafts = async (
  ownerUid: string,
  adopt: (base64: string, mime: string) => Promise<string | null>,
  options?: { activeDraftId?: string | null }
): Promise<number> => {
  const { drafts } = await NativeCapture.listDrafts({ ownerUid });
  let recovered = 0;
  for (const candidate of drafts) {
    const status = String(candidate.status);
    const draftId = String(candidate.draftId || '');
    if (!draftId) continue;

    if (status === 'recording') {
      if (isStaleRecordingDraft(candidate, options?.activeDraftId)) {
        await NativeCapture.updateDraftStatus({ ownerUid, draftId, status: 'needsReview' }).catch(() => {});
      }
      continue;
    }

    if (!['stored', 'needsReview', 'interrupted'].includes(status)) continue;
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
