/**
 * Native Google Auth — one explicit state machine.
 *
 * AUTH-01 (docs/superpowers/plans/2026-07-24-full-product-review.md):
 * native Google sign-in previously combined a Capacitor native bridge, a
 * hardcoded Cloud Function URL, a manual REST fallback, custom-token
 * exchange, ad-hoc polling, and a "restart the app" alert fired whenever the
 * Firebase SDK's auth state hadn't converged — several independent paths
 * that could each report success before the SDK actually had an
 * authenticated user. This module replaces all of that with one state
 * machine.
 *
 * States: idle -> native_bridge -> credential_exchange -> awaiting_sdk_user
 *   -> authenticated | failed(reason)
 *
 * Hard invariant: `authenticated` is only reached when the Firebase SDK
 * itself confirms the session (onAuthStateChanged emitting the user, or a
 * synchronous `auth.currentUser` read matching the exchanged uid). Nothing
 * in native_bridge or credential_exchange — including the REST fallback
 * nudge inside awaiting_sdk_user — is ever treated as success on its own.
 *
 * Endpoint source: the custom-token exchange always goes through
 * `exchangeGoogleTokenFn`, the same configured `httpsCallable` every other
 * Cloud Function call in this app uses (`src/config/firebase.js`) — there is
 * no hardcoded `https://us-central1-echo-vault-app.cloudfunctions.net/...`
 * URL anywhere in this module. The one REST call this module makes is to
 * Google's fixed public Identity Toolkit endpoint
 * (`identitytoolkit.googleapis.com`) — not a project-specific hardcoded
 * function URL — using the same `VITE_FIREBASE_API_KEY` config value the
 * rest of the app already relies on, and only as a labeled, logged,
 * non-terminal fallback nudge inside `awaiting_sdk_user` (kept per the
 * review's "prefer keeping questionable fallbacks inside the machine,
 * clearly labeled, over deletion").
 *
 * Every transition is logged content-free via `console.info` with a stable
 * `[nativeGoogleAuth]` prefix (mirrors the `[capture-stage]` pattern in
 * `src/services/telemetry/captureTelemetry.js`) and reported through the
 * optional `onTransition` callback, so fallback selection is observable and
 * this machine is fully testable without touching Capacitor or the real
 * Firebase SDK — every external call is dependency-injected via `deps`.
 */

import { registerPlugin as defaultRegisterPlugin } from '@capacitor/core';
import {
  auth as defaultAuth,
  onAuthStateChanged as defaultOnAuthStateChanged,
  signInWithCustomToken as defaultSignInWithCustomToken,
  exchangeGoogleTokenFn as defaultExchangeGoogleTokenFn,
} from '../../config/firebase';

export const NATIVE_GOOGLE_AUTH_STATES = {
  IDLE: 'idle',
  NATIVE_BRIDGE: 'native_bridge',
  CREDENTIAL_EXCHANGE: 'credential_exchange',
  AWAITING_SDK_USER: 'awaiting_sdk_user',
  AUTHENTICATED: 'authenticated',
  FAILED: 'failed',
};

export const NATIVE_GOOGLE_AUTH_FAILURE_REASONS = {
  // native_bridge
  BRIDGE_ERROR: 'bridge_error',
  BRIDGE_NO_TOKEN: 'bridge_no_token',
  // Some SocialLogin configurations return an accessToken instead of an
  // idToken — the exchange function requires an idToken, so this is a
  // distinguishable dead-end rather than a generic "no token" case.
  BRIDGE_ACCESS_TOKEN_ONLY: 'bridge_access_token_only',
  // credential_exchange
  EXCHANGE_ERROR: 'exchange_error',
  EXCHANGE_NO_TOKEN: 'exchange_no_token',
  // awaiting_sdk_user
  SDK_CONFIRMATION_TIMEOUT: 'sdk_confirmation_timeout',
  UNEXPECTED_ERROR: 'unexpected_error',
};

// Reason codes logged for non-terminal events inside awaiting_sdk_user —
// these never end the machine by themselves, they just make fallback
// selection observable.
export const NATIVE_GOOGLE_AUTH_EVENT_REASONS = {
  REST_FALLBACK_ATTEMPTED: 'rest_fallback_attempted',
  REST_FALLBACK_SUCCEEDED: 'rest_fallback_succeeded',
  REST_FALLBACK_ERROR: 'rest_fallback_error',
};

export const DEFAULT_NATIVE_GOOGLE_AUTH_TIMEOUTS = {
  // How long to wait for the primary signInWithCustomToken SDK call to
  // produce an SDK-confirmed user before nudging via the REST fallback.
  restFallbackAfterMs: 5000,
  // Absolute budget for the whole awaiting_sdk_user gate. If the SDK still
  // hasn't confirmed a user by then, the machine fails with
  // SDK_CONFIRMATION_TIMEOUT rather than ever guessing at success.
  overallMs: 15000,
};

const LOG_PREFIX = '[nativeGoogleAuth]';

// Only these fields are ever logged or handed to onTransition — never
// idToken/customToken/email/displayName. Mirrors the whitelist pattern in
// src/services/telemetry/captureTelemetry.js. uid is deliberately excluded
// (that module treats uid as server-only too).
const META_WHITELIST = ['reason', 'errorCode', 'via'];

function pickWhitelisted(meta) {
  const picked = {};
  for (const key of META_WHITELIST) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) {
      picked[key] = meta[key];
    }
  }
  return picked;
}

function errorMeta(error) {
  if (!error) return {};
  // error.message can occasionally echo back request content (e.g. an
  // email) from some Firebase error strings — only the stable `code` is
  // safe to log unconditionally.
  return { errorCode: error.code || 'unknown_error' };
}

function makeEmitter(onTransition, nowFn, startedAt) {
  return function emit(state, reason, meta = {}) {
    const event = {
      state,
      reason: reason || null,
      atMs: nowFn(),
      durationMs: nowFn() - startedAt,
      ...pickWhitelisted(meta),
    };
    console.info(LOG_PREFIX, state, reason || '');
    try {
      onTransition(event);
    } catch {
      // A misbehaving observer must never break the auth flow.
    }
    return event;
  };
}

/**
 * Run the native Google auth state machine to completion.
 *
 * @param {object} [options]
 * @param {(event: object) => void} [options.onTransition] - called on every
 *   transition with a content-free event `{state, reason, atMs, durationMs,
 *   ...whitelistedMeta}`.
 * @param {object} [options.deps] - dependency overrides, for tests. Defaults
 *   to the real Capacitor plugin registry and the app's configured Firebase
 *   SDK instance/callable.
 * @returns {Promise<{status: 'authenticated', user: object} |
 *   {status: 'failed', reason: string, error?: Error}>}
 */
export async function signInWithNativeGoogle({ onTransition = () => {}, deps = {} } = {}) {
  const {
    registerPlugin = defaultRegisterPlugin,
    auth = defaultAuth,
    onAuthStateChanged = defaultOnAuthStateChanged,
    signInWithCustomToken = defaultSignInWithCustomToken,
    exchangeGoogleTokenFn = defaultExchangeGoogleTokenFn,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined,
    now = () => Date.now(),
    timeouts = DEFAULT_NATIVE_GOOGLE_AUTH_TIMEOUTS,
    firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY,
    googleWebClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID,
    googleIosClientId = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
    googleIosServerClientId = import.meta.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID,
  } = deps;

  const STATES = NATIVE_GOOGLE_AUTH_STATES;
  const REASONS = NATIVE_GOOGLE_AUTH_FAILURE_REASONS;
  const EVENTS = NATIVE_GOOGLE_AUTH_EVENT_REASONS;

  const startedAt = now();
  const emit = makeEmitter(onTransition, now, startedAt);

  emit(STATES.IDLE);

  try {
    // --- native_bridge -----------------------------------------------
    emit(STATES.NATIVE_BRIDGE);

    let idToken;
    let hasAccessTokenOnly = false;
    try {
      const SocialLogin = registerPlugin('SocialLogin');
      await SocialLogin.initialize({
        google: {
          webClientId: googleWebClientId,
          iOSClientId: googleIosClientId,
          iOSServerClientId: googleIosServerClientId,
        },
      });
      const response = await SocialLogin.login({
        provider: 'google',
        options: { scopes: ['email', 'profile'] },
      });
      idToken = response?.result?.idToken;
      hasAccessTokenOnly = !idToken && !!response?.result?.accessToken?.token;
    } catch (error) {
      emit(STATES.FAILED, REASONS.BRIDGE_ERROR, errorMeta(error));
      return { status: 'failed', reason: REASONS.BRIDGE_ERROR, error };
    }

    if (!idToken) {
      const reason = hasAccessTokenOnly ? REASONS.BRIDGE_ACCESS_TOKEN_ONLY : REASONS.BRIDGE_NO_TOKEN;
      emit(STATES.FAILED, reason);
      return { status: 'failed', reason };
    }

    // --- credential_exchange -------------------------------------------
    emit(STATES.CREDENTIAL_EXCHANGE);

    let customToken;
    let expectedUid;
    try {
      const exchangeResult = await exchangeGoogleTokenFn({ idToken });
      const resultData = exchangeResult?.data || {};
      customToken = resultData.customToken;
      expectedUid = resultData.user?.uid;
    } catch (error) {
      emit(STATES.FAILED, REASONS.EXCHANGE_ERROR, errorMeta(error));
      return { status: 'failed', reason: REASONS.EXCHANGE_ERROR, error };
    }

    if (!customToken) {
      emit(STATES.FAILED, REASONS.EXCHANGE_NO_TOKEN);
      return { status: 'failed', reason: REASONS.EXCHANGE_NO_TOKEN };
    }

    // --- awaiting_sdk_user -----------------------------------------------
    // The ONLY gate that may resolve `authenticated` is the Firebase SDK
    // itself confirming the user — never the exchange above, never the
    // REST fallback nudge below, resolving on their own.
    emit(STATES.AWAITING_SDK_USER);

    return await new Promise((resolve) => {
      let settled = false;
      let restTimer;
      let overallTimer;

      const cleanup = () => {
        clearTimeout(restTimer);
        clearTimeout(overallTimer);
        try {
          unsubscribe();
        } catch {
          // best-effort
        }
      };

      const finishAuthenticated = (user, via) => {
        if (settled) return;
        settled = true;
        cleanup();
        emit(STATES.AUTHENTICATED, null, { via });
        resolve({ status: 'authenticated', user });
      };

      const finishFailed = (reason, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        emit(STATES.FAILED, reason, errorMeta(error));
        resolve({ status: 'failed', reason, error });
      };

      const matchesExpectedUid = (user) => !!user && (!expectedUid || user.uid === expectedUid);

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (matchesExpectedUid(user)) {
          finishAuthenticated(user, 'sdk_listener');
        }
      });

      // Trigger the SDK sign-in. Its own resolution is only a trigger for
      // onAuthStateChanged above — never treated as success by itself. Some
      // WKWebView builds have been observed to hang this call, which is
      // exactly why the REST fallback below exists as a labeled nudge, not
      // a silent alternate success path.
      signInWithCustomToken(auth, customToken).catch(() => {
        // Swallowed deliberately: a rejection here does not fail the
        // machine outright — the REST fallback and overall timeout below
        // still govern the outcome, exactly like a hang would.
      });

      // Some SDK configurations set auth.currentUser synchronously without
      // re-invoking a freshly-attached onAuthStateChanged listener.
      if (matchesExpectedUid(auth.currentUser)) {
        finishAuthenticated(auth.currentUser, 'sdk_current_user');
        return;
      }

      restTimer = setTimeout(async () => {
        if (settled) return;
        emit(STATES.AWAITING_SDK_USER, EVENTS.REST_FALLBACK_ATTEMPTED);
        try {
          if (!firebaseApiKey || !fetchImpl) {
            throw new Error('rest-fallback-unavailable');
          }
          const restUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseApiKey}`;
          const restResponse = await fetchImpl(restUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true }),
          });
          const restData = await restResponse.json();
          if (restData?.error) {
            throw new Error(restData.error.message || 'rest-exchange-error');
          }
          // Success here means the Identity Toolkit accepted the token and
          // should persist a session the SDK will pick up — it is
          // deliberately NOT treated as `authenticated`. Only
          // onAuthStateChanged / auth.currentUser above may do that.
          if (!settled) emit(STATES.AWAITING_SDK_USER, EVENTS.REST_FALLBACK_SUCCEEDED);
          if (matchesExpectedUid(auth.currentUser)) {
            finishAuthenticated(auth.currentUser, 'rest_fallback');
          }
        } catch (error) {
          if (!settled) emit(STATES.AWAITING_SDK_USER, EVENTS.REST_FALLBACK_ERROR, errorMeta(error));
          // Non-terminal — the overall timeout below still governs.
        }
      }, timeouts.restFallbackAfterMs);

      overallTimer = setTimeout(() => {
        finishFailed(REASONS.SDK_CONFIRMATION_TIMEOUT);
      }, timeouts.overallMs);
    });
  } catch (error) {
    emit(STATES.FAILED, REASONS.UNEXPECTED_ERROR, errorMeta(error));
    return { status: 'failed', reason: REASONS.UNEXPECTED_ERROR, error };
  }
}

export default {
  signInWithNativeGoogle,
  NATIVE_GOOGLE_AUTH_STATES,
  NATIVE_GOOGLE_AUTH_FAILURE_REASONS,
  NATIVE_GOOGLE_AUTH_EVENT_REASONS,
  DEFAULT_NATIVE_GOOGLE_AUTH_TIMEOUTS,
};
