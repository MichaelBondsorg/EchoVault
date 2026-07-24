/**
 * Tests for transcribeWithWhisper's model override (MOD-02: the fused
 * transcription fallback previously bypassed the registry because it never
 * passed a `model` option, so this helper's own 'whisper-1' default silently
 * won even when `model.transcriptionFallback` was overridden in
 * config/flags). Mocks global fetch and inspects the outgoing multipart form
 * body — the reachable-request-body test the task asked for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeWithWhisper } from '../openai.js';

describe('transcribeWithWhisper', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('defaults to whisper-1 when no model override is supplied', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello' }),
    });

    await transcribeWithWhisper('key', Buffer.from('audio'), { filename: 'audio.webm' });

    const [, requestInit] = global.fetch.mock.calls[0];
    const sentForm = requestInit.body;
    expect(sentForm.get('model')).toBe('whisper-1');
  });

  it('forwards a non-default registry-resolved model into the request body', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello' }),
    });

    await transcribeWithWhisper('key', Buffer.from('audio'), {
      filename: 'audio.webm',
      model: 'gpt-4o-mini-transcribe',
    });

    const [url, requestInit] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const sentForm = requestInit.body;
    expect(sentForm.get('model')).toBe('gpt-4o-mini-transcribe');
  });
});
