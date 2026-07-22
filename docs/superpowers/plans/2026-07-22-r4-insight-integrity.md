# R4 — Insight Integrity (deep-review adoption)

**Date:** 2026-07-22. **Source:** Michael's external deep review (`~/Downloads/engram-insights-engine-deep-review (1).md`, hereafter DR) — adopted as owner direction: "use the document to complement and expand the work we've already done." Controller assessment of DR (verified at HEAD): legacy-engine findings substantially correct; its Personal Experiments critique reviews the pre-round-2 snapshot and is superseded by the July 22 hardening; its 80%-comprehension internal gate is REJECTED for internal testing (Michael's signed basis stands; DR's gate becomes the pre-broad-release bar); its InsightClaim architecture is near-isomorphic to the shipped experiments/receipts stack — R4 extends that rigor to the legacy engines rather than building greenfield.
**Execution model:** identical to R1–R3 (main, green batches, implementers never push, adversarial reviews, SDD ledger).

## Ratified decisions (Michael, 2026-07-22)
1. DR adopted as R4 scope, phased: Phase 0 containment now; Phases 1–2 (canonical claim store, verified synthesis) planned in detail when reached.
2. **Legacy artifact cutover, not migration:** new generations stamp `generatorVersion`; legacy nexus `active` items are archived to `history` with a `legacyVersion` mark on first post-R4 generation (nothing silently deleted); basicInsights cache invalidated; day-level analytics recompute naturally. **User feedback/exclusions/suppressions are PRESERVED and become consumed inputs** (DR finding 10).
3. DR's comprehension gate (≥80%) applies before broad release only, not internal use.
4. Features the mood-scale fixes would newly ACTIVATE (counterfactuals, belief dissonance, intervention outcomes, personalized recommendations) do NOT get activated-as-was: they are suppressed or relabeled per DR findings 3/7 until Phase 1–2 evidence rails exist. Fixing the scale must not un-dead risky claims.

## Phase 0 — containment (Batches R4-0a/0b)

### Task 1: Entry-schema adapter + basicInsights repairs
**Files:** create `src/services/insights/entryAdapter.js` + tests; modify `src/services/basicInsights/correlations/{activityCorrelations,categoryCorrelations,healthExtendedCorrelations,themesCorrelations,peopleCorrelations}.js` + orchestrator entry ingestion; `functions/src/analytics/onEntryAnalyzed.js`; contract tests with export-shaped fixtures (current + legacy shapes; DR finding 2).
- One versioned `normalizeEntryForInsights(entry)` adapter: top-level vs `analysis.*` field resolution (entry_type, tags, entities), healthContext activity OBJECT handling (fixes the live `.toLowerCase()` crash — DR verified at HEAD), themes/emotions/cognitive_patterns resolved-or-explicitly-unknown (they are never written today — adapter returns unknown, engines must treat unknown ≠ absent, mirroring EX2's missing-tags rule), legacy health field names mapped.
- Every basicInsights engine consumes ONLY adapter output. onEntryAnalyzed reads corrected field locations.
- **Day-level grounding (DR finding 4, first slice):** engines compute and REPORT unique-day counts alongside entry counts (reuse EX2's local-dateKey helpers); minimum unique-day gates added to thresholds (entries≥5 AND days≥3 per factor as floor); baseline = non-overlapping complement (exposed vs NOT-exposed, never all-entries); same-entry co-occurrence wording → association-only (audit each engine's insight text).
- sleep/sleep-score `average([])`→0 false-difference guard (DR finding 4, healthCorrelations:31 class): empty group = insufficient, never zero.

### Task 2: Nexus layers 1–2 — personal literals out, thread/state honesty
**Files:** `src/services/nexus/layer1/patternDetector.js`, `src/services/nexus/layer2/{threadManager,stateDetector}.js`, `src/services/nexus/gapDetector.js` + tests (DR findings 5, 9, 14 partial).
- **PRIVACY (do first):** strip ALL user-specific literals (names incl. 'spencer', brands, app self-references) from patternDetector triggers and any layer1/2 config. v1 replacement: generic-category triggers only; per-user ontology deferred to Phase 1 (extraction layer). Detection getting sparser is the intended outcome (DR: 918 detections/163 entries is the bug).
- Trigger hygiene: kill bare-substring triggers ('talked','called','walked','great' class) or require word-boundary + context minimums; add an assert-no-personal-literals test (regex over the module source for known-personal tokens is brittle — instead: triggers must come from an exported GENERIC_TRIGGERS structure with a lint test that every trigger is in a curated generic vocabulary file).
- layer2: thread classification gains a first-class "none" outcome (default); unmatched continue no longer falls through to metamorphosis; stateDetector duration derived from entry DATES not regeneration count; gapDetector either consumes what analytics actually writes (post-Task-1) or abstains cleanly.

### Task 3: Nexus layers 3–4 + orchestrator — mood-unit sanity, fabrication suppression
**Files:** `src/services/nexus/orchestrator.js` (entity-delta thresholds), `src/services/nexus/layer3/{counterfactual,beliefDissonance,synthesizer,crossThreadDetector}.js`, `src/services/nexus/layer4/{interventionTracker,recommendationEngine}.js` + tests (DR findings 3, 6, 7, 9).
- Mood unit: adopt the codebase-wide convention (0–1 internal `Mood01`, presentation converts; EX2's normalizeMoodTo100 is the display precedent) — fix orchestrator 10-point-delta-on-0–1, counterfactual 40/60, beliefDissonance 50, synthesizer %-labeling. Boundary assertions + scale-invariance tests.
- Per ratified decision 4: counterfactual + beliefDissonance + interventionTracker outcome claims + recommendationEngine personalized claims are SUPPRESSED at the orchestrator seam (not deleted — gated behind an internal `nexusRiskyClaims` disable that Phase 1–2 revisits) OR relabeled: recommendations become "ideas" with no personal-evidence claim; fabricated fallback reasoning (invented biometric/mood improvements) deleted outright.
- synthesizer prompt de-escalated NOW (profound/prediction/surprise demands removed; explain-only framing; DR finding 6's full two-pass verifier is Phase 2, but the prompt stops ASKING for invention immediately); parse path stops trusting model-authored confidence (confidence field → computed-from-sample-size stopgap using the existing receipts sampleSize).
- Pipeline bugs: `.slice(-N)`-on-descending (synthesizer + all consumers — grep-sweep with sort-order contract comments), crossThreadDetector destructuring mismatch, intervention 7-day baseline including future entries + Whoop shape mismatch (until suppression lands, fix anyway — the code stays, gated).

### Task 4: Reports read what exists
**Files:** `functions/src/reports/{generator,narrative}.js` + tests (DR finding 8).
- Nexus read: singleton `nexus/insights` doc (active array) instead of the phantom by-type collection query; consume the same receipts the app shows.
- `mood_score` field fix (camelCase moodScore reads are silently null today) — report mood sections come alive; verify against real entry shape fixtures.
- Narrative sampling: representative selection (stratified across the period — simple: spread across weeks + top-mood-variance days) instead of first-8-chronological; keep T9's entryRefs/exclusion/fail-closed behavior intact (regression tests).

### Task 5: Feedback becomes consumed (Batch R4-0b — after T1/T3 land; touches their outputs)
**Files:** `src/services/basicInsights/feedbackLearning.js` + orchestrator consumption seams, Nexus dismissal persistence (orchestrator/InsightsPage seam), tests (DR finding 10).
- basicInsights generation consumes falsePositivePatterns/falsePositiveEntryIds (filter candidates pre-scoring); suppressed-insight resurfacing bug fixed (evaluation entry-count update).
- Nexus dismissal persists (write-through to the existing insight_engagement/learning docs, read at generation) — dismissed stays dismissed across reloads (matches R1's dismissal-is-final posture).
- Diagnostic feedback taxonomy (DR's 6 options) is Phase 1 UI; this task makes the EXISTING signals durable and consumed.

### Task 6: Versioned cutover + QA/docs (Batch R4-0b)
**Files:** orchestrator/basicInsights version stamping + archive-on-first-generation logic, `src/__tests__/validationMatrix.test.js` R4 rows, runbook R4 section, PROJECT_STATUS, CLAUDE.md pointer.
- `generatorVersion` stamped on all new insights; first post-R4 generation archives legacy actives to history with `legacyVersion` mark (nothing deleted); basicInsights cache invalidated once (version key in the cache doc); feedback/exclusions consumed (proved by T5 tests) — THE MIGRATION ANSWER: no data migration, versioned regeneration with preserved corrections.
- Matrix rows: adapter contract (legacy+current+export shapes), no-personal-literals lint, mood-scale invariance, unique-day gating, empty-group-never-zero, reports-read-singleton+mood_score, feedback-consumed, dismissal-persists, cutover-archives-not-deletes.
- Runbook: R4 section (what changed, cutover semantics, risky-claims suppression state); PROJECT_STATUS decisions (the 4 ratified above + DR adoption).

**Batching:** R4-0a = T1 ∥ T2 ∥ T3 ∥ T4 (disjoint trees) → gate → push. R4-0b = T5 → T6 → gate → push → whole-Phase-0 review.

## Phase 1 — evidence foundation (outline; detailed plan when reached)
Daily observation rollup module (EX2 helpers reused); typed assertion/event extraction (DR finding 13 — shared with open-loops quality); versioned `InsightClaim` store + rules block (DR's schema, adapted to our receipts/plan-freeze primitives); hypothesis-family testing ledger (ALSO retrofitted to Personal Experiments — the one DR methodological gap our stack lacks); evidence builder on `buildReceipt`/estimator gates; Quick Insights/correlations surfaces consume claims; diagnostic feedback taxonomy UI.

## Phase 2 — trustworthy synthesis (outline)
Constrained explanation writer + independent verifier (two-pass, DR finding 6); single ranked feed with claim types (observation / pattern-to-watch / experiment-result); contextual insights + Ask Journal + reports route through verified claims; multi-channel retrieval for entry context (DR finding 11). Broad-release comprehension gate (≥80%) lives here.

## Phase 3 — deferred
Action confirmation, N-of-1 extensions beyond current experiments, calibrated predictions (prospective holdout) — mostly already scaffolded by R3; revisit after Phase 2.
