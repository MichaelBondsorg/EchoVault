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

// Import the REAL safety functions (the service no longer pulls in Firebase, so
// it can be unit-tested directly). Testing copies of this logic would let a
// regression in the real code pass silently — unacceptable for crisis detection.
import {
  checkCrisisKeywords,
  checkWarningIndicators,
  checkLongitudinalRisk,
} from '../index.js';

// Mock console.log to suppress output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

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

describe('Longitudinal Risk Assessment (real checkLongitudinalRisk)', () => {
  const createEntry = (daysAgo, moodScore) => ({
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    analysis: { mood_score: moodScore },
    text: 'Test entry'
  });

  // An entry whose AI analysis failed: marked failed, NO mood_score. The risk
  // detector must skip these, never treat them as a neutral 0.5.
  const createFailedEntry = (daysAgo) => ({
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    analysis: { framework: 'general' },
    analysisStatus: 'failed',
    text: 'Test entry'
  });

  it('should return insufficient_data when < 5 entries in window', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.5),
      createEntry(2, 0.4),
      createEntry(3, 0.3),
    ]);
    expect(result.isAtRisk).toBe(false);
    expect(result.reason).toBe('insufficient_data');
  });

  it('should detect low average mood', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.2),
      createEntry(2, 0.25),
      createEntry(3, 0.22),
      createEntry(5, 0.28),
      createEntry(7, 0.24),
    ]);
    expect(result.isAtRisk).toBe(true);
    expect(result.reason).toMatch(/low|decline/);
    expect(result.metrics.avgMood).toBeLessThan(0.3);
  });

  it('should detect a declining mood trajectory', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.2),
      createEntry(3, 0.35),
      createEntry(5, 0.45),
      createEntry(8, 0.55),
      createEntry(10, 0.65),
      createEntry(12, 0.75),
    ]);
    expect(result.isAtRisk).toBe(true);
    expect(result.reason).toMatch(/decline/);
  });

  it('should NOT flag stable mood patterns', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.55),
      createEntry(3, 0.52),
      createEntry(5, 0.58),
      createEntry(7, 0.54),
      createEntry(10, 0.56),
    ]);
    expect(result.isAtRisk).toBe(false);
  });

  it('should NOT flag improving mood patterns', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.75),
      createEntry(3, 0.65),
      createEntry(5, 0.55),
      createEntry(7, 0.45),
      createEntry(10, 0.35),
    ]);
    expect(result.isAtRisk).toBe(false);
  });

  it('should exclude entries outside the 14-day window', () => {
    const result = checkLongitudinalRisk([
      createEntry(1, 0.5),
      createEntry(3, 0.5),
      createEntry(5, 0.5),
      createEntry(7, 0.5),
      createEntry(10, 0.5),
      createEntry(20, 0.1),
      createEntry(25, 0.1),
    ]);
    expect(result.isAtRisk).toBe(false);
  });

  // Regression: during an AI outage, failed entries (no mood_score) must not be
  // scored as a neutral 0.5 that masks a real decline or manufactures a healthy
  // flat line. They are skipped entirely.
  it('should SKIP entries with failed analysis, not score them as 0.5', () => {
    // Only failed entries in the window → not enough real data to assess.
    const allFailed = checkLongitudinalRisk([
      createFailedEntry(1),
      createFailedEntry(2),
      createFailedEntry(4),
      createFailedEntry(6),
      createFailedEntry(8),
    ]);
    expect(allFailed.reason).toBe('insufficient_data');

    // A genuine low-mood decline must still be detected even when interleaved
    // with failed entries that would otherwise dilute the average toward 0.5.
    const withFailures = checkLongitudinalRisk([
      createEntry(1, 0.15),
      createFailedEntry(2),
      createEntry(3, 0.2),
      createFailedEntry(4),
      createEntry(5, 0.18),
      createEntry(7, 0.22),
      createEntry(9, 0.2),
    ]);
    expect(withFailures.isAtRisk).toBe(true);
    expect(withFailures.metrics.avgMood).toBeLessThan(0.3);
  });
});
