# Gentle Revisit — safety memo

Covers R2 Task 19 (`docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md`).
Gentle Revisit resurfaces ONE old positive memory per day, opt-in only,
behind flag `gentleRevisit` (`src/config/flags.js`, default `false`).

**This memo BLOCKS the flag flip.** `gentleRevisit` stays `false` in
`config/flags` until Michael reads this memo and signs off at the bottom.
Nothing in this task changes that default — code ships flag-gated OFF.

## Why this needs a memo before it needs a flag

Journal entries in a mental-health app are not neutral content. Resurfacing
an old entry without context risks re-triggering grief, trauma, or a crisis
state the user has since moved past — the exact opposite of "gentle." The
selection logic (`functions/src/revisit/selectRevisits.js`) encodes six
non-negotiable exclusion rules to keep the candidate pool restricted to
entries that are about as safe to resurface as a heuristic can determine
without asking an LLM to judge tone. Every rule below is enforced in
`selectRevisitCandidate`, a pure function with 100% rule coverage in
`functions/src/revisit/__tests__/selectRevisits.test.js`.

## The six rules

| # | Rule | Rationale |
|---|------|-----------|
| 1 | `safety_flagged === true` → never | The entry itself was flagged by crisis-keyword detection (`functions/src/safety/crisisKeywords.js`) at write time. Resurfacing a flagged entry as a "calm moment" would be actively wrong, not just risky. |
| 2 | `has_warning_indicators === true` → never | Warning-indicator language (hopeless, worthless, trapped, etc. — `WARNING_INDICATORS` in `src/config/constants.js`) is a softer signal than a full crisis flag, but still not "calm." Same exclusion, lower bar. |
| 3 | Created within ±3 days of ANY safety-flagged entry → never | Crisis-window adjacency. A person journaling the week of a crisis often writes several entries around it that don't individually trip keyword detection but sit inside the same emotional period. Excluding the whole window, not just the flagged entry, is the conservative choice. |
| 4 | `analysis.mood_score < 0.4` or missing → never in v1 | A conservative floor. Missing mood (failed/partial analysis) is treated as unsafe rather than neutral — we never resurface something we have no read on. Positive mood is **necessary, not sufficient**: passing rule 4 does not exempt an entry from rules 1-3/5. |
| 5 | Any `revisit_exclusions` match (entry / date / person / tag / space / family) → never | The user's own suppressions always win. Six dimensions let a user hide a single entry, a whole day, a person, a topic tag, an entire Space, or a broader "family" of related content (used by the future "Less like this" action). **`date` matching (R2 final review, Minor 3+6):** the picker writes the excluded date from the DEVICE'S LOCAL calendar, but the match compares against the entry's UTC-dateKey `createdAt` — a device west of UTC (or an entry near a UTC midnight boundary) can be off by a day from what the user actually picked. `matchesExclusion` in `selectRevisits.js` therefore matches within **±1 day** of the excluded value, not just an exact string match. Over-exclusion (occasionally suppressing a neighboring day the user didn't explicitly pick) is the deliberately SAFE direction here — the failure mode this widens toward is "one extra day never resurfaces," never "a day the user explicitly asked to hide gets resurfaced anyway." |
| 6 | User not opted in (`settings/revisitPrefs.enabled !== true`) OR server flag `gentleRevisit` off → job skips the user entirely | Opt-in only, no exceptions, no default-on cohort, ever. |

Additional (non-safety) selection constraints, also enforced in the same
pure function: entries must be 30-400 days old (recent enough to be
recognizable, old enough that "revisit" means something), deduplicated
against the last 60 days of `revisit_queue` selections, and preferred by
richer content (entities/themes present), stronger positive mood (≥0.5), and
variety by month — but **none of these ever loosen or override rules 1-6**.
`selectRevisitCandidate` returns `null` when nothing qualifies. Null is the
correct, expected outcome on many days for many users — the job never pads
the result with a lower-quality or borderline-safe pick to guarantee a daily
card.

## No AI/provider calls (and why that matters here)

v1 selection is a deterministic heuristic over fields already computed by
existing entry analysis. `runGentleRevisitDaily` makes **zero calls to
Gemini, OpenAI, or any other provider** — it only reads Firestore fields and
applies the rules above. Per the codebase's consent-gate pattern
(`functions/src/consent/consentGate.js`, `assertAiConsent`/`isAiAllowed`),
every provider call must pass a fail-closed AI-processing consent check
first. Because this job makes no provider call, there is nothing for that
gate to guard — **and this is called out explicitly in-code**
(`functions/src/revisit/selectRevisits.js` module doc) so a future
contributor doesn't assume the absence of a consent check is an oversight.

**Forward-looking constraint, not built here:** if a future version adds
LLM-generated framing (e.g., a warmer or more specific `reason` string, or an
AI-written excerpt/summary), `isAiAllowed`/`assertAiConsent` becomes
**mandatory** before that call, exactly like every other AI code path in this
app. The current `reason` string is a plain, hardcoded template —
`'A calm moment from {Month Year}'` — never AI-generated, never referencing
entry content.

## Open question (PRD): grief, trauma, and crisis scenarios

The PRD's stated gate is: *"Safety research and suppression rules must pass
before Gentle Revisit can be enabled outside internal testing."* Rules 1-6
above are the current best-effort answer, but they are heuristic, not
clinical. Specifically unresolved, and explicitly **not** claimed to be
solved by this implementation:

- **Anniversary/grief dates.** An entry written a year after a loss, or one
  that mentions a person who has since died, may score as high-mood and
  entity-rich (exactly what the preference scoring favors) while still being
  a bad candidate to resurface on the wrong day. v1 has no concept of
  anniversary-sensitivity or "this entity is associated with a loss."
- **Recovered-but-still-loaded topics.** A user may have processed a
  difficult period (mood scores recovered, no crisis flags) but still find
  unprompted resurfacing of that period unwelcome, independent of mood.
  Rule 5's `family`/`tag` exclusion dimensions give the user a lever to hide
  this *after* being surprised by it once — v1 has no way to anticipate it.
- **False negatives in mood/safety scoring.** Rules 1-4 are only as good as
  upstream classification (`functions/src/analysis/`, `crisisKeywords.js`).
  A missed crisis flag or an inflated mood score would let something through
  that shouldn't be. There is no independent second check specific to this
  feature — it inherits whatever the entry pipeline already computed.
- **No user research has been done.** These rules are the engineering team's
  best conservative interpretation of the PRD, not the output of user
  interviews, clinical consultation, or a beta cohort. That gap is exactly
  what this memo's sign-off is meant to make explicit, not paper over.

None of this is fixed by writing better code — it needs a human decision
about acceptable risk, ideally informed by outside expertise. That decision
is what this memo defers to Michael, not to a flag flip.

## Automated fixture set

`functions/src/revisit/__tests__/selectRevisits.test.js` is the authoritative
automated coverage. Relevant to this memo:

- **One test per rule** (rules 1-5, each independently), plus the age
  window and dedup-window boundaries, exercised at their exact edges (e.g.
  ±3 days adjacency tested at exactly 3 days and 3 days + 1ms).
- **100% safety-fixture exclusion gate**: a single adversarial fixture set
  containing one entry violating each rule (flagged, warning-indicators,
  adjacent-to-flagged on both sides, low mood, missing mood, user-excluded,
  too young, too old) is run through `selectRevisitCandidate` and asserted
  to return `null` — zero of the ten unsafe entries is ever selected. A
  second run adds exactly one genuinely safe control entry to the same
  adversarial set and asserts *that one specific entry* is returned,
  confirming the adversarial entries were actually filtered (not that the
  input was accidentally empty).
- **Scheduled-job tests** (`runGentleRevisitDaily`) cover: the server flag
  gate skips every user without even listing them; a non-opted-in user is
  skipped without an entries read; the idempotency marker makes a same-day
  rerun a true no-op (no second read, no second write); a new local day
  claims a fresh marker; one user's failure doesn't stop the sweep for the
  next user; and the ≤200-entry read cap and ≤1-doc-per-day write cap are
  both asserted directly against the fake Firestore call arguments.

This is engineering-test coverage of the *rules as written* — it proves the
code does what this memo says it does. It is not a substitute for the human
judgment call the open question above is asking for.

## Sign-off

`gentleRevisit` stays `false` in `config/flags` until this line is checked
by Michael, after reading this memo (including the open question above) and
deciding the six rules are an acceptable v1 risk posture for even internal
testing:

- [ ] **Michael has read this memo and approves flipping `gentleRevisit` on
      for internal testing.** (Unchecked = flag stays off. This checkbox is
      not self-certifying — an agent must never check this box on Michael's
      behalf.)

Date reviewed: ______________  Notes: ______________
