/**
 * R4 Task 3 — synthesizer.js: Mood01 display fix, sort-order `.slice` fix,
 * de-escalated prompt, and confidence computed from data sufficiency
 * instead of trusted model output (DR finding 6).
 */
import { describe, it, expect, vi } from 'vitest';
import { callGemini } from '../../../ai/gemini';
import { generateCausalSynthesis } from '../synthesizer';

// synthesizer.js statically imports layer2/baselineManager and
// layer1/threadManager, which in turn import config/firebase — mock it so
// this file never touches a real Firebase app.
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: { now: vi.fn(() => ({})) },
}));

vi.mock('../../../ai/gemini', () => ({
  callGemini: vi.fn(async () => JSON.stringify({
    insight: {
      title: 'Test Insight',
      type: 'causal_synthesis',
      summary: 'A summary.',
      body: 'A body.',
      mechanism: 'A mechanism.',
      evidence: {
        // Model-authored — must NOT be trusted/persisted verbatim.
        narrative: ['"a quote the model invented"'],
        biometric: ['HRV +99ms (invented)'],
        statistical: { correlation: 0.99, sampleSize: 999, confidence: 0.99 },
      },
    },
    recommendation: {
      action: 'Do a thing',
      timing: 'Tonight',
      reasoning: 'Because.',
      expectedOutcome: 'You will feel 40% better (invented)',
      confidence: 0.99,
    },
    metadata: { urgency: 'high' },
  })),
}));

function buildEntries(count, moods) {
  // DESCENDING order (most recent first) — matches orchestrator's real
  // fetch contract (createdAt desc).
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => ({
    id: `entry-${i}`,
    createdAt: new Date(now - i * DAY_MS).toISOString(),
    text: `Entry number ${i}.`,
    mood: moods ? moods[i] : 0.5,
  }));
}

describe('generateCausalSynthesis — evidence/confidence trust boundary (DR finding 6)', () => {
  it('does NOT persist the model-authored evidence.narrative/biometric/statistical.correlation', async () => {
    const context = { recentEntries: buildEntries(12) };
    const result = await generateCausalSynthesis('user-1', context);

    expect(result.success).toBe(true);
    expect(result.insight.evidence.narrative).toBeUndefined();
    expect(result.insight.evidence.biometric).toBeUndefined();
    expect(result.insight.evidence.statistical.correlation).toBeUndefined();
  });

  it('computes confidence from sampleSize (data sufficiency), not the model-authored confidence value', async () => {
    const context = { recentEntries: buildEntries(25) }; // >=20 -> 'strong' band (0.8)
    const result = await generateCausalSynthesis('user-1', context);

    expect(result.insight.confidence).toBe(0.8);
    expect(result.insight.confidence).not.toBe(0.99); // the model's invented value
  });

  it('a thin sample (fewer than 10 entries) yields a low/tentative confidence, never the model\'s 0.99', async () => {
    const context = { recentEntries: buildEntries(6) };
    const result = await generateCausalSynthesis('user-1', context);

    expect(result.insight.confidence).toBeLessThan(0.5);
  });

  it('drops the model-authored expectedOutcome and recommendation.confidence (unverified prediction claims)', async () => {
    const context = { recentEntries: buildEntries(12) };
    const result = await generateCausalSynthesis('user-1', context);

    expect(result.insight.recommendation.action).toBe('Do a thing');
    expect(result.insight.recommendation.expectedOutcome).toBeUndefined();
    expect(result.insight.recommendation.confidence).toBeUndefined();
  });

  it('sampleSize on the persisted evidence reflects the REAL entry count fed to synthesis, not the model\'s invented 999', async () => {
    const context = { recentEntries: buildEntries(12) };
    const result = await generateCausalSynthesis('user-1', context);

    expect(result.insight.evidence.statistical.sampleSize).toBe(12);
  });
});

describe('generateCausalSynthesis — sort-order contract (`.slice(0, 5)` fix)', () => {
  it('prompt describes the 5 MOST RECENT entries, not the 5 oldest, given a DESCENDING entries array', async () => {
    callGemini.mockClear();
    // 8 entries, DESCENDING (index 0 = most recent). Only the first 5
    // (most recent) should appear in the prompt.
    const entries = buildEntries(8);
    await generateCausalSynthesis('user-1', { recentEntries: entries });

    const prompt = callGemini.mock.calls.at(-1)[0];
    for (let i = 0; i < 5; i++) {
      expect(prompt).toContain(`Entry number ${i}.`);
    }
    for (let i = 5; i < 8; i++) {
      expect(prompt).not.toContain(`Entry number ${i}.`);
    }
  });
});

describe('generateCausalSynthesis — Mood01 display conversion', () => {
  it('per-entry mood in the prompt is shown as a converted percentage, not the raw 0-1 value', async () => {
    callGemini.mockClear();
    const entries = buildEntries(1, [0.73]);
    await generateCausalSynthesis('user-1', { recentEntries: entries });

    const prompt = callGemini.mock.calls.at(-1)[0];
    expect(prompt).toContain('Mood: 73%');
    expect(prompt).not.toContain('Mood: 0.73%');
  });
});

describe('generateCausalSynthesis — de-escalated prompt (no invention demands)', () => {
  it('no longer asks for a "profound" insight, a prediction, or dramatic ("holy shit") framing', async () => {
    callGemini.mockClear();
    await generateCausalSynthesis('user-1', { recentEntries: buildEntries(10) });

    const prompt = callGemini.mock.calls.at(-1)[0];
    expect(prompt.toLowerCase()).not.toContain('profound');
    expect(prompt.toLowerCase()).not.toContain('holy shit');
    expect(prompt.toLowerCase()).not.toContain('predicts the likely outcome');
  });

  it('explicitly tells the model not to invent numbers/quotes and that its confidence is ignored', async () => {
    callGemini.mockClear();
    await generateCausalSynthesis('user-1', { recentEntries: buildEntries(10) });

    const prompt = callGemini.mock.calls.at(-1)[0];
    expect(prompt.toLowerCase()).toContain('never invent');
    expect(prompt.toLowerCase()).toContain('ignores any confidence');
  });
});
