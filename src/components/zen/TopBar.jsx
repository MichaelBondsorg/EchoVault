import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useMoodBackground } from './MoodBackgroundProvider';
import ProfileBadge from './ProfileBadge';

/**
 * TopBar - Translucent top navigation bar with dynamic greeting and user profile badge
 *
 * Displays a time-based greeting with the user's first name and a profile badge
 * showing user initials. Includes mood indicator orb for quick mood logging.
 *
 * @param {Object} props
 * @param {Object} props.user - Firebase user object with displayName property
 * @param {function} props.onMoodOrbClick - Callback when mood orb is clicked (opens Quick Log)
 * @param {number} props.latestMoodScore - Latest entry mood score (0-1)
 */
const TopBar = ({ user, onMoodOrbClick, latestMoodScore = 0.5 }) => {
  const { moodCategory } = useMoodBackground();

  // Track current hour to update greeting when time changes
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());

  // Update hour every minute to catch time-of-day transitions
  useEffect(() => {
    const updateHour = () => {
      setCurrentHour(new Date().getHours());
    };

    // Update immediately and then every minute
    const interval = setInterval(updateHour, 60000);
    return () => clearInterval(interval);
  }, []);

  // Get time-based greeting
  const greeting = useMemo(() => {
    if (currentHour >= 5 && currentHour < 12) {
      return 'Good morning';
    } else if (currentHour >= 12 && currentHour < 17) {
      return 'Good afternoon';
    } else if (currentHour >= 17 && currentHour < 21) {
      return 'Good evening';
    } else {
      return 'Good night';
    }
  }, [currentHour]);

  // Get user's first name (handle multiple spaces consistently)
  const firstName = useMemo(() => {
    if (user?.displayName) {
      const parts = user.displayName.trim().split(/\s+/);
      return parts.length > 0 ? parts[0] : '';
    }
    return '';
  }, [user?.displayName]);

  // Extract user initials from displayName
  const initials = useMemo(() => {
    if (!user?.displayName) return '';
    
    // Split by whitespace and filter out empty parts
    const parts = user.displayName.trim().split(/\s+/).filter(part => part.length > 0);
    
    if (parts.length === 0) return '';
    
    if (parts.length === 1) {
      // Single word: use first 2 letters (or 1 if name is only 1 character)
      const name = parts[0];
      return name.substring(0, Math.min(2, name.length)).toUpperCase();
    }
    
    // Multiple words: use first letter of first and last name
    const first = parts[0];
    const last = parts[parts.length - 1];
    
    // Handle edge case where first or last part might be empty
    if (!first || !last) return '';
    
    const firstLetter = first[0] || '';
    const lastLetter = last[0] || '';
    
    return (firstLetter + lastLetter).toUpperCase();
  }, [user?.displayName]);

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
      {/* Left: Dynamic Greeting with User's First Name */}
      <motion.div
        className="flex items-center gap-2"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h1 className="font-display font-bold text-lg text-warm-800">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
      </motion.div>

      {/* Right: Mood Indicator Orb and Profile Badge */}
      <div className="flex items-center gap-3">
        {/* Mood Indicator Orb */}
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

        {/* User Profile Badge */}
        <ProfileBadge 
          initials={initials}
          aria-label={user?.displayName ? `User profile: ${user.displayName}` : 'User profile'}
        />
      </div>
    </motion.header>
  );
};

export default TopBar;
