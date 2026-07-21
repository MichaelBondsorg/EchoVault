/**
 * Starter Reflection Recipe templates (R2 Task 16, PRD §5.6 P0).
 *
 * Seeded into the user's `recipes` collection the first time they open the
 * Recipes screen with zero recipes of their own (Task 17 UI writes these via
 * `createRecipe`). Question strings are exact — copied character-for-
 * character from the plan brief (`docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md`
 * Task 16). Do not reword; the brief's TDD contract pins them verbatim.
 *
 * Each template intentionally omits `scope` — recipes default to `null`
 * (All spaces) at creation via `recipeService.createRecipe`, matching the
 * "All spaces" default used elsewhere for scope pickers.
 */
export const STARTER_RECIPES = [
  {
    name: 'Monthly review',
    questions: [
      'What changed for me this month?',
      'What patterns kept showing up?',
      'What do I want to carry into next month?',
    ],
    timeRangeDays: 30,
  },
  {
    name: 'Goal progress',
    questions: [
      'What progress did I make on the goals I mentioned?',
      'Where did I get stuck, and what helped?',
    ],
    timeRangeDays: 30,
  },
  {
    name: 'Relationship check-in',
    questions: [
      'How have my important relationships felt lately?',
      'What moments with people stood out?',
    ],
    timeRangeDays: 30,
  },
  {
    name: 'Session preparation',
    questions: [
      'What changed since my last session?',
      'Which moments do I want to bring up?',
      'What patterns came up, and what am I unsure about?',
      'What open questions do I want to ask?',
    ],
    timeRangeDays: 30,
  },
];

export default STARTER_RECIPES;
