import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Lightbulb, TrendingUp, Sparkles, AlertTriangle,
  RefreshCw, Target, Calendar, Brain, Wind, Compass, Footprints
} from 'lucide-react';
import { safeString, formatMentions } from '../../utils/string';

/**
 * EntryInsightsPopup - Shows insights after entry submission
 * Displays contextual insight, CBT/ACT analysis, and celebrations
 * Persists until user dismisses it
 */
const EntryInsightsPopup = ({
  isOpen,
  onClose,
  contextualInsight,
  analysis,
  entryType = 'reflection'
}) => {
  if (!isOpen) return null;

  const insight = contextualInsight;
  const cbt = analysis?.cbt_breakdown;
  const actAnalysis = analysis?.act_analysis;
  const celebration = analysis?.celebration;
  const framework = analysis?.framework || 'general';

  // Don't show if there's nothing to display
  const hasContent = insight?.found || cbt?.perspective || actAnalysis?.defusion_phrase || celebration?.affirmation;
  if (!hasContent) return null;

  // Icon and color based on insight type
  const getInsightStyle = (type) => {
    const styles = {
      progress: {
        icon: TrendingUp,
        bg: 'bg-gradient-to-br from-green-50 to-emerald-50',
        border: 'border-green-200',
        iconColor: 'text-green-600',
        textColor: 'text-green-800'
      },
      streak: {
        icon: RefreshCw,
        bg: 'bg-gradient-to-br from-amber-50 to-yellow-50',
        border: 'border-amber-200',
        iconColor: 'text-amber-600',
        textColor: 'text-amber-800'
      },
      encouragement: {
        icon: Sparkles,
        bg: 'bg-gradient-to-br from-purple-50 to-pink-50',
        border: 'border-purple-200',
        iconColor: 'text-purple-600',
        textColor: 'text-purple-800'
      },
      absence: {
        icon: Target,
        bg: 'bg-gradient-to-br from-teal-50 to-cyan-50',
        border: 'border-teal-200',
        iconColor: 'text-teal-600',
        textColor: 'text-teal-800'
      },
      warning: {
        icon: AlertTriangle,
        bg: 'bg-gradient-to-br from-red-50 to-orange-50',
        border: 'border-red-200',
        iconColor: 'text-red-600',
        textColor: 'text-red-800'
      },
      cyclical: {
        icon: Calendar,
        bg: 'bg-gradient-to-br from-blue-50 to-indigo-50',
        border: 'border-blue-200',
        iconColor: 'text-blue-600',
        textColor: 'text-blue-800'
      },
      default: {
        icon: Lightbulb,
        bg: 'bg-gradient-to-br from-primary-50 to-secondary-50',
        border: 'border-primary-200',
        iconColor: 'text-primary-600',
        textColor: 'text-primary-800'
      }
    };
    return styles[type] || styles.default;
  };

  const insightStyle = insight?.type ? getInsightStyle(insight.type) : getInsightStyle('default');
  const InsightIcon = insightStyle.icon;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Subtle backdrop - less intrusive */}
        <motion.div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Content card - slides up from bottom on mobile */}
        <motion.div
          className="relative bg-white rounded-3xl shadow-soft-xl w-full max-w-md overflow-hidden"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between p-4 pb-0">
            <div className="flex items-center gap-2 text-warm-600">
              <Lightbulb size={18} className="text-primary-500" />
              <span className="font-display font-semibold text-sm">Insight</span>
            </div>
            <motion.button
              onClick={onClose}
              className="p-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <X size={18} />
            </motion.button>
          </div>

          {/* Main content */}
          <div className="p-4 pt-3 space-y-4">
            {/* Contextual Insight */}
            {insight?.found && insight?.message && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-4 rounded-2xl border ${insightStyle.bg} ${insightStyle.border}`}
              >
                <div className="flex gap-3">
                  <InsightIcon size={20} className={`shrink-0 mt-0.5 ${insightStyle.iconColor}`} />
                  <div className="flex-1">
                    <div className={`text-[10px] font-display font-bold uppercase tracking-wider mb-1 ${insightStyle.iconColor}`}>
                      {safeString(insight.type)}
                    </div>
                    <p className={`text-sm font-body leading-relaxed ${insightStyle.textColor}`}>
                      {formatMentions(safeString(insight.message))}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Celebration */}
            {framework === 'celebration' && celebration?.affirmation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-2xl border border-green-100"
              >
                <div className="flex items-center gap-2 text-green-700 font-display font-semibold text-xs uppercase mb-2">
                  <Sparkles size={14} /> Nice!
                </div>
                <p className="text-sm text-green-800 font-body">{celebration.affirmation}</p>
                {celebration.amplify && (
                  <p className="text-xs text-green-600 mt-2 italic">{celebration.amplify}</p>
                )}
              </motion.div>
            )}

            {/* CBT Perspective */}
            {framework === 'cbt' && cbt?.perspective && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-gradient-to-r from-primary-50 to-green-50 p-4 rounded-2xl border-l-4 border-primary-400"
              >
                <div className="flex items-center gap-2 text-primary-600 font-display font-semibold text-xs uppercase mb-2">
                  <Brain size={14} /> Perspective
                </div>
                <p className="text-sm text-warm-700 font-body">{cbt.perspective}</p>
              </motion.div>
            )}

            {/* ACT Defusion */}
            {framework === 'act' && actAnalysis?.defusion_phrase && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-teal-50 rounded-2xl p-4 border border-teal-100"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Wind className="text-teal-600" size={16} />
                  <span className="text-xs font-bold text-teal-700 uppercase">Defusion</span>
                </div>

                {actAnalysis.fusion_thought && (
                  <div className="text-teal-900 text-sm mb-2">
                    <span className="opacity-75">Instead of: </span>
                    <span className="line-through decoration-teal-300">"{actAnalysis.fusion_thought}"</span>
                  </div>
                )}

                <div className="text-teal-800 font-medium text-sm bg-white/50 p-2 rounded-lg">
                  Try: "{actAnalysis.defusion_phrase}"
                </div>

                {actAnalysis.values_context && (
                  <div className="mt-3 pt-3 border-t border-teal-100 flex items-center gap-2">
                    <Compass size={14} className="text-amber-600" />
                    <span className="text-xs text-amber-800">
                      <span className="font-semibold">Value:</span> {actAnalysis.values_context}
                    </span>
                  </div>
                )}

                {actAnalysis.committed_action && (
                  <div className="mt-3 bg-amber-50 p-3 rounded-xl border border-amber-100">
                    <div className="flex items-center gap-2 text-amber-700 font-display font-semibold text-xs uppercase mb-2">
                      <Footprints size={14} /> Committed Action
                    </div>
                    <p className="text-sm text-amber-800 font-medium font-body">{actAnalysis.committed_action}</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* Behavioral activation for CBT */}
            {framework === 'cbt' && cbt?.behavioral_activation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-secondary-50 p-4 rounded-2xl border border-secondary-100"
              >
                <div className="flex items-center gap-2 text-secondary-700 font-display font-semibold text-xs uppercase mb-2">
                  <Footprints size={14} /> Try This (Under 5 min)
                </div>
                <p className="text-sm text-secondary-800 font-medium font-body">{cbt.behavioral_activation.activity}</p>
                {cbt.behavioral_activation.rationale && (
                  <p className="text-xs text-secondary-600 mt-1">{cbt.behavioral_activation.rationale}</p>
                )}
              </motion.div>
            )}
          </div>

          {/* Dismiss button */}
          <div className="p-4 pt-0">
            <motion.button
              onClick={onClose}
              className="w-full py-3 rounded-2xl bg-warm-100 text-warm-600 font-semibold text-sm hover:bg-warm-200 transition-colors"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              Got it
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default EntryInsightsPopup;
