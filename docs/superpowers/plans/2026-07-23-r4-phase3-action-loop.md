# R4 Phase 3 — Action Loop & Risky-Claim Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close R4 by replacing the four suppressed risky-claim modules with the evidence-railed loop the deep review actually prescribed — idea → try-as-experiment → explicit confirmation → outcome claim → repeat — and deleting the mention-based machinery they were built on. Plus the accumulated backlog burn-down.

**Architecture:** Experiments are the action loop's spine: the "Try as an experiment" seam gets wired end-to-end (ClaimCard AND ideas → prefilled ExperimentsScreen), experiments gain an optional *confirmed-exposure* mode (explicit daily "did you do it" check-ins beat mention-inference; frozen into the plan at create), completed hypotheses gain a repeated-trials surface and a "Repeat" path whose result claims supersede the prior run's claim through the normal lineage. The four risky modules (counterfactual, beliefDissonance's validation half, interventionTracker, recommendationEngine's personal-evidence branch) are DELETED — their honest replacements now exist — and `RISKY_CLAIMS_ENABLED` retires with them because nothing suppressible remains.

**Tech Stack:** unchanged (React/Vite client, Firestore + rules emulator, Vitest; ONE rules change for the confirmations subcollection; no new LLM calls — the belief pipeline deletion actually REMOVES unconditional LLM calls).

## Global Constraints

- Execution model identical to Phases 0–2: main, green batches, implementers never run git (controller commits by pathspec), adversarial review per task, ledger updates, full gate before push (`npm test` + `npm run build`; + `npm run test:rules` for the rules task/batch).
- **Flag-OFF today is Michael's LIVE surface.** Deletions must not degrade it beyond the ratified intent: counterfactual/belief insights are already suppressed (no visible change); recommendations already render as generic ideas (visible change ONLY where a personal-evidence literal leaks — which is the fix). Every task states its flag-OFF visible diff explicitly.
- Experiments plan-freeze is inviolable: `exposureMode` must be frozen at create like everything else; `firestore.rules` and the service both enforce; existing experiments (no `exposureMode`) behave exactly as today (passive).
- Claims invariants unchanged: immutable-with-lineage, suppressed never auto-touched, expired revivable, count-before-analyze. Repeat-run claims go through supersede lineage, never rules-denied silent drops.
- The `screenQuestion` safety gate remains the FIRST thing any experiment-creation path runs — including the new prefill path (ExperimentsScreen's binding ordering doc, L41–51).
- Non-causal copy everywhere; Mood01 internal / 0–100 display; no `timeout` prefix; vitest exit codes.
- Matrix/riskyClaims test surgery must preserve non-risky assertions (crossThreadDetector meta-pattern chain, MIN_EVIDENCE floor) by relocating them, never silently dropping.

## Ratified design decisions (controller; Michael veto-window as usual)

| # | Decision | Why |
|---|----------|-----|
| P3-D1 | The four risky modules are DELETED, not re-enabled: `counterfactual.js` (whole), `beliefDissonance.js` (whole — its "corpus-building" half makes unconditional LLM calls with zero consumers), `interventionTracker.js` (whole — mention-based inference is what DR finding 7 condemned), `recommendationEngine.js` reduced to the generic-ideas path. `RISKY_CLAIMS_ENABLED` retires with them (nothing left to gate). Firestore belief/intervention docs left orphaned (harmless, never deleted) | DR finding 7's prescription ("explicit action completion plus pre/post observations... opt-in personal experiments with repeated trials") is now BUILT — the suppressed modules are superseded, and keeping dead code with a dormant re-enable constant invites exactly the resurrection R4 exists to prevent |
| P3-D2 | Action loop = experiments-centered: Try-as-experiment wired end-to-end from BOTH ClaimCards (flag-ON) and idea cards (flag-OFF) into a prefilled ExperimentsScreen; prefill routes through the existing `screenAndProceed` choke point | One loop, one safety gate, no parallel creation path |
| P3-D3 | Action confirmation v1 = per-experiment daily check-ins (`confirmations` subcollection), tag-template experiments only, opt-in at CREATE via frozen `analysisPlan.exposureMode: 'passive'\|'confirmed'`; confirmed mode's exposure series comes from check-ins (explicit beats mention), missing check-in day = UNKNOWN (omitted), never assumed-no | Minimal honest version of "explicit action completion"; passive default preserves every existing behavior |
| P3-D4 | Repeated trials = display + repeat-button, NO pooled statistics: ExperimentResultView gains a family-history section (prior completed runs + their deltas + ledger `timesTested`); "Repeat experiment" creates a fresh experiment (fresh freeze, ledger m increments naturally); the new run's result claim SUPERSEDES the prior run's claim (version+1, `parentClaimId`) — fixing the current silent rules-denial on repeat-run claim writes | Cross-run meta-analysis needs statistics we deliberately don't have; lineage is the honest "latest result replaces prior" semantics claims already use |
| P3-D5 | Calibrated predictions: WONTFIX until a broad-release effort exists (DR requires prospective holdout evaluation; meaningless ceremony at n=1). Documented, not scaffolded | Personal-first repositioning |
| P3-D6 | Nexus LLM synthesis generators (causal synthesis, narrative arc, meta-pattern) are NOT deleted in Phase 3 — they stay, running, as flag-OFF's top-ranked content, and their deletion becomes Michael checklist item (13), unlocked when he flips `insightClaims` | Flag-OFF nexus is his live daily surface; deleting its top content before HE decides to switch surfaces forces his hand. P2-D8's "Phase 3 cleanup" becomes "post-flip cleanup" — reversibility over tidiness |
| P3-D7 | Backlog burn-down rides along: vestigial `model.fusedTranscription35` removed from FLAG_DEFAULTS; flip-flag `STRING_ALLOWED` gains `model.insightWriter`/`model.insightVerifier` (registry-known ids + 'default'); dead default `callGeminiImpl` removed from the handler (explicit injection required); `budgetedInsights` memo gains the `enabled` gate | All are one-liners with existing review context; batching them here avoids four micro-sessions |
| P3-D8 | The ungated sunshine personalized-percentage literal in `getTodayRecommendations` (insightIntegration.js ~L208, "X% higher on sunny days" rendering flag-OFF TODAY) is a Phase-0 decision-4 leak and gets fixed FIRST, independent of the deletions | It is the risky-claim class, live, now |

## Shared contracts

```js
// Experiment confirmations subcollection (T3):
//   artifacts/{APP}/users/{uid}/experiments/{experimentId}/confirmations/{dateKey}
//   { dateKey: 'YYYY-MM-DD', done: boolean, createdAt: ISO }
//   Rules: owner create/update with hasOnly(['dateKey','done','createdAt']);
//   dateKey doc-id == field; delete allowed (un-answering a day → UNKNOWN again).

// analysisPlan gains (frozen at create, inside the plan map — no top-level rules change):
//   exposureMode: 'passive' | 'confirmed'   // absent (legacy) === 'passive'

// Prefill seam (T2):
//   AppLayout state: experimentPrefill: { templateId: string, tag?: string } | null
//   <ExperimentsScreen prefill={experimentPrefill} ...>
//   InsightsPage prop onTryExperiment(templateId, tag) — already exists, now wired.
//   Idea→template map (ideas cards, T2): recovery→'recovery-score-mood',
//   activity→'exercise-minutes-mood', environment→'sunshine-percent-mood';
//   self_care/other → no button.

// Repeat-run claim lineage (T6):
//   buildExperimentResultClaim gains prior-claim awareness at write time:
//   writeResult/writeAdjustedResult find the live prior for (claimType,
//   candidateId); if it exists and is NOT suppressed → supersede with
//   version = prior.version + 1, parentClaimId = prior.id (suppressed → skip,
//   expired → supersede/revive; both invariants already pinned).
```

**Batching:** P3a: T1 (sunshine leak + idea literals, insightIntegration) ∥ T2 (prefill seam, UI tree) ∥ T3 (confirmed-exposure, experiments+rules tree) → gate (incl. rules) → push. P3b: T4 (delete counterfactual+belief, orchestrator) → T5 (delete interventionTracker, ideas-only engine, retire RISKY_CLAIMS_ENABLED, test surgery — same orchestrator/test files as T4, sequential) ∥ T6 (repeated trials, experiments tree) → gate → push. P3c: T7 (backlog + docs/matrix/runbook) → final whole-phase review.

---

### Task 1: Kill the live personalized-reasoning leak; ideas speak generic only

**Files:**
- Modify: `src/services/nexus/insightIntegration.js`
- Test: extend `src/services/nexus/__tests__/insightIntegration.test.js`

**Interfaces:** consumes nothing new; `getTodayRecommendations` return shape unchanged (`{recommendations:[{type,priority,action,reasoning}], ...}`).

Spec:
- The sunshine recommendation's `reasoning` (~L208) currently interpolates a personalized percentage ("...% higher on sunny days") UNGATED — flag-OFF users see it today. Replace with a generic non-evidence line ("Sunshine tends to help some people's mood — worth getting outside if you can."). NO conditional: the personal-evidence variant is deleted, not gated.
- The workout (~L192–194) and pet_walk (~L241–243) `RISKY_CLAIMS_ENABLED ? personal : generic` ternaries: delete the ternary and the personal branch; keep the generic string only. Remove the now-unused `RISKY_CLAIMS_ENABLED` import from this file (the constant itself is retired in T5 — this file just stops importing it early; verify nothing else in the file reads it).
- Flag-OFF visible diff (state in tests + report): sunshine reasoning loses the percentage; workout/pet_walk copy unchanged (they already rendered the generic branch).
- TDD: tests assert no `%` digit-pattern in ANY returned `reasoning` string across a fixture set with rich health/env data (regex `/\d+\s*%/` absent), and the three specific generic strings.

Steps: failing tests → run → implement → `npx vitest run src/services/nexus` + `npm run build` → controller commits.

---

### Task 2: Try-as-experiment seam, end-to-end

**Files:**
- Modify: `src/components/zen/AppLayout.jsx`, `src/components/experiments/ExperimentsScreen.jsx`, `src/pages/InsightsPage.jsx` (pass-through only), `src/pages/InsightsPage` idea cards → `RecommendationsSection` (same file)
- Test: `src/components/experiments/__tests__/ExperimentsScreen.prefill.test.jsx` (create; follow the existing ExperimentsScreen test harness if one exists — find it first), extend `src/pages/__tests__/InsightsPage.claims.test.jsx`

**Interfaces:**
- ExperimentsScreen gains `prefill = null` prop (`{templateId, tag?}`). On mount with a prefill: resolve `getTemplateById(prefill.templateId)` (invalid id → ignore prefill, normal open, console.warn); enter creation flow via the EXISTING path so `screenAndProceed` runs first — for plain templates mirror `handleTemplateTap(template)`, for tag prefill mirror `handleTagTemplateAsk`'s downstream with `{tag}` params. The binding ordering (screenQuestion before any state advance) must be preserved — route through `screenAndProceed`, do not shortcut to `selectTemplateAndAdvance`.
- AppLayout: `experimentPrefill` state; `handleTryExperiment(templateId, tag)` → `setExperimentPrefill({templateId, tag}); setShowExperiments(true)`; pass `onTryExperiment={handleTryExperiment}` to InsightsPage (find how InsightsPage is rendered from AppLayout — verify the component boundary; if InsightsPage is not a direct child, thread through the actual parent) and `prefill={experimentPrefill}` to ExperimentsScreen; clear prefill on ExperimentsScreen close. GATE: only pass `onTryExperiment` when `getFlag('personalExperiments')` — a button that opens a flag-hidden screen must not render.
- RecommendationsSection (flag-OFF ideas): add the idea→template map (Shared contracts) and a "Try as an experiment" button per mapped idea, same handler, same personalExperiments gating; unmapped types → no button.

Tests: prefill lands on the space/duration step with the template selected AND `screenQuestion` was invoked first (spy on the questionGate module); invalid templateId → normal open + warn; tag prefill carries the tag; ClaimCard path now renders its button when AppLayout wires the handler (page-level test with handler present); ideas cards show buttons only for mapped types and only when personalExperiments ON; flag-OFF page without personalExperiments → zero new buttons anywhere.

Steps: TDD → `npx vitest run src/components/experiments src/pages src/components/insights` + `npm run build` → controller commits.

---

### Task 3: Confirmed-exposure experiments (action confirmation v1)

**Files:**
- Modify: `src/services/experiments/experimentsService.js` (buildAnalysisPlan `exposureMode`, confirmations CRUD), `src/services/experiments/computeResult.js` (confirmed-mode exposure series), `src/components/experiments/ExperimentsScreen.jsx` (create-flow opt-in toggle for tag templates + active-experiment daily check-in row), `firestore.rules` (+ subcollection block), `functions/src/__tests__/firestoreRules.test.js`
- Test: extend `experimentsService.test.js`, `computeResult` tests, screen tests

**Interfaces:**
- `buildAnalysisPlan(template, params)`: `params.exposureMode` accepted ONLY for tag templates ('confirmed'); anything else/absent → 'passive'. Frozen in the plan map (no top-level rules change needed — verify against the create hasOnly list).
- `setConfirmation(db, uid, experimentId, dateKey, done)` / `clearConfirmation(...)` / `listConfirmations(db, uid, experimentId)` — doc id = dateKey; only while experiment status === 'running' (client-enforced; stopped/completed experiments' confirmations are frozen history).
- `computeExperimentResult`: when `plan.exposureMode === 'confirmed'`, the exposure day-series comes from confirmations (`done:true` → 1, `done:false` → 0, no doc → day OMITTED/UNKNOWN — never assumed absent) instead of tag scanning; outcome side unchanged; `experiment.confirmations` passed in as a new optional input (`computeExperimentResult({experiment, entries, confirmations, now})` — pure, caller loads them; absent+confirmed-mode → all-UNKNOWN → insufficiency, which is the honest outcome). Passive mode byte-identical (regression: existing suites).
- Rules block per Shared contracts + emulator tests (owner CRUD exact keys; non-owner denied; extra key denied).
- ExperimentsScreen: create flow shows a "How should we track it?" step ONLY for tag templates (passive default, confirmed opt-in, one-line honesty copy: confirmed = you check in daily; missed days count as unknown, not no); active running confirmed-mode experiments render a today check-in row (Did you do X today? Yes / No / clear).
- Result view: confirmed-mode results state their exposure source ("from your daily check-ins, N days answered").

Steps: TDD (service → computeResult → rules → UI) → `npx vitest run src/services/experiments src/components/experiments` + `npm run test:rules` + `npm run build` → controller commits.

---

### Task 4: Delete counterfactual + belief pipelines

**Files:**
- Delete: `src/services/nexus/layer3/counterfactual.js` (+ its test), `src/services/nexus/layer3/beliefDissonance.js` (+ its test)
- Modify: `src/services/nexus/orchestrator.js` (belief block L604–648, counterfactual block L692–720, related imports/context), `src/__tests__/validationMatrix.test.js` (rows/mocks referencing the two modules — trim mocks L300/308, re-scope R4 row (c) Mood01-invariance to modules that still exist or retire it with an explicit tombstone comment), `src/services/nexus/__tests__/orchestrator.riskyClaims.test.js` (see T5 — coordinate: T4 removes the counterfactual/belief assertions only)
- Grep-sweep: any other importer of either module (recon says orchestrator-only; verify).

Spec: whole-module deletion; orchestrator blocks removed cleanly (including the unconditional extract→refine→save belief chain — this REMOVES unconditional per-generation LLM calls; say so in the commit message); `synthesisContext` no longer receives belief/counterfactual inputs; Firestore belief docs orphaned-not-deleted (tombstone comment in orchestrator noting the collection may contain legacy docs). Flag-OFF visible diff: NONE (both insight types were suppressed).

Steps: grep-verify importers → delete → trim orchestrator → fix tests (relocate any non-risky assertion; the Mood01-invariance matrix row either re-pins on surviving modules or is tombstoned with rationale) → `npx vitest run src/services/nexus src/__tests__/validationMatrix.test.js` + `npm run build` → controller commits.

---

### Task 5: Delete interventionTracker; ideas-only engine; retire RISKY_CLAIMS_ENABLED

**Files:**
- Delete: `src/services/nexus/layer4/interventionTracker.js` (+ test)
- Modify: `src/services/nexus/layer4/recommendationEngine.js` (ideas-only: drop `context.riskyClaimsEnabled`, `scoreRecommendation`'s personal-evidence scoring, `generateReasoning`/`predictOutcome`; keep state→intervention map + `genericIdeaReasoning` + MIN_EVIDENCE floor if it still gates anything meaningful — if the floor only fed scoring, drop it and its test), `src/services/nexus/orchestrator.js` (remove `updateInterventionData`/`getInterventionData` calls + `riskyClaimsEnabled` threading + the title ternary → always 'An Idea to Try'; delete the `RISKY_CLAIMS_ENABLED` export L78–100 with a tombstone comment pointing at this plan), `src/services/nexus/insightIntegration.js` (remove `getInterventionData` consumption — the recommendations that depended on it either go generic-static or are dropped; T1 already de-personalized reasoning), `src/services/nexus/__tests__/orchestrator.riskyClaims.test.js` (RETIRE: rename to `orchestrator.ideas.test.js` pinning: ideas always titled 'An Idea to Try', never score/expectedOutcome fields, and RELOCATE the crossThreadDetector meta-pattern chain assertion into `crossThreadDetector.test.js` or a new orchestrator test — never dropped), `src/__tests__/validationMatrix.test.js` (intervention mocks L313, pet_walk denylist fixture L2497+ re-pointed at surviving prompt surfaces, LLM_WRITER row untouched)
- Grep-sweep: every `RISKY_CLAIMS_ENABLED` reference repo-wide must be gone (orchestrator, insightIntegration [T1 removed import], any test, runbook mention updated in T7).

Spec: flag-OFF visible diff: NONE beyond T1's (recommendations were already generic-labeled; intervention-derived recommendations that only existed under the gate disappear from a dark path). The `generateComprehensiveInsights` orphan was deleted in Phase 1 — verify no resurrected consumer of interventionData remains (recon lists insightIntegration L17,165 — handled here).

Steps: TDD on the reshaped engine (ideas-only contract) → deletions → orchestrator/insightIntegration trim → test surgery with relocation → full `npx vitest run src/services/nexus src/__tests__/validationMatrix.test.js` + `npm run build` → controller commits.

---

### Task 6: Repeated trials — family history, repeat button, claim lineage fix

**Files:**
- Modify: `src/services/experiments/experimentClaim.js` + `experimentsService.js` (repeat-run claim supersede), `src/components/experiments/ExperimentResultView.jsx` (family-history section), `src/components/experiments/ExperimentsScreen.jsx` (Repeat button on completed experiments → reuses the T2 prefill path INTERNALLY: same template/params, fresh create flow through screenAndProceed)
- Test: extend experiment claim/service tests + a result-view test

**Interfaces:**
- **Lineage fix (the load-bearing part):** `writeResult`'s claim write currently does a bare `writeClaim` whose deterministic id collides with the prior run's claim → rules-denied → contained warn → repeat runs NEVER get claims. Change: find the live prior for (claimType 'experiment_result', same `candidateId`) exactly as `writeAdjustedResult` does post-F1: none → v1; prior suppressed → SKIP (invariant); prior expired or verified → supersede (`version: prior.version+1`, `parentClaimId: prior.id`). Extract the shared find-prior-and-decide helper both writeResult and writeAdjustedResult use (they now have identical semantics; one implementation). Tests: repeat run supersedes prior verified run's claim (both docs, lineage); suppressed prior → skip; first run unchanged.
- Family history: `listFamilyRuns(db, uid, hypothesisFamilyId)` in experimentsService — completed experiments whose `analysisPlan.hypothesisFamilyId` matches, sorted by completion, each with `{id, completedAt, delta: result.original.estimate?.delta ?? null, status}`; ExperimentResultView renders "This hypothesis, run N of M" + prior runs' deltas + `timesTested` from the ledger (read-only; failure → section hidden). NO pooling, no combined statistics — a one-line note says each run stands alone.
- Repeat button: completed experiment → "Repeat this experiment" → the T2 prefill mechanism with the same `{templateId, tag}` (fresh freeze; ledger increments; exposureMode chosen fresh in the create flow).

Steps: TDD (lineage helper first — it fixes a real defect) → history + button → `npx vitest run src/services/experiments src/components/experiments src/services/insights/claims` + `npm run build` → controller commits.

---

### Task 7: Backlog burn-down + docs/matrix/runbook close-out

**Files:**
- Modify: `src/config/flags.js` (remove vestigial `model.fusedTranscription35`; grep consumers first — recon says none), `scripts/flip-flag.mjs` (STRING_ALLOWED += `model.insightWriter`/`model.insightVerifier` with registry-known ids + 'default'), `functions/src/insights/writeClaimWordingHandler.js` (remove dead default `callGeminiImpl` — parameter becomes required; update its tests), `src/hooks/useNexusInsights.js` (budgetedInsights memo `enabled` gate one-liner + test), `src/__tests__/validationMatrix.test.js` (R4P3 rows), `docs/quality/trustworthy-capture-runbook.md` (R4 Phase 3 section), `PROJECT_STATUS.md`, `CLAUDE.md`

**Matrix rows (R4P3, real modules):**
- (a) no-personal-evidence-in-ideas — full `getTodayRecommendations` + orchestrator ideas output over a rich fixture: zero `/\d+\s*%/` in any reasoning/title, title always 'An Idea to Try'.
- (b) risky-modules-gone — the four modules unresolvable (import throws / files absent) AND repo-wide grep-in-test asserts no `RISKY_CLAIMS_ENABLED` references (source of truth: fs walk in the test, mirroring the personal-literals lint pattern).
- (c) prefill-safety-order — prefilled ExperimentsScreen invokes screenQuestion before any template state advance.
- (d) confirmed-exposure-tri-state — confirmed-mode: done:true→1, done:false→0, missing→omitted; passive byte-identical on legacy plans.
- (e) repeat-run-lineage — second run's claim supersedes first (both docs), suppressed prior skipped.
- (f) confirmations-rules — referenced by name to the emulator suite (comment) + JS-side seam test.

**Docs:** runbook R4 Phase 3 section (deletions + what replaced them, confirmed-exposure semantics + honesty copy, repeat lineage, P3-D5 predictions-wontfix rationale, P3-D6 → NEW Michael checklist item (13): "after flipping insightClaims and living with the ClaimFeed, say the word and the nexus LLM synthesis generators get deleted"); PROJECT_STATUS (active work, P3-D1..D8 decisions row — transcribe faithfully, the Phase-2 lesson — checklist items 13 + confirmed-exposure note); CLAUDE.md R4 paragraph extension (2–3 sentences, exact plan filename `docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md`).

Steps: burn-down edits (each asserted) → matrix rows → docs → full gate (`npm test`, `npm run test:rules`, `npm run build`) → controller commits.

---

## Self-review (performed at plan time)

1. **Coverage vs the deferred list + accumulated backlog:** action confirmation → T3; N-of-1 extensions → T3 (confirmed mode) + T6 (repeated trials); calibrated predictions → P3-D5 wontfix documented in T7; risky-module disposition → T1/T4/T5; Try-as-experiment seam (Phase-1/2 backlog) → T2; repeat-claim rules-denial defect (Phase-2 recon find) → T6; sunshine leak → T1; four backlog one-liners → T7; synthesis deletion → deliberately deferred to checklist (13) per P3-D6.
2. **Placeholders:** contracts and exact behaviors specified per task; verify-then-align notes (ExperimentsScreen harness existence, AppLayout→InsightsPage boundary, create hasOnly list) are explicit instructions with the contract stated.
3. **Consistency:** prefill shape `{templateId, tag}` identical in T2 (seam), T6 (repeat reuse), ClaimCard's existing `onTryExperiment(templateId, tag)` signature; the supersede-decision helper is defined once (T6) and shared by both writers; `exposureMode` naming identical in T3's service/computeResult/rules/UI.
4. **Order-of-risk:** the live leak (T1) and the tree-disjoint additive features (T2, T3) land first; destructive deletions (T4→T5) come only after a green additive batch, sequenced on their shared files; T6's lineage fix precedes any repeat-button UI that would exercise it.

## Execution handoff

Subagent-driven (as Phases 0–2): P3a → P3b → P3c, adversarial review per task, whole-phase final review on the most capable model, gate + push per batch, ledger after every task.
