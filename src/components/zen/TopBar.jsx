import { motion } from 'framer-motion';
import { useMoodBackground } from './MoodBackgroundProvider';

/**
 * TopBar - Translucent top navigation bar with mood indicator
 *
 * @param {Object} props
 * @param {string} props.greeting - Optional greeting text (default: "EchoVault")
 * @param {function} props.onMoodOrbClick - Callback when mood orb is clicked (opens Quick Log)
 * @param {number} props.latestMoodScore - Latest entry mood score (0-1)
 */
const TopBar = ({ greeting = 'EchoVault', onMoodOrbClick, latestMoodScore = 0.5 }) => {
  const { moodCategory } = useMoodBackground();

  // Map mood category to orb color
  const orbColors = {
    warm: 'bg-gradient-to-br from-amber-300 to-teal-300',
    balanced: 'bg-gradient-to-br from-slate-300 to-blue-300',
    calm: 'bg-gradient-to-br from-blue-300 to-purple-300',
  };

  const orbGlowColors = {
    warm: 'shadow-[0_0_20px_rgba(251,191,36,0.5)]',
    balanced: 'shadow-[0_0_20px_rgba(148,163,184,0.5)]',
    calm: 'shadow-[0_0_20px_rgba(147,197,253,0.5)]',
  };

  return (
    <motion.header
      className="
        fixed top-0 left-0 right-0 z-50
        bg-white/10 backdrop-blur-md
        px-4 py-3
        pt-[calc(env(safe-area-inset-top)+12px)]
        flex items-center justify-between
      "
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Left: Brand/Greeting */}
      <motion.h1
        className="font-display font-bold text-lg text-warm-800"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        {greeting}
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
