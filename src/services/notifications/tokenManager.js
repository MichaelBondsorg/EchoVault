/**
 * FCM Token Manager
 *
 * Handles FCM token registration, refresh, and platform detection.
 * Web: Firebase Messaging SDK
 * iOS/Android: @capacitor/push-notifications
 */

import { Capacitor } from '@capacitor/core';

/**
 * Derive a stable token ID from the full token string for idempotent writes.
 * Uses a simple hash to avoid prefix collisions common in FCM tokens.
 * @param {string} token - FCM registration token
 * @returns {string} Token document ID (hash-based, 16 chars)
 */
export function deriveTokenId(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to unsigned hex string, pad to ensure consistent length
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, '0') + token.length.toString(16).padStart(4, '0');
}

/**
 * Detect the current platform.
 * @returns {'ios' | 'android' | 'web'}
 */
export function detectPlatform() {
  return Capacitor.getPlatform();
}

/**
 * Request notification permissions and register the FCM token.
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<{granted: boolean, token?: string}>}
 */
export async function registerToken(userId) {
  const platform = detectPlatform();

  if (platform === 'web') {
    return registerWebToken(userId);
  }
  return registerNativeToken(userId);
}

/**
 * Register FCM token on web via Firebase Messaging SDK.
 * @param {string} userId
 * @returns {Promise<{granted: boolean, token?: string}>}
 */
async function registerWebToken(userId) {
  if (!('Notification' in window)) {
    return { granted: false };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { granted: false };
  }

  const { messaging, getToken: getTokenFn } = await import('../../config/firebase');
  if (!messaging) {
    console.warn('[tokenManager] Firebase messaging not available');
    return { granted: false };
  }

  try {
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const tokenOptions = vapidKey ? { vapidKey } : undefined;
    const token = await getTokenFn(messaging, tokenOptions);
    await storeToken(userId, token, 'web');
    return { granted: true, token };
  } catch (e) {
    console.error('[tokenManager] Failed to get web token:', e);
    return { granted: false };
  }
}

/**
 * Register FCM token on native via Capacitor Push Notifications plugin.
 * @param {string} userId
 * @returns {Promise<{granted: boolean, token?: string}>}
 */
async function registerNativeToken(userId) {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const platform = detectPlatform();

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') {
    return { granted: false };
  }

  const REGISTRATION_TIMEOUT_MS = 15000;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn('[tokenManager] Native registration timed out');
      resolve({ granted: false });
    }, REGISTRATION_TIMEOUT_MS);

    PushNotifications.addListener('registration', async (registrationToken) => {
      clearTimeout(timeout);
      const token = registrationToken.value;
      await storeToken(userId, token, platform);
      resolve({ granted: true, token });
    });

    PushNotifications.addListener('registrationError', (err) => {
      clearTimeout(timeout);
      console.error('[tokenManager] Native registration failed:', err);
      resolve({ granted: false });
    });

    PushNotifications.register();
  });
}

/**
 * Store FCM token in Firestore.
 * @param {string} userId
 * @param {string} token
 * @param {string} platform
 */
async function storeToken(userId, token, platform) {
  const { db, doc, setDoc, Timestamp } = await import('../../config/firebase');
  const { APP_COLLECTION_ID } = await import('../../config/constants');

  const tokenId = deriveTokenId(token);
  const tokenRef = doc(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    userId,
    'fcm_tokens',
    tokenId
  );

  await setDoc(tokenRef, {
    token,
    platform,
    createdAt: Timestamp.now()
  }, { merge: true });

  console.log(`[tokenManager] Stored ${platform} token for user ${userId}`);
}

/**
 * Handle FCM token refresh by replacing the stored token.
 * @param {string} userId
 * @param {string} oldToken - Previous token to remove
 * @param {string} newToken - New token to store
 */
export async function handleTokenRefresh(userId, oldToken, newToken) {
  const { db, doc, deleteDoc, Timestamp } = await import('../../config/firebase');
  const { APP_COLLECTION_ID } = await import('../../config/constants');

  const platform = detectPlatform();
  const oldTokenId = deriveTokenId(oldToken);
  const oldRef = doc(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    userId,
    'fcm_tokens',
    oldTokenId
  );

  try {
    await deleteDoc(oldRef);
  } catch (e) {
    console.warn('[tokenManager] Failed to delete old token:', e);
  }

  await storeToken(userId, newToken, platform);
}

/**
 * Detect and store the user's IANA timezone in notification settings.
 * @param {string} userId
 */
export async function updateTimezone(userId) {
  const { db, doc, setDoc, Timestamp } = await import('../../config/firebase');
  const { APP_COLLECTION_ID } = await import('../../config/constants');

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const settingsRef = doc(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    userId,
    'settings',
    'notifications'
  );

  await setDoc(settingsRef, {
    timezone,
    updatedAt: Timestamp.now()
  }, { merge: true });

  console.log(`[tokenManager] Stored timezone: ${timezone}`);
}
