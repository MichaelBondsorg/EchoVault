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
});
