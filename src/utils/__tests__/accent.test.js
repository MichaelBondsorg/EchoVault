import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ownerStorageKey } from '../../services/storage/ownerScopedStorage';

// We'll dynamically import the module to get fresh state each test
let accent;

const STORAGE_KEY = 'engram-accent';
const UID = 'user-123';
const OWNER_KEY = ownerStorageKey(UID, 'appearance/accent');

describe('accent utility', () => {
  beforeEach(async () => {
    document.documentElement.removeAttribute('data-accent');
    vi.clearAllMocks();
    // Fresh import each test to reset module state
    vi.resetModules();
    accent = await import('../accent.js');
  });

  describe('initAccent', () => {
    it('defaults to blue when localStorage has no engram-accent value', () => {
      localStorage.getItem.mockReturnValue(null);
      accent.initAccent();
      expect(document.documentElement.dataset.accent).toBe('blue');
    });

    it('applies the stored accent from localStorage', () => {
      localStorage.getItem.mockReturnValue('mauve');
      accent.initAccent();
      expect(document.documentElement.dataset.accent).toBe('mauve');
    });

    it('applies terracotta from localStorage', () => {
      localStorage.getItem.mockReturnValue('terracotta');
      accent.initAccent();
      expect(document.documentElement.dataset.accent).toBe('terracotta');
    });

    it('falls back to blue when localStorage has an invalid/unknown value', () => {
      localStorage.getItem.mockReturnValue('not-a-real-accent');
      accent.initAccent();
      expect(document.documentElement.dataset.accent).toBe('blue');
    });

    it('reads from the engram-accent storage key', () => {
      localStorage.getItem.mockReturnValue('blue');
      accent.initAccent();
      expect(localStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
  });

  describe('setAccent', () => {
    it('persists and applies a valid accent name', () => {
      accent.setAccent('mauve');
      expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'mauve');
      expect(document.documentElement.dataset.accent).toBe('mauve');
    });

    it('applies terracotta', () => {
      accent.setAccent('terracotta');
      expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'terracotta');
      expect(document.documentElement.dataset.accent).toBe('terracotta');
    });

    it('rejects an invalid accent name and does not persist or apply it', () => {
      document.documentElement.dataset.accent = 'blue';
      accent.setAccent('neon-green');
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(document.documentElement.dataset.accent).toBe('blue');
    });

    it('returns the applied accent name on success', () => {
      const result = accent.setAccent('blue');
      expect(result).toBe('blue');
    });

    it('returns null when rejecting an invalid name', () => {
      const result = accent.setAccent('invalid');
      expect(result).toBeNull();
    });
  });

  describe('getAccent', () => {
    it('returns the current data-accent attribute value', () => {
      document.documentElement.dataset.accent = 'terracotta';
      expect(accent.getAccent()).toBe('terracotta');
    });

    it('returns the default blue when no attribute is set', () => {
      document.documentElement.removeAttribute('data-accent');
      expect(accent.getAccent()).toBe('blue');
    });
  });

  // C6 consolidation: SettingsPage used to keep its own owner-scoped
  // accent read/write (ownerStorageKey(uid, 'appearance/accent') +
  // 'engram-accent' fallback) that bypassed this module. That logic now
  // lives here as the single implementation — SettingsPage calls only
  // initAccent(uid)/setAccent(name, uid).
  describe('owner-scoped accent (uid)', () => {
    it('initAccent(uid) prefers the owner-scoped key over the global key', () => {
      localStorage.getItem.mockImplementation((key) => {
        if (key === OWNER_KEY) return 'terracotta';
        if (key === STORAGE_KEY) return 'blue';
        return null;
      });
      const result = accent.initAccent(UID);
      expect(result).toBe('terracotta');
      expect(document.documentElement.dataset.accent).toBe('terracotta');
    });

    it('initAccent(uid) falls back to the global key when no owner-scoped value is stored', () => {
      localStorage.getItem.mockImplementation((key) => {
        if (key === OWNER_KEY) return null;
        if (key === STORAGE_KEY) return 'mauve';
        return null;
      });
      const result = accent.initAccent(UID);
      expect(result).toBe('mauve');
      expect(document.documentElement.dataset.accent).toBe('mauve');
    });

    it('initAccent(uid) falls back to the default when neither key has a valid value', () => {
      localStorage.getItem.mockReturnValue(null);
      const result = accent.initAccent(UID);
      expect(result).toBe('blue');
    });

    it('initAccent() with no uid behaves exactly as before (global key only)', () => {
      localStorage.getItem.mockReturnValue('mauve');
      accent.initAccent();
      expect(document.documentElement.dataset.accent).toBe('mauve');
      // Never even attempts to resolve an owner-scoped key without a uid.
      expect(localStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('setAccent(name, uid) writes both the global key and the owner-scoped key', () => {
      accent.setAccent('terracotta', UID);
      expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'terracotta');
      expect(localStorage.setItem).toHaveBeenCalledWith(OWNER_KEY, 'terracotta');
      expect(document.documentElement.dataset.accent).toBe('terracotta');
    });

    it('setAccent(name) with no uid writes only the global key', () => {
      accent.setAccent('mauve');
      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'mauve');
    });

    it('setAccent(invalid, uid) writes neither key and returns null', () => {
      const result = accent.setAccent('neon-green', UID);
      expect(result).toBeNull();
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('gracefully ignores an empty-string uid (falls back to global-key-only behavior)', () => {
      localStorage.getItem.mockReturnValue('blue');
      expect(() => accent.initAccent('')).not.toThrow();
      expect(() => accent.setAccent('blue', '')).not.toThrow();
      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'blue');
    });
  });
});
