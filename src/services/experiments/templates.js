/**
 * Personal Experiments — v1 template catalog (R3 Task 3).
 *
 * PURE MODULE — no Firebase, no network, no randomness. This is the curated
 * set of question -> variable-pair templates decision 3 (plan) restricts v1
 * to: a user either picks a template or types a free-text question that gets
 * matched to one of these (never an arbitrary free-variable experiment).
 * Every variable here is PASSIVE (decision 2) — computed from data Engram
 * already captures (health context, environment context, entry tags, entry
 * mood) — there is no new check-in surface.
 *
 * Each template:
 *   {id, title, questionPatterns: RegExp[], exposure: {source, field, label},
 *    outcome: {field, label}, lag: 0|1, confounders: string[],
 *    whatThisDoesNotProve: string[]}
 *
 * `exposure.field` values are the REAL keys returned by
 * `extractHealthSignals`/`extractEnvironmentSignals`
 * (`src/services/health/healthFormatter.js`,
 * `src/services/environment/environmentFormatter.js`) — verified against
 * those modules' current output shape, not guessed. For the tag-presence
 * template, `exposure.field` is the raw entry field ('tags') the value comes
 * from; the specific tag to check presence of is supplied separately as
 * `params.tag` at match/build time (this template is parameterized by one of
 * the user's OWN existing tags, e.g. `@person:spencer`).
 *
 * `outcome` is fixed across every template: `{field: 'analysis.mood_score',
 * label: 'mood'}` — mirrors the field path already read throughout
 * `src/services/health/healthCorrelations.js` /
 * `src/services/environment/environmentCorrelations.js`
 * (`e.analysis?.mood_score`).
 *
 * `whatThisDoesNotProve` bullets are generated from the data-method spec's
 * verbatim "what this does not prove" block
 * (`docs/quality/experiments-data-method.md`, "Fixed strings" section) with
 * only the {exposure}/{outcome} slots filled per template — the sentence
 * structure itself is never re-typed or reworded (see
 * `whatThisDoesNotProveFor` below). The spec's non-causal-framing and
 * insufficiency/CI-spans-zero strings are NOT duplicated here — those are
 * template-INDEPENDENT and belong to Task 5's result-narrative module (the
 * spec explicitly assigns them to "a constants module alongside
 * estimator.js, added in Task 5").
 *
 * `confounders` are a per-template, hand-curated "plausible alternatives"
 * catalog (fixed strings) — the candidate explanations a result's narrative
 * offers alongside the estimate so a correlation is never presented without
 * competing, equally-plausible non-causal stories.
 */

// ---------------------------------------------------------------------------
// Shared fixed pieces
// ---------------------------------------------------------------------------

/**
 * Fixed outcome for every v1 template (decision: mood is the only outcome
 * variable in v1). `unit: 'mood_0_100'` (Michael review hardening, EX2 item
 * 1) is frozen onto every experiment's `analysisPlan.outcome` via
 * `experimentsService.buildAnalysisPlan`'s `{...template.outcome}` spread —
 * `computeResult.js` asserts this exact unit string before normalizing the
 * outcome series (mood_score is captured on a 0-1 scale; the display/
 * estimate scale is 0-100 "points") and fails closed
 * (`unknown_outcome_unit`) for anything else, including an absent unit on a
 * legacy plan. See `computeResult.js`'s module doc comment for the full
 * normalization rule.
 */
const MOOD_OUTCOME = Object.freeze({ field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' });

/**
 * Data-method spec's verbatim "what this does not prove" bullets
 * (docs/quality/experiments-data-method.md, "Fixed strings" section), with
 * the {exposure}/{outcome} slots filled per-template. The three bullets that
 * carry no slot are copied character-for-character from the spec — nothing
 * about their wording is re-authored per template.
 *
 * FOURTH BULLET (Michael review hardening, item 6 — "all attempts
 * preserved"): a cross-experiment multiplicity caveat, added here so it
 * renders on every result alongside the per-template caveats — a user who
 * runs several experiments is, structurally, running several chances for a
 * pattern to appear by chance alone; any ONE result is still just one
 * observation, not a verdict about "what's true" for them.
 */
function whatThisDoesNotProveFor(exposureLabel, outcomeLabel) {
  return [
    `This does not show that ${exposureLabel} caused the change in ${outcomeLabel}.`,
    'Other things that changed around the same time could explain some or all of this difference.',
    "Your own habits and days aren't a controlled experiment — this is a pattern in your own data, not a scientific study of what works for everyone.",
    'Running many experiments makes a chance pattern more likely somewhere; treat any single result as one observation, not a verdict.',
  ];
}

// ---------------------------------------------------------------------------
// Question-matching helpers (conservative keyword matching over
// questionPatterns; unmappable/ambiguous text always -> null in
// matchQuestionToTemplate, never a guess).
// ---------------------------------------------------------------------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a `(?:a|b|c)` alternation body from literal phrases (escaped). */
function altGroup(...phrases) {
  return phrases.map(escapeRegExp).join('|');
}

/**
 * A single case-insensitive RegExp that matches only when EVERY given
 * alt-group is present somewhere in the text (any order, via lookaheads) —
 * i.e. "mentions sleep AND mentions mood", not "mentions sleep OR mood".
 * This is deliberately conservative: a question mentioning only the
 * exposure term, or only mood, does not match.
 */
function requireAll(...altGroups) {
  const lookaheads = altGroups.map((g) => `(?=.*\\b(?:${g})\\b)`).join('');
  return new RegExp(lookaheads, 'i');
}

/** Same as requireAll, but additionally requires `excludeGroup` be ABSENT. */
function requireAllExcept(excludeGroup, ...altGroups) {
  const lookaheads = altGroups.map((g) => `(?=.*\\b(?:${g})\\b)`).join('');
  return new RegExp(`${lookaheads}(?!.*\\b(?:${excludeGroup})\\b)`, 'i');
}

const MOOD_ALT = altGroup('mood', 'moods', 'feel', 'feeling', 'feelings', 'emotion', 'emotional', 'emotions');
const SLEEP_ALT = altGroup('sleep', 'sleeping', 'slept');
const LAG1_ALT = altGroup(
  'next day',
  'the next day',
  'following day',
  'day after',
  'the day after',
  'tomorrow',
  'next morning',
);
const EXERCISE_ALT = altGroup('exercise', 'exercising', 'exercised', 'workout', 'workouts', 'working out', 'gym');
const SUNSHINE_ALT = altGroup('sunshine', 'sunny', 'sunlight', 'sun exposure', 'daylight');
const STEPS_ALT = altGroup('steps', 'step count', 'walk', 'walking', 'walked', 'walks');
const RECOVERY_ALT = altGroup('recovery');

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'sleep-hours-mood-same-day',
    title: 'How does my sleep move together with my mood?',
    questionPatterns: [requireAllExcept(LAG1_ALT, SLEEP_ALT, MOOD_ALT)],
    exposure: Object.freeze({ source: 'health', field: 'sleepHours', label: 'sleep hours' }),
    outcome: MOOD_OUTCOME,
    lag: 0,
    confounders: Object.freeze([
      'Stressful periods can reduce both sleep and mood.',
      'Weekends and weekdays often have different sleep and mood patterns on their own.',
      'Illness, travel, or big life events can affect both sleep and mood at the same time.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('sleep hours', 'mood')),
  }),
  Object.freeze({
    id: 'sleep-hours-mood-lag1',
    title: 'How does my sleep move together with my mood the next day?',
    questionPatterns: [requireAll(SLEEP_ALT, MOOD_ALT, LAG1_ALT)],
    exposure: Object.freeze({ source: 'health', field: 'sleepHours', label: 'sleep hours' }),
    outcome: MOOD_OUTCOME,
    lag: 1,
    confounders: Object.freeze([
      'Stressful periods can reduce both sleep and next-day mood.',
      'What happens the next day (plans, workload, social events) can affect mood regardless of the prior night\'s sleep.',
      'Illness, travel, or big life events can affect both sleep and mood across consecutive days.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('sleep hours', 'next-day mood')),
  }),
  Object.freeze({
    id: 'exercise-minutes-mood',
    title: 'How does exercise move together with my mood?',
    questionPatterns: [requireAll(EXERCISE_ALT, MOOD_ALT)],
    exposure: Object.freeze({ source: 'health', field: 'exerciseMinutes', label: 'exercise minutes' }),
    outcome: MOOD_OUTCOME,
    lag: 0,
    confounders: Object.freeze([
      'Feeling good may lead to more exercise, rather than exercise leading to feeling good.',
      'Social exercise (with friends, a class) can boost mood independent of the exercise itself.',
      'Weekends and time off can change both exercise time and mood together.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('exercise minutes', 'mood')),
  }),
  Object.freeze({
    id: 'sunshine-percent-mood',
    title: 'How does sunshine move together with my mood?',
    questionPatterns: [requireAll(SUNSHINE_ALT, MOOD_ALT)],
    exposure: Object.freeze({ source: 'environment', field: 'sunshinePercent', label: 'sunshine' }),
    outcome: MOOD_OUTCOME,
    lag: 0,
    confounders: Object.freeze([
      'Sunny days often come with more time outside, socializing, or activity — any of those could affect mood on their own.',
      'Season and weather patterns change together (temperature, daylight length), so sunshine may be standing in for something else.',
      'Weekends and holidays can cluster with certain weather patterns by chance.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('sunshine', 'mood')),
  }),
  Object.freeze({
    id: 'steps-mood',
    title: 'How do my steps move together with my mood?',
    questionPatterns: [requireAll(STEPS_ALT, MOOD_ALT)],
    exposure: Object.freeze({ source: 'health', field: 'steps', label: 'steps' }),
    outcome: MOOD_OUTCOME,
    lag: 0,
    confounders: Object.freeze([
      'Feeling good may lead to walking more, rather than walking more leading to feeling good.',
      'Busy or social days can drive both step count and mood together.',
      'Weather and time outdoors can affect both steps and mood independently.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('steps', 'mood')),
  }),
  Object.freeze({
    id: 'recovery-score-mood',
    title: 'How does my recovery score move together with my mood?',
    questionPatterns: [requireAll(RECOVERY_ALT, MOOD_ALT)],
    exposure: Object.freeze({ source: 'health', field: 'recoveryScore', label: 'recovery score' }),
    outcome: MOOD_OUTCOME,
    lag: 0,
    confounders: Object.freeze([
      'Stress, illness, or poor sleep can lower both recovery score and mood at the same time.',
      'Alcohol, travel, or big life events can affect both together.',
      'Training load and life stress often move together, affecting recovery and mood similarly.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('recovery score', 'mood')),
  }),
  Object.freeze({
    id: 'tag-presence-mood',
    // {tag} is filled in by the caller (Task 6 UI) with the user's chosen
    // tag's display value once matched/selected — this string is a fixed
    // template with one placeholder, not a per-instance narrative.
    title: 'How does {tag} move together with my mood?',
    // Matching for this template ALSO requires a concrete tag from the
    // caller's availableTags to appear in the text (see matchAvailableTag /
    // matchQuestionToTemplate below) — questionPatterns alone only checks
    // that the question is mood-shaped at all, which is necessary but not
    // sufficient for this template to match.
    questionPatterns: [requireAll(MOOD_ALT)],
    exposure: Object.freeze({ source: 'tags', field: 'tags', label: 'tag presence' }),
    outcome: MOOD_OUTCOME,
    // splitMode: 'binary' (Michael review hardening, EX1's H2 finding acted
    // on here per EX1's explicit recommendation to EX2): tag-presence
    // exposure is 0/1-coded (a day either carries the tag or doesn't), which
    // is exactly the tie-heavy shape that reliably trips the bootstrap's
    // `split_unstable` gate under the default MEDIAN split (every resample
    // draws from a pool that's roughly half 0s and half 1s, so a
    // per-resample median frequently lands exactly on a tied value).
    // `buildAnalysisPlan` (experimentsService.js) carries this field from
    // the template onto the frozen plan; every other v1 template omits it
    // and stays on the 'median' default (continuous exposure values don't
    // have this degeneracy).
    splitMode: 'binary',
    lag: 0,
    confounders: Object.freeze([
      'Other things happening on the same days this tag appears could explain the mood difference.',
      'The kind of day that leads you to write about this may itself be tied to mood, regardless of the topic.',
      'Weekends, routines, or seasons could coincide with when this tag appears.',
    ]),
    whatThisDoesNotProve: Object.freeze(whatThisDoesNotProveFor('this tag being present', 'mood')),
  }),
]);

/** @returns {object|undefined} the template with the given id, or undefined. */
export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Tag matching (tag-presence template)
// ---------------------------------------------------------------------------

/** Extract the display value from a `@category:value` tag (or the bare string if there's no colon). */
function tagDisplayValue(tag) {
  if (typeof tag !== 'string') return '';
  const idx = tag.lastIndexOf(':');
  const raw = idx >= 0 ? tag.slice(idx + 1) : tag.replace(/^@/, '');
  return raw.trim();
}

/**
 * Find the first tag in `availableTags` whose display value appears (as a
 * whole word, case-insensitive) in `normalizedText`. Returns the ORIGINAL
 * tag string (e.g. `@person:spencer`), or null. Tag values shorter than 2
 * characters are skipped (too likely to false-positive on ordinary words).
 */
function matchAvailableTag(normalizedText, availableTags) {
  if (!Array.isArray(availableTags)) return null;
  for (const tag of availableTags) {
    const value = tagDisplayValue(tag);
    if (value.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i');
    if (re.test(normalizedText)) return tag;
  }
  return null;
}

// ---------------------------------------------------------------------------
// matchQuestionToTemplate
// ---------------------------------------------------------------------------

/**
 * Conservative keyword match of free-text `text` against the template
 * catalog. Returns `{template, params}` on an UNAMBIGUOUS single match, or
 * `null` when the text matches zero templates (unmappable) OR more than one
 * (ambiguous — e.g. mentions both sleep and exercise). Never guesses.
 *
 * @param {string} text
 * @param {string[]} [availableTags] - the user's existing tags (e.g.
 *   `['@person:spencer', '@pet:sterling']`), needed only for the
 *   tag-presence template.
 * @returns {{template: object, params: {tag: string}|null} | null}
 */
export function matchQuestionToTemplate(text, availableTags = []) {
  if (typeof text !== 'string') return null;
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return null;

  const candidates = [];

  for (const template of TEMPLATES) {
    if (template.exposure.source === 'tags') continue; // handled below (parameterized)
    if (template.questionPatterns.some((re) => re.test(normalized))) {
      candidates.push({ template, params: null });
    }
  }

  const tagTemplate = getTemplateById('tag-presence-mood');
  const matchedTag = matchAvailableTag(normalized, availableTags);
  if (matchedTag && tagTemplate.questionPatterns.some((re) => re.test(normalized))) {
    candidates.push({ template: tagTemplate, params: { tag: matchedTag } });
  }

  if (candidates.length !== 1) return null;
  return candidates[0];
}

export default {
  TEMPLATES,
  getTemplateById,
  matchQuestionToTemplate,
};
