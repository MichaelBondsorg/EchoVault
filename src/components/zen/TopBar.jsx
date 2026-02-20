import { motion } from 'framer-motion';
import { useMoodBackground } from './MoodBackgroundProvider';

/**
 * TopBar - Translucent top navigation bar with mood indicator
 *
 * LAY-004: Shows "Engram" brand instead of greeting to avoid redundancy
 * (HeroWidget already shows time-based greeting on home page)
 *
 * @param {Object} props
 * @param {string} props.greeting - Unused (kept for API compatibility)
 * @param {function} props.onMoodOrbClick - Callback when mood orb is clicked (opens Quick Log)
 * @param {number} props.latestMoodScore - Latest entry mood score (0-1)
 */
const TopBar = ({ greeting, onMoodOrbClick, latestMoodScore = 0.5 }) => {
  const { moodCategory } = useMoodBackground();

  // Map mood category to orb color — Hearthside palette
  const orbColors = {
    warm: 'bg-gradient-to-br from-honey-300 to-sage-400',
    balanced: 'bg-gradient-to-br from-hearth-300 to-honey-400',
    calm: 'bg-gradient-to-br from-lavender-300 to-lavender-400',
  };

  const orbGlowColors = {
    warm: 'shadow-[0_0_20px_rgba(232,168,76,0.5)]',
    balanced: 'shadow-[0_0_20px_rgba(212,196,176,0.5)]',
    calm: 'shadow-[0_0_20px_rgba(155,142,196,0.4)]',
  };

  return (
    <motion.header
      className="
        fixed top-0 left-0 right-0 z-50
        bg-hearth-50/30 backdrop-blur-md
        px-4 py-3
        pt-[calc(env(safe-area-inset-top)+12px)]
        flex items-center justify-between
      "
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Left: Brand (LAY-004: Always show brand, not greeting) */}
      <motion.h1
        className="font-display font-bold text-lg text-hearth-800"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        Engram
      </motion.h1>

      {/* Right: Mood Indicator Orb */}
      <motion.button
        onClick={onMoodOrbClick}
        className={`
          w-10 h-10 rounded-full
          ${orbColors[moodCategory] || orbColors.balanced}
          ${orbGlowColors[moodCategory] || orbGlowColors.balanced}
          flex items-center justify-center
          transition-all duration-300
          active:scale-95
        `}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          scale: [1, 1.05, 1],
        }}
        transition={{
          scale: {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          },
        }}
        aria-label="Open quick mood log"
      >
        {/* Inner glow effect */}
        <div className="w-6 h-6 rounded-full bg-white/40 backdrop-blur-sm" />
      </motion.button>
    </motion.header>
  );
};

export default TopBar;
