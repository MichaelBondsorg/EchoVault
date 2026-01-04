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
      bg: 'from-indigo-50 to-violet-50',
      border: 'border-indigo-100',
      iconBg: 'bg-indigo-100',
      iconText: 'text-indigo-600',
      title: 'text-indigo-800',
      subtitle: 'text-indigo-600',
      chevron: 'text-indigo-400',
      content: 'border-indigo-100'
    },
    green: {
      bg: 'from-green-50 to-emerald-50',
      border: 'border-green-100',
      iconBg: 'bg-green-100',
      iconText: 'text-green-600',
      title: 'text-green-800',
      subtitle: 'text-green-600',
      chevron: 'text-green-400',
      content: 'border-green-100'
    },
    amber: {
      bg: 'from-amber-50 to-orange-50',
      border: 'border-amber-100',
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-600',
      title: 'text-amber-800',
      subtitle: 'text-amber-600',
      chevron: 'text-amber-400',
      content: 'border-amber-100'
    },
    violet: {
      bg: 'from-violet-50 to-purple-50',
      border: 'border-violet-100',
      iconBg: 'bg-violet-100',
      iconText: 'text-violet-600',
      title: 'text-violet-800',
      subtitle: 'text-violet-600',
      chevron: 'text-violet-400',
      content: 'border-violet-100'
    },
    rose: {
      bg: 'from-rose-50 to-pink-50',
      border: 'border-rose-100',
      iconBg: 'bg-rose-100',
      iconText: 'text-rose-600',
      title: 'text-rose-800',
      subtitle: 'text-rose-600',
      chevron: 'text-rose-400',
      content: 'border-rose-100'
    },
    blue: {
      bg: 'from-blue-50 to-cyan-50',
      border: 'border-blue-100',
      iconBg: 'bg-blue-100',
      iconText: 'text-blue-600',
      title: 'text-blue-800',
      subtitle: 'text-blue-600',
      chevron: 'text-blue-400',
      content: 'border-blue-100'
    },
    warm: {
      bg: 'from-warm-50 to-warm-100',
      border: 'border-warm-200',
      iconBg: 'bg-warm-100',
      iconText: 'text-warm-600',
      title: 'text-warm-800',
      subtitle: 'text-warm-600',
      chevron: 'text-warm-400',
      content: 'border-warm-200'
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
        className="w-full flex items-center justify-between p-4 hover:bg-white/30 transition-colors"
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
