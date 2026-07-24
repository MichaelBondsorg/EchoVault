/**
 * Helper to get active reflection prompts that haven't been dismissed
 * Used for AI detection of answered prompts during entry save
 *
 * PRIV-01 (docs/superpowers/plans/2026-07-24-full-product-review.md,
 * src/services/storage/storageRegistry.js's 'prompts.dismissed' row):
 * dismissed-prompt state used to live under a global, unowned
 * `reflections_dismissed_${category}` localStorage key — one user's
 * dismissals (and the follow-up questions they imply about their journal
 * content) were readable/writable by the next signed-in account on a shared
 * device. `getDismissedPromptKeys`/`dismissRelectionPrompt` below are the
 * single shared implementation now used here AND by
 * src/components/zen/AppLayout.jsx and
 * src/components/zen/widgets/PromptWidget.jsx (which previously each had
 * their own copy of this same logic against the same unowned key) so all
 * three stay in lockstep on the owner-scoped key and the legacy-quarantine
 * behavior.
 */
import { ownerStorageKey } from '../storage/ownerScopedStorage';

const legacyDismissedKey = (category) => `reflections_dismissed_${category}`;
const dismissedKey = (uid, category) => ownerStorageKey(uid, `prompts/dismissed/${category}`);

/**
 * Read this owner's dismissed-prompt set for a category. On a scoped miss,
 * quarantines (deletes, never adopts) any pre-migration legacy global value
 * for that category — per ADR-0001, unowned data is never claimed by
 * whichever account happens to be signed in.
 *
 * @param {string} uid - Required. The signed-in owner's uid. Returns an
 *   empty set (fails closed) if missing.
 * @param {string} category - Current category (personal/work)
 * @returns {Set<string>} Lowercased dismissed question keys
 */
export const getDismissedPromptKeys = (uid, category) => {
  if (!uid || !category) return new Set();

  try {
    const stored = localStorage.getItem(dismissedKey(uid, category));
    if (stored) return new Set(JSON.parse(stored));

    // This owner has never dismissed a prompt in this category — quarantine
    // any lingering pre-migration global value instead of ever reading it.
    localStorage.removeItem(legacyDismissedKey(category));
    return new Set();
  } catch (e) {
    console.error('Failed to parse dismissed questions:', e);
    return new Set();
  }
};

/**
 * Get active reflection prompts from recent entries
 * Mirrors the logic in PromptWidget.jsx
 *
 * @param {Array} entries - All entries
 * @param {string} category - Current category (personal/work)
 * @param {string} uid - The signed-in owner's uid (required to read any
 *   dismissed-prompt state; every question is treated as active if missing).
 * @returns {Array<string>} - Array of prompt strings
 */
export const getActiveReflectionPrompts = (entries, category, uid) => {
  const dismissedQuestions = getDismissedPromptKeys(uid, category);

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
 * Dismiss a reflection prompt (add to this owner's dismissed-prompt set)
 *
 * @param {string} prompt - The prompt text to dismiss
 * @param {string} category - Current category
 * @param {string} uid - Required. The signed-in owner's uid. No-ops (fails
 *   closed) if missing — a dismissal is never written to an unowned key.
 */
export const dismissReflectionPrompt = (prompt, category, uid) => {
  if (!prompt || !category || !uid) return;

  const key = dismissedKey(uid, category);
  try {
    const dismissed = [...getDismissedPromptKeys(uid, category)];
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
