/**
 * Accent Color Utility
 * Manages the Cloud accent theme: initialization, get, set.
 *
 * Storage key: 'engram-accent'
 * Values: 'blue' | 'mauve' | 'terracotta' (default: 'blue')
 */

const STORAGE_KEY = 'engram-accent';
const VALID_ACCENTS = ['blue', 'mauve', 'terracotta'];
const DEFAULT_ACCENT = 'blue';

function applyAccent(name) {
  document.documentElement.dataset.accent = name;
}

function getStoredAccent() {
  return localStorage.getItem(STORAGE_KEY);
}

export function initAccent() {
  const stored = getStoredAccent();
  const accent = VALID_ACCENTS.includes(stored) ? stored : DEFAULT_ACCENT;
  applyAccent(accent);
  return accent;
}

export function setAccent(name) {
  if (!VALID_ACCENTS.includes(name)) {
    return null;
  }
  localStorage.setItem(STORAGE_KEY, name);
  applyAccent(name);
  return name;
}

export function getAccent() {
  return document.documentElement.dataset.accent || DEFAULT_ACCENT;
}
