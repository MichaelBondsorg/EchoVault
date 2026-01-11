import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon, Coffee, Sunset } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * HeroWidget - Time-based greeting card for Bento dashboard
 *
 * Adapts greeting and icon based on time of day
 */
const HeroWidget = ({
  user,
  entries = [],
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  // Get time-based greeting
  const { greeting, icon: Icon, timeOfDay } = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return { greeting: 'Good morning', icon: Sun, timeOfDay: 'morning' };
    } else if (hour >= 12 && hour < 17) {
      return { greeting: 'Good afternoon', icon: Coffee, timeOfDay: 'afternoon' };
    } else if (hour >= 17 && hour < 21) {
      return { greeting: 'Good evening', icon: Sunset, timeOfDay: 'evening' };
    } else {
      return { greeting: 'Good night', icon: Moon, timeOfDay: 'night' };
    }
  }, []);

  // Get user's first name
  const firstName = useMemo(() => {
    if (user?.displayName) {
      return user.displayName.split(' ')[0];
    }
    return '';
  }, [user?.displayName]);

  // Get today's entry count
  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return entries.filter(e => {
      const entryDate = e.effectiveDate || e.createdAt;
      return entryDate?.toDate?.()?.toDateString?.() === today ||
             new Date(entryDate).toDateString() === today;
    }).length;
  }, [entries]);

  // Get latest mood score
  const latestMood = useMemo(() => {
    const withMood = entries.find(e => e.analysis?.mood_score !== undefined);
    return withMood?.analysis?.mood_score;
  }, [entries]);

  // Get mood message
  const moodMessage = useMemo(() => {
    if (latestMood === undefined) return 'How are you feeling today?';
    if (latestMood >= 0.7) return "You're doing great!";
    if (latestMood >= 0.5) return 'Taking it one step at a time';
    return "I'm here for you";
  }, [latestMood]);

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
      className="overflow-hidden"
    >
      <div className="flex items-center justify-between h-full">
        {/* Left: Greeting */}
        <div className="flex-1">
          <motion.p
            className="text-warm-500 text-sm font-medium"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {greeting}{firstName ? `, ${firstName}` : ''}
          </motion.p>
          <motion.h2
            className="text-warm-800 text-lg font-display font-bold mt-1"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {moodMessage}
          </motion.h2>
          {todayCount > 0 && (
            <motion.p
              className="text-warm-400 text-xs mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {todayCount} {todayCount === 1 ? 'entry' : 'entries'} today
            </motion.p>
          )}
        </div>

        {/* Right: Time icon */}
        <motion.div
          className={`
            w-12 h-12 rounded-2xl
            flex items-center justify-center
            ${timeOfDay === 'morning' ? 'bg-amber-100 text-amber-600' :
              timeOfDay === 'afternoon' ? 'bg-blue-100 text-blue-600' :
              timeOfDay === 'evening' ? 'bg-orange-100 text-orange-600' :
              'bg-indigo-100 text-indigo-600'}
          `}
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', damping: 15, delay: 0.15 }}
        >
          <Icon size={24} />
        </motion.div>
      </div>
    </GlassCard>
  );
};

export default HeroWidget;
