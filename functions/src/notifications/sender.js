/**
 * Notification Sender (Server-Side)
 *
 * Dispatches FCM notifications to user devices.
 * Handles platform-specific payloads, token cleanup, and delivery windows.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { APP_COLLECTION_ID as APP_ID } from '../shared/constants.js';

/**
 * Send a notification to all of a user's registered devices.
 * @param {string} userId - Target user ID
 * @param {Object} notification - { title: string, body: string }
 * @param {Object} data - Deep link data payload
 * @param {Object} options - { respectDeliveryWindow?: boolean }
 * @returns {Promise<{ sent: number, failed: number, delayed?: number }>}
 */
export async function sendNotification(userId, notification, data = {}, options = {}) {
  const db = getFirestore();
  const messaging = getMessaging();

  // Check delivery window if requested
  if (options.respectDeliveryWindow) {
    const settingsRef = db.doc(
      `artifacts/${APP_ID}/users/${userId}/settings/notifications`
    );
    const settingsSnap = await settingsRef.get();

    if (settingsSnap.exists) {
      const settings = settingsSnap.data();
      if (settings.timezone && settings.deliveryWindowStart != null && settings.deliveryWindowEnd != null) {
        const delay = calculateDeliveryDelay(
          settings.timezone,
          settings.deliveryWindowStart,
          settings.deliveryWindowEnd
        );
        if (delay > 0) {
          return { sent: 0, failed: 0, delayed: delay };
        }
      }
    }
  }

  // Get all FCM tokens for the user
  const tokensRef = db.collection(
    `artifacts/${APP_ID}/users/${userId}/fcm_tokens`
  );
  const tokensSnap = await tokensRef.get();

  if (tokensSnap.empty) {
    console.log(`[sender] No tokens found for user ${userId}`);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Stringify data values (FCM data must be string-valued)
  const stringData = {};
  for (const [key, value] of Object.entries(data)) {
    stringData[key] = String(value);
  }

  for (const tokenDoc of tokensSnap.docs) {
    const { token, platform } = tokenDoc.data();

    const message = buildMessage(token, platform, notification, stringData);

    try {
      await messaging.send(message);
      // Update lastUsed timestamp
      await tokenDoc.ref.update({ lastUsed: FieldValue.serverTimestamp() });
      sent++;
    } catch (err) {
      const errorCode = err.code || '';
      if (
        errorCode === 'messaging/invalid-registration-token' ||
        errorCode === 'messaging/registration-token-not-registered'
      ) {
        console.log(`[sender] Removing invalid token ${tokenDoc.id}`);
        await tokenDoc.ref.delete();
      } else {
        console.error(`[sender] Send failed for token ${tokenDoc.id}:`, err.message);
      }
      failed++;
    }
  }

  console.log(`[sender] Sent ${sent}, failed ${failed} for user ${userId}`);
  return { sent, failed };
}

/**
 * Build a platform-appropriate FCM message.
 * @param {string} token - Device token
 * @param {string} platform - 'ios', 'android', or 'web'
 * @param {Object} notification - { title, body }
 * @param {Object} data - String-valued data payload
 * @returns {Object} FCM message object
 */
function buildMessage(token, platform, notification, data) {
  const message = {
    token,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data,
  };

  if (platform === 'ios') {
    message.apns = {
      payload: {
        aps: {
          alert: {
            title: notification.title,
            body: notification.body,
          },
          sound: 'default',
          badge: 1,
        },
      },
    };
  } else if (platform === 'android') {
    message.android = {
      notification: {
        title: notification.title,
        body: notification.body,
        sound: 'default',
      },
    };
  }

  return message;
}

/**
 * Calculate delay in seconds until the user's delivery window opens.
 * Returns 0 if currently within the window.
 * @param {string} timezone - IANA timezone string
 * @param {number} windowStart - Hour (0-23) for earliest delivery
 * @param {number} windowEnd - Hour (0-23) for latest delivery
 * @returns {number} Delay in seconds (0 if within window)
 */
export function calculateDeliveryDelay(timezone, windowStart, windowEnd) {
  const now = new Date();
  const userTimeStr = now.toLocaleString('en-US', { timeZone: timezone, hour12: false });
  const userDate = new Date(userTimeStr);
  const currentHour = userDate.getHours();
  const currentMinute = userDate.getMinutes();
  const currentSeconds = currentHour * 3600 + currentMinute * 60 + userDate.getSeconds();

  const windowStartSeconds = windowStart * 3600;
  const windowEndSeconds = windowEnd * 3600;

  // Handle normal window (e.g., 8-21)
  if (windowStart < windowEnd) {
    if (currentSeconds >= windowStartSeconds && currentSeconds < windowEndSeconds) {
      return 0; // Within window
    }
    if (currentSeconds < windowStartSeconds) {
      return windowStartSeconds - currentSeconds;
    }
    // After window end - delay to next day's start
    return (24 * 3600 - currentSeconds) + windowStartSeconds;
  }

  // Handle overnight window (e.g., 21-8) - unusual but handle it
  if (currentSeconds >= windowStartSeconds || currentSeconds < windowEndSeconds) {
    return 0;
  }
  return windowStartSeconds - currentSeconds;
}
