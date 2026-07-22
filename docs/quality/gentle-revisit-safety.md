# Gentle Revisit — safety memo

Covers R2 Task 19 (`docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md`),
hardened by Michael's direct safety review, Task GR1
(`docs/superpowers/plans/2026-07-22-michael-review-hardening.md`), and
hardened again by Michael's ROUND 2 direct review
(`.superpowers/sdd/task-gr-r2-report.md`). Gentle Revisit resurfaces ONE old
positive memory per day, opt-in only, behind flag `gentleRevisit`
(`src/config/flags.js`, default `false`).

**This memo BLOCKS the flag flip.** `gentleRevisit` stays `false` in
`config/flags` until Michael reads this memo and signs off at the bottom.
Nothing in this task changes that default — code ships flag-gated OFF.
**Round 2 changed the rule set the sign-off below is approving** (at-cap
reads now skip instead of silently reducing coverage; a dismissal now trips
cadence, at a longer 14-day window; a new anniversary blackout rule) — on
top of GR1's earlier changes (mood floor, legacy handling, two new "skip
today" gates, a widened adjacency rule). See "The rules" and the
Round-2-specific sections below. **The sign-off checkboxes were reset to
unchecked as part of this update; a sign-off recorded against the pre-Round-2
rule set does not carry forward.**

## Why this needs a memo before it needs a flag

Journal entries in a mental-health app are not neutral content. Resurfacing
an old entry without context risks re-triggering grief, trauma, or a crisis
state the user has since moved past — the exact opposite of "gentle." The
selection logic (`functions/src/revisit/selectRevisits.js`) encodes a set of
non-negotiable exclusion rules to keep the candidate pool restricted to
entries that are about as safe to resurface as a heuristic can determine
without asking an LLM to judge tone. Every rule below is enforced in
`selectRevisitCandidate` (and, for the two new "skip today" gates GR1 added,
in `runGentleRevisitDaily` itself — see "GR1: current-state gate and weekly
cadence" below), with **100% coverage of the stated exclusion rules** in
`functions/src/revisit/__tests__/selectRevisits.test.js` — see the caveat on
exactly what that phrase does and doesn't claim, further down.

## Deterministic selection is not a lower-stakes surface (AI-Moment-Picker scope adjacency)

**Acknowledged explicitly, per Michael's review:** this feature's selection
logic is a deterministic heuristic, not an AI/LLM call (see "No AI/provider
calls" below) — but from the perspective of the person seeing the resurfaced
memory, that distinction is invisible and irrelevant. A hypothetical future
"AI Moment Picker" that used an LLM to choose what to resurface would carry
the exact same re-triggering risk this memo is about, for the exact same
reason: **something the user didn't ask for, chosen on their behalf, lands
in their journal experience.** Whether the "chooser" is a regex-and-boolean
heuristic or a language model doesn't change the stakes for the person on
the receiving end. Concretely, this means:

- The exclusion-rule rigor documented in this memo (fail-closed defaults,
  conservative widenings, current-state awareness) is the correct bar for
  ANY moment-selection surface in this app, deterministic or AI-driven —
  not a bar that can be relaxed because "it's just a heuristic, not real AI."
- If a future version of this feature (or an adjacent one) becomes
  AI-driven — e.g., an LLM picks or ranks candidates instead of the
  deterministic scorer in `selectRevisitCandidate` — none of the rules in
  this memo become optional. They are the floor, not an AI-specific
  addition. The "Forward-looking constraint" paragraph below (AI-consent
  gating) is additive to this, not a replacement for it.
- This scope adjacency does not change anything about v1's implementation —
  it is recorded here because Michael's review raised it directly, and
  because a future contributor extending this feature toward AI-generated
  framing/ranking should not read "no LLM calls today" as "safety rules
  don't apply until there's an LLM call."

## The rules (current, GR1 + Round 2 amended)

Originally six rules (R2 Task 19); GR1 amended rules 3 and 4, and added
rules 7-9. Round 2 amended rule 9 (dismissal now trips it too, at a longer
window) and added rule 10 (anniversary blackout). There is no rule 6
duplicate — rule 6 (opt-in) is unchanged and kept in its original slot.

| # | Rule | Rationale |
|---|------|-----------|
| 1 | `safety_flagged === true` → never | The entry itself was flagged by crisis-keyword detection (`functions/src/safety/crisisKeywords.js`) at write time. Resurfacing a flagged entry as a "calm moment" would be actively wrong, not just risky. |
| 2 | `has_warning_indicators === true` → never | Warning-indicator language (hopeless, worthless, trapped, etc. — `WARNING_INDICATORS` in `src/config/constants.js`) is a softer signal than a full crisis flag, but still not "calm." Same exclusion, lower bar. |
| 3 | **(GR1: widened)** Created within ±3 days of ANY entry that is `safety_flagged === true` **OR `has_warning_indicators === true`** → never | Crisis-window adjacency. A person journaling the week of a crisis often writes several entries around it that don't individually trip keyword detection but sit inside the same emotional period. Excluding the whole window, not just the flagged entry, is the conservative choice. **GR1 widening:** originally anchored on `safety_flagged` entries only. Michael's review finding was about retrieval *completeness* — a crisis-adjacent entry could fall outside the 200-cap read before a dedicated anchor query existed for it (see rule 3's completeness fix below) — but while fixing that, the deliberate product decision made here is to ALSO widen what counts as an anchor in the first place: a nearby `has_warning_indicators` entry now vetoes adjacency too, not just a nearby `safety_flagged` one. This is a genuine scope widening, not just a completeness fix, and it is conservative in exactly the same direction as every other rule in this table — it can only ever exclude MORE, never less. |
| 4 | **(GR1: retuned)** `analysis.mood_score < 0.6` or missing → never | A conservative floor, raised from 0.4. The original 0.4 floor let through entries that were merely "not actively bad," not entries that were genuinely calm — Michael's review judged that too permissive for a feature whose entire premise is resurfacing calm moments. Missing mood (failed/partial analysis) is still treated as unsafe rather than neutral. Positive mood is **necessary, not sufficient**: passing rule 4 does not exempt an entry from rules 0-3/5. **Preference-tier reconciliation:** the scoring tier that used to prefer `mood >= 0.5` is now `mood >= 0.7`, not `mood >= 0.6` — leaving it at 0.6 would exactly equal the new floor, meaning every eligible entry would trivially satisfy it and the "preferred" tier would silently become a no-op (it would never discriminate between candidates). 0.7 keeps the tier meaningful: entries scoring 0.6-0.69 are eligible but not preferred; only genuinely brighter entries get the scoring bonus. |
| 5 | Any `revisit_exclusions` match (entry / date / person / tag / space / family) → never | The user's own suppressions always win. Six dimensions let a user hide a single entry, a whole day, a person, a topic tag, an entire Space, or a broader "family" of related content (used by the future "Less like this" action). **`date` matching (R2 final review, Minor 3+6):** the picker writes the excluded date from the DEVICE'S LOCAL calendar, but the match compares against the entry's UTC-dateKey `createdAt` — a device west of UTC (or an entry near a UTC midnight boundary) can be off by a day from what the user actually picked. `matchesExclusion` in `selectRevisits.js` therefore matches within **±1 day** of the excluded value, not just an exact string match. Over-exclusion (occasionally suppressing a neighboring day the user didn't explicitly pick) is the deliberately SAFE direction here — the failure mode this widens toward is "one extra day never resurfaces," never "a day the user explicitly asked to hide gets resurfaced anyway." |
| 6 | User not opted in (`settings/revisitPrefs.enabled !== true`) OR server flag `gentleRevisit` off → job skips the user entirely | Opt-in only, no exceptions, no default-on cohort, ever. |
| 0 | **(GR1, new)** Legacy fail-closed: eligibility requires `typeof safety_flagged === 'boolean' AND typeof has_warning_indicators === 'boolean'` (in the pure selector); the scheduled job re-screens whichever field(s) are missing/non-boolean against the entry's text before the entry ever reaches the selector → never eligible if that re-screen can't produce a trustworthy value | See "GR1: legacy entries fail closed" below for the full explanation — this closes a real gap where a pre-existing entry with no explicit boolean field was silently being treated as safe. Numbered 0 (not appended after 9) because it is logically a PRECONDITION every other rule already assumes holds — rules 1-4 only make sense once both fields are known to be trustworthy booleans. |
| 7 | **(GR1, new)** Current-state gate: the job skips a user's selection ENTIRELY for the day when their RECENT (last 14 days) entries show ANY `safety_flagged`/`has_warning_indicators`, OR sustained low mood (see below) | See "GR1: current-state gate" below. |
| 8 | *(alias — see rule 0 above; kept as "rule 8" in code comments/PR history because it was the second GR1 item drafted, but renumbered to 0 here since it's a precondition, not a same-tier exclusion check)* | — |
| 9 | **(GR1, new; Round 2: amended)** Weekly cadence: a user is skipped unless no `queued`/`shown` `revisit_queue` doc exists with `selectedAt` within the last 7 days, **AND no `dismissed` doc exists whose dismissal (`updatedAt`, stamped by `dismissRevisit`; `selectedAt` fallback for legacy docs) is within the last 14 days** | See "Round 2: dismissal now trips cadence (rule 9 reversal)" below. |
| 10 | **(Round 2, new)** Anniversary blackout: age at selection in [351, 379] days (±14 around exactly 365) → never, regardless of mood/content | See "Round 2: anniversary blackout (rule 10)" below. |

Additional (non-safety) selection constraints, also enforced in the same
pure function: entries must be 30-400 days old (recent enough to be
recognizable, old enough that "revisit" means something) **excluding the
351-379-day anniversary blackout above**, deduplicated against the last 60
days of `revisit_queue` selections, and preferred by richer content
(entities/themes present), stronger positive mood (>=0.7, see rule 4's
amendment above), and variety by month — but **none of these ever loosen or
override rules 0-10**. `selectRevisitCandidate` returns `null` when nothing
qualifies. Null is the correct, expected outcome on many days
for many users — the job never pads the result with a lower-quality or
borderline-safe pick to guarantee a daily card.

## GR1: legacy entries fail closed (rule 0)

**The gap this closes:** before GR1, the job's `mapEntryDoc` coerced both
safety fields with `data.safety_flagged === true` — which silently turns a
**missing** field into `false` (i.e., "safe"). Any entry written before
crisis-keyword detection existed, or whose analysis never ran/failed to
persist these fields, was therefore treated as passing rules 1/2 by default,
with no actual screening ever having happened on it. That is exactly
backwards for a mental-health app's safety gate: absence of information
should never read as a green light.

**The fix, precisely:** `selectRevisitCandidate` (pure, no text access) now
requires BOTH `safety_flagged` and `has_warning_indicators` to be actual
`boolean` values — anything else (`undefined`, `null`, a non-boolean) is
excluded outright, before any other rule even runs. The scheduled job is
what can turn "unknown" into a trustworthy boolean, by re-screening the
entry's own `text` field with `isCrisisText` (the same function the real
analysis pipeline uses) and a server-local warning-indicator regex
(duplicated from `src/config/constants.js` WARNING_INDICATORS, mirroring the
existing `crisisKeywords.js` client/server duplication pattern) — **before**
the entry is ever passed to the selector. Three outcomes:

- **Text unavailable** (missing/empty/non-string) for a field that needs
  re-screening → that field is left unresolved → the entry is excluded by
  rule 0. Matches the brief exactly: "text unavailable ... → excluded."
- **Either screen hits** (crisis keywords or warning-indicator keywords
  found) → the corresponding field is set `true` → the entry is excluded by
  rule 1 or 2 (the pre-existing, already-battle-tested rules), not a new
  code path.
- **Clean re-screen** (text available, neither hits) → both fields are set
  explicitly `false` → the entry is eligible again, subject to every other
  rule exactly as if it had been screened at write time.

**A deliberate implementation detail worth calling out:** the re-screen is
done PER FIELD, not "both fields or neither." If an entry already has an
explicit, trustworthy value for ONE field (e.g. it came back from the
`has_warning_indicators == true` anchor query, so that field is guaranteed
`true` by construction) but the OTHER field is legacy/missing, only the
missing field gets re-screened — the already-known field is never
overwritten by a fresh (and potentially different) re-derivation from text.
Re-deriving an already-known `true` flag from a "both or neither" re-screen
could have silently CLEARED a real, already-established flag if the
re-derivation from text didn't happen to reproduce it (e.g., the flag was
set by something other than the keyword regex, or the entry text was edited
after the flag was set). The per-field approach avoids that regression
entirely — a test in `selectRevisits.test.js` exercises exactly this
scenario as a regression guard.

**What this does not resolve:** re-screening with the same keyword regex the
original pipeline uses cannot catch anything the regex itself would have
missed at write time either — this closes the "never screened at all" gap,
not the "keyword detection has false negatives" gap (see "Open question"
below, which already covers that limitation for rules 1-2 generally).

## GR1: current-state gate (rule 7)

**The problem this addresses:** every rule above (0-6, 9) is about whether a
*specific candidate entry* is safe to resurface. None of them ask "how is
this user doing **right now**, today, independent of which old entry might
get picked?" A user could have every historical rule pass cleanly for some
30-400-day-old entry while currently being in a hard place that has nothing
to do with that old entry's own safety flags.

**The rule, precisely (pinned deterministically):** before selecting for a
user, the job reads their entries from the last 14 days
(`RECENT_WINDOW_DAYS`, newest-first, capped at 50). The user's selection is
skipped ENTIRELY for the day (not just the candidate — no selection attempt
happens at all) if:

- ANY of those recent entries has `safety_flagged === true` or
  `has_warning_indicators === true`, **or**
- **Sustained low mood:** among the user's last 7 mood-SCORED recent entries
  (`LOW_MOOD_LOOKBACK`), at least 3 (`LOW_MOOD_MIN_SCORED`) have
  `analysis.mood_score < 0.4` (`LOW_MOOD_THRESHOLD`).

**Why "last 7 mood-scored," not "last 7 days" or "all 14 days":** entries
without a mood score (failed/pending analysis) shouldn't silently dilute the
signal by counting as "not low," but they also shouldn't be excluded from
consideration by only looking at a fixed number of calendar days that might
contain few or no scored entries. Looking at the last N *scored* entries
(within the 14-day window) is the deterministic middle ground: it adapts to
how often the user actually journals with successful analysis, while still
being bounded and reproducible.

**Why fewer-than-3 fails OPEN, not closed:** this is the one place in this
memo where "insufficient signal" is deliberately NOT treated the same as
"unsafe." A user who journals rarely, or whose last few entries happened not
to get mood-scored, is not thereby assumed to be in a vulnerable state — that
would effectively penalize infrequent journaling by silently disabling a
feature they opted into, without any actual evidence prompting the
disablement. This is a judgment call, not a mathematical necessity, and it
is explicitly flagged here as one: **the memo's existing open question about
grief, trauma, and crisis scenarios (below) is not resolved by this rule.**
A user going through something difficult who simply hasn't journaled enough
recently to produce 3 scored entries gets no protection from this
particular sub-rule — rules 0-5/9 are still the only backstop for them.
This is a real, acknowledged gap, not an oversight.

**Threshold choice (0.4, not 0.6):** deliberately kept SEPARATE from the
candidate-selection mood floor (rule 4, now 0.6). This sub-rule is asking
"is the user's recent trend concerning," not "is this specific old entry
calm enough to show" — reusing the same constant would incorrectly couple
two different policy questions to one number. 0.4 was chosen to match the
ORIGINAL (pre-GR1) rule-4 floor, on the reasoning that "meaningfully below
what used to be considered an acceptable mood floor, three times in the
last week" is a reasonable bar for "something concerning is happening
lately" without being so sensitive that ordinary day-to-day mood variation
routinely trips it.

**Client-side mirror (defense in depth):** `RevisitWidget.jsx` computes the
identical rule (`currentStateGateTripped`) over whatever `entries` it
already has loaded, and suppresses the card even if a `revisit_queue` doc
already exists — covering the case where the server's selection ran before
today's signal appeared (e.g. the user journaled something concerning later
the same day). The server-side gate is authoritative; the client-side one
can only ever additionally suppress, never additionally show, something the
server declined to select.

## GR1: warning-indicator anchor completeness + widened adjacency (rule 3 amendment)

Michael's review finding: "a crisis entry near a candidate could fall
outside the retrieved set." The existing `safety_flagged`-anchored backfill
query (added in R2 final review) already solved this for `safety_flagged`
entries specifically — a dedicated, small, oldest-first query recovers
far-edge flagged entries the main 200-cap recency-ordered read might slice
out. GR1 adds the mirror query for `has_warning_indicators` (same 200-cap
far-edge problem, same fix, same failure mode on a missing index — see the
runbook), AND makes rule 3's adjacency anchor set include warning-indicator
entries in the first place (previously flagged-only) — see rule 3's own row
in the table above for why that's a deliberate scope widening, not merely a
retrieval-completeness fix. **New composite index required:**
`entries (has_warning_indicators ASC, createdAt ASC)`, added to
`firestore.indexes.json` — **provisioned 2026-07-22, verified READY in
production**; see `docs/quality/trustworthy-capture-runbook.md`'s
index-provisioning section for the `gcloud` command used. Before
provisioning, this query would have failed and the affected user's selection
would have failed closed (skipped, silently, same behavior as the existing
flagged-anchor index gap already documented in the runbook) — now that the
index is live, that failure mode no longer applies to this specific query.

**Round 2 supersedes the prior residual-acknowledgment here.** The
pre-Round-2 memo accepted, as a known v1 gap, that each anchor backfill query
(capped at 50, `FLAGGED_ANCHOR_READ_LIMIT`/`WARNING_ANCHOR_READ_LIMIT`) —
and the main 200-cap candidate read — could each silently drop a
safety-relevant doc in an extreme-history corner (more matching docs than
the cap), letting a neighboring candidate's adjacency veto go unenforced
without anyone knowing coverage was incomplete. **Michael's round-2 review
closed this: "If a query hits its cap, treat safety coverage as unknown and
skip selection."**

**The new guarantee: caps can no longer silently reduce coverage — at-cap
means skip.** `runGentleRevisitDaily` now checks, immediately after EACH of
the four entries-collection reads (the recent-window read for the
current-state gate, the main 200-cap candidate read, and both 50-cap anchor
backfills), whether the returned snapshot's size exactly equals the limit it
was read with. A snapshot at its cap means the true result set may be
larger than what came back — there is no way to tell, from a capped read
alone, whether anything relevant was cut off. Rather than proceed on that
unknown, the job treats it as **coverage unknown** and skips the user's
selection entirely for today (no candidate, no write, same as any other
"skip today" gate) — counted in its own return field,
`skippedCoverageUnknown`, distinct from the ordinary `skipped` counter
(opt-out/marker/per-user-error), and logged with a structured line naming
the query, its limit, and the user. One entry under a cap is unaffected and
proceeds normally — this is specifically an at-cap check, not a
"read fewer than N and get nervous" heuristic.

This closes the gap the old paragraph merely documented: there is no longer
any scenario where a capped read silently starves an adjacency veto (or any
other safety signal) without the system knowing and refusing to select on
it. The tradeoff is availability, not safety: a user with an unusually dense
history in the padded window may see Gentle Revisit skip more often (never
select on unknown coverage) rather than occasionally missing a veto it
couldn't have detected anyway.

## GR1: weekly cadence (rule 9), Round 2 amended below

**The original GR1 rule:** a user is skipped unless no `queued` or `shown`
`revisit_queue` doc exists with `selectedAt` within the last 7 days. The
job's existing daily schedule and per-day idempotency marker are unchanged —
this is an ADDITIONAL, per-user gate on top of "does the job run today," not
a replacement for it. **Read cost:** this reuses the existing 60-day
`recentQueue` read rule 5's dedup already performs — no new Firestore read
was added for this rule; the job simply also inspects each doc's `status`
field on the read it already had. This part is UNCHANGED by Round 2 — see
immediately below for what did change.

## Round 2: dismissal now trips cadence (rule 9 reversal)

**Michael's round-2 finding:** "A dismissal should count as an exposure and
block further cards for at least the normal cadence — possibly longer if
'not now' is intended as a stronger signal."

**This REVERSES GR1's choice.** GR1 deliberately excluded `dismissed` items
from the cadence gate, reasoning that a dismissal "isn't a live selection"
and shouldn't itself block a sooner fresh one. Michael's round-2 review
overturned that: seeing the card and actively declining it ("not now") IS an
exposure to the resurfaced content — the user read the reason line, saw the
date/Space chip, and made a choice about it. Treating that as a non-event
was wrong.

**The new rule, precisely:** a user is now ALSO skipped when a `dismissed`
`revisit_queue` doc exists whose dismissal is within the last
`DISMISSED_CADENCE_DAYS` = **14 days** — double the normal 7-day
`queued`/`shown` cadence, not the same window. `queued`/`shown` items are
unaffected by this change and still use the 7-day window.

**Anchor field (review follow-up):** the 14-day dismissed block runs from
the dismissal ACTION — `updatedAt`, which `dismissRevisit` stamps — not
from the original `selectedAt`. "A dismissal should count as an exposure",
and the exposure the user reacted to happened when they tapped "Not now";
a card that sat queued for several days before being dismissed would
otherwise get a silently shorter post-dismissal block. Legacy docs without
a parseable `updatedAt` fall back to `selectedAt` (which is always ≤ the
dismissal time, so the fallback errs toward the longer effective block).
Live `queued`/`shown` items keep anchoring on `selectedAt` — their exposure
begins at selection/display.

**Why 14, not 7 (pinned, revisable via memo re-sign):** per Michael's own
framing, an explicit "not now" is read as a STRONGER signal than a passive
queued/shown exposure the user may never have actually opened — so it should
block for LONGER, not the same amount. 2x the base cadence is a deliberately
simple, conservative multiplier (not derived from any data — there is none
yet on how users actually respond to a "not now"). If usage data later
suggests 14 days is too long or too short, that's a memo re-sign, not a
silent constant change.

**What still doesn't change:** a `dismissed` item is still also counted by
rule 5's 60-day dedup (`recentQueue` in `selectRevisitCandidate`) for the
specific entry it named — that per-entry dedup is unaffected and stacks with
this coarser gate. `revisit_exclusions` ("Never show"/"Less like this")
remains the mechanism for permanently or topically suppressing content; this
gate is only about the CADENCE of offering something new at all.

## Round 2: anniversary blackout (rule 10)

**Michael's round-2 finding:** "For v1, either avoid roughly one-year-old
entries, require user-curated eligibility, or explicitly accept and document
this residual risk."

**Three options were on the table; the avoidance option was chosen** as the
most protective one that still preserves the feature for v1:

1. **Avoid roughly-one-year-old entries** (chosen). A hard blackout window
   around the one-year mark, applied unconditionally in the pure selector.
2. **Require user-curated eligibility** (rejected for v1, not rejected
   forever). Only resurface entries a user has explicitly marked
   "revisitable" — the same idea Concern 4's sign-off paragraph raises as a
   considered alternative to the whole feature's design, not just this one
   rule. Rejected here specifically because it would require new UI/data
   model work (a per-entry "mark as revisitable" affordance) beyond this
   round's scope; the anniversary risk alone doesn't justify that redesign
   when a narrower rule closes most of the risk.
3. **Explicitly accept and document the residual risk** (rejected). This is
   what the pre-Round-2 memo actually did — the "Anniversary/grief dates"
   bullet under "Open question" below acknowledged the gap without closing
   it. Michael's round-2 review judged that insufficient on its own now that
   a concrete, cheap mitigation (option 1) is available — accept-and-document
   remains the right posture for the OTHER open risks in this memo (false
   negatives, recovered-but-still-loaded topics) where no cheap mitigation
   exists, but not for this one now that a hard rule does exist.

**The rule, precisely:** an entry's age at selection is compared against
`ANNIVERSARY_BLACKOUT_DAYS = [351, 379]` — a ±14-day window around exactly
365 days. An entry whose age falls in that inclusive range is never
selectable, full stop, regardless of mood, entities, tags, or any other
scoring input. This is enforced in the PURE selector (`selectRevisitCandidate`
in `selectRevisits.js`), as an unconditional gate checked immediately after
the 30-400-day age-window check and before any of the safety-flag/mood/
exclusion rules — a maximally "attractive" entry (high mood, rich
entities/tags — exactly what the scoring step favors most) sitting on the
anniversary is excluded exactly the same as a plain one; this is a hard gate,
never a scoring penalty a good-looking entry could out-score.

**Why ±14 days, not exactly 365:** grief/trauma intensification around an
anniversary is rarely confined to the literal calendar day — the surrounding
weeks often carry the same emotional weight (anticipatory dread beforehand,
lingering aftermath after). A single-day blackout would leave the memory
resurfaceable the day before or after the actual anniversary, which does
little to reduce the risk this rule exists for. 14 days on each side is a
deliberately round, conservative pin (not derived from any clinical data —
none was consulted for this v1 rule, consistent with the rest of this memo's
"engineering team's best conservative interpretation" framing) — revisable
via memo re-sign if it proves too wide or too narrow in practice.

**What this does not resolve:** this rule only protects against ONE specific
calendar mechanism (age relative to selection date). It does not know that a
given entry is *about* a loss, or that a *different* date entirely (a
birthday, a diagnosis date, a wedding anniversary) might carry the same
weight for a given user without falling near that entry's own one-year mark.
The "Anniversary/grief dates" bullet under "Open question" below is amended,
not removed, to reflect this narrower scope.

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
**This is a technical/consent-architecture distinction, not a safety-stakes
distinction** — see "Deterministic selection is not a lower-stakes surface"
above for why the same caution applies regardless.

**Forward-looking constraint, not built here:** if a future version adds
LLM-generated framing (e.g., a warmer or more specific `reason` string, or an
AI-written excerpt/summary), `isAiAllowed`/`assertAiConsent` becomes
**mandatory** before that call, exactly like every other AI code path in this
app. The current `reason` string is a plain, hardcoded template —
`'A calm moment from {Month Year}'` — never AI-generated, never referencing
entry content.

## Delivery safety (verified fact, not a design intent statement)

The following has been verified directly against the current codebase, not
just described as intended behavior:

- **In-app only.** `runGentleRevisitDaily` writes exactly one Firestore doc
  (`revisit_queue/{id}`) per selection. It never calls a push-notification
  API, never queues an email, and never invokes anything under
  `functions/src` that sends an external message of any kind. Grepping this
  module and its imports for any notification/email/push/FCM/messaging call
  turns up nothing — the write path ends at Firestore.
- **Preview without content, hidden-until-tapped, now explicitly
  PER-SESSION (Round 2).** The `revisit_queue` doc itself carries no entry
  text — only `entryId`, `spaceId`, `selectedAt`, `dueDate`, `status`, and
  the fixed `reason` template string. `RevisitWidget.jsx` withholds the
  underlying entry's text (`entryText`) from render until the user actively
  taps "Show" — the initial card render is always reason/date/Space chip
  only, never entry content. **Round 2 finding (Michael's direct review):**
  "Keep `shown` for analytics and cadence, but require a fresh, session-local
  reveal action before rendering sensitive text again." Entry text now
  renders ONLY from session-local component state (`localRevealed`) — it is
  NEVER auto-derived from the doc's `status === 'shown'` field, which is
  still kept (for analytics and the cadence gate above) but no longer used
  to auto-reveal. A remount (navigate away and back, app relaunch, a
  different device/tab) always shows the preview again and requires a fresh
  tap of Show before the text renders — tapping Show on an already-`shown`
  doc reveals locally without re-calling the `markShown` service function
  (the status is already recorded; no duplicate write).
- **No notification path exists.** There is no code anywhere in this
  feature (client or server) that could surface a Gentle Revisit selection
  outside the in-app widget — no notification permission request, no
  scheduled push, no digest/email inclusion. A user who never opens the app
  that day simply never sees that day's card; nothing else happens as a
  result of a selection being made.

This section exists because delivery mechanism is itself a safety property
for this feature — an in-app, opt-in, no-notification, content-withheld
surface is a meaningfully lower-risk delivery model than a push notification
or email would be for the exact same underlying content, independent of how
good the selection rules are.

## Open question (PRD): grief, trauma, and crisis scenarios

The PRD's stated gate is: *"Safety research and suppression rules must pass
before Gentle Revisit can be enabled outside internal testing."* The rules
above (0-10) are the current best-effort answer, but they are heuristic, not
clinical. GR1 closed several concrete gaps (legacy fail-closed, a
current-state gate, a stricter mood floor, retrieval completeness, weekly
cadence) and Round 2 closed more (at-cap coverage-unknown, dismissal
cadence, the anniversary blackout below) but the underlying open question is
**not** fully resolved — specifically unresolved, and explicitly **not**
claimed to be solved by this implementation, GR1 and Round 2 included:

- **Anniversary/grief dates — PARTIALLY ADDRESSED in Round 2 (rule 10, the
  anniversary blackout).** An entry aged 351-379 days (±14 around exactly
  one year) is now unconditionally excluded, regardless of mood/content —
  see "Round 2: anniversary blackout" above for the rule and the two
  rejected alternatives (user-curated eligibility; accept-and-document).
  This narrows, but does not close, the underlying risk: it only protects
  against the ONE-YEAR-FROM-SELECTION mechanism. It does nothing for (a) a
  DIFFERENT significant date for a given user (a birthday, a diagnosis date,
  a different anniversary entirely) that doesn't line up with that entry's
  own one-year mark, or (b) an entry that mentions a person who has since
  died but isn't itself near any calendar anniversary. Neither v1 nor GR1
  nor Round 2 has any concept of "this entity is associated with a loss."
  The current-state gate (rule 7) does not help here either — it looks at
  the user's RECENT entries, not at whether TODAY is a significant date
  relative to the CANDIDATE entry being considered.
- **Recovered-but-still-loaded topics.** A user may have processed a
  difficult period (mood scores recovered, no crisis flags, no recent
  low-mood signal) but still find unprompted resurfacing of that period
  unwelcome, independent of mood. Rule 5's `family`/`tag` exclusion
  dimensions give the user a lever to hide this *after* being surprised by
  it once — v1/GR1 has no way to anticipate it.
- **False negatives in mood/safety scoring.** Rules 1-4 (and rule 0's
  re-screen, and rule 7's current-state gate) are only as good as upstream
  classification (`functions/src/analysis/`, `crisisKeywords.js`) and the
  same keyword-based re-screen GR1 added for legacy entries. A missed
  crisis flag or an inflated mood score would let something through that
  shouldn't be — GR1's re-screening uses the SAME keyword regex the primary
  pipeline uses, so it inherits the same false-negative surface, not an
  independent check. There is still no independent second check specific to
  this feature.
- **No user research has been done.** These rules remain the engineering
  team's best conservative interpretation of the PRD (now including
  Michael's direct review as an additional, expert-informed input), not the
  output of user interviews, clinical consultation, or a beta cohort. That
  gap is exactly what this memo's sign-off is meant to make explicit, not
  paper over.

None of this is fixed by writing better code — it needs a human decision
about acceptable risk, ideally informed by outside expertise. That decision
is what this memo defers to Michael, not to a flag flip.

## Automated fixture set

`functions/src/revisit/__tests__/selectRevisits.test.js` and
`src/components/zen/widgets/__tests__/RevisitWidget.test.jsx` are the
authoritative automated coverage. Relevant to this memo:

- **One test per rule** (0-5, 9, 10, each independently, plus rule 3's
  widened adjacency and rule 4's retuned floor), plus the age window and
  dedup-window boundaries, exercised at their exact edges (e.g. ±3 days
  adjacency tested at exactly 3 days and 3 days + 1ms; the new 0.6 mood
  floor tested at exactly 0.6 and just below; the anniversary blackout
  tested at 350/351/365/379/380 days, including a bait fixture).
- **100% coverage of the stated exclusion rules**: a single adversarial
  fixture set containing one entry violating each rule (flagged,
  warning-indicators, adjacent-to-flagged on both sides, low mood, missing
  mood, user-excluded, too young, too old) is run through
  `selectRevisitCandidate` and asserted to return `null` — zero of the ten
  unsafe entries is ever selected. A second run adds exactly one genuinely
  safe control entry to the same adversarial set and asserts *that one
  specific entry* is returned, confirming the adversarial entries were
  actually filtered (not that the input was accidentally empty).
  **Caveat, stated explicitly (renamed from "100% safety-fixture exclusion
  gate" to avoid overclaiming): this proves the code correctly implements
  the rules AS WRITTEN in this memo. It is not, and cannot be, proof that
  the rules themselves are clinically sufficient — that is exactly the
  "Open question" above, which no amount of test coverage resolves.**
- **Current-state gate (rule 7) and weekly cadence (rule 9)**, each covered
  both as direct pure-function fixtures (`currentStateGateTripped`,
  `sustainedLowMoodTripped`, `weeklyCadenceTripped`) and end-to-end through
  `runGentleRevisitDaily` against a fake Firestore double.
- **Legacy fail-closed (rule 0)**, covered end-to-end through
  `runGentleRevisitDaily`: a legacy entry (no explicit boolean fields)
  containing crisis-keyword text is never selected; a legacy entry with
  clean text and no explicit fields IS selectable (proving the gate isn't
  simply "never select anything without explicit fields"); a legacy entry
  with missing/empty text is excluded (no re-screen possible); and a
  regression guard proving the per-field re-screen never overwrites an
  already-known-true flag with a fresh (and potentially wrong) re-derivation
  from the other field's clean text.
- **Client-side current-state gate**, covered in `RevisitWidget.test.jsx`:
  a recent (within-14-day) flagged/warning-indicator entry in the widget's
  `entries` prop suppresses the card even with a live queued doc present;
  sustained low mood among the last 7 recent mood-scored entries does the
  same; fewer than 3 scored recent entries fails open (card still renders).
- **Scheduled-job tests** (`runGentleRevisitDaily`) cover: the server flag
  gate skips every user without even listing them; a non-opted-in user is
  skipped without an entries read; the idempotency marker makes a same-day
  rerun a true no-op (no second read, no second write); a new local day
  claims a fresh marker; one user's failure doesn't stop the sweep for the
  next user; the ≤200-entry read cap and both ≤50-entry anchor read caps
  (flagged and, new in GR1, warning-indicator) are asserted directly against
  the fake Firestore call arguments; and the warning-indicator anchor
  backfill recovers a far-edge warning entry the 200-cap main query would
  otherwise slice out, mirroring the existing flagged-anchor test.
- **Round 2: at-cap coverage-unknown**, covered end-to-end through
  `runGentleRevisitDaily` for all four capped reads independently (recent-
  window at 50, main candidate at 200, flagged-anchor at 50, warning-anchor
  at 50) — each asserted to skip selection and increment
  `skippedCoverageUnknown` distinctly from `skipped`; one entry under every
  cap (199/49/49/49) is asserted to proceed normally, proving the check
  doesn't false-positive one below the limit.
- **Round 2: dismissal cadence (14 days)**, covered both as a direct
  `weeklyCadenceTripped` fixture set (dismissed at 6/13/14/15 days; shown at
  8 days unaffected) and end-to-end through `runGentleRevisitDaily` (a
  dismissed doc within 14 days now blocks a fresh selection; at 15 days it
  no longer does).
- **Round 2: anniversary blackout**, covered via `selectRevisitCandidate`
  directly at the exact boundaries (350/351/365/379/380 days) and folded
  into the adversarial 100%-coverage fixture set above as an additional
  bait entry (high mood, rich entities/tags, aged exactly 365 days) that
  must never be selected.
- **Round 2: per-session reveal**, covered in `RevisitWidget.test.jsx`: a
  fresh mount with a `status:'shown'` doc renders the PREVIEW (no entry
  text, Show action present), not the revealed text; tapping Show on that
  remounted card reveals the text locally without a second `markShown`
  service call (`updateDoc` never invoked).

This is engineering-test coverage of the *rules as written* — it proves the
code does what this memo says it does. It is not a substitute for the human
judgment call the open question above is asking for.

## Round 2: scope confirmation (a safer alternative exists)

**Michael's round-2 finding:** "The sign-off should explicitly confirm that
this narrower resurfacing experience is intentionally in scope. A safer
alternative would be resurfacing only memories the user has deliberately
marked as revisitable."

This memo already carries a section above ("Deterministic selection is not
a lower-stakes surface") acknowledging that Gentle Revisit sits adjacent to
the previously-excluded AI Moment Picker concept — something is chosen FOR
the user and surfaces unprompted, whether the chooser is a heuristic or an
LLM. Michael's round-2 review pushed on this further: the sign-off itself
should make the scope decision explicit, not just acknowledge the adjacency
in prose, and a genuinely safer design exists that the current rule set does
not implement.

**The safer alternative, presented neutrally (Michael's call, not a
recommendation either way):** resurface ONLY entries a user has
affirmatively marked as "revisitable" at write time or afterward — an
opt-in, per-entry allowlist rather than an opt-out, rule-filtered
population of "everything not excluded." This would be strictly safer than
the current design: it eliminates every risk this memo's rule table
(0-10) exists to mitigate, because nothing the user didn't specifically
choose would ever surface. The tradeoff is real, though — it requires new
UI/data-model work (a per-entry "mark as revisitable" affordance, likely at
capture time or via a later review flow) that this round did not build, and
it changes the feature from "the app surfaces something on your behalf" to
"you curate a small collection the app rotates through," which is a
materially different product experience, not just a safety tweak. Whether
that tradeoff is worth making for v1, later, or never is Michael's design
call — this paragraph documents the alternative for the record, it does not
argue for it over the current deterministic-heuristic design.

## Sign-off

`gentleRevisit` stays `false` in `config/flags` until BOTH lines below are
checked by Michael, after reading this memo (including the open question and
the scope-confirmation section above) and deciding the current rule set
(0-10, GR1- and Round-2-amended) is an acceptable v1 risk posture for even
internal testing. **These checkboxes were reset to unchecked by Round 2** —
a sign-off against the pre-Round-2 rule set (no anniversary blackout,
dismissal didn't trip cadence, capped reads could silently reduce coverage)
does not carry forward to this materially different rule set:

- [ ] **Michael has read this memo and approves flipping `gentleRevisit` on
      for internal testing.** (Unchecked = flag stays off. This checkbox is
      not self-certifying — an agent must never check this box on Michael's
      behalf.)
- [ ] **Michael confirms this deterministic resurfacing experience is
      intentionally in scope despite its adjacency to the previously
      excluded AI Moment Picker** — i.e., having read the safer
      user-marked-revisitable-only alternative above, he is choosing to
      proceed with the current rule-filtered design (or will direct a
      change, at his discretion) rather than treating this checkbox as a
      formality. (Unchecked = flag stays off. Not self-certifying — an
      agent must never check this box on Michael's behalf.)

Date reviewed: ______________  Notes: ______________
