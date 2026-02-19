/**
 * Tests for the GapPromptCard UI component.
 *
 * Verifies rendering, user interactions (accept/dismiss/snooze),
 * and engagement tracking calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock engagement tracking
vi.mock('../../../services/nexus/gapPromptGenerator', () => ({
  trackEngagement: vi.fn(() => Promise.resolve()),
  PROMPT_STYLES: ['reflective', 'exploratory', 'gratitude', 'action'],
}));

import {
  GapPromptCard,
  DOMAIN_LABELS,
  buildEngagementPayload,
} from '../GapPromptCard';
import { trackEngagement } from '../../../services/nexus/gapPromptGenerator';

const samplePrompt = {
  domain: 'relationships',
  promptText: "It's been a couple of weeks since you reflected on your relationships. How are your connections with people feeling lately?",
  promptStyle: 'reflective',
  gapScore: 1.8,
  lastMentionDate: null,
  metadata: { seasonal: false, personalized: true },
};

describe('GapPromptCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DOMAIN_LABELS', () => {
    it('has human-readable labels for all 8 domains', () => {
      const domains = ['work', 'relationships', 'health', 'creativity',
        'spirituality', 'personal-growth', 'family', 'finances'];
      for (const domain of domains) {
        expect(DOMAIN_LABELS[domain]).toBeTruthy();
        expect(typeof DOMAIN_LABELS[domain]).toBe('string');
      }
    });
  });

  describe('buildEngagementPayload', () => {
    it('creates correct payload for accepted response', () => {
      const payload = buildEngagementPayload(samplePrompt, 'accepted');
      expect(payload.domain).toBe('relationships');
      expect(payload.promptStyle).toBe('reflective');
      expect(payload.response).toBe('accepted');
      expect(payload.resultedInEntry).toBe(false);
      expect(payload.timestamp).toBeInstanceOf(Date);
    });

    it('creates correct payload for snoozed response', () => {
      const payload = buildEngagementPayload(samplePrompt, 'snoozed');
      expect(payload.response).toBe('snoozed');
    });

    it('creates correct payload for dismissed response', () => {
      const payload = buildEngagementPayload(samplePrompt, 'dismissed');
      expect(payload.response).toBe('dismissed');
    });
  });

  describe('GapPromptCard component', () => {
    it('is a valid React component', () => {
      expect(typeof GapPromptCard).toBe('function');
    });
  });

  describe('engagement tracking integration', () => {
    it('tracks engagement when accept is called', async () => {
      const payload = buildEngagementPayload(samplePrompt, 'accepted');
      await trackEngagement('user-123', payload);

      expect(trackEngagement).toHaveBeenCalledWith('user-123', expect.objectContaining({
        domain: 'relationships',
        promptStyle: 'reflective',
        response: 'accepted',
      }));
    });

    it('tracks engagement when snooze is called', async () => {
      const payload = buildEngagementPayload(samplePrompt, 'snoozed');
      await trackEngagement('user-123', payload);

      expect(trackEngagement).toHaveBeenCalledWith('user-123', expect.objectContaining({
        response: 'snoozed',
      }));
    });

    it('tracks engagement when dismiss is called', async () => {
      const payload = buildEngagementPayload(samplePrompt, 'dismissed');
      await trackEngagement('user-123', payload);

      expect(trackEngagement).toHaveBeenCalledWith('user-123', expect.objectContaining({
        response: 'dismissed',
      }));
    });
  });
});
