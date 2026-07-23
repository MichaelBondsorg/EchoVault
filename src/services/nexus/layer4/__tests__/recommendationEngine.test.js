/**
 * R4 Phase 3 Task 5 (P3-D1) — recommendationEngine.js reduced to ideas-only.
 *
 * interventionTracker.js is deleted whole; there is no more personal
 * evidence, score, effectiveness data, or predicted outcome anywhere in
 * this engine. These tests replace the old MIN_EVIDENCE_OCCURRENCES /
 * riskyClaimsEnabled / fabricated-fallback-number suite (all of which
 * exercised deleted code) with coverage of the surviving contract: a
 * static state -> idea map, generic reasoning, and timing, with no
 * personal-evidence fields ever present on the output.
 */
import { describe, it, expect } from 'vitest';
import { generateRecommendations } from '../recommendationEngine';

const baseContext = (overrides = {}) => ({
  currentState: { primary: 'stable' },
  whoopToday: null,
  recentMood: 0.5,
  timeOfDay: 'morning',
  ...overrides,
});

describe('generateRecommendations — ideas-only contract (no personal evidence)', () => {
  it('returns generic ideas with no score, expectedOutcome, or confidence field', async () => {
    const recs = await generateRecommendations('user-1', baseContext());

    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.score).toBeUndefined();
      expect(rec.expectedOutcome).toBeUndefined();
      expect(rec.confidence).toBeUndefined();
      expect(rec.reasoning).not.toMatch(/historically|your mood|your HRV|points|%/i);
    }
  });

  it('caps at 3 ideas', async () => {
    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'career_waiting' },
    }));
    expect(recs.length).toBeLessThanOrEqual(3);
  });

  it('falls back to the "stable" idea set for an unrecognized state', async () => {
    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'totally_unknown_state' },
    }));
    expect(recs.length).toBeGreaterThan(0);
  });

  it('falls back to the "stable" idea set when currentState is absent entirely', async () => {
    const recs = await generateRecommendations('user-1', baseContext({ currentState: undefined }));
    expect(recs.length).toBeGreaterThan(0);
  });

  it('genericIdeaReasoning renders a readable, non-evidence-claiming sentence per intervention', async () => {
    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'career_rejection' },
    }));
    const rec = recs.find((r) => r.intervention === 'acts_of_service');
    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Acts of service could be worth trying right now.');
  });

  it('does not depend on interventionTracker.js at all — no getInterventionData mock exists anywhere in this file', async () => {
    // No vi.mock for '../interventionTracker' anywhere in this file — if
    // recommendationEngine.js still imported it, this file would need a
    // Firestore/firebase mock to even load. Passing at all is the
    // assertion.
    const recs = await generateRecommendations('user-1', baseContext());
    expect(Array.isArray(recs)).toBe(true);
  });
});

describe('generateRecommendations — different states yield different idea sets', () => {
  it('career_waiting includes pet_walk; stable does not', async () => {
    const waiting = await generateRecommendations('user-1', baseContext({ currentState: { primary: 'career_waiting' } }));
    const stable = await generateRecommendations('user-1', baseContext({ currentState: { primary: 'stable' } }));

    expect(waiting.some((r) => r.intervention === 'pet_walk')).toBe(true);
    expect(stable.some((r) => r.intervention === 'pet_walk')).toBe(false);
  });
});

describe('generateRecommendations — timing', () => {
  it('provides a timing string per idea', async () => {
    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'stable' },
      timeOfDay: 'morning',
    }));
    for (const rec of recs) {
      expect(typeof rec.timing).toBe('string');
      expect(rec.timing.length).toBeGreaterThan(0);
    }
  });
});
