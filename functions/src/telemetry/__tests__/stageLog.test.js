/**
 * Tests for server-side capture-stage telemetry (non-content).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { logStage } = await import('../stageLog.js');

describe('logStage', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs a single JSON line with type "stage"', () => {
    logStage('op-1', 'transcribe_start', { engine: 'gemini', durationMs: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({
      type: 'stage',
      opId: 'op-1',
      stage: 'transcribe_start',
      engine: 'gemini',
      durationMs: 42,
    });
    expect(typeof parsed.at).toBe('number');
  });

  it('accepts a null operationId', () => {
    logStage(null, 'cold_start');
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.opId).toBeNull();
    expect(parsed.stage).toBe('cold_start');
  });

  it('strips a non-whitelisted key (e.g. "transcript")', () => {
    logStage('op-1', 'transcribe_end', {
      durationMs: 10,
      transcript: 'the actual journal content',
    });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.durationMs).toBe(10);
    expect(parsed.transcript).toBeUndefined();
    expect(logSpy.mock.calls[0][0]).not.toContain('journal content');
  });

  it('keeps every client-shared whitelisted meta key', () => {
    const meta = {
      durationMs: 100,
      bytes: 2048,
      engine: 'whisper',
      retryCount: 2,
      errorCode: 'E_TIMEOUT',
      platform: 'android',
      queueDepth: 4,
    };
    logStage('op-1', 'uploaded', meta);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject(meta);
  });

  it('allows modelId, uidHash, and raw uid as server-only whitelisted keys', () => {
    logStage('op-1', 'analysis_end', {
      modelId: 'gemini-3-flash-preview',
      uidHash: 'abc123def456',
      uid: 'user-real-uid-123',
    });
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.modelId).toBe('gemini-3-flash-preview');
    expect(parsed.uidHash).toBe('abc123def456');
    expect(parsed.uid).toBe('user-real-uid-123');
  });

  it('defaults meta to {} when omitted', () => {
    expect(() => logStage('op-1', 'complete')).not.toThrow();
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ type: 'stage', opId: 'op-1', stage: 'complete' });
  });

  it('output always parses as JSON with type "stage"', () => {
    logStage('op-9', 'needs_attention', { errorCode: 'E_BAD_AUDIO' });
    expect(() => JSON.parse(logSpy.mock.calls[0][0])).not.toThrow();
    expect(JSON.parse(logSpy.mock.calls[0][0]).type).toBe('stage');
  });
});
