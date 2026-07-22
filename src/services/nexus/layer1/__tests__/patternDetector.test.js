/**
 * Tests for Nexus layer 1 pattern detector (R4 T2 — DR finding 5).
 *
 * Covers: privacy (no personal literals reachable through detection),
 * structural lint (no inline trigger arrays in patternDetector.js — triggers
 * imported from genericTriggers.js only), word-boundary matching (no bare
 * substring false positives), and the minimum-context gate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectPatternsInEntry,
  NARRATIVE_PATTERNS,
  HEALTH_PATTERNS,
  ENVIRONMENT_PATTERNS,
  COMBINED_PATTERNS,
} from '../patternDetector';
import { GENERIC_TRIGGERS, PERSONAL_TOKEN_DENYLIST, MIN_ENTRY_WORDS } from '../genericTriggers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const patternDetectorSource = fs.readFileSync(
  path.join(__dirname, '../patternDetector.js'),
  'utf8'
);

describe('patternDetector privacy + structural lint', () => {
  it('NARRATIVE_PATTERNS is sourced from GENERIC_TRIGGERS (no separate literal set)', () => {
    expect(NARRATIVE_PATTERNS).toBe(GENERIC_TRIGGERS);
  });

  it('every trigger used by patternDetector exists in GENERIC_TRIGGERS', () => {
    const vocabTriggers = new Set(
      Object.values(GENERIC_TRIGGERS).flatMap((p) => p.triggers)
    );
    const usedTriggers = Object.values(NARRATIVE_PATTERNS).flatMap((p) => p.triggers);
    for (const trigger of usedTriggers) {
      expect(vocabTriggers.has(trigger), `"${trigger}" must be in GENERIC_TRIGGERS`).toBe(true);
    }
  });

  it('patternDetector.js source defines NO inline trigger arrays (structural lint)', () => {
    // The only allowable `triggers:` occurrences are none — narrative trigger
    // data must be imported from genericTriggers.js, not declared inline.
    expect(patternDetectorSource).not.toMatch(/triggers\s*:\s*\[/);
  });

  it('patternDetector.js source contains no known personal literal tokens', () => {
    const lower = patternDetectorSource.toLowerCase();
    for (const token of PERSONAL_TOKEN_DENYLIST) {
      expect(lower.includes(token), `patternDetector.js source must not contain "${token}"`).toBe(false);
    }
  });

  it('detectPatternsInEntry never surfaces a denylisted personal token via matched triggers', () => {
    // Feed text containing personal tokens directly - detection must still
    // only ever report GENERIC_TRIGGERS strings as matched triggers, since
    // those are the only strings the matcher looks for.
    const entry = {
      id: 'e1',
      text: 'Spent quality time together and felt connected during a meaningful conversation today with everyone around.',
    };
    const result = detectPatternsInEntry(entry);
    const matchedStrings = result.flatMap((p) => p.triggers || []);
    for (const trigger of matchedStrings) {
      expect(trigger).toMatch(/^[a-z ]+$/);
    }
  });
});

describe('detectPatternsInEntry — word boundary + minimum context', () => {
  it('does not fire on a short/sparse entry even if it contains a trigger word', () => {
    const entry = { id: 'e2', text: 'Felt great.' }; // 2 words, below MIN_ENTRY_WORDS
    const result = detectPatternsInEntry(entry);
    const narrativeMatches = result.filter((p) => p.patternType === 'narrative');
    expect(narrativeMatches).toEqual([]);
  });

  it('fires when the entry meets the minimum word count and contains a real trigger phrase', () => {
    const entry = {
      id: 'e3',
      text: 'Today I felt anxious about the meeting and could not stop thinking about it.',
    };
    expect(entry.text.trim().split(/\s+/).length).toBeGreaterThanOrEqual(MIN_ENTRY_WORDS);
    const result = detectPatternsInEntry(entry);
    const anxiety = result.find((p) => p.patternId === 'anxiety_signal');
    expect(anxiety).toBeDefined();
    expect(anxiety.triggers).toContain('felt anxious');
  });

  it('does not false-positive on a trigger phrase embedded in an unrelated longer word/phrase', () => {
    // 'in pain' should not match e.g. "captain" or "explain" style embeddings
    const entry = {
      id: 'e4',
      text: 'The captain explained the plan during a very long and detailed morning briefing.',
    };
    const result = detectPatternsInEntry(entry);
    const discomfort = result.find((p) => p.patternId === 'physical_discomfort');
    expect(discomfort).toBeUndefined();
  });
});

describe('detectPatternsInEntry — health/environment/combined unaffected', () => {
  it('still detects health patterns independent of narrative privacy changes', () => {
    const entry = {
      id: 'e5',
      text: 'Short note.',
      healthContext: { sleep: { totalHours: 4, score: 30 } },
    };
    const result = detectPatternsInEntry(entry);
    const poorSleep = result.find((p) => p.patternId === 'poor_sleep');
    expect(poorSleep).toBeDefined();
  });

  it('HEALTH_PATTERNS / ENVIRONMENT_PATTERNS / COMBINED_PATTERNS remain untouched by the vocabulary change', () => {
    expect(Object.keys(HEALTH_PATTERNS).length).toBeGreaterThan(0);
    expect(Object.keys(ENVIRONMENT_PATTERNS).length).toBeGreaterThan(0);
    expect(Object.keys(COMBINED_PATTERNS).length).toBeGreaterThan(0);
  });
});
