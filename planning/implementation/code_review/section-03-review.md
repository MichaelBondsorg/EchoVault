# Code Review: Section 03 - FCM Notifications

**Date:** 2026-02-19T09:45:00Z

## HIGH SEVERITY

### 1. Token ID Collision Hazard
`deriveTokenId()` uses `token.substring(0, 20)`. FCM tokens share common prefixes, creating collision risk. Should use hash.

### 2. Server-Side Tests Not Discoverable
Tests in `functions/src/` not picked up by root vitest config. Known limitation (same as section-01).

### 3. Native Token Registration Has No Timeout
`registerNativeToken()` hangs forever if neither registration nor error event fires. Needs timeout.

### 4. Listener Accumulation on Repeated Calls
`initializeDeepLinks()` and `registerNativeToken()` add listeners without guard against multiple calls.

## MEDIUM SEVERITY

### 5. Web Deep Link Auto-Navigates on Foreground Messages
`onMessage` handler calls `handleDeepLink()` directly, yanking user from current view. Should show banner instead.

### 6. handleDeepLink Never Sets Resource Params
Navigates to view but never populates `activeReport` or similar store state.

### 7. storeToken Uses setDoc Without merge:true
Re-registration overwrites entire document including server-set `lastUsed`.

## LOW SEVERITY

### 8. prompt_suggestion Template Not in Plan
Extra template type - harmless but unspecified.

### 9. Android clickAction Set to Flutter Value
Copy-paste bug: `FLUTTER_NOTIFICATION_CLICK` should be removed.

### 10. Fragile toLocaleString Parsing
Delivery delay uses locale string re-parsing.

## MISSING REQUIREMENTS

### 11. useNotifications Hook Not Updated
No integration point for `initializeNotifications()`.

### 12. functions/index.js Not Updated
Sender is internal module - acceptable.

### 13. No VAPID Key Configuration
`getToken()` needs `{ vapidKey: '...' }` for web push.

### 14. Hardcoded APP_ID in Sender
Should import from shared constants.
