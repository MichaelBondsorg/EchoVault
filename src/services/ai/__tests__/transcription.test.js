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
    expect(result).toEqual({
      rawTranscript: 'hello world',
      transcript: 'hello world',
      toneAnalysis: { moodScore: 0.5 }
    });
    expect(mockTranscribeEntryFn).toHaveBeenCalledWith({
      base64: 'QUJD',
      mimeType: 'audio/webm',
      properNouns: []
    });
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

  describe('markers / chapters (Task 14)', () => {
    it('omits markers/durationMs from the request when absent (byte-identical payload)', async () => {
      mockTranscribeEntryFn.mockResolvedValue({
        data: { transcript: 'hello world', toneAnalysis: null, engine: 'gemini' }
      });
      await transcribeEntryFused('QUJD', 'audio/webm', 3, []);
      expect(mockTranscribeEntryFn).toHaveBeenCalledWith({
        base64: 'QUJD',
        mimeType: 'audio/webm',
        properNouns: []
      });
    });

    it('sends markers + durationMs in the request when markers are present', async () => {
      mockTranscribeEntryFn.mockResolvedValue({
        data: { transcript: 'hello world', toneAnalysis: null, engine: 'gemini', chapters: null }
      });
      await transcribeEntryFused('QUJD', 'audio/webm', 3, [], [{ tMs: 5000 }], 9000);
      expect(mockTranscribeEntryFn).toHaveBeenCalledWith({
        base64: 'QUJD',
        mimeType: 'audio/webm',
        properNouns: [],
        markers: [{ tMs: 5000 }],
        durationMs: 9000
      });
    });

    it('forwards chapters through when the server returns a valid array', async () => {
      const chapters = [
        { startMs: 0, title: 'Part One', text: 'Part one.' },
        { startMs: 5000, title: 'Part Two', text: 'Part two.' },
      ];
      mockTranscribeEntryFn.mockResolvedValue({
        data: { transcript: 'Part one. Part two.', toneAnalysis: null, engine: 'gemini', chapters }
      });
      const result = await transcribeEntryFused('QUJD', 'audio/webm', 3, [], [{ tMs: 5000 }], 9000);
      expect(result.chapters).toEqual(chapters);
    });

    it('forwards chapters: null when the server could not build valid chapters', async () => {
      mockTranscribeEntryFn.mockResolvedValue({
        data: { transcript: 'hello world', toneAnalysis: null, engine: 'gemini', chapters: null }
      });
      const result = await transcribeEntryFused('QUJD', 'audio/webm', 3, [], [{ tMs: 5000 }], 9000);
      expect(result.chapters).toBeNull();
    });

    it('does not add a chapters key to the result when no markers were sent (unchanged contract)', async () => {
      mockTranscribeEntryFn.mockResolvedValue({
        data: { transcript: 'hello world', toneAnalysis: { moodScore: 0.5 }, engine: 'gemini' }
      });
      const result = await transcribeEntryFused('QUJD', 'audio/webm');
      expect(result).toEqual({
        rawTranscript: 'hello world',
        transcript: 'hello world',
        toneAnalysis: { moodScore: 0.5 }
      });
      expect(result).not.toHaveProperty('chapters');
    });
  });
});
