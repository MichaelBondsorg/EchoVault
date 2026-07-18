import { initialCaptureState, reduceCapture } from '../../domain/capture/captureReducer';
import type { CaptureEvent, CaptureState } from '../../domain/capture/captureTypes';
import { parseOwnerUid } from '../../domain/storage/ownerScope';

export type StoredCapture = {
  draftId: string;
  assetId: string;
  mime: string;
  durationMs: number;
  base64: string;
};

export interface CaptureAdapter {
  start(ownerUid: string, requestId: string): Promise<{ draftId: string; startedAt: string }>;
  stop(ownerUid: string, draftId: string): Promise<StoredCapture>;
}

export class CaptureService {
  private state: CaptureState = initialCaptureState;
  private readonly listeners = new Set<(state: CaptureState) => void>();

  constructor(private readonly ownerUid: string, private readonly adapter: CaptureAdapter) {
    parseOwnerUid(ownerUid);
  }

  getState(): CaptureState { return this.state; }

  subscribe(listener: (state: CaptureState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private dispatch(event: CaptureEvent): void {
    const next = reduceCapture(this.state, event);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }

  async start(): Promise<CaptureState> {
    if (this.state.status === 'preparing' || this.state.status === 'recording') return this.state;
    const requestId = crypto.randomUUID();
    this.dispatch({ type: 'START_REQUESTED', requestId });
    try {
      const result = await this.adapter.start(this.ownerUid, requestId);
      this.dispatch({ type: 'START_CONFIRMED', requestId, ...result });
    } catch (error) {
      this.dispatch({
        type: 'START_FAILED',
        requestId,
        code: error instanceof Error ? error.message : 'capture_start_failed',
        recoverable: true,
      });
    }
    return this.state;
  }

  async stop(): Promise<StoredCapture | null> {
    if (this.state.status === 'finalizing' || this.state.status === 'stored') return null;
    if (this.state.status !== 'recording' && this.state.status !== 'paused') return null;
    const draftId = this.state.draftId;
    this.dispatch({ type: 'STOP_REQUESTED' });
    try {
      const stored = await this.adapter.stop(this.ownerUid, draftId);
      this.dispatch({
        type: 'FILE_STORED',
        draftId,
        assetId: stored.assetId,
        durationMs: stored.durationMs,
      });
      return stored;
    } catch (error) {
      this.dispatch({
        type: 'FAILED',
        draftId,
        code: error instanceof Error ? error.message : 'capture_stop_failed',
        recoverable: true,
      });
      return null;
    }
  }

  reset(): void { this.dispatch({ type: 'RESET' }); }
}
