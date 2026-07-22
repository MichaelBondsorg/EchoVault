# Michael's review hardening — Gentle Revisit + Personal Experiments

**Date:** 2026-07-22. **Source:** Michael's direct review (verbatim findings preserved in `.superpowers/sdd/` dispatch briefs). These are OWNER DIRECTIVES, not proposals — no veto window. Flags stay OFF; both sign-off docs get updated and remain unsigned.
**Execution model:** same as R1-R3 (main, green batches, implementers never push, adversarial reviews).

## Batch H1 — Gentle Revisit safety hardening

### Task GR1: server selection + memo (functions/src/revisit/**, src/services/revisit shared consts if needed, src/components/zen/widgets/RevisitWidget.jsx display gate, docs/quality/gentle-revisit-safety.md, firestore.indexes.json)
1. **Current-state gate (selection + display):** job skips a user when their RECENT entries (14-day window) contain any `safety_flagged`/`has_warning_indicators` OR sustained low mood (≥3 of the last 7 mood-scored entries < 0.4, or mean of last-14d mood < 0.4 — pick one deterministic rule, document in memo). Widget ALSO suppresses display client-side when the same condition holds over the entries it can see (defense in depth; both sides tested).
2. **Legacy entries fail closed:** an entry is eligible only if `safety_flagged` and `has_warning_indicators` are explicitly boolean on the doc; otherwise the job re-screens deterministically server-side via the existing `isCrisisText`/warning regex on the entry text — a hit OR unavailable text → ineligible. (No unscreened legacy entry can pass.)
3. **Mood floor 0.4 → 0.6** (selection floor; "calm moment" copy is now honest). Constant + memo + fixtures updated.
4. **Safety-completeness beyond the 200 cap:** add a `has_warning_indicators == true` anchor query (padded window, oldest-first, limit 50) mirroring the safety_flagged anchor; new composite index in firestore.indexes.json (+ note: needs manual gcloud provisioning, same as the other three — add command to runbook).
5. **Weekly cadence:** selection skips a user unless ≥7 days since their last queued revisit (dedup window logic; job stays daily-scheduled). Memo + runbook updated.
6. **Memo edits:** acknowledge the AI-Moment-Picker scope adjacency (deterministic ≠ different UX; the exclusion rationale applies); rename "100% safety-fixture exclusion gate" → "100% coverage of the stated exclusion rules" with the explicit caveat that tests prove rule implementation, not clinical safety; document all rules above; sign-off line stays unchecked.

### Task GR2: controls before first surprise (src/components/revisit/RevisitControls.jsx + test only)
Opt-in onboarding gains an upfront exclusions step: before `enabled` is ever written, the explainer flow offers hide-by Space/person/tag/date (the existing hidden-dims manager UI, surfaced pre-consent) with a "skip for now" path. Payloads unchanged (`reason:'hidden_dim'`).

## Batch H2 — Experiments launch blockers + methodology

### Task EX1: estimator + spec (src/services/experiments/estimator.js + test, docs/quality/experiments-data-method.md)
1. **Group-size guards:** per-group minimum n ≥ 5; imbalance limit (smaller group ≥ 25% of pairs); exposure-contrast requirement (high-group mean exposure minus low-group mean exposure must exceed 0 by a nonzero margin — define deterministically); each failure = its own insufficiency reason.
2. **Binary/tag estimator mode:** dedicated present-vs-absent split (no median) selected by plan/estimator option; same group-size guards.
3. **Per-resample split:** bootstrap recomputes the median split within each resample (min-group sizes enforced per resample; document redraw/mark policy deterministically).
4. **Stability check:** leave-one-day-out delta range computed; result carries a stability field; spec's "no distributional assumption" wording corrected (independence/representativeness assumptions named; serial-correlation caveat; block-bootstrap noted as future work).
5. **Practical significance:** spec defines a small-effect threshold (delta < 5 on the 0–100 display scale → labeled "small"); estimator/result exposes what's needed to classify.
6. **Estimate fields:** add nHigh, nLow, splitThreshold, exposureContrast (and stability) to the estimate; spec documents all new defaults; "coverage = completeness, not representativeness" language + MNAR caveat added; sign-off line stays unchecked (thresholds changed → re-sign required by the spec's own process).

### Task EX2: pipeline + UI (computeResult.js, preflight.js, experimentsService.js, templates.js, questionGate untouched, ExperimentsScreen/ExperimentResultView + tests)
1. **Mood normalization:** outcome series normalized to 0–100 at the series boundary (×100 for `analysis.mood_score` 0–1 sources; clamp+document); `analysisPlan` freezes `outcome.unit: 'mood_0_100'`; all copy says "points (0–100)"; ALL fixtures rebuilt production-scale (0–1 inputs).
2. **Local calendar days:** dateKeys derived in the user's IANA timezone (frozen onto `analysisPlan.timezone` at create from the device); series/coverage/pairing use local keys (estimator's key-string lag arithmetic is tz-agnostic and unchanged); partial start day RULE: the experiment window is whole local calendar days starting the day AFTER `startAt` (day 1 = first full day), coverage denominators match; documented in spec + code.
3. **Result integrity:** original result immutable once written — post-result exclusion toggles write `result.adjusted` (original preserved at `result.original`), each exclusion requires a reason (enum: wrong_data, wrong_date, other+free-text optional), `result.exclusionHistory` appended (dateKey, reason, at), UI labels adjusted analyses "Modified after seeing the result" and shows history; rules unchanged (`result` is a map; verify `excludedObservations` list-of-maps {dateKey, reason, excludedAt} still satisfies `is list` — it does).
4. **Missing tags = unknown:** tag-source series counts a day only when the entry was analyzed (explicit tags array present); missing/legacy → dropped as unknown, never "absent". Documented + tested.
5. **Sensitive-day disclosure:** result discloses the COUNT of contributing sensitive days ("N sensitive days contributed; details hidden"); observation table renders those rows as "sensitive day — details hidden" (no excerpt, no text) instead of omitting them; receipt sources still exclude them entirely.
6. **All attempts preserved:** completed/insufficient results all remain listed; no promote/hide mechanism; spec notes the cross-experiment multiplicity caveat in "what this does not prove".
7. **Copy:** template titles/questions reframed to co-movement ("How do sleep and mood move together in my recorded days?" pattern — matcher patterns updated to match BOTH old and new phrasings); CI-spans-zero copy replaced with "These recorded days are compatible with both higher and lower mood; no consistent direction appears." (spec fixed-strings block updated in EX1 — EX2 consumes).

### Task QA-H: validation matrix + status (after EX2)
Update affected matrix rows (revisit 100%-coverage row for new rules/floor; experiments insufficiency rows for new guards; normalization row asserting 0–1 input → 0–100 display); PROJECT_STATUS Recent Decisions (Michael-directed, ratified — no veto window: mood floor 0.6, weekly cadence, current-state gate, legacy fail-closed, 0–100 normalization, group minimums, local-day keys, immutable original result, co-movement copy); runbook updates (4th index command, weekly cadence, re-sign-off requirements flagged).

**Order:** GR1 ∥ GR2 ∥ EX1 (disjoint files) → EX2 → QA-H → final review of the whole hardening range.
