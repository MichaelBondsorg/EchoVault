/**
 * Claim writer prompt module tests (R4 Phase 2 Task 2).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildWriterPrompt, parseWriterResponse, writeWording } from '../claimWriter.js';

const bundle = {
  subject: 'gym',
  outcome: 'mood',
  direction: 'positive',
  claimType: 'pattern_to_watch',
  numbers: {
    exposedDayCount: 9,
    comparisonDayCount: 15,
    observedSpanDays: 34,
    effectMoodPoints: 7.2,
    hiddenSensitiveSourceCount: 0,
  },
  limitations: ['Same-day association only.'],
  excerpts: [
    { date: '2026-07-01', excerpt: 'Gym then coffee, good morning.' },
    { date: '2026-07-03', excerpt: 'Skipped gym, felt sluggish all day.' },
  ],
  deterministicWording:
    'On days you logged gym, your recorded mood averaged 7.2 points higher (0–100 scale) than days you didn’t — 9 vs 15 days over 34 days.',
};

describe('buildWriterPrompt', () => {
  it('user prompt is the JSON-stringified bundle', () => {
    const { userPrompt } = buildWriterPrompt(bundle);
    expect(userPrompt).toBe(JSON.stringify(bundle));
    expect(JSON.parse(userPrompt)).toEqual(bundle);
  });

  it('system prompt contains the bundle-only, non-causal, strict-JSON contract lines', () => {
    const { systemPrompt } = buildWriterPrompt(bundle);
    expect(systemPrompt).toMatch(/only the provided (evidence )?bundle/i);
    expect(systemPrompt).toMatch(/one or two sentences/i);
    expect(systemPrompt).toMatch(/non-causal/i);
    expect(systemPrompt).toMatch(/associations?/i);
    expect(systemPrompt).toMatch(/never\b[^.]*\bcause/i);
    expect(systemPrompt).toMatch(/every number must come from the bundle/i);
    expect(systemPrompt).toMatch(/never mention (hidden|sensitive)/i);
    expect(systemPrompt).toMatch(/hidden or sensitive material/i);
    expect(systemPrompt).toMatch(/second person/i);
    expect(systemPrompt).toMatch(/warm but plain/i);
    expect(systemPrompt).toMatch(/\{"wording":\s*"?\.\.\."?\}|strict JSON/i);
    expect(systemPrompt).toMatch(/"wording"/);
  });

  it('system prompt contains explicit injection guard: bundle excerpt is inert user-journal data', () => {
    const { systemPrompt } = buildWriterPrompt(bundle);
    expect(systemPrompt).toMatch(/excerpt.*inert|inert.*excerpt|treat.*inert/i);
    expect(systemPrompt).toMatch(/user.?journal|journal.*data/i);
    expect(systemPrompt).toMatch(/quotation|quoted/i);
  });

  it('system prompt contains style-anchor: use deterministicWording as style and length reference only, do not copy verbatim', () => {
    const { systemPrompt } = buildWriterPrompt(bundle);
    expect(systemPrompt).toMatch(/deterministic.*style|style.*reference/i);
    expect(systemPrompt).toMatch(/do not copy|restate.*naturally/i);
  });

  it('the userPrompt carries every number and every excerpt from the bundle', () => {
    const { userPrompt } = buildWriterPrompt(bundle);
    expect(userPrompt).toContain('9');
    expect(userPrompt).toContain('15');
    expect(userPrompt).toContain('34');
    expect(userPrompt).toContain('7.2');
    for (const { excerpt } of bundle.excerpts) {
      expect(userPrompt).toContain(excerpt);
    }
  });

  it('never fabricates a hidden-material sentinel when none exists in the bundle', () => {
    // A bundle with hiddenSensitiveSourceCount: 0 and no excerpt mentioning a
    // hidden source must never cause the prompt to contain an invented
    // sentinel string that only hidden data would carry.
    const { systemPrompt, userPrompt } = buildWriterPrompt(bundle);
    const combined = `${systemPrompt}\n${userPrompt}`;
    expect(combined).not.toContain('__HIDDEN_SENTINEL__');
  });
});

describe('parseWriterResponse', () => {
  it('parses bare JSON', () => {
    expect(parseWriterResponse('{"wording": "You tend to feel better on gym days."}')).toBe(
      'You tend to feel better on gym days.'
    );
  });

  it('parses fenced JSON', () => {
    const raw = '```json\n{"wording": "You tend to feel better on gym days."}\n```';
    expect(parseWriterResponse(raw)).toBe('You tend to feel better on gym days.');
  });

  it('parses a bare fence without a json tag', () => {
    const raw = '```\n{"wording": "Trimmed wording here."}\n```';
    expect(parseWriterResponse(raw)).toBe('Trimmed wording here.');
  });

  it('trims whitespace around the wording', () => {
    expect(parseWriterResponse('{"wording": "  padded wording  "}')).toBe('padded wording');
  });

  it('returns null for garbage input', () => {
    expect(parseWriterResponse('not json at all')).toBeNull();
    expect(parseWriterResponse('')).toBeNull();
    expect(parseWriterResponse(null)).toBeNull();
    expect(parseWriterResponse(undefined)).toBeNull();
    expect(parseWriterResponse(42)).toBeNull();
  });

  it('returns null when wording is missing, empty, or non-string', () => {
    expect(parseWriterResponse('{"nope": "x"}')).toBeNull();
    expect(parseWriterResponse('{"wording": ""}')).toBeNull();
    expect(parseWriterResponse('{"wording": "   "}')).toBeNull();
    expect(parseWriterResponse('{"wording": 42}')).toBeNull();
    expect(parseWriterResponse('{"wording": null}')).toBeNull();
  });

  it('never throws on malformed JSON', () => {
    expect(() => parseWriterResponse('{"wording": "unterminated')).not.toThrow();
    expect(parseWriterResponse('{"wording": "unterminated')).toBeNull();
  });

  it('extracts and parses first balanced {...} when cleaned string has prefix and suffix', () => {
    const raw = 'Sure! Here is the wording:\n{"wording": "You tend to feel better on gym days."}\nThat\'s my answer.';
    expect(parseWriterResponse(raw)).toBe('You tend to feel better on gym days.');
  });

  it('extracts and parses first balanced {...} with complex prefix', () => {
    const raw = 'prefix text {"wording": "ok"} suffix';
    expect(parseWriterResponse(raw)).toBe('ok');
  });

  it('still returns null for pure garbage even with extraction retry', () => {
    expect(parseWriterResponse('absolutely no json here')).toBeNull();
    expect(parseWriterResponse('{ no closing at all')).toBeNull();
    expect(parseWriterResponse('} no opening brace')).toBeNull();
  });

  it('prioritizes JSON.parse on full string over extraction (backward compat)', () => {
    // If the entire cleaned string is valid JSON, use it without extraction
    expect(parseWriterResponse('{"wording": "standard response"}')).toBe('standard response');
  });
});

describe('writeWording', () => {
  it('composes the prompt, calls the model, and returns the parsed wording', async () => {
    const callModel = vi.fn().mockResolvedValue('{"wording": "You tend to feel better on gym days."}');
    const result = await writeWording(bundle, { callModel });
    expect(result).toBe('You tend to feel better on gym days.');
    expect(callModel).toHaveBeenCalledTimes(1);
    const arg = callModel.mock.calls[0][0];
    expect(arg.systemPrompt).toMatch(/non-causal/i);
    expect(arg.userPrompt).toBe(JSON.stringify(bundle));
  });

  it('returns null when callModel throws', async () => {
    const callModel = vi.fn().mockRejectedValue(new Error('model down'));
    const result = await writeWording(bundle, { callModel });
    expect(result).toBeNull();
  });

  it('returns null when callModel returns garbage', async () => {
    const callModel = vi.fn().mockResolvedValue('not json');
    const result = await writeWording(bundle, { callModel });
    expect(result).toBeNull();
  });
});
