import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lightbulb,
  X,
  TrendingUp,
  AlertCircle,
  Star,
  Check,
  ChevronDown,
  ChevronUp,
  Target,
  Zap
} from 'lucide-react';
import {
  transitionSignalState,
  addToExclusionList,
  SIGNAL_STATES
} from '../../services/signals/signalLifecycle';

/**
 * DismissibleInsight - Enhanced insight card with lifecycle management
 *
 * Features:
 * - Verify/dismiss/action buttons
 * - Feedback collection on dismiss
 * - Permanent exclusion option
 * - Causal analysis display (when available)
 * - Actionable suggestions
 *
 * Props:
 * - insight: {
 *     id?: string,
 *     message: string,
 *     type: string,
 *     observation?: string,
 *     causal_analysis?: object,
 *     therapeutic_reframe?: object,
 *     actionable_suggestion?: object,
 *     source?: string,
 *     patternType?: string,
 *     patternContext?: object
 *   }
 * - userId: string
 * - onDismiss: (insight) => void
 * - onVerify: (insight) => void
 * - onAction: (insight, action) => void
 * - showActions: boolean - Whether to show verify/dismiss/action buttons
 * - compact: boolean - Compact display mode
 */

const typeConfig = {
  pattern: {
    icon: TrendingUp,
    bg: 'bg-lavender-50 dark:bg-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-800',
    iconBg: 'bg-lavender-100 dark:bg-lavender-900/50',
    iconColor: 'text-lavender-600 dark:text-lavender-400',
    textColor: 'text-lavender-900 dark:text-lavender-100',
    accentColor: 'text-lavender-600 dark:text-lavender-400'
  },
  warning: {
    icon: AlertCircle,
    bg: 'bg-honey-50 dark:bg-honey-900/30',
    border: 'border-honey-200 dark:border-honey-800',
    iconBg: 'bg-honey-100 dark:bg-honey-900/50',
    iconColor: 'text-honey-600 dark:text-honey-400',
    textColor: 'text-honey-900 dark:text-honey-100',
    accentColor: 'text-honey-600 dark:text-honey-400'
  },
  encouragement: {
    icon: Star,
    bg: 'bg-sage-50 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-800',
    iconBg: 'bg-sage-100 dark:bg-sage-900/50',
    iconColor: 'text-sage-600 dark:text-sage-400',
    textColor: 'text-sage-900 dark:text-sage-100',
    accentColor: 'text-sage-600 dark:text-sage-400'
  },
  contradiction: {
    icon: AlertCircle,
    bg: 'bg-terra-50 dark:bg-terra-900/30',
    border: 'border-terra-200 dark:border-terra-800',
    iconBg: 'bg-terra-100 dark:bg-terra-900/50',
    iconColor: 'text-terra-600 dark:text-terra-400',
    textColor: 'text-terra-900 dark:text-terra-100',
    accentColor: 'text-terra-600 dark:text-terra-400'
  },
  goal_check: {
    icon: Target,
    bg: 'bg-lavender-100 dark:bg-lavender-900/40',
    border: 'border-lavender-300 dark:border-lavender-700',
    iconBg: 'bg-lavender-200 dark:bg-lavender-800/50',
    iconColor: 'text-lavender-700 dark:text-lavender-300',
    textColor: 'text-lavender-900 dark:text-lavender-100',
    accentColor: 'text-lavender-700 dark:text-lavender-300'
  },
  progress: {
    icon: Zap,
    bg: 'bg-sage-50 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-800',
    iconBg: 'bg-sage-100 dark:bg-sage-900/50',
    iconColor: 'text-sage-600 dark:text-sage-400',
    textColor: 'text-sage-900 dark:text-sage-100',
    accentColor: 'text-sage-600 dark:text-sage-400'
  },
  default: {
    icon: Lightbulb,
    bg: 'bg-warm-50 dark:bg-warm-900/30',
    border: 'border-warm-200 dark:border-warm-700',
    iconBg: 'bg-warm-100 dark:bg-warm-800',
    iconColor: 'text-warm-600 dark:text-warm-400',
    textColor: 'text-warm-900 dark:text-warm-100',
    accentColor: 'text-warm-600 dark:text-warm-400'
  }
};

const DISMISS_REASONS = [
  { value: 'outdated', label: 'This is outdated information' },
  { value: 'inaccurate', label: "This doesn't match my experience" },
  { value: 'obvious', label: 'I already knew this' },
  { value: 'not_actionable', label: "I can't do anything about it" },
  { value: 'not_relevant', label: "This isn't relevant to me" }
];

const DismissibleInsight = ({
  insight,
  userId,
  onDismiss,
  onVerify,
  onAction,
  showActions = true,
  compact = false
}) => {
  const [showFeedback, setShowFeedback] = useState(false);
  const [selectedReason, setSelectedReason] = useState(null);
  const [excludePermanently, setExcludePermanently] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!insight || !insight.message) return null;

  const config = typeConfig[insight.type] || typeConfig.default;
  const Icon = config.icon;
  const hasCausalAnalysis = insight.causal_analysis && Object.keys(insight.causal_analysis).length > 0;
  const hasReframe = insight.therapeutic_reframe && insight.therapeutic_reframe.reframe_prompt;
  const hasAction = insight.actionable_suggestion && insight.actionable_suggestion.micro_action;

  const handleDismiss = async () => {
    if (!selectedReason) return;

    setIsProcessing(true);
    try {
      // Transition signal state if we have an ID
      if (insight.id && userId) {
        await transitionSignalState(userId, insight.id, SIGNAL_STATES.INSIGHT_DISMISSED, {
          reason: selectedReason,
          excludePattern: excludePermanently
        });
      }

      // Add to exclusion list if permanent
      if (excludePermanently && userId && insight.patternType) {
        await addToExclusionList(userId, {
          patternType: insight.patternType,
          context: insight.patternContext || {},
          reason: selectedReason,
          permanent: true
        });
      }

      onDismiss?.(insight);
    } catch (error) {
      console.error('Failed to dismiss insight:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerify = async () => {
    setIsProcessing(true);
    try {
      if (insight.id && userId) {
        await transitionSignalState(userId, insight.id, SIGNAL_STATES.INSIGHT_VERIFIED, {
          verifiedAt: new Date().toISOString()
        });
      }
      onVerify?.(insight);
    } catch (error) {
      console.error('Failed to verify insight:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAction = async () => {
    setIsProcessing(true);
    try {
      if (insight.id && userId) {
        await transitionSignalState(userId, insight.id, SIGNAL_STATES.INSIGHT_ACTIONED, {
          action: insight.actionable_suggestion?.micro_action,
          actionedAt: new Date().toISOString()
        });
      }
      onAction?.(insight, insight.actionable_suggestion);
    } catch (error) {
      console.error('Failed to action insight:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickDismiss = () => {
    setShowFeedback(true);
  };

  return (
    <motion.div
      className={`${config.bg} rounded-xl border ${config.border} overflow-hidden`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Main Content */}
      <div className={`p-4 ${compact ? 'py-3' : ''}`}>
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`p-2 rounded-lg ${config.iconBg} ${config.iconColor} flex-shrink-0`}>
            <Icon size={compact ? 14 : 18} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Observation/Message */}
            <p className={`${compact ? 'text-sm' : 'text-base'} font-medium ${config.textColor} leading-relaxed`}>
              {insight.observation || insight.message}
            </p>

            {/* Source tag */}
            {insight.source && !compact && (
              <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full bg-white/70 dark:bg-warm-800/70 text-warm-500 dark:text-warm-400">
                Based on {insight.source}
              </span>
            )}

            {/* Expand button for details */}
            {(hasCausalAnalysis || hasReframe) && !compact && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className={`mt-2 text-xs font-medium ${config.accentColor} hover:underline flex items-center gap-1`}
              >
                {showDetails ? (
                  <>
                    <ChevronUp size={12} />
                    Hide details
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    Why this matters
                  </>
                )}
              </button>
            )}
          </div>

          {/* Quick dismiss button */}
          {showActions && !showFeedback && (
            <button
              onClick={handleQuickDismiss}
              className="p-1.5 rounded-full hover:bg-white/50 dark:hover:bg-warm-800/50 transition-colors text-warm-400 hover:text-warm-600 dark:hover:text-warm-300 flex-shrink-0"
              aria-label="Dismiss insight"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Expanded Details */}
        <AnimatePresence>
          {showDetails && !compact && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-white/50 space-y-3">
                {/* Causal Analysis */}
                {hasCausalAnalysis && (
                  <div className="bg-white/50 dark:bg-warm-800/50 rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-warm-600 dark:text-warm-400 uppercase tracking-wider mb-2">
                      Connected Patterns
                    </h4>
                    <p className="text-sm text-warm-700 dark:text-warm-300">
                      Correlating themes: {insight.causal_analysis.correlating_themes?.join(', ')}
                    </p>
                    {insight.causal_analysis.correlation_strength && (
                      <p className="text-xs text-warm-500 dark:text-warm-400 mt-1">
                        Confidence: {Math.round(insight.causal_analysis.correlation_strength * 100)}%
                      </p>
                    )}
                  </div>
                )}

                {/* Therapeutic Reframe */}
                {hasReframe && (
                  <div className="bg-white/50 dark:bg-warm-800/50 rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-warm-600 dark:text-warm-400 uppercase tracking-wider mb-2">
                      A thought to consider
                    </h4>
                    <p className="text-sm text-warm-700 dark:text-warm-300 italic">
                      "{insight.therapeutic_reframe.reframe_prompt}"
                    </p>
                    {insight.therapeutic_reframe.framework && (
                      <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded bg-white dark:bg-warm-800 text-warm-500 dark:text-warm-400">
                        {insight.therapeutic_reframe.framework} approach
                      </span>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        {showActions && !showFeedback && !compact && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={handleVerify}
              disabled={isProcessing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-warm-800 hover:bg-warm-50 dark:hover:bg-warm-700 border border-warm-200 dark:border-warm-700 text-warm-700 dark:text-warm-300 transition-colors disabled:opacity-50"
            >
              <Check size={14} />
              This is accurate
            </button>

            {hasAction && (
              <button
                onClick={handleAction}
                disabled={isProcessing}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg ${config.iconBg} ${config.iconColor} hover:opacity-90 transition-colors disabled:opacity-50`}
              >
                <Zap size={14} />
                {insight.actionable_suggestion.micro_action.slice(0, 30)}...
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dismiss Feedback Panel */}
      <AnimatePresence>
        {showFeedback && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 border-t border-white/50">
              <p className="text-sm font-medium text-warm-700 dark:text-warm-300 mb-3">
                Why isn't this useful?
              </p>

              <div className="space-y-2">
                {DISMISS_REASONS.map((reason) => (
                  <label
                    key={reason.value}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedReason === reason.value
                        ? 'bg-white dark:bg-warm-800 border-2 border-warm-300 dark:border-warm-600'
                        : 'bg-white/50 dark:bg-warm-800/50 border border-transparent hover:bg-white dark:hover:bg-warm-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dismiss-reason"
                      value={reason.value}
                      checked={selectedReason === reason.value}
                      onChange={(e) => setSelectedReason(e.target.value)}
                      className="w-4 h-4 text-warm-600"
                    />
                    <span className="text-sm text-warm-700 dark:text-warm-300">{reason.label}</span>
                  </label>
                ))}
              </div>

              {/* Permanent exclusion option */}
              <label className="flex items-center gap-2 mt-3 p-2 bg-terra-50 dark:bg-terra-900/30 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludePermanently}
                  onChange={(e) => setExcludePermanently(e.target.checked)}
                  className="w-4 h-4 text-terra-600 rounded"
                />
                <span className="text-sm text-terra-700 dark:text-terra-300">
                  Don't show insights like this again
                </span>
              </label>

              {/* Action buttons */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setShowFeedback(false);
                    setSelectedReason(null);
                    setExcludePermanently(false);
                  }}
                  className="flex-1 py-2 text-sm font-medium text-warm-600 dark:text-warm-400 bg-white dark:bg-warm-800 rounded-lg border border-warm-200 dark:border-warm-700 hover:bg-warm-50 dark:hover:bg-warm-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDismiss}
                  disabled={!selectedReason || isProcessing}
                  className="flex-1 py-2 text-sm font-medium text-white bg-warm-800 dark:bg-warm-200 dark:text-warm-900 rounded-lg hover:bg-warm-700 dark:hover:bg-warm-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Dismissing...' : 'Dismiss'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default DismissibleInsight;
