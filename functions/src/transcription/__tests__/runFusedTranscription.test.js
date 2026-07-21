/**
 * Tests for runFusedTranscription — the reusable fused-transcription flow the
 * storage-triggered background-upload path uses (mirrors the transcribeEntry
 * callable). Gemini primary with a Whisper fallback; injected fetch + a mocked
 * Whisper helper keep it a pure unit test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWhisper = vi.fn();
vi.mock('../../shared/openai.js', () => ({
  transcribeWithWhisper: (...args) => mockWhisper(...args),
}));

const { runFusedTranscription, GEMINI_TRANSCRIBE_MODEL } = await import('../fusedTranscription.js');

const geminiOk = (payload) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
});

describe('runFusedTranscription', () => {
  beforeEach(() => {
    mockWhisper.mockReset();
  });

  it('returns the fused Gemini result when Gemini succeeds (no Whisper call)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiOk({
      rawTranscript: 'I had, um, a good day.',
      transcript: 'I had a good day.',
      toneAnalysis: { moodScore: 0.8, energy: 'high', emotions: ['happy'], confidence: 0.9, summary: 'Upbeat.' },
    }));

    const result = await runFusedTranscription({
      base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl,
    });

    expect(result.engine).toBe('gemini');
    expect(result.transcript).toBe('I had a good day.');
    expect(result.toneAnalysis.energy).toBe('high');
    expect(fetchImpl.mock.calls[0][0]).toContain(GEMINI_TRANSCRIBE_MODEL);
    expect(mockWhisper).not.toHaveBeenCalled();
  });

  it('returns API_NO_CONTENT when Gemini heard no speech (empty transcript)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiOk({ rawTranscript: '', transcript: '', toneAnalysis: null }));
    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl });
    expect(result).toEqual({ error: 'API_NO_CONTENT' });
    expect(mockWhisper).not.toHaveBeenCalled();
  });

  it('falls back to Whisper when Gemini returns a non-429 HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    mockWhisper.mockResolvedValue({ text: '  fallback transcript  ' });

    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/webm', gemKey: 'g', oaiKey: 'o', fetchImpl });

    expect(result.engine).toBe('whisper');
    expect(result.transcript).toBe('fallback transcript');
    expect(result.toneAnalysis).toBeNull();
    expect(mockWhisper).toHaveBeenCalledTimes(1);
  });

  it('falls back to Whisper when the Gemini call throws (network/timeout)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    mockWhisper.mockResolvedValue({ text: 'recovered' });
    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl });
    expect(result.engine).toBe('whisper');
    expect(result.transcript).toBe('recovered');
  });

  it('returns API_ERROR when no keys are configured', async () => {
    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4' });
    expect(result).toEqual({ error: 'API_ERROR' });
  });

  it('returns API_NO_CONTENT when Whisper succeeds but returns empty text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    mockWhisper.mockResolvedValue({ text: '   ' });
    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl });
    expect(result).toEqual({ error: 'API_NO_CONTENT' });
  });

  it('returns API_ERROR when Whisper fails (null) after Gemini falls through', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    mockWhisper.mockResolvedValue(null);
    const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl });
    expect(result).toEqual({ error: 'API_ERROR' });
    // 429 must trigger the Whisper fallback
    expect(mockWhisper).toHaveBeenCalledTimes(1);
  });

  describe('markers / chapters (Task 14)', () => {
    it('threads markers into the Gemini request body and returns valid chapters', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(geminiOk({
        rawTranscript: 'Part one. Part two.',
        transcript: 'Part one. Part two.',
        toneAnalysis: null,
        chapters: [
          { startMs: 0, title: 'Part One', text: 'Part one.' },
          { startMs: 5000, title: 'Part Two', text: 'Part two.' },
        ],
      }));

      const result = await runFusedTranscription({
        base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl,
        markers: [{ tMs: 5000 }], durationMs: 9000,
      });

      expect(result.engine).toBe('gemini');
      expect(result.chapters).toEqual([
        { startMs: 0, title: 'Part One', text: 'Part one.' },
        { startMs: 5000, title: 'Part Two', text: 'Part two.' },
      ]);
      const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(requestBody.contents[0].parts[1].text).toContain('0:05');
    });

    it('returns chapters: null when no markers were supplied (default)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(geminiOk({
        rawTranscript: 'Hello.', transcript: 'Hello.', toneAnalysis: null,
      }));
      const result = await runFusedTranscription({ base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl });
      expect(result.chapters).toBeNull();
    });

    it('returns chapters: null when the Gemini chapters payload fails validation', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(geminiOk({
        rawTranscript: 'Part one. Part two.',
        transcript: 'Part one. Part two.',
        toneAnalysis: null,
        chapters: [{ startMs: 0, title: 'Only One', text: 'Part one. Part two.' }], // wrong count
      }));
      const result = await runFusedTranscription({
        base64: 'QUJD', mimeType: 'audio/mp4', gemKey: 'g', oaiKey: 'o', fetchImpl,
        markers: [{ tMs: 5000 }],
      });
      expect(result.engine).toBe('gemini');
      expect(result.transcript).toBe('Part one. Part two.'); // transcription still succeeds
      expect(result.chapters).toBeNull();
    });

    it('always returns chapters: null on the Whisper fallback path, even with markers', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      mockWhisper.mockResolvedValue({ text: 'fallback' });
      const result = await runFusedTranscription({
        base64: 'QUJD', mimeType: 'audio/webm', gemKey: 'g', oaiKey: 'o', fetchImpl,
        markers: [{ tMs: 5000 }],
      });
      expect(result.engine).toBe('whisper');
      expect(result.chapters).toBeNull();
    });
  });
});
