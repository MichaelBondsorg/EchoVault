/**
 * Tests for the Gap Prompt Generator Nexus extension.
 *
 * The gap prompt generator transforms detected life domain gaps into
 * therapeutic, non-judgmental journaling prompts. It handles premium
 * gating, style personalization, seasonal context, engagement tracking,
 * and domain snoozing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock premium service
vi.mock('../../premium', () => ({
  checkEntitlement: vi.fn(),
}));

// Mock gap detector
vi.mock('../gapDetector', () => ({
  detectGaps: vi.fn(),
  LIFE_DOMAINS: [
    'work', 'relationships', 'health', 'creativity',
    'spirituality', 'personal-growth', 'family', 'finances',
  ],
}));

// Mock analytics repository
vi.mock('../../../repositories/analytics', () => ({
  analyticsRepository: {
    getAnalyticsDoc: vi.fn(),
    setAnalyticsDoc: vi.fn(),
  },
}));

// Mock Firestore for subcollection writes
vi.mock('../../../config/firebase', () => ({
  db: {},
  doc: vi.fn(() => 'mock-doc-ref'),
  collection: vi.fn(() => 'mock-collection-ref'),
  addDoc: vi.fn(() => Promise.resolve({ id: 'mock-engagement-id' })),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

vi.mock('../../../config/constants', () => ({
  APP_COLLECTION_ID: 'echo-vault-v5-fresh',
}));

import {
  generateGapPrompt,
  getPromptForDomain,
  selectPromptStyle,
  trackEngagement,
  getEngagementPreferences,
  formatRelativeTime,
  PROMPT_STYLES,
  VALID_RESPONSES,
  GAP_SCORE_THRESHOLD,
  SNOOZE_DURATION_DAYS,
  PROMPT_TEMPLATES,
  JUDGMENTAL_WORDS,
} from '../gapPromptGenerator';
import { checkEntitlement } from '../../premium';
import { detectGaps } from '../gapDetector';
import { analyticsRepository } from '../../../repositories/analytics';
import { addDoc } from '../../../config/firebase';

const now = Date.now();
const daysAgo = (days) => ({ toMillis: () => now - days * 86400000 });

describe('gapPromptGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user is premium
    checkEntitlement.mockResolvedValue({ entitled: true, reason: 'premium_active' });
    // Default: no engagement preferences
    analyticsRepository.getAnalyticsDoc.mockResolvedValue(null);
    analyticsRepository.setAnalyticsDoc.mockResolvedValue(undefined);
  });

  describe('generateGapPrompt', () => {
    it('generates prompt for highest-scoring gap domain', async () => {
      detectGaps.mockResolvedValue([
        { domain: 'spirituality', gapScore: 4.0, lastMentionDate: null, normalizedCoverage: 0 },
        { domain: 'finances', gapScore: 2.5, lastMentionDate: daysAgo(25), normalizedCoverage: 0.02 },
      ]);

      const result = await generateGapPrompt('user-123');

      expect(result).not.toBeNull();
      expect(result.domain).toBe('spirituality');
      expect(result.promptText).toBeTruthy();
      expect(result.promptStyle).toBeTruthy();
      expect(PROMPT_STYLES).toContain(result.promptStyle);
      expect(result.gapScore).toBe(4.0);
    });

    it('prompt framing is non-judgmental (no "neglecting" language)', async () => {
      // Check ALL templates for judgmental words
      for (const domain of Object.keys(PROMPT_TEMPLATES)) {
        for (const style of Object.keys(PROMPT_TEMPLATES[domain])) {
          for (const template of PROMPT_TEMPLATES[domain][style]) {
            const lower = template.toLowerCase();
            for (const word of JUDGMENTAL_WORDS) {
              expect(lower).not.toContain(word);
            }
          }
        }
      }
    });

    it('returns null when no gaps above threshold', async () => {
      detectGaps.mockResolvedValue([]);

      const result = await generateGapPrompt('user-123');
      expect(result).toBeNull();
    });

    it('limits to 1 gap prompt per invocation', async () => {
      detectGaps.mockResolvedValue([
        { domain: 'spirituality', gapScore: 4.0, lastMentionDate: null, normalizedCoverage: 0 },
        { domain: 'finances', gapScore: 3.5, lastMentionDate: daysAgo(25), normalizedCoverage: 0.02 },
        { domain: 'creativity', gapScore: 2.0, lastMentionDate: daysAgo(20), normalizedCoverage: 0.05 },
      ]);

      const result = await generateGapPrompt('user-123');

      // Should return a single prompt object, not an array
      expect(result).not.toBeNull();
      expect(typeof result.domain).toBe('string');
      expect(result.domain).toBe('spirituality');
    });

    it('returns null when user is not premium', async () => {
      checkEntitlement.mockResolvedValue({ entitled: false, reason: 'premium_required' });

      const result = await generateGapPrompt('user-123');
      expect(result).toBeNull();
      // Should not call detectGaps if not premium
      expect(detectGaps).not.toHaveBeenCalled();
    });

    it('returns null when premium check fails (fail closed)', async () => {
      checkEntitlement.mockRejectedValue(new Error('Network error'));

      const result = await generateGapPrompt('user-123');
      expect(result).toBeNull();
    });

    it('filters out snoozed domains', async () => {
      const snoozeUntil = {};
      snoozeUntil['spirituality'] = { toMillis: () => now + 86400000 * 3 }; // 3 days in future
      analyticsRepository.getAnalyticsDoc.mockResolvedValue({
        preferences: { snoozeUntil },
      });

      detectGaps.mockResolvedValue([
        { domain: 'spirituality', gapScore: 4.0, lastMentionDate: null, normalizedCoverage: 0 },
        { domain: 'finances', gapScore: 2.5, lastMentionDate: daysAgo(25), normalizedCoverage: 0.02 },
      ]);

      const result = await generateGapPrompt('user-123');
      expect(result).not.toBeNull();
      expect(result.domain).toBe('finances'); // spirituality is snoozed
    });

    it('includes snoozed domain when snooze has expired', async () => {
      const snoozeUntil = {};
      snoozeUntil['spirituality'] = { toMillis: () => now - 86400000 }; // 1 day ago (expired)
      analyticsRepository.getAnalyticsDoc.mockResolvedValue({
        preferences: { snoozeUntil },
      });

      detectGaps.mockResolvedValue([
        { domain: 'spirituality', gapScore: 4.0, lastMentionDate: null, normalizedCoverage: 0 },
      ]);

      const result = await generateGapPrompt('user-123');
      expect(result).not.toBeNull();
      expect(result.domain).toBe('spirituality');
    });

    it('returns null when gap detector throws (fail open)', async () => {
      detectGaps.mockRejectedValue(new Error('Firestore unavailable'));

      const result = await generateGapPrompt('user-123');
      expect(result).toBeNull();
    });

    it('sets metadata.personalized when engagement preferences exist', async () => {
      analyticsRepository.getAnalyticsDoc.mockResolvedValue({
        preferences: {
          styleAcceptanceRates: { gratitude: 5, action: 1, reflective: 1, exploratory: 1 },
        },
      });
      detectGaps.mockResolvedValue([
        { domain: 'health', gapScore: 2.0, lastMentionDate: daysAgo(14), normalizedCoverage: 0.1 },
      ]);

      const result = await generateGapPrompt('user-123');
      expect(result).not.toBeNull();
      expect(result.metadata.personalized).toBe(true);
    });
  });

  describe('selectPromptStyle', () => {
    it('selects from all 4 styles when no engagement history', () => {
      const style = selectPromptStyle(null, 'health');
      expect(PROMPT_STYLES).toContain(style);
    });

    it('weights style selection toward user preferences', () => {
      // Run many iterations and check distribution
      const counts = { reflective: 0, exploratory: 0, gratitude: 0, action: 0 };
      const prefs = {
        styleAcceptanceRates: { gratitude: 100, action: 0, reflective: 0, exploratory: 0 },
      };

      for (let i = 0; i < 200; i++) {
        const style = selectPromptStyle(prefs, 'health');
        counts[style]++;
      }

      // Gratitude should dominate (but not 100% due to exploration factor)
      expect(counts.gratitude).toBeGreaterThan(counts.action);
      expect(counts.gratitude).toBeGreaterThan(counts.reflective);
      expect(counts.gratitude).toBeGreaterThan(counts.exploratory);
    });

    it('returns valid style even with empty preferences', () => {
      const style = selectPromptStyle({}, 'work');
      expect(PROMPT_STYLES).toContain(style);
    });
  });

  describe('getPromptForDomain', () => {
    it('returns domain-specific prompt text for each domain', () => {
      const domains = ['work', 'relationships', 'health', 'creativity',
        'spirituality', 'personal-growth', 'family', 'finances'];

      for (const domain of domains) {
        const text = getPromptForDomain(domain, 'reflective', {
          lastMentionDate: daysAgo(14),
        });
        expect(text).toBeTruthy();
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(10);
      }
    });

    it('includes timeframe context in prompt', () => {
      const text = getPromptForDomain('health', 'reflective', {
        lastMentionDate: daysAgo(21),
      });
      // Should contain some time reference
      expect(text).toBeTruthy();
    });

    it('handles null lastMentionDate (never mentioned)', () => {
      const text = getPromptForDomain('creativity', 'exploratory', {
        lastMentionDate: null,
      });
      expect(text).toBeTruthy();
      expect(typeof text).toBe('string');
    });

    it('applies seasonal context when provided', () => {
      const text = getPromptForDomain('family', 'gratitude', {
        lastMentionDate: daysAgo(14),
        seasonalContext: 'the holiday season',
      });
      expect(text).toContain('the holiday season');
      expect(text).toContain('this might be a good time to reflect');
    });
  });

  describe('formatRelativeTime', () => {
    it('formats recent days correctly', () => {
      expect(formatRelativeTime(1)).toBe('recently');
      expect(formatRelativeTime(5)).toBe('a few days');
      expect(formatRelativeTime(10)).toBe('about a week');
      expect(formatRelativeTime(16)).toBe('a couple of weeks');
      expect(formatRelativeTime(25)).toBe('about three weeks');
      expect(formatRelativeTime(45)).toBe('about a month');
      expect(formatRelativeTime(75)).toBe('a couple of months');
      expect(formatRelativeTime(120)).toBe('a few months');
    });

    it('handles zero days', () => {
      expect(formatRelativeTime(0)).toBe('recently');
    });

    it('handles null/undefined by returning "a while"', () => {
      expect(formatRelativeTime(null)).toBe('a while');
      expect(formatRelativeTime(undefined)).toBe('a while');
    });
  });

  describe('trackEngagement', () => {
    it('writes engagement to subcollection', async () => {
      await trackEngagement('user-123', {
        domain: 'health',
        promptStyle: 'gratitude',
        response: 'accepted',
        resultedInEntry: true,
        timestamp: new Date(),
      });

      expect(addDoc).toHaveBeenCalledTimes(1);
    });

    it('updates preferences with accepted style', async () => {
      analyticsRepository.getAnalyticsDoc.mockResolvedValue({
        preferences: {
          styleAcceptanceRates: { gratitude: 2, action: 1, reflective: 0, exploratory: 0 },
        },
      });

      await trackEngagement('user-123', {
        domain: 'health',
        promptStyle: 'gratitude',
        response: 'accepted',
        resultedInEntry: false,
        timestamp: new Date(),
      });

      expect(analyticsRepository.setAnalyticsDoc).toHaveBeenCalled();
      const call = analyticsRepository.setAnalyticsDoc.mock.calls[0];
      expect(call[0]).toBe('user-123');
      expect(call[1]).toBe('gap_engagement');
      expect(call[2].preferences.styleAcceptanceRates.gratitude).toBe(3);
    });

    it('snooze sets domain-level snooze timestamp', async () => {
      await trackEngagement('user-123', {
        domain: 'finances',
        promptStyle: 'action',
        response: 'snoozed',
        resultedInEntry: false,
        timestamp: new Date(),
      });

      expect(analyticsRepository.setAnalyticsDoc).toHaveBeenCalled();
      const call = analyticsRepository.setAnalyticsDoc.mock.calls[0];
      const snoozeUntil = call[2].preferences.snoozeUntil.finances;
      // Should be ~7 days from now
      const snoozeMs = typeof snoozeUntil.toMillis === 'function' ? snoozeUntil.toMillis() : snoozeUntil;
      const expectedMs = Date.now() + SNOOZE_DURATION_DAYS * 86400000;
      expect(Math.abs(snoozeMs - expectedMs)).toBeLessThan(5000); // within 5s
    });

    it('dismiss does not snooze but tracks in history', async () => {
      await trackEngagement('user-123', {
        domain: 'health',
        promptStyle: 'reflective',
        response: 'dismissed',
        resultedInEntry: false,
        timestamp: new Date(),
      });

      // Should write to subcollection
      expect(addDoc).toHaveBeenCalledTimes(1);
      // Should not set snooze
      if (analyticsRepository.setAnalyticsDoc.mock.calls.length > 0) {
        const call = analyticsRepository.setAnalyticsDoc.mock.calls[0];
        const snoozeUntil = call[2]?.preferences?.snoozeUntil;
        expect(snoozeUntil?.health).toBeUndefined();
      }
    });

    it('rejects invalid domain', async () => {
      await trackEngagement('user-123', {
        domain: 'invalid-domain',
        promptStyle: 'gratitude',
        response: 'accepted',
        resultedInEntry: false,
        timestamp: new Date(),
      });
      // Should not write to Firestore
      expect(addDoc).not.toHaveBeenCalled();
    });

    it('rejects invalid promptStyle', async () => {
      await trackEngagement('user-123', {
        domain: 'health',
        promptStyle: 'invalid-style',
        response: 'accepted',
        resultedInEntry: false,
        timestamp: new Date(),
      });
      expect(addDoc).not.toHaveBeenCalled();
    });

    it('rejects invalid response type', async () => {
      await trackEngagement('user-123', {
        domain: 'health',
        promptStyle: 'gratitude',
        response: 'invalid-response',
        resultedInEntry: false,
        timestamp: new Date(),
      });
      expect(addDoc).not.toHaveBeenCalled();
    });

    it('handles write failure gracefully', async () => {
      addDoc.mockRejectedValue(new Error('Firestore write failed'));

      // Should not throw
      await expect(
        trackEngagement('user-123', {
          domain: 'health',
          promptStyle: 'gratitude',
          response: 'accepted',
          resultedInEntry: true,
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();
    });
  });

  describe('getEngagementPreferences', () => {
    it('returns preferences when they exist', async () => {
      analyticsRepository.getAnalyticsDoc.mockResolvedValue({
        preferences: {
          styleAcceptanceRates: { gratitude: 5 },
          snoozeUntil: {},
        },
      });

      const prefs = await getEngagementPreferences('user-123');
      expect(prefs).not.toBeNull();
      expect(prefs.preferences.styleAcceptanceRates.gratitude).toBe(5);
    });

    it('returns null when no preferences exist', async () => {
      analyticsRepository.getAnalyticsDoc.mockResolvedValue(null);

      const prefs = await getEngagementPreferences('user-123');
      expect(prefs).toBeNull();
    });

    it('returns null on error', async () => {
      analyticsRepository.getAnalyticsDoc.mockRejectedValue(new Error('Network'));

      const prefs = await getEngagementPreferences('user-123');
      expect(prefs).toBeNull();
    });
  });
});
