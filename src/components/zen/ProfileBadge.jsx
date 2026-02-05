import { motion } from 'framer-motion';

/**
 * ProfileBadge - Circular badge displaying user initials
 *
 * Follows glassmorphism aesthetic from GlassCard.jsx
 *
 * @param {Object} props
 * @param {string} props.initials - User initials to display (e.g., "JD")
 * @param {string} props.className - Additional CSS classes
 * @param {string} props['aria-label'] - Accessibility label for screen readers
 */
const ProfileBadge = ({ initials, className = '', 'aria-label': ariaLabel, ...props }) => {
  if (!initials) return null;

  return (
    <motion.div
      className={`
        w-10 h-10 rounded-full
        bg-white/30
        backdrop-blur-xl
        border border-white/20
        shadow-glass-md
        flex items-center justify-center
        font-display font-semibold text-sm
        text-warm-800
        ${className}
      `}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={ariaLabel}
      role="img"
      {...props}
    >
      {initials}
    </motion.div>
  );
};

export default ProfileBadge;
