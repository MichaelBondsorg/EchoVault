import { useState, useEffect } from 'react';
import { isDarkMode } from '../utils/darkMode';

/**
 * React hook that reactively tracks dark mode state.
 * Uses MutationObserver on <html> class attribute changes.
 */
export function useDarkMode() {
  const [dark, setDark] = useState(isDarkMode);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}
