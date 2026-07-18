import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll dynamically import the module to get fresh state each test
let accent;

const STORAGE_KEY = 'engram-accent';

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
});
