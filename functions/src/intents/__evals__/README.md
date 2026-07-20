# Activation-policy eval harness (PRD 0B)

This directory holds the labeled fixtures and evaluation harness that guard the
precision-first intent system. The `active` state is a promise to the user:
Engram only surfaces something as a task when it is structurally sure. These
evals are how we keep that promise honest as the taxonomy and policy evolve.

## Files

- `fixtures.json` — labeled examples. Each fixture carries the **honest
  structural labeling** a reviewer would assign the phrase (its `kind` and the
  TRUE subset of the ten attributes), plus the `expectedState` the policy should
  produce and a `hardNegative` flag.
- `runEval.js` — `evaluate(fixtures)` runs every fixture through the pure
  `decideActivation` policy and returns `{ activePrecision, activeRecall,
  perCategory, activeMisfires, counts, results }`.
- `../__tests__/eval.test.js` — the CI gate. Fails the build if **any**
  hard-negative lands `active`, or if `activePrecision !== 1.0`.

## The trust contract

The hard-negative fixtures are non-negotiable. Every one of them must be
**structurally incapable** of going active — not "usually abstains", but
*cannot* activate given its attributes. They span the ten failure categories the
PRD calls out, each in a text phrasing and voice-artifact (filler-word,
transcription-noise) phrasing so we prove the decision follows the *structure*,
not the surface wording:

| Category | Trap | Why it abstains |
|---|---|---|
| `emotional_not_actionable` | "I need to stop feeling like this." | reflection kind — context only |
| `ongoing_goal` | "I should call my parents more." | goal_habit + goalLanguage |
| `quoted_directive` | "My manager said I need to redo it." | `quoted` blocker |
| `other_owned` | "Sam has to book the hotel." | external_action + `otherOwned` |
| `conditional` | "If I have time, I might go to the gym." | `conditional` blocker |
| `completed` | "I remembered to pay the bill." | `completed` blocker |
| `meta_statement` | "I need to say this because it mattered." | reflection kind |
| `event` | "I have a meeting tomorrow." | event kind — context only |
| `recurring_event` | "Therapy is every Tuesday." | event kind — context only |
| `negation` | "I don't need to call the dentist anymore." | `negated` blocker |
| `sarcasm_self_correction` | "…actually no, that's handled." | negated / reflection |

`confidence` is present on every fixture and is deliberately high on the
negatives: it proves the policy **never** promotes on confidence alone.

## Labeling protocol

1. Two reviewers independently label each new example's `kind` and attribute
   booleans from the raw (or transcribed) text — never from what a model
   guessed.
2. Disagreements are adjudicated by a third reviewer; the adjudicated label is
   what ships.
3. `expectedState` is then *derived by running the policy* — reviewers label
   structure, the policy decides state. A surprising `expectedState` is a signal
   to revisit the labels or the policy, not to hand-edit the expectation.

## Growth gate

This starter set (~62 examples) exists to lock the contract in code. Before the
`intentExtraction` flag defaults **on** in production, the fixture set must grow
to **≥ 500 examples** drawn from real (consented, de-identified) entries, and
the policy must hold **≥ 97% active precision** on that set with **zero**
hard-negative activations. Recall is reported but is explicitly the *secondary*
metric: silence is a correct result, and we would rather miss a real task than
manufacture a false one.
