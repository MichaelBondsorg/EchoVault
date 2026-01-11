import { motion } from 'framer-motion';

/**
 * GlassCard - Reusable glassmorphism container for Bento widgets
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content inside the card
 * @param {string} props.className - Additional CSS classes
 * @param {string} props.size - Widget size: '1x1' | '2x1' | '2x2'
 * @param {boolean} props.isEditing - Whether edit mode is active
 * @param {function} props.onDelete - Callback when delete button is clicked
 * @param {boolean} props.interactive - Whether the card has hover effects
 * @param {Object} props.style - Additional inline styles
 */
const GlassCard = ({
  children,
  className = '',
  size = '2x1',
  isEditing = false,
  onDelete,
  interactive = false,
  style = {},
  ...props
}) => {
  // Size classes for the 2-column Bento grid
  const sizeClasses = {
    '1x1': 'col-span-1 aspect-square',      // Square, half width
    '2x1': 'col-span-2',                     // Full width, auto height
    '2x2': 'col-span-2 aspect-square',       // Full width, square
  };

  const baseClasses = `
    relative
    bg-white/30
    backdrop-blur-xl
    border border-white/20
    shadow-glass-md
    rounded-3xl
    overflow-hidden
    transition-all duration-300
  `;

  const interactiveClasses = interactive
    ? 'hover:bg-white/40 hover:shadow-glass-lg hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
    : '';

  const editingClasses = isEditing ? 'animate-shake' : '';

  return (
    <motion.div
      className={`
        ${baseClasses}
        ${sizeClasses[size] || sizeClasses['2x1']}
        ${interactiveClasses}
        ${editingClasses}
        ${className}
      `}
      style={style}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      {...props}
    >
      {/* Delete button (visible in edit mode) */}
      {isEditing && onDelete && (
        <motion.button
          className="
            absolute -top-2 -right-2 z-10
            w-7 h-7
            bg-red-500 hover:bg-red-600
            text-white text-sm font-bold
            rounded-full
            shadow-lg
            flex items-center justify-center
            transition-colors
          "
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          whileTap={{ scale: 0.9 }}
        >
          ×
        </motion.button>
      )}

      {/* Card content */}
      <div className="p-4 h-full">
        {children}
      </div>
    </motion.div>
  );
};

export default GlassCard;
