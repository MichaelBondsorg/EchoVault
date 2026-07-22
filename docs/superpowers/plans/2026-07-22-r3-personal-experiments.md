# R3 — Personal Experiments (PRD §5.4 "Learn Carefully")

**Date:** 2026-07-22
**Base:** tip of main after Batch R2-8 (all 21 R2 tasks complete, flags OFF)
**Flag:** `personalExperiments` (new, default OFF — stays OFF until Michael signs the data-method spec, mirroring the gentleRevisit/safety-memo gate)
**Execution model:** identical to R1/R2 — work on main; push only fully-green batches (`npm test` + `npm run typecheck` + `npm run build`); implementers NEVER push; rules suite is CI-only; subagent-driven development with adversarial task reviews.

**User promise (PRD):** "The user can explore a personally meaningful relationship in their data without being told that correlation proves cause."

---

## Proposed product decisions (conservative defaults — Michael may veto any)

1. **Observational v1 only.** PRD P1's A/B or alternating-condition design is deferred outright (PRD itself orders it after the observational v1 is "understood and safety-reviewed").
2. **Passive variables only — zero new check-in surfaces in v1.** Every v1 variable pair is computed from data Engram already captures (entry mood, health context, environment context, tag presence). "Minimum check-ins needed" therefore equals zero extra prompts; the UI shows *data coverage* (per the PRD: coverage, never a streak). A structured daily check-in surface (new collection + notification flow) is deferred until a variable pair genuinely requires it. This removes the entire net-new notification/capture scope the exploration flagged as missing.
3. **Questions resolve to a curated template catalog.** The user can pick a template ("Does sleep affect my mood?") or type a question; typed questions are matched to a template (variable pair + confounder list + lag structure). A question that maps to no template, or that trips the safety gate, is declined with a safer reflection alternative (Recipes) — never silently coerced. Arbitrary free-variable experiments are out of scope for v1 (data-method tractability + safety).
4. **Client-side result computation.** Results are computed on-demand in the client from the user's own entries via a pure estimator module (same posture as R2's client-side Nexus receipts). No scheduled function, no new deploy surface, no consent gate (no provider calls anywhere in the experiment pipeline — the result narrative is template-composed, not LLM-generated).
5. **No LLM narrative in v1 results.** The result text is assembled from fixed, safety-reviewed template strings with slotted numbers ("On the 12 days with more than your median sleep, your mood averaged 8 points higher (0–100 scale). This is an association — it does not show that sleep caused the change."). Fixed "plausible alternatives" come from each template's confounder catalog. This makes the non-causal-wording acceptance criterion structural rather than model-behavioral, and eliminates retrofitting risk in narrative generation.
6. **Experiments are a NEW `experiments` collection**, not a reflections `kind`. The plan-freeze invariant (question + analysis plan immutable once running) is enforced in firestore.rules via the `diff().affectedKeys().hasOnly([...])` pattern (intents/revisit_queue precedent). The result embeds a standard receipt (`buildReceipt` shape) — experiments reuse, not reinvent, provenance.
7. **Estimator consolidation is in-scope.** The three inconsistent Pearson implementations stay untouched for their current consumers, but experiments get one new pure estimator module with a structured `{insufficient}` return — no magic-zero correlations. (A later cleanup task may migrate old consumers; not in R3.)
8. **P1 "export experiment receipt in Session Prep" deferred** to a follow-up once experiments have real usage; noted in the runbook.

## Michael's gates (do NOT execute; accumulate)

- **Sign off `docs/quality/experiments-data-method.md` before `personalExperiments` ever flips** (PRD P0: "Require a data-method review… before implementation" — the spec is written and applied in code first, the *flag* waits for the sign-off).
- Ratify/veto the 8 decisions above.
- PRD comprehension gate ("80% of users interpret a result as association not proof of cause") is a launch-research item, not a code task — tracked in PROJECT_STATUS.

## Global constraints (bind every task)

- All new UI/behavior behind `personalExperiments` (default false). Register the flag in `FLAG_DEFAULTS` before any call site (`getFlag` throws in DEV on unknown names).
- No provider/LLM calls anywhere in the experiments pipeline; document the no-consent-gate rationale in-code (gentleRevisit precedent).
- SAFETY: unsafe/medical/prescriptive questions must be declined (client screen + server-authoritative mirror is NOT needed in v1 because no server writes accept free-text questions — the question text lives only in the user-owned experiment doc; the DECLINE gate is a UX/safety surface, pure client fn, unit-tested exhaustively). Crisis-keyword hits additionally surface the safety plan (existing `checkCrisisKeywords`).
- Plan-freeze: `question`, `analysisPlan`, `template`, `scope`, `createdAt` immutable once status leaves `draft` — rules-enforced, service-enforced, and tested at both layers.
- Stopping/pausing is immediate and never deletes source entries (PRD acceptance). Delete removes the experiment doc only.
- Insufficiency is a first-class result state: below the data-method thresholds there is NO estimate narrative, only the plain-language insufficiency state.
- Receipt on every result (`buildReceipt` shape: sources, scope, timeWindow, sampleSize, missingness, versions.generator = 'experiment_v1').
- Strict scope filtering at the retrieval seam (scopeFilter, R1/R2 convention); exclusions: v1 result honors per-observation exclusions stored ON the experiment doc (observation-level inspect/exclude + rerun, PRD acceptance) — source_exclusions integration deferred (different semantics: those target insight families).
- No-null-stuffing except where a rules `hasOnly` shape requires a field. 44px targets, single aria-modal + `inert="true"` string, cloud design system, no direct Firestore in UI (all writes via the service), owner-scoped local caches.
- Conventions from R2 reviews: no `min-h-[3xpx]` overrides into Button; SpacePicker usage gated behind `contextSpaces` (subscribe + render, `setSpaces([])` reset); payload-exactness tests against rules allow-lists; every cross-module call site verified against the REAL signature with at least one unmocked integration test.

---

## Batch R3-1 — data-method spec + estimator + rules

### Task 1: Data-method spec + pure estimator core

**Files:**
- Create: `docs/quality/experiments-data-method.md`
- Create: `src/services/experiments/estimator.js` + `src/services/experiments/__tests__/estimator.test.js`

**Interfaces:**
- **Spec doc** (BLOCKS flag-flip; explicit unchecked sign-off line for Michael; gentle-revisit-safety.md is the structural template). Conservative defaults it must codify (all enforced by the estimator):
  1. **Minimum paired observations:** ≥10 paired days (both variables present on the same calendar day, or exposure day + outcome day for lag-1 templates). Below → insufficiency, no estimate.
  2. **Missingness limit:** each variable must cover ≥50% of the experiment's elapsed days; otherwise insufficiency. Coverage is reported per-variable as "N of M days" (reuse `computeMissingness`'s day-bucketing approach).
  3. **Estimator:** split days at the exposure variable's median → difference in mean outcome between high/low groups, with a 95% bootstrap CI (2,000 resamples, seeded/deterministic in tests). Chosen over raw Pearson for comprehensibility and robustness; Pearson r is computed as a supplementary internal field but never headlines.
  4. **Outlier handling:** none removed in v1 — median split is already rank-robust on the exposure side; outcome means are reported as-is with the CI carrying the spread. (Documented as the deliberate conservative choice; winsorization deferred.)
  5. **Uncertainty display:** CI always shown in plain language; CI spanning zero → "no clear association" wording, never "no effect".
  6. **Lag structure:** each template pre-declares same-day or next-day (lag-1) — part of the frozen analysis plan.
  7. **Multiple realizations:** one experiment = one variable pair = one pre-declared estimate. No secondary/spliced analyses on the result screen.
  8. Fixed non-causal wording + "what this does not prove" strings (verbatim in the spec, consumed by Task 5's templates).
- **`estimator.js`** — PURE (no Firebase): `pairObservations({exposureSeries, outcomeSeries, lag})` → paired days; `computeCoverage(series, startMs, endMs)` → `{covered, total, label}`; `runAnalysisPlan({pairs, plan, seed})` → `{status:'ok', estimate:{meanHigh, meanLow, delta, ci:[lo,hi], n, pearsonR}} | {status:'insufficient', reasons:[...]}` applying spec thresholds exactly; deterministic bootstrap via injected seedable RNG (no Math.random at module level — testability + the plan's no-retrofit spirit).
- [ ] TDD: golden fixtures (hand-computed small sets), insufficiency at 9 pairs / ok at 10, coverage boundary at exactly 50%, CI-spans-zero classification, lag-1 pairing correctness, determinism (same seed → same CI), NaN/missing values dropped from pairing (never coerced to 0 — the magic-zero Pearson bug class from the existing three implementations).
- [ ] Green. Commit `experiments: data-method spec (sign-off gated) + pure estimator core (flag: personalExperiments pending)`.

### Task 2: Flag + rules + settings clause

**Files:**
- Modify: `src/config/flags.js` (`personalExperiments: false`), `firestore.rules`, `functions/src/__tests__/firestoreRules.test.js` (CI-only executor — note in ledger to watch deploy), `firestore.indexes.json` only if a query in later tasks needs it (expected: none — experiments list is a small per-user collection).

**Interfaces:**
- `match /experiments/{experimentId}`: `allow read, delete: if isOwner(userId)`. `allow create` requires `hasOnly(['question','template','analysisPlan','scope','status','startAt','endAt','durationDays','excludedObservations','result','createdAt','updatedAt'])`, `question is string && question.size() <= 200` (with `is string` FIRST — the Task 7 `.size()`-on-composite lesson), `template is string`, `status == 'draft'`, `durationDays in [14, 28]`, `excludedObservations is list`, no `result` on create. `allow update` ONLY `diff().affectedKeys().hasOnly(['status','excludedObservations','result','updatedAt'])` + status transitions constrained to `draft→running→(paused↔running)→stopped|completed` expressed as an allow-list of (before,after) pairs; `result` writable only when after-status is `completed`.
- `settings/experimentPrefs` clause in the settings chain: `hasOnly(['enabled','optInAt','updatedAt']) && enabled is bool` (revisitPrefs twin) — used only to remember the one-time explainer; experiments themselves are per-doc.
- [ ] Rules tests: create shape (deny extra keys, deny non-draft create, deny result-on-create, deny 21-day duration), plan-freeze (deny question/analysisPlan/template/scope/createdAt change after create), status-transition matrix (each legal pair allowed, illegal pairs denied incl. completed→running), result-only-when-completed, owner isolation.
- [ ] Green. Commit `experiments: personalExperiments flag + plan-freeze rules + prefs clause`. **Batch R3-1 gate:** green → push (rules ride CI — verify deploy behavior noted in ledger; functions deploy still blocked on Michael's digest-delete command, harmless).

## Batch R3-2 — service + templates + safety gate

### Task 3: Template catalog + experiments service + preflight

**Files:**
- Create: `src/services/experiments/templates.js` + test, `src/services/experiments/experimentsService.js` + test, `src/services/experiments/preflight.js` + test

**Interfaces:**
- **`templates.js`** — pure catalog, v1 set (all passive variables, per decision 2): sleep-hours→mood (lag-1 + same-day variants), exercise-minutes→mood, sunshine-percent→mood, steps→mood, recovery-score→mood, tag-presence→mood (user picks one of their existing tags, e.g. `@person:` — variable = tag present that day). Each: `{id, title, questionPatterns[], exposure:{source:'health'|'environment'|'tags', field, label}, outcome:{field:'analysis.mood_score', label:'mood'}, lag, confounders:[fixed strings], whatThisDoesNotProve:[fixed strings]}`. `matchQuestionToTemplate(text, availableTags)` → template|null (keyword matching; null → decline path).
- **`experimentsService.js`** — CRUD char-exact to Task 2 rules: `createExperiment` (status 'draft'), `startExperiment` (draft→running, stamps startAt/endAt from durationDays — the freeze moment), `pauseExperiment`/`resumeExperiment`/`stopExperiment` (immediate; never touches entries), `deleteExperiment`, `subscribeExperiments`, `setObservationExcluded(expId, dateKey, excluded)` (updates `excludedObservations` list — the PRD inspect/exclude seam), `writeResult(expId, result)` (only alongside status 'completed'). Payload-exactness tests against the rules allow-lists (R2 regression-guard pattern).
- **`preflight.js`** — pure given `{entries, template, scope, now}`: available history length, expected coverage per variable from the last 28 days' actual capture rate, missing sources ("no Whoop data connected" via existing sufficiency-check style), confounder list passthrough, duration recommendation (14 vs 28 from coverage), `appropriate: boolean` + reasons. Mirrors `checkHealthDataSufficiency`'s shape.
- [ ] TDD incl. scope filtering (scoped experiment sees only scoped entries — strict filter convention), preflight on empty history, tag-template with zero tag occurrences → not appropriate.
- [ ] Green. Commit `experiments: template catalog + service (plan-freeze contract) + preflight`.

### Task 4: Unsafe-question gate

**Files:**
- Create: `src/services/experiments/questionGate.js` + test (pure, in experiments not safety/ — it is experiment-specific policy composed FROM safety primitives)

**Interfaces:**
- `screenQuestion(text)` → `{verdict:'ok'} | {verdict:'crisis'} | {verdict:'medical'} | {verdict:'unmappable'}`. Crisis via existing `checkCrisisKeywords`/`checkWarningIndicators` (reuse, do not fork the regexes). Medical/prescriptive via a new conservative pattern list (medication names/classes, dosage, diagnose/cure/treat/should-I-stop-taking, self-harm-adjacent phrasings not already in crisis list) — pattern list lives in questionGate.js with rationale comments; over-blocking is acceptable, under-blocking is not (fail-closed on ambiguity, PRD: "declined with a safer reflection alternative").
- Decline UX contract (consumed by Task 6): crisis → safety-plan surface + no experiment; medical → fixed decline copy + suggestion to bring it to a professional + safer reflection alternative (link to Recipes); unmappable → "not something Engram can measure" + template picker.
- [ ] TDD: adversarial fixture set (≥40 cases: obvious medical, oblique medical, crisis, benign-with-scary-words like "sick of meetings", each template's canonical questions pass) — 100% of unsafe fixtures declined; benign set passes.
- [ ] Green. Commit `experiments: unsafe-question gate (fail-closed, fixture-gated)`. **Batch R3-2 gate:** green → push.

## Batch R3-3 — result pipeline + UI

### Task 5: Result computation + receipt + narrative templates

**Files:**
- Create: `src/services/experiments/computeResult.js` + test

**Interfaces:**
- `computeExperimentResult({experiment, entries, now})` — pure orchestration: scopeFilter → date-window filter (startAt..min(endAt,now)) → build exposure/outcome series from the template's source fields (health/env extraction reusing `extractHealthSignals`/`extractEnvironmentSignals` field paths; tags from entry.tags; outcome from analysis.mood_score) → drop `excludedObservations` dateKeys → estimator (`runAnalysisPlan` with the FROZEN plan from the doc — never re-derived) → result object: `{status:'ok'|'insufficient', estimate?, coverage:{exposure, outcome}, receipt: buildReceipt({sources: contributing entries, scope, timeWindow, sampleSize: nPairs, missingness, generator:'experiment_v1'}), narrative:{summary, alternatives[], whatThisDoesNotProve[], insufficiency?}}` — narrative strings assembled ONLY from the template + data-method spec fixed strings with slotted numbers (no LLM; spec strings imported, not duplicated).
- Rerun-after-exclusion: computeResult is deterministic given (experiment, entries) — the UI calls it again after `setObservationExcluded`; test proves an excluded observation changes/removes exactly its contribution.
- [ ] TDD: end-to-end golden fixture (28 synthetic days, hand-computed estimate), insufficiency path produces NO estimate/summary fields (payload-exactness — absence asserted, not just undefined), receipt invariant (every ok AND insufficient result carries a receipt), safety: entries with `safety_flagged`/`has_warning_indicators` are INCLUDED in stats (they are the user's own data; excluding them would bias mood estimates) but NEVER appear in receipt source excerpts (source list filters them — same posture as session-prep export; test with adversarial fixture).
- [ ] Green. Commit `experiments: deterministic result pipeline + receipt + fixed non-causal narrative`.

### Task 6: Experiments UI

**Files:**
- Create: `src/components/experiments/ExperimentsScreen.jsx` + test, `src/components/experiments/ExperimentResultView.jsx` + test
- Modify: `src/components/zen/AppLayout.jsx` + `src/pages/SettingsPage.jsx` (nav row "Experiments", double-gated `personalExperiments` — RecipesScreen mount precedent)

**Interfaces:**
- **Create flow:** question input (template picker + free-text with `matchQuestionToTemplate`) → questionGate (decline UX per Task 4 contract) → SpacePicker (contextSpaces-gated, R2 pattern verbatim) → duration 14/28 → **preflight review screen** (PRD: "reviews the observations Engram proposes to use" — coverage, missing sources, confounders, appropriateness; a not-appropriate preflight disables Start with reasons) → explicit Start (the freeze moment; copy states the plan locks).
- **Running card:** coverage-so-far per variable ("9 of 14 days have sleep data"), NEVER streak/guilt framing (assert-absence test, gentleRevisit precedent), pause/resume/stop/delete (stop confirm-gated; copy confirms entries untouched).
- **Result view:** sample size, per-variable coverage/missingness, plain-language estimate + CI, alternatives list, "what this does not prove", the receipt's source list (`SourceList` component reuse), observation inspector (paired days table; exclude toggle per row → `setObservationExcluded` → recompute → visible rerun), insufficiency state renders the spec's plain-language copy and NOTHING estimate-shaped.
- One-time explainer on first entry to the create flow ("associations, not proof" — the PRD comprehension framing), persisted via `settings/experimentPrefs` + ownerScope pattern.
- [ ] TDD: gate/decline paths render correct UX per verdict; preflight-blocks-start; freeze copy present; coverage-not-streak copy assertions; exclude→rerun round-trip with real computeResult (mock only firebase); result payload rendered fields match computeResult output exactly; null states (flag off, no experiments).
- [ ] Green. Commit `experiments: create/preflight/run/result UI (flag: personalExperiments)`. **Batch R3-3 gate:** green → push.

## Batch R3-4 — QA/docs

### Task 7: Validation rows, runbook, status

**Files:**
- Modify: `src/__tests__/validationMatrix.test.js` — R3 rows: (a) unsafe-question fixture set declined 100% (real questionGate); (b) plan fields immutable service-side after start (real service against mocked-firebase write capture; rules layer covered by CI suite); (c) insufficiency below spec thresholds yields no estimate (real estimator, boundary fixtures); (d) every result — ok and insufficient — carries a receipt; (e) stop is immediate and writes nothing to entries; (f) excluded observation changes exactly its contribution on rerun; (g) flagged-entry excerpts never in receipt sources.
- Modify: `docs/quality/trustworthy-capture-runbook.md` ("R3 flag" section: rollback, the data-method sign-off gate), `CLAUDE.md` (extend the R2 paragraph with one R3 sentence), `PROJECT_STATUS.md` (decisions incl. the 8 above once ratified; Michael's gate list).
- [ ] Green. Commit `qa+docs: R3 validation rows, runbook, status`. **Batch R3-4 gate:** green → push.

Then: **final whole-R3 review** (most capable model; MERGE_BASE = the R2-8 tip), one fix subagent for the complete findings list, ledger close-out.
