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
        bg: 'bg-green-50 border-green-200',
        text: 'text-green-800',
        badge: 'bg-green-100 text-green-700'
      };
    } else if (shift.sentiment === 'concerning') {
      return {
        bg: 'bg-amber-50 border-amber-200',
        text: 'text-amber-800',
        badge: 'bg-amber-100 text-amber-700'
      };
    }
    return {
      bg: 'bg-indigo-50 border-indigo-200',
      text: 'text-indigo-800',
      badge: 'bg-indigo-100 text-indigo-700'
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
        <div className="text-xs text-indigo-600 pt-2 border-t border-indigo-100 flex items-center gap-1">
          <ArrowRight size={10} />
          Based on your last 14 days vs. previous 14 days
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default SelfTalkSection;
