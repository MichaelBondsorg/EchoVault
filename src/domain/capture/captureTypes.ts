export type CaptureStatus =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'interrupted'
  | 'finalizing'
  | 'stored'
  | 'processing'
  | 'saved'
  | 'needsReview'
  | 'error';

export type CaptureState =
  | { status: 'idle' }
  | { status: 'preparing'; requestId: string }
  | { status: 'recording'; draftId: string; startedAt: string; elapsedMs?: number }
  | { status: 'paused'; draftId: string; durationMs: number }
  | { status: 'interrupted'; draftId: string; reason: string; recoverable: boolean }
  | { status: 'finalizing'; draftId: string }
  | { status: 'stored'; draftId: string; assetId: string; durationMs: number }
  | { status: 'processing'; draftId: string; jobId: string; entryId?: string }
  | { status: 'saved'; draftId: string; entryId: string }
  | { status: 'needsReview'; draftId: string; assetId?: string; reason: string }
  | { status: 'error'; draftId?: string; code: string; recoverable: boolean };

export type CaptureEvent =
  | { type: 'START_REQUESTED'; requestId: string }
  | { type: 'START_CONFIRMED'; requestId: string; draftId: string; startedAt: string }
  | { type: 'START_FAILED'; requestId: string; code: string; recoverable: boolean }
  | { type: 'PAUSE_CONFIRMED'; draftId: string; durationMs: number }
  | { type: 'RESUME_CONFIRMED'; draftId: string; startedAt: string; elapsedMs: number }
  | { type: 'STOP_REQUESTED' }
  | { type: 'FILE_STORED'; draftId: string; assetId: string; durationMs: number }
  | { type: 'PROCESSING_STARTED'; draftId: string; jobId: string; entryId?: string }
  | { type: 'ENTRY_SAVED'; draftId: string; entryId: string }
  | { type: 'INTERRUPTED'; draftId: string; reason: string; recoverable: boolean }
  | { type: 'PARTIAL_RECOVERED'; draftId: string; assetId: string }
  | { type: 'FAILED'; draftId?: string; code: string; recoverable: boolean }
  | { type: 'RESET' };
