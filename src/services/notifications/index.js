/**
 * Notifications Service
 *
 * Public API for push notification management.
 * Handles token collection, deep link routing, and timezone detection.
 */

export { registerToken, handleTokenRefresh, updateTimezone, deriveTokenId, detectPlatform } from './tokenManager';
export { initializeDeepLinks, handleDeepLink, parseDeepLink } from './deepLinks';

/**
 * Initialize the full notification system.
 * Call after user authentication succeeds.
 *
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<{granted: boolean, token?: string}>}
 */
export async function initializeNotifications(userId) {
  const { registerToken } = await import('./tokenManager');
  const { initializeDeepLinks } = await import('./deepLinks');
  const { updateTimezone } = await import('./tokenManager');

  // Register token (requests permissions if needed)
  const result = await registerToken(userId);

  if (result.granted) {
    // Set up deep link listeners
    await initializeDeepLinks();

    // Detect and store timezone
    await updateTimezone(userId);
  }

  return result;
}
