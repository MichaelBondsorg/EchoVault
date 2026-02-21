import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Heart, TrendingUp, Sparkles, AlertTriangle,
  RefreshCw, Target, Calendar, Brain, Wind, Footprints
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
    if (framework === 'act' && actAnalysis?.acknowledgment) {
      return actAnalysis.acknowledgment;
    }
    return null;
  };

  const validation = getValidation();

  // Check what therapeutic content is available
  const hasValidation = !!validation;
  const hasCelebration = framework === 'celebration' && celebration?.affirmation;
  const hasTherapeutic = (framework === 'cbt' && cbt?.perspective) ||
                         (framework === 'act' && actAnalysis?.defusion_phrase);
  const hasVentCooldown = framework === 'support' && ventSupport?.cooldown;

  // Determine if pattern insight is worth showing as primary content
  const isMeaningfulInsight = insight?.found && insight?.message &&
    ['progress', 'streak', 'absence', 'warning', 'pattern', 'goal_check', 'cyclical', 'contradiction'].includes(insight.type);

  // "Encouragement" insights shown only as fallback when nothing else exists
  const hasEncouragement = insight?.found && insight?.message && insight.type === 'encouragement';
  const needsFallback = !hasValidation && !hasCelebration && !hasTherapeutic && !hasVentCooldown && !isMeaningfulInsight;
  const showEncouragementAsFallback = needsFallback && hasEncouragement;

  // Determine what to show
  const showPatternInsight = isMeaningfulInsight;
  const hasContent = hasValidation || hasCelebration || hasTherapeutic || hasVentCooldown ||
                     showPatternInsight || showEncouragementAsFallback;

  if (!hasContent) return null;

  // Dynamic header based on content type
  const getHeaderTitle = () => {
    if (hasValidation || hasCelebration) return 'Heard';
    if (framework === 'act' && actAnalysis?.defusion_phrase) return 'A thought';
    if (framework === 'cbt' && cbt?.perspective) return 'Perspective';
    if (showPatternInsight) return 'Pattern';
    if (showEncouragementAsFallback) return 'Noted';
    return 'Reflection';
  };

  // Icon and color based on insight type (for pattern insights only)
  const getInsightStyle = (type) => {
    const styles = {
      progress: {
        icon: TrendingUp,
        bg: 'bg-gradient-to-br from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20',
        border: 'border-sage-200 dark:border-sage-800',
        iconColor: 'text-sage-600 dark:text-sage-400',
        textColor: 'text-sage-800 dark:text-sage-200'
      },
      streak: {
        icon: RefreshCw,
        bg: 'bg-gradient-to-br from-honey-50 to-honey-100 dark:from-honey-900/30 dark:to-honey-900/20',
        border: 'border-honey-200 dark:border-honey-800',
        iconColor: 'text-honey-600 dark:text-honey-400',
        textColor: 'text-honey-800 dark:text-honey-200'
      },
      absence: {
        icon: Target,
        bg: 'bg-gradient-to-br from-lavender-50 to-lavender-100 dark:from-lavender-900/30 dark:to-lavender-900/20',
        border: 'border-lavender-200 dark:border-lavender-800',
        iconColor: 'text-lavender-600 dark:text-lavender-400',
        textColor: 'text-lavender-800 dark:text-lavender-200'
      },
      warning: {
        icon: AlertTriangle,
        bg: 'bg-gradient-to-br from-red-50 to-terra-50 dark:from-red-900/30 dark:to-terra-900/20',
        border: 'border-red-200 dark:border-red-800',
        iconColor: 'text-red-600 dark:text-red-400',
        textColor: 'text-red-800 dark:text-red-200'
      },
      cyclical: {
        icon: Calendar,
        bg: 'bg-gradient-to-br from-lavender-100 to-lavender-200 dark:from-lavender-900/40 dark:to-lavender-900/30',
        border: 'border-lavender-300 dark:border-lavender-700',
        iconColor: 'text-lavender-700 dark:text-lavender-300',
        textColor: 'text-lavender-900 dark:text-lavender-100'
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
          className="relative bg-white dark:bg-hearth-900 rounded-3xl shadow-soft-xl w-full max-w-sm overflow-hidden max-h-[75vh] flex flex-col"
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 pb-0">
            <div className="flex items-center gap-2 text-warm-600">
              <Heart size={18} className="text-honey-500" />
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

          {/* Main content - PRIORITY ORDER (scrollable) */}
          <div className="p-4 pt-3 space-y-4 overflow-y-auto flex-1">

            {/* 1. VALIDATION FIRST - Empathetic acknowledgment */}
            {validation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-honey-50 to-warm-50 p-4 rounded-2xl border border-honey-100"
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
                className="bg-gradient-to-r from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20 p-4 rounded-2xl border border-sage-100 dark:border-sage-800"
              >
                <div className="flex items-center gap-2 text-sage-700 dark:text-sage-300 font-display font-semibold text-xs uppercase mb-2">
                  <Sparkles size={14} /> Nice!
                </div>
                <p className="text-sm text-sage-800 dark:text-sage-200 font-body">{celebration.affirmation}</p>
                {celebration.amplify && (
                  <p className="text-xs text-sage-600 dark:text-sage-400 mt-2 italic">{celebration.amplify}</p>
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
                className="bg-gradient-to-r from-lavender-50 to-lavender-100 dark:from-lavender-900/30 dark:to-lavender-900/20 p-4 rounded-2xl border-l-4 border-lavender-400 dark:border-lavender-600"
              >
                <div className="flex items-center gap-2 text-lavender-600 dark:text-lavender-400 font-display font-semibold text-xs uppercase mb-2">
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
                className="bg-sage-50 dark:bg-sage-900/30 rounded-2xl p-4 border border-sage-100 dark:border-sage-800"
              >
                {actAnalysis.fusion_thought && (
                  <div className="text-sage-900 dark:text-sage-100 text-sm mb-3">
                    <span className="opacity-75">The thought: </span>
                    <span className="italic">"{actAnalysis.fusion_thought}"</span>
                  </div>
                )}

                <div className="text-sage-800 dark:text-sage-200 font-medium text-sm bg-white/50 dark:bg-hearth-850/50 p-3 rounded-lg">
                  <span className="text-sage-600 dark:text-sage-400 text-xs uppercase font-semibold block mb-1">Try saying:</span>
                  "{actAnalysis.defusion_phrase}"
                </div>
              </motion.div>
            )}

            {/* Behavioral activation - only for low mood */}
            {framework === 'cbt' && cbt?.behavioral_activation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-lavender-50 p-4 rounded-2xl border border-lavender-100"
              >
                <div className="flex items-center gap-2 text-lavender-700 font-display font-semibold text-xs uppercase mb-2">
                  <Footprints size={14} /> Something small you could try
                </div>
                <p className="text-sm text-lavender-800 font-medium font-body">{cbt.behavioral_activation.activity}</p>
                {cbt.behavioral_activation.rationale && (
                  <p className="text-xs text-lavender-600 mt-1">{cbt.behavioral_activation.rationale}</p>
                )}
              </motion.div>
            )}

            {/* ACT Committed Action */}
            {framework === 'act' && actAnalysis?.committed_action && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-honey-50 dark:bg-honey-900/30 p-3 rounded-xl border border-honey-100 dark:border-honey-800"
              >
                <div className="flex items-center gap-2 text-honey-700 dark:text-honey-300 font-display font-semibold text-xs uppercase mb-2">
                  <Footprints size={14} /> A values-aligned step
                </div>
                <p className="text-sm text-honey-800 dark:text-honey-200 font-medium font-body">{actAnalysis.committed_action}</p>
              </motion.div>
            )}

            {/* Vent cooldown technique */}
            {framework === 'support' && ventSupport?.cooldown && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-honey-50 p-4 rounded-2xl border border-honey-100"
              >
                <div className="flex items-center gap-2 text-honey-700 font-display font-semibold text-xs uppercase mb-2">
                  <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
                </div>
                <p className="text-sm text-honey-800 font-body">{ventSupport.cooldown.instruction}</p>
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

            {/* 5. FALLBACK - Encouragement when nothing else is available */}
            {/* Styled more subtly since it's not primary content */}
            {showEncouragementAsFallback && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-warm-50 p-4 rounded-2xl border border-warm-100"
              >
                <p className="text-sm text-warm-600 font-body leading-relaxed">
                  {formatMentions(safeString(insight.message))}
                </p>
              </motion.div>
            )}
          </div>

          {/* Dismiss button (fixed at bottom) */}
          <div className="p-4 pt-2 flex-shrink-0">
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
