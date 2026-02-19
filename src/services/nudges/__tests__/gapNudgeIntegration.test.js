/**
 * Tests for gap prompt integration into the nudge orchestrator.
 *
 * Verifies that gap prompts are correctly prioritized, rate-limited,
 * and integrated into the existing nudge pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firestore for nudge history
vi.mock('../../../config/firebase', () => ({
  db: {},
  doc: vi.fn(() => 'mock-doc-ref'),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
  setDoc: vi.fn(() => Promise.resolve()),
}));

// Mock gap prompt generator
vi.mock('../../nexus/gapPromptGenerator', () => ({
  generateGapPrompt: vi.fn(),
}));

import { orchestrateNudges, NUDGE_PRIORITY, NUDGE_COOLDOWNS } from '../nudgeOrchestrator';
import { generateGapPrompt } from '../../nexus/gapPromptGenerator';

describe('Gap Nudge Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gap prompt candidate has priority between anticipatory and value check', () => {
    // Gap prompts should rank below anticipatory events but above value checks
    expect(NUDGE_PRIORITY.GAP_PROMPT).toBeDefined();
    expect(NUDGE_PRIORITY.GAP_PROMPT).toBeGreaterThan(NUDGE_PRIORITY.VALUE_CHECK);
    expect(NUDGE_PRIORITY.GAP_PROMPT).toBeLessThan(NUDGE_PRIORITY.ANTICIPATORY_TODAY);
  });

  it('gap prompt has 24-hour cooldown', () => {
    expect(NUDGE_COOLDOWNS.GAP_PROMPT).toBe(24 * 60 * 60 * 1000);
  });

  it('includes gap prompt in orchestration when provided', async () => {
    const gapPrompt = {
      domain: 'creativity',
      promptText: 'What creative pursuits have you been thinking about?',
      promptStyle: 'exploratory',
      gapScore: 2.5,
    };

    const result = await orchestrateNudges({
      gapPrompt,
    }, 'user-123');

    expect(result).not.toBeNull();
    expect(result.domain).toBe('creativity');
    expect(result._orchestrator.type).toBe('GAP_PROMPT');
    expect(result._orchestrator.source).toBe('gap_detector');
  });

  it('gap prompt loses to higher-priority burnout nudge', async () => {
    const result = await orchestrateNudges({
      burnoutNudge: { riskLevel: 'high', triggerShelterMode: true },
      gapPrompt: {
        domain: 'creativity',
        promptText: 'Test prompt',
        promptStyle: 'exploratory',
        gapScore: 2.5,
      },
    }, 'user-123');

    expect(result).not.toBeNull();
    expect(result._orchestrator.type).toBe('BURNOUT_HIGH');
  });

  it('gap prompt wins over value check nudge', async () => {
    const result = await orchestrateNudges({
      valueNudge: { hasSignificantGap: true },
      gapPrompt: {
        domain: 'health',
        promptText: 'Test prompt',
        promptStyle: 'reflective',
        gapScore: 1.8,
      },
    }, 'user-123');

    expect(result).not.toBeNull();
    expect(result._orchestrator.type).toBe('GAP_PROMPT');
  });

  it('does not include gap prompt when null', async () => {
    const result = await orchestrateNudges({
      gapPrompt: null,
    }, 'user-123');

    expect(result).toBeNull();
  });
});
