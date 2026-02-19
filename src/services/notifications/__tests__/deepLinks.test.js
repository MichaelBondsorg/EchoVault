/**
 * Deep Links Tests
 *
 * Tests notification data parsing and navigation target resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDeepLink } from '../deepLinks';

describe('deepLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseDeepLink', () => {
    it('parses report deep link data correctly', () => {
      const data = { type: 'report', reportId: 'monthly-2026-01' };
      const result = parseDeepLink(data);

      expect(result).toEqual({
        view: 'report-detail',
        params: { reportId: 'monthly-2026-01' },
      });
    });

    it('parses insight deep link data correctly', () => {
      const data = { type: 'insight', insightId: 'ins-123' };
      const result = parseDeepLink(data);

      expect(result).toEqual({
        view: 'insights',
        params: { insightId: 'ins-123' },
      });
    });

    it('parses prompt deep link data correctly', () => {
      const data = { type: 'prompt', promptId: 'prompt-456' };
      const result = parseDeepLink(data);

      expect(result).toEqual({
        view: 'journal',
        params: { promptId: 'prompt-456' },
      });
    });

    it('handles unknown notification type gracefully', () => {
      const data = { type: 'unknown_type' };
      const result = parseDeepLink(data);
      expect(result).toBeNull();
    });

    it('handles null data gracefully', () => {
      expect(parseDeepLink(null)).toBeNull();
    });

    it('handles undefined data gracefully', () => {
      expect(parseDeepLink(undefined)).toBeNull();
    });

    it('handles data with missing type field', () => {
      const data = { reportId: 'monthly-2026-01' };
      expect(parseDeepLink(data)).toBeNull();
    });

    it('handles data with type but no resource ID', () => {
      const data = { type: 'report' };
      const result = parseDeepLink(data);
      expect(result).toEqual({
        view: 'report-detail',
        params: {},
      });
    });

    it('handles empty data object', () => {
      expect(parseDeepLink({})).toBeNull();
    });
  });
});
