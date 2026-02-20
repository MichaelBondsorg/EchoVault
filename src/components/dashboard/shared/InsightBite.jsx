import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, TrendingUp, AlertCircle, Star } from 'lucide-react';

/**
 * InsightBite - A single rotating insight component
 *
 * Displays one pattern/insight at a time with dismiss functionality.
 * Used to surface key observations without overwhelming the user.
 *
 * Props:
 * - insight: { message, type, priority, entity? }
 * - onDismiss: () => void
 * - onShowMore: () => void - Navigate to full insights panel
 */

const typeConfig = {
  pattern: {
    icon: TrendingUp,
    bg: 'bg-lavender-50 dark:bg-lavender-900/30',
    border: 'border-lavender-100 dark:border-lavender-800',
    iconBg: 'bg-lavender-100 dark:bg-lavender-900/40',
    iconColor: 'text-lavender-500 dark:text-lavender-400',
    textColor: 'text-lavender-800 dark:text-lavender-200'
  },
  warning: {
    icon: AlertCircle,
    bg: 'bg-honey-50 dark:bg-honey-900/30',
    border: 'border-honey-100 dark:border-honey-800',
    iconBg: 'bg-honey-100 dark:bg-honey-900/40',
    iconColor: 'text-honey-500 dark:text-honey-400',
    textColor: 'text-honey-800 dark:text-honey-200'
  },
  encouragement: {
    icon: Star,
    bg: 'bg-sage-50 dark:bg-sage-900/30',
    border: 'border-sage-100 dark:border-sage-800',
    iconBg: 'bg-sage-100 dark:bg-sage-900/40',
    iconColor: 'text-sage-500 dark:text-sage-400',
    textColor: 'text-sage-800 dark:text-sage-200'
  },
  default: {
    icon: Lightbulb,
    bg: 'bg-lavender-50 dark:bg-lavender-900/30',
    border: 'border-lavender-100 dark:border-lavender-800',
    iconBg: 'bg-lavender-100 dark:bg-lavender-900/40',
    iconColor: 'text-lavender-500 dark:text-lavender-400',
    textColor: 'text-lavender-800 dark:text-lavender-200'
  }
};

const InsightBite = ({
  insight,
  onDismiss,
  onShowMore
}) => {
  if (!insight || !insight.message) return null;

  const config = typeConfig[insight.type] || typeConfig.default;
  const Icon = config.icon;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={insight.message}
        className={`${config.bg} rounded-2xl p-4 border ${config.border} relative`}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
      >
        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-white/50 dark:hover:bg-hearth-800/50 transition-colors text-warm-400 hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300"
            aria-label="Dismiss insight"
          >
            <X size={14} />
          </button>
        )}

        <div className="flex items-start gap-3 pr-6">
          {/* Icon */}
          <div className={`p-2 rounded-full ${config.iconBg} ${config.iconColor} flex-shrink-0`}>
            <Icon size={16} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-body ${config.textColor} leading-relaxed`}>
              {insight.message}
            </p>

            {/* Entity tag if available */}
            {insight.entity && (
              <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full bg-white/60 dark:bg-hearth-800/60 text-warm-600 dark:text-warm-400">
                {insight.entity}
              </span>
            )}
          </div>
        </div>

        {/* Show more link */}
        {onShowMore && (
          <button
            onClick={onShowMore}
            className="mt-3 text-xs font-medium text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200 transition-colors flex items-center gap-1"
          >
            <TrendingUp size={12} />
            View all patterns
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default InsightBite;
