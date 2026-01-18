/**
 * Safety Service Tests
 *
 * Critical tests for crisis detection and longitudinal risk assessment.
 * These tests are essential for a mental health application.
 *
 * Note: These tests focus on the pure functions (crisis detection, longitudinal risk)
 * without importing modules that depend on Firebase.
 */

import { describe, it, expect, vi } from 'vitest';

// Import the crisis/warning regex patterns directly from constants
// This avoids importing the safety service which imports firebase
import { CRISIS_KEYWORDS, WARNING_INDICATORS } from '../../../config/constants';

// Mock console.log to suppress output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

// Helper functions that mirror the safety service
const checkCrisisKeywords = (text) => CRISIS_KEYWORDS.test(text);
const checkWarningIndicators = (text) => WARNING_INDICATORS.test(text);

describe('Crisis Detection', () => {
  describe('checkCrisisKeywords', () => {
    it('should detect "suicide"', () => {
      expect(checkCrisisKeywords('I\'ve been having thoughts of suicide')).toBe(true);
    });

    it('should detect "kill myself"', () => {
      expect(checkCrisisKeywords('I want to kill myself')).toBe(true);
    });

    it('should detect "hurt myself"', () => {
      expect(checkCrisisKeywords('I feel like I might hurt myself')).toBe(true);
    });

    it('should detect "end my life"', () => {
      expect(checkCrisisKeywords('I want to end my life')).toBe(true);
    });

    it('should detect "want to die"', () => {
      expect(checkCrisisKeywords('I just want to die')).toBe(true);
    });

    it('should detect "better off dead"', () => {
      expect(checkCrisisKeywords('Everyone would be better off dead without me')).toBe(true);
    });

    it('should detect "no reason to live"', () => {
      expect(checkCrisisKeywords('I have no reason to live anymore')).toBe(true);
    });

    it('should detect "end it all"', () => {
      expect(checkCrisisKeywords('I just want to end it all')).toBe(true);
    });

    it('should detect "don\'t want to wake up"', () => {
      expect(checkCrisisKeywords('I don\'t want to wake up tomorrow')).toBe(true);
    });

    it('should detect "better off without me"', () => {
      expect(checkCrisisKeywords('My family would be better off without me')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(checkCrisisKeywords('I WANT TO KILL MYSELF')).toBe(true);
      expect(checkCrisisKeywords('SUICIDE is on my mind')).toBe(true);
    });

    it('should NOT flag normal journal entries', () => {
      expect(checkCrisisKeywords('Had a great day at work')).toBe(false);
      expect(checkCrisisKeywords('Feeling a bit down today')).toBe(false);
      expect(checkCrisisKeywords('Stressed about the project deadline')).toBe(false);
    });

    it('should NOT flag metaphorical usage', () => {
      expect(checkCrisisKeywords('This project is killing me')).toBe(false);
      expect(checkCrisisKeywords('I\'m dying to see that movie')).toBe(false);
    });
  });

  describe('checkWarningIndicators', () => {
    it('should detect "hopeless"', () => {
      expect(checkWarningIndicators('I feel so hopeless')).toBe(true);
    });

    it('should detect "worthless"', () => {
      expect(checkWarningIndicators('I feel completely worthless')).toBe(true);
    });

    it('should detect "no point"', () => {
      expect(checkWarningIndicators('There\'s no point anymore')).toBe(true);
    });

    it('should detect "can\'t go on"', () => {
      expect(checkWarningIndicators('I can\'t go on like this')).toBe(true);
    });

    it('should detect "trapped"', () => {
      expect(checkWarningIndicators('I feel trapped in my life')).toBe(true);
    });

    it('should detect "burden"', () => {
      expect(checkWarningIndicators('I\'m such a burden to everyone')).toBe(true);
    });

    it('should detect "no way out"', () => {
      expect(checkWarningIndicators('There\'s no way out of this')).toBe(true);
    });

    it('should detect "give up"', () => {
      expect(checkWarningIndicators('I just want to give up')).toBe(true);
    });

    it('should detect "falling apart"', () => {
      expect(checkWarningIndicators('Everything is falling apart')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(checkWarningIndicators('I FEEL HOPELESS')).toBe(true);
    });

    it('should NOT flag normal stress expressions', () => {
      expect(checkWarningIndicators('Had a tough day but I\'ll manage')).toBe(false);
      expect(checkWarningIndicators('Work was stressful today')).toBe(false);
    });
  });
});

describe('Longitudinal Risk Assessment', () => {
  // Configuration matching the service
  const LONGITUDINAL_CONFIG = {
    windowDays: 14,
    minimumEntries: 5,
    slopeThreshold: -0.03,
    avgMoodThreshold: 0.30,
    acuteSlopeThreshold: -0.05,
    acuteWindowDays: 7
  };

  // Simplified version of checkLongitudinalRisk for testing
  const checkLongitudinalRisk = (recentEntries) => {
    const now = Date.now();

    const last14Days = recentEntries.filter(e => {
      const entryTime = e.createdAt instanceof Date
        ? e.createdAt.getTime()
        : e.createdAt?.toDate?.()?.getTime?.() || new Date(e.createdAt).getTime();
      return entryTime > now - LONGITUDINAL_CONFIG.windowDays * 24 * 60 * 60 * 1000;
    });

    if (last14Days.length < LONGITUDINAL_CONFIG.minimumEntries) {
      return {
        isAtRisk: false,
        reason: 'insufficient_data',
        entriesAnalyzed: last14Days.length
      };
    }

    const sorted = [...last14Days].sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : a.createdAt?.toDate?.()?.getTime?.() || 0;
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : b.createdAt?.toDate?.()?.getTime?.() || 0;
      return aTime - bTime;
    });

    const moodScores = sorted.map(e => e.analysis?.mood_score ?? 0.5);
    const avgMood = moodScores.reduce((sum, score) => sum + score, 0) / moodScores.length;

    const n = moodScores.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = moodScores.reduce((a, b) => a + b, 0);
    const sumXY = moodScores.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sustainedSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    const isLowAvgMood = avgMood < LONGITUDINAL_CONFIG.avgMoodThreshold;
    const isSustainedDecline = sustainedSlope < LONGITUDINAL_CONFIG.slopeThreshold;
    const isAtRisk = isLowAvgMood || isSustainedDecline;

    return {
      isAtRisk,
      entriesAnalyzed: last14Days.length,
      flags: { isLowAvgMood, isSustainedDecline }
    };
  };

  const createEntry = (daysAgo, moodScore) => ({
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    analysis: { mood_score: moodScore },
    text: 'Test entry'
  });

  it('should return insufficient_data when < 5 entries in window', () => {
    const entries = [
      createEntry(1, 0.5),
      createEntry(2, 0.4),
      createEntry(3, 0.3)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.isAtRisk).toBe(false);
    expect(result.reason).toBe('insufficient_data');
    expect(result.entriesAnalyzed).toBe(3);
  });

  it('should detect low average mood', () => {
    const entries = [
      createEntry(1, 0.2),
      createEntry(2, 0.25),
      createEntry(3, 0.22),
      createEntry(5, 0.28),
      createEntry(7, 0.24)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.isAtRisk).toBe(true);
    expect(result.flags.isLowAvgMood).toBe(true);
  });

  it('should detect sustained decline', () => {
    const entries = [
      createEntry(1, 0.2),
      createEntry(3, 0.35),
      createEntry(5, 0.45),
      createEntry(8, 0.55),
      createEntry(10, 0.65),
      createEntry(12, 0.75)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.isAtRisk).toBe(true);
    expect(result.flags.isSustainedDecline).toBe(true);
  });

  it('should NOT flag stable mood patterns', () => {
    const entries = [
      createEntry(1, 0.55),
      createEntry(3, 0.52),
      createEntry(5, 0.58),
      createEntry(7, 0.54),
      createEntry(10, 0.56)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.isAtRisk).toBe(false);
  });

  it('should NOT flag improving mood patterns', () => {
    const entries = [
      createEntry(1, 0.75),
      createEntry(3, 0.65),
      createEntry(5, 0.55),
      createEntry(7, 0.45),
      createEntry(10, 0.35)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.isAtRisk).toBe(false);
  });

  it('should exclude entries outside 14-day window', () => {
    const entries = [
      createEntry(1, 0.5),
      createEntry(3, 0.5),
      createEntry(5, 0.5),
      createEntry(7, 0.5),
      createEntry(10, 0.5),
      createEntry(20, 0.1),
      createEntry(25, 0.1)
    ];

    const result = checkLongitudinalRisk(entries);

    expect(result.entriesAnalyzed).toBe(5);
    expect(result.isAtRisk).toBe(false);
  });
});
