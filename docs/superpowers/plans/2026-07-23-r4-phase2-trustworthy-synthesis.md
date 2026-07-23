# R4 Phase 2 — Trustworthy Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an LLM back into insight prose the only safe way — a constrained writer that may explain ONLY a deterministic evidence bundle, policed by an independent verifier that rejects anything not entailed — and make verified claims the single source every surface consumes: one ranked feed, Ask Journal, contextual entry insights, and reports.

**Architecture:** Claims keep their Phase-1 lifecycle unchanged (client pipeline, immutable docs, ledger, retraction). Phase 2 intercepts ONE moment: wording authorship at claim creation. A new server callable (`writeClaimWording`) runs writer → verifier server-side (consent + quota + model registry); on ANY failure or rejection the pipeline falls back to the Phase-1 deterministic template — a claim can never fail to exist because the LLM misbehaved, and LLM prose can never reach a doc unverified. Experiment results become `experiment_result` claims at result time. Surfaces then unify: the InsightsPage feed (flag ON) renders claims only; Ask Journal and reports consume verified claims instead of unverified nexus prose.

**Tech Stack:** Firebase Cloud Functions (Node 20) for writer/verifier, client React/Vite, Vitest (+ rules emulator where rules change — none planned), Gemini via `functions/src/models/registry.js` workloads.

## Global Constraints

- Execution model identical to Phases 0–1: main, green batches, implementers never run git (controller commits by pathspec), adversarial review per task, ledger `.superpowers/sdd/progress.md` after every task, full gate (`npm test` + `npm run build`, + `npm run test:rules` when firestore.rules changes) before every push.
- **The LLM writes `wording` ONLY.** It never authors evidence, numbers-as-facts, limitations, direction, or receipts. `buildClaim` remains the single construction path (its CAUSAL_RE + strict shape validation now guards LLM output too).
- **Verifier before persistence, always.** No code path may write LLM wording to a claim doc without a verifier PASS. Verifier failure → deterministic template fallback (never a blocked claim, never a retry loop beyond MAX_WRITER_ATTEMPTS = 2).
- **Sensitive-day rule inherited absolutely:** the writer prompt may include ONLY visible `receipt.sources` excerpts (≤120 chars each, already sensitive-filtered by the evidence builder). Hidden-day text/ids never reach any prompt.
- Server LLM calls follow the established callable pattern: auth + `assertAiConsent(db, userId)` + `assertWithinLimit` + `enforceDailyQuota` + `getModel(db, workload)`. New registry workloads: `insightWriter`, `insightVerifier` (verifier model MUST differ from writer model by default — independence).
- Internal constant gate, R4 convention: `LLM_WRITER_ENABLED = false` in `claimsPipeline.js` (analogous to `RISKY_CLAIMS_ENABLED`) — Phase 2 ships with the writer path DARK even when `insightClaims` is ON. Tests exercise it via an options override; Michael flips the constant (or we make it a flag later) after eyeballing verifier behavior.
- Flag-off inertness: with `insightClaims` OFF, every surface is byte-identical to today (matrix row R4P1-i must keep passing untouched).
- Non-causal copy everywhere; mood 0–1 internal / 0–100 display; tri-state missingness; no `timeout` command prefix on this machine; vitest exit codes, never grep counts.
- `RISKY_CLAIMS_ENABLED` stays `false`. Nexus generation keeps running dark (its deterministic layers feed threads/receipts); Phase 2 only changes what DISPLAYS and what feeds prompts.
- The DR's ≥80% comprehension gate: documented process gate for any future broad release; NO in-app quiz is built (personal-first repositioning — single-user ceremony; see D7).

## Ratified design decisions (controller; Michael veto-window as usual)

| # | Decision | Why |
|---|----------|-----|
| P2-D1 | Writer/verifier run server-side in ONE new callable `writeClaimWording` (writer call + verifier passes inside the function); client pipeline calls it per eligible claim | Model pinning, consent/quota enforcement, and prompt privacy all live server-side today; one round-trip per claim; client keeps zero LLM access |
| P2-D2 | LLM wording happens at claim CREATION only; claims stay immutable; rejection → deterministic template with `wordingSource:'deterministic_template_v1'`, acceptance → `'llm_writer_v1'` + `provenance.writerModel`/`verifierModel` | Avoids prose-churn supersedes; preserves Phase-1 lineage semantics untouched |
| P2-D3 | Verifier = deterministic core (numeral reconciliation against the bundle, CAUSAL_RE, subject/direction consistency, length/sentence caps, banned-phrase list) + an independent-model LLM entailment check; BOTH must pass | DR finding 6: "a verifier rejects any sentence or number not entailed"; deterministic core makes the common failure modes cheap and non-flaky; LLM check catches semantic invention |
| P2-D4 | Experiment results become `experiment_result` claims at `writeResult` time (deterministic wording from the existing computeResult narrative — NO LLM); adjusted results supersede the original claim (lineage mirrors the experiments' own original/adjusted contract) | Completes the DR's three claim types with zero new statistics; experiments prose is already non-causal and receipt-backed |
| P2-D5 | Single feed (flag ON) = verified claims only, ranked deterministically (claimType weight: experiment_result > pattern_to_watch > observation; then |effectMoodPoints|, then recency). The legacy "AI Insights" (Nexus) section and RecommendationsSection HIDE when flag ON; Correlations section stays (deterministic, distinct visualization). Flag OFF = everything exactly as today | DR finding 1/12: one engine, one feed; nexus LLM synthesis can't pass gates 6–7 and its deterministic correlations are superseded by claims over the same families |
| P2-D6 | Ask Journal + reports consume verified claims as a labeled context block/section; reports STOP feeding nexus prose labels into the premium-narrative prompt (claims + deterministic stats replace them). Contextual entry insight gets multi-channel retrieval (recent + entity + tag + semantic-when-vectors-present, scope-filtered, sensitive-excluded, deduped) but keeps its existing prompt contract | DR findings 8/11; the report was piping unverified LLM prose into another LLM |
| P2-D7 | Comprehension gate = runbook process item (pre-broad-release), plus one microcopy line on ClaimCard ("Association, not cause —" prefix on the limitation line). No quiz code | App is personal-first (2026-07-10 repositioning); a self-administered quiz for the owner is ceremony; the gate text stays for any future launch |
| P2-D8 | Nexus LLM synthesis generators (`generateCausalSynthesis`, `generateNarrativeArcInsight`, `generateMetaPatternInsight`) keep running and writing to `nexus/insights` (dark data), NOT deleted in Phase 2 | Deleting them is Phase-3 cleanup once the claims feed has soaked; display-level retirement now, code-level later — reversible |

## Shared contracts

```js
// Evidence bundle sent to the writer (server; built from the claim input, NOTHING else):
// { subject, outcome:'mood', direction, claimType,
//   numbers: { exposedDayCount, comparisonDayCount, observedSpanDays,
//              effectMoodPoints,          // signed, 1-decimal rounded
//              hiddenSensitiveSourceCount },
//   limitations: string[],               // deterministic, already causal-checked
//   excerpts: [{date, excerpt}],         // VISIBLE sources only, ≤8, ≤120 chars each
//   deterministicWording: string }       // the Phase-1 template sentence (style anchor)

// writeClaimWording callable:
//   request:  { bundle }                              // shape above
//   response: { verdict: 'pass'|'fail', wording: string|null,
//               reasons: string[],                    // verifier reason tokens on fail
//               writerModel: string, verifierModel: string }

// Verifier reason tokens (deterministic core):
//   'causal_language', 'unentailed_numeral', 'subject_missing',
//   'direction_mismatch', 'too_long', 'banned_phrase', 'sensitive_reference',
//   'llm_entailment_rejected', 'writer_error'

// Ranked feed item = the claim doc itself; rank key computed client-side:
//   rankScore(claim) = TYPE_WEIGHT[claimType]*1e6
//     + Math.min(Math.abs(evidence.effectMoodPoints), 50)*1e3
//     + recencyBoost(createdAt)   // days-ago decay, 0..999
//   TYPE_WEIGHT = { experiment_result: 3, pattern_to_watch: 2, observation: 1 }
```

**Batching:** P2a: T1 (verifier module, functions) ∥ T2 (registry workloads + writer prompt module, functions) ∥ T4 (experiment-result claims, client experiments tree) → then T3 (callable wiring T1+T2, functions/index.js) → gate → push. P2b: T5 (pipeline integration, client claims tree) → then T6 (unified feed, InsightsPage tree) ∥ T7 (Ask Journal + contextual retrieval) ∥ T8 (reports) → gate → push. P2c: T9 (QA/matrix/docs) → final whole-phase review.

---

### Task 1: Verifier module (server, deterministic core + LLM entailment seam)

**Files:**
- Create: `functions/src/insights/claimVerifier.js`
- Test: `functions/src/insights/__tests__/claimVerifier.test.js`

**Interfaces:**
- Consumes: nothing from other Phase-2 tasks (pure module + one injected LLM caller).
- Produces:
  - `VERIFIER_VERSION = 1`; `MAX_WORDING_SENTENCES = 2`; `MAX_WORDING_CHARS = 320`.
  - `CAUSAL_RE` — import-free copy of the client regex with a sync-comment pair to `src/services/insights/claims/claimSchema.js` (cross-package duplicate; parity test in Task 9 mirrors the dismissalKey precedent).
  - `BANNED_PHRASES` — frozen array: `['proves', 'guarantees', 'you should', 'you must', 'diagnos', 'disorder', 'always', 'never fails', 'definitely']` (case-insensitive substring).
  - `verifyDeterministic(wording, bundle)` → `{ pass: boolean, reasons: string[] }` — ALL checks, accumulating reasons.
  - `async verifyWithModel(wording, bundle, { callModel })` → `{ pass, reason }` — prompts the independent model: "Here is a JSON evidence bundle and one candidate sentence. Answer strict JSON `{entailed: true|false, offending: string|null}` — `entailed` is false if ANY factual assertion (number, comparison, event, causal implication) is not directly supported by the bundle." Parse strictly; unparseable/model-error → `{ pass: false, reason: 'llm_entailment_rejected' }` (fail CLOSED).
  - `async verifyWording(wording, bundle, { callModel })` → `{ verdict: 'pass'|'fail', reasons }` — deterministic first (cheap), LLM check only if deterministic passes.

**Deterministic checks (each with its reason token):**
1. `causal_language` — CAUSAL_RE on the wording.
2. `banned_phrase` — any BANNED_PHRASES hit.
3. `unentailed_numeral` — extract all numerals from the wording (`/\d+(?:\.\d+)?/g`); every one must equal (±0.05 after rounding to 1 decimal) a value in the entailed set: `{exposedDayCount, comparisonDayCount, observedSpanDays, |effectMoodPoints| rounded to 0 and 1 decimals, hiddenSensitiveSourceCount, 100, 0}` (100/0 allowed for "0–100 scale" phrasing).
4. `subject_missing` — lowercase wording must contain the lowercase `bundle.subject`.
5. `direction_mismatch` — if wording contains 'higher'/'lower' (or 'more'/'less' adjacent to 'mood'), it must agree with `bundle.direction` ('positive' → higher/more).
6. `too_long` — > MAX_WORDING_CHARS or > MAX_WORDING_SENTENCES (split on `/[.!?]+\s/`).
7. `sensitive_reference` — wording must not contain 'hidden', 'sensitive', 'flagged' UNLESS `hiddenSensitiveSourceCount > 0` (the disclosure is the card's job, not the wording's; when 0, any such reference is invention).

- [ ] **Step 1: Write the failing tests**

```js
// functions/src/insights/__tests__/claimVerifier.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  verifyDeterministic, verifyWithModel, verifyWording,
  MAX_WORDING_CHARS,
} from '../claimVerifier.js';

const bundle = {
  subject: 'gym', outcome: 'mood', direction: 'positive', claimType: 'pattern_to_watch',
  numbers: {
    exposedDayCount: 9, comparisonDayCount: 15, observedSpanDays: 34,
    effectMoodPoints: 7.2, hiddenSensitiveSourceCount: 0,
  },
  limitations: ['Same-day association only.'],
  excerpts: [{ date: '2026-07-01', excerpt: 'Gym then coffee, good morning.' }],
  deterministicWording: 'On days you logged gym, your recorded mood averaged 7.2 points higher (0–100 scale) than days you didn’t — 9 vs 15 days over 34 days.',
};
const OK = 'On days you logged gym, your recorded mood averaged 7.2 points higher — 9 gym days vs 15 comparison days across 34 days.';

describe('verifyDeterministic', () => {
  it('passes a grounded, non-causal sentence', () => {
    expect(verifyDeterministic(OK, bundle)).toEqual({ pass: true, reasons: [] });
  });
  it('rejects causal language', () => {
    const r = verifyDeterministic('Gym boosts your mood by 7.2 points.', bundle);
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain('causal_language');
  });
  it('rejects any numeral not entailed by the bundle', () => {
    const r = verifyDeterministic('On gym days your mood averaged 12 points higher — 9 vs 15 days.', bundle);
    expect(r.reasons).toContain('unentailed_numeral');
  });
  it('accepts the rounded-integer form of the effect (7 for 7.2)', () => {
    const r = verifyDeterministic('On gym days, recorded mood averaged 7 points higher — 9 vs 15 days over 34 days.', bundle);
    expect(r.pass).toBe(true);
  });
  it('rejects direction flips', () => {
    const r = verifyDeterministic('On gym days your recorded mood averaged 7.2 points lower — 9 vs 15 days.', bundle);
    expect(r.reasons).toContain('direction_mismatch');
  });
  it('rejects missing subject, over-length, banned phrases, and invented sensitivity', () => {
    expect(verifyDeterministic('Recorded mood averaged 7.2 points higher — 9 vs 15 days.', bundle).reasons).toContain('subject_missing');
    expect(verifyDeterministic(`${'x'.repeat(MAX_WORDING_CHARS)} gym 9`, bundle).reasons).toContain('too_long');
    expect(verifyDeterministic('Gym days: 9 vs 15 — this proves higher mood, 7.2 points.', bundle).reasons).toContain('banned_phrase');
    expect(verifyDeterministic('On gym days (some hidden sensitive days) mood was 7.2 points higher — 9 vs 15.', bundle).reasons).toContain('sensitive_reference');
  });
});

describe('verifyWithModel', () => {
  it('passes when the model returns entailed:true', async () => {
    const callModel = vi.fn(async () => JSON.stringify({ entailed: true, offending: null }));
    expect((await verifyWithModel(OK, bundle, { callModel })).pass).toBe(true);
  });
  it('fails CLOSED on entailed:false, unparseable output, or a thrown error', async () => {
    for (const impl of [
      async () => JSON.stringify({ entailed: false, offending: 'across 34 days' }),
      async () => 'not json',
      async () => { throw new Error('boom'); },
    ]) {
      const r = await verifyWithModel(OK, bundle, { callModel: vi.fn(impl) });
      expect(r.pass).toBe(false);
    }
  });
});

describe('verifyWording (composition)', () => {
  it('skips the LLM check entirely when deterministic fails (cheap-first)', async () => {
    const callModel = vi.fn();
    const r = await verifyWording('Gym causes joy: 7.2 points.', bundle, { callModel });
    expect(r.verdict).toBe('fail');
    expect(callModel).not.toHaveBeenCalled();
  });
  it('verdict pass requires BOTH layers', async () => {
    const callModel = vi.fn(async () => JSON.stringify({ entailed: true, offending: null }));
    expect((await verifyWording(OK, bundle, { callModel })).verdict).toBe('pass');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run functions/src/insights/__tests__/claimVerifier.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement `claimVerifier.js`** per the checks above (pure; `callModel` injected — no direct model import; ESM matching functions/src conventions — check neighboring modules for import style first).
- [ ] **Step 4: Run** → PASS; also `npx vitest run functions/src/insights` (whole dir green).
- [ ] **Step 5: Controller commits** (pathspec: the two new files).

---

### Task 2: Registry workloads + writer prompt module

**Files:**
- Modify: `functions/src/models/registry.js` (add `insightWriter` and `insightVerifier` to WORKLOADS/MODEL_DEFAULTS)
- Create: `functions/src/insights/claimWriter.js`
- Test: `functions/src/insights/__tests__/claimWriter.test.js`, extend the registry's existing test if one covers WORKLOADS completeness

**Interfaces:**
- Consumes: nothing from T1 (parallel-safe; the callable in T3 composes both).
- Produces:
  - Registry: `insightWriter: 'gemini-3.5-flash'`, `insightVerifier: 'gemini-3-flash-preview'` (DIFFERENT defaults — independence; both flag-overridable via `model.insightWriter`/`model.insightVerifier`).
  - `buildWriterPrompt(bundle)` → `{ systemPrompt, userPrompt }` — system prompt states the contract verbatim: explain ONLY the bundle; one or two sentences; non-causal co-movement phrasing; every number must come from the bundle; never mention hidden/sensitive material; write in second person, warm but plain; return strict JSON `{wording: string}`. User prompt = the JSON bundle.
  - `parseWriterResponse(raw)` → `string|null` — strips code fences, JSON-parses, returns a trimmed non-empty `wording` string or null (never throws).
  - `async writeWording(bundle, { callModel })` → `string|null` — compose prompt → `callModel` → parse; null on any failure.

- [ ] **Step 1: Failing tests** — registry: `getModelSync('insightWriter')`/`('insightVerifier')` return the two DIFFERENT defaults; unknown-workload still throws. Writer: prompt contains the bundle's numbers and every excerpt, states the non-causal + bundle-only + strict-JSON contract, and NEVER contains the strings 'hidden' day text (construct a bundle where a hypothetical hidden excerpt string is absent by construction — assert prompt does not contain a sentinel that only hidden data would carry); `parseWriterResponse` handles fenced JSON, bare JSON, garbage → null; `writeWording` returns null when `callModel` throws.
- [ ] **Step 2: Run → FAIL. Implement.** Registry edit is 2 lines per frozen object — read the whole MODEL_DEFAULTS block first (Phase-0 lesson: never edit a block from an 8-line grep).
- [ ] **Step 3: Run** — new tests + `npx vitest run functions/src/models functions/src/insights` green.
- [ ] **Step 4: Controller commits.**

---

### Task 3: `writeClaimWording` callable

**Files:**
- Modify: `functions/index.js` (new onCall near `executePrompt`, ~line 885 region)
- Test: `functions/src/insights/__tests__/writeClaimWording.test.js` (test the extracted handler, not the onCall wrapper — follow how other functions/index.js handlers are tested; if none are, extract the handler body into `functions/src/insights/writeClaimWordingHandler.js` and test that)

**Interfaces:**
- Consumes: T1 `verifyWording`, T2 `writeWording`/`buildWriterPrompt`, existing `assertAiConsent`, `assertWithinLimit`, `enforceDailyQuota`, `getModel`, server `callGemini(apiKey, systemPrompt, userPrompt, modelId?)` (read its real signature in `functions/src/shared/` first).
- Produces: callable `writeClaimWording` — request `{ bundle }`, response per Shared contracts. `MAX_WRITER_ATTEMPTS = 2`: writer → verify; on fail, ONE rewrite attempt with the verifier reasons appended to the prompt ("Your previous attempt failed verification for: <reasons>. Rewrite obeying the contract."); second fail → `{ verdict:'fail', wording:null, reasons }`.
- Guards: auth required; `assertAiConsent`; bundle size cap via `assertWithinLimit(JSON.stringify(bundle))`; `enforceDailyQuota(userId, { key: 'claimWriter', limit: 100 })` (add to DAILY_QUOTA); bundle shape validation (reject unknown top-level keys, excerpts > 8, excerpt > 200 chars — fail fast, `invalid_bundle` reason).
- Client stub: add `writeClaimWordingFn = httpsCallable(functions, 'writeClaimWording', { timeout: 60000 })` to `src/config/firebase.js`.

- [ ] **Step 1: Failing handler tests** — mocked `callModel` per role (writer model vs verifier model both injectable): happy path (verdict pass, wording returned, models named in response); writer garbage → retry once → deterministic reasons surfaced on second fail; verifier fail on attempt 1 + pass on attempt 2 → pass with attempt-2 wording; oversized bundle → `invalid_bundle` without any model call; quota/consent guards (mock them per the codebase's existing handler-test pattern — read one first).
- [ ] **Step 2: Run → FAIL. Implement** (extract handler to `functions/src/insights/writeClaimWordingHandler.js`, thin onCall wrapper in index.js — matches the repo's ongoing monolith-splitting direction).
- [ ] **Step 3: Run** — handler tests + `npx vitest run functions/src` green (no collateral).
- [ ] **Step 4: Controller commits.**

---

### Task 4: Experiment results become `experiment_result` claims

**Files:**
- Modify: `src/services/experiments/experimentsService.js` (`writeResult`, `writeAdjustedResult`)
- Create: `src/services/experiments/experimentClaim.js`
- Test: `src/services/experiments/__tests__/experimentClaim.test.js`, extend `experimentsService.test.js`

**Interfaces:**
- Consumes: `buildClaim`, `claimDocId`, `writeClaim`, `supersedeClaim`, `listAllClaims` from `src/services/insights/claims/`; the experiment doc's frozen `analysisPlan` (hypothesisFamilyId already present post-Phase-1) and `result.original`/`result.adjusted` shapes.
- Produces: `buildExperimentResultClaim({ experiment, experimentId, result, now })` → a complete `buildClaim` input:
  - `claimType: 'experiment_result'`; `subject` from the template exposure label; `direction` from `result.estimate.delta` sign (SKIP claim entirely — return null — when `result.status === 'insufficient'`: insufficiency is not a claim); wording = the deterministic sentence already in `result.narrative.summary` IF it passes claimSchema's CAUSAL_RE, else rebuild from estimate numbers with the Phase-1 template style; `questionWording` = the experiment's frozen `question`; limitations from `analysisPlan.whatThisDoesNotProve` + the coverage caveat; `analysisPlan` mapped from the experiment's frozen plan (fill Phase-1's required plan keys: candidateId = hypothesisFamilyId, candidateTestsCount from plan.ciLevel inversion NOT attempted — carry `candidateTestsCount: 1` and the plan's actual `ciLevel` when present, else 0.95; document); `evidence` mapped from `result.estimate` + `result.coverage` (+ `hiddenSensitiveSourceCount: result.sensitiveObservationCount`); `receipt` = `result.receipt`; `status: 'verified'`; `provenance.wordingSource: 'deterministic_template_v1'`.
  - `writeResult` calls `writeClaim` after the experiment doc write succeeds (contained try/catch + warn — an experiment result must never fail to save because the claim write hiccuped; idempotent via deterministic claimDocId).
  - `writeAdjustedResult` SUPERSEDES the original result-claim with a v2 built from the adjusted result (lineage = the experiments' original/adjusted contract projected into claims). Contained the same way.

- [ ] **Step 1: Failing tests** — mapping correctness for an `ok` result (all evidence numbers land in the right claim fields; wording passes buildClaim); insufficient result → null, nothing written; writeResult failure containment (claim write rejects → result still saved, warn); adjusted → supersede with `parentClaimId` linking v1, both docs exist; idempotent re-write of same result → same doc id, no duplicate.
- [ ] **Step 2: Run → FAIL. Implement.** Read `computeResult.js`'s result shape and `templates.js` labels directly; do NOT guess field names.
- [ ] **Step 3: Run** — `npx vitest run src/services/experiments src/services/insights/claims` green.
- [ ] **Step 4: Controller commits.**

---

### Task 5: Pipeline integration — LLM wording behind `LLM_WRITER_ENABLED`

**Files:**
- Modify: `src/services/insights/claims/claimsPipeline.js`, `src/services/insights/claims/evidenceBuilder.js` (bundle builder export), `src/config/firebase.js` (already has the stub from T3 — verify)
- Test: extend `claimsPipeline.test.js`; create `src/services/insights/claims/__tests__/writerBundle.test.js`

**Interfaces:**
- Consumes: T3's `writeClaimWordingFn`; Phase-1 pipeline internals.
- Produces:
  - `evidenceBuilder.js` exports `buildWriterBundle(claimInput)` → the Shared-contracts bundle (subject/direction/claimType/numbers/limitations/excerpts from `receipt.sources` capped at 8/deterministicWording = the template wording). PURE.
  - `claimsPipeline.js`: `export const LLM_WRITER_ENABLED = false;` (doc comment mirroring RISKY_CLAIMS_ENABLED's). In the eligible-write path (both new-claim and supersede branches), when `options.llmWriterEnabled ?? LLM_WRITER_ENABLED`: build bundle → `writeClaimWordingFn({ bundle })` → on `verdict:'pass'` AND the returned wording passes `buildClaim` locally (belt-and-braces: CAUSAL_RE runs again inside buildClaim), write the claim with `wording` = LLM wording, `provenance.wordingSource:'llm_writer_v1'`, `provenance.writerModel`/`verifierModel` from the response; on fail/error/timeout → deterministic wording exactly as Phase 1 (contained try/catch, `console.warn` once per run not per claim).
  - `generateClaims` return gains `{ llmWordings: n }` stat.

- [ ] **Step 1: Failing tests** — default OFF: `writeClaimWordingFn` never called, wording identical to Phase 1 fixtures (byte-equality on an existing strong-fixture claim); override ON + mocked callable pass → claim carries LLM wording + provenance; callable fail verdict → deterministic fallback, claim still written; callable throws → fallback + single warn; LLM wording that would trip buildClaim (mock returns causal text with a forged 'pass') → buildClaim throws → caught → deterministic fallback (the local re-validation is load-bearing: test it); bundle contains ONLY visible excerpts (fixture with sensitive day → its text absent from the bundle passed to the callable — spy on the call arg).
- [ ] **Step 2: Run → FAIL. Implement.**
- [ ] **Step 3: Run** — `npx vitest run src/services/insights src/services/basicInsights` green; matrix row R4P1-i untouched-green.
- [ ] **Step 4: Controller commits.**

---

### Task 6: Unified ranked feed

**Files:**
- Create: `src/components/insights/ClaimFeed.jsx`, `src/services/insights/claims/rankClaims.js`
- Modify: `src/pages/InsightsPage.jsx`
- Test: `src/services/insights/claims/__tests__/rankClaims.test.js`, `src/components/insights/__tests__/ClaimFeed.test.jsx`, extend `src/pages/__tests__/InsightsPage.claims.test.jsx`

**Interfaces:**
- Consumes: `useClaims` (verified claims), `ClaimCard`, existing section components.
- Produces:
  - `rankClaims(claims, { now })` → sorted array by the Shared-contracts rankScore (pure; ties broken by `createdAt` desc then `id` for determinism).
  - `ClaimFeed` — renders ranked ClaimCards with a claim-type badge group header count (e.g. "2 experiment results · 3 patterns to watch"); empty state reuses the existing sparse-feed copy ("Engram only surfaces what your recorded days actually support…" — write it non-apologetic).
  - `InsightsPage`: when `getFlag('insightClaims')`: render `ClaimFeed` in place of BOTH the Quick Insights block AND the AI Insights (Nexus) block; `RecommendationsSection` hidden; `CorrelationsSection` stays; `useNexusInsights` NOT called when flag ON (avoid dark fetch+budget work — check hook rules-of-hooks: call unconditionally but pass an `enabled` option; read the hook and add `{enabled}` support if absent). Flag OFF: byte-identical current page (existing tests enforce).

- [ ] **Step 1: Failing tests** — rank order across the three types with controlled effect sizes/dates; determinism (same input → same order); ClaimFeed renders groups + empty state; page flag-ON: feed present, Nexus section + Recommendations absent, `useNexusInsights` effectively disabled (spy: no fetch), Correlations still present; flag OFF: all legacy sections, no ClaimFeed, existing suites untouched.
- [ ] **Step 2: Run → FAIL. Implement** (read InsightsPage's current render blocks ~415-540 and the hooks before editing; keep the edit surgical — section-level ternaries, no restructuring).
- [ ] **Step 3: Run** — `npx vitest run src/pages src/components/insights src/hooks` + `npm run build` green.
- [ ] **Step 4: Controller commits.**

---

### Task 7: Ask Journal claims context + multi-channel contextual retrieval

**Files:**
- Modify: `src/services/analysis/index.js` (`askJournalAI`, `getSmartChatContext`), `functions/index.js` (`askJournalAI` system prompt gains a claims-block contract line), `functions/src/analysis/orchestrator.js` + `functions/src/analysis/analysisHelpers.js` (multi-channel `buildRecentContext`)
- Test: `src/services/analysis/__tests__/` (extend/create following existing patterns), `functions/src/analysis/__tests__/` (extend)

**Interfaces:**
- Consumes: `listActiveClaims` (client), claims collection via Admin SDK (server), `generateQueryEmbeddings`/`scoreEntryInBestSpace` (client semantic), entry `embeddingV2` vectors (server semantic), `filterEntriesByScope`.
- Produces:
  - **Ask Journal:** `askJournalAI(entries, question, …)` additionally loads verified claims (flag-gated `getFlag('insightClaims')`; contained failure → proceed without) and prepends a labeled block to `entriesContext`: `VERIFIED PATTERNS (associations from this user's recorded days — never causal):\n- <wording> [<exposedDayCount> vs <comparisonDayCount> days]` capped at 5 by rankClaims order. Server system prompt gains one contract line: "If VERIFIED PATTERNS are provided, prefer them over inferring your own patterns, and describe them only as associations."
  - **Contextual entry insight (server):** `buildRecentContext` becomes multi-channel: (1) recent window (existing), (2) entity-overlap (entries sharing resolved entities with the new entry), (3) tag-overlap, (4) semantic — cosine over stored `embeddingV2` vectors of the candidate window when the new entry has/produces a vector (reuse existing server embedding helpers — read `functions/src/ai/embeddingV2.js` for the call; skip channel silently if unavailable). Channels merged, deduped by entry id, scope-filtered FIRST, `safety_flagged`/`has_warning_indicators` entries excluded from the context text (verify current behavior — if they're included today, excluding them is the fix; note it), capped at the existing context size. Recent-only remains the fallback when other channels return nothing (DR: "recent-only should remain a fallback").

- [ ] **Step 1: Failing tests** — client: claims block present flag-ON (mocked claims), absent flag-OFF, claims-load failure → context unchanged; block is capped and uses wording verbatim. Server: multi-channel merge dedupes and respects the cap; semantic channel skipped without vectors; sensitive entries never in the assembled context string; recent-only fallback intact.
- [ ] **Step 2: Run → FAIL. Implement** (read `getSmartChatContext` + `buildRecentContext` fully first; the server change must not alter the analysis payload contract — context assembly only).
- [ ] **Step 3: Run** — client + functions suites green.
- [ ] **Step 4: Controller commits.**

---

### Task 8: Reports consume verified claims

**Files:**
- Modify: `functions/src/reports/generator.js`, `functions/src/reports/narrative.js`
- Test: extend `functions/src/reports/__tests__/generator.test.js` + narrative tests

**Interfaces:**
- Consumes: `insight_claims` collection via Admin SDK; existing `readNexusData` dismissal filtering; `dismissalKeyFor` mirror.
- Produces:
  - `readVerifiedClaims(db, userBase)` → claims with `status==='verified' && supersededByClaimId==null`, rankClaims-ordered (inline the rank — no client import), capped 5. Read failure → `[]` + warn (report must still generate — matches the dismissal-read posture).
  - Weekly template + premium narrative: a "What held up this period" section rendering `claim.wording` + the day-count line + first limitation, from claims ONLY. `nexusInsightLabel` feeding (both the template pick and the premium `buildSectionPrompt` "Detected patterns:" injection) is REMOVED — the prompt receives claims wording + deterministic stats instead. When zero claims: the section states no verified patterns this period (never falls back to nexus prose).
  - Claims-derived lines respect dismissals? Claims have their own suppression (status) — dismissed-nexus filtering stays for any remaining nexus usage; claims need no extra filter beyond status.

- [ ] **Step 1: Failing tests** — claims section renders from fixture claims; zero-claims copy; nexus labels absent from the premium prompt (assert the prompt string does NOT contain a nexus fixture's summary while a claims fixture's wording IS present); claims read failure → report still generates with the empty-state section; existing T9-era entryRefs/exclusion/fail-closed behaviors untouched (run the whole reports suite).
- [ ] **Step 2: Run → FAIL. Implement.**
- [ ] **Step 3: Run** — `npx vitest run functions/src/reports` green.
- [ ] **Step 4: Controller commits.**

---

### Task 9: QA matrix rows, parity test, docs

**Files:**
- Modify: `src/__tests__/validationMatrix.test.js` (R4P2 rows), `docs/quality/trustworthy-capture-runbook.md` (R4 Phase 2 section), `PROJECT_STATUS.md`, `CLAUDE.md` (extend the R4 paragraph by 2 sentences)
- Create: `src/services/insights/claims/__tests__/causalReParity.test.js` (client claimSchema CAUSAL_RE ≡ server claimVerifier CAUSAL_RE over a shared fixture list — dismissalKeyParity precedent)

**Matrix rows (real modules, platform mocks only):**
- (a) **writer-dark-by-default** — `LLM_WRITER_ENABLED === false` and a full pipeline run performs zero callable invocations; wording byte-equal to Phase-1 template output.
- (b) **verifier-rejects-invention** — deterministic core kills causal/unentailed/direction-flip/oversized wordings (drive `verifyDeterministic` with the adversarial set).
- (c) **verifier-fail-closed** — LLM entailment layer failure modes (false/garbage/throw) all → fail; composition requires both layers.
- (d) **fallback-never-blocks** — writer path forced ON with a failing callable: every eligible claim still written, deterministic wording, `llmWordings: 0`.
- (e) **no-sensitive-in-bundle** — sensitive-day fixture → writer bundle excerpts exclude it while stats include it (reuse Phase-1's reconciliation fixture).
- (f) **experiment-result-claims** — ok result → claim mapped correctly; insufficient → none; adjusted → supersede lineage.
- (g) **single-feed-swap** — flag ON: feed present, nexus/recommendations sections absent, correlations present; flag OFF: legacy byte-identical (reuses existing snapshot approach).
- (h) **reports-claims-not-nexus-prose** — premium prompt contains claims wording, not nexus summaries.
- (i) **askjournal-claims-block** — context gains the capped labeled block flag-ON; absent flag-OFF.

**Runbook R4 Phase 2 section:** what shipped; `LLM_WRITER_ENABLED` constant semantics + flip procedure (edit constant, or promote to a flag later — note the option); new registry workloads + `model.insightWriter`/`model.insightVerifier` overrides (verifier model must stay ≠ writer model — state why); writer/verifier contract summary; feed swap behavior + sparse-feed expectation; Ask Journal/report changes; the comprehension gate as a pre-broad-release process item (≥80%, DR §gate 8) with the explicit note that no quiz code exists by decision P2-D7.

**PROJECT_STATUS:** Active Work row; decisions P2-D1..D8 (one row, Michael veto-window); checklist item (12): "after eyeballing verifier behavior on your data (flip LLM_WRITER_ENABLED in a dev build or ask for the flag promotion), decide whether LLM wording goes live".

- [ ] **Step 1:** Parity test + matrix rows → `npx vitest run src/__tests__/validationMatrix.test.js src/services/insights/claims/__tests__/causalReParity.test.js` → PASS.
- [ ] **Step 2:** Docs edits (runbook/PROJECT_STATUS/CLAUDE.md — reference the real plan filename `2026-07-23-r4-phase2-trustworthy-synthesis.md`).
- [ ] **Step 3:** Full gate: `npm test` + `npm run build` (+ `npm run test:rules` if any task touched rules — none planned; run it anyway at phase close for drift).
- [ ] **Step 4: Controller commits.**

---

## Self-review (performed at plan time)

1. **Coverage vs the R4 outline:** constrained writer + verifier two-pass → T1/T2/T3/T5; single ranked feed with claim types → T4 (third type) + T6; contextual insights + Ask Journal + reports through verified claims → T7/T8; multi-channel retrieval → T7; comprehension gate → P2-D7 + T9 docs. DR gate 7 enforced twice (server verifier + client buildClaim re-validation); gate 8 documented-not-built by ratified decision.
2. **Placeholders:** none; the two "read the real signature first" notes (server callGemini, embeddingV2 helpers) are verify-then-align instructions with the contract stated.
3. **Type consistency:** the bundle shape is defined once (Shared contracts) and referenced by T1 (verify), T2 (prompt), T3 (callable), T5 (builder + call site); reason tokens defined once; `rankClaims` defined in T6 and inlined-by-copy in T8 (server) — deliberate duplication, noted in T8, parity not required (ranking is presentational, not integrity).
4. **Risk order:** batches put the pure/testable modules first (T1/T2/T4), the callable next, integration after — a verifier defect is caught before anything touches the pipeline.

## Execution handoff

Subagent-driven (as Phases 0–1): P2a → P2b → P2c, adversarial review per task, whole-phase final review on the most capable model, gate + push per batch, ledger after every task.
