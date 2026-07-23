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
  // I1: Detect better/worse direction words
  it('rejects "worse" when direction is positive (I1 hardening)', () => {
    const r = verifyDeterministic('On gym days your recorded mood was worse — 9 gym days vs 15 comparison days across 34 days.', bundle);
    expect(r.reasons).toContain('direction_mismatch');
  });
  it('passes "better" when direction is positive (I1 hardening)', () => {
    const r = verifyDeterministic('On gym days your recorded mood was better — 9 gym days vs 15 comparison days across 34 days.', bundle);
    expect(r.pass).toBe(true);
  });
  // M3: Fullwidth numerals after NFKC normalization
  it('rejects fullwidth numerals after NFKC normalization (M3 hardening)', () => {
    const r = verifyDeterministic('On gym days your mood averaged １２ points higher — 9 vs 15 days.', bundle);
    expect(r.reasons).toContain('unentailed_numeral');
  });
  // I2: Pin documented limitation (word-numerals pass deterministic)
  it('passes word-numerals in deterministic layer (I2 limitation: LLM layer is backstop)', () => {
    // This is a documented limitation: spoken/written "twelve points higher"
    // bypasses the digit-regex check. The LLM entailment layer is the
    // fail-closed backstop for spelled-out magnitudes.
    const r = verifyDeterministic('On gym days your mood was twelve points higher — 9 vs 15 days.', bundle);
    expect(r.pass).toBe(true);
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
