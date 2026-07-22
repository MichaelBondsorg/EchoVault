/**
 * R4 Task 3 — Mood01 scale-invariance for beliefDissonance.js (DR findings
 * 3/7). Runtime mood is native 0-1; these tests feed 0-1 data and assert
 * the corrected thresholds fire (or don't) at that scale, unlike the
 * pre-fix 0-100-scale literals (`> 50`, `< 5`, `> 20`, `> 15`).
 */
import { describe, it, expect, vi } from 'vitest';
import { validateBeliefAgainstData, generateDissonanceInsight } from '../beliefDissonance';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: { now: vi.fn(() => ({})) },
}));
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../ai/gemini', () => ({ callGemini: vi.fn(async () => null) }));

describe('validateBeliefAgainstData — Mood01 thresholds', () => {
  it('self_worth: flags a >0.50 (not >50) mood range around career entries', async () => {
    const careerEntries = [
      { content: 'Got the job offer! amazing news', mood: 0.95 },
      { content: 'Interview went ok I guess', mood: 0.55 },
      { content: 'Rejected from the job, devastated', mood: 0.10 },
      { content: 'Another interview scheduled', mood: 0.60 },
      { content: 'Career update: waiting to hear back', mood: 0.50 },
    ];
    const otherEntries = Array.from({ length: 6 }, () => ({ content: 'A normal day.', mood: 0.55 }));
    const belief = { category: 'self_worth', statement: "I'm not affected by career outcomes" };

    const validation = await validateBeliefAgainstData(belief, {
      entries: [...careerEntries, ...otherEntries],
      baselines: null,
      threads: [],
    });

    expect(validation.contradictingData.some((d) => d.metric === 'career_mood_range')).toBe(true);
  });

  it('productivity: flags a <0.05 (not <5) mood difference between rest and workout days', async () => {
    const restDays = Array.from({ length: 3 }, () => ({ content: 'Took it easy, rested today.', mood: 0.55 }));
    const workoutDays = Array.from({ length: 5 }, () => ({ content: 'Great workout at the gym.', mood: 0.56 }));
    const belief = { category: 'productivity', statement: "I need to be productive to feel ok" };

    const validation = await validateBeliefAgainstData(belief, {
      entries: [...restDays, ...workoutDays],
      baselines: null,
      threads: [],
    });

    expect(validation.contradictingData.some((d) => d.metric === 'rest_vs_workout_mood')).toBe(true);
  });

  it('emotional_regulation: flags >0.20 (not >20) mood volatility when belief claims stability', async () => {
    const entries = [0.9, 0.1, 0.85, 0.15, 0.8, 0.2].map((mood) => ({ mood }));
    const belief = { category: 'emotional_regulation', statement: "I'm very emotionally stable" };

    const validation = await validateBeliefAgainstData(belief, { entries, baselines: null, threads: [] });

    expect(validation.contradictingData.some((d) => d.metric === 'mood_volatility')).toBe(true);
  });

  it('relationships: flags a >0.15 (not >15) social vs alone mood gap', async () => {
    const socialEntries = Array.from({ length: 3 }, () => ({ content: 'Dinner with friends tonight.', mood: 0.85 }));
    const aloneEntries = Array.from({ length: 3 }, () => ({ content: 'A quiet day alone.', mood: 0.50 }));
    const belief = { category: 'relationships', statement: "I don't need people" };

    const validation = await validateBeliefAgainstData(belief, {
      entries: [...socialEntries, ...aloneEntries],
      baselines: null,
      threads: [],
    });

    expect(validation.contradictingData.some((d) => d.metric === 'social_vs_alone_mood')).toBe(true);
    const entry = validation.contradictingData.find((d) => d.metric === 'social_vs_alone_mood');
    expect(entry.interpretation).toMatch(/35 points higher/);
  });
});

describe('generateDissonanceInsight — Mood01 gate threshold', () => {
  it('the mood gate uses 0.50 (not 50): a currentMood of 0.6 clears it', async () => {
    const belief = { id: 'b1', statement: 'test belief' };
    const validation = { dissonanceScore: 0.9, contradictingData: [{ interpretation: 'x' }] };

    // callGemini mocked to null -> function returns null AFTER passing the
    // mood gate (as opposed to `{queued: true}` if the gate had rejected).
    const result = await generateDissonanceInsight(belief, validation, 0.6);
    expect(result).not.toEqual(expect.objectContaining({ queued: true }));
  });

  it('a currentMood of 0.3 (genuinely low) is gated — queued, not generated', async () => {
    const belief = { id: 'b1', statement: 'test belief' };
    const validation = { dissonanceScore: 0.9, contradictingData: [] };

    const result = await generateDissonanceInsight(belief, validation, 0.3);
    expect(result).toEqual(expect.objectContaining({ queued: true, reason: 'mood_gate' }));
  });
});
