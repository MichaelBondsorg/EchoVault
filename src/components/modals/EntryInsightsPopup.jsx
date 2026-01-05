import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Heart, TrendingUp, Sparkles, AlertTriangle,
  RefreshCw, Target, Calendar, Brain, Wind, Compass, Footprints
} from 'lucide-react';
import { safeString, formatMentions } from '../../utils/string';

/**
 * EntryInsightsPopup - Shows validation and insights after entry submission
 *
 * PRIORITY ORDER:
 * 1. Validation first (empathetic acknowledgment)
 * 2. Therapeutic tools (perspective, defusion) - only if helpful
 * 3. Pattern insights last (only meaningful ones, skip generic encouragement)
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
  const ventSupport = analysis?.vent_support;
  const celebration = analysis?.celebration;
  const framework = analysis?.framework || 'general';

  // Get validation content based on framework
  const getValidation = () => {
    if (framework === 'support' && ventSupport?.validation) {
      return ventSupport.validation;
    }
    if (framework === 'cbt' && cbt?.validation) {
      return cbt.validation;
    }
    // ACT doesn't have explicit validation, but fusion_thought acknowledgment serves similar purpose
    return null;
  };

  const validation = getValidation();

  // Determine if pattern insight is worth showing
  // Skip generic "encouragement" which can feel hollow/dismissive
  const isInsightWorthShowing = () => {
    if (!insight?.found || !insight?.message) return false;
    // Skip encouragement type - often feels like toxic positivity
    if (insight.type === 'encouragement') return false;
    // Show meaningful pattern insights
    return ['progress', 'streak', 'absence', 'warning', 'pattern', 'goal_check', 'cyclical', 'contradiction'].includes(insight.type);
  };

  const showPatternInsight = isInsightWorthShowing();

  // Don't show popup if there's nothing meaningful to display
  const hasValidation = !!validation;
  const hasCelebration = framework === 'celebration' && celebration?.affirmation;
  const hasTherapeutic = (framework === 'cbt' && cbt?.perspective) ||
                         (framework === 'act' && actAnalysis?.defusion_phrase);
  const hasContent = hasValidation || hasCelebration || hasTherapeutic || showPatternInsight;

  if (!hasContent) return null;

  // Dynamic header based on content type
  const getHeaderTitle = () => {
    if (hasValidation || hasCelebration) return 'Heard';
    if (framework === 'act') return 'A thought';
    if (framework === 'cbt' && cbt?.perspective) return 'Perspective';
    if (showPatternInsight) return 'Pattern';
    return 'Reflection';
  };

  // Icon and color based on insight type (for pattern insights only)
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
        icon: Brain,
        bg: 'bg-gradient-to-br from-warm-50 to-warm-100',
        border: 'border-warm-200',
        iconColor: 'text-warm-600',
        textColor: 'text-warm-700'
      }
    };
    return styles[type] || styles.default;
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Subtle backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Content card */}
        <motion.div
          className="relative bg-white rounded-3xl shadow-soft-xl w-full max-w-md overflow-hidden"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 pb-0">
            <div className="flex items-center gap-2 text-warm-600">
              <Heart size={18} className="text-primary-500" />
              <span className="font-display font-semibold text-sm">{getHeaderTitle()}</span>
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

          {/* Main content - PRIORITY ORDER */}
          <div className="p-4 pt-3 space-y-4">

            {/* 1. VALIDATION FIRST - Empathetic acknowledgment */}
            {validation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-primary-50 to-warm-50 p-4 rounded-2xl border border-primary-100"
              >
                <p className="text-sm text-warm-700 font-body leading-relaxed italic">
                  {validation}
                </p>
              </motion.div>
            )}

            {/* 2. CELEBRATION - For positive entries */}
            {hasCelebration && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: validation ? 0.1 : 0 }}
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

            {/* 3. THERAPEUTIC TOOLS - Only if mood warrants it */}

            {/* CBT Perspective - cognitive reframe */}
            {framework === 'cbt' && cbt?.perspective && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-2xl border-l-4 border-blue-400"
              >
                <div className="flex items-center gap-2 text-blue-600 font-display font-semibold text-xs uppercase mb-2">
                  <Brain size={14} /> Another way to see it
                </div>
                <p className="text-sm text-warm-700 font-body">{cbt.perspective}</p>
              </motion.div>
            )}

            {/* ACT Defusion - unhooking from thoughts */}
            {framework === 'act' && actAnalysis?.defusion_phrase && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-teal-50 rounded-2xl p-4 border border-teal-100"
              >
                {actAnalysis.fusion_thought && (
                  <div className="text-teal-900 text-sm mb-3">
                    <span className="opacity-75">The thought: </span>
                    <span className="italic">"{actAnalysis.fusion_thought}"</span>
                  </div>
                )}

                <div className="text-teal-800 font-medium text-sm bg-white/50 p-3 rounded-lg">
                  <span className="text-teal-600 text-xs uppercase font-semibold block mb-1">Try saying:</span>
                  "{actAnalysis.defusion_phrase}"
                </div>

                {actAnalysis.values_context && (
                  <div className="mt-3 pt-3 border-t border-teal-100 flex items-center gap-2">
                    <Compass size={14} className="text-amber-600" />
                    <span className="text-xs text-amber-800">
                      <span className="font-semibold">What matters here:</span> {actAnalysis.values_context}
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Behavioral activation - only for low mood */}
            {framework === 'cbt' && cbt?.behavioral_activation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-secondary-50 p-4 rounded-2xl border border-secondary-100"
              >
                <div className="flex items-center gap-2 text-secondary-700 font-display font-semibold text-xs uppercase mb-2">
                  <Footprints size={14} /> Something small you could try
                </div>
                <p className="text-sm text-secondary-800 font-medium font-body">{cbt.behavioral_activation.activity}</p>
                {cbt.behavioral_activation.rationale && (
                  <p className="text-xs text-secondary-600 mt-1">{cbt.behavioral_activation.rationale}</p>
                )}
              </motion.div>
            )}

            {/* ACT Committed Action */}
            {framework === 'act' && actAnalysis?.committed_action && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-amber-50 p-3 rounded-xl border border-amber-100"
              >
                <div className="flex items-center gap-2 text-amber-700 font-display font-semibold text-xs uppercase mb-2">
                  <Footprints size={14} /> A values-aligned step
                </div>
                <p className="text-sm text-amber-800 font-medium font-body">{actAnalysis.committed_action}</p>
              </motion.div>
            )}

            {/* Vent cooldown technique */}
            {framework === 'support' && ventSupport?.cooldown && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-primary-50 p-4 rounded-2xl border border-primary-100"
              >
                <div className="flex items-center gap-2 text-primary-700 font-display font-semibold text-xs uppercase mb-2">
                  <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
                </div>
                <p className="text-sm text-primary-800 font-body">{ventSupport.cooldown.instruction}</p>
              </motion.div>
            )}

            {/* 4. PATTERN INSIGHT - Only if genuinely useful */}
            {showPatternInsight && (() => {
              const style = getInsightStyle(insight.type);
              const InsightIcon = style.icon;
              return (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className={`p-4 rounded-2xl border ${style.bg} ${style.border}`}
                >
                  <div className="flex gap-3">
                    <InsightIcon size={18} className={`shrink-0 mt-0.5 ${style.iconColor}`} />
                    <div className="flex-1">
                      <div className={`text-[10px] font-display font-bold uppercase tracking-wider mb-1 ${style.iconColor}`}>
                        {safeString(insight.type).replace('_', ' ')}
                      </div>
                      <p className={`text-sm font-body leading-relaxed ${style.textColor}`}>
                        {formatMentions(safeString(insight.message))}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })()}
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
