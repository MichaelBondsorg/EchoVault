/**
 * Mock for @capacitor-firebase/crashlytics
 *
 * Provides mock implementations for testing.
 */

export const FirebaseCrashlytics = {
  crash: async () => {},
  setEnabled: async () => {},
  isEnabled: async () => ({ enabled: false }),
  setUserId: async () => {},
  setCustomKey: async () => {},
  log: async () => {},
  recordException: async () => {},
  sendUnsentReports: async () => {},
  deleteUnsentReports: async () => {},
  didCrashOnPreviousExecution: async () => ({ crashed: false }),
};

export default {
  FirebaseCrashlytics,
};
