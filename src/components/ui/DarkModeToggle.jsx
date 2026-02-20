import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { isDarkMode, toggleDarkMode, initDarkMode, cleanupDarkMode } from '../../utils/darkMode';

export default function DarkModeToggle({ className = '' }) {
  const [dark, setDark] = useState(() => isDarkMode());

  useEffect(() => {
    initDarkMode();
    setDark(isDarkMode());
    return () => cleanupDarkMode();
  }, []);

  const handleToggle = () => {
    const newState = toggleDarkMode();
    setDark(newState);
  };

  return (
    <motion.button
      className={`p-2 rounded-xl text-hearth-600 dark:text-hearth-300 hover:bg-hearth-100 dark:hover:bg-hearth-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-honey-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-hearth-850 ${className}`}
      onClick={handleToggle}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      aria-pressed={dark}
      aria-label="Toggle dark mode"
      type="button"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={dark ? 'sun' : 'moon'}
          initial={{ rotate: -90, scale: 0, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {dark ? <Sun size={20} /> : <Moon size={20} />}
        </motion.div>
      </AnimatePresence>
      <span className="sr-only">{dark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </motion.button>
  );
}
