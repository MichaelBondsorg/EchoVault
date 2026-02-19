/**
 * Notification Sender Tests
 *
 * Tests delivery window calculation (pure function).
 * Full send tests require firebase-admin mocking and are not
 * covered by the root vitest config (functions/ directory).
 */

import { describe, it, expect } from 'vitest';
import { calculateDeliveryDelay } from '../sender.js';

describe('calculateDeliveryDelay', () => {
  it('returns 0 when current time is within the delivery window', () => {
    // Use a timezone where we can predict the hour
    // We test the logic by constructing known scenarios
    const timezone = 'UTC';

    // Get current UTC hour
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Set window to include current hour
    const windowStart = (currentHour - 1 + 24) % 24;
    const windowEnd = (currentHour + 2) % 24;

    // Only test if this creates a normal (non-overnight) window
    if (windowStart < windowEnd) {
      const delay = calculateDeliveryDelay(timezone, windowStart, windowEnd);
      expect(delay).toBe(0);
    }
  });

  it('returns positive delay when before the delivery window', () => {
    const timezone = 'UTC';
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Set window to start 3 hours from now
    const windowStart = (currentHour + 3) % 24;
    const windowEnd = (currentHour + 6) % 24;

    // Only test normal window case
    if (windowStart < windowEnd && currentHour < windowStart) {
      const delay = calculateDeliveryDelay(timezone, windowStart, windowEnd);
      expect(delay).toBeGreaterThan(0);
      // Should be roughly 3 hours (10800 seconds) give or take minutes
      expect(delay).toBeLessThanOrEqual(3 * 3600);
      expect(delay).toBeGreaterThan(2 * 3600);
    }
  });

  it('returns positive delay when after the delivery window (next day)', () => {
    const timezone = 'UTC';
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Set window to have ended 2 hours ago
    const windowEnd = (currentHour - 2 + 24) % 24;
    const windowStart = (currentHour - 5 + 24) % 24;

    // Only test normal window case
    if (windowStart < windowEnd && currentHour >= windowEnd) {
      const delay = calculateDeliveryDelay(timezone, windowStart, windowEnd);
      expect(delay).toBeGreaterThan(0);
      // Should be roughly until tomorrow's window start
      expect(delay).toBeLessThanOrEqual(24 * 3600);
    }
  });

  it('handles standard 8-21 delivery window', () => {
    // This tests the specific default window
    const delay = calculateDeliveryDelay('UTC', 8, 21);
    // Should return 0 or a positive delay depending on current UTC time
    expect(typeof delay).toBe('number');
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});
