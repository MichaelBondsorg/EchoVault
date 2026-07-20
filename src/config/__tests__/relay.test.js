import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Module state (the "warn once" flag) is scoped to a single import of the
// module, so every test re-imports it fresh after resetting modules + envs.
const loadRelay = async () => {
  vi.resetModules();
  return import('../relay.js');
};

describe('config/relay', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('getRelayWsUrl', () => {
    it('returns the configured wss:// url when valid', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'wss://relay.example.com/voice');
      vi.stubEnv('DEV', false);
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBe('wss://relay.example.com/voice');
    });

    it('rejects a non-wss url in production and returns null', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'ws://relay.example.com/voice');
      vi.stubEnv('DEV', false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects a wss url containing localhost in production and returns null', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'wss://localhost:8080/voice');
      vi.stubEnv('DEV', false);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBeNull();
    });

    it('returns null in production when the env var is unset (no localhost fallback)', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', '');
      vi.stubEnv('DEV', false);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBeNull();
    });

    it('warns only once even if called repeatedly', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', '');
      vi.stubEnv('DEV', false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayWsUrl } = await loadRelay();
      getRelayWsUrl();
      getRelayWsUrl();
      getRelayWsUrl();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does not leak the invalid url value into the warning', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'ws://totally-secret-internal-host:9999/voice');
      vi.stubEnv('DEV', false);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayWsUrl } = await loadRelay();
      getRelayWsUrl();
      const loggedText = warnSpy.mock.calls.map((args) => args.join(' ')).join(' ');
      expect(loggedText).not.toContain('totally-secret-internal-host');
    });

    it('falls back to ws://localhost:8080/voice in dev when unset', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', '');
      vi.stubEnv('DEV', true);
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBe('ws://localhost:8080/voice');
    });

    it('still prefers a valid configured url in dev', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'wss://relay.example.com/voice');
      vi.stubEnv('DEV', true);
      const { getRelayWsUrl } = await loadRelay();
      expect(getRelayWsUrl()).toBe('wss://relay.example.com/voice');
    });
  });

  describe('getRelayHttpUrl', () => {
    it('derives https url from a valid wss url, stripping /voice', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', 'wss://relay.example.com/voice');
      vi.stubEnv('DEV', false);
      const { getRelayHttpUrl } = await loadRelay();
      expect(getRelayHttpUrl()).toBe('https://relay.example.com');
    });

    it('propagates null when the ws url is null (production, unconfigured)', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', '');
      vi.stubEnv('DEV', false);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { getRelayHttpUrl } = await loadRelay();
      expect(getRelayHttpUrl()).toBeNull();
    });

    it('derives http url from the dev localhost fallback', async () => {
      vi.stubEnv('VITE_VOICE_RELAY_URL', '');
      vi.stubEnv('DEV', true);
      const { getRelayHttpUrl } = await loadRelay();
      expect(getRelayHttpUrl()).toBe('http://localhost:8080');
    });
  });
});
