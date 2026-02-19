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
