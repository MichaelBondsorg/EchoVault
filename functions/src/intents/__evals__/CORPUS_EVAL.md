# INT-01: raw-text intent-extraction eval corpus + shadow-gate scaffolding

Plan: `docs/superpowers/plans/2026-07-24-full-product-review.md` (INT-01).
Complements `README.md` (the R1 PRD-0B activation-policy-only eval — injects a
structural candidate directly into `decideActivation`). This corpus instead
runs a full synthetic **journal entry** through the real end-to-end path:
`extractIntentCandidates` (model call) → `parseCandidatesResponse` →
`normalizeCandidates` → `decideActivation`.

## Files

- `corpus/cases.json` — 50 labeled synthetic entries. Each case: `id`,
  `category`, `difficulty`, `text` (the raw entry), `rationale`, and
  `expectedIntents[]` (`kind`, `expectedState`, `evidenceContains`,
  per-item `rationale`). An empty `expectedIntents` array is itself a label
  (the zero-intent case).
- `corpus/replayFixture.json` — committed "past model output" fixture, keyed
  by case id, `{ text, candidates }`. `text` pins the entry text the fixture
  was captured against (drift guard); `candidates` is the raw array a model
  call would have returned. **Hand-authored for this task** (no live key was
  exercised) — see the file's `_meta.provenance` for what to do before this
  becomes a genuine regression gate: run `--live` once and commit its real
  output as the new fixture.
- `corpusScoring.js` — pure matching/scoring (`fuzzyTextMatch`, `matchCase`,
  `scoreCase`, `scoreCorpus`). No I/O. Unit tests:
  `../__tests__/corpusScoring.test.js`.
- `runCorpusEval.js` — the harness. `--live` (real, keyed model call via
  `extractIntentCandidates`'s own default transport) and `--replay`
  (hermetic, reads `replayFixture.json`). CLI + importable
  (`runCorpusEval`, `runCase`, `loadCorpus`, `loadReplayFixture`,
  `formatReport`). Smoke-tested against the committed fixture in
  `../__tests__/runCorpusEval.test.js`.
- `shadowGate.js` / `runShadowGate.js` — shadow-mode gate **scaffolding**:
  runs a candidate config and a production config over the same corpus
  offline and diffs the two `scoreCorpus()` reports kind-by-kind
  (`diffReports`). Purely in-memory; never touches Firestore, never flips a
  flag, no user-visible effect. This is the tool an engineer runs manually
  before proposing a prompt/model change — it is NOT wired into any CI gate
  and is not the runtime "shadow live traffic" feature the product review
  describes (that needs production wiring — a job, a log collection, a flag
  — explicitly out of scope here). Unit-tested in
  `../__tests__/shadowGate.test.js` with synthetic run functions.

## Running it

```bash
cd functions/src/intents/__evals__
node runCorpusEval.js --replay                 # hermetic, what CI would run
node runCorpusEval.js --live                    # needs GEMINI_API_KEY
node runShadowGate.js \
  --production-fixture corpus/replayFixture.json \
  --candidate-fixture  corpus/replayFixture.json  # compares two configs offline
```

`--replay` exits 0 and prints a per-kind precision/recall table plus a
confusion summary (misfires / hallucinations / kind-confusions / misses).
`--live` requires `GEMINI_API_KEY` (or `--api-key`) and refuses to run
without one — it never silently falls back to replay.

## Scoring model

Each expected intent is fuzzy-matched (case/punctuation-insensitive
containment or ≥60% token overlap) against a predicted candidate's evidence
span, independent of kind. From the matched/unmatched sets:

| Event | Meaning |
|---|---|
| **TP** | matched pair, both surfaced (active/suggested), same kind |
| **misfire (FP)** | matched pair: expected abstain, actual surfaced — the precision-first trust-contract violation |
| **hallucination (FP)** | surfaced predicted candidate with no expected counterpart at all |
| **kind confusion (FN+FP)** | matched pair, both surfaced, different kind — FN on the expected kind, FP on the actual kind |
| **not-proposed (FN)** | expected-active item, no matching predicted candidate at all |
| **demoted-to-abstain (FN)** | matched pair, expected surfaced, actual abstained |
| *(no event)* | matched-and-both-abstain, or unmatched-and-expected-abstain, or unmatched-predicted-abstain — all correct silence |

`scoreCorpus()` aggregates these into per-kind precision/recall, an overall
roll-up, and the confusion lists. The committed fixture deliberately encodes
three known imperfections (one hallucination, one recall miss, one kind
confusion — see `replayFixture.json`'s `_meta.intentionalImperfections`) so
the harness demonstrably exercises every event type; it still holds **zero
misfires**, asserted as a hard invariant in `runCorpusEval.test.js`.

## Relationship to the flag-flip gate

This corpus is a **prompt/model regression check**, not the bar for flipping
`intentExtraction` on. That bar is `../fixtures.json`'s README: ≥500
real, consented, de-identified examples with 100% active precision. This
corpus stays synthetic, small (30-50 cases per the plan), and versioned
alongside the extractor code so a prompt change's score delta is visible in
review — pair it with `shadowGate.js` to compare a candidate prompt/model
against the current one before proposing any change.
