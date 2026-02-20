import { createContext, useContext, useMemo } from 'react';
import { motion } from 'framer-motion';

// Context for sharing mood state across components
const MoodBackgroundContext = createContext({
  moodScore: 0.5,
  moodCategory: 'neutral',
});

export const useMoodBackground = () => useContext(MoodBackgroundContext);

/**
 * Maps mood score (0-1) to mood category
 * @param {number} score - Mood score from 0 (struggling) to 1 (great)
 * @returns {string} - 'warm' | 'balanced' | 'calm'
 */
const getMoodCategory = (score) => {
  if (score >= 0.7) return 'warm';      // Great/Good
  if (score >= 0.4) return 'balanced';  // Neutral
  return 'calm';                         // Low/Struggling
};

/**
 * Get gradient colors based on mood category
 * @param {string} category - 'warm' | 'balanced' | 'calm'
 * @returns {Object} - CSS gradient color stops
 */
const getGradientColors = (category) => {
  const gradients = {
    warm: {
      from: '#FDDB8C',    // Honey gold
      via: '#C1D9C5',     // Sage mist
      to: '#F2F7F3',      // Sage tint
    },
    balanced: {
      from: '#F5EDE3',    // Warm parchment
      via: '#FEECC8',     // Honey cream
      to: '#FAF5EF',      // Linen cream
    },
    calm: {
      from: '#D1C8E5',    // Dusty lavender
      via: '#E8E3F2',     // Light lavender
      to: '#F5EDE3',      // Warm parchment base
    },
  };
  return gradients[category] || gradients.balanced;
};

/**
 * MoodBackgroundProvider - Provides mood-reactive animated gradient background
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - App content
 * @param {number} props.moodScore - Current mood score (0-1), typically from latest entry
 */
const MoodBackgroundProvider = ({ children, moodScore = 0.5 }) => {
  const moodCategory = useMemo(() => getMoodCategory(moodScore), [moodScore]);
  const colors = useMemo(() => getGradientColors(moodCategory), [moodCategory]);

  const contextValue = useMemo(
    () => ({ moodScore, moodCategory }),
    [moodScore, moodCategory]
  );

  return (
    <MoodBackgroundContext.Provider value={contextValue}>
      {/* Fixed background layer (z-0) */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        {/* Animated gradient background */}
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={{
            background: `linear-gradient(135deg, ${colors.from} 0%, ${colors.via} 50%, ${colors.to} 100%)`,
          }}
          transition={{
            duration: 3, // 3000ms transition as specified
            ease: 'easeInOut',
          }}
        />

        {/* Slow-moving gradient overlay for subtle animation */}
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{
            background: [
              `radial-gradient(circle at 20% 80%, ${colors.from}40 0%, transparent 50%)`,
              `radial-gradient(circle at 80% 20%, ${colors.via}40 0%, transparent 50%)`,
              `radial-gradient(circle at 50% 50%, ${colors.to}40 0%, transparent 50%)`,
              `radial-gradient(circle at 20% 80%, ${colors.from}40 0%, transparent 50%)`,
            ],
          }}
          transition={{
            duration: 20,
            ease: 'linear',
            repeat: Infinity,
          }}
        />

        {/* Subtle noise texture overlay for depth */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content layer */}
      <div className="relative z-10 min-h-screen">
        {children}
      </div>
    </MoodBackgroundContext.Provider>
  );
};

export default MoodBackgroundProvider;
