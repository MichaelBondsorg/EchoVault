import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// We'll dynamically import the module to get fresh state each test
let darkMode;

describe('darkMode utility', () => {
  beforeEach(async () => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    vi.clearAllMocks();
    // Fresh import each test to reset module state
    vi.resetModules();
    darkMode = await import('../darkMode.js');
  });

  afterEach(() => {
    if (darkMode?.cleanupDarkMode) {
      darkMode.cleanupDarkMode();
    }
  });

  describe('initDarkMode', () => {
    it('applies dark class when localStorage has engram-dark-mode = dark', () => {
      localStorage.getItem.mockReturnValue('dark');
      darkMode.initDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('sets color-scheme to dark when dark mode is active', () => {
      localStorage.getItem.mockReturnValue('dark');
      darkMode.initDarkMode();
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('applies dark class when no localStorage and matchMedia prefers dark', () => {
      localStorage.getItem.mockReturnValue(null);
      window.matchMedia.mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      darkMode.initDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('does NOT apply dark class when localStorage has engram-dark-mode = light', () => {
      localStorage.getItem.mockReturnValue('light');
      darkMode.initDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('does NOT apply dark class when no localStorage and matchMedia prefers light', () => {
      localStorage.getItem.mockReturnValue(null);
      window.matchMedia.mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      darkMode.initDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('sets color-scheme to light when light mode is active', () => {
      localStorage.getItem.mockReturnValue('light');
      darkMode.initDarkMode();
      expect(document.documentElement.style.colorScheme).toBe('light');
    });

    it('registers a listener for system preference changes', () => {
      const mockAddEventListener = vi.fn();
      localStorage.getItem.mockReturnValue(null);
      window.matchMedia.mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: mockAddEventListener,
        removeEventListener: vi.fn(),
      });
      darkMode.initDarkMode();
      expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('toggleDarkMode', () => {
    it('adds dark class and sets localStorage to dark when currently light', () => {
      localStorage.getItem.mockReturnValue('light');
      darkMode.initDarkMode();
      const result = darkMode.toggleDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalledWith('engram-dark-mode', 'dark');
      expect(result).toBe(true);
    });

    it('removes dark class and sets localStorage to light when currently dark', () => {
      localStorage.getItem.mockReturnValue('dark');
      darkMode.initDarkMode();
      const result = darkMode.toggleDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.setItem).toHaveBeenCalledWith('engram-dark-mode', 'light');
      expect(result).toBe(false);
    });

    it('accepts explicit mode argument', () => {
      darkMode.toggleDarkMode('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalledWith('engram-dark-mode', 'dark');
    });

    it('handles system mode by following matchMedia', () => {
      window.matchMedia.mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      darkMode.toggleDarkMode('system');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalledWith('engram-dark-mode', 'system');
    });
  });

  describe('isDarkMode', () => {
    it('returns true when document.documentElement has dark class', () => {
      document.documentElement.classList.add('dark');
      expect(darkMode.isDarkMode()).toBe(true);
    });

    it('returns false when document.documentElement lacks dark class', () => {
      document.documentElement.classList.remove('dark');
      expect(darkMode.isDarkMode()).toBe(false);
    });
  });

  describe('system preference listener', () => {
    it('updates dark class when system preference changes and mode is system', () => {
      let changeHandler;
      const mockAddEventListener = vi.fn((event, handler) => {
        changeHandler = handler;
      });
      localStorage.getItem.mockReturnValue('system');
      window.matchMedia.mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: mockAddEventListener,
        removeEventListener: vi.fn(),
      });
      darkMode.initDarkMode();
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      // Simulate system change to dark
      changeHandler({ matches: true });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('does NOT update dark class when user has a manual override', () => {
      let changeHandler;
      const mockAddEventListener = vi.fn((event, handler) => {
        changeHandler = handler;
      });
      localStorage.getItem.mockReturnValue('light');
      window.matchMedia.mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: mockAddEventListener,
        removeEventListener: vi.fn(),
      });
      darkMode.initDarkMode();

      // Simulate system change to dark - should be ignored
      changeHandler({ matches: true });
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('cleanupDarkMode', () => {
    it('removes the matchMedia event listener', () => {
      const mockRemoveEventListener = vi.fn();
      localStorage.getItem.mockReturnValue(null);
      window.matchMedia.mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: mockRemoveEventListener,
      });
      darkMode.initDarkMode();
      darkMode.cleanupDarkMode();
      expect(mockRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });
});

describe('FOUC prevention script in index.html', () => {
  const htmlPath = path.resolve(__dirname, '../../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  it('contains an inline script before the root div', () => {
    const scriptIndex = html.indexOf('<script>');
    const rootIndex = html.indexOf('<div id="root">');
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(rootIndex);
  });

  it('references engram-dark-mode localStorage key', () => {
    expect(html).toMatch(/engram-dark-mode/);
  });

  it('references matchMedia for prefers-color-scheme', () => {
    expect(html).toMatch(/prefers-color-scheme.*dark/);
  });

  it('adds dark class to documentElement', () => {
    expect(html).toMatch(/classList\.add.*dark/);
  });
});
