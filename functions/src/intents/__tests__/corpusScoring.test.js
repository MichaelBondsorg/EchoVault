/**
 * Deterministic unit tests for the INT-01 corpus scoring/matching logic
 * (../__evals__/corpusScoring.js). Synthetic predicted-vs-expected pairs
 * only — no model calls, no fixtures, no I/O — so these assert the
 * precision/recall math and the fuzzy matcher's boundaries directly.
 */
import { describe, it, expect } from 'vitest';
import { fuzzyTextMatch, matchCase, scoreCase, scoreCorpus } from '../__evals__/corpusScoring.js';

describe('fuzzyTextMatch', () => {
  it('matches identical strings', () => {
    expect(fuzzyTextMatch('call the dentist', 'call the dentist')).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(fuzzyTextMatch('Call the Dentist!', 'call the dentist')).toBe(true);
  });

  it('matches when one string contains the other', () => {
    expect(fuzzyTextMatch('I need to call the dentist tomorrow', 'call the dentist')).toBe(true);
    expect(fuzzyTextMatch('call the dentist', 'I need to call the dentist tomorrow')).toBe(true);
  });

  it('matches on >= 60% token overlap even without containment either direction', () => {
    // shared {the,landlord,about,heater}=4 / union {email,the,landlord,about,heater,today}=6 -> 0.667
    expect(fuzzyTextMatch('email the landlord about heater', 'the landlord about heater today')).toBe(true);
  });

  it('does not match below the 60% token-overlap floor', () => {
    // shares only "the": {"call","the","dentist"} vs {"the","garage"} -> 1/4 = 0.25
    expect(fuzzyTextMatch('call the dentist', 'the garage')).toBe(false);
  });

  it('does not match unrelated text', () => {
    expect(fuzzyTextMatch('book the flight to Lisbon', 'organize the garage')).toBe(false);
  });

  it('never matches on empty/missing strings', () => {
    expect(fuzzyTextMatch('', 'call the dentist')).toBe(false);
    expect(fuzzyTextMatch('call the dentist', '')).toBe(false);
    expect(fuzzyTextMatch('', '')).toBe(false);
    expect(fuzzyTextMatch(undefined, 'call the dentist')).toBe(false);
  });

  it('is exactly at the boundary: 3/5 = 0.6 overlap matches, 2/5 = 0.4 does not', () => {
    // tokens: {a,b,c} vs {a,b,d,e} -> intersection {a,b}=2, union {a,b,c,d,e}=5 -> 0.4 (no match)
    expect(fuzzyTextMatch('a b c', 'a b d e')).toBe(false);
    // tokens: {a,b,c} vs {a,b,c,d,e} where predicted has extra 'd e' isn't quite 0.6; construct exact 0.6:
    // intersection 3, union 5 -> {a,b,c} vs {a,b,c,d,e} minus... use direct construction:
    // ta={a,b,c}, tb={a,b,c,d} -> inter=3, union=4 -> 0.75 (match)
    expect(fuzzyTextMatch('a b c', 'a b c d')).toBe(true);
  });
});

describe('matchCase', () => {
  it('pairs expected items with predicted candidates by fuzzy evidence match', () => {
    const result = matchCase({
      expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }],
      predicted: [{ kind: 'task', text: 'call the dentist tomorrow', state: 'active' }],
    });
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedExpected).toHaveLength(0);
    expect(result.unmatchedPredicted).toHaveLength(0);
  });

  it('leaves an expected item unmatched when no predicted candidate matches', () => {
    const result = matchCase({
      expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }],
      predicted: [],
    });
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedExpected).toHaveLength(1);
  });

  it('leaves a predicted candidate unmatched when no expected item matches (hallucination candidate)', () => {
    const result = matchCase({
      expectedIntents: [],
      predicted: [{ kind: 'task', text: 'running through hallways', state: 'active' }],
    });
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedPredicted).toHaveLength(1);
  });

  it('never double-assigns the same predicted candidate to two expected items', () => {
    const result = matchCase({
      expectedIntents: [
        { kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' },
        { kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist office' },
      ],
      predicted: [{ kind: 'task', text: 'call the dentist', state: 'active' }],
    });
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedExpected).toHaveLength(1);
  });

  it('defaults expectedIntents/predicted to empty arrays when omitted', () => {
    expect(matchCase({})).toEqual({ pairs: [], unmatchedExpected: [], unmatchedPredicted: [] });
    expect(matchCase()).toEqual({ pairs: [], unmatchedExpected: [], unmatchedPredicted: [] });
  });
});

describe('scoreCase', () => {
  it('produces a TP when a matched pair both surfaced with the same kind', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }],
      predicted: [{ kind: 'task', text: 'call the dentist', state: 'active' }],
    });
    expect(events).toEqual([{ kind: 'task', type: 'tp', detail: 'match', caseId: 'c1' }]);
  });

  it('produces a correctly-silent no-event when both sides abstain on a matched span', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'task', expectedState: 'abstain', evidenceContains: 'go for a run' }],
      predicted: [{ kind: 'task', text: 'go for a run', state: 'abstain' }],
    });
    expect(events).toEqual([]);
  });

  it('produces a MISFIRE (fp) when an expected-abstain span surfaced anyway — the precision trust contract', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'task', expectedState: 'abstain', evidenceContains: 'go for a run' }],
      predicted: [{ kind: 'task', text: 'go for a run', state: 'active' }],
    });
    expect(events).toEqual([{ kind: 'task', type: 'fp', detail: 'misfire', caseId: 'c1' }]);
  });

  it('produces a HALLUCINATION (fp) for a surfaced predicted candidate with no expected counterpart', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [],
      predicted: [{ kind: 'task', text: 'running through hallways', state: 'active' }],
    });
    expect(events).toEqual([{ kind: 'task', type: 'fp', detail: 'hallucinated', caseId: 'c1' }]);
  });

  it('produces a NOT-PROPOSED miss (fn) when an expected-active item has no predicted counterpart at all', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'renew my visa' }],
      predicted: [],
    });
    expect(events).toEqual([{ kind: 'task', type: 'fn', detail: 'not-proposed', caseId: 'c1' }]);
  });

  it('produces a DEMOTED-TO-ABSTAIN miss (fn) when the matched candidate abstained instead of surfacing', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }],
      predicted: [{ kind: 'task', text: 'call the dentist', state: 'abstain' }],
    });
    expect(events).toEqual([{ kind: 'task', type: 'fn', detail: 'demoted-to-abstain', caseId: 'c1' }]);
  });

  it('produces BOTH a kind-confusion fn (expected kind) and fp (actual kind) on a matched, both-surfaced, wrong-kind pair', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'open_loop', expectedState: 'active', evidenceContains: 'follow up about the loan' }],
      predicted: [{ kind: 'task', text: 'follow up about the loan', state: 'active' }],
    });
    expect(events).toEqual([
      { kind: 'open_loop', type: 'fn', detail: 'kind-confused-as-task', caseId: 'c1' },
      { kind: 'task', type: 'fp', detail: 'kind-confused-from-open_loop', caseId: 'c1' },
    ]);
  });

  it('generates no event for an unmatched expected-abstain item (correct silence)', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [{ kind: 'reflection', expectedState: 'abstain', evidenceContains: 'sit with this grief' }],
      predicted: [],
    });
    expect(events).toEqual([]);
  });

  it('generates no event for an unmatched predicted-abstain candidate (silent context)', () => {
    const events = scoreCase({
      caseId: 'c1',
      expectedIntents: [],
      predicted: [{ kind: 'goal_habit', text: 'exercise more', state: 'abstain' }],
    });
    expect(events).toEqual([]);
  });
});

describe('scoreCorpus', () => {
  it('computes exact per-kind precision/recall across multiple cases', () => {
    const caseResults = [
      { caseId: 'c1', expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }], predicted: [{ kind: 'task', text: 'call the dentist', state: 'active' }] },
      { caseId: 'c2', expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'book flights' }], predicted: [{ kind: 'task', text: 'book flights', state: 'active' }] },
      { caseId: 'c3', expectedIntents: [{ kind: 'task', expectedState: 'abstain', evidenceContains: 'go for a run' }], predicted: [{ kind: 'task', text: 'go for a run', state: 'active' }] }, // misfire
      { caseId: 'c4', expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'renew visa' }], predicted: [] }, // miss
    ];
    const report = scoreCorpus(caseResults);
    // task: tp=2 (c1,c2), fp=1 (c3 misfire), fn=1 (c4 miss)
    expect(report.perKind.task).toEqual({ tp: 2, fp: 1, fn: 1, precision: 2 / 3, recall: 2 / 3 });
    expect(report.overall).toEqual({ tp: 2, fp: 1, fn: 1, precision: 2 / 3, recall: 2 / 3 });
    expect(report.confusion.misfires).toEqual([{ caseId: 'c3', kind: 'task' }]);
    expect(report.confusion.misses).toEqual([{ caseId: 'c4', kind: 'task', detail: 'not-proposed' }]);
    expect(report.totalCases).toBe(4);
  });

  it('reports precision 1 and recall 1 for a kind with zero events (no divide-by-zero)', () => {
    const report = scoreCorpus([]);
    expect(report.overall).toEqual({ tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(report.perKind).toEqual({});
  });

  it('counts zero-intent cases (expectedIntents: []) for the empty-case precision measurement', () => {
    const caseResults = [
      { caseId: 'z1', expectedIntents: [], predicted: [] },
      { caseId: 'z2', expectedIntents: [], predicted: [{ kind: 'task', text: 'x', state: 'active' }] }, // hallucination, still zero-intent
      { caseId: 't1', expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'x' }], predicted: [] },
    ];
    const report = scoreCorpus(caseResults);
    expect(report.zeroIntentCases).toBe(2);
    expect(report.confusion.hallucinations).toEqual([{ caseId: 'z2', kind: 'task' }]);
  });

  it('separates precision/recall per kind independently (a task misfire never touches open_loop stats)', () => {
    const caseResults = [
      { caseId: 'c1', expectedIntents: [{ kind: 'open_loop', expectedState: 'active', evidenceContains: 'remind me' }], predicted: [{ kind: 'open_loop', text: 'remind me', state: 'active' }] },
      { caseId: 'c2', expectedIntents: [{ kind: 'task', expectedState: 'abstain', evidenceContains: 'go for a run' }], predicted: [{ kind: 'task', text: 'go for a run', state: 'active' }] },
    ];
    const report = scoreCorpus(caseResults);
    expect(report.perKind.open_loop).toEqual({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(report.perKind.task).toEqual({ tp: 0, fp: 1, fn: 0, precision: 0, recall: 1 });
  });
});
