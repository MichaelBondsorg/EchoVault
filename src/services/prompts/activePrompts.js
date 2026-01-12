/**
 * Helper to get active reflection prompts that haven't been dismissed
 * Used for AI detection of answered prompts during entry save
 */

/**
 * Get active reflection prompts from recent entries
 * Mirrors the logic in PromptWidget.jsx
 *
 * @param {Array} entries - All entries
 * @param {string} category - Current category (personal/work)
 * @returns {Array<string>} - Array of prompt strings
 */
export const getActiveReflectionPrompts = (entries, category) => {
  // Get dismissed prompts from localStorage
  const dismissedKey = `reflections_dismissed_${category}`;
  let dismissedQuestions = new Set();
  try {
    const stored = localStorage.getItem(dismissedKey);
    if (stored) {
      dismissedQuestions = new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.error('Failed to parse dismissed questions:', e);
  }

  // Extract follow-up questions from recent entries (last 14 days)
  const now = new Date();
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const categoryEntries = entries.filter(e => e.category === category);
  const allQuestions = [];

  categoryEntries.forEach(entry => {
    const entryDate = entry.effectiveDate || entry.createdAt;
    const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

    // Only from last 2 weeks
    if (date < twoWeeksAgo) return;

    const followUps = entry.contextualInsight?.followUpQuestions;
    if (Array.isArray(followUps) && followUps.length > 0) {
      followUps.forEach(q => {
        if (q && typeof q === 'string' && q.trim()) {
          allQuestions.push(q.trim());
        }
      });
    }
  });

  // Filter out dismissed and dedupe
  const seen = new Set();
  const filtered = allQuestions.filter(q => {
    const key = q.toLowerCase();
    if (seen.has(key) || dismissedQuestions.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);

  return filtered;
};

/**
 * Dismiss a reflection prompt (add to localStorage)
 *
 * @param {string} prompt - The prompt text to dismiss
 * @param {string} category - Current category
 */
export const dismissReflectionPrompt = (prompt, category) => {
  if (!prompt || !category) return;

  const key = `reflections_dismissed_${category}`;
  try {
    const stored = localStorage.getItem(key);
    const dismissed = stored ? JSON.parse(stored) : [];
    const promptKey = prompt.toLowerCase();
    if (!dismissed.includes(promptKey)) {
      dismissed.push(promptKey);
      localStorage.setItem(key, JSON.stringify(dismissed));
      console.log('[ActivePrompts] Dismissed prompt:', promptKey);
    }
  } catch (e) {
    console.error('Failed to dismiss reflection:', e);
  }
};
