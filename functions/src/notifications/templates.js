/**
 * Notification Templates
 *
 * Centralized notification content for all notification types.
 */

const TEMPLATES = {
  report_ready: (params) => ({
    title: `Your ${params.cadence || 'weekly'} report is ready`,
    body: `Your ${params.periodLabel || 'Life'} Report is ready to read.`,
    data: { type: 'report', reportId: params.reportId },
  }),

  insight_available: (params) => ({
    title: 'New insight',
    body: 'Something interesting came up in your recent patterns.',
    data: { type: 'insight', insightId: params.insightId || '' },
  }),

  prompt_suggestion: (params) => ({
    title: 'Reflection prompt',
    body: params.promptText || 'A new reflection prompt is waiting for you.',
    data: { type: 'prompt', promptId: params.promptId || '' },
  }),

  // Gentle, once-a-day journaling nudge. Deliberately NOT streak-based — the
  // evidence base finds streaks unhelpful (often harmful) for a mental-health
  // audience. `variant` (0-2) lets the caller rotate the copy so it doesn't
  // read the same every day.
  journal_reminder: (params) => {
    const bodies = [
      'Take a minute to check in with yourself today.',
      'How are you, really? A short note is enough.',
      'A quiet moment to reflect is waiting whenever you are.',
    ];
    const idx = ((params.variant ?? 0) % bodies.length + bodies.length) % bodies.length;
    return {
      title: 'A moment to reflect',
      body: bodies[idx],
      data: { type: 'reminder' },
    };
  },
};

/**
 * Generate notification content for a specific type.
 * @param {string} type - Notification type
 * @param {Object} params - Template parameters
 * @returns {{ title: string, body: string, data: Object } | null}
 */
export function getNotificationTemplate(type, params = {}) {
  const templateFn = TEMPLATES[type];
  if (!templateFn) {
    console.warn(`[templates] Unknown notification type: ${type}`);
    return null;
  }
  return templateFn(params);
}

/**
 * Get all supported notification types.
 * @returns {string[]}
 */
export function getSupportedTypes() {
  return Object.keys(TEMPLATES);
}
