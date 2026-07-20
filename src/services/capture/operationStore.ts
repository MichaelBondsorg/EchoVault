/**
 * operationStore — durable, owner-scoped records of in-flight voice-capture
 * operations, the SOURCE OF TRUTH for capture durability.
 *
 * Every voice capture creates one CaptureOp the moment its audio is durably
 * vaulted. The op record survives an app kill in Capacitor Preferences
 * (key `capture_ops::${uid}`, a JSON array), so on the next launch
 * resumeOperations can tell what was mid-flight and finish it idempotently.
 *
 * Stage vocabulary mirrors the capture telemetry pipeline (local_ready →
 * uploading → transcribing → entry_saved → enriching → complete, plus the
 * needs_attention resting state). These exact strings are also passed to
 * captureTelemetry.recordStage at each transition.
 *
 * Best-effort persistence: reads/writes never throw. An invalid owner is a
 * programming error and DOES throw (via parseOwnerUid) — callers always have a
 * validated uid at this point.
 */
import { Preferences } from '@capacitor/preferences';
import { parseOwnerUid } from '../../domain/storage/ownerScope';

export type CaptureStage =
  | 'local_ready'
  | 'uploading'
  | 'transcribing'
  | 'entry_saved'
  | 'enriching'
  | 'complete'
  | 'needs_attention';

export type CaptureOp = {
  opId: string;
  ownerUid: string;
  stage: CaptureStage;
  recordingId?: string;
  entryId?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError?: string;
};

type AdvanceMeta = { entryId?: string };

const PRUNE_COMPLETED_AFTER_MS = 24 * 60 * 60 * 1000;

const opsKey = (ownerUid: string) => `capture_ops::${ownerUid}`;

async function readOps(ownerUid: string): Promise<CaptureOp[]> {
  try {
    const { value } = await Preferences.get({ key: opsKey(ownerUid) });
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    // Defend against cross-owner contamination if the key were ever shared.
    return parsed.filter((op) => op && op.ownerUid === ownerUid) as CaptureOp[];
  } catch {
    return [];
  }
}

async function writeOps(ownerUid: string, ops: CaptureOp[]): Promise<void> {
  try {
    await Preferences.set({ key: opsKey(ownerUid), value: JSON.stringify(ops) });
  } catch {
    // Best-effort — a persistence failure must never break capture.
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a durable op at stage `local_ready` (called right after the recording
 * is confirmed in the audio vault). Returns the created op.
 */
export async function createOperation(
  ownerUid: string,
  { recordingId }: { recordingId?: string } = {},
): Promise<CaptureOp> {
  const owner = parseOwnerUid(ownerUid);
  const now = Date.now();
  const op: CaptureOp = {
    opId: newId(),
    ownerUid: owner,
    stage: 'local_ready',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    ...(recordingId ? { recordingId } : {}),
  };
  const ops = await readOps(owner);
  ops.push(op);
  await writeOps(owner, ops);
  return op;
}

/**
 * Move an op to `stage`, refreshing updatedAt (and setting entryId when
 * supplied). An unknown opId no-ops safely.
 */
export async function advance(
  ownerUid: string,
  opId: string,
  stage: CaptureStage,
  meta: AdvanceMeta = {},
): Promise<void> {
  const owner = parseOwnerUid(ownerUid);
  const ops = await readOps(owner);
  const op = ops.find((o) => o.opId === opId);
  if (!op) return;
  op.stage = stage;
  op.updatedAt = Date.now();
  if (meta.entryId) op.entryId = meta.entryId;
  await writeOps(owner, ops);
}

/** Every op not yet `complete` — includes needs_attention (surfaced, retryable). */
export async function listIncomplete(ownerUid: string): Promise<CaptureOp[]> {
  const owner = parseOwnerUid(ownerUid);
  const ops = await readOps(owner);
  return ops.filter((o) => o.stage !== 'complete');
}

/**
 * Mark an op `complete`, then prune any completed op whose completion is older
 * than 24h (housekeeping so the array can't grow unbounded).
 */
export async function completeOperation(ownerUid: string, opId: string): Promise<void> {
  const owner = parseOwnerUid(ownerUid);
  const ops = await readOps(owner);
  const op = ops.find((o) => o.opId === opId);
  if (op) {
    op.stage = 'complete';
    op.updatedAt = Date.now();
  }
  const cutoff = Date.now() - PRUNE_COMPLETED_AFTER_MS;
  const pruned = ops.filter((o) => !(o.stage === 'complete' && o.updatedAt < cutoff));
  await writeOps(owner, pruned);
}

/**
 * Move an op to `needs_attention`, bumping attempts and recording the error
 * code. The attempts counter is what the launch resume checks to STOP
 * auto-retrying (>= 5 stays needs_attention permanently). An unknown opId
 * no-ops safely.
 */
export async function markNeedsAttention(
  ownerUid: string,
  opId: string,
  errorCode: string,
): Promise<void> {
  const owner = parseOwnerUid(ownerUid);
  const ops = await readOps(owner);
  const op = ops.find((o) => o.opId === opId);
  if (!op) return;
  op.stage = 'needs_attention';
  op.attempts = (op.attempts || 0) + 1;
  op.lastError = errorCode;
  op.updatedAt = Date.now();
  await writeOps(owner, ops);
}

/** Look up an op by its vaulted recording id (used to reuse an op on retry). */
export async function findByRecordingId(
  ownerUid: string,
  recordingId: string,
): Promise<CaptureOp | null> {
  const owner = parseOwnerUid(ownerUid);
  const ops = await readOps(owner);
  return ops.find((o) => o.recordingId === recordingId) || null;
}

export default {
  createOperation,
  advance,
  listIncomplete,
  completeOperation,
  markNeedsAttention,
  findByRecordingId,
};
