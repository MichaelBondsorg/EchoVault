import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * HeroWidget - Time-based serif greeting for the Home screen
 * (CLOUD-DESIGN-SPEC.md §7 Home: "greeting (serif)").
 *
 * Sits directly on the LinenWaveBackground canvas (no card chrome) —
 * a small muted date line above a large Newsreader greeting, matching
 * the Home mockup (docs/design/cloud/engram-redesign-mockups.dc.html #3a).
 */
const HeroWidget = ({
  user,
  isEditing = false,
  onDelete,
}) => {
  // Get time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    if (hour >= 17 && hour < 21) return 'Good evening';
    return 'Good night';
  }, []);

  // Get user's first name
  const firstName = useMemo(() => {
    if (user?.displayName) {
      return user.displayName.split(' ')[0];
    }
    return '';
  }, [user?.displayName]);

  // Today's date, spelled out (e.g. "Thursday, July 17")
  const dateLabel = useMemo(() => (
    new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  ), []);

  return (
    <div className={`relative w-full ${isEditing ? 'animate-shake' : ''}`}>
      <motion.p
        className="text-[13px] text-muted-foreground"
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {dateLabel}
      </motion.p>
      <motion.h2
        className="mt-1 font-display font-medium text-[27px] leading-[1.2] tracking-[-0.01em] text-foreground"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {greeting}{firstName ? `, ${firstName}` : ''}
      </motion.h2>
    </div>
  );
};

export default HeroWidget;
