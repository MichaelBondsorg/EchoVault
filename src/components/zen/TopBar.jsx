import { motion } from 'framer-motion';

/**
 * TopBar - Cloud top bar: frosted linen (blurred background tint so page
 * titles scrolling beneath never collide with the brand mark) with a serif
 * brand mark and a mood-log shortcut.
 *
 * LAY-004: Shows "Engram" brand instead of greeting to avoid redundancy
 * (HeroWidget already shows time-based greeting on home page)
 *
 * @param {Object} props
 * @param {string} props.greeting - Unused (kept for API compatibility)
 * @param {function} props.onMoodOrbClick - Callback when mood orb is clicked (opens Quick Log)
 * @param {number} props.latestMoodScore - Latest entry mood score (0-1)
 */
const TopBar = ({ greeting, onMoodOrbClick, latestMoodScore = null }) => {
  return (
    <motion.header
      className="
        fixed top-0 left-0 right-0 z-50
        bg-background/75 backdrop-blur-md
        px-4 py-3
        pt-[calc(env(safe-area-inset-top)+12px)]
        flex items-center justify-between
      "
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Left: Brand (LAY-004: Always show brand, not greeting) - serif per §4 typography */}
      <motion.h1
        className="font-display font-semibold text-lg text-foreground"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        Engram
      </motion.h1>

      {/* Right: Mood Indicator Orb */}
      <motion.button
        type="button"
        onClick={onMoodOrbClick}
        className="
          w-11 h-11 rounded-full
          bg-accent-deep shadow-sm
          flex items-center justify-center
          transition-all duration-300
          active:scale-95
        "
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Open quick mood log"
      >
        {/* Inner glow effect */}
        <div className="h-4 w-4 rounded-full border-2 border-white/80" />
      </motion.button>
    </motion.header>
  );
};

export default TopBar;
