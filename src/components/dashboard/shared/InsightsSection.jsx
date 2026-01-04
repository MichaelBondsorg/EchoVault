import React from 'react';
import { motion } from 'framer-motion';
import {
  Lightbulb, TrendingUp, TrendingDown, AlertCircle,
  MessageSquare, Users, Sun, Cloud, Sparkles
} from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

/**
 * InsightsSection - Collapsible section for patterns and insights
 *
 * Displays the new insight engine patterns:
 * - Activity sentiment
 * - Shadow friction
 * - Absence warnings
 * - Linguistic shifts
 */

const InsightsSection = ({ patterns, onShowMore }) => {
  // Combine all patterns into a prioritized list
  const allInsights = [];

  // Add absence warnings (highest priority - pre-emptive)
  if (patterns?.absenceWarnings) {
    patterns.absenceWarnings.forEach(warning => {
      allInsights.push({
        type: 'absence_warning',
        message: warning.message,
        icon: AlertCircle,
        color: 'amber',
        priority: warning.isActiveWarning ? 1 : 3
      });
    });
  }

  // Add linguistic shifts
  if (patterns?.linguisticShifts) {
    patterns.linguisticShifts.forEach(shift => {
      allInsights.push({
        type: 'linguistic_shift',
        message: shift.message,
        icon: MessageSquare,
        color: shift.sentiment === 'positive' ? 'green' : 'indigo',
        priority: 2
      });
    });
  }

  // Add shadow friction
  if (patterns?.shadowFriction) {
    patterns.shadowFriction.slice(0, 2).forEach(friction => {
      allInsights.push({
        type: 'shadow_friction',
        message: friction.message || friction.insight,
        icon: Users,
        color: 'violet',
        priority: 3
      });
    });
  }

  // Add activity sentiment
  if (patterns?.activitySentiment) {
    const positive = patterns.activitySentiment.find(p => p.sentiment === 'positive');
    const negative = patterns.activitySentiment.find(p => p.sentiment === 'negative');

    if (positive) {
      allInsights.push({
        type: 'positive_activity',
        message: positive.message || positive.insight,
        icon: TrendingUp,
        color: 'green',
        priority: 4
      });
    }
    if (negative) {
      allInsights.push({
        type: 'negative_activity',
        message: negative.message || negative.insight,
        icon: TrendingDown,
        color: 'rose',
        priority: 4
      });
    }
  }

  // Add temporal patterns
  if (patterns?.temporal?.insights) {
    if (patterns.temporal.insights.bestDay) {
      allInsights.push({
        type: 'best_day',
        message: patterns.temporal.insights.bestDay.insight,
        icon: Sun,
        color: 'amber',
        priority: 5
      });
    }
    if (patterns.temporal.insights.worstDay) {
      allInsights.push({
        type: 'worst_day',
        message: patterns.temporal.insights.worstDay.insight,
        icon: Cloud,
        color: 'blue',
        priority: 5
      });
    }
  }

  // Add summary items
  if (patterns?.summary) {
    patterns.summary.forEach(item => {
      // Avoid duplicates
      if (!allInsights.some(i => i.message === item.message)) {
        allInsights.push({
          type: item.type,
          message: item.message,
          icon: getIconForType(item.type),
          color: getColorForType(item.type),
          priority: 6
        });
      }
    });
  }

  // Sort by priority and take top items
  const sortedInsights = allInsights
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5);

  // Don't render if no insights
  if (sortedInsights.length === 0) return null;

  const colorClasses = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  const iconColorClasses = {
    amber: 'text-amber-500 bg-amber-100',
    green: 'text-green-500 bg-green-100',
    indigo: 'text-indigo-500 bg-indigo-100',
    violet: 'text-violet-500 bg-violet-100',
    rose: 'text-rose-500 bg-rose-100',
    blue: 'text-blue-500 bg-blue-100'
  };

  return (
    <CollapsibleSection
      title="Insights"
      icon={Lightbulb}
      colorScheme="violet"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {sortedInsights.map((insight, index) => {
          const Icon = insight.icon;
          return (
            <motion.div
              key={`${insight.type}-${index}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`p-3 rounded-xl border ${colorClasses[insight.color] || colorClasses.indigo}`}
            >
              <div className="flex items-start gap-2">
                <div className={`p-1.5 rounded-lg ${iconColorClasses[insight.color] || iconColorClasses.indigo}`}>
                  <Icon size={12} />
                </div>
                <p className="text-sm flex-1">
                  {insight.message}
                </p>
              </div>
            </motion.div>
          );
        })}

        {/* View all link */}
        {onShowMore && (
          <button
            onClick={onShowMore}
            className="w-full text-xs text-violet-600 hover:text-violet-800 py-2 text-center transition-colors flex items-center justify-center gap-1"
          >
            <Sparkles size={12} />
            View all patterns
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
};

// Helper functions for type mapping
function getIconForType(type) {
  const iconMap = {
    absence_warning: AlertCircle,
    linguistic_shift: MessageSquare,
    shadow_friction: Users,
    positive_activity: TrendingUp,
    negative_activity: TrendingDown,
    best_day: Sun,
    worst_day: Cloud
  };
  return iconMap[type] || Lightbulb;
}

function getColorForType(type) {
  const colorMap = {
    absence_warning: 'amber',
    linguistic_shift: 'indigo',
    shadow_friction: 'violet',
    positive_activity: 'green',
    negative_activity: 'rose',
    best_day: 'amber',
    worst_day: 'blue'
  };
  return colorMap[type] || 'indigo';
}

export default InsightsSection;
