/**
 * Starter Recipe templates (R2 Task 16) — the question strings must match
 * the plan brief character-for-character (TDD contract, not paraphrased).
 */
import { describe, it, expect } from 'vitest';
import { STARTER_RECIPES } from '../starterRecipes.js';

describe('STARTER_RECIPES', () => {
  it('has exactly 4 templates', () => {
    expect(STARTER_RECIPES).toHaveLength(4);
  });

  it('Monthly review — exact strings, timeRangeDays 30', () => {
    const r = STARTER_RECIPES.find((x) => x.name === 'Monthly review');
    expect(r.questions).toEqual([
      'What changed for me this month?',
      'What patterns kept showing up?',
      'What do I want to carry into next month?',
    ]);
    expect(r.timeRangeDays).toBe(30);
  });

  it('Goal progress — exact strings, timeRangeDays 30', () => {
    const r = STARTER_RECIPES.find((x) => x.name === 'Goal progress');
    expect(r.questions).toEqual([
      'What progress did I make on the goals I mentioned?',
      'Where did I get stuck, and what helped?',
    ]);
    expect(r.timeRangeDays).toBe(30);
  });

  it('Relationship check-in — exact strings, timeRangeDays 30', () => {
    const r = STARTER_RECIPES.find((x) => x.name === 'Relationship check-in');
    expect(r.questions).toEqual([
      'How have my important relationships felt lately?',
      'What moments with people stood out?',
    ]);
    expect(r.timeRangeDays).toBe(30);
  });

  it('Session preparation — exact strings, timeRangeDays 30', () => {
    const r = STARTER_RECIPES.find((x) => x.name === 'Session preparation');
    expect(r.questions).toEqual([
      'What changed since my last session?',
      'Which moments do I want to bring up?',
      'What patterns came up, and what am I unsure about?',
      'What open questions do I want to ask?',
    ]);
    expect(r.timeRangeDays).toBe(30);
  });

  it('every template has <=5 questions (rules limit) and no scope field (defaults All spaces)', () => {
    STARTER_RECIPES.forEach((r) => {
      expect(r.questions.length).toBeLessThanOrEqual(5);
      expect(r.scope).toBeUndefined();
    });
  });
});
