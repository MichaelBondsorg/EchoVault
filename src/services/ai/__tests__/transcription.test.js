import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTranscribeEntryFn = vi.fn();

vi.mock('../../../config', () => ({
  transcribeAudioFn: vi.fn(),
  transcribeWithToneFn: vi.fn(),
  transcribeEntryFn: (...args) => mockTranscribeEntryFn(...args)
}));

import { transcribeEntryFused } from '../transcription';

describe('transcribeEntryFused', () => {
  beforeEach(async () => {
    // Vitest 3.2.4/tinyspy quirk: mockReset() called synchronously in
    // beforeEach, followed by a persistent mockRejectedValue() awaited/caught
    // in the test body, can trip a false-positive "unhandled rejection" test
    // failure across the hook/test boundary (reproducible with zero app code
    // involved). Flushing a microtask after reset avoids the race without
    // changing test semantics.
    mockTranscribeEntryFn.mockReset();
    await Promise.resolve();
  });

  it('returns transcript + tone on success', async () => {
    mockTranscribeEntryFn.mockResolvedValue({
      data: { transcript: 'hello world', toneAnalysis: { moodScore: 0.5 }, engine: 'gemini' }
    });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toEqual({ transcript: 'hello world', toneAnalysis: { moodScore: 0.5 } });
    expect(mockTranscribeEntryFn).toHaveBeenCalledWith({ base64: 'QUJD', mimeType: 'audio/webm' });
  });

  it('returns non-retryable error codes immediately without retrying', async () => {
    mockTranscribeEntryFn.mockResolvedValue({ data: { error: 'API_RATE_LIMIT' } });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toBe('API_RATE_LIMIT');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then gives up with API_EXCEPTION', async () => {
    mockTranscribeEntryFn.mockRejectedValue(Object.assign(new Error('network down'), { code: 'unavailable' }));
    const result = await transcribeEntryFused('QUJD', 'audio/webm', 1); // 1 retry to keep test fast
    expect(result).toBe('API_EXCEPTION');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(2);
  }, 15000);
});
