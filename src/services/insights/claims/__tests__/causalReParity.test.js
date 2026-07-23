/**
 * Client/server CAUSAL_RE PARITY guard (R4 Phase 2, Task 9).
 *
 * `CAUSAL_RE` is deliberately duplicated across deployable packages: client
 * `claimSchema.js` (authoritative — every claim's `wording`/`questionWording`/
 * `limitations` are validated against it at `buildClaim` construction time,
 * the actual integrity gate) and server `functions/src/insights/
 * claimVerifier.js` (the LLM-writer path's deterministic entailment layer).
 * The sync comments in both files are documentation; THIS test is the
 * enforcement — same precedent as `src/services/nexus/__tests__/
 * dismissalKeyParity.test.js` (client `insightDismissal.js` <-> server
 * `functions/src/reports/dismissalKey.js`).
 *
 * A divergence here means a wording could pass the server verifier (which
 * only ever runs when the LLM writer path is enabled — currently dark by
 * `LLM_WRITER_ENABLED = false`, see claimsPipeline.js) and still get
 * rejected client-side by `buildClaim`'s own re-validation (or, worse, the
 * reverse: something causal slips past a laxer server pattern and only gets
 * caught, if at all, by the client's stricter one) — either way, nothing
 * else in CI catches a silent drift between the two copies.
 *
 * Two independent checks:
 *   1. Source parity — the two regex literals' `.source`/`.flags` are
 *      byte-identical (catches ANY edit to either copy immediately, even one
 *      that wouldn't happen to be exercised by the fixture list below).
 *   2. Behavioral parity — both regexes agree (test() → same boolean) over a
 *      shared adversarial fixture list covering every alternative in the
 *      pattern, case-insensitivity, and near-miss/non-causal strings that
 *      must NOT match.
 */
import { describe, it, expect } from 'vitest';

import { CAUSAL_RE as clientCausalRe } from '../claimSchema';
import { CAUSAL_RE as serverCausalRe } from '../../../../../functions/src/insights/claimVerifier.js';

// One fixture per alternative in the pattern (boosts?/causes?/caused/
// improves?/improved/makes? you/leads? to/results? in/because of your),
// plus case-insensitivity and negative (must NOT match) controls — extend
// this list whenever either copy's alternation changes.
const POSITIVE_FIXTURES = [
  'Going to the gym boosts your mood.',
  'Going to the gym boost your mood.', // "boost" (no s) — still matches "boosts?"
  'Poor sleep causes low mood.',
  'Poor sleep cause low mood.', // "cause" (no s) — still matches "causes?"
  'Poor sleep caused low mood yesterday.',
  'Exercise improves your mood.',
  'Exercise improve your mood.', // "improve" (no s) — still matches "improves?"
  'Exercise improved your mood.',
  'Journaling makes you calmer.',
  'This pattern leads to better sleep.',
  'This pattern lead to better sleep.', // "lead" (no s) — still matches "leads? to"
  'More time outside results in a better mood.',
  'More time outside result in a better mood.', // "result" (no s) — still matches "results? in"
  'You felt calmer because of your walk.',
  // Case-insensitivity.
  'GOING TO THE GYM BOOSTS YOUR MOOD.',
  'Exercise IMPROVES your mood.',
];

const NEGATIVE_FIXTURES = [
  'On days you logged gym, your recorded mood averaged 7.2 points higher than on days you didn\'t.',
  'On days with more sleep hours than usual, mood ran lower on average.',
  'Same-day association only — something else may explain both.',
  'This is one observed pattern in your own data, not a general conclusion.',
  'Your mood and this tag tend to move together.',
  'Two separate things happened around the same time in your data.',
  '', // empty string
];

describe('CAUSAL_RE client/server parity', () => {
  it('the regex source AND flags are byte-identical between claimSchema.js (client) and claimVerifier.js (server)', () => {
    expect(serverCausalRe.source).toBe(clientCausalRe.source);
    expect(serverCausalRe.flags).toBe(clientCausalRe.flags);
  });

  it.each(POSITIVE_FIXTURES.map((f, i) => [i, f]))('positive fixture %#: both sides match ("%s")', (_i, fixture) => {
    expect(clientCausalRe.test(fixture)).toBe(true);
    expect(serverCausalRe.test(fixture)).toBe(true);
  });

  it.each(NEGATIVE_FIXTURES.map((f, i) => [i, f]))('negative fixture %#: neither side matches ("%s")', (_i, fixture) => {
    expect(clientCausalRe.test(fixture)).toBe(false);
    expect(serverCausalRe.test(fixture)).toBe(false);
  });

  it('behavioral parity holds over the FULL combined fixture list, one assertion at a time (redundant with the two suites above, kept as a single non-vacuous proof)', () => {
    for (const fixture of [...POSITIVE_FIXTURES, ...NEGATIVE_FIXTURES]) {
      expect(serverCausalRe.test(fixture)).toBe(clientCausalRe.test(fixture));
    }
  });
});
