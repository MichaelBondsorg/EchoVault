# Personal Experiments — data-method spec

Covers R3 Task 1
(`docs/superpowers/plans/2026-07-22-r3-personal-experiments.md`) AND Task EX1
of Michael's statistical review hardening
(`docs/superpowers/plans/2026-07-22-michael-review-hardening.md`). Personal
Experiments lets a user run a 14/28-day observational "experiment" over data
Engram already passively captures (e.g. "does sleep affect my mood?"),
behind flag `personalExperiments` (`src/config/flags.js`, default `false`).

**This memo BLOCKS the flag flip.** `personalExperiments` stays `false` in
`config/flags` until Michael reads this memo and signs off at the bottom.
Nothing in this task changes that default — the estimator and this spec ship
with the flag OFF, exactly like `gentleRevisit` before it
(`docs/quality/gentle-revisit-safety.md`).

**2026-07-22 update (Task EX1):** Michael's direct statistical review of the
R3 estimator found the v1 median-split/bootstrap design too permissive on
small or lopsided groups, silent about several of its own assumptions, and
missing a few fields a result screen needs to be honest about its own
fragility. Task EX1 hardens `estimator.js` (group-size guards, a binary
present/absent split mode, a per-resample split in the bootstrap, and a
leave-one-day-out stability check) and corrects this memo's own wording in
several places. **Every threshold/method change below RE-GATES the sign-off
at the bottom of this document** — the checkbox is reset to unchecked by this
update, independent of whatever state it was in before, per this memo's own
"any change to these numbers comes back through this same process" rule (see
the "Note on default #1/#2 thresholds" section).

## Why this needs a memo before it needs a flag

Correlation-shaped output in a mental-health app is a well-known trap:
"your mood is X% higher on days you sleep more" reads, to most people, as a
causal claim even when the word "correlation" appears somewhere in the
sentence. The PRD's own launch gate is a comprehension bar ("80% of users
interpret a result as association, not proof of cause") — a bar the code
cannot self-certify. This document exists to make every statistical choice
that shapes what gets shown to the user explicit, reviewable, and revisable
by a human before any user can hit the feature, mirroring the structure
gentle-revisit-safety.md established for a different (but related) safety
gate.

Every rule below is enforced in `src/services/experiments/estimator.js`, a
pure function module with 100% rule coverage in
`src/services/experiments/__tests__/estimator.test.js`.

## The 8 defaults

| # | Default | Rationale |
|---|---------|-----------|
| 1 | **Minimum paired observations: ≥10.** Both variables must be present on the same calendar day (lag 0), or on exposure-day + outcome-day for lag-1 templates. Below 10 paired days → insufficiency, no estimate at all. | Below ~10 points, a mean-difference estimate is dominated by noise and a bootstrap CI is wide enough to be nearly meaningless while still LOOKING like a number with a confidence interval attached — which is worse than no number, because a wide-but-present CI still reads as "the app computed something." 10 is a conservative, easy-to-explain round number, not derived from a power calculation (no clinical-trial-grade design here); it is explicitly flagged as revisable below. |
| 2 | **Missingness: each variable must cover ≥50% of the experiment's elapsed days.** Reported per-variable as "N of M days" (`computeCoverage`). Below 50% on either variable → insufficiency, regardless of paired-observation count. | A user could clear the ≥10-pairs bar with, say, 10 paired days out of 60 elapsed (17% coverage) if they journaled sporadically — that's a biased, non-representative sample of their own life, not "the last N weeks." Coverage is a *separate* gate from pair count specifically so a technically-sufficient-but-unrepresentative window still gets caught. 50% is conservative and, again, explicitly revisable. **Correction (Task EX1, 2026-07-22):** this floor measures **completeness**, not **representativeness** — see "Coverage measures completeness, not representativeness" below for the distinction and why it matters. |
| 3 | **Estimator: median split on the exposure variable → difference in mean outcome (high group vs low group), with a 95% bootstrap CI (2,000 resamples, deterministic/seeded).** Pearson r is computed as a supplementary internal field on the estimate object but is NEVER the headline number and is never shown as the primary result. | A median-split mean-difference ("on days with more sleep than your typical night, your mood averaged X points higher") is far easier for a layperson to read correctly than a correlation coefficient, and it's harder to over-claim from ("8 points higher, uncertain by ±Y" reads as an observed difference; "r = 0.34" reads, to most non-statisticians, as an opaque score that either "means something" or doesn't — it invites over- or under-interpretation in both directions). 2,000 resamples is a conventional bootstrap size (comfortably past the point of diminishing returns for 95% CI stability) and is cheap to run client-side. The RNG is seeded and deterministic — **no `Math.random()` anywhere in the module, including its defaults** — specifically so `computeResult` (Task 5) is a pure, re-runnable function of `(experiment, entries)`: rerunning after the user excludes one observation must not also silently reshuffle the CI for unrelated reasons. **Correction (Task EX1, 2026-07-22):** the original text here claimed the bootstrap "makes no distributional assumption about mood scores" — that overstated it. See "What the bootstrap actually assumes" below for the corrected, honest list of assumptions this CI depends on. |
| 4 | **No outlier removal in v1.** Outcome means are reported as-is; the CI carries whatever spread the data has. Winsorization/trimming is explicitly deferred, not forgotten. | The median split already makes the *exposure* side rank-robust (a single extreme sleep-hours value can only ever move that one day between the high/low groups, never distort the split point the way an extreme value distorts a mean-based split). On the *outcome* side, silently dropping or capping "outlier" mood scores in a mental-health app is its own hazard — a very bad day is not noise to be cleaned away, it's exactly the kind of data point a correlation-safety review should be uncomfortable auto-discarding without a human decision about criteria. v1's choice is therefore to do nothing and let the CI honestly reflect the spread (a wide CI is the correct, visible consequence of high variance, not a bug to be engineered away). |
| 5 | **Uncertainty display: the CI is always shown in plain language. A CI that spans zero renders as "no clear association" — never "no effect."** | "No effect" is itself a causal-sounding claim (it implies the study measured an effect and found none). "No clear association" accurately describes what a CI spanning zero means for an observational mean-difference: the data doesn't rule out zero difference, not that we've established there IS no difference. This wording is copy-frozen below (see "Fixed strings") specifically so Task 5/6 cannot drift from it under normal editing. |
| 6 | **Lag structure is pre-declared per template** (same-day or next-day/lag-1), frozen as part of the experiment's `analysisPlan` at creation time. `runAnalysisPlan` enforces this at the estimator layer too: when `plan.lag` is supplied, every pair's actual `(outcomeDateKey − dateKey)` gap must match it exactly, or the whole result fails closed as `insufficient`/`lag_mismatch` — never silently computes an estimate under the wrong lag. | Choosing the lag *after* seeing the data (e.g. trying same-day, then lag-1, then picking whichever "worked better") is a classic multiple-comparisons/p-hacking pattern even in a non-p-value framework — trying several lags and reporting the most flattering one manufactures the appearance of a stronger association than the data supports. Pre-declaring the lag per template (Task 3's template catalog) and freezing it into the experiment doc (Task 2's plan-freeze rules) removes the researcher-degrees-of-freedom problem structurally, not by asking anyone to self-restrain. The estimator-layer check is a second, independent backstop: if a future caller ever constructs `pairs` some other way (bypassing `pairObservations`) and passes a stale or mismatched `plan.lag`, the result must not come back looking like a normal, trustworthy estimate — a methodologically wrong number that LOOKS plausible is worse than an insufficiency state, so this fails closed rather than silently computing anyway. |
| 7 | **One experiment = one variable pair = one pre-declared estimate. No secondary or spliced analyses on the result screen.** | Same rationale as #6, generalized: every additional analysis run on the same data and silently offered to the user (a different split point, a different confounder cut, a different date range) is another opportunity to cherry-pick the most interesting-looking result. `runAnalysisPlan` takes one frozen plan and produces one estimate; there is no code path that runs multiple plans against one experiment and surfaces the best one. |
| 8 | **Fixed non-causal wording is frozen below, verbatim, for Task 5's templates to import (not re-type).** | Making the non-causal-wording acceptance criterion structural (frozen strings, imported not authored per-template) rather than a discipline every future template author has to remember independently. This mirrors R2's Session Prep safety posture (fixed exclusion behavior, not a per-call-site judgment call). |

### Note on default #1/#2 thresholds

Both `MIN_PAIRED_OBSERVATIONS = 10` and `COVERAGE_FLOOR = 0.5` are **v1
conservative defaults**, not derived from a formal power analysis or user
research — this is the PRD's open question ("what minimum
observations/missingness/effect-size display per template should gate a
result") being answered here as a starting point, explicitly flagged as
revisable. If real usage shows 10 pairs / 50% coverage is too strict
(experiments routinely landing in insufficiency for engaged users) or too
loose (10-pair estimates reading as more confident than the CI width
justifies), that's a "revisit if" case for `PROJECT_STATUS.md`, not a reason
to silently loosen the constants in code — any change to these two numbers
should come back through this same sign-off process, because it changes what
"a result" is allowed to mean.

## What the bootstrap actually assumes (correction, Task EX1)

The original version of this memo said the bootstrap CI "makes no
distributional assumption about mood scores." That's not accurate, and
Michael's review called it out directly. A nonparametric bootstrap avoids
assuming a *specific parametric family* (it doesn't assume mood scores are
normally distributed, for instance), but it is **not assumption-free**. The
assumptions that actually matter here:

- **Independence across days.** The bootstrap treats each paired observation
  as an independent draw. A person's mood and sleep are not independent
  day-to-day — yesterday's bad night plausibly predicts tonight's bad mood
  regardless of today's sleep, and mood/behavior both have real
  autocorrelation (good weeks, bad weeks). Treating 14-28 sequential days as
  14-28 independent samples understates the true uncertainty; the reported
  CI is narrower than it would be if the bootstrap accounted for
  day-to-day correlation.
- **Representativeness of the recorded window.** The bootstrap resamples
  from the days that got recorded, not from "this person's life in
  general." If certain kinds of days are systematically more or less likely
  to get journaled (see the coverage/MNAR note below), the bootstrap
  faithfully reproduces that same bias — it has no way to know the window it
  was given isn't representative.
- **The high/low split itself is data-dependent.** Task EX1's per-resample
  split (see below) makes the CI's resampling variance reflect this more
  honestly than the pre-EX1 fixed-split bootstrap did, but the split
  boundary is still estimated from the same data being analyzed, not fixed
  in advance.

**Serial-correlation caveat, spelled out:** because of the independence
assumption above, this CI should be read as narrower/more confident-looking
than a method that accounted for day-to-day autocorrelation would produce.
This is a real limitation, not a rounding error — for someone whose mood has
a strong weekly or event-driven rhythm, a naive bootstrap can make a
coincidental pattern look more statistically solid than it is.

**Documented future work (not built in this task):** a **moving-block
bootstrap** — resampling contiguous blocks of consecutive days instead of
individual days — is the standard fix for serial correlation in a bootstrap
CI, and is the natural next step if usage data shows CIs are systematically
too narrow (e.g. via a future validation exercise, not something this task
attempts to build). It is called out here so it isn't "discovered" later as
if it were an oversight; it's a deliberate v1 scope cut.

## Coverage measures completeness, not representativeness

Default #2's ≥50% coverage floor answers one question: **"did we see enough
of the elapsed window to trust the pair count?"** It does NOT answer a
different, harder question: **"is the recorded subset of days representative
of this person's days in general?"** Those are not the same thing, and
conflating them is a mistake worth naming explicitly (Task EX1 correction).

**The honest caveat: journaling is very plausibly Missing Not At Random
(MNAR).** People are not equally likely to journal on every kind of day.
Someone might journal MORE on hard days (processing/venting) or LESS on hard
days (too depleted, too busy, avoidant) — and which pattern dominates likely
varies by person and even by period in their life. Either way, the
*mechanism* that determines which days get recorded is plausibly correlated
with the *outcome* itself (mood). A 100%-covered 14-day window could still be
a biased sample of "what this person's mood/sleep relationship generally
looks like" if, say, they only opened the app on days they were already
doing fine. Coverage cannot detect or correct for this — it can only tell you
the window itself wasn't sparse. This is exactly why default #7 (one
pre-declared estimate, never described as "your overall pattern") and the
non-causal fixed strings below stay in force regardless of how high coverage
is.

## Michael's statistical review hardening (Task EX1, 2026-07-22)

Direct owner review of the v1 estimator above. Enforced in `estimator.js`
with fixture-level coverage in `estimator.test.js`; see that test file for
exact hand-verified numbers.

| # | Hardening item | What changed | Rationale |
|---|-----------------|--------------|-----------|
| H1 | **Group-size guards.** Both split groups must have ≥`MIN_GROUP_SIZE` (5) paired observations (`group_too_small`), AND the smaller group must be ≥`MIN_GROUP_FRACTION` (25%) of the total (`groups_too_imbalanced`). Applies to BOTH split modes. | A result that clears default #1 (≥10 pairs total) can still hide a 9-vs-1 or 27-vs-3 split, where one side's mean is built from a handful of days — technically "an estimate," practically noise wearing a confidence interval. These are new, independent insufficiency reasons that ACCUMULATE with existing ones (same convention as `insufficient_paired_observations` + `degenerate_exposure_split` already stacking). |
| H1b | **Exposure-contrast guard.** `exposureContrast` (high-group mean exposure minus low-group mean exposure) must be strictly `> 0`, or `exposure_contrast_too_small`. `exposureContrast` is now always exposed on the estimate. | Pinned decision, spelled out because it's subtler than it looks: given how `medianSplit`/`binarySplit` are currently defined, every value in the high group is by construction greater than every low-group cutoff, so this specific check is **structurally unreachable** for a non-degenerate split — it can never actually fire today (verified by property-style tests in `estimator.test.js`). It is kept anyway as defense-in-depth (protects against a future split-mode change breaking this invariant silently) and because it guarantees `exposureContrast` is always a meaningful, guard-checked number for the UI/receipt to show. The REAL case Michael's review was pointing at — "the high and low days aren't *meaningfully* different exposures, even though they're technically on opposite sides of the median" (e.g. 5.0 vs 5.0000001 hours of sleep) — needs a **relative-magnitude** threshold, not an absolute-zero one, and no such threshold is invented here. This is an explicit, named spec-revisit candidate: a future relative-margin guard (e.g. "high mean must exceed low mean by at least X% of the exposure range") should come back through this same sign-off process, not be added ad hoc. |
| H2 | **Binary present/absent split mode.** `plan.splitMode: 'median' \| 'binary'`, default `'median'` (back-compat). Binary: HIGH = exposure > 0, LOW = exposure === 0, no median computed. `splitThreshold` is `null` in binary mode (not a fabricated `0`/`0.5` — see `binarySplit`'s docblock in `estimator.js`). Same guards as median mode. | Tag-presence and similar 0/1-coded exposures (e.g. "did I exercise at all") don't have a meaningful "median split" — journaling frequency, not a continuous quantity, decides where the median falls, and (see H3 below) a 0/1-coded variable is exactly the shape that makes a per-resample median split unstable. Binary mode gives these templates a split rule that matches what the data actually is. **Action item for EX2:** the `tag-presence-mood` template's frozen plan should very likely set `splitMode: 'binary'` — testing during this task found that binary-like exposure run through the DEFAULT median mode reliably trips the new `split_unstable` gate (H3) precisely because 0/1 data is maximally tie-heavy. This isn't a bug in either mode; it's binary-shaped data needing binary-mode, which is the entire reason this mode was added. |
| H3 | **Per-resample split.** The bootstrap now recomputes the high/low split WITHIN each of the 2,000 resamples (median-of-the-resample with ties→LOW, or binary re-bucketing), rather than holding the original split fixed for the whole bootstrap. | The pre-EX1 bootstrap held the split assignment fixed and only resampled outcome values within each fixed group — meaning the CI captured uncertainty in the group MEANS but not uncertainty in the SPLIT ITSELF. Recomputing the split per resample is the more honest bootstrap: if the split boundary is fragile (a few observations near the median could easily fall on either side), that fragility now shows up as wider resampling variance in the CI, instead of being hidden. |
| H3b | **Resample fallback policy (pinned judgment call — flagged for sign-off).** If a resample's own recomputed split is degenerate (one side empty), that resample falls back to drawing independently from the ORIGINAL split's two groups (the pre-EX1 bootstrap algorithm), using the same RNG stream. Every fallback is counted; `resampleFallbackCount` is exposed on the estimate. If `resampleFallbackCount / 2000 > 10%` (`RESAMPLE_FALLBACK_LIMIT`), the WHOLE result becomes insufficient (`split_unstable`) — no estimate is shown at all. | Two alternatives were explicitly rejected: (1) freezing a degenerate resample's delta at the ORIGINAL (unresampled) overall delta — this would silently narrow the CI by removing resampling variance exactly where the split is least trustworthy, which is dishonest; (2) skip-and-redraw a fresh resample until it isn't degenerate — this biases the CI toward whichever resamples happen to split cleanly, hiding instability rather than measuring it. The policy actually used still draws fresh randomness for the fallback resample (via the old fixed-group algorithm), so it contributes real resampling variance rather than a frozen number, and the fallback RATE itself becomes a diagnostic (`resampleFallbackCount`) rather than being silently absorbed. **This is a judgment call, not a derived result — flagged explicitly for Michael's sign-off reading**, alongside H1b, as the two items in this hardening pass with the most room for reasonable disagreement about the exact mechanism (as opposed to H1/H2/H4/H5, which are more straightforwardly "yes, gate on this"/"yes, expose this"). |
| H4 | **Leave-one-day-out (LOO) stability check.** For each paired observation, recompute the delta with that ONE observation excluded (cheap mean recomputation against the ORIGINAL split's group assignment, NOT a full re-split, and NOT a bootstrap — `n` recomputations total, not `n × 2000`). Exposed as `stability: {deltaMin, deltaMax, signConsistent}`. `signConsistent` is `false` if ANY leave-one-out delta lands on the opposite sign from another, OR exactly at zero (a delta of exactly 0 counts as a sign break, not a tie — see `estimator.js`'s `computeStability` docblock). No new insufficiency gate — this is diagnostic, not a blocker. | A result can pass every gate above and still be "one day's worth of data away from pointing the other direction" — the classic single-influential-point fragility a correlation-safety review should surface, not hide behind a confidence interval that (per the independence-assumption caveat above) may itself understate the true uncertainty. `signConsistent: false` is exactly the situation where a user should NOT walk away thinking "my sleep clearly helps my mood" even if the headline delta says so. **Final hardening review: this is now wired, not just planned.** `computeResult.js`'s `buildSummary` appends `STABILITY_CAVEAT_COPY` (see "Fixed strings" below) to `narrative.summary` whenever `status: 'ok'` and `signConsistent` is `false` — after every other clause, including the CI-spans-zero and small-effect clauses (both of which describe something different: "no clear direction" and "this direction wasn't stable" are independent observations about the same estimate, so neither suppresses the other). When `signConsistent` is `true`, nothing is appended to the narrative — `ExperimentResultView.jsx`'s "How this was computed" section covers the positive case with its own stability line (and shows the same caveat sentence again there, alongside `deltaMin`/`deltaMax`, when `signConsistent` is `false`). An insufficient result never reaches `buildSummary` at all, so it carries no stability copy of any kind. |
| H5 | **Practical significance threshold.** `SMALL_EFFECT_DELTA = 5`, exported from `estimator.js` as the single source of truth, but DISPLAY-SCALE (points on the 0-100 mood/outcome scale EX2 introduces at the series boundary) — `estimator.js` itself never compares `delta` to this constant; it stays unit-agnostic. | A statistically "clear" result (CI doesn't span zero, split is stable) can still be a practically tiny difference (e.g. 1.2 points on a 0-100 scale) that isn't worth a user reorganizing their life around. Classification is EX2's job (delta was already on the estimate); this task's job is making sure there's exactly one place the number `5` lives, so the UI, the narrative copy, and any future consumer read the same threshold rather than three slightly-different hardcoded `5`s drifting apart over time. |

**Negative-exposure pin (EX2, Minor review fix):** in binary split mode, an
exposure value `<= 0` (not just `=== 0`) resolves to LOW, mirroring the
"absent" treatment exactly — no current template produces a negative
exposure, but the rule is now a stated, documented policy rather than
implicit in `binarySplit`'s code shape alone.

**New estimate fields (item 6):** every `status: 'ok'` estimate now also
carries `nHigh`, `nLow`, `splitThreshold` (the median value used, or `null`
in binary mode), `exposureContrast`, `resampleFallbackCount`, and
`stability: {deltaMin, deltaMax, signConsistent}`, alongside the pre-EX1
fields (`meanHigh`, `meanLow`, `delta`, `ci`, `n`, `pearsonR`). **New
machine-readable insufficiency reasons:** `group_too_small`,
`groups_too_imbalanced`, `exposure_contrast_too_small` (structurally
unreachable today, kept as defense-in-depth — see H1b), `split_unstable`.
All reasons continue to ACCUMULATE in the same `reasons` array (existing
convention), except `split_unstable`, which is only discoverable after the
full bootstrap has run (i.e. after every other gate already passed) and so
is always reported alone.

## Known limitations (revisit list)

Small, deliberately-not-fixed-here gaps, called out so they don't get
rediscovered as surprises later:

- **Zero-sleep nights currently drop as missing, not as a known zero.**
  `src/services/health/healthFormatter.js`'s `extractHealthSignals` reads
  `sleepHours: healthContext.sleep?.totalHours || null` — a genuine
  zero-hours night is indistinguishable from "no sleep data recorded at
  all" and is dropped from the sleep-hours templates' day-series, exactly
  the same coercion bug the known-zero fix (see
  `computeResult.js`'s `exposureValueForEntry`) already fixed for
  `exerciseMinutes`/`steps`. It was not extended to `sleepHours` in this
  task — revisit alongside any future sleep-template calibration or a
  `healthFormatter.js` change, since `extractHealthSignals` has other
  consumers this module deliberately did not touch.

## Estimator implementation notes (for reviewers of the code, not just this doc)

- **Pairing** (`pairObservations`) drops non-finite/missing values (NaN,
  null, undefined, Infinity) from EITHER series rather than coercing them to
  0. This is a deliberate departure from the three existing Pearson
  implementations in this codebase (`src/utils/statistics.js`,
  `src/services/basicInsights/utils/statisticalHelpers.js`,
  `src/services/health/healthMoodCorrelation.js`), which are untouched by
  this task but share a defect worth naming: insufficient/missing data
  silently becomes a magic `0` or `null` correlation, indistinguishable from
  "we computed this and it's genuinely zero." This estimator instead returns
  a structured `{status: 'insufficient', reasons: [...]}` object whenever it
  can't produce a real estimate — there is no code path that returns a
  numeric estimate built from coerced-to-zero inputs.
- **Median-split tie rule:** values exactly equal to the computed median go
  to the LOW group. The direction is an arbitrary but fixed, documented, and
  tested choice (`estimator.js`'s `medianSplit`) — what matters for
  reproducibility is that it never varies run to run, not which side it
  picked.
- **Degenerate split:** if every paired exposure value is identical (or
  otherwise produces an empty high or low group), the median split cannot
  produce two groups to compare. This returns
  `{status: 'insufficient', reasons: ['degenerate_exposure_split']}` —  a
  distinct reason from `insufficient_paired_observations`, and both can
  appear together in the same `reasons` array when both conditions hold.
  This is checked independently of the ≥10-pair threshold (a data set with,
  say, 20 identical-value days still fails this check even though it clears
  default #1 on count alone).
- **Bootstrap (Task EX1: per-resample split):** a nonparametric bootstrap
  for the difference in group means, with the high/low split **recomputed
  within each resample** rather than held fixed for the whole bootstrap (the
  pre-EX1 behavior). Each of the 2,000 resamples draws `n` pairs with
  replacement from the full pool, re-splits that resample (median-of-the-
  resample with ties→LOW, or binary re-bucketing), and computes
  `meanHigh - meanLow` for that resample's own split. If a resample's split
  is degenerate (one side empty), it falls back to the pre-EX1 algorithm
  (independent draws from the ORIGINAL split's two groups) — see "Michael's
  statistical review hardening" above (H3/H3b) for the full fallback
  rationale and the `split_unstable` gate this produces. The 95% CI is the
  [2.5th, 97.5th] percentile of the resulting 2,000 deltas (nearest-rank
  method — no interpolation ambiguity), unchanged from v1. The RNG is
  `mulberry32`, a small deterministic PRNG seeded either by an explicit
  `seed` argument or, if omitted, by an FNV-1a hash of the pairs themselves
  — **never by `Math.random()` or `Date.now()`**, so "no seed passed" is
  still perfectly reproducible given the same pairs, and the fallback
  branch's extra draws consume the same deterministic rng stream (same
  seed ⇒ same fallback count, always).
- **Leave-one-day-out stability (Task EX1):** a cheap, non-bootstrap
  diagnostic — `n` mean recomputations (not `n × 2000`), one per paired
  observation, each excluding that single observation from whichever group
  it belongs to in the ORIGINAL split. Exposed as `stability`. See H4 above.
- **Order-independence (canonicalization):** `runAnalysisPlan` sorts its
  `pairs` input by `dateKey` then `outcomeDateKey` as the very first step,
  before the seed derivation or the bootstrap ever see it, and
  `pairObservations`'s output is sorted the same way for the same reason.
  This was NOT true in an earlier version of this module — hashing/
  resampling in caller-supplied order meant the same pairs reversed could
  produce a visibly different CI (caught in review before ship: reversing
  one 10-pair fixture changed the no-seed CI from `[18.33, 40.83]` to
  `[18.33, 41.67]`). Since Firestore does not guarantee document read
  order, an uncanonicalized implementation would have meant a rerun of the
  exact same experiment data could show the user a different number purely
  because of read ordering — a direct violation of the reproducibility
  claim this whole section makes. Regression-tested in `estimator.test.js`
  with both a reversed-array and an arbitrarily-shuffled-array fixture,
  with and without an explicit seed.

## Fixed strings (verbatim — Task 5 imports these, does not re-type them)

These strings are the load-bearing artifact of default #8. Task 5's result
templates must import them from wherever they end up living in code (a
constants module alongside `estimator.js`, added in Task 5) rather than
retyping equivalent-but-not-identical copy per template.

**Non-causal framing (appended to every `status: 'ok'` result, regardless of
template):**

> This is an association, not proof that one caused the other.

**"What this does not prove" (shown alongside every `status: 'ok'` result):**

> - This does not show that {exposure} caused the change in {outcome}.
> - Other things that changed around the same time could explain some or
>   all of this difference.
> - Your own habits and days aren't a controlled experiment — this is a
>   pattern in your own data, not a scientific study of what works for
>   everyone.
> - Running many experiments makes a chance pattern more likely somewhere;
>   treat any single result as one observation, not a verdict.

**ADDED 2026-07-22 (Michael review hardening, EX2 item 6 — "all attempts
preserved"):** the fourth bullet above is new. The experiments list already
kept every completed/insufficient result visible (no promote/hide
mechanism existed to remove this task) — this bullet adds the explicit
cross-experiment multiplicity caveat itself: a user who runs several
experiments is, structurally, running several chances for a pattern to
appear by chance alone in at least one of them, and no single result
should be read as "the" answer about them.

**Insufficiency (shown instead of any estimate whenever the estimator
returns `status: 'insufficient'`, never alongside a number):**

> There isn't enough data yet to say anything about this. Keep going, or
> check back once you have more days recorded.

**CI-spans-zero framing (shown when `ci[0] <= 0 <= ci[1]`, replacing the
"X points higher/lower" language for that result):**

> These recorded days are compatible with both higher and lower mood; no
> consistent direction appears.

**REPLACED 2026-07-22 (Task EX1, Michael's review):** the previous wording —
"The difference could be real or could be chance — this data doesn't show a
clear association either way." — is retired. The constant name Task 5/EX2
imports stays the same (`CI_SPANS_ZERO_COPY` in `computeResult.js`); only its
VALUE changes. **Action item for EX2:** update `CI_SPANS_ZERO_COPY`'s string
literal in `computeResult.js` to the new wording above — `estimator.js` does
not own this constant (it lives in Task 5's module), so this spec update is
the authoritative source EX2 must match; it is not yet reflected in code as
of this task.

**Small-effect framing (Task EX1, item 5 — shown alongside a result whose
`|delta|` is under `SMALL_EFFECT_DELTA` on the 0-100 display scale, in
addition to, not instead of, the CI-spans-zero or headline-number copy):**

> This difference is small — worth noticing, not worth reorganizing your
> life around.

**Stability caveat (final hardening review, H4 wiring — shown alongside any
`status: 'ok'` result whose `estimate.stability.signConsistent` is `false`,
in addition to whatever other clause already applies — CI-spans-zero or
small-effect included, since this describes something neither of those
already say):**

> This direction was not consistent — removing a single day could flip it,
> so hold this result especially lightly.

The constant `STABILITY_CAVEAT_COPY` (`computeResult.js`) is the single
source of truth for this string; `ExperimentResultView.jsx`'s "How this was
computed" section reuses the same constant for its own stability line when
`signConsistent` is `false`, rather than re-typing an equivalent sentence.

Template-specific slotting (exposure/outcome labels, the actual numbers) is
Task 5's concern; the sentences above are the fixed scaffolding those
numbers get slotted into, and the wording itself does not vary per
template.

## Automated fixture set

`src/services/experiments/__tests__/estimator.test.js` is the authoritative
automated coverage for this spec (57 tests as of Task EX1, up from 34 — the
golden fixture was also changed from a 4/6 split to a 5/5 split so it still
clears the new group-size guards; see the file's own comment for the
recomputed arithmetic). Relevant to this memo:

- **Golden fixture, hand-computed arithmetic in comments** — a 10-pair
  fixture (exactly at `MIN_PAIRED_OBSERVATIONS`) where `outcome = exposure *
  10` exactly, so the median, the high/low split, both group means, the
  delta, and the Pearson r (exactly 1, by construction) are all verifiable
  by hand from the comment above the fixture, not just trusted from the
  code under test.
- **Threshold boundaries exercised at the exact edge:** 9 paired
  observations → `insufficient` (`insufficient_paired_observations`); 10 →
  `ok`. Coverage at exactly 50% (5 of 10 elapsed days) → passes the floor;
  49.9%-equivalent (4 of 10) → fails.
- **Lag-1 pairing correctness at calendar edge cases:** month boundary (Jan
  31 → Feb 1), year boundary (Dec 31 → Jan 1), and a non-leap-year Feb
  boundary (Feb 28 → Mar 1, 2026) — all via UTC epoch-ms arithmetic so the
  pairing is independent of the host machine's timezone.
- **Determinism:** the same `(pairs, seed)` produces byte-identical CI
  bounds across repeated calls; different seeds produce different CI
  bounds; omitting `seed` entirely still reproduces identically across
  calls (seed derivation from the pairs themselves, not from time or
  randomness).
- **Dropped-not-coerced values:** NaN, `undefined`, `null`, and `Infinity`
  on either the exposure or outcome side are excluded from pairing and
  coverage counts, never treated as 0.
- **Median-tie pinning:** a 13-point fixture with three values tied
  exactly at the median asserts those three land in the LOW group (verified
  via exact hand-computed group means, not just group sizes) — this fixture
  doubles as an exactly-`nHigh=5` group-size boundary case (Task EX1).
- **Degenerate/empty inputs:** all-identical exposure values (a valid
  10-pair data set that still cannot be split) returns
  `insufficient`/`degenerate_exposure_split` rather than crashing or
  producing a NaN-laced CI; zero pairs likewise fails gracefully; a
  fixture violating both thresholds at once asserts BOTH reasons appear in
  the same `reasons` array.
- **CI-spans-zero support:** a fixture with equal high/low group means (by
  construction) and real within-group spread asserts the returned `ci`
  bounds straddle zero — proving the estimate object carries what a caller
  needs to apply the CI-spans-zero copy rule (default #5), even though the
  actual "no clear association" classification and rendering is Task 5/6's
  concern, not this module's.
- **Order-independence:** the same 10-pair fixture, reversed (no explicit
  seed) and arbitrarily shuffled (explicit seed), each asserted to produce
  a `toEqual`-identical `estimate` object — including the CI — to the
  forward-order run. This is the regression test for the reordering bug
  described in "Estimator implementation notes" above.
- **Lag-consistency (default #6):** a matching-lag fixture does not raise
  `lag_mismatch`; a full-size (10-pair) matching-lag fixture reaches `ok`;
  a fixture with one pair's `outcomeDateKey` hand-corrupted to violate the
  declared lag fails closed with `lag_mismatch` and no `estimate`; a
  fixture with `plan.lag` entirely omitted skips the check even when a
  pair's gap would otherwise fail it (back-compat with the "plan is
  forward-compat, not required" contract).
- **Group-size guards (Task EX1, H1/H1b):** `group_too_small` and
  `groups_too_imbalanced` are each isolated in their own fixture (one guard
  fails, the other two provably pass), a combined fixture asserts both
  reasons accumulate together, and a degenerate-split fixture confirms the
  new guards are skipped (not double-counted) when one whole side is
  already empty. The exposure-contrast guard's structural unreachability is
  itself asserted directly: a fixture with a ~3.5e-7 exposure margin (and a
  binary-mode analog at 1e-9) still reaches `ok` with a positive
  `exposureContrast`, rather than trying to force a case that cannot occur
  given the current split definitions.
- **Binary split mode (Task EX1, H2):** a shared fixture where median and
  binary splits provably disagree (verified by different `nHigh`/`nLow` and
  `meanHigh`/`meanLow` between the two modes on the SAME data) proves
  `splitMode` really does select a different algorithm; separate fixtures
  cover binary-mode degeneracy (all-present, all-absent) and an
  unrecognized `splitMode` string falling back to median.
- **Per-resample split + fallback policy (Task EX1, H3/H3b):**
  `resampleFallbackCount` is asserted at 0 for a well-separated split, at an
  exact hand-verified nonzero count (89 of 2,000) for a moderately
  tie-heavy split that still reaches `ok`, and a highly tie-heavy (bimodal)
  fixture is asserted to trip `split_unstable`. The `> 10%` boundary
  comparison itself is verified directly via the exported constants
  (`RESAMPLE_FALLBACK_LIMIT * BOOTSTRAP_RESAMPLES === 200`; 200/2000 does
  NOT exceed the limit, 201/2000 does) rather than via a bootstrap draw
  hitting that exact count — real fixture-search across several tie-depth
  designs found the fallback rate transitions sharply with tie depth rather
  than varying smoothly, making an exact-200 real-world hit impractical to
  construct by hand (see `task-ex1-report.md` for the fixture designs
  tried). `resampleFallbackCount`'s own determinism (same seed ⇒ same
  count) is asserted separately.
- **Leave-one-day-out stability (Task EX1, H4):** a fully hand-verified
  sign-flip fixture (a single outlier day in one group; excluding it flips
  the sign of the recomputed delta) asserts `signConsistent: false`; the
  golden fixture asserts `signConsistent: true`; a boundary fixture
  confirms no division-by-zero risk at the smallest guard-passing group
  size (`nHigh = 5`, the minimum `MIN_GROUP_SIZE`).
- **`SMALL_EFFECT_DELTA` (Task EX1, H5):** asserted as a plain exported
  constant (`5`), and a dedicated fixture confirms `runAnalysisPlan` never
  compares `delta` against it internally — a small-delta `ok` result
  carries no special reason or status, by design (classification is EX2's
  job).

This is engineering-test coverage of the *rules as written* — it proves the
estimator does what this memo says it does. It is not a substitute for the
human judgment call the sign-off below is asking for, and it says nothing
about whether 10 pairs / 50% coverage / median-split-and-bootstrap is the
*right* statistical design for a mental-health app's users — that's exactly
what the sign-off is for.

## Michael's UI/pipeline review hardening (Task EX2, 2026-07-22)

Follow-on to Task EX1, applied in `computeResult.js`, `preflight.js`,
`experimentsService.js`, `templates.js`, and both experiments UI components.

| # | Item | What changed |
|---|------|--------------|
| 1 | **Mood normalization to 0-100.** `analysis.mood_score` is captured on a 0-1 scale; every estimate/CI/narrative number is on a 0-100 "points" scale. Normalization happens at the series-builder boundary (`computeResult.js`'s `normalizeMoodTo100`): a value `<= 1` is multiplied by 100; a value already `> 1` (defensive legacy) passes through unmultiplied; either way the result is clamped to `[0, 100]`. `analysisPlan.outcome.unit` is frozen to `'mood_0_100'` (`templates.js`'s `MOOD_OUTCOME`); `computeExperimentResult` asserts this exact unit before trusting the outcome series and fails the WHOLE result closed (`unknown_outcome_unit`, a single, unambiguous reason) for anything else, including an absent unit on a legacy plan. UI copy says "points (0-100)" everywhere a magnitude is shown. `SMALL_EFFECT_DELTA` (EX1, H5) is now wired: when the CI does not span zero and `\|delta\| < 5`, `SMALL_EFFECT_COPY` ("This difference is small — worth noticing, not worth reorganizing your life around.") is appended to the headline sentence. |
| 2 | **Local calendar days + frozen timezone.** `createExperiment`/`buildAnalysisPlan` freezes `analysisPlan.timezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone` at create time (fallback `'UTC'`). Series building, coverage, and pairing all derive dateKeys in THAT zone via `Intl`-parts helpers (`localDateKeyForMs`, no date library) — a 9pm-local entry that's already past UTC midnight now correctly lands on the LOCAL calendar day, not the UTC one. **Partial start day rule (pinned):** the experiment window is whole local calendar days starting the day AFTER `startAt` — day 1 is the first FULL local day; the calendar day `startAt` itself falls on is excluded ENTIRELY (never partially counted), since the experiment could have started at any time of that day. Coverage denominators are consistent with this window. `preflight.js` has no frozen plan yet, so it resolves the DEVICE's current timezone directly via the same helper — once an experiment is actually created, `buildAnalysisPlan` freezes that same device-resolved value, so preflight and the experiment it leads to agree on which zone's days they mean. Estimator lag arithmetic (shifting a dateKey string by N days) stays pure calendar-day math and is unchanged/tz-agnostic, per EX1. |
| 3 | **Result integrity (anti-cherry-picking).** The stored `result` field is now `{original, adjusted?, exclusionHistory}` — `writeResult` (first completion) writes `{original: result, exclusionHistory: []}`; `original` is NEVER overwritten again by anything in the client. A post-result exclusion toggle requires a reason (`EXCLUSION_REASONS`: `wrong_data`\|`wrong_date`\|`other`, chosen via a calm-copy dialog, `other` pairs with an optional free-text `note`) and appends `{dateKey, excluded, reason, at}` to `exclusionHistory` via the pure `buildAdjustedResultUpdate`, writing the recomputation to `adjusted` via the new `writeAdjustedResult` (only `result`/`updatedAt` touched — the experiment is already `completed`, a legal no-op transition). The UI labels an adjusted result "Modified after seeing the result", shows a collapsible history, and an always-available toggle to view the original. A legacy bare-shape `result` (pre-dating this wrapping — none in prod, flag OFF) is read as `{original: <bare>, adjusted: null, exclusionHistory: []}`. `excludedObservations` itself is UNCHANGED (still `list<string>` of dateKeys) — the reason/history live entirely inside `result`, which the rules already treat as an opaque map with no further shape constraint. `computeExperimentResult` itself is unchanged in output shape — this wrapping is a storage/UI-layer concern only. |
| 4 | **Missing tags = unknown.** A day contributes to a tag-presence series only when the entry carries an EXPLICIT `tags` array (`Array.isArray(entry.tags)`). A missing `tags` field (legacy entry, or analysis that never completed) is now DROPPED as unknown/missing, never counted as a known "tag absent" (0) day — reversing the pre-EX2 behavior, which silently manufactured false absences out of entries that were never actually screened for the tag. The tag-presence template's frozen plan also declares `splitMode: 'binary'` (per EX1's H2 finding: 0/1-coded exposure reliably destabilizes the default median-split bootstrap). |
| 5 | **Sensitive-day disclosure.** `result.sensitiveObservationCount` (present on both `ok` and `insufficient` results) counts paired days with at least one contributing `safety_flagged`/`has_warning_indicators` entry. When `> 0`, the UI discloses the count ("N sensitive days contributed to the statistics; details are hidden.") and the observation table renders those rows as "Sensitive day — details hidden" (dateKey visible, no exposure/outcome numbers, Exclude/Include toggle still available — the user may exclude their own sensitive day). `receipt.sources` continues to exclude these entries entirely (unchanged invariant). |
| 6 | **All attempts preserved.** The experiments list already showed every completed/insufficient result (no promote/hide mechanism existed to remove). A 4th, fixed "what this does not prove" bullet was added to every template: "Running many experiments makes a chance pattern more likely somewhere; treat any single result as one observation, not a verdict." |
| 7 | **Co-movement copy.** Every template's `title` is reframed from causal ("Does X affect my mood?") to co-movement ("How does X move together with my mood?") phrasing — `questionPatterns` (keyword-based, not exact-phrase) match BOTH the old causal and new co-movement phrasings unchanged, since both mention the same exposure/mood keywords; matching is not endorsement of either framing. `CI_SPANS_ZERO_COPY`'s string literal (constant name unchanged, per EX1's instruction) is updated to the spec's new wording below. `ExperimentsScreen.jsx`'s tag-ask composed question/button label are also de-causalized. |

## Sign-off

`personalExperiments` stays `false` in `config/flags` until this line is
checked by Michael, after reading this memo (including the "Note on default
#1/#2 thresholds" section above) and deciding this is an acceptable v1 data
method — for the estimator AND for what gets shown to users when a result
comes back:

- [ ] **Michael has read this memo and approves flipping
      `personalExperiments` on for internal testing.** (Unchecked = flag
      stays off. This checkbox is not self-certifying — an agent must never
      check this box on Michael's behalf.)

**2026-07-22 (Task EX2) re-gate note (supersedes/extends the EX1 note
below):** EX2's changes are launch-blocker-grade, not cosmetic — the 0-1 ->
0-100 mood normalization directly fixes the "deltas rendered as 'points'
read 100x too small" launch blocker, and the local-day/timezone,
result-integrity, missing-tags, and sensitive-day-disclosure changes each
alter what a user is actually shown. Every reason EX1's re-gate note below
already applies (new method, no prior approval to revoke) applies again
here, compounded.

**2026-07-22 (Task EX1) re-gate note:** this checkbox was already unchecked
before this task (the flag has never shipped on), so there is no prior
approval being revoked here — but this note exists so the reason is explicit
either way: this task changed enough of the underlying method (new
insufficiency gates, a new split mode, a materially different bootstrap
algorithm, two new judgment calls flagged above as H1b and H3b) that even if
sign-off HAD already happened, it would need to happen again before the flag
could flip. Two items in particular are worth Michael's deliberate attention
on the next read, beyond the general "does this look right": **H1b**
(the exposure-contrast guard is currently unreachable in practice — is that
acceptable, or does a relative-margin guard need to be built before launch?)
and **H3b** (the resample-fallback policy — is falling back to the old
fixed-group bootstrap algorithm, rather than some other treatment, the right
call for a degenerate resample?).

Date reviewed: ______________  Notes: ______________
