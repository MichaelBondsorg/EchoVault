/**
 * Crash Reporting Service
 *
 * Wrapper for Firebase Crashlytics providing crash reporting,
 * error logging, and custom event tracking for EchoVault.
 *
 * Usage:
 *   import { crashReporting } from './services/crashReporting';
 *
 *   // Log an error
 *   crashReporting.recordError(error, 'ComponentName');
 *
 *   // Log a custom event
 *   crashReporting.log('User completed onboarding');
 *
 *   // Set user context
 *   crashReporting.setUserId(userId);
 */

import { Capacitor } from '@capacitor/core';

// Crashlytics instance - lazy loaded on native platforms only
let crashlyticsInstance = null;

/**
 * Initialize Crashlytics (call once at app startup)
 */
async function initialize() {
  if (!Capacitor.isNativePlatform()) {
    console.log('[CrashReporting] Skipping initialization on web platform');
    return false;
  }

  try {
    const { FirebaseCrashlytics } = await import('@capacitor-firebase/crashlytics');
    crashlyticsInstance = FirebaseCrashlytics;

    // Enable crash reporting by default
    await crashlyticsInstance.setEnabled({ enabled: true });

    console.log('[CrashReporting] Crashlytics initialized successfully');
    return true;
  } catch (error) {
    console.error('[CrashReporting] Failed to initialize Crashlytics:', error);
    return false;
  }
}

/**
 * Record a non-fatal error
 * @param {Error} error - The error to record
 * @param {string} context - Optional context about where the error occurred
 */
async function recordError(error, context = '') {
  if (!crashlyticsInstance) {
    console.warn('[CrashReporting] Crashlytics not initialized, logging to console:', error);
    return;
  }

  try {
    // Set custom key for context
    if (context) {
      await crashlyticsInstance.setCustomKey({
        key: 'error_context',
        value: context,
        type: 'string'
      });
    }

    // Record the exception
    await crashlyticsInstance.recordException({
      message: error.message || String(error),
      stacktrace: error.stack || ''
    });

    console.log('[CrashReporting] Error recorded:', context || error.message);
  } catch (err) {
    console.error('[CrashReporting] Failed to record error:', err);
  }
}

/**
 * Log a message (appears in crash reports)
 * @param {string} message - The message to log
 */
async function log(message) {
  if (!crashlyticsInstance) {
    return;
  }

  try {
    await crashlyticsInstance.log({ message });
  } catch (error) {
    console.error('[CrashReporting] Failed to log message:', error);
  }
}

/**
 * Set the user ID for crash reports
 * @param {string} userId - The user's ID
 */
async function setUserId(userId) {
  if (!crashlyticsInstance) {
    return;
  }

  try {
    await crashlyticsInstance.setUserId({ userId });
    console.log('[CrashReporting] User ID set');
  } catch (error) {
    console.error('[CrashReporting] Failed to set user ID:', error);
  }
}

/**
 * Set a custom key-value pair
 * @param {string} key - The key
 * @param {string|number|boolean} value - The value
 */
async function setCustomKey(key, value) {
  if (!crashlyticsInstance) {
    return;
  }

  try {
    const type = typeof value === 'boolean' ? 'boolean'
               : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float')
               : 'string';

    await crashlyticsInstance.setCustomKey({ key, value, type });
  } catch (error) {
    console.error('[CrashReporting] Failed to set custom key:', error);
  }
}

/**
 * Enable or disable crash reporting
 * @param {boolean} enabled - Whether to enable crash reporting
 */
async function setEnabled(enabled) {
  if (!crashlyticsInstance) {
    return;
  }

  try {
    await crashlyticsInstance.setEnabled({ enabled });
    console.log(`[CrashReporting] Crash reporting ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('[CrashReporting] Failed to set enabled state:', error);
  }
}

/**
 * Check if crash reporting is enabled
 * @returns {Promise<boolean>}
 */
async function isEnabled() {
  if (!crashlyticsInstance) {
    return false;
  }

  try {
    const { enabled } = await crashlyticsInstance.isEnabled();
    return enabled;
  } catch (error) {
    console.error('[CrashReporting] Failed to check enabled state:', error);
    return false;
  }
}

/**
 * Send any unsent crash reports
 */
async function sendUnsentReports() {
  if (!crashlyticsInstance) {
    return;
  }

  try {
    await crashlyticsInstance.sendUnsentReports();
    console.log('[CrashReporting] Unsent reports sent');
  } catch (error) {
    console.error('[CrashReporting] Failed to send unsent reports:', error);
  }
}

/**
 * Force a test crash (development only)
 * WARNING: This will crash the app!
 */
async function crash() {
  if (!crashlyticsInstance) {
    throw new Error('Test crash - Crashlytics not available');
  }

  if (import.meta.env.DEV) {
    console.warn('[CrashReporting] Forcing test crash...');
    await crashlyticsInstance.crash();
  } else {
    console.warn('[CrashReporting] Test crash disabled in production');
  }
}

/**
 * Check if crash collection is enabled
 * @returns {Promise<boolean>}
 */
async function didCrashOnPreviousExecution() {
  if (!crashlyticsInstance) {
    return false;
  }

  try {
    const { crashed } = await crashlyticsInstance.didCrashOnPreviousExecution();
    return crashed;
  } catch (error) {
    return false;
  }
}

// Export as named object for cleaner imports
export const crashReporting = {
  initialize,
  recordError,
  log,
  setUserId,
  setCustomKey,
  setEnabled,
  isEnabled,
  sendUnsentReports,
  crash,
  didCrashOnPreviousExecution
};

// Also export individual functions for tree-shaking
export {
  initialize,
  recordError,
  log,
  setUserId,
  setCustomKey,
  setEnabled,
  isEnabled,
  sendUnsentReports,
  crash,
  didCrashOnPreviousExecution
};
