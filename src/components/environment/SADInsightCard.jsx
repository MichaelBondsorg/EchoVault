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
          ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'
          : 'bg-gradient-to-br from-blue-50 to-sky-50 border-blue-200'
      }`}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isHighPriority ? 'bg-amber-100' : 'bg-blue-100'
            }`}>
              <Sun size={20} className={isHighPriority ? 'text-amber-600' : 'text-blue-600'} />
            </div>
            <div>
              <h3 className={`font-medium ${
                isHighPriority ? 'text-amber-800' : 'text-blue-800'
              }`}>
                Light & Mood Patterns
              </h3>
              <p className={`text-xs ${
                isHighPriority ? 'text-amber-600' : 'text-blue-600'
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
                  ? 'hover:bg-amber-100 text-amber-600'
                  : 'hover:bg-blue-100 text-blue-600'
              }`}
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <button
              onClick={handleDismiss}
              className={`p-1.5 rounded-lg transition-colors ${
                isHighPriority
                  ? 'hover:bg-amber-100 text-amber-400 hover:text-amber-600'
                  : 'hover:bg-blue-100 text-blue-400 hover:text-blue-600'
              }`}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick insight summary */}
        {insights?.[0] && (
          <p className={`mt-3 text-sm ${
            isHighPriority ? 'text-amber-700' : 'text-blue-700'
          }`}>
            {insights[0].message}
          </p>
        )}

        {/* Primary intervention */}
        {interventions?.[0] && !expanded && (
          <div className={`mt-3 p-3 rounded-xl ${
            isHighPriority ? 'bg-amber-100/50' : 'bg-blue-100/50'
          }`}>
            <div className="flex items-center gap-2">
              {ICON_MAP[interventions[0].icon] && (
                React.createElement(ICON_MAP[interventions[0].icon], {
                  size: 16,
                  className: isHighPriority ? 'text-amber-600' : 'text-blue-600'
                })
              )}
              <span className={`text-sm font-medium ${
                isHighPriority ? 'text-amber-800' : 'text-blue-800'
              }`}>
                {interventions[0].title}
              </span>
            </div>
            <p className={`text-xs mt-1 ${
              isHighPriority ? 'text-amber-600' : 'text-blue-600'
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
              isHighPriority ? 'border-amber-200' : 'border-blue-200'
            }`}>
              {/* All insights */}
              {insights?.length > 1 && (
                <div className="mt-4">
                  <p className={`text-xs font-medium mb-2 ${
                    isHighPriority ? 'text-amber-600' : 'text-blue-600'
                  }`}>
                    What we noticed:
                  </p>
                  <ul className="space-y-2">
                    {insights.map((insight, idx) => (
                      <li
                        key={idx}
                        className={`text-sm flex items-start gap-2 ${
                          isHighPriority ? 'text-amber-700' : 'text-blue-700'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                          insight.severity === 'high'
                            ? 'bg-amber-500'
                            : insight.severity === 'medium'
                              ? 'bg-amber-400'
                              : 'bg-amber-300'
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
                    isHighPriority ? 'text-amber-600' : 'text-blue-600'
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
                            isHighPriority ? 'bg-amber-100/50' : 'bg-blue-100/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <IconComponent
                              size={16}
                              className={isHighPriority ? 'text-amber-600' : 'text-blue-600'}
                            />
                            <span className={`text-sm font-medium ${
                              isHighPriority ? 'text-amber-800' : 'text-blue-800'
                            }`}>
                              {intervention.title}
                            </span>
                            {intervention.priority === 'high' && (
                              <span className="px-1.5 py-0.5 bg-amber-200 text-amber-700 rounded text-xs">
                                Priority
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${
                            isHighPriority ? 'text-amber-600' : 'text-blue-600'
                          }`}>
                            {intervention.message}
                          </p>
                          {intervention.reason && (
                            <p className={`text-xs mt-1 italic ${
                              isHighPriority ? 'text-amber-500' : 'text-blue-500'
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
                    ? 'text-amber-600 hover:text-amber-700'
                    : 'text-blue-600 hover:text-blue-700'
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
