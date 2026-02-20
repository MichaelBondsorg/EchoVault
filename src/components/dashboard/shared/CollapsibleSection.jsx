import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

/**
 * CollapsibleSection - Reusable collapsible section for dashboard
 *
 * @param {string} title - Section title
 * @param {ReactNode} icon - Icon component
 * @param {string} subtitle - Optional subtitle/count shown in collapsed state
 * @param {string} collapsedContent - Optional content shown when collapsed (for Wins-style display)
 * @param {ReactNode} children - Content to show when expanded
 * @param {string} colorScheme - Color theme: 'indigo', 'green', 'amber', 'violet', 'rose', etc.
 * @param {boolean} defaultExpanded - Whether section starts expanded
 * @param {boolean} showSubtitleWhenExpanded - Whether to show subtitle when expanded
 */
const CollapsibleSection = ({
  title,
  icon: Icon,
  subtitle,
  collapsedContent,
  children,
  colorScheme = 'indigo',
  defaultExpanded = false,
  showSubtitleWhenExpanded = false,
  badge,
  onClearAll,
  clearLabel = 'Clear all'
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Color schemes
  const colors = {
    indigo: {
      bg: 'from-lavender-50 to-lavender-100 dark:from-lavender-900/40 dark:to-lavender-800/40',
      border: 'border-lavender-100 dark:border-lavender-800',
      iconBg: 'bg-lavender-100 dark:bg-lavender-800/50',
      iconText: 'text-lavender-600 dark:text-lavender-300',
      title: 'text-lavender-800 dark:text-lavender-200',
      subtitle: 'text-lavender-600 dark:text-lavender-400',
      chevron: 'text-lavender-400 dark:text-lavender-500',
      content: 'border-lavender-100 dark:border-lavender-800'
    },
    green: {
      bg: 'from-sage-50 to-sage-100 dark:from-sage-900/40 dark:to-sage-800/40',
      border: 'border-sage-100 dark:border-sage-800',
      iconBg: 'bg-sage-100 dark:bg-sage-800/50',
      iconText: 'text-sage-600 dark:text-sage-300',
      title: 'text-sage-800 dark:text-sage-200',
      subtitle: 'text-sage-600 dark:text-sage-400',
      chevron: 'text-sage-400 dark:text-sage-500',
      content: 'border-sage-100 dark:border-sage-800'
    },
    amber: {
      bg: 'from-honey-50 to-honey-100 dark:from-honey-900/40 dark:to-honey-800/40',
      border: 'border-honey-100 dark:border-honey-800',
      iconBg: 'bg-honey-100 dark:bg-honey-800/50',
      iconText: 'text-honey-600 dark:text-honey-300',
      title: 'text-honey-800 dark:text-honey-200',
      subtitle: 'text-honey-600 dark:text-honey-400',
      chevron: 'text-honey-400 dark:text-honey-500',
      content: 'border-honey-100 dark:border-honey-800'
    },
    violet: {
      bg: 'from-lavender-100 to-lavender-50 dark:from-lavender-900/50 dark:to-lavender-800/50',
      border: 'border-lavender-200 dark:border-lavender-700',
      iconBg: 'bg-lavender-200 dark:bg-lavender-700/50',
      iconText: 'text-lavender-500 dark:text-lavender-300',
      title: 'text-lavender-700 dark:text-lavender-200',
      subtitle: 'text-lavender-500 dark:text-lavender-400',
      chevron: 'text-lavender-300 dark:text-lavender-500',
      content: 'border-lavender-200 dark:border-lavender-700'
    },
    rose: {
      bg: 'from-terra-50 to-terra-100 dark:from-terra-900/40 dark:to-terra-800/40',
      border: 'border-terra-100 dark:border-terra-800',
      iconBg: 'bg-terra-100 dark:bg-terra-800/50',
      iconText: 'text-terra-600 dark:text-terra-300',
      title: 'text-terra-800 dark:text-terra-200',
      subtitle: 'text-terra-600 dark:text-terra-400',
      chevron: 'text-terra-400 dark:text-terra-500',
      content: 'border-terra-100 dark:border-terra-800'
    },
    blue: {
      bg: 'from-sage-50 to-sage-100 dark:from-sage-900/40 dark:to-sage-800/40',
      border: 'border-sage-200 dark:border-sage-700',
      iconBg: 'bg-sage-200 dark:bg-sage-700/50',
      iconText: 'text-sage-600 dark:text-sage-300',
      title: 'text-sage-700 dark:text-sage-200',
      subtitle: 'text-sage-600 dark:text-sage-400',
      chevron: 'text-sage-400 dark:text-sage-500',
      content: 'border-sage-200 dark:border-sage-700'
    },
    warm: {
      bg: 'from-warm-50 to-warm-100 dark:from-hearth-900/40 dark:to-hearth-850/40',
      border: 'border-warm-200 dark:border-hearth-700',
      iconBg: 'bg-warm-100 dark:bg-hearth-800/50',
      iconText: 'text-warm-600 dark:text-warm-400',
      title: 'text-warm-800 dark:text-hearth-200',
      subtitle: 'text-warm-600 dark:text-warm-400',
      chevron: 'text-warm-400 dark:text-warm-500',
      content: 'border-warm-200 dark:border-hearth-700'
    }
  };

  const c = colors[colorScheme] || colors.indigo;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gradient-to-br ${c.bg} rounded-2xl border ${c.border} overflow-hidden mb-4`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/30 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          {Icon && (
            <div className={`p-1.5 rounded-lg ${c.iconBg}`}>
              <Icon size={14} className={c.iconText} />
            </div>
          )}
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className={`text-sm font-display font-semibold ${c.title}`}>
                {title}
              </h3>
              {badge && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.iconBg} ${c.iconText} font-medium`}>
                  {badge}
                </span>
              )}
            </div>
            {subtitle && (!isExpanded || showSubtitleWhenExpanded) && (
              <p className={`text-xs ${c.subtitle}`}>
                {subtitle}
              </p>
            )}
            {/* Collapsed content (for Wins-style summary) */}
            {!isExpanded && collapsedContent && (
              <p className={`text-xs ${c.subtitle} mt-0.5`}>
                {collapsedContent}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onClearAll && isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearAll();
              }}
              className={`text-xs ${c.subtitle} hover:${c.title} transition-colors px-2 py-1 rounded hover:bg-white/50`}
            >
              {clearLabel}
            </button>
          )}
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={18} className={c.chevron} />
          </motion.div>
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default CollapsibleSection;
