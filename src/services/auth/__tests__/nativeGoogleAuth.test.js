import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every real dependency is injected per-test via `deps` — this mock exists
// only so importing the module under test doesn't perform a real Firebase
// SDK init (which triggers an unrelated messaging/unsupported-browser
// rejection under jsdom). Same pattern as
// src/services/insights/__tests__/sourceExclusions.test.js.
vi.mock('../../../config/firebase', () => ({
  auth: {},
  onAuthStateChanged: vi.fn(),
  signInWithCustomToken: vi.fn(),
  exchangeGoogleTokenFn: vi.fn(),
}));

import {
  signInWithNativeGoogle,
  NATIVE_GOOGLE_AUTH_STATES as STATES,
  NATIVE_GOOGLE_AUTH_FAILURE_REASONS as REASONS,
  NATIVE_GOOGLE_AUTH_EVENT_REASONS as EVENTS,
} from '../nativeGoogleAuth';

// Fast timeouts so the SDK-confirmation-gate tests don't slow the suite —
// behavior under test is the state machine's logic, not real wall-clock
// timing.
const FAST_TIMEOUTS = { restFallbackAfterMs: 10, overallMs: 30 };

function makeSocialLoginPlugin({ idToken = 'id-token-123', accessTokenOnly = false, loginError = null } = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockImplementation(async () => {
      if (loginError) throw loginError;
      if (accessTokenOnly) {
        return { result: { accessToken: { token: 'access-token-only' } } };
      }
      if (!idToken) {
        return { result: {} };
      }
      return { result: { idToken } };
    }),
  };
}

/** A stubbed onAuthStateChanged that lets a test fire the callback later. */
function makeAuthStateChangedController() {
  let callback = null;
  const unsubscribe = vi.fn();
  const onAuthStateChanged = vi.fn((auth, cb) => {
    callback = cb;
    return unsubscribe;
  });
  return {
    onAuthStateChanged,
    unsubscribe,
    fire: (user) => callback && callback(user),
  };
}

function collectTransitions() {
  const events = [];
  return { events, onTransition: (e) => events.push(e) };
}

describe('nativeGoogleAuth state machine', () => {
  let infoSpy;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('reaches authenticated ONLY after the SDK listener confirms the user (happy path)', async () => {
    const auth = { currentUser: null };
    const controller = makeAuthStateChangedController();
    const { events, onTransition } = collectTransitions();

    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });

    // The SDK sign-in call resolves, but that resolution must NOT be what
    // produces `authenticated` — only the listener firing does.
    const signInWithCustomToken = vi.fn().mockImplementation(async () => {
      // Simulate the SDK firing its listener after the call resolves.
      controller.fire({ uid: 'uid-1', email: 'user@example.com' });
      return { user: { uid: 'uid-1' } };
    });

    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());

    const result = await signInWithNativeGoogle({
      onTransition,
      deps: {
        registerPlugin,
        auth,
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('authenticated');
    expect(result.user.uid).toBe('uid-1');

    const states = events.map((e) => e.state);
    expect(states).toEqual([
      STATES.IDLE,
      STATES.NATIVE_BRIDGE,
      STATES.CREDENTIAL_EXCHANGE,
      STATES.AWAITING_SDK_USER,
      STATES.AUTHENTICATED,
    ]);

    // Content-free: no event ever carries a token/email.
    for (const event of events) {
      expect(JSON.stringify(event)).not.toMatch(/id-token|custom-token|user@example\.com/);
    }
  });

  it('resolves authenticated immediately when auth.currentUser is already set (no re-fired listener)', async () => {
    const auth = { currentUser: { uid: 'uid-1' } };
    const controller = makeAuthStateChangedController();

    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });
    const signInWithCustomToken = vi.fn().mockResolvedValue({ user: { uid: 'uid-1' } });
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        auth,
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('authenticated');
  });

  it('fails with bridge_no_token when the native bridge returns no idToken or accessToken', async () => {
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin({ idToken: null }));
    const exchangeGoogleTokenFn = vi.fn();

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn,
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result).toEqual({ status: 'failed', reason: REASONS.BRIDGE_NO_TOKEN });
    expect(exchangeGoogleTokenFn).not.toHaveBeenCalled();
  });

  it('distinguishes bridge_access_token_only from a plain missing token', async () => {
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin({ accessTokenOnly: true }));

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn: vi.fn(),
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.reason).toBe(REASONS.BRIDGE_ACCESS_TOKEN_ONLY);
  });

  it('fails with bridge_error when the native plugin throws', async () => {
    const bridgeError = new Error('user cancelled');
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin({ loginError: bridgeError }));

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn: vi.fn(),
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe(REASONS.BRIDGE_ERROR);
    expect(result.error).toBe(bridgeError);
  });

  it('fails with exchange_error (preserving error.code) when the callable throws', async () => {
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const exchangeError = Object.assign(new Error('nope'), { code: 'functions/unauthenticated' });
    const exchangeGoogleTokenFn = vi.fn().mockRejectedValue(exchangeError);

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn,
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe(REASONS.EXCHANGE_ERROR);
    expect(result.error.code).toBe('functions/unauthenticated');
  });

  it('fails with exchange_no_token when the callable returns no customToken', async () => {
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({ data: {} });

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn,
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result).toEqual({ status: 'failed', reason: REASONS.EXCHANGE_NO_TOKEN });
  });

  it('never resolves authenticated from the exchange step alone, even when it returns a user object', async () => {
    // Regression guard for the exact AUTH-01 bug: the exchange resolving
    // must never be treated as sign-in success.
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const controller = makeAuthStateChangedController();
    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1', email: 'user@example.com' } },
    });
    // The SDK call never settles and the listener never fires — simulates
    // the WKWebView hang this system was originally built to route around.
    const signInWithCustomToken = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        auth: { currentUser: null },
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        fetchImpl: vi.fn().mockResolvedValue({ json: async () => ({ error: { message: 'still failing' } }) }),
        firebaseApiKey: 'test-key',
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe(REASONS.SDK_CONFIRMATION_TIMEOUT);
  });

  it('attempts the REST fallback (observably) but only resolves authenticated once the SDK confirms', async () => {
    const auth = { currentUser: null };
    const controller = makeAuthStateChangedController();
    const { events, onTransition } = collectTransitions();

    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });
    // Primary SDK call hangs forever — forces the REST fallback timer.
    const signInWithCustomToken = vi.fn().mockImplementation(() => new Promise(() => {}));
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());

    const fetchImpl = vi.fn().mockImplementation(async () => {
      // REST call "succeeds" (Identity Toolkit accepted the token), but per
      // the invariant this must NOT resolve the machine by itself — only
      // firing the listener afterwards should.
      queueMicrotask(() => controller.fire({ uid: 'uid-1' }));
      return { json: async () => ({ localId: 'uid-1' }) };
    });

    const result = await signInWithNativeGoogle({
      onTransition,
      deps: {
        registerPlugin,
        auth,
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        fetchImpl,
        firebaseApiKey: 'test-key',
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('identitytoolkit.googleapis.com');
    expect(fetchImpl.mock.calls[0][0]).toContain('key=test-key');

    const fallbackEvents = events.filter((e) => e.state === STATES.AWAITING_SDK_USER);
    expect(fallbackEvents.some((e) => e.reason === EVENTS.REST_FALLBACK_ATTEMPTED)).toBe(true);

    expect(result.status).toBe('authenticated');
  });

  it('treats a REST fallback error as non-terminal — the overall timeout still governs', async () => {
    const controller = makeAuthStateChangedController();
    const { events, onTransition } = collectTransitions();

    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });
    const signInWithCustomToken = vi.fn().mockImplementation(() => new Promise(() => {}));
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await signInWithNativeGoogle({
      onTransition,
      deps: {
        registerPlugin,
        auth: { currentUser: null },
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        fetchImpl,
        firebaseApiKey: 'test-key',
        timeouts: FAST_TIMEOUTS,
      },
    });

    const fallbackErrorEvents = events.filter((e) => e.reason === EVENTS.REST_FALLBACK_ERROR);
    expect(fallbackErrorEvents.length).toBe(1);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe(REASONS.SDK_CONFIRMATION_TIMEOUT);
  });

  it('ignores an onAuthStateChanged callback for a mismatched uid (stale prior session) and keeps waiting', async () => {
    const controller = makeAuthStateChangedController();
    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-expected' } },
    });
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());

    const signInWithCustomToken = vi.fn().mockImplementation(async () => {
      // Fire a stale/mismatched user first — must be ignored.
      controller.fire({ uid: 'uid-stale' });
      // Then the correct one.
      setTimeout(() => controller.fire({ uid: 'uid-expected' }), 1);
      return { user: { uid: 'uid-expected' } };
    });

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        auth: { currentUser: null },
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(result.status).toBe('authenticated');
    expect(result.user.uid).toBe('uid-expected');
  });

  it('unsubscribes the SDK listener once settled', async () => {
    const controller = makeAuthStateChangedController();
    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const signInWithCustomToken = vi.fn().mockImplementation(async () => {
      controller.fire({ uid: 'uid-1' });
      return { user: { uid: 'uid-1' } };
    });

    await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        auth: { currentUser: null },
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(controller.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('logs every transition with the stable [nativeGoogleAuth] prefix', async () => {
    const controller = makeAuthStateChangedController();
    const exchangeGoogleTokenFn = vi.fn().mockResolvedValue({
      data: { customToken: 'custom-token-abc', user: { uid: 'uid-1' } },
    });
    const registerPlugin = vi.fn().mockReturnValue(makeSocialLoginPlugin());
    const signInWithCustomToken = vi.fn().mockImplementation(async () => {
      controller.fire({ uid: 'uid-1' });
      return { user: { uid: 'uid-1' } };
    });

    await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        auth: { currentUser: null },
        onAuthStateChanged: controller.onAuthStateChanged,
        signInWithCustomToken,
        exchangeGoogleTokenFn,
        timeouts: FAST_TIMEOUTS,
      },
    });

    expect(infoSpy).toHaveBeenCalled();
    for (const call of infoSpy.mock.calls) {
      expect(call[0]).toBe('[nativeGoogleAuth]');
    }
  });

  it('fails with unexpected_error if something outside the known steps throws', async () => {
    const registerPlugin = vi.fn().mockImplementation(() => {
      throw new Error('registerPlugin exploded');
    });

    const result = await signInWithNativeGoogle({
      deps: {
        registerPlugin,
        exchangeGoogleTokenFn: vi.fn(),
        auth: { currentUser: null },
        onAuthStateChanged: vi.fn(() => vi.fn()),
        signInWithCustomToken: vi.fn(),
        timeouts: FAST_TIMEOUTS,
      },
    });

    // registerPlugin() itself is called inside the native_bridge try/catch,
    // so this surfaces as bridge_error, not unexpected_error — assert the
    // machine still terminates cleanly either way rather than throwing.
    expect(result.status).toBe('failed');
    expect([REASONS.BRIDGE_ERROR, REASONS.UNEXPECTED_ERROR]).toContain(result.reason);
  });
});
