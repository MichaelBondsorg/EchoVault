/**
 * Deep Links Handler
 *
 * Handles notification tap events and translates deep link data
 * into in-app navigation via Zustand uiStore.
 */

import { Capacitor } from '@capacitor/core';

let deepLinksInitialized = false;

/**
 * Known deep link types and their target views.
 */
const DEEP_LINK_ROUTES = {
  report: { view: 'report-detail', paramKey: 'reportId' },
  insight: { view: 'insights', paramKey: 'insightId' },
  prompt: { view: 'journal', paramKey: 'promptId' },
};

/**
 * Parse notification data and return navigation target.
 * @param {Object} data - Notification data payload
 * @returns {{ view: string, params: Object } | null}
 */
export function parseDeepLink(data) {
  if (!data || !data.type) {
    return null;
  }

  const route = DEEP_LINK_ROUTES[data.type];
  if (!route) {
    console.warn(`[deepLinks] Unknown notification type: ${data.type}`);
    return null;
  }

  const params = {};
  if (route.paramKey && data[route.paramKey]) {
    params[route.paramKey] = data[route.paramKey];
  }

  return { view: route.view, params };
}

/**
 * Navigate to the appropriate view based on notification data.
 * Uses dynamic import to avoid circular dependency with stores.
 * @param {Object} data - Notification data payload
 */
export async function handleDeepLink(data) {
  const target = parseDeepLink(data);

  if (!target) {
    console.warn('[deepLinks] No valid deep link target, ignoring');
    return;
  }

  try {
    const { useUiStore } = await import('../../stores/uiStore');
    useUiStore.getState().setView(target.view);
    console.log(`[deepLinks] Navigated to ${target.view}`, target.params);
  } catch (e) {
    console.error('[deepLinks] Navigation failed:', e);
  }
}

/**
 * Initialize deep link listeners for notification taps.
 * Call once on app init after authentication.
 */
export async function initializeDeepLinks() {
  if (deepLinksInitialized) {
    console.log('[deepLinks] Already initialized, skipping');
    return;
  }
  deepLinksInitialized = true;

  const platform = Capacitor.getPlatform();

  if (platform !== 'web') {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      const data = notification.notification?.data;
      if (data) {
        handleDeepLink(data);
      }
    });

    console.log('[deepLinks] Native deep link listeners initialized');
  } else {
    // Web: foreground messages are logged but NOT auto-navigated.
    // A future in-app notification banner should show these to the user.
    const { messaging, onMessage: onMessageFn } = await import('../../config/firebase');
    if (messaging) {
      onMessageFn(messaging, (payload) => {
        console.log('[deepLinks] Foreground web message received:', payload.data);
        // TODO: Show in-app notification banner instead of auto-navigating.
        // Auto-navigation would disrupt the user's current activity.
      });
      console.log('[deepLinks] Web message listener initialized');
    }
  }
}
