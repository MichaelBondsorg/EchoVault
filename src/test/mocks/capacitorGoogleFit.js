/**
 * Mock for capacitor-google-fit
 *
 * Stub implementation for web development/testing.
 * The real plugin only works on Android.
 */

export const GoogleFit = {
  requestAuthorization: async () => ({ authorized: false, error: 'Not available in web' }),
  getSteps: async () => ({ steps: 0 }),
  getCalories: async () => ({ calories: 0 }),
  getDistance: async () => ({ distance: 0 }),
  getWeight: async () => ({ weight: null }),
  getHeight: async () => ({ height: null }),
  getSleepAnalysis: async () => ({ sleep: [] }),
  getHeartRate: async () => ({ heartRate: [] }),
};

export default {
  GoogleFit,
};
