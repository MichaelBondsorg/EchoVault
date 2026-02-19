Now I have all the context I need. Let me generate the section content.

# Section 03: FCM Notifications

## Overview

This section implements the push notification system using Firebase Cloud Messaging (FCM). It covers three layers: client-side token collection and management, server-side notification dispatch via Cloud Functions, and deep linking to navigate users to specific content when they tap a notification.

This section has **no dependencies** on other sections and **blocks section-05 (Report Cloud Functions)**, which needs the notification sender to alert users when reports are ready.

## Background

The existing codebase has a minimal `useNotifications` hook at `/Users/michaelbond/echo-vault/src/hooks/useNotifications.js` that only requests browser `Notification.permission`. FCM is not wired up -- there is no token collection, no server-side dispatch, and no deep link handling. The app uses Capacitor 8 for native iOS/Android and Firebase SDK v10 for web. The `firebase-admin` package (v12) is already a dependency in `functions/package.json` and includes the messaging module needed for server-side dispatch.

### Firestore Path Convention

All user data lives under `artifacts/echo-vault-v5-fresh/users/{userId}/...`. The constant `APP_COLLECTION_ID` (value `'echo-vault-v5-fresh'`) is defined in `/Users/michaelbond/echo-vault/src/config/constants.js` and used via the `BaseRepository` pattern in `/Users/michaelbond/echo-vault/src/repositories/base.js`. On the server side (Cloud Functions), the same path must be constructed using `firebase-admin` Firestore references.

### Platform Detection

The app already uses `Capacitor.getPlatform()` and `Capacitor.isNativePlatform()` from `@capacitor/core` (see `/Users/michaelbond/echo-vault/src/config/firebase.js`). The notification system must detect the platform to choose the correct token collection strategy (Firebase Messaging SDK for web, Capacitor Push Notifications plugin for iOS/Android).

---

## Tests First

All client-side tests go under `src/services/notifications/__tests__/` and follow the existing Vitest conventions. Cloud Function tests go under `functions/src/notifications/__tests__/`.

### Client-Side Token Manager Tests

**File:** `/Users/michaelbond/echo-vault/src/services/notifications/__tests__/tokenManager.test.js`

```js
/**
 * Token Manager Tests
 *
 * Tests FCM token registration, refresh, and platform detection.
 * Mocks Firebase Messaging SDK and Capacitor Push Notifications plugin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase config and Firestore operations
vi.mock('../../../config/firebase', () => ({
  db: {},
  doc: vi.fn(),
  setDoc: vi.fn(),
  Timestamp: { now: () => ({ seconds: 1234567890 }) }
}));

vi.mock('../../../config/constants', () => ({
  APP_COLLECTION_ID: 'test-collection'
}));

describe('tokenManager', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers new FCM token with platform identifier');
  // Should call setDoc with token, platform string, and createdAt timestamp
  // Token doc ID should be a hash/truncation of the token for idempotent writes

  it('updates existing token on refresh');
  // When a token refresh event fires, the old token doc should be replaced
  // with the new token value while preserving the platform field

  it('detects platform correctly (ios/android/web)');
  // Should use Capacitor.getPlatform() to determine the platform string
  // and store it alongside the token in Firestore
});
```

### Server-Side Sender Tests

**File:** `/Users/michaelbond/echo-vault/functions/src/notifications/__tests__/sender.test.js`

```js
/**
 * Notification Sender Tests
 *
 * Tests FCM dispatch, token cleanup, delivery window, payload formatting.
 * Mocks firebase-admin messaging.
 */

describe('sender', () => {
  it('sends notification to all user tokens');
  // Should query all docs in fcm_tokens subcollection
  // and call admin.messaging().send() for each token

  it('removes invalid/expired tokens on delivery failure');
  // When messaging().send() throws messaging/invalid-registration-token
  // or messaging/registration-token-not-registered, delete that token doc

  it('respects delivery window (delays notification to appropriate hours)');
  // Given a user with timezone "America/New_York" and deliveryWindowStart: 8,
  // if current time in that timezone is 3 AM, calculate delay to 8 AM
  // and return scheduleDelaySeconds for Cloud Task enqueue

  it('includes deep link data in payload');
  // Notification payload should include data field with type and resourceId
  // e.g., { type: 'report', reportId: 'monthly-2026-01' }

  it('formats iOS payload (APNs) correctly');
  // Should include apns.payload.aps with alert, sound, and badge fields
  // and apns.fcm_options.image if applicable

  it('formats Android payload correctly');
  // Should include android.notification with title, body, click_action
  // and android.data with deep link info
});
```

### Deep Links Tests

**File:** `/Users/michaelbond/echo-vault/src/services/notifications/__tests__/deepLinks.test.js`

```js
/**
 * Deep Links Tests
 *
 * Tests notification tap handling and in-app navigation.
 */

describe('deepLinks', () => {
  it('parses report deep link data correctly');
  // Given { type: 'report', reportId: 'monthly-2026-01' },
  // should return { view: 'report-detail', params: { reportId: 'monthly-2026-01' } }

  it('navigates to report view via uiStore');
  // Should call uiStore.setView('report-detail') and set activeReport

  it('handles unknown notification type gracefully');
  // Should not throw, should log warning, and navigate to default view

  it('handles missing data fields gracefully');
  // If notification has no data payload, should not crash
});
```

---

## Implementation Details

### New Dependencies

**Frontend (`/Users/michaelbond/echo-vault/package.json`):**

- `@capacitor/push-notifications` -- Capacitor plugin for native iOS/Android push notification registration and event handling. Add to dependencies and also add the mock alias in `vitest.config.js`.

**Backend (`/Users/michaelbond/echo-vault/functions/package.json`):**

- No new dependencies needed. `firebase-admin` v12 already includes `firebase-admin/messaging`.

### Vitest Config Update

**File to modify:** `/Users/michaelbond/echo-vault/vitest.config.js`

Add the Capacitor Push Notifications mock alias to the `resolve.alias` section:

```js
'@capacitor/push-notifications': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
```

This follows the existing pattern where all Capacitor plugins are mapped to the generic capacitor mock.

---

### New Firestore Collections

All paths below are relative to `artifacts/echo-vault-v5-fresh/users/{userId}/`:

**`fcm_tokens/{tokenId}`** -- Stores one document per registered device token.

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | The FCM registration token |
| `platform` | string | `"ios"`, `"android"`, or `"web"` |
| `createdAt` | Timestamp | When the token was first registered |
| `lastUsed` | Timestamp | Updated each time a notification is successfully sent to this token |

**`settings/notifications`** -- Stores user notification preferences (extends existing notification settings in `usersRepository`).

| Field | Type | Description |
|-------|------|-------------|
| `timezone` | string | IANA timezone string (e.g., `"America/New_York"`), auto-detected on app init |
| `deliveryWindowStart` | number | Hour (0-23) for earliest notification delivery (default: 8) |
| `deliveryWindowEnd` | number | Hour (0-23) for latest notification delivery (default: 21) |
| `enabled` | boolean | Master notification toggle |

The existing `usersRepository` at `/Users/michaelbond/echo-vault/src/repositories/users.js` already has `getNotificationSettingsRef()` and `saveNotificationSettings()` methods that point to `users/{userId}/settings/notifications`. The new `timezone`, `deliveryWindowStart`, and `deliveryWindowEnd` fields should be added alongside the existing fields using `setDoc` with `{ merge: true }`.

---

### Files to Create

#### 1. `/Users/michaelbond/echo-vault/src/services/notifications/index.js`

Public API module that re-exports the notification service functions.

Exports:
- `initializeNotifications(userId)` -- Call on app init after auth. Handles permission request, token collection, and listener setup.
- `registerToken(userId)` -- Registers the current device's FCM token.
- `handleTokenRefresh(userId)` -- Handles token rotation.
- `handleNotificationTap(data)` -- Processes deep link data from notification tap.
- `updateTimezone(userId)` -- Detects and stores user's IANA timezone.

#### 2. `/Users/michaelbond/echo-vault/src/services/notifications/tokenManager.js`

Core token management logic.

**Key responsibilities:**
- Detect platform via `Capacitor.getPlatform()` (returns `'ios'`, `'android'`, or `'web'`).
- **Web path:** Use Firebase Messaging SDK (`getMessaging()`, `getToken()` from `firebase/messaging`). Requires a VAPID key configured in Firebase Console. Listen for token refresh via `onMessage()`.
- **Native path (iOS/Android):** Use `@capacitor/push-notifications` plugin. Call `PushNotifications.register()` after `PushNotifications.requestPermissions()`. Listen for `'registration'` event to receive the token. Listen for `'registrationError'` to handle failures.
- **Token storage:** Write to Firestore at `artifacts/{APP_COLLECTION_ID}/users/{userId}/fcm_tokens/{tokenId}`. The `tokenId` should be derived from the token string (e.g., first 20 characters or a hash) to enable idempotent writes when the same token is re-registered.
- **Token refresh:** On refresh event, delete the old token document and write a new one with the updated token.
- **Timezone detection:** On init, detect the user's timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` and write it to the notification settings document.

**Function signatures:**

```js
/**
 * Request notification permissions and register the FCM token.
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<{granted: boolean, token?: string}>}
 */
export async function registerToken(userId) { /* ... */ }

/**
 * Handle FCM token refresh by replacing the stored token.
 * @param {string} userId - Authenticated user ID
 * @param {string} oldToken - Previous token to remove
 * @param {string} newToken - New token to store
 * @returns {Promise<void>}
 */
export async function handleTokenRefresh(userId, oldToken, newToken) { /* ... */ }

/**
 * Detect and store the user's IANA timezone.
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<void>}
 */
export async function updateTimezone(userId) { /* ... */ }
```

#### 3. `/Users/michaelbond/echo-vault/src/services/notifications/deepLinks.js`

Handles notification tap events and translates deep link data into in-app navigation.

**Key responsibilities:**
- **Native path:** Register a listener for `PushNotifications.addListener('pushNotificationActionPerformed', ...)` from `@capacitor/push-notifications`. The callback receives the notification data including the deep link payload.
- **Web path:** Handle foreground messages via Firebase Messaging `onMessage()` callback.
- **Navigation:** Parse the notification data payload (e.g., `{ type: 'report', reportId: 'monthly-2026-01' }`) and navigate using the Zustand `uiStore.setView()` action. For reports, set `view: 'report-detail'` and populate the reports store's `activeReport`.
- **Safety:** Handle unknown or malformed notification data gracefully (log warning, navigate to default view).

**Deep link data format:**

```js
// Notification data payload structure
{
  type: 'report',        // Notification category
  reportId: 'monthly-2026-01'  // Resource identifier
}
// Future types: 'insight', 'prompt', etc.
```

**Function signatures:**

```js
/**
 * Initialize deep link listeners for notification taps.
 * Call once on app init.
 * @returns {Promise<void>}
 */
export async function initializeDeepLinks() { /* ... */ }

/**
 * Parse notification data and navigate to the appropriate view.
 * @param {Object} data - Notification data payload
 * @returns {void}
 */
export function handleDeepLink(data) { /* ... */ }
```

#### 4. `/Users/michaelbond/echo-vault/functions/src/notifications/sender.js`

Server-side FCM notification dispatch. Called by report generation (section-05) and other features that need to notify users.

**Key responsibilities:**
- Accept a `userId` and notification content (title, body, data payload).
- Query all FCM tokens for the user from `fcm_tokens/` subcollection.
- Use `firebase-admin` messaging to send to each token.
- **Platform-specific formatting:** Build APNs payload for iOS tokens, FCM payload for Android tokens. Include sound, badge count, and deep link data.
- **Invalid token cleanup:** If `messaging().send()` throws `messaging/invalid-registration-token` or `messaging/registration-token-not-registered`, delete that token document from Firestore. This prevents token buildup from uninstalled apps.
- **Timezone-aware delivery:** Read the user's notification settings (`settings/notifications`) to get `timezone`, `deliveryWindowStart`, and `deliveryWindowEnd`. Calculate whether the current time falls within the user's delivery window. If not, return a `scheduleDelaySeconds` value for the caller to use when enqueuing a Cloud Task. The sender itself does not enqueue tasks -- it returns the delay for the caller to handle.

**Function signatures:**

```js
/**
 * Send a notification to a user's registered devices.
 * @param {string} userId - Target user ID
 * @param {Object} notification - { title: string, body: string }
 * @param {Object} data - Deep link data payload (e.g., { type: 'report', reportId: '...' })
 * @param {Object} options - { respectDeliveryWindow?: boolean }
 * @returns {Promise<{ sent: number, failed: number, delayed?: number }>}
 */
export async function sendNotification(userId, notification, data, options = {}) { /* ... */ }

/**
 * Calculate delay in seconds until the user's delivery window opens.
 * Returns 0 if currently within the window.
 * @param {string} timezone - IANA timezone string
 * @param {number} windowStart - Hour (0-23)
 * @param {number} windowEnd - Hour (0-23)
 * @returns {number} Delay in seconds
 */
export function calculateDeliveryDelay(timezone, windowStart, windowEnd) { /* ... */ }
```

#### 5. `/Users/michaelbond/echo-vault/functions/src/notifications/templates.js`

Notification content templates for different notification types. Keeps notification copy centralized and consistent.

**Templates:**

```js
/**
 * Generate notification content for a specific notification type.
 * @param {string} type - Notification type (e.g., 'report_ready')
 * @param {Object} params - Template parameters
 * @returns {{ title: string, body: string, data: Object }}
 */
export function getNotificationTemplate(type, params) { /* ... */ }
```

**Supported types:**

| Type | Title Template | Body Template | Data |
|------|---------------|---------------|------|
| `report_ready` | `"Your {cadence} report is ready"` | `"Your {periodLabel} Life Report is ready to read."` | `{ type: 'report', reportId }` |
| `insight_available` | `"New insight"` | `"Something interesting came up in your recent patterns."` | `{ type: 'insight' }` |

---

### Files to Modify

#### 1. `/Users/michaelbond/echo-vault/src/config/firebase.js`

Add Firebase Messaging imports for web token collection:

```js
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
```

Export the messaging instance:

```js
// Only initialize messaging on web (not native)
let messaging = null;
if (!Capacitor.isNativePlatform() && typeof window !== 'undefined') {
  try {
    messaging = getMessaging(app);
  } catch (e) {
    console.warn('[Firebase] Messaging not available:', e.message);
  }
}
export { messaging };
```

Also export `getToken` and `onMessage` for use by the token manager.

#### 2. `/Users/michaelbond/echo-vault/src/repositories/users.js`

The existing `saveNotificationSettings()` and `getNotificationSettings()` methods already handle the `settings/notifications` document. The new fields (`timezone`, `deliveryWindowStart`, `deliveryWindowEnd`) will be written via these existing methods using `setDoc` with `{ merge: true }`, so no structural changes are needed. However, update the defaults object in `getNotificationSettings()` to include:

```js
const defaults = {
  enabled: false,
  dailyReminder: false,
  reminderTime: '20:00',
  weeklyDigest: false,
  insightAlerts: true,
  crisisResources: true,
  timezone: null,             // NEW - detected on init
  deliveryWindowStart: 8,     // NEW - default 8 AM
  deliveryWindowEnd: 21       // NEW - default 9 PM
};
```

#### 3. `/Users/michaelbond/echo-vault/src/hooks/useNotifications.js`

The existing hook only handles browser `Notification.permission`. It should be extended (or the new notification service should be called from the appropriate app initialization point) to integrate with the new token manager. The hook itself can remain simple -- the heavy lifting moves to `src/services/notifications/tokenManager.js`.

Add a call to `initializeNotifications(userId)` from the service when the user is authenticated and the hook indicates permissions are granted. The best integration point is in `App.jsx` where auth state changes are handled, calling `initializeNotifications` after successful login.

#### 4. `/Users/michaelbond/echo-vault/vitest.config.js`

Add the `@capacitor/push-notifications` alias as described above.

#### 5. `/Users/michaelbond/echo-vault/functions/index.js`

Export the new notification Cloud Function(s) if any are exposed as callable functions. The `sendNotification` function in `sender.js` is an internal module called by other Cloud Functions (report generator, etc.), not a directly callable function. However, if a callable endpoint is needed for testing or future use, it should be added here.

---

### Firestore Security Rules

These rules are formally defined in section-02 but are noted here for completeness. The `fcm_tokens` collection requires:

- **Write:** Authenticated users can create and update their own tokens only.
- **Read:** No client reads needed (tokens are only read server-side by Cloud Functions).
- **Delete:** Authenticated users can delete their own tokens (for logout/unregister scenarios).

```
match /fcm_tokens/{tokenId} {
  allow create, update: if request.auth != null && request.auth.uid == userId;
  allow delete: if request.auth != null && request.auth.uid == userId;
  allow read: if false; // Server-side only
}
```

---

### Integration Points

**How section-05 (Report Cloud Functions) uses this section:**

After generating a report, the report generator calls `sendNotification(userId, notification, data)` from `functions/src/notifications/sender.js`. The `data` payload includes `{ type: 'report', reportId }` so the deep link handler can navigate to the report viewer. If the user is outside their delivery window, the sender returns a `scheduleDelaySeconds` value and the report generator enqueues a Cloud Task with that delay.

**How the app initialization flow works:**

1. User authenticates (handled in `App.jsx` / `authStore`).
2. `initializeNotifications(userId)` is called.
3. Token manager requests permissions (platform-appropriate).
4. If granted, registers the FCM token in Firestore.
5. Deep link listeners are initialized.
6. Timezone is detected and stored in notification settings.
7. On subsequent token refresh events, the token is updated in Firestore.

---

### GDPR / Account Deletion

When a user deletes their account, all documents in `fcm_tokens/` must be deleted, along with the `settings/notifications` document. This is handled by section-02 (Firestore rules) and section-15 (Safety integration) which define the full GDPR deletion plan. The notification system must be aware that tokens can be deleted externally, and handle missing token documents gracefully.

---

## Implementation Notes

### Code Review Changes
1. **Token ID collision fix**: Replaced `substring(0, 20)` with djb2 hash + length encoding for idempotent, collision-resistant token IDs.
2. **15s timeout on native registration**: Prevents app init hang if Push Notifications plugin fails silently.
3. **Listener guard**: `deepLinksInitialized` flag prevents duplicate listeners on re-auth.
4. **Web foreground messages**: Logged only, not auto-navigated (TODO: in-app banner).
5. **storeToken merge**: Added `{ merge: true }` to preserve server-set `lastUsed`.
6. **Android payload**: Removed Flutter clickAction.
7. **VAPID key**: Reads from `VITE_FIREBASE_VAPID_KEY` env var.
8. **APP_ID import**: Server sender imports from shared constants.
9. **useNotifications hook**: Wired to call `initializeNotifications(userId)` on auth.

### Tests

| File | Tests | Notes |
|------|-------|-------|
| `src/services/notifications/__tests__/tokenManager.test.js` | 5 | Hash-based ID derivation, platform detection |
| `src/services/notifications/__tests__/deepLinks.test.js` | 9 | Deep link parsing, graceful error handling |
| `functions/src/notifications/__tests__/sender.test.js` | 4 | Delivery delay (not picked up by root vitest) |
| `functions/src/notifications/__tests__/templates.test.js` | 6 | Template generation (not picked up by root vitest) |

Existing tests: 136 passing (122 existing + 14 new)