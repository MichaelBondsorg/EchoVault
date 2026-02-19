# Code Review Interview: Section 03 - FCM Notifications

**Date:** 2026-02-19T10:05:00Z

## Auto-Fixes Applied

1. **Token ID collision hazard** (High #1): Replaced `token.substring(0, 20)` with hash-based derivation using djb2 hash + token length encoding. Updated tests accordingly.

2. **Native registration timeout** (High #3): Added 15-second timeout to `registerNativeToken()` to prevent indefinite hang if registration/error events never fire.

3. **Listener accumulation** (Medium #4): Added `deepLinksInitialized` guard flag to `initializeDeepLinks()` preventing duplicate listener registration on re-auth.

4. **Web foreground auto-navigation** (Medium #5): Changed web `onMessage` handler to log-only instead of auto-navigating. Added TODO for in-app notification banner.

5. **storeToken merge** (Medium #7): Added `{ merge: true }` to `setDoc` call in `storeToken()` to preserve server-set `lastUsed` timestamps.

6. **Flutter clickAction** (Low #9): Removed `clickAction: 'FLUTTER_NOTIFICATION_CLICK'` from Android payload.

7. **Hardcoded APP_ID** (Low #14): Replaced hardcoded string with import from `../shared/constants.js`.

8. **VAPID key** (Missing #13): Added `import.meta.env.VITE_FIREBASE_VAPID_KEY` support to `registerWebToken()`.

## User Interview

**Q: Wire notification initialization into existing useNotifications hook?**
- User chose: **Wire into useNotifications hook now**
- Action: Updated `useNotifications` hook to accept optional `userId` param. When userId is provided, auto-initializes FCM token registration, deep links, and timezone detection via dynamic import of `initializeNotifications`. Added `initializedRef` guard to prevent re-initialization.

## Items Let Go

- Server-side test infrastructure (#2): Known limitation - `functions/src/` tests not picked up by root vitest config. Same as section-01.
- handleDeepLink params not set on store (#6): Navigation works but report detail won't have `activeReport` populated. Deferred to section-06 (Report Frontend) which will implement the store integration.
- prompt_suggestion template (#8): Forward-looking, harmless extra template.
- toLocaleString parsing (#10): Works correctly in Node 20. Conditional test guards are a trade-off for time-dependent tests.
- functions/index.js not updated (#12): Sender is internal module called by other Cloud Functions, not a callable endpoint.
