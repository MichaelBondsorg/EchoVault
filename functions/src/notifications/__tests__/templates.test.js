/**
 * Notification Templates Tests
 *
 * Tests template generation for all notification types.
 */

import { describe, it, expect } from 'vitest';
import { getNotificationTemplate, getSupportedTypes } from '../templates.js';

describe('getNotificationTemplate', () => {
  it('generates report_ready notification', () => {
    const result = getNotificationTemplate('report_ready', {
      cadence: 'monthly',
      periodLabel: 'January 2026',
      reportId: 'monthly-2026-01',
    });

    expect(result).toEqual({
      title: 'Your monthly report is ready',
      body: 'Your January 2026 Report is ready to read.',
      data: { type: 'report', reportId: 'monthly-2026-01' },
    });
  });

  it('generates insight_available notification', () => {
    const result = getNotificationTemplate('insight_available', {
      insightId: 'ins-123',
    });

    expect(result.title).toBe('New insight');
    expect(result.data.type).toBe('insight');
    expect(result.data.insightId).toBe('ins-123');
  });

  it('generates prompt_suggestion notification', () => {
    const result = getNotificationTemplate('prompt_suggestion', {
      promptText: 'How are you feeling today?',
      promptId: 'prompt-1',
    });

    expect(result.title).toBe('Reflection prompt');
    expect(result.body).toBe('How are you feeling today?');
    expect(result.data.type).toBe('prompt');
  });

  it('returns null for unknown type', () => {
    expect(getNotificationTemplate('nonexistent')).toBeNull();
  });

  it('uses defaults when params are missing', () => {
    const result = getNotificationTemplate('report_ready', {});
    expect(result.title).toBe('Your weekly report is ready');
    expect(result.body).toBe('Your Life Report is ready to read.');
  });
});

describe('getSupportedTypes', () => {
  it('returns all supported notification types', () => {
    const types = getSupportedTypes();
    expect(types).toContain('report_ready');
    expect(types).toContain('insight_available');
    expect(types).toContain('prompt_suggestion');
  });
});
