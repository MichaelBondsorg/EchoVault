/**
 * Relay model config: env-overridable with current defaults (plan task M1/M2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MODEL_ENV = ['REALTIME_MODEL', 'WHISPER_MODEL', 'CHAT_MODEL', 'TTS_MODEL', 'TONE_MODEL'];

async function loadConfig() {
  vi.resetModules();
  const mod = await import('../config/index.js');
  return mod.config;
}

describe('relay config — model defaults', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of MODEL_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of MODEL_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults chat/whisper/tts to current production values', async () => {
    const config = await loadConfig();
    expect(config.chatModel).toBe('gpt-4o');
    expect(config.whisperModel).toBe('whisper-1');
    expect(config.ttsModel).toBe('tts-1');
  });

  it('env vars override every model', async () => {
    process.env.REALTIME_MODEL = 'gpt-realtime-2.1';
    process.env.WHISPER_MODEL = 'whisper-x';
    process.env.CHAT_MODEL = 'gpt-4o-mini';
    process.env.TTS_MODEL = 'tts-2';
    process.env.TONE_MODEL = 'gemini-3.5-flash';
    const config = await loadConfig();
    expect(config.realtimeModel).toBe('gpt-realtime-2.1');
    expect(config.whisperModel).toBe('whisper-x');
    expect(config.chatModel).toBe('gpt-4o-mini');
    expect(config.ttsModel).toBe('tts-2');
    expect(config.geminiModel).toBe('gemini-3.5-flash');
  });
});
