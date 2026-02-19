/**
 * GapPromptCard — Displays a gap-detected reflection prompt.
 *
 * Renders as a subtle, non-intrusive card in the dashboard with
 * accept, dismiss, and snooze actions. Tracks engagement via
 * the gap prompt generator service.
 *
 * Props:
 * @param {Object} prompt - Gap prompt object from generateGapPrompt
 * @param {string} prompt.domain - Life domain (e.g., "relationships")
 * @param {string} prompt.promptText - Therapeutic prompt text
 * @param {string} prompt.promptStyle - Style used ("reflective", etc.)
 * @param {number} prompt.gapScore - Gap severity score
 * @param {string} userId - Authenticated user's ID
 * @param {function} onAccept - Called when user accepts the prompt
 * @param {function} onDismiss - Called when user dismisses
 * @param {function} onSnooze - Called when user snoozes the domain
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, Clock, ChevronRight } from 'lucide-react';
import { trackEngagement } from '../../services/nexus/gapPromptGenerator';

// ============================================================
// Constants
// ============================================================

export const DOMAIN_LABELS = {
  work: 'Work & Career',
  relationships: 'Relationships',
  health: 'Health & Wellness',
  creativity: 'Creativity',
  spirituality: 'Spirituality',
  'personal-growth': 'Personal Growth',
  family: 'Family',
  finances: 'Finances',
};

/**
 * Build an engagement tracking payload from a prompt and response type.
 */
export function buildEngagementPayload(prompt, response) {
  return {
    domain: prompt.domain,
    promptStyle: prompt.promptStyle,
    response,
    resultedInEntry: false,
    timestamp: new Date(),
  };
}

// ============================================================
// Component
// ============================================================

export function GapPromptCard({ prompt, userId, onAccept, onDismiss, onSnooze }) {
  const [isExiting, setIsExiting] = useState(false);

  if (!prompt || !userId) return null;

  const handleAccept = useCallback(async () => {
    setIsExiting(true);
    const payload = buildEngagementPayload(prompt, 'accepted');
    await trackEngagement(userId, payload);
    onAccept?.(prompt);
  }, [prompt, userId, onAccept]);

  const handleDismiss = useCallback(async () => {
    setIsExiting(true);
    const payload = buildEngagementPayload(prompt, 'dismissed');
    await trackEngagement(userId, payload);
    onDismiss?.(prompt);
  }, [prompt, userId, onDismiss]);

  const handleSnooze = useCallback(async () => {
    setIsExiting(true);
    const payload = buildEngagementPayload(prompt, 'snoozed');
    await trackEngagement(userId, payload);
    onSnooze?.(prompt);
  }, [prompt, userId, onSnooze]);

  const domainLabel = DOMAIN_LABELS[prompt.domain] || prompt.domain;

  return (
    <AnimatePresence>
      {!isExiting && (
        <motion.div
          key="gap-prompt-card"
          className="
            bg-white/60 dark:bg-gray-800/60
            backdrop-blur-md
            border border-white/30 dark:border-gray-700/30
            rounded-2xl
            shadow-glass-sm
            p-4
            mx-4 my-2
          "
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-amber-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {domainLabel}
              </span>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-full hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
              aria-label="Dismiss prompt"
            >
              <X size={14} className="text-gray-400" />
            </button>
          </div>

          {/* Prompt Text */}
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-3">
            {prompt.promptText}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAccept}
              className="
                flex-1 flex items-center justify-center gap-1.5
                bg-primary-500/10 hover:bg-primary-500/20
                dark:bg-primary-400/10 dark:hover:bg-primary-400/20
                text-primary-600 dark:text-primary-400
                text-sm font-medium
                rounded-xl py-2 px-3
                transition-colors
              "
            >
              Reflect on this
              <ChevronRight size={14} />
            </button>
            <button
              onClick={handleSnooze}
              className="
                flex items-center gap-1
                text-xs text-gray-500 dark:text-gray-400
                hover:text-gray-700 dark:hover:text-gray-300
                py-2 px-2
                transition-colors
              "
              aria-label="Remind me later"
            >
              <Clock size={12} />
              Later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default GapPromptCard;
