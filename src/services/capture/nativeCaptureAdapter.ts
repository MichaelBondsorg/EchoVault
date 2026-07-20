import { registerPlugin } from '@capacitor/core';
import type { CaptureAdapter, StoredCapture } from './captureService';
import { markPendingReview, isPendingReview } from './pendingReviewDrafts';

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

// recoverNativeDrafts runs from App.jsx, which has no visibility into
// EntryBar's live CaptureService/draftId — there's no real activeDraftId to
// pass there. As a conservative fallback for callers in that position, this
// adapter tracks when it last started a recording itself (nativeCaptureAdapter
// .start(), below) and treats "started very recently" as "a session might
// still be active" — a blanket skip of ALL 'recording'-status flagging for
// that pass, rather than risk racing a genuinely in-progress recording. A
// caller that DOES have real visibility (a future EntryBar-level recovery
// call, say) can still pass options.activeDraftId for the precise per-draft
// check in isStaleRecordingDraft.
const ACTIVE_SESSION_FALLBACK_WINDOW_MS = 60_000;
let lastRecordingStartedAt: number | null = null;

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
  const sessionMightBeActive =
    lastRecordingStartedAt !== null &&
    Date.now() - lastRecordingStartedAt < ACTIVE_SESSION_FALLBACK_WINDOW_MS;

  let recovered = 0;
  for (const candidate of drafts) {
    const status = String(candidate.status);
    const draftId = String(candidate.draftId || '');
    if (!draftId) continue;

    if (status === 'recording') {
      if (!sessionMightBeActive && isStaleRecordingDraft(candidate, options?.activeDraftId)) {
        await NativeCapture.updateDraftStatus({ ownerUid, draftId, status: 'needsReview' }).catch(() => {});
        markPendingReview(ownerUid, draftId);
      }
      continue;
    }

    if (!['stored', 'needsReview', 'interrupted'].includes(status)) continue;
    // A draft we ourselves flipped to needsReview above (this pass or a
    // previous one) stays excluded from auto-adopt until the user acts on
    // it via CaptureReliabilityCenter's Transcribe/Discard — otherwise the
    // very next recovery pass would silently adopt it, defeating the human
    // decision this whole mechanism exists to force.
    if (isPendingReview(ownerUid, draftId)) continue;
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

/** Test-only: reset the module-level "recently started a recording" latch. */
export const __resetActiveSessionTrackingForTest = (): void => {
  lastRecordingStartedAt = null;
};

export const NativeCapture = registerPlugin<NativeCapturePlugin>('Capture');

export const nativeCaptureAdapter: CaptureAdapter = {
  async start(ownerUid, requestId) {
    const permission = await NativeCapture.requestPermission();
    if (!permission.granted) throw new Error('microphone_permission_denied');
    const result = await NativeCapture.start({ ownerUid, requestId });
    lastRecordingStartedAt = Date.now();
    return result;
  },

  async stop(ownerUid, draftId) {
    const result = await NativeCapture.stop({ ownerUid, draftId });
    lastRecordingStartedAt = null;
    return result;
  },
};
