import React from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon, Cloud, Heart, Mic, Sparkles } from 'lucide-react';

/**
 * HeroCard - Adaptive hero component that changes visual style by mode
 *
 * Props:
 * - type: 'morning' | 'midday' | 'evening' | 'shelter'
 * - title: Main headline
 * - subtitle: Supporting text (optional)
 * - isQuote: If true, renders title as a quote
 * - action: { label, type, onClick } - Primary action button
 * - children: Additional content to render below
 */

const modeStyles = {
  morning: {
    gradient: 'from-honey-50 via-honey-100 to-honey-50 dark:from-honey-900/30 dark:via-honey-900/20 dark:to-honey-900/30',
    border: 'border-honey-200 dark:border-honey-800',
    icon: Sun,
    iconColor: 'text-honey-500 dark:text-honey-400',
    titleColor: 'text-honey-900 dark:text-honey-100',
    subtitleColor: 'text-honey-700 dark:text-honey-300'
  },
  midday: {
    gradient: 'from-sage-50 via-lavender-50 to-sage-50 dark:from-sage-900/30 dark:via-lavender-900/20 dark:to-sage-900/30',
    border: 'border-sage-200 dark:border-sage-800',
    icon: Cloud,
    iconColor: 'text-sage-500 dark:text-sage-400',
    titleColor: 'text-sage-900 dark:text-sage-100',
    subtitleColor: 'text-sage-700 dark:text-sage-300'
  },
  evening: {
    gradient: 'from-lavender-50 via-lavender-100 to-lavender-50 dark:from-lavender-900/30 dark:via-lavender-900/20 dark:to-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-800',
    icon: Moon,
    iconColor: 'text-lavender-500 dark:text-lavender-400',
    titleColor: 'text-lavender-900 dark:text-lavender-100',
    subtitleColor: 'text-lavender-700 dark:text-lavender-300'
  },
  shelter: {
    gradient: 'from-terra-50 via-warm-50 to-terra-50 dark:from-terra-900/30 dark:via-hearth-900/50 dark:to-terra-900/30',
    border: 'border-terra-200 dark:border-terra-800',
    icon: Heart,
    iconColor: 'text-terra-400 dark:text-terra-300',
    titleColor: 'text-terra-800 dark:text-terra-200',
    subtitleColor: 'text-terra-600 dark:text-terra-400'
  }
};

const HeroCard = ({
  type = 'midday',
  title,
  subtitle,
  isQuote = false,
  action,
  onAction,
  children
}) => {
  const style = modeStyles[type] || modeStyles.midday;
  const Icon = style.icon;

  return (
    <motion.div
      className={`bg-gradient-to-br ${style.gradient} rounded-2xl p-5 border ${style.border} shadow-soft`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header with icon */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`p-2 rounded-full bg-white/60 dark:bg-hearth-800/60 ${style.iconColor}`}>
          <Icon size={20} />
        </div>
        <div className="flex-1">
          {isQuote ? (
            <blockquote className={`text-lg font-display italic ${style.titleColor} leading-relaxed`}>
              "{title}"
            </blockquote>
          ) : (
            <h2 className={`text-xl font-display font-bold ${style.titleColor}`}>
              {title}
            </h2>
          )}
          {subtitle && (
            <p className={`text-sm font-body mt-1 ${style.subtitleColor}`}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Optional children content */}
      {children && (
        <div className="mt-4">
          {children}
        </div>
      )}

      {/* Action button */}
      {action && (
        <motion.button
          onClick={onAction}
          className={`mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl
            bg-white/70 hover:bg-white/90 dark:bg-hearth-800/70 dark:hover:bg-hearth-800/90 ${style.titleColor} font-medium text-sm
            border ${style.border} transition-all shadow-sm hover:shadow-md`}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          {action.type === 'voice_record' && <Mic size={16} />}
          {action.type === 'celebrate' && <Sparkles size={16} />}
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
};

export default HeroCard;
