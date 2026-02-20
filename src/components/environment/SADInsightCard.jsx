/**
 * SADInsightCard Component
 *
 * Displays SAD-related insights and interventions on the dashboard.
 * Shows when environmental patterns indicate SAD risk.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun,
  Sunrise,
  Cloud,
  Moon,
  Footprints,
  Calendar,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink
} from 'lucide-react';

const ICON_MAP = {
  Sun: Sun,
  Sunrise: Sunrise,
  Cloud: Cloud,
  Moon: Moon,
  Footprints: Footprints,
  Calendar: Calendar
};

const SADInsightCard = ({
  insights,
  interventions,
  daylightTrend,
  onDismiss,
  onLearnMore
}) => {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (!insights?.length && !interventions?.length)) {
    return null;
  }

  // Determine card severity based on insights
  const highSeverityInsights = insights?.filter(i => i.severity === 'high') || [];
  const isHighPriority = highSeverityInsights.length > 0 || daylightTrend?.isHighSADRisk;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`rounded-2xl border overflow-hidden ${
        isHighPriority
          ? 'bg-gradient-to-br from-honey-50 to-terra-50 border-honey-200 dark:from-honey-900/30 dark:to-terra-900/30 dark:border-honey-800'
          : 'bg-gradient-to-br from-lavender-50 to-lavender-100 border-lavender-200 dark:from-lavender-900/30 dark:to-lavender-800/30 dark:border-lavender-800'
      }`}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isHighPriority ? 'bg-honey-100 dark:bg-honey-800/40' : 'bg-lavender-100 dark:bg-lavender-800/40'
            }`}>
              <Sun size={20} className={isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'} />
            </div>
            <div>
              <h3 className={`font-medium ${
                isHighPriority ? 'text-honey-800 dark:text-honey-200' : 'text-lavender-800 dark:text-lavender-200'
              }`}>
                Light & Mood Patterns
              </h3>
              <p className={`text-xs ${
                isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
              }`}>
                {daylightTrend?.avgDaylightHours
                  ? `${daylightTrend.avgDaylightHours}h avg daylight recently`
                  : 'Based on your entry patterns'
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className={`p-1.5 rounded-lg transition-colors ${
                isHighPriority
                  ? 'hover:bg-honey-100 text-honey-600 dark:hover:bg-honey-800/40 dark:text-honey-400'
                  : 'hover:bg-lavender-100 text-lavender-600 dark:hover:bg-lavender-800/40 dark:text-lavender-400'
              }`}
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <button
              onClick={handleDismiss}
              className={`p-1.5 rounded-lg transition-colors ${
                isHighPriority
                  ? 'hover:bg-honey-100 text-honey-400 hover:text-honey-600 dark:hover:bg-honey-800/40 dark:text-honey-500 dark:hover:text-honey-400'
                  : 'hover:bg-lavender-100 text-lavender-400 hover:text-lavender-600 dark:hover:bg-lavender-800/40 dark:text-lavender-500 dark:hover:text-lavender-400'
              }`}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick insight summary */}
        {insights?.[0] && (
          <p className={`mt-3 text-sm ${
            isHighPriority ? 'text-honey-700 dark:text-honey-300' : 'text-lavender-700 dark:text-lavender-300'
          }`}>
            {insights[0].message}
          </p>
        )}

        {/* Primary intervention */}
        {interventions?.[0] && !expanded && (
          <div className={`mt-3 p-3 rounded-xl ${
            isHighPriority ? 'bg-honey-100/50 dark:bg-honey-800/30' : 'bg-lavender-100/50 dark:bg-lavender-800/30'
          }`}>
            <div className="flex items-center gap-2">
              {ICON_MAP[interventions[0].icon] && (
                React.createElement(ICON_MAP[interventions[0].icon], {
                  size: 16,
                  className: isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
                })
              )}
              <span className={`text-sm font-medium ${
                isHighPriority ? 'text-honey-800 dark:text-honey-200' : 'text-lavender-800 dark:text-lavender-200'
              }`}>
                {interventions[0].title}
              </span>
            </div>
            <p className={`text-xs mt-1 ${
              isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
            }`}>
              {interventions[0].message}
            </p>
          </div>
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className={`px-4 pb-4 border-t ${
              isHighPriority ? 'border-honey-200 dark:border-honey-800' : 'border-lavender-200 dark:border-lavender-800'
            }`}>
              {/* All insights */}
              {insights?.length > 1 && (
                <div className="mt-4">
                  <p className={`text-xs font-medium mb-2 ${
                    isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
                  }`}>
                    What we noticed:
                  </p>
                  <ul className="space-y-2">
                    {insights.map((insight, idx) => (
                      <li
                        key={idx}
                        className={`text-sm flex items-start gap-2 ${
                          isHighPriority ? 'text-honey-700 dark:text-honey-300' : 'text-lavender-700 dark:text-lavender-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                          insight.severity === 'high'
                            ? 'bg-honey-500 dark:bg-honey-400'
                            : insight.severity === 'medium'
                              ? 'bg-honey-400 dark:bg-honey-500'
                              : 'bg-honey-300 dark:bg-honey-600'
                        }`} />
                        {insight.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* All interventions */}
              {interventions?.length > 0 && (
                <div className="mt-4">
                  <p className={`text-xs font-medium mb-2 ${
                    isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
                  }`}>
                    Suggestions:
                  </p>
                  <div className="space-y-2">
                    {interventions.map((intervention, idx) => {
                      const IconComponent = ICON_MAP[intervention.icon] || Sun;
                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-xl ${
                            isHighPriority ? 'bg-honey-100/50 dark:bg-honey-800/30' : 'bg-lavender-100/50 dark:bg-lavender-800/30'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <IconComponent
                              size={16}
                              className={isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'}
                            />
                            <span className={`text-sm font-medium ${
                              isHighPriority ? 'text-honey-800 dark:text-honey-200' : 'text-lavender-800 dark:text-lavender-200'
                            }`}>
                              {intervention.title}
                            </span>
                            {intervention.priority === 'high' && (
                              <span className="px-1.5 py-0.5 bg-honey-200 text-honey-700 dark:bg-honey-800 dark:text-honey-300 rounded text-xs">
                                Priority
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${
                            isHighPriority ? 'text-honey-600 dark:text-honey-400' : 'text-lavender-600 dark:text-lavender-400'
                          }`}>
                            {intervention.message}
                          </p>
                          {intervention.reason && (
                            <p className={`text-xs mt-1 italic ${
                              isHighPriority ? 'text-honey-500 dark:text-honey-400' : 'text-lavender-500 dark:text-lavender-400'
                            }`}>
                              Why: {intervention.reason}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Learn more link */}
              <button
                onClick={onLearnMore}
                className={`mt-4 flex items-center gap-1 text-xs font-medium transition-colors ${
                  isHighPriority
                    ? 'text-honey-600 hover:text-honey-700 dark:text-honey-400 dark:hover:text-honey-300'
                    : 'text-lavender-600 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300'
                }`}
              >
                <ExternalLink size={12} />
                Learn about light and mood
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default SADInsightCard;
