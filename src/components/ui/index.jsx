/**
 * Engram UI Components
 * Reusable animated components using the therapeutic design system
 */

import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { HEX_COLORS } from '../../utils/colorMap.js';

// ============================================
// Animation Variants
// ============================================

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

export const slideFromRight = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

// ============================================
// Celebration Effects
// ============================================

export const celebrate = {
  // Basic confetti burst
  confetti: () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: [HEX_COLORS.sage, HEX_COLORS.sageLight, HEX_COLORS.lavender, HEX_COLORS.terra, HEX_COLORS.honeyLight],
    });
  },

  // Side cannons for bigger celebrations
  cannons: () => {
    const end = Date.now() + 500;
    const colors = [HEX_COLORS.sage, HEX_COLORS.sageLight, HEX_COLORS.lavender];

    (function frame() {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors,
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  },

  // Gentle sparkles for smaller wins
  sparkle: () => {
    confetti({
      particleCount: 30,
      spread: 50,
      origin: { y: 0.7 },
      colors: [HEX_COLORS.honeyLight, HEX_COLORS.terra],
      scalar: 0.8,
    });
  },

  // Stars for streaks
  stars: () => {
    const defaults = {
      spread: 360,
      ticks: 50,
      gravity: 0,
      decay: 0.94,
      startVelocity: 30,
      colors: [HEX_COLORS.sage, HEX_COLORS.sageLight, HEX_COLORS.lavender, HEX_COLORS.terra],
    };

    confetti({
      ...defaults,
      particleCount: 40,
      scalar: 1.2,
      shapes: ['star'],
    });

    confetti({
      ...defaults,
      particleCount: 10,
      scalar: 0.75,
      shapes: ['circle'],
    });
  },
};

// ============================================
// Button Components
// ============================================

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  onClick,
  'aria-label': ariaLabel,
  ...props
}) => {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    success: 'btn-success',
  };

  const sizes = {
    sm: 'px-4 py-2 text-sm rounded-xl',
    md: 'px-6 py-3 rounded-2xl',
    lg: 'px-8 py-4 text-lg rounded-2xl',
  };

  return (
    <motion.button
      className={`
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}
      `}
      whileHover={disabled ? {} : { scale: 1.02 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={loading}
      aria-disabled={disabled}
      {...props}
    >
      {loading ? (
        <motion.div
          className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          role="status"
          aria-label="Loading"
        />
      ) : (
        children
      )}
    </motion.button>
  );
};

// ============================================
// Card Components
// ============================================

export const Card = ({
  children,
  variant = 'default',
  className = '',
  onClick,
  ...props
}) => {
  const variants = {
    default: 'bg-white/95 backdrop-blur-sm border border-white/50 shadow-soft dark:bg-hearth-850/95 dark:border-hearth-700/30',
    glass: 'bg-white/10 backdrop-blur-md border border-white/20 dark:bg-hearth-900/20 dark:border-hearth-700/20',
    interactive: 'bg-white/95 backdrop-blur-sm border border-white/50 shadow-soft hover:shadow-soft-lg cursor-pointer dark:bg-hearth-850/95 dark:border-hearth-700/30',
  };

  const Component = onClick ? motion.button : motion.div;

  return (
    <Component
      className={`rounded-3xl p-6 transition-all duration-300 ${variants[variant]} ${className}`}
      whileHover={onClick ? { y: -4, scale: 1.01 } : {}}
      whileTap={onClick ? { scale: 0.99 } : {}}
      onClick={onClick}
      {...props}
    >
      {children}
    </Component>
  );
};

export const EntryCard = ({
  children,
  mood = 'neutral',
  className = '',
  onClick,
  ...props
}) => {
  const moodColors = {
    great: 'from-mood-great to-sage-600',
    good: 'from-mood-good to-sage-500',
    neutral: 'from-honey-400 to-honey-600',
    low: 'from-mood-low to-lavender-500',
    struggling: 'from-mood-struggling to-lavender-600',
  };

  return (
    <motion.div
      className={`
        relative bg-white/95 backdrop-blur-sm rounded-3xl p-6
        border border-white/50 shadow-soft overflow-hidden
        transition-all duration-300 hover:shadow-soft-lg
        dark:bg-hearth-850/95 dark:border-hearth-700/30
        ${onClick ? 'cursor-pointer' : ''} ${className}
      `}
      whileHover={onClick ? { y: -2 } : {}}
      onClick={onClick}
      {...props}
    >
      {/* Mood accent border */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-3xl bg-gradient-to-b ${moodColors[mood]}`} />
      <div className="pl-3">{children}</div>
    </motion.div>
  );
};

// ============================================
// Modal Components
// ============================================

export const Modal = ({
  isOpen,
  onClose,
  children,
  size = 'md',
  className = '',
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}) => {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-warm-900/80 to-warm-800/80 backdrop-blur-md dark:from-hearth-950/90 dark:to-hearth-900/90"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Content */}
          <motion.div
            className={`
              relative bg-white rounded-3xl shadow-soft-xl w-full ${sizes[size]}
              max-h-[90vh] overflow-y-auto
              dark:bg-hearth-850 dark:border dark:border-hearth-700/30
              ${className}
            `}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const ModalHeader = ({ children, onClose, className = '', id }) => (
  <div className={`flex items-center justify-between p-6 pb-0 ${className}`}>
    <div id={id}>{children}</div>
    {onClose && (
      <motion.button
        className="p-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-warm-100 dark:text-hearth-400 dark:hover:text-hearth-200 dark:hover:bg-hearth-800 transition-colors focus:outline-none focus:ring-2 focus:ring-honey-500"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </motion.button>
    )}
  </div>
);

export const ModalBody = ({ children, className = '' }) => (
  <div className={`p-6 ${className}`}>{children}</div>
);

export const ModalFooter = ({ children, className = '' }) => (
  <div className={`p-6 pt-0 flex gap-3 justify-end ${className}`}>{children}</div>
);

// ============================================
// Badge Components
// ============================================

export const Badge = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
}) => {
  const variants = {
    primary: 'bg-honey-100 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300',
    secondary: 'bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300',
    accent: 'bg-accent-light text-accent-dark dark:bg-honey-900/30 dark:text-honey-300',
    success: 'bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300',
    warning: 'bg-honey-100 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    neutral: 'bg-warm-100 text-warm-700 dark:bg-hearth-850 dark:text-hearth-300',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-xs',
    lg: 'px-4 py-1.5 text-sm',
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full font-semibold
        ${variants[variant]} ${sizes[size]} ${className}
      `}
    >
      {children}
    </span>
  );
};

export const MoodBadge = ({ score, className = '' }) => {
  const getMoodInfo = (score) => {
    if (score >= 0.8) return { label: 'Great', variant: 'success', emoji: '😊' };
    if (score >= 0.6) return { label: 'Good', variant: 'primary', emoji: '🙂' };
    if (score >= 0.4) return { label: 'Okay', variant: 'warning', emoji: '😐' };
    if (score >= 0.2) return { label: 'Low', variant: 'secondary', emoji: '😔' };
    return { label: 'Struggling', variant: 'danger', emoji: '😢' };
  };

  const { label, variant, emoji } = getMoodInfo(score);

  return (
    <Badge variant={variant} className={className}>
      <span>{emoji}</span>
      <span>{label}</span>
      <span className="opacity-60">{Math.round(score * 100)}%</span>
    </Badge>
  );
};

// ============================================
// Loading Components
// ============================================

export const BreathingLoader = ({ size = 'md', className = '', label = 'Taking a moment...' }) => {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  };

  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <motion.div
        className={`rounded-full bg-gradient-to-br from-sage-400 to-sage-600 shadow-glow ${sizes[size]}`}
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        aria-hidden="true"
      />
      <p className="text-warm-500 dark:text-warm-400 text-sm">{label}</p>
    </div>
  );
};

export const Spinner = ({ size = 'md', className = '', label = 'Loading' }) => {
  const sizes = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
  };

  return (
    <motion.div
      className={`rounded-full border-honey-200 border-t-honey-600 ${sizes[size]} ${className}`}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      role="status"
      aria-label={label}
    />
  );
};

// ============================================
// Input Components
// ============================================

export const Input = ({
  label,
  error,
  className = '',
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-warm-700 dark:text-hearth-300">{label}</label>
      )}
      <input
        id={inputId}
        className={`
          w-full px-4 py-3 bg-warm-50 border-2 border-warm-200 rounded-2xl
          font-body text-warm-800 placeholder:text-warm-400
          transition-all duration-200
          focus:border-honey-400 focus:bg-white focus:shadow-soft focus:outline-none
          focus:ring-2 focus:ring-honey-500 focus:ring-offset-2
          dark:bg-hearth-900/60 dark:border-hearth-700/50 dark:text-hearth-100
          dark:placeholder:text-hearth-500 dark:focus:border-honey-500/50
          dark:focus:bg-hearth-800/80 dark:focus:ring-honey-500/40
          dark:focus:ring-offset-hearth-850
          ${error ? 'border-red-300 focus:border-red-400' : ''}
          ${className}
        `}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error && <p id={errorId} className="text-sm text-red-500" role="alert">{error}</p>}
    </div>
  );
};

export const Textarea = ({
  label,
  error,
  className = '',
  id,
  'aria-describedby': ariaDescribedBy,
  ...props
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  const errorId = error ? `${textareaId}-error` : undefined;
  const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={textareaId} className="block text-sm font-medium text-warm-700 dark:text-hearth-300">{label}</label>
      )}
      <textarea
        id={textareaId}
        className={`
          w-full px-4 py-3 bg-warm-50 border-2 border-warm-200 rounded-2xl
          font-body text-warm-800 placeholder:text-warm-400
          transition-all duration-200 min-h-[120px] resize-none
          focus:border-honey-400 focus:bg-white focus:shadow-soft focus:outline-none
          focus:ring-2 focus:ring-honey-500 focus:ring-offset-2
          dark:bg-hearth-900/60 dark:border-hearth-700/50 dark:text-hearth-100
          dark:placeholder:text-hearth-500 dark:focus:border-honey-500/50
          dark:focus:bg-hearth-800/80 dark:focus:ring-honey-500/40
          dark:focus:ring-offset-hearth-850
          ${error ? 'border-red-300 focus:border-red-400' : ''}
          ${className}
        `}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error && <p id={errorId} className="text-sm text-red-500" role="alert">{error}</p>}
    </div>
  );
};

// ============================================
// List Animation Wrapper
// ============================================

export const AnimatedList = ({ children, className = '' }) => (
  <motion.div
    className={className}
    initial="hidden"
    animate="visible"
    variants={{
      visible: {
        transition: {
          staggerChildren: 0.05,
        },
      },
    }}
  >
    {children}
  </motion.div>
);

export const AnimatedListItem = ({ children, className = '' }) => (
  <motion.div
    className={className}
    variants={{
      hidden: { opacity: 0, y: 20 },
      visible: { opacity: 1, y: 0 },
    }}
    transition={{ duration: 0.3 }}
  >
    {children}
  </motion.div>
);

// ============================================
// Empty State
// ============================================

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) => (
  <motion.div
    className={`flex flex-col items-center justify-center py-16 px-8 text-center ${className}`}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
  >
    {Icon && (
      <motion.div
        className="w-20 h-20 mb-6 rounded-full bg-honey-100 dark:bg-honey-900/30 flex items-center justify-center"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Icon className="w-10 h-10 text-honey-500" />
      </motion.div>
    )}
    <h3 className="text-xl font-hand font-bold text-warm-700 dark:text-hearth-200 mb-2">{title}</h3>
    <p className="text-warm-500 dark:text-hearth-400 max-w-sm mb-6">{description}</p>
    {action && (
      <Button variant="primary" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </motion.div>
);

// ============================================
// Toast Notifications (simple implementation)
// ============================================

export const Toast = ({
  message,
  type = 'success',
  isVisible,
  onClose,
}) => {
  const types = {
    success: 'bg-sage-500 dark:bg-sage-600',
    error: 'bg-red-500', /* @color-safe - error state */
    warning: 'bg-honey-500 dark:bg-honey-600',
    info: 'bg-lavender-500 dark:bg-lavender-600',
  };

  // Map toast type to ARIA role
  const ariaRole = type === 'error' ? 'alert' : 'status';
  const ariaLive = type === 'error' ? 'assertive' : 'polite';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={`
            fixed bottom-6 left-1/2 -translate-x-1/2 z-50
            px-6 py-3 rounded-2xl text-white font-medium shadow-soft-lg
            ${types[type]}
          `}
          initial={{ opacity: 0, y: 50, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 50, x: '-50%' }}
          role={ariaRole}
          aria-live={ariaLive}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Export all
export default {
  Button,
  Card,
  EntryCard,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Badge,
  MoodBadge,
  BreathingLoader,
  Spinner,
  Input,
  Textarea,
  AnimatedList,
  AnimatedListItem,
  EmptyState,
  Toast,
  celebrate,
  fadeIn,
  slideUp,
  scaleIn,
  slideFromRight,
};
