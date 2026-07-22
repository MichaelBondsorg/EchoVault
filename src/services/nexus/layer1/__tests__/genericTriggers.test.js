/**
 * Enforcement tests for the generic trigger vocabulary (R4 T2 — DR finding 5).
 *
 * These tests are the privacy backstop: every trigger patternDetector.js can
 * ever match must live in this module, be a clean lowercase phrase, and
 * never collide with the personal-token denylist. If someone reintroduces a
 * name/brand/app-reference trigger anywhere in GENERIC_TRIGGERS, this file
 * fails.
 */
import { describe, it, expect } from 'vitest';
import {
  GENERIC_TRIGGERS,
  PERSONAL_TOKEN_DENYLIST,
  MIN_ENTRY_WORDS,
  countWords,
  hasMinimumContext,
  matchesGenericTrigger,
} from '../genericTriggers';

const allTriggers = () =>
  Object.values(GENERIC_TRIGGERS).flatMap((pattern) => pattern.triggers);

describe('genericTriggers vocabulary', () => {
  it('defines at least one category', () => {
    expect(Object.keys(GENERIC_TRIGGERS).length).toBeGreaterThan(0);
  });

  it('every pattern has id, category, triggers[], biometricSignature', () => {
    for (const [key, pattern] of Object.entries(GENERIC_TRIGGERS)) {
      expect(pattern.id, `${key}.id`).toBeTruthy();
      expect(pattern.category, `${key}.category`).toBeTruthy();
      expect(Array.isArray(pattern.triggers), `${key}.triggers`).toBe(true);
      expect(pattern.triggers.length, `${key}.triggers length`).toBeGreaterThan(0);
      expect(pattern.biometricSignature, `${key}.biometricSignature`).toBeTruthy();
    }
  });

  describe('privacy lint: no personal literals', () => {
    it('every trigger matches /^[a-z ]+$/ (lowercase letters and spaces only)', () => {
      for (const trigger of allTriggers()) {
        expect(trigger, `trigger "${trigger}"`).toMatch(/^[a-z ]+$/);
      }
    });

    it('no trigger contains a denylisted personal token', () => {
      for (const trigger of allTriggers()) {
        for (const banned of PERSONAL_TOKEN_DENYLIST) {
          expect(
            trigger.includes(banned),
            `trigger "${trigger}" must not contain personal token "${banned}"`
          ).toBe(false);
        }
      }
    });

    it('no trigger is itself a denylisted token (defensive, catches multi-word denylist entries too)', () => {
      const deny = new Set(PERSONAL_TOKEN_DENYLIST);
      for (const trigger of allTriggers()) {
        expect(deny.has(trigger)).toBe(false);
      }
    });

    it('denylist itself stays lowercase (sanity check for the check)', () => {
      for (const token of PERSONAL_TOKEN_DENYLIST) {
        expect(token).toBe(token.toLowerCase());
      }
    });
  });

  describe('countWords / hasMinimumContext', () => {
    it('counts words on whitespace, ignoring extra spaces', () => {
      expect(countWords('one two three')).toBe(3);
      expect(countWords('  one   two  ')).toBe(2);
      expect(countWords('')).toBe(0);
      expect(countWords(null)).toBe(0);
    });

    it('MIN_ENTRY_WORDS is a small positive deterministic constant', () => {
      expect(MIN_ENTRY_WORDS).toBeGreaterThan(0);
      expect(Number.isInteger(MIN_ENTRY_WORDS)).toBe(true);
    });

    it('rejects entries below the minimum word count', () => {
      expect(hasMinimumContext('great')).toBe(false);
      expect(hasMinimumContext('felt great today')).toBe(false); // 3 words < 5
    });

    it('accepts entries at or above the minimum word count', () => {
      const text = Array(MIN_ENTRY_WORDS).fill('word').join(' ');
      expect(hasMinimumContext(text)).toBe(true);
    });
  });

  describe('matchesGenericTrigger — word boundary, not substring', () => {
    it('matches a whole-word/whole-phrase trigger', () => {
      expect(matchesGenericTrigger('I felt anxious about the meeting', 'felt anxious')).toBe(true);
    });

    it('does NOT match a trigger embedded inside a longer unrelated word', () => {
      // 'connected' should not match 'disconnected'
      expect(matchesGenericTrigger('the call kept disconnecting', 'connect')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(matchesGenericTrigger('Felt Anxious all day long', 'felt anxious')).toBe(true);
    });

    it('returns false for empty inputs', () => {
      expect(matchesGenericTrigger('', 'felt anxious')).toBe(false);
      expect(matchesGenericTrigger('felt anxious', '')).toBe(false);
    });
  });
});
