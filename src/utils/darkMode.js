/**
 * Dark Mode Utility
 * Manages dark mode state: initialization, toggle, system preference detection.
 *
 * Storage key: 'engram-dark-mode'
 * Values: 'dark' | 'light' | 'system' (null treated as 'system')
 */

const STORAGE_KEY = 'engram-dark-mode';
const VALID_MODES = ['dark', 'light', 'system'];

let mediaQuery = null;
let mediaQueryHandler = null;

async function updateStatusBar(isDark) {
  try {
    if (window.Capacitor) {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    }
  } catch {
    // StatusBar not available (web or plugin not installed)
  }
}

function applyDarkMode(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
  updateStatusBar(isDark);
}

function getSystemPreference() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getStoredPreference() {
  return localStorage.getItem(STORAGE_KEY);
}

export function initDarkMode() {
  // Guard against repeated calls — clean up any existing listener first
  cleanupDarkMode();

  const stored = getStoredPreference();
  let isDark;

  if (stored === 'dark') {
    isDark = true;
  } else if (stored === 'light') {
    isDark = false;
  } else {
    // 'system' or null — follow OS preference
    isDark = getSystemPreference();
  }

  applyDarkMode(isDark);

  // Listen for system preference changes
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQueryHandler = (e) => {
    const pref = getStoredPreference();
    // Only auto-switch if user hasn't set an explicit preference
    if (pref === 'system' || pref === null) {
      applyDarkMode(e.matches);
    }
  };
  mediaQuery.addEventListener('change', mediaQueryHandler);
}

export function toggleDarkMode(mode) {
  // Validate mode if provided
  if (mode !== undefined && !VALID_MODES.includes(mode)) {
    mode = 'system';
  }

  let isDark;

  if (mode !== undefined) {
    // Explicit mode set
    localStorage.setItem(STORAGE_KEY, mode);
    if (mode === 'system') {
      isDark = getSystemPreference();
    } else {
      isDark = mode === 'dark';
    }
  } else {
    // Toggle: if currently dark, go light; if light, go dark
    const currentlyDark = document.documentElement.classList.contains('dark');
    isDark = !currentlyDark;
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }

  applyDarkMode(isDark);
  return isDark;
}

export function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

export function cleanupDarkMode() {
  if (mediaQuery && mediaQueryHandler) {
    mediaQuery.removeEventListener('change', mediaQueryHandler);
    mediaQuery = null;
    mediaQueryHandler = null;
  }
}
