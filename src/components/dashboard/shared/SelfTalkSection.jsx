import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

/**
 * SelfTalkSection - Collapsible section for linguistic pattern shifts
 *
 * Shows changes in self-talk patterns:
 * - Obligation language (should/must)
 * - Agency language (want to/choose to)
 * - Positive/negative self-talk
 * - Growth mindset markers
 */

const CATEGORY_INFO = {
  obligation: {
    label: 'Obligation',
    description: '"should" and "must" language',
    positiveDirection: 'decrease',
    icon: '📋'
  },
  agency: {
    label: 'Agency',
    description: '"I want" and "I choose" language',
    positiveDirection: 'increase',
    icon: '💪'
  },
  negative_self: {
    label: 'Self-Criticism',
    description: 'Harsh self-talk patterns',
    positiveDirection: 'decrease',
    icon: '🌧️'
  },
  positive_self: {
    label: 'Self-Support',
    description: 'Encouraging self-talk',
    positiveDirection: 'increase',
    icon: '☀️'
  },
  catastrophizing: {
    label: 'All-or-Nothing',
    description: 'Black and white thinking',
    positiveDirection: 'decrease',
    icon: '⚡'
  },
  growth: {
    label: 'Growth',
    description: '"I\'m learning" and reflections',
    positiveDirection: 'increase',
    icon: '🌱'
  },
  self_compassion: {
    label: 'Self-Compassion',
    description: 'Kind and gentle self-talk',
    positiveDirection: 'increase',
    icon: '💚'
  },
  harsh_self: {
    label: 'Inner Critic',
    description: 'Self-judgment patterns',
    positiveDirection: 'decrease',
    icon: '🔥'
  }
};

const SelfTalkSection = ({ linguisticShifts = [] }) => {
  // Don't render if no shifts
  if (linguisticShifts.length === 0) return null;

  const getShiftColor = (shift) => {
    const info = CATEGORY_INFO[shift.category];
    const isPositive = info?.positiveDirection === shift.direction;

    if (shift.sentiment === 'positive' || isPositive) {
      return {
        bg: 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800',
        text: 'text-sage-800 dark:text-sage-200',
        badge: 'bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300'
      };
    } else if (shift.sentiment === 'concerning') {
      return {
        bg: 'bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800',
        text: 'text-honey-800 dark:text-honey-200',
        badge: 'bg-honey-100 dark:bg-honey-900/40 text-honey-700 dark:text-honey-300'
      };
    }
    return {
      bg: 'bg-lavender-50 dark:bg-lavender-900/30 border-lavender-200 dark:border-lavender-800',
      text: 'text-lavender-800 dark:text-lavender-200',
      badge: 'bg-lavender-100 dark:bg-lavender-900/40 text-lavender-700 dark:text-lavender-300'
    };
  };

  return (
    <CollapsibleSection
      title="Self-Talk"
      icon={MessageSquare}
      colorScheme="indigo"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {linguisticShifts.map((shift, index) => {
          const info = CATEGORY_INFO[shift.category] || {
            label: shift.category,
            description: '',
            icon: '💭'
          };
          const colors = getShiftColor(shift);

          return (
            <motion.div
              key={shift.category}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`p-3 rounded-xl border ${colors.bg}`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg" role="img" aria-label={info.label}>
                  {info.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${colors.text}`}>
                      {info.label}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${colors.badge}`}>
                      {shift.direction === 'increase' ? (
                        <TrendingUp size={10} />
                      ) : (
                        <TrendingDown size={10} />
                      )}
                      {shift.changePercent}%
                    </span>
                  </div>
                  {shift.message && (
                    <p className={`text-xs ${colors.text} opacity-80 mt-1`}>
                      {shift.message}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* Summary */}
        <div className="text-xs text-lavender-600 dark:text-lavender-400 pt-2 border-t border-lavender-100 dark:border-lavender-800 flex items-center gap-1">
          <ArrowRight size={10} />
          Based on your last 14 days vs. previous 14 days
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default SelfTalkSection;
