import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isDarkMode, toggleDarkMode, initDarkMode, cleanupDarkMode } from '../../utils/darkMode';

export default function DarkModeToggle({ className = '' }) {
  const [dark, setDark] = useState(() => isDarkMode());
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    initDarkMode();
    setDark(isDarkMode());
    return () => cleanupDarkMode();
  }, []);

  const handleToggle = () => {
    const newState = toggleDarkMode();
    setDark(newState);
  };

  const iconTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.2 };

  return (
    <motion.button
      className={`p-2 rounded-xl text-hearth-600 dark:text-hearth-300 hover:bg-hearth-100 dark:hover:bg-hearth-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-honey-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-hearth-850 ${className}`}
      onClick={handleToggle}
      whileHover={prefersReducedMotion ? {} : { scale: 1.1 }}
      whileTap={prefersReducedMotion ? {} : { scale: 0.9 }}
      aria-pressed={dark}
      aria-label="Toggle dark mode"
      type="button"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={dark ? 'sun' : 'moon'}
          initial={prefersReducedMotion ? { opacity: 0 } : { rotate: -90, scale: 0, opacity: 0 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { rotate: 0, scale: 1, opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { rotate: 90, scale: 0, opacity: 0 }}
          transition={iconTransition}
        >
          {dark ? <Sun size={20} /> : <Moon size={20} />}
        </motion.div>
      </AnimatePresence>
      <span className="sr-only">{dark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </motion.button>
  );
}
