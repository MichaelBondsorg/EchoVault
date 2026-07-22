/**
 * questionGate.js
 *
 * Unsafe-question gate for Personal Experiments (R3 Task 4).
 *
 * PRD §5.4 acceptance criterion this implements: "An unsafe or medically
 * prescriptive question is declined with a safer reflection alternative."
 *
 * This module lives in `experiments/`, not `safety/`: it is
 * experiment-specific POLICY (what counts as an unsafe experiment question)
 * composed FROM the app's safety primitives, not a new safety primitive
 * itself. The crisis tier reuses `checkCrisisKeywords`/`checkWarningIndicators`
 * verbatim -- the regexes are never forked or duplicated here.
 *
 * SAFETY POSTURE (binding, see plan Global Constraints):
 *   - Fail-closed on ambiguity: when a pattern is genuinely ambiguous, keep
 *     it rather than pre-weaken it. Over-blocking is acceptable; under-
 *     blocking is not.
 *   - Verdict priority is fixed: crisis > medical > ok. A question that
 *     trips both a crisis and a medical pattern is a crisis decline, full
 *     stop -- the crisis surface (safety plan) is what matters, not a
 *     medical disclaimer.
 *   - The plan doc and task-4-brief.md both describe a 4-verdict union
 *     (ok|crisis|medical|unmappable). This module's dispatch instructions
 *     explicitly narrowed that: mapping an 'ok' question to a template (or
 *     discovering it maps to none, i.e. "unmappable") is Task 3/6's
 *     `matchQuestionToTemplate` concern, NOT this module's.
 *     `screenQuestion` never imports the template catalog and never
 *     returns 'unmappable' -- Task 6 combines this function's 3-verdict
 *     result with `matchQuestionToTemplate`'s null/non-null result to get
 *     the full 4-way decline surface.
 *
 * KNOWN LIMITATIONS (deliberately not pattern-matched, to avoid over-block
 * regressions on ambiguous everyday phrasing that reads as much like
 * benign journaling as like a medical question):
 *   - "when I don't take anything" (no medication noun/verb pair to anchor
 *     on -- "anything" is too generic to scope a pattern around without
 *     matching a huge swath of unrelated sentences).
 *   - "is my therapist making me worse" (bare "therapist" is common,
 *     legitimate journaling vocabulary on its own; only "therapy" combined
 *     with a should-I/vs-medication frame is currently in scope).
 *   Both fall through to 'ok' today. If real-world usage shows these are a
 *   meaningful gap, add narrowly-scoped patterns + fixtures rather than
 *   broadening the existing ones.
 */

import { checkCrisisKeywords, checkWarningIndicators } from '../safety/index.js';

// ---------------------------------------------------------------------------
// Medical / prescriptive pattern list
// ---------------------------------------------------------------------------
// Every pattern below is case-insensitive and word-boundary aware (`\b`) to
// avoid the "sick of meetings" false-positive class (e.g. bare "kill" from
// "killing my vibe" must not match "kill myself"-style crisis phrasing, and
// bare "treat"/"cure" must not match "treat myself"/"cured my boredom").
//
// Where a term is genuinely ambiguous even after scoping (e.g. "taper",
// "going off", bare "stop taking"), it is kept broad per the fail-closed
// posture -- these are documented here as *known, accepted* over-block
// surface, verified against the benign/canonical fixture set in
// questionGate.test.js rather than pre-weakened.

// A shared fragment of clinical condition names, used to SCOPE the
// diagnosis/cure/treat/should-I patterns so that everyday, non-clinical
// uses of the surrounding verbs ("treat myself", "cured my boredom", "fix
// my sleep schedule") do not trip the gate. Compound disorder names (e.g.
// "eating disorder") are additionally matched bare below, since those
// multi-word clinical terms are specific enough that benign non-clinical
// usage is rare.
const CONDITION_WORDS_SRC =
  'depression|bipolar(?:\\s+disorder)?|anxiety(?:\\s+disorder)?|adhd|add|bpd|ptsd|ocd|' +
  'schizophrenia|mania|manic|panic(?:\\s+disorder)?|insomnia|' +
  'an?\\s+eating\\s+disorder|a\\s+personality\\s+disorder';

// Dose-change verbs and dose-referring nouns, combined below via
// co-occurrence patterns (see "medication decision-verbs" section). Kept as
// named fragments so the verb list and noun list are each defined once and
// reused in both matching directions (verb-then-noun, noun-then-verb).
//
// Each verb alternative spells out only its real inflections (no bare
// "reduc"/"increas"/"rais" stems) so the group never matches a non-word
// fragment.
const DOSE_CHANGE_VERBS_SRC =
  '(?:cut(?:ting)?|halv(?:e|es|ing|ed)|lower(?:s|ing|ed)?|reduc(?:e|es|ing|ed)|' +
  'increas(?:e|es|ing|ed)|upping|rais(?:e|es|ing|ed))';

// "medicine" appears here (dose-noun co-occurrence path) but deliberately
// NOT in the unscoped drug-class list below -- bare "medicine" alone
// collides with "medicine-ball" (a common workout term: word-boundary
// regex treats the hyphen as a boundary, so `\bmedicine\b` matches inside
// "medicine-ball" too). Requiring a nearby dose-change verb keeps that
// benign case intact while still catching "reducing how much medicine I
// take" (see questionGate.test.js's DOSE_CHANGE_MEDICAL fixtures and the
// "medicine-ball" benign fixture that pins this exact boundary).
const DOSE_NOUNS_SRC = '(?:doses?|dosage|pills?|medications?|medicine|meds|prescriptions?)';

const MEDICAL_PATTERNS = [
  // --- medication / dosage -------------------------------------------------
  // Drug classes and generic prescription/medication language.
  // "prescription(s)"/"medication(s)"/bare "meds" are included here
  // (unscoped) -- specific enough in normal usage that the over-block risk
  // is low, and a bare mention of one's medication is exactly the kind of
  // content this tier exists to catch (e.g. "does skipping my meds affect
  // my mood?"). `anti[\s-]?depressants?` / `anti[\s-]?anxiety` cover the
  // spaced, hyphenated, and closed-up spellings uniformly ("anti
  // depressants", "anti-depressant", "antidepressants") instead of
  // enumerating each variant separately.
  /\b(ssris?|snris?|maois?|anti[\s-]?depressants?|anti[\s-]?anxiety|benzos?|benzodiazepines?|antipsychotics?|mood stabilizers?|stimulant medication|prescriptions?|medications?|meds)\b/i,

  // Common psychotropic brand/generic names. Specific proper nouns rarely
  // appear in non-medical journaling contexts.
  /\b(lithium|adderall|xanax|prozac|zoloft|lexapro|wellbutrin|celexa|paxil|effexor|cymbalta|ritalin|vyvanse|klonopin|ativan|seroquel|abilify|trazodone|buspar|buspirone|valium|concerta|strattera)\b/i,

  // Dosage / dose / mg-number forms. Numeric "20mg" forms are unscoped
  // (very low benign-idiom risk). Bare "dosage" is unscoped (rarely used
  // outside medical/technical contexts). "dose" alone IS scoped to a
  // medication object -- "a dose of reality" / "in small doses" are common
  // idioms that would otherwise over-block heavily.
  /\b\d+\s?(mg|milligrams?)\b/i,
  /\bdosage\b/i,
  /\bdose\s+(of\s+)?(my\s+)?(medication|medicine|meds?|pills?|prescriptions?)\b/i,

  // Medication decision-verbs from the brief's required phrase list. These
  // are deliberately broad (e.g. bare "stop taking", bare "taper", bare
  // "go(ing) off") per the fail-closed posture -- known over-block surface
  // ("going off the rails", "taper" as a rare standalone verb) is accepted
  // and verified not to appear in the benign/canonical fixture set.
  /\bstop(ping)?\s+taking\b/i,
  /\bstart(ing)?\s+taking\b/i,
  /\btaper(ing)?\b/i,
  /\bwean(ing)?\s+off\b/i,
  /\bgo(ing)?\s+off\b/i,

  // Dose-CHANGE verbs (cut/halve/lower/reduce/increase/up/raise) are, on
  // their own, ordinary general-purpose words ("increasing my exercise",
  // "cutting sugar from my diet", "lowering my screen time") -- unlike
  // "taper"/"wean off" above, they are NOT safe to leave unscoped. They
  // only signal a medication-decision question in combination with a
  // nearby dose-referring noun, checked in both word orders with a
  // short connector gap ("cutting my dose", "halved my pills", "lower
  // my dose", "reducing how much medicine I take").
  new RegExp(`\\b${DOSE_CHANGE_VERBS_SRC}\\b.{0,20}\\b${DOSE_NOUNS_SRC}\\b`, 'i'),
  new RegExp(`\\b${DOSE_NOUNS_SRC}\\b.{0,20}\\b${DOSE_CHANGE_VERBS_SRC}\\b`, 'i'),

  // --- diagnosis-seeking ----------------------------------------------------
  new RegExp(`\\bdo\\s+i\\s+have\\s+(?:${CONDITION_WORDS_SRC})\\b`, 'i'),
  // "am I ___" uses adjective forms (depressed, bipolar, manic, ...) rather
  // than CONDITION_WORDS_SRC's noun forms (depression, mania, ...) --
  // separate list on purpose.
  /\bam\s+i\s+(depressed|bipolar|manic|schizophrenic|autistic|adhd|anxious|ocd|ptsd|bpd)\b/i,
  /\bdiagnos(e|is|ed|ing)\b/i,
  // Bare compound clinical-disorder names (see CONDITION_WORDS_SRC comment).
  /\b(eating disorder|personality disorder|panic disorder|bipolar disorder|anxiety disorder)\b/i,

  // --- treatment / cure claims ----------------------------------------------
  // Scoped to a named condition so "treat myself" / "cured my boredom" /
  // "fix my sleep schedule" (no clinical condition word) stay benign.
  new RegExp(
    `\\b(cure|treat|fix)(s|d|ing)?\\s+(for\\s+)?(my\\s+)?(?:${CONDITION_WORDS_SRC})\\b`,
    'i'
  ),
  /\btherapy\s+(vs\.?|versus)\s+medication\b/i,
  /\bmedication\s+(vs\.?|versus)\s+therapy\b/i,

  // --- prescriptive-decision framing -----------------------------------------
  // "should I stop/start/switch/quit [taking] my meds/therapy/..." -- the
  // `.{0,20}` gap allows natural connectors ("switch from therapy to
  // medication") without requiring the keyword to sit immediately after
  // the verb.
  /\bshould\s+i\s+(stop|start|switch|quit)\b.{0,20}\b(meds?|medication|medicine|therapy|antidepressants?)\b/i,

  // --- self-harm-adjacent phrasings NOT already in CRISIS_KEYWORDS ----------
  // CRISIS_KEYWORDS matches the literal phrase "hurt myself" (and similar
  // fixed phrases) but not the progressive form ("hurting myself") or the
  // general nouns "self-harm"/"self-injury". These are genuine gaps for
  // experiment-framed text like "hurting myself less" -- caught here,
  // conservatively, at the medical tier (not forked into the crisis
  // regexes themselves, per the reuse contract).
  /\b(hurt|harm)(ing)?\s+myself\b/i,
  /\bself[\s-]?harm(ing)?\b/i,
  /\bself[\s-]?injur(e|y|ing)\b/i,
];

// ---------------------------------------------------------------------------
// Decline UX contract (data only -- Task 6 consumes this to render the
// decline surface). Copy matches the app's existing safety-copy tone: warm,
// direct, non-alarming, no red/urgent framing (see
// CrisisSoftBlockModal.jsx's "never red/alarming" convention), and for the
// medical tier specifically: non-clinical (does not itself diagnose),
// non-judgmental, and points to a professional plus a safer in-app
// alternative (Reflection Recipes) instead of just refusing outright.
// ---------------------------------------------------------------------------
export const DECLINE_CONTRACTS = Object.freeze({
  crisis: Object.freeze({
    surfaceSafetyPlan: true,
    copyKey: 'crisis',
    saferAlternative: null,
    copy:
      "This sounds like something heavier than a data question. Let's pause " +
      "the experiment and take a look at your safety plan instead -- your " +
      'wellbeing matters more than any pattern in the numbers.',
  }),
  medical: Object.freeze({
    surfaceSafetyPlan: false,
    copyKey: 'medical',
    saferAlternative: 'recipes',
    copy:
      "This touches on medication or diagnosis, and that's a conversation " +
      "for you and a doctor or therapist, not a self-tracked experiment -- " +
      "Engram can't safely measure it. A Reflection Recipe can still help " +
      'you process how it feels day to day.',
  }),
});

// ---------------------------------------------------------------------------
// screenQuestion
// ---------------------------------------------------------------------------

/**
 * Screen a free-text experiment question for safety before it is allowed to
 * become an experiment (or matched to a template).
 *
 * Pure function: no I/O, no randomness, deterministic for a given input.
 *
 * Verdict priority (fixed, tested): crisis > medical > ok. A crisis-tier hit
 * always wins even when the same text also matches a medical pattern (e.g.
 * "should I stop taking my antidepressants because I want to die?") --
 * surfacing the safety plan is what matters there, not a medication
 * disclaimer.
 *
 * Input contract: empty string, whitespace-only string, or any non-string
 * value (undefined/null/number/object/...) returns `{verdict:'ok'}`. This is
 * a deliberate choice, NOT a fail-closed gap: there is nothing to screen,
 * and the experiment-create form independently requires a non-empty
 * question before this gate is ever reached -- an empty/absent question
 * cannot itself become an unsafe experiment.
 *
 * Ambiguous text (a pattern only loosely matches) is resolved in favor of
 * declining ('medical') rather than passing -- fail-closed on ambiguity is
 * the PRD's explicit safety posture ("over-blocking acceptable, under-
 * blocking is not").
 *
 * @param {unknown} text - the free-text experiment question to screen.
 * @returns {{verdict: 'ok'} | {verdict: 'crisis'} | {verdict: 'medical'}}
 */
export function screenQuestion(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { verdict: 'ok' };
  }

  // Crisis tier: highest priority, reuses the real safety primitives.
  if (checkCrisisKeywords(text) || checkWarningIndicators(text)) {
    return { verdict: 'crisis' };
  }

  // Medical / prescriptive tier: new, conservative, experiment-specific
  // pattern list (see MEDICAL_PATTERNS above for per-group rationale).
  if (MEDICAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { verdict: 'medical' };
  }

  return { verdict: 'ok' };
}
