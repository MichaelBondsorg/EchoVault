import { describe, it, expect } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore capture request', () => {
  it('requestCapture sets mode and a timestamp; clear resets', () => {
    useUiStore.getState().requestCapture('voice');
    const req = useUiStore.getState().captureRequest;
    expect(req.mode).toBe('voice');
    expect(typeof req.ts).toBe('number');
    useUiStore.getState().clearCaptureRequest();
    expect(useUiStore.getState().captureRequest).toBeNull();
  });
  it('defaults to voice', () => {
    useUiStore.getState().requestCapture();
    expect(useUiStore.getState().captureRequest.mode).toBe('voice');
  });
});
