Now I have all the context I need. Let me produce the section content.

# Section 04: Dark Mode Infrastructure

## Overview

This section covers creating the dark mode infrastructure for the Engram app. It includes three deliverables:

1. **`src/utils/darkMode.js`** -- A utility module with toggle, initialization, and system preference detection logic
2. **`src/components/ui/DarkModeToggle.jsx`** -- A sun/moon icon toggle React component
3. **FOUC prevention inline script in `index.html`** -- A synchronous script that applies the `dark` class before React renders

This section can be implemented in parallel with sections 02 (colorMap), 03 (CSS components), and 05 (font loading), as long as section 01 (tokens/config) is complete first. All subsequent screen-sweep sections (06-18) depend on this section being finished.

## Dependencies

- **Section 01 (tokens-config)** must be complete. Specifically, `tailwind.config.js` must already have `darkMode: 'class'` set (it does) and the `hearth-850` token added (section 01 handles this).
- Lucide React icons are already installed in the project (used for Sun/Moon icons).
- Framer Motion is already installed (used for the toggle animation).
- The test setup in `/Users/michaelbond/echo-vault/src/test/setup.js` already mocks `window.matchMedia` and `localStorage`, which both are needed for the dark mode tests.

## Current State

The codebase has `darkMode: 'class'` configured in `tailwind.config.js` and some dark mode CSS already exists in `index.html` (body background/color) and `src/index.css` (focus rings, selection colors, scrollbar). However, there is no JavaScript toggle logic, no toggle UI component, and no FOUC prevention script. The `src/utils/` directory does not exist yet and must be created. Only 33 `dark:` prefixes exist across 7 files in the entire `src/` directory.

The localStorage key for dark mode preference is `engram-dark-mode`. This key name is used consistently throughout this section and in the FOUC prevention script.

---

## Tests First

All dark mode tests go in `/Users/michaelbond/echo-vault/src/utils/__tests__/darkMode.test.js`. Create the `src/utils/` and `src/utils/__tests__/` directories.

The test setup at `/Users/michaelbond/echo-vault/src/test/setup.js` already provides mocked `window.matchMedia` and `window.localStorage`. The `matchMedia` mock defaults to `matches: false` and supports `addEventListener`/`removeEventListener`. The `localStorage` mock exposes `getItem`, `setItem`, `removeItem`, and `clear` as `vi.fn()` instances that are cleared in `beforeEach`.

### Test file: `/Users/michaelbond/echo-vault/src/utils/__tests__/darkMode.test.js`

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDarkMode, toggleDarkMode, isDarkMode, cleanupDarkMode } from '../darkMode';

describe('darkMode utility', () => {
  beforeEach(() => {
    // Reset HTML element class list before each test
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    cleanupDarkMode();
  });

  describe('initDarkMode', () => {
    it('applies dark class when localStorage has engram-dark-mode = true', () => {
      // Arrange: localStorage returns 'true'
      // Act: call initDarkMode()
      // Assert: document.documentElement.classList.contains('dark') === true
    });

    it('applies dark class when no localStorage and matchMedia prefers dark', () => {
      // Arrange: localStorage returns null, matchMedia('(prefers-color-scheme: dark)').matches = true
      // Act: call initDarkMode()
      // Assert: document.documentElement.classList.contains('dark') === true
    });

    it('does NOT apply dark class when localStorage has engram-dark-mode = false', () => {
      // Arrange: localStorage returns 'false'
      // Act: call initDarkMode()
      // Assert: document.documentElement.classList.contains('dark') === false
    });

    it('does NOT apply dark class when no localStorage and matchMedia prefers light', () => {
      // Arrange: localStorage returns null, matchMedia matches = false (default mock)
      // Act: call initDarkMode()
      // Assert: document.documentElement.classList.contains('dark') === false
    });

    it('registers a listener for system preference changes via matchMedia.addEventListener', () => {
      // Arrange: call initDarkMode()
      // Assert: matchMedia was called, addEventListener was called with 'change'
    });
  });

  describe('toggleDarkMode', () => {
    it('adds dark class and sets localStorage to true when currently light', () => {
      // Arrange: classList does not contain 'dark'
      // Act: toggleDarkMode()
      // Assert: classList.contains('dark') === true
      // Assert: localStorage.setItem called with ('engram-dark-mode', 'true')
    });

    it('removes dark class and sets localStorage to false when currently dark', () => {
      // Arrange: classList contains 'dark'
      // Act: toggleDarkMode()
      // Assert: classList.contains('dark') === false
      // Assert: localStorage.setItem called with ('engram-dark-mode', 'false')
    });

    it('returns the new dark mode state as a boolean', () => {
      // Act: result = toggleDarkMode()
      // Assert: result === true (toggled from light to dark)
    });
  });

  describe('isDarkMode', () => {
    it('returns true when document.documentElement has dark class', () => {
      document.documentElement.classList.add('dark');
      expect(isDarkMode()).toBe(true);
    });

    it('returns false when document.documentElement lacks dark class', () => {
      document.documentElement.classList.remove('dark');
      expect(isDarkMode()).toBe(false);
    });
  });

  describe('system preference listener', () => {
    it('updates dark class when system preference changes and no manual override', () => {
      // Arrange: localStorage returns null (no manual override)
      // Act: initDarkMode(), then simulate matchMedia 'change' event with matches: true
      // Assert: dark class is added
    });

    it('does NOT update dark class when user has a manual override in localStorage', () => {
      // Arrange: localStorage returns 'false' (user chose light)
      // Act: initDarkMode(), then simulate matchMedia 'change' event with matches: true
      // Assert: dark class remains absent (manual override wins)
    });
  });

  describe('cleanupDarkMode', () => {
    it('removes the matchMedia event listener', () => {
      // Arrange: call initDarkMode()
      // Act: call cleanupDarkMode()
      // Assert: removeEventListener was called on the matchMedia object
    });
  });
});
```

### FOUC prevention verification tests (file content checks)

These can be added to the same test file or a separate verification script. They verify the inline script is present in `index.html`.

```javascript
describe('FOUC prevention script in index.html', () => {
  it('contains an inline script before the root div', () => {
    // Read index.html content
    // Assert: <script> tag appears before <div id="root">
    // Assert: script references 'engram-dark-mode' localStorage key
    // Assert: script references matchMedia('(prefers-color-scheme: dark)')
    // Assert: script adds 'dark' class to document.documentElement
  });
});
```

These are structural verification tests -- they can be implemented as file-read tests using Node's `fs` module or as grep-based checks in CI.

---

## Implementation Details

### 1. Create `src/utils/darkMode.js`

**File path:** `/Users/michaelbond/echo-vault/src/utils/darkMode.js`

This module must be created in the new `src/utils/` directory. It exports four functions:

**`initDarkMode()`**
- Reads `localStorage.getItem('engram-dark-mode')`
- **3-state storage**: The value is one of `"dark"`, `"light"`, or `"system"` (or `null` for first-time users, treated as `"system"`)
- If `"dark"`: add `'dark'` to `document.documentElement.classList`
- If `"light"`: ensure `'dark'` is NOT on the classList
- If `"system"` or `null`: check `window.matchMedia('(prefers-color-scheme: dark)').matches` and apply accordingly
- **Set `color-scheme` CSS property**: After determining the mode, set `document.documentElement.style.colorScheme` to `'dark'` or `'light'`. This ensures native form controls, scrollbars, and Capacitor system UI elements match the theme.
- **Capacitor StatusBar integration**: If running on a native platform (detect via `window.Capacitor`), call `StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light })` to update the iOS/Android status bar. Import conditionally to avoid web build issues.
- Register a `'change'` event listener on the `matchMedia` result to detect real-time system preference changes. When the system preference changes, only apply the change if the user's preference is `"system"` or `null` (no manual override). Store a reference to the listener and matchMedia query for cleanup.

**`toggleDarkMode()`**
- Cycle or toggle the dark mode state. When called without args, toggle between `"dark"` and `"light"` (explicit user choice). Optionally accept a mode argument (`"dark"`, `"light"`, `"system"`) for settings UI.
- Persist the new state to `localStorage.setItem('engram-dark-mode', mode)`
- Apply the `'dark'` class and `color-scheme` property based on the new state
- **Update Capacitor StatusBar** if on native platform
- Return the new effective dark mode state as a boolean

**`isDarkMode()`**
- Return `document.documentElement.classList.contains('dark')`

**`cleanupDarkMode()`**
- Remove the matchMedia event listener registered by `initDarkMode()`
- Used for cleanup on app unmount or in tests

The module should maintain internal references (module-scoped variables, not exported) to the matchMedia query and the listener function so that `cleanupDarkMode()` can properly remove them.

### 2. Add FOUC Prevention Script to `index.html`

**File path:** `/Users/michaelbond/echo-vault/index.html`

Insert an inline `<script>` tag in the `<body>`, BEFORE the `<div id="root">`. This script runs synchronously before React mounts and prevents the "flash of unstyled content" (white flash before dark mode kicks in).

The script should be placed between the closing `</head>` opening `<body>` content and the `<div id="root">` element. Here is the exact placement:

```html
<body>
  <script>
    (function() {
      var d = localStorage.getItem('engram-dark-mode');
      var isDark = d === 'dark' || (d !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.style.colorScheme = 'dark';
      } else {
        document.documentElement.style.colorScheme = 'light';
      }
    })();
  </script>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
```

Key properties of this script:
- It is an IIFE (immediately invoked function expression) so no global variable pollution
- It reads the same `'engram-dark-mode'` localStorage key used by `darkMode.js`
- It falls back to `matchMedia` when no localStorage value exists
- It only adds the class (never removes it) because the default state is light
- It must be a regular `<script>` (not `type="module"`) so it executes synchronously and blocks rendering

The existing `index.html` already has dark mode body styles defined under `html.dark body` in the `<style>` block, and the meta theme-color tags already have both light and dark media queries. No changes are needed to those existing elements.

### 3. Create `DarkModeToggle.jsx` Component

**File path:** `/Users/michaelbond/echo-vault/src/components/ui/DarkModeToggle.jsx`

A React component that renders a sun/moon icon toggle button.

**Imports needed:**
- `React`, `useState`, `useEffect` from `'react'`
- `Sun`, `Moon` from `'lucide-react'` (already installed in the project)
- `motion` from `'framer-motion'` (already installed)
- `isDarkMode`, `toggleDarkMode`, `initDarkMode`, `cleanupDarkMode` from `'../../utils/darkMode'`

**Component behavior:**
- On mount, call `initDarkMode()` and set local state to `isDarkMode()`
- On unmount, call `cleanupDarkMode()`
- Render a button that, when clicked, calls `toggleDarkMode()` and updates local state
- Show `Moon` icon when in light mode (clicking will switch to dark)
- Show `Sun` icon when in dark mode (clicking will switch to light)
- Wrap the icon in a Framer Motion `motion.div` with a rotation + scale animation on icon change (e.g., `animate={{ rotate: 360, scale: 1 }}` on key change)
- Apply accessible attributes: `aria-pressed={isDark}` (toggle button pattern), `aria-label="Toggle dark mode"`, and a visually hidden `<span className="sr-only">` with current state text. Must be keyboard focusable and show the custom Hearthside focus ring.

**Styling:**
- Use Tailwind classes for the button: rounded, padding, hover state using palette colors
- The button should fit naturally in a header/nav bar context
- Example classes: `p-2 rounded-xl text-hearth-600 dark:text-hearth-300 hover:bg-hearth-100 dark:hover:bg-hearth-800 transition-colors`

**Signature:**

```jsx
export default function DarkModeToggle({ className }) {
  /**
   * Renders a sun/moon toggle button for dark mode.
   * Initializes dark mode on mount (reads localStorage + system preference).
   * Animated icon transition via Framer Motion.
   *
   * @param {string} className - Additional CSS classes to apply to the wrapper
   */
}
```

### 4. Integration Point (Reference Only)

The `DarkModeToggle` component should be placed in the app header or settings area. This is a simple import and placement task that the implementer handles when integrating. The component is self-contained -- it manages its own state and dark mode initialization. No props are required beyond an optional `className`.

Common placement: near the hamburger menu in the app header, or in a settings/preferences panel. The exact placement depends on the app layout component. Look at the main layout component (referenced in `CLAUDE.md` as `src/components/zen/AppLayout.jsx`) for the right insertion point.

---

## Files Created or Modified (Actual)

| Action | File Path | Notes |
|--------|-----------|-------|
| Created | `src/utils/darkMode.js` | 4 exports: initDarkMode, toggleDarkMode, isDarkMode, cleanupDarkMode. Includes Capacitor StatusBar integration and double-init guard. |
| Created | `src/utils/__tests__/darkMode.test.js` | 20 tests: init, toggle, isDarkMode, system preference listener, cleanup, FOUC verification |
| Created | `src/components/ui/DarkModeToggle.jsx` | Sun/Moon animated toggle with Framer Motion, focus-visible ring, aria-pressed |
| Modified | `index.html` | Added FOUC prevention inline script before `<div id="root">` |

### Deviations from Plan
- **Added double-init guard** (review fix): `initDarkMode()` calls `cleanupDarkMode()` first to prevent event listener leaks on repeated calls
- **Added mode validation** (review fix): `toggleDarkMode()` validates mode against `['dark', 'light', 'system']`, defaults to `'system'` for invalid values
- **Added Capacitor StatusBar** (user-approved): Async `updateStatusBar()` with conditional `window.Capacitor` check and dynamic import
- **Added focus-visible ring** (review fix): `focus-visible:ring-2 focus-visible:ring-honey-500` on DarkModeToggle
- **Skipped reduced-motion**: Framer Motion animations don't use `useReducedMotion()` yet — can add in polish pass

### Test Results
- 20 tests, all passing

---

## Key Design Decisions

1. **localStorage key is `engram-dark-mode`** -- This must be consistent between the FOUC prevention inline script, the `darkMode.js` utility, and any future references. Do not use a different key name.

2. **3-state storage: `"system" | "dark" | "light"`** -- The localStorage value is NOT a boolean. `"system"` (or `null` for first-time users) means follow the OS preference. `"dark"` and `"light"` are explicit user overrides. The system preference listener only auto-applies when the stored value is `"system"` or absent. This prevents the bug where a user explicitly chooses light mode but the system preference flips them to dark.

3. **The FOUC script and darkMode.js are intentionally separate** -- The inline script in `index.html` runs before any JS bundles load and handles the initial class application. `darkMode.js` runs within the React app lifecycle and handles toggle interactions and the system preference listener. They both read the same localStorage key. There is no import relationship between them.

4. **`cleanupDarkMode()` exists for testability** -- In production the app never unmounts, but tests need to clean up the matchMedia listener between test cases. The `DarkModeToggle` component should also call it on unmount as good practice.

5. **Icon semantics** -- Show `Moon` icon when currently in light mode (the icon represents what you will switch TO). Show `Sun` icon when currently in dark mode. This follows the convention used by most apps (GitHub, VS Code, etc.).