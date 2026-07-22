# Personal Experiments — data-method spec

Covers R3 Task 1
(`docs/superpowers/plans/2026-07-22-r3-personal-experiments.md`). Personal
Experiments lets a user run a 14/28-day observational "experiment" over data
Engram already passively captures (e.g. "does sleep affect my mood?"),
behind flag `personalExperiments` (`src/config/flags.js`, default `false`).

**This memo BLOCKS the flag flip.** `personalExperiments` stays `false` in
`config/flags` until Michael reads this memo and signs off at the bottom.
Nothing in this task changes that default — the estimator and this spec ship
with the flag OFF, exactly like `gentleRevisit` before it
(`docs/quality/gentle-revisit-safety.md`).

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
| 2 | **Missingness: each variable must cover ≥50% of the experiment's elapsed days.** Reported per-variable as "N of M days" (`computeCoverage`). Below 50% on either variable → insufficiency, regardless of paired-observation count. | A user could clear the ≥10-pairs bar with, say, 10 paired days out of 60 elapsed (17% coverage) if they journaled sporadically — that's a biased, non-representative sample of their own life, not "the last N weeks." Coverage is a *separate* gate from pair count specifically so a technically-sufficient-but-unrepresentative window still gets caught. 50% is conservative and, again, explicitly revisable. |
| 3 | **Estimator: median split on the exposure variable → difference in mean outcome (high group vs low group), with a 95% bootstrap CI (2,000 resamples, deterministic/seeded).** Pearson r is computed as a supplementary internal field on the estimate object but is NEVER the headline number and is never shown as the primary result. | A median-split mean-difference ("on days with more sleep than your typical night, your mood averaged X points higher") is far easier for a layperson to read correctly than a correlation coefficient, and it's harder to over-claim from ("8 points higher, uncertain by ±Y" reads as an observed difference; "r = 0.34" reads, to most non-statisticians, as an opaque score that either "means something" or doesn't — it invites over- or under-interpretation in both directions). The bootstrap CI (rather than a normal-theory CI) makes no distributional assumption about mood scores, which is appropriate for a bounded, often skewed variable. 2,000 resamples is a conventional bootstrap size (comfortably past the point of diminishing returns for 95% CI stability) and is cheap to run client-side. The RNG is seeded and deterministic — **no `Math.random()` anywhere in the module, including its defaults** — specifically so `computeResult` (Task 5) is a pure, re-runnable function of `(experiment, entries)`: rerunning after the user excludes one observation must not also silently reshuffle the CI for unrelated reasons. |
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
- **Bootstrap:** a nonparametric two-sample bootstrap for the difference in
  group means. The median-split group assignment is held fixed for the
  whole bootstrap; each of the 2,000 resamples independently draws (with
  replacement) `nHigh` values from the high group's outcomes and `nLow`
  values from the low group's outcomes, computes `meanHigh - meanLow` for
  that resample, and the 95% CI is the [2.5th, 97.5th] percentile of the
  resulting 2,000 deltas (nearest-rank method — no interpolation
  ambiguity). The RNG is `mulberry32`, a small deterministic PRNG seeded
  either by an explicit `seed` argument or, if omitted, by an FNV-1a hash of
  the pairs themselves — **never by `Math.random()` or `Date.now()`**, so
  "no seed passed" is still perfectly reproducible given the same pairs.
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

**Insufficiency (shown instead of any estimate whenever the estimator
returns `status: 'insufficient'`, never alongside a number):**

> There isn't enough data yet to say anything about this. Keep going, or
> check back once you have more days recorded.

**CI-spans-zero framing (shown when `ci[0] <= 0 <= ci[1]`, replacing the
"X points higher/lower" language for that result):**

> The difference could be real or could be chance — this data doesn't show a
> clear association either way.

Template-specific slotting (exposure/outcome labels, the actual numbers) is
Task 5's concern; the sentences above are the fixed scaffolding those
numbers get slotted into, and the wording itself does not vary per
template.

## Automated fixture set

`src/services/experiments/__tests__/estimator.test.js` is the authoritative
automated coverage for this spec (34 tests as of this task). Relevant to
this memo:

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
- **Median-tie pinning:** an 11-point fixture with three values tied
  exactly at the median asserts those three land in the LOW group (verified
  via exact hand-computed group means, not just group sizes).
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

This is engineering-test coverage of the *rules as written* — it proves the
estimator does what this memo says it does. It is not a substitute for the
human judgment call the sign-off below is asking for, and it says nothing
about whether 10 pairs / 50% coverage / median-split-and-bootstrap is the
*right* statistical design for a mental-health app's users — that's exactly
what the sign-off is for.

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

Date reviewed: ______________  Notes: ______________
