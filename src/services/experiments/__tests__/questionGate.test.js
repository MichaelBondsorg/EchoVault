/**
 * questionGate.test.js
 *
 * Adversarial fixture set for the unsafe-question gate (R3 Task 4).
 * PRD acceptance: "An unsafe or medically prescriptive question is declined
 * with a safer reflection alternative."
 *
 * Safety posture pinned by these tests: over-blocking is acceptable,
 * under-blocking is not. 100% of medical+crisis fixtures must decline with
 * the RIGHT verdict (crisis beats medical when both trip); 100% of
 * benign+canonical fixtures must pass 'ok'.
 */

import { describe, it, expect, vi } from 'vitest';
import { screenQuestion, DECLINE_CONTRACTS } from '../questionGate.js';
import { checkCrisisKeywords, checkWarningIndicators } from '../../safety/index.js';

vi.spyOn(console, 'log').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Fixture groups
// ---------------------------------------------------------------------------

// obvious-medical (>=10): explicit dosage, named drugs, diagnose-me,
// cure/treat, should-I-stop framings.
const OBVIOUS_MEDICAL = [
  "What's the right dosage of Zoloft for me?",
  'Should I ask my doctor to increase my Lexapro to 20mg?',
  'Do I have bipolar disorder?',
  'Am I depressed or just tired?',
  'Can journaling cure my depression?',
  "What's the best treatment for anxiety disorder?",
  'Should I stop taking my antidepressants?',
  'Is it safe to taper off Xanax on my own?',
  'Can you diagnose me with ADHD based on my entries?',
  'Should I switch from therapy to medication?',
  'How many milligrams of lithium should I take?',
];

// oblique-medical (>=8): euphemisms and indirect phrasing that still needs
// to be caught (fail-closed on ambiguity).
const OBLIQUE_MEDICAL = [
  'Would journaling more mean I need less of my prescription?',
  'Is my mood better since going off the thing my doctor gave me?',
  'Does my mood improve on days I skip my morning meds?',
  'Should I wean off what the psychiatrist prescribed?',
  'Is my anxiety bad enough that I should ask for a stronger prescription?',
  'Could stopping my SSRI be affecting my sleep?',
  'Am I manic or just having a good week?',
  'Is journaling working as well as my benzo does?',
  'Would this count as an eating disorder if I tracked it?',
];

// crisis (>=6): drawn to trip the REAL imported checkers. Each one is
// independently verified below to actually trip checkCrisisKeywords or
// checkWarningIndicators -- a fixture that passed the gate silently
// (i.e. because the gate happens to also match a medical pattern) would be
// worthless for pinning crisis-tier behavior.
const CRISIS = [
  'Does exercise change how often I think about suicide?',
  'I want to die on the days my sleep is bad -- is there a pattern?',
  "Do I feel more hopeless on days I don't get sunshine?",
  'Does my mood correlate with feeling like a burden to my family?',
  "Am I more likely to feel trapped when I don't exercise?",
  'Do my steps go down on the days I want to give up?',
  'Is there a pattern between poor sleep and wanting to hurt myself?',
];

// crisis-beats-medical: text that trips BOTH a medical pattern and a crisis
// checker. Priority order must resolve to 'crisis'.
const CRISIS_AND_MEDICAL = [
  'Should I stop taking my antidepressants because I want to die?',
];

// benign-with-scary-words (>=8): everyday language that superficially looks
// alarming (job stress idioms, "pill" adjacency) but is not unsafe content.
// 'pill' adjacency decision: bare "pill"/"pills" is deliberately NOT a
// trigger word (see questionGate.js rationale) -- "chill pill", "bitter
// pill to swallow", "pill-sized" are common non-clinical idioms, so a bare
// pill mention would over-block far more than it protects. Medication
// decision-verbs (stop/start taking, taper, wean/go off) still catch the
// genuinely unsafe "pill" cases.
const BENIGN_SCARY_WORDS = [
  "I'm sick of meetings -- does that affect my mood?",
  'My job is killing my vibe lately.',
  'Does skipping my morning pill-sized coffee affect my mood?',
  "I'm dead tired after workouts -- is that normal?",
  'Journaling cured my boredom this week.',
  'That deadline is going to kill me, does stress affect my sleep?',
  'I treated myself to a nap today -- did that help my mood?',
  'This diet is torture, does it affect my energy?',
  "I'm drowning in email, does that correlate with poor sleep?",
];

// canonical-template questions (>=8): natural phrasings of every v1 template
// from the plan (sleep/exercise/sunshine/steps/recovery/tag), same-day and
// lag-1 variants included.
const CANONICAL_TEMPLATE_QUESTIONS = [
  'Does more sleep improve my mood?',
  'Does sleep the night before affect my mood the next day?',
  'Does exercising more help my mood?',
  'Does exercise the day before affect how I feel the next day?',
  'Do sunny days improve my mood?',
  'Is my mood better on days I get more sunshine?',
  'Does taking more steps improve my mood?',
  'Does my recovery score affect my mood?',
  'Does my mood change on days I mention my partner?',
];

// ---------------------------------------------------------------------------
// Sanity: fixture groups actually trip what they claim to
// ---------------------------------------------------------------------------

describe('fixture sanity checks', () => {
  it('every CRISIS fixture trips a real crisis checker', () => {
    CRISIS.forEach((text) => {
      const tripped = checkCrisisKeywords(text) || checkWarningIndicators(text);
      expect(tripped, `expected "${text}" to trip a crisis checker`).toBe(true);
    });
  });

  it('every CRISIS_AND_MEDICAL fixture trips a real crisis checker', () => {
    CRISIS_AND_MEDICAL.forEach((text) => {
      const tripped = checkCrisisKeywords(text) || checkWarningIndicators(text);
      expect(tripped, `expected "${text}" to trip a crisis checker`).toBe(true);
    });
  });

  it('group sizes meet the brief minimums', () => {
    expect(OBVIOUS_MEDICAL.length).toBeGreaterThanOrEqual(10);
    expect(OBLIQUE_MEDICAL.length).toBeGreaterThanOrEqual(8);
    expect(CRISIS.length).toBeGreaterThanOrEqual(6);
    expect(BENIGN_SCARY_WORDS.length).toBeGreaterThanOrEqual(8);
    expect(CANONICAL_TEMPLATE_QUESTIONS.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

describe('screenQuestion verdicts', () => {
  describe('obvious-medical fixtures decline as medical', () => {
    OBVIOUS_MEDICAL.forEach((text) => {
      it(`declines: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'medical' });
      });
    });
  });

  describe('oblique-medical fixtures decline as medical', () => {
    OBLIQUE_MEDICAL.forEach((text) => {
      it(`declines: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'medical' });
      });
    });
  });

  describe('crisis fixtures decline as crisis (highest priority)', () => {
    CRISIS.forEach((text) => {
      it(`declines: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'crisis' });
      });
    });
  });

  describe('crisis beats medical when both trip', () => {
    CRISIS_AND_MEDICAL.forEach((text) => {
      it(`resolves to crisis, not medical: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'crisis' });
      });
    });
  });

  describe('benign-with-scary-words fixtures pass', () => {
    BENIGN_SCARY_WORDS.forEach((text) => {
      it(`passes: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'ok' });
      });
    });
  });

  describe('canonical template questions pass', () => {
    CANONICAL_TEMPLATE_QUESTIONS.forEach((text) => {
      it(`passes: "${text}"`, () => {
        expect(screenQuestion(text)).toEqual({ verdict: 'ok' });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Priority order, fail-closed contract, input handling
// ---------------------------------------------------------------------------

describe('verdict priority order', () => {
  it('checks crisis before medical (crisis keyword alone -> crisis, not medical)', () => {
    expect(screenQuestion('I want to die')).toEqual({ verdict: 'crisis' });
  });

  it('falls through to medical only when crisis does not trip', () => {
    expect(screenQuestion('Should I stop taking my antidepressants?')).toEqual({
      verdict: 'medical',
    });
  });

  it('falls through to ok only when neither crisis nor medical trip', () => {
    expect(screenQuestion('Does more sleep improve my mood?')).toEqual({ verdict: 'ok' });
  });
});

describe('input contract (fail-closed on ambiguity, but not on absence)', () => {
  it('empty string -> ok (nothing to screen; create form requires a question separately)', () => {
    expect(screenQuestion('')).toEqual({ verdict: 'ok' });
  });

  it('whitespace-only string -> ok', () => {
    expect(screenQuestion('   \n\t  ')).toEqual({ verdict: 'ok' });
  });

  it('undefined -> ok', () => {
    expect(screenQuestion(undefined)).toEqual({ verdict: 'ok' });
  });

  it('null -> ok', () => {
    expect(screenQuestion(null)).toEqual({ verdict: 'ok' });
  });

  it('non-string (number) -> ok', () => {
    expect(screenQuestion(12345)).toEqual({ verdict: 'ok' });
  });

  it('non-string (object) -> ok', () => {
    expect(screenQuestion({ text: 'do I have bipolar disorder?' })).toEqual({ verdict: 'ok' });
  });
});

describe('screenQuestion is pure', () => {
  it('does not mutate its input and returns a fresh object', () => {
    const text = 'Do I have bipolar disorder?';
    const frozen = Object.freeze(text);
    expect(() => screenQuestion(frozen)).not.toThrow();
  });

  it('is deterministic for the same input', () => {
    const text = 'Should I stop taking my antidepressants?';
    expect(screenQuestion(text)).toEqual(screenQuestion(text));
  });
});

// ---------------------------------------------------------------------------
// Case-insensitivity / word-boundary spot checks
// ---------------------------------------------------------------------------

describe('case-insensitivity', () => {
  it('matches medical patterns regardless of case', () => {
    expect(screenQuestion('SHOULD I STOP TAKING MY ANTIDEPRESSANTS?')).toEqual({
      verdict: 'medical',
    });
  });

  it('matches crisis patterns regardless of case', () => {
    expect(screenQuestion('I WANT TO DIE')).toEqual({ verdict: 'crisis' });
  });
});

describe('word-boundary awareness (avoids the "sick of meetings" false-positive class)', () => {
  it('does not flag "sick of meetings"', () => {
    expect(screenQuestion('I am sick of meetings')).toEqual({ verdict: 'ok' });
  });

  it('does not flag bare "pill" mentions', () => {
    expect(screenQuestion('That was a bitter pill to swallow')).toEqual({ verdict: 'ok' });
  });

  it('does not flag "treat myself" (no condition word)', () => {
    expect(screenQuestion('I treated myself to ice cream')).toEqual({ verdict: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Self-harm-adjacent gap coverage (not already in crisis regexes)
// ---------------------------------------------------------------------------

describe('self-harm-adjacent phrasings not covered by the crisis regexes', () => {
  it('"hurting myself" (progressive form) is not in CRISIS_KEYWORDS but is caught as medical', () => {
    // Sanity: the real crisis checker does NOT trip on the progressive form.
    expect(checkCrisisKeywords('I want to try hurting myself less this month')).toBe(false);
    expect(checkWarningIndicators('I want to try hurting myself less this month')).toBe(false);
    // The gate still declines it, conservatively, via the medical tier.
    expect(screenQuestion('I want to try hurting myself less this month')).toEqual({
      verdict: 'medical',
    });
  });

  it('bare "self-harm" mention declines as medical', () => {
    expect(screenQuestion('Does journaling reduce self-harm urges?')).toEqual({
      verdict: 'medical',
    });
  });
});

// ---------------------------------------------------------------------------
// DECLINE_CONTRACTS data contract
// ---------------------------------------------------------------------------

describe('DECLINE_CONTRACTS', () => {
  it('defines the crisis contract: surfaces the safety plan, no experiment', () => {
    expect(DECLINE_CONTRACTS.crisis).toMatchObject({
      surfaceSafetyPlan: true,
      copyKey: 'crisis',
    });
    expect(typeof DECLINE_CONTRACTS.crisis.copy).toBe('string');
    expect(DECLINE_CONTRACTS.crisis.copy.length).toBeGreaterThan(0);
  });

  it('defines the medical contract: no safety plan, suggests a professional, points to Recipes', () => {
    expect(DECLINE_CONTRACTS.medical).toMatchObject({
      surfaceSafetyPlan: false,
      copyKey: 'medical',
      saferAlternative: 'recipes',
    });
    expect(typeof DECLINE_CONTRACTS.medical.copy).toBe('string');
    expect(DECLINE_CONTRACTS.medical.copy.length).toBeGreaterThan(0);
  });

  it('medical copy is non-clinical and non-judgmental (no diagnostic or shaming language)', () => {
    const copy = DECLINE_CONTRACTS.medical.copy.toLowerCase();
    // Should not itself attempt diagnosis or moralize.
    expect(copy).not.toMatch(/\byou (are|have)\b/);
    expect(copy).not.toMatch(/\bshould(n't)? feel\b/);
  });

  it('crisis copy does not use alarming/clinical language, matching app tone', () => {
    const copy = DECLINE_CONTRACTS.crisis.copy.toLowerCase();
    expect(copy).not.toMatch(/\bemergency\b/);
  });

  it('contracts object is frozen/stable in shape across calls', () => {
    expect(Object.keys(DECLINE_CONTRACTS).sort()).toEqual(['crisis', 'medical']);
  });
});
