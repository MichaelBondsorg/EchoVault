import type { CaptureEvent, CaptureState, CaptureStatus } from './captureTypes';

export const initialCaptureState: CaptureState = { status: 'idle' };

const allowedEvents: Record<CaptureStatus, ReadonlySet<CaptureEvent['type']>> = {
  idle: new Set(['START_REQUESTED', 'FAILED', 'RESET']),
  preparing: new Set(['START_CONFIRMED', 'START_FAILED', 'FAILED', 'RESET']),
  recording: new Set(['PAUSE_CONFIRMED', 'STOP_REQUESTED', 'INTERRUPTED', 'FAILED']),
  paused: new Set(['RESUME_CONFIRMED', 'STOP_REQUESTED', 'INTERRUPTED', 'FAILED']),
  interrupted: new Set(['PARTIAL_RECOVERED', 'FAILED', 'RESET']),
  finalizing: new Set(['FILE_STORED', 'FAILED']),
  stored: new Set(['PROCESSING_STARTED', 'FAILED', 'RESET']),
  processing: new Set(['ENTRY_SAVED', 'FAILED', 'RESET']),
  saved: new Set(['RESET']),
  needsReview: new Set(['PROCESSING_STARTED', 'RESET']),
  error: new Set(['START_REQUESTED', 'RESET']),
};

export function canTransition(status: CaptureStatus, event: CaptureEvent['type']): boolean {
  return allowedEvents[status].has(event);
}

export function reduceCapture(state: CaptureState, event: CaptureEvent): CaptureState {
  if (!canTransition(state.status, event.type)) return state;
  if (event.type === 'RESET') return initialCaptureState;

  switch (event.type) {
    case 'START_REQUESTED':
      return { status: 'preparing', requestId: event.requestId };
    case 'START_CONFIRMED':
      if (state.status !== 'preparing' || state.requestId !== event.requestId) return state;
      return {
        status: 'recording',
        draftId: event.draftId,
        startedAt: event.startedAt,
      };
    case 'START_FAILED':
      if (state.status !== 'preparing' || state.requestId !== event.requestId) return state;
      return { status: 'error', code: event.code, recoverable: event.recoverable };
    case 'PAUSE_CONFIRMED':
      if (state.status !== 'recording' || state.draftId !== event.draftId) return state;
      return { status: 'paused', draftId: event.draftId, durationMs: event.durationMs };
    case 'RESUME_CONFIRMED':
      if (state.status !== 'paused' || state.draftId !== event.draftId) return state;
      return {
        status: 'recording',
        draftId: event.draftId,
        startedAt: event.startedAt,
        elapsedMs: event.elapsedMs,
      };
    case 'STOP_REQUESTED':
      if (state.status !== 'recording' && state.status !== 'paused') return state;
      return { status: 'finalizing', draftId: state.draftId };
    case 'FILE_STORED':
      if (state.status !== 'finalizing' || state.draftId !== event.draftId) return state;
      return {
        status: 'stored',
        draftId: event.draftId,
        assetId: event.assetId,
        durationMs: event.durationMs,
      };
    case 'PROCESSING_STARTED':
      if (
        (state.status !== 'stored' && state.status !== 'needsReview') ||
        state.draftId !== event.draftId
      ) {
        return state;
      }
      return {
        status: 'processing',
        draftId: event.draftId,
        jobId: event.jobId,
        entryId: event.entryId,
      };
    case 'ENTRY_SAVED':
      if (state.status !== 'processing' || state.draftId !== event.draftId) return state;
      return { status: 'saved', draftId: event.draftId, entryId: event.entryId };
    case 'INTERRUPTED':
      if (
        (state.status !== 'recording' && state.status !== 'paused') ||
        state.draftId !== event.draftId
      ) {
        return state;
      }
      return {
        status: 'interrupted',
        draftId: event.draftId,
        reason: event.reason,
        recoverable: event.recoverable,
      };
    case 'PARTIAL_RECOVERED':
      if (state.status !== 'interrupted' || state.draftId !== event.draftId) return state;
      return {
        status: 'needsReview',
        draftId: event.draftId,
        assetId: event.assetId,
        reason: `Recovered after ${state.reason}`,
      };
    case 'FAILED':
      return {
        status: 'error',
        draftId: event.draftId,
        code: event.code,
        recoverable: event.recoverable,
      };
  }
}
