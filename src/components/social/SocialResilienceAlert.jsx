/**
 * Social Resilience Alert Component
 *
 * Shows when isolation patterns are detected.
 * Uses gentle, non-judgmental language and offers
 * small, actionable steps to reconnect.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Scale,
  MessageCircle,
  Users,
  Phone,
  Calendar,
  X,
  ChevronRight,
  ChevronDown,
  Sparkles
} from 'lucide-react';

const ICON_MAP = {
  Heart: Heart,
  Scale: Scale,
  MessageCircle: MessageCircle,
  Users: Users
};

const COLOR_MAP = {
  rose: {
    bg: 'bg-terra-50 dark:bg-terra-900/30',
    border: 'border-terra-200 dark:border-terra-800',
    icon: 'bg-terra-100 text-terra-600 dark:bg-terra-800/40 dark:text-terra-400',
    title: 'text-terra-800 dark:text-terra-200',
    text: 'text-terra-700 dark:text-terra-300',
    button: 'bg-terra-500 hover:bg-terra-600 text-white dark:bg-terra-600 dark:hover:bg-terra-500'
  },
  amber: {
    bg: 'bg-honey-50 dark:bg-honey-900/30',
    border: 'border-honey-200 dark:border-honey-800',
    icon: 'bg-honey-100 text-honey-600 dark:bg-honey-800/40 dark:text-honey-400',
    title: 'text-honey-800 dark:text-honey-200',
    text: 'text-honey-700 dark:text-honey-300',
    button: 'bg-honey-500 hover:bg-honey-600 text-white dark:bg-honey-600 dark:hover:bg-honey-500'
  },
  blue: {
    bg: 'bg-lavender-50 dark:bg-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-800',
    icon: 'bg-lavender-100 text-lavender-600 dark:bg-lavender-800/40 dark:text-lavender-400',
    title: 'text-lavender-800 dark:text-lavender-200',
    text: 'text-lavender-700 dark:text-lavender-300',
    button: 'bg-lavender-500 hover:bg-lavender-600 text-white dark:bg-lavender-600 dark:hover:bg-lavender-500'
  },
  green: {
    bg: 'bg-sage-50 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-800',
    icon: 'bg-sage-100 text-sage-600 dark:bg-sage-800/40 dark:text-sage-400',
    title: 'text-sage-800 dark:text-sage-200',
    text: 'text-sage-700 dark:text-sage-300',
    button: 'bg-sage-500 hover:bg-sage-600 text-white dark:bg-sage-600 dark:hover:bg-sage-500'
  },
  purple: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/40',
    border: 'border-lavender-300 dark:border-lavender-700',
    icon: 'bg-lavender-200 text-lavender-700 dark:bg-lavender-800/50 dark:text-lavender-300',
    title: 'text-lavender-900 dark:text-lavender-200',
    text: 'text-lavender-800 dark:text-lavender-300',
    button: 'bg-lavender-600 hover:bg-lavender-700 text-white dark:bg-lavender-700 dark:hover:bg-lavender-600'
  }
};

const SocialResilienceAlert = ({ nudge, onAction, onDismiss }) => {
  const [showDismissOptions, setShowDismissOptions] = useState(false);
  const [actionTaken, setActionTaken] = useState(false);

  if (!nudge) return null;

  const IconComponent = ICON_MAP[nudge.icon] || Heart;
  const colors = COLOR_MAP[nudge.color] || COLOR_MAP.blue;

  const handleAction = (action) => {
    setActionTaken(true);
    onAction?.(action);
  };

  const handleDismiss = (reason) => {
    onDismiss?.(reason);
    setShowDismissOptions(false);
  };

  // Success state after taking action
  if (actionTaken) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-sage-50 dark:bg-sage-900/30 rounded-2xl border border-sage-200 dark:border-sage-800 p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sage-100 dark:bg-sage-800/40 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-sage-600 dark:text-sage-400" />
          </div>
          <div>
            <p className="text-sage-800 dark:text-sage-200 font-medium">Nice!</p>
            <p className="text-sage-600 dark:text-sage-400 text-sm">
              Small moments of connection add up.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${colors.bg} rounded-2xl border ${colors.border} overflow-hidden`}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className={`font-medium ${colors.title}`}>
                {nudge.title}
              </h3>
              {nudge.dismissible && (
                <button
                  onClick={() => setShowDismissOptions(!showDismissOptions)}
                  className="text-warm-400 hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300 flex-shrink-0"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <p className={`text-sm mt-1 ${colors.text}`}>
              {nudge.message}
            </p>
            {nudge.subMessage && (
              <p className={`text-sm mt-2 ${colors.text} opacity-80`}>
                {nudge.subMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {nudge.actions && nudge.actions.length > 0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {nudge.actions.map((action, idx) => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                idx === 0
                  ? colors.button
                  : 'bg-white/50 text-warm-600 hover:bg-white dark:bg-white/10 dark:text-warm-300 dark:hover:bg-white/20'
              }`}
            >
              {action.id === 'text' && <MessageCircle size={16} />}
              {action.id === 'call' && <Phone size={16} />}
              {action.id === 'schedule' && <Calendar size={16} />}
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Dismiss Options */}
      <AnimatePresence>
        {showDismissOptions && nudge.dismissOptions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-warm-100 dark:border-warm-800 bg-white/50 dark:bg-hearth-850/50"
          >
            <div className="p-4 space-y-2">
              <p className="text-xs text-warm-500 dark:text-warm-400 mb-2">
                Why are you dismissing this?
              </p>
              {nudge.dismissOptions.map(option => (
                <button
                  key={option.id}
                  onClick={() => handleDismiss(option.id)}
                  className="w-full text-left px-3 py-2 text-sm text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-lg transition-colors"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Compact version for inline display
 */
export const SocialNudgeCompact = ({ nudge, onAction, onDismiss }) => {
  if (!nudge) return null;

  const IconComponent = ICON_MAP[nudge.icon] || Heart;
  const colors = COLOR_MAP[nudge.color] || COLOR_MAP.blue;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={`${colors.bg} rounded-xl border ${colors.border} p-3`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.icon}`}>
          <IconComponent size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${colors.text} truncate`}>
            {nudge.message}
          </p>
        </div>
        <button
          onClick={() => onAction?.(nudge.actions?.[0])}
          className={`text-sm font-medium ${colors.title} hover:underline flex items-center gap-1`}
        >
          Act <ChevronRight size={14} />
        </button>
      </div>
    </motion.div>
  );
};

/**
 * Neglected connections list component
 */
export const NeglectedConnectionsList = ({ connections, onReachOut }) => {
  if (!connections || connections.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-warm-500 dark:text-warm-400 font-medium">
        People you haven't mentioned in a while:
      </p>
      {connections.slice(0, 3).map(person => (
        <div
          key={person.name}
          className="flex items-center justify-between p-3 bg-warm-50 dark:bg-warm-800/30 rounded-xl"
        >
          <div>
            <p className="text-warm-800 dark:text-warm-200 font-medium capitalize">
              {person.name}
            </p>
            <p className="text-xs text-warm-500 dark:text-warm-400">
              {person.daysSince} days since last mention
            </p>
          </div>
          <button
            onClick={() => onReachOut?.(person)}
            className="text-sm text-lavender-600 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300 font-medium flex items-center gap-1"
          >
            <MessageCircle size={14} />
            Reach out
          </button>
        </div>
      ))}
    </div>
  );
};

export default SocialResilienceAlert;
