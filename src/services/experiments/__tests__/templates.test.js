/**
 * Personal Experiments — template catalog tests (R3 Task 3).
 */
import { describe, it, expect } from 'vitest';
import { TEMPLATES, getTemplateById, matchQuestionToTemplate } from '../templates.js';
import { extractHealthSignals } from '../../health/healthFormatter.js';
import { extractEnvironmentSignals } from '../../environment/environmentFormatter.js';

const EXPECTED_IDS = [
  'sleep-hours-mood-same-day',
  'sleep-hours-mood-lag1',
  'exercise-minutes-mood',
  'sunshine-percent-mood',
  'steps-mood',
  'recovery-score-mood',
  'tag-presence-mood',
];

describe('TEMPLATES catalog', () => {
  it('contains exactly the v1 set of template ids', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('every template has the full required shape', () => {
    for (const t of TEMPLATES) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.title).toBe('string');
      expect(Array.isArray(t.questionPatterns)).toBe(true);
      expect(t.questionPatterns.length).toBeGreaterThan(0);
      expect(typeof t.exposure).toBe('object');
      expect(typeof t.exposure.source).toBe('string');
      expect(typeof t.exposure.field).toBe('string');
      expect(typeof t.exposure.label).toBe('string');
      expect(t.outcome).toEqual({ field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' });
      expect([0, 1]).toContain(t.lag);
      expect(Array.isArray(t.confounders)).toBe(true);
      expect(t.confounders.length).toBeGreaterThan(0);
      for (const c of t.confounders) expect(typeof c).toBe('string');
      expect(Array.isArray(t.whatThisDoesNotProve)).toBe(true);
      // 4 bullets (Michael review hardening, item 6 added a 4th,
      // cross-experiment multiplicity caveat — see whatThisDoesNotProveFor).
      expect(t.whatThisDoesNotProve.length).toBe(4);
    }
  });

  it('only the sleep template has both a same-day and a lag-1 variant', () => {
    const sleepLag0 = getTemplateById('sleep-hours-mood-same-day');
    const sleepLag1 = getTemplateById('sleep-hours-mood-lag1');
    expect(sleepLag0.lag).toBe(0);
    expect(sleepLag1.lag).toBe(1);
    expect(sleepLag0.exposure).toEqual(sleepLag1.exposure);
    const nonSleep = TEMPLATES.filter((t) => !t.id.startsWith('sleep-hours-mood'));
    for (const t of nonSleep) expect(t.lag).toBe(0);
  });

  it('the "what this does not prove" bullets are not identical across templates (per-template exposure/outcome slotting)', () => {
    const firstBullets = TEMPLATES.map((t) => t.whatThisDoesNotProve[0]);
    expect(new Set(firstBullets).size).toBe(TEMPLATES.length);
  });

  it('the second, third, and fourth "what this does not prove" bullets are verbatim-identical across every template (unslotted, spec-frozen)', () => {
    const seconds = new Set(TEMPLATES.map((t) => t.whatThisDoesNotProve[1]));
    const thirds = new Set(TEMPLATES.map((t) => t.whatThisDoesNotProve[2]));
    const fourths = new Set(TEMPLATES.map((t) => t.whatThisDoesNotProve[3]));
    expect(seconds.size).toBe(1);
    expect(thirds.size).toBe(1);
    expect(fourths.size).toBe(1);
  });

  it('the fourth bullet is the cross-experiment multiplicity caveat (Michael review hardening, item 6)', () => {
    for (const t of TEMPLATES) {
      expect(t.whatThisDoesNotProve[3]).toBe(
        'Running many experiments makes a chance pattern more likely somewhere; treat any single result as one observation, not a verdict.',
      );
    }
  });

  it('health-source exposure.field values are real keys returned by extractHealthSignals', () => {
    const sample = extractHealthSignals({
      sleep: { totalHours: 1 },
      heart: {},
      recovery: { score: 1 },
      strain: {},
      activity: { stepsToday: 1, totalExerciseMinutes: 1 },
    });
    const healthFields = TEMPLATES.filter((t) => t.exposure.source === 'health').map((t) => t.exposure.field);
    expect(healthFields.length).toBeGreaterThan(0);
    for (const field of healthFields) {
      expect(Object.prototype.hasOwnProperty.call(sample, field)).toBe(true);
    }
  });

  it('environment-source exposure.field values are real keys returned by extractEnvironmentSignals', () => {
    const sample = extractEnvironmentSignals({ daySummary: { sunshinePercent: 1 } });
    const envFields = TEMPLATES.filter((t) => t.exposure.source === 'environment').map((t) => t.exposure.field);
    expect(envFields.length).toBeGreaterThan(0);
    for (const field of envFields) {
      expect(Object.prototype.hasOwnProperty.call(sample, field)).toBe(true);
    }
  });

  it('the tag-presence template exposes source:"tags" and field:"tags" (the raw entry field, not an extractor key)', () => {
    const tagTemplate = getTemplateById('tag-presence-mood');
    expect(tagTemplate.exposure.source).toBe('tags');
    expect(tagTemplate.exposure.field).toBe('tags');
  });

  it('the tag-presence template declares splitMode: "binary" (Michael review hardening, EX1 H2 finding); every other template omits splitMode (median default)', () => {
    const tagTemplate = getTemplateById('tag-presence-mood');
    expect(tagTemplate.splitMode).toBe('binary');
    const nonTag = TEMPLATES.filter((t) => t.id !== 'tag-presence-mood');
    for (const t of nonTag) expect(t.splitMode).toBeUndefined();
  });

  it('every template title is co-movement framed (Michael review, item 7) — never uses causal "affect" wording', () => {
    for (const t of TEMPLATES) {
      expect(t.title.toLowerCase()).not.toMatch(/\baffect(s|ed)?\b/);
    }
  });
});

describe('matchQuestionToTemplate — canonical questions', () => {
  const cases = [
    ['Does how much I sleep affect my mood?', 'sleep-hours-mood-same-day'],
    ['Is my sleep related to my mood?', 'sleep-hours-mood-same-day'],
    ['Does sleep affect my mood the next day?', 'sleep-hours-mood-lag1'],
    ['Does how I sleep affect how I feel the following day?', 'sleep-hours-mood-lag1'],
    ['Does exercise affect my mood?', 'exercise-minutes-mood'],
    ['Does working out change how I feel?', 'exercise-minutes-mood'],
    ['Does sunshine affect my mood?', 'sunshine-percent-mood'],
    ['Do sunny days improve my mood?', 'sunshine-percent-mood'],
    ['Does how much I walk affect my mood?', 'steps-mood'],
    ['Do more steps improve my mood?', 'steps-mood'],
    ['Does my recovery score affect my mood?', 'recovery-score-mood'],
    ['Is my recovery related to how I feel?', 'recovery-score-mood'],
  ];

  it.each(cases)('%s -> %s', (text, expectedId) => {
    const result = matchQuestionToTemplate(text, []);
    expect(result).not.toBeNull();
    expect(result.template.id).toBe(expectedId);
    expect(result.params).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Co-movement phrasing (Michael review, item 7): the matcher must accept
// BOTH the old causal phrasing (asserted above) AND the new co-movement
// phrasing users will also type — matching is keyword-based (requireAll/
// requireAllExcept over exposure+mood terms), not an exact-title match, so
// both phrasings resolving to the same template is the same underlying
// mechanism, not a special case — these tests pin that explicitly rather
// than leaving it merely implied by the keyword design.
// ---------------------------------------------------------------------------

describe('matchQuestionToTemplate — co-movement phrasing (Michael review, item 7)', () => {
  const coMovementCases = [
    ['How does my sleep move together with my mood?', 'sleep-hours-mood-same-day'],
    ['How do sleep and mood move together in my recorded days?', 'sleep-hours-mood-same-day'],
    ['How does my sleep move together with my mood the next day?', 'sleep-hours-mood-lag1'],
    ['How does exercise move together with my mood?', 'exercise-minutes-mood'],
    ['How does sunshine move together with my mood?', 'sunshine-percent-mood'],
    ['How do my steps move together with my mood?', 'steps-mood'],
    ['How does my recovery score move together with my mood?', 'recovery-score-mood'],
  ];

  it.each(coMovementCases)('%s -> %s', (text, expectedId) => {
    const result = matchQuestionToTemplate(text, []);
    expect(result).not.toBeNull();
    expect(result.template.id).toBe(expectedId);
  });

  it('co-movement tag phrasing matches the tag-presence template, same as causal phrasing', () => {
    const availableTags = ['@person:spencer'];
    const result = matchQuestionToTemplate('How does Spencer move together with my mood?', availableTags);
    expect(result).not.toBeNull();
    expect(result.template.id).toBe('tag-presence-mood');
    expect(result.params).toEqual({ tag: '@person:spencer' });
  });
});

describe('matchQuestionToTemplate — tag-presence', () => {
  const availableTags = ['@person:spencer', '@pet:sterling'];

  it('matches when a concrete tag from availableTags appears alongside a mood word', () => {
    const result = matchQuestionToTemplate('Does seeing Spencer affect my mood?', availableTags);
    expect(result).not.toBeNull();
    expect(result.template.id).toBe('tag-presence-mood');
    expect(result.params).toEqual({ tag: '@person:spencer' });
  });

  it('does NOT match a tag-shaped word that is not in availableTags', () => {
    const result = matchQuestionToTemplate('Does seeing my friend Jordan affect my mood?', availableTags);
    expect(result).toBeNull();
  });

  it('does not match a bare tag mention with no mood word', () => {
    const result = matchQuestionToTemplate('Tell me about Spencer', availableTags);
    expect(result).toBeNull();
  });

  it('is case-insensitive and matches the tag as a whole word (not a substring of another word)', () => {
    const result = matchQuestionToTemplate('does SPENCER affect my mood', availableTags);
    expect(result?.template.id).toBe('tag-presence-mood');

    const noMatch = matchQuestionToTemplate('does spencerville affect my mood', availableTags);
    expect(noMatch).toBeNull();
  });
});

describe('matchQuestionToTemplate — unmappable / ambiguous / edge cases', () => {
  it('returns null for empty or non-string input', () => {
    expect(matchQuestionToTemplate('', [])).toBeNull();
    expect(matchQuestionToTemplate('   ', [])).toBeNull();
    expect(matchQuestionToTemplate(undefined, [])).toBeNull();
    expect(matchQuestionToTemplate(null, [])).toBeNull();
  });

  it('returns null for text with no template-matching keywords', () => {
    expect(matchQuestionToTemplate('What is the meaning of life?', [])).toBeNull();
  });

  it('returns null for text mentioning mood but no exposure keyword at all', () => {
    expect(matchQuestionToTemplate('Why do I feel this way?', [])).toBeNull();
  });

  it('returns null when text is ambiguous across two exposure variables', () => {
    const result = matchQuestionToTemplate('Does sleep and exercise affect my mood?', []);
    expect(result).toBeNull();
  });

  it('defaults availableTags to [] when omitted (no crash, no tag match)', () => {
    expect(matchQuestionToTemplate('Does sleep affect my mood?')).not.toBeNull();
    expect(matchQuestionToTemplate('Does seeing spencer affect my mood?')).toBeNull();
  });
});

describe('getTemplateById', () => {
  it('returns the matching template', () => {
    expect(getTemplateById('steps-mood').id).toBe('steps-mood');
  });

  it('returns undefined for an unknown id', () => {
    expect(getTemplateById('not-a-real-template')).toBeUndefined();
  });
});
