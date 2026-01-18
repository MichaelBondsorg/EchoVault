/**
 * Crash Reporting Service Tests
 *
 * Tests for the Crashlytics wrapper service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crashReporting } from '../crashReporting';

// The Capacitor and Crashlytics modules are mocked via vitest.config.js aliases

describe('Crash Reporting Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should return false on web platform (Capacitor.isNativePlatform returns false)', async () => {
      // Since our mock returns isNativePlatform: false, initialize should return false
      const result = await crashReporting.initialize();
      expect(result).toBe(false);
    });
  });

  describe('recordError - when not initialized', () => {
    it('should log warning when crashlytics not initialized', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = new Error('Test error');

      await crashReporting.recordError(error, 'TestComponent');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('log - when not initialized', () => {
    it('should not throw when crashlytics not initialized', async () => {
      await expect(crashReporting.log('Test message')).resolves.not.toThrow();
    });
  });

  describe('setUserId - when not initialized', () => {
    it('should not throw when crashlytics not initialized', async () => {
      await expect(crashReporting.setUserId('user-123')).resolves.not.toThrow();
    });
  });

  describe('setCustomKey - when not initialized', () => {
    it('should not throw when crashlytics not initialized', async () => {
      await expect(crashReporting.setCustomKey('key', 'value')).resolves.not.toThrow();
    });
  });

  describe('setEnabled - when not initialized', () => {
    it('should not throw when crashlytics not initialized', async () => {
      await expect(crashReporting.setEnabled(true)).resolves.not.toThrow();
    });
  });

  describe('isEnabled - when not initialized', () => {
    it('should return false when crashlytics not initialized', async () => {
      const result = await crashReporting.isEnabled();
      expect(result).toBe(false);
    });
  });

  describe('sendUnsentReports - when not initialized', () => {
    it('should not throw when crashlytics not initialized', async () => {
      await expect(crashReporting.sendUnsentReports()).resolves.not.toThrow();
    });
  });

  describe('didCrashOnPreviousExecution - when not initialized', () => {
    it('should return false when crashlytics not initialized', async () => {
      const result = await crashReporting.didCrashOnPreviousExecution();
      expect(result).toBe(false);
    });
  });
});
