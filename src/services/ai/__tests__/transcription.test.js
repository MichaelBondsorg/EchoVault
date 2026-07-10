import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTranscribeEntryFn = vi.fn();

vi.mock('../../../config', () => ({
  transcribeAudioFn: vi.fn(),
  transcribeWithToneFn: vi.fn(),
  transcribeEntryFn: (...args) => mockTranscribeEntryFn(...args)
}));

import { transcribeEntryFused } from '../transcription';

describe('transcribeEntryFused', () => {
  beforeEach(() => {
    mockTranscribeEntryFn.mockReset();
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

  it('returns API_NO_CONTENT immediately without retrying (silent audio)', async () => {
    mockTranscribeEntryFn.mockResolvedValue({ data: { transcript: '' } });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toBe('API_NO_CONTENT');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(1);
  });

  it('returns API_NO_CONTENT immediately without retrying (server error payload)', async () => {
    mockTranscribeEntryFn.mockResolvedValue({ data: { error: 'API_NO_CONTENT' } });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toBe('API_NO_CONTENT');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then gives up with API_EXCEPTION', async () => {
    mockTranscribeEntryFn.mockRejectedValue(Object.assign(new Error('network down'), { code: 'unavailable' }));
    vi.useFakeTimers();
    try {
      const promise = transcribeEntryFused('QUJD', 'audio/webm', 1); // 1 retry to keep test fast
      await vi.advanceTimersByTimeAsync(2000); // exponential backoff before the retry attempt
      const result = await promise;
      expect(result).toBe('API_EXCEPTION');
      expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
