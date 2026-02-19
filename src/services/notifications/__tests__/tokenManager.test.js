/**
 * Token Manager Tests
 *
 * Tests FCM token registration, refresh, and platform detection.
 * Pure function tests only - Firebase interactions are mocked at module level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveTokenId, detectPlatform } from '../tokenManager';

describe('tokenManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deriveTokenId', () => {
    it('returns a hash-based string ID', () => {
      const token = 'abcdefghijklmnopqrstuvwxyz1234567890';
      const id = deriveTokenId(token);
      // Should be hex-based and consistent length
      expect(id).toMatch(/^[0-9a-f]+$/);
      expect(id.length).toBeGreaterThan(8);
    });

    it('produces same ID for same token (idempotent)', () => {
      const token = 'fcm_token_abc123_xyz789_long_string_here';
      expect(deriveTokenId(token)).toBe(deriveTokenId(token));
    });

    it('produces different IDs for different tokens', () => {
      const token1 = 'aaaaaaaaaabbbbbbbbbbccccc';
      const token2 = 'xxxxxxxxxxxxxyyyyyyyyzzzzz';
      expect(deriveTokenId(token1)).not.toBe(deriveTokenId(token2));
    });

    it('avoids collision for tokens with same prefix', () => {
      const prefix = 'dKjR8xY_mZ4wN5pL3qH2';
      const token1 = prefix + 'AAAABBBBCCCCDDDDdifference1';
      const token2 = prefix + 'AAAABBBBCCCCDDDDdifference2';
      expect(deriveTokenId(token1)).not.toBe(deriveTokenId(token2));
    });
  });

  describe('detectPlatform', () => {
    it('returns web in test environment', () => {
      // The Capacitor mock always returns 'web'
      expect(detectPlatform()).toBe('web');
    });
  });
});
