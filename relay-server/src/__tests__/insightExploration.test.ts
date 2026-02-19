/**
 * insightExploration.test.ts
 *
 * Tests for the insight exploration guided session definition.
 * Validates structure, prompt flow, and schema conformance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSessionDefinition } from '../sessions/schema.js';
import type { GuidedSessionDefinition } from '../sessions/schema.js';

// Mock firebase to avoid import errors from guidedPipeline transitive deps
vi.mock('../auth/firebase.js', () => ({
  firestore: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnValue({ get: vi.fn() }),
    batch: vi.fn(),
  },
  APP_COLLECTION_ID: 'echo-vault-v5-fresh',
}));

const { insightExploration } = await import('../sessions/definitions/insight-exploration.js');

describe('insightExploration session definition', () => {
  it('should have a valid GuidedSessionDefinition structure', () => {
    const parsed = validateSessionDefinition(insightExploration);
    expect(parsed.id).toBe('insight_exploration');
    expect(parsed.name).toBeTruthy();
    expect(parsed.prompts.length).toBeGreaterThanOrEqual(1);
    expect(parsed.outputProcessing).toBeDefined();
  });

  it('should use the ACT therapeutic framework for output processing', () => {
    expect(insightExploration.outputProcessing.therapeuticFramework).toBe('act');
  });

  it('should require relevant goals and recent entries as context', () => {
    expect(insightExploration.contextNeeds.relevantGoals).toBe(true);
    expect(insightExploration.contextNeeds.recentEntries).toBeGreaterThanOrEqual(5);
    expect(insightExploration.contextNeeds.recurringPatterns).toBe(true);
  });

  it('should have prompts that follow present -> discuss -> action structure', () => {
    const promptIds = insightExploration.prompts.map((p) => p.id);

    // Must have insight presentation, user perspective, and action steps
    expect(promptIds).toContain('insight_overview');
    expect(promptIds).toContain('user_perspective');
    expect(promptIds).toContain('action_step');

    // Present before discuss before action
    const overviewIdx = promptIds.indexOf('insight_overview');
    const perspectiveIdx = promptIds.indexOf('user_perspective');
    const actionIdx = promptIds.indexOf('action_step');

    expect(overviewIdx).toBeLessThan(perspectiveIdx);
    expect(perspectiveIdx).toBeLessThan(actionIdx);
  });

  it('should include an opening message that frames the session purpose', () => {
    expect(insightExploration.openingMessage).toBeTruthy();
    expect(insightExploration.openingMessage!.toLowerCase()).toContain('pattern');
  });

  it('should include a closing message with encouragement', () => {
    expect(insightExploration.closingMessage).toBeTruthy();
  });

  it('should set extractSignals to true for output processing', () => {
    expect(insightExploration.outputProcessing.extractSignals).toBe(true);
  });

  it('should have estimated minutes between 8 and 15', () => {
    expect(insightExploration.estimatedMinutes).toBeGreaterThanOrEqual(8);
    expect(insightExploration.estimatedMinutes).toBeLessThanOrEqual(15);
  });

  it('should have insight placeholder prompts for dynamic content', () => {
    const allPromptText = insightExploration.prompts.map((p) => p.prompt).join(' ');
    expect(allPromptText).toContain('{insightSummary}');
  });

  it('should have follow-up triggers for engagement keywords', () => {
    const perspectivePrompt = insightExploration.prompts.find((p) => p.id === 'user_perspective');
    expect(perspectivePrompt?.followUpTriggers).toBeDefined();
    expect(perspectivePrompt!.followUpTriggers!.length).toBeGreaterThan(0);
  });
});

describe('insightExploration skip conditions', () => {
  it('should skip second_insight prompt when only 1 insight available', async () => {
    const { createGuidedSessionState, getNextPrompt, processResponse } = await import('../sessions/runner.js');

    const context = {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: { trend: 'stable' as const, recentAverage: 0.5 },
      insightSummaries: ['Only one insight available'],
    };

    const state = createGuidedSessionState('insight_exploration', context)!;
    expect(state).not.toBeNull();

    // Walk through all prompts, collecting their IDs
    // Note: Opening message shares a response slot with prompts[0],
    // so we just skip it and collect from the first real prompt onward.
    const promptIds: string[] = [];
    let prompt = getNextPrompt(state); // opening message (index becomes 0)
    expect(prompt?.isOpening).toBe(true);

    // Get first real prompt (prompts[0])
    prompt = getNextPrompt(state);
    while (prompt) {
      if (prompt.isClosing) break;
      if (prompt.promptId) {
        promptIds.push(prompt.promptId);
      }
      processResponse(state, 'I see, that makes sense.');
      prompt = getNextPrompt(state);
    }

    // second_insight should be skipped when only 1 insight
    expect(promptIds).not.toContain('second_insight');
    // insight_overview should be present as the first prompt
    expect(promptIds).toContain('insight_overview');
  });

  it('should include second_insight prompt when 2+ insights available', async () => {
    const { createGuidedSessionState, getNextPrompt, processResponse } = await import('../sessions/runner.js');

    const context = {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: { trend: 'stable' as const, recentAverage: 0.5 },
      insightSummaries: ['First insight', 'Second insight'],
    };

    const state = createGuidedSessionState('insight_exploration', context)!;

    const promptIds: string[] = [];
    let prompt = getNextPrompt(state); // opening message
    prompt = getNextPrompt(state); // first real prompt
    while (prompt) {
      if (prompt.isClosing) break;
      if (prompt.promptId) {
        promptIds.push(prompt.promptId);
      }
      processResponse(state, 'I see, that makes sense.');
      prompt = getNextPrompt(state);
    }

    expect(promptIds).toContain('second_insight');
  });
});

describe('insightExploration prompt rendering', () => {
  it('should render {insightSummary} placeholder from context', async () => {
    const { renderPromptWithInsights } = await import('../sessions/runner.js');
    const prompt = insightExploration.prompts.find((p) => p.id === 'insight_overview')!;

    const context = {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: { trend: 'stable' as const, recentAverage: 0.5 },
      insightSummaries: ['You exercise more on mornings after good sleep'],
    };

    const rendered = renderPromptWithInsights(prompt, context);
    expect(rendered).toContain('You exercise more on mornings after good sleep');
    expect(rendered).not.toContain('{insightSummary}');
  });

  it('should render {secondInsightSummary} placeholder', async () => {
    const { renderPromptWithInsights } = await import('../sessions/runner.js');
    const prompt = insightExploration.prompts.find((p) => p.id === 'second_insight')!;

    const context = {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: { trend: 'stable' as const, recentAverage: 0.5 },
      insightSummaries: ['First insight', 'Your stress peaks on Wednesdays'],
    };

    const rendered = renderPromptWithInsights(prompt, context);
    expect(rendered).toContain('Your stress peaks on Wednesdays');
  });

  it('should use fallback text when no insight summaries available', async () => {
    const { renderPromptWithInsights } = await import('../sessions/runner.js');
    const prompt = insightExploration.prompts.find((p) => p.id === 'insight_overview')!;

    const context = {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: { trend: 'stable' as const, recentAverage: 0.5 },
    };

    const rendered = renderPromptWithInsights(prompt, context);
    expect(rendered).not.toContain('{insightSummary}');
    // Should have some fallback text instead
    expect(rendered.length).toBeGreaterThan(10);
  });
});
