/**
 * writeClaimWording handler tests (R4 Phase 2 Task 3).
 *
 * Every callModel/getModel dependency is injected — no network, no
 * Firestore. Mirrors the writer/verifier contracts asserted in
 * claimWriter.test.js / claimVerifier.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWriteClaimWording, isValidBundle, MAX_WRITER_ATTEMPTS } from '../writeClaimWordingHandler.js';
import { MODEL_SYSTEM_PROMPT } from '../claimVerifier.js';

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
  ],
  deterministicWording:
    'On days you logged gym, your recorded mood averaged 7.2 points higher (0–100 scale) than days you didn’t — 9 vs 15 days over 34 days.',
};

const GOOD_WORDING =
  'On days you logged gym, your recorded mood averaged 7.2 points higher — 9 gym days vs 15 comparison days across 34 days.';

// callGeminiImpl(apiKey, systemPrompt, userPrompt, model) -> Promise<string|null>
// Route responses by which model id is being called, so writer vs verifier
// behavior can be controlled independently in a single test.
function makeCallGeminiImpl({ writerModel, writerResponses, verifierModel, verifierResponses }) {
  let writerCall = 0;
  let verifierCall = 0;
  return vi.fn(async (apiKey, systemPrompt, userPrompt, model) => {
    if (model === writerModel) {
      const resp = writerResponses[Math.min(writerCall, writerResponses.length - 1)];
      writerCall += 1;
      return resp;
    }
    if (model === verifierModel) {
      const resp = verifierResponses[Math.min(verifierCall, verifierResponses.length - 1)];
      verifierCall += 1;
      return resp;
    }
    throw new Error(`Unexpected model in test: ${model}`);
  });
}

function makeGetModelImpl({ writerModel = 'writer-model-x', verifierModel = 'verifier-model-y' } = {}) {
  return vi.fn(async (db, workload) => {
    if (workload === 'insightWriter') return writerModel;
    if (workload === 'insightVerifier') return verifierModel;
    throw new Error(`Unexpected workload: ${workload}`);
  });
}

const ENTAILED_PASS = JSON.stringify({ entailed: true, offending: null });

describe('isValidBundle', () => {
  it('accepts a well-formed bundle', () => {
    expect(isValidBundle(bundle)).toBe(true);
  });
  it('rejects unknown top-level keys', () => {
    expect(isValidBundle({ ...bundle, extra: 'nope' })).toBe(false);
  });
  it('rejects more than 8 excerpts', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ date: '2026-07-01', excerpt: `e${i}` }));
    expect(isValidBundle({ ...bundle, excerpts: many })).toBe(false);
  });
  it('rejects an excerpt longer than 200 chars', () => {
    const long = 'x'.repeat(201);
    expect(isValidBundle({ ...bundle, excerpts: [{ date: '2026-07-01', excerpt: long }] })).toBe(false);
  });
  it('rejects non-object bundles', () => {
    expect(isValidBundle(null)).toBe(false);
    expect(isValidBundle('bundle')).toBe(false);
    expect(isValidBundle([])).toBe(false);
  });
});

describe('handleWriteClaimWording', () => {
  const writerModel = 'writer-model-x';
  const verifierModel = 'verifier-model-y';

  it('happy path: writer proposes, verifier passes on attempt 1', async () => {
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: [JSON.stringify({ wording: GOOD_WORDING })],
      verifierModel,
      verifierResponses: [ENTAILED_PASS],
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });

    const result = await handleWriteClaimWording(
      { bundle },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result).toEqual({
      verdict: 'pass',
      wording: GOOD_WORDING,
      reasons: [],
      writerModel,
      verifierModel,
    });
    // Writer called once, verifier's model call once (deterministic passed).
    expect(callGeminiImpl).toHaveBeenCalledTimes(2);
  });

  it('writer garbage on both attempts -> fail with writer_error, no verifier call', async () => {
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: ['not json at all', 'still garbage'],
      verifierModel,
      verifierResponses: [],
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });

    const result = await handleWriteClaimWording(
      { bundle },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result.verdict).toBe('fail');
    expect(result.wording).toBeNull();
    expect(result.reasons).toEqual(['writer_error']);
    expect(result.writerModel).toBe(writerModel);
    expect(result.verifierModel).toBe(verifierModel);
    // Only the two writer attempts — verifier is never reached.
    expect(callGeminiImpl).toHaveBeenCalledTimes(MAX_WRITER_ATTEMPTS);
  });

  it('verifier fails attempt 1, passes attempt 2 -> pass with attempt-2 wording, retry prompt carries reasons', async () => {
    const attempt1Wording = 'Gym causes your mood to improve by 7.2 points.'; // causal -> deterministic fail
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: [
        JSON.stringify({ wording: attempt1Wording }),
        JSON.stringify({ wording: GOOD_WORDING }),
      ],
      verifierModel,
      verifierResponses: [ENTAILED_PASS], // only reached on attempt 2 (attempt 1 fails deterministically, no model call)
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });

    const result = await handleWriteClaimWording(
      { bundle },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result.verdict).toBe('pass');
    expect(result.wording).toBe(GOOD_WORDING);
    expect(result.writerModel).toBe(writerModel);
    expect(result.verifierModel).toBe(verifierModel);

    // Assert the retry (2nd writer) call's prompt carried the reason token.
    const writerCalls = callGeminiImpl.mock.calls.filter(([, , , model]) => model === writerModel);
    expect(writerCalls).toHaveLength(2);
    const [, , retryUserPrompt] = writerCalls[1];
    expect(retryUserPrompt).toMatch(/failed verification for/i);
    expect(retryUserPrompt).toMatch(/causal_language/);
  });

  it('verifier fails on both attempts -> fail with attempt-2 reasons', async () => {
    const badWording1 = 'Gym causes your mood to improve by 7.2 points.';
    const badWording2 = 'Gym boosts your mood by 7.2 points, guarantees it.';
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: [
        JSON.stringify({ wording: badWording1 }),
        JSON.stringify({ wording: badWording2 }),
      ],
      verifierModel,
      verifierResponses: [],
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });

    const result = await handleWriteClaimWording(
      { bundle },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result.verdict).toBe('fail');
    expect(result.wording).toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons).toEqual(expect.arrayContaining(['causal_language']));
  });

  it('R4 Phase 3 backlog (P3-D7): a missing callGeminiImpl throws clearly instead of silently defaulting to a real Gemini client', async () => {
    await expect(
      handleWriteClaimWording(
        { bundle },
        { db: {}, apiKeys: { gemini: 'test-key' }, getModelImpl: makeGetModelImpl() }
      )
    ).rejects.toThrow(/callGeminiImpl is required/);
  });

  it('a non-function callGeminiImpl (e.g. accidentally passed undefined) throws the same clear error', async () => {
    await expect(
      handleWriteClaimWording(
        { bundle },
        {
          db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl: undefined, getModelImpl: makeGetModelImpl(),
        }
      )
    ).rejects.toThrow(/callGeminiImpl is required/);
  });

  it('oversized/invalid bundle -> invalid_bundle reason, zero model calls', async () => {
    const callGeminiImpl = vi.fn();
    const getModelImpl = vi.fn();

    const result = await handleWriteClaimWording(
      { bundle: { ...bundle, notAllowed: true } },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result).toEqual({
      verdict: 'fail',
      wording: null,
      reasons: ['invalid_bundle'],
      writerModel: null,
      verifierModel: null,
    });
    expect(callGeminiImpl).not.toHaveBeenCalled();
    expect(getModelImpl).not.toHaveBeenCalled();
  });

  it('too many excerpts -> invalid_bundle, zero model calls', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ date: '2026-07-01', excerpt: `e${i}` }));
    const callGeminiImpl = vi.fn();
    const getModelImpl = vi.fn();

    const result = await handleWriteClaimWording(
      { bundle: { ...bundle, excerpts: many } },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['invalid_bundle']);
    expect(callGeminiImpl).not.toHaveBeenCalled();
    expect(getModelImpl).not.toHaveBeenCalled();
  });

  it('excerpt over 200 chars -> invalid_bundle, zero model calls', async () => {
    const long = 'x'.repeat(201);
    const callGeminiImpl = vi.fn();
    const getModelImpl = vi.fn();

    const result = await handleWriteClaimWording(
      { bundle: { ...bundle, excerpts: [{ date: '2026-07-01', excerpt: long }] } },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['invalid_bundle']);
    expect(callGeminiImpl).not.toHaveBeenCalled();
    expect(getModelImpl).not.toHaveBeenCalled();
  });

  it('resolves distinct models for writer vs verifier via getModelImpl(db, workload)', async () => {
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: [JSON.stringify({ wording: GOOD_WORDING })],
      verifierModel,
      verifierResponses: [ENTAILED_PASS],
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });
    const db = { marker: 'db-instance' };

    await handleWriteClaimWording(
      { bundle },
      { db, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    expect(getModelImpl).toHaveBeenCalledWith(db, 'insightWriter');
    expect(getModelImpl).toHaveBeenCalledWith(db, 'insightVerifier');
    expect(getModelImpl).toHaveBeenCalledTimes(2);
  });

  it('verifier adapter receives correct systemPrompt and JSON userPrompt with bundle+wording', async () => {
    const callGeminiImpl = makeCallGeminiImpl({
      writerModel,
      writerResponses: [JSON.stringify({ wording: GOOD_WORDING })],
      verifierModel,
      verifierResponses: [ENTAILED_PASS],
    });
    const getModelImpl = makeGetModelImpl({ writerModel, verifierModel });

    await handleWriteClaimWording(
      { bundle },
      { db: {}, apiKeys: { gemini: 'test-key' }, callGeminiImpl, getModelImpl }
    );

    // Filter to verifier calls only (4th arg is model)
    const verifierCalls = callGeminiImpl.mock.calls.filter(([, , , model]) => model === verifierModel);
    expect(verifierCalls).toHaveLength(1);

    // Assert systemPrompt (2nd arg) is correct
    const [, systemPrompt, userPrompt] = verifierCalls[0];
    expect(systemPrompt).toBe(MODEL_SYSTEM_PROMPT);

    // Assert userPrompt (3rd arg) is JSON containing both bundle and wording
    const parsedUserPrompt = JSON.parse(userPrompt);
    expect(parsedUserPrompt).toHaveProperty('bundle');
    expect(parsedUserPrompt).toHaveProperty('wording');
    expect(parsedUserPrompt.wording).toBe(GOOD_WORDING);
    expect(parsedUserPrompt.bundle).toEqual(bundle);
  });
});
