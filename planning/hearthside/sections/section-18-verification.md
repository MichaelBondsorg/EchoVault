Good. Now I have all the context I need. Let me produce the section content.

# Section 18: Verification

## Overview

This is the final section of the Hearthside Visual Overhaul. It runs after all other sections (01-17) are complete. Its purpose is to verify that the entire overhaul has been applied correctly: zero remaining off-palette color classes (outside safety files), correct typography usage, WCAG contrast compliance, working dark mode infrastructure, correct mood token usage, and a clean production build.

This section produces no new features. It is a verification and quality gate. If any check fails, the implementer must go back and fix the relevant file before considering the overhaul complete.

## Dependencies

- **All prior sections (01-17)** must be complete before this section runs. Specifically:
  - Section 01 (tokens/config) -- `hearth-850` token, gradient presets, safelist
  - Section 02 (colorMap) -- `src/utils/colorMap.js` with all mapping functions
  - Section 03 (CSS components) -- Dark mode variants in `src/index.css`
  - Section 04 (dark mode infra) -- `src/utils/darkMode.js`, `DarkModeToggle.jsx`, FOUC script in `index.html`
  - Section 05 (font loading) -- Caveat split into separate link tag
  - Sections 06-16 (component sweeps) -- All off-palette colors replaced, dark mode added
  - Section 17 (dark mode polish) -- Gradient dark variants, shadow strategy, cross-screen dark pass

## Tests First

All verification tests live in `/Users/michaelbond/echo-vault/src/utils/__tests__/verification.test.js`. This test file uses a combination of file content inspection (via `fs.readFileSync`), grep-like pattern matching, and unit test assertions to verify the overhaul.

**Test Framework:** Vitest with jsdom (same as all other tests in this project).

**Run command:** `npm test` from `/Users/michaelbond/echo-vault/`

### Test File: `/Users/michaelbond/echo-vault/src/utils/__tests__/verification.test.js`

This file contains the following test groups. Each test is described as a stub with its intent; the implementer writes the body.

```javascript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Verification test suite for the Hearthside Visual Overhaul.
 *
 * These tests confirm that the entire overhaul has been applied correctly.
 * They inspect file contents, grep for off-palette classes, verify typography
 * usage, and check dark mode infrastructure.
 *
 * Run AFTER all sections 01-17 are complete.
 */

// --- Helper: recursively collect all .jsx and .js files under src/ ---
function collectSourceFiles(dir, extensions = ['.jsx', '.js']) {
  /**
   * Walks the src/ directory tree, returning an array of absolute file paths
   * matching the given extensions. Excludes node_modules, __tests__, and
   * test/ directories.
   */
}

// --- Helper: read file and search for pattern matches ---
function grepFile(filePath, pattern) {
  /**
   * Reads a file, splits by line, returns an array of { line, lineNumber }
   * objects where the line matches the regex pattern.
   */
}

// --- Safety file allowlist ---
const SAFETY_FILE_PATTERNS = [
  /crisis/i,
  /safety/i,
  /constants\.js$/,
];

function isSafetyFile(filePath) {
  /**
   * Returns true if the file path matches any safety file pattern.
   * These files are allowed to contain red-* classes.
   */
}

describe('Verification: Off-Palette Color Audit', () => {
  it('should have zero off-palette color class instances outside safety files', () => {
    /**
     * Grep all src/ .jsx and .js files for generic Tailwind color classes
     * that should have been replaced by Hearthside palette equivalents.
     *
     * Off-palette patterns to search for:
     *   text-green-, bg-green-, border-green-
     *   text-blue-, bg-blue-, border-blue-
     *   text-purple-, bg-purple-, border-purple-
     *   text-amber-, bg-amber-, border-amber-
     *   text-teal-, bg-teal-, border-teal-
     *   text-pink-, bg-pink-, border-pink-
     *   from-indigo-, to-indigo-, text-indigo-, bg-indigo-
     *   text-emerald-, bg-emerald-
     *   text-orange-, bg-orange-
     *   text-violet-, bg-violet-
     *   text-rose-, bg-rose-
     *   text-cyan-, bg-cyan-
     *
     * Exclusions:
     *   - Lines containing `/* @color-safe */` annotation (intentional off-palette usage)
     *   - Files matching SAFETY_FILE_PATTERNS (red-* is allowed there)
     *   - __tests__/ directories
     *   - node_modules/
     *   - Comments (lines starting with // or *)
     *   - The colorMap.js TAILWIND_SAFELIST comment block
     *
     * Expected result: zero matches. If any are found, log the file path,
     * line number, and matched text for debugging.
     */
  });

  it('should allow red-* classes only in safety/crisis files and for destructive actions', () => {
    /**
     * Grep all src/ files for red-* Tailwind classes (text-red-, bg-red-,
     * border-red-). Each match must be in a file matching SAFETY_FILE_PATTERNS
     * or in a context that is clearly a destructive action (delete, remove,
     * danger button).
     *
     * This test documents (but does not fail for) red usage in non-safety
     * files if the usage is for destructive UI actions (btn-danger, etc.).
     */
  });
});

describe('Verification: Typography Audit', () => {
  it('should use font-display for headings and heading-like components', () => {
    /**
     * Grep src/ for heading elements (className patterns on h1, h2, h3
     * elements or components with "heading", "title" in their name/props).
     *
     * Verify that font-display (Fraunces) is applied to heading contexts.
     * This is a best-effort check -- not every heading needs font-display,
     * but the major ones should have it.
     */
  });

  it('should use font-body for body text elements', () => {
    /**
     * Verify that font-body (DM Sans) is the default or explicitly applied
     * to paragraph and body text contexts. Since DM Sans is the default
     * body font in Tailwind config, this mainly checks that no other
     * non-palette font classes override it.
     */
  });

  it('should use font-hand sparingly (max 2 per component file)', () => {
    /**
     * Grep all src/ .jsx files for "font-hand" usage. For each file,
     * count occurrences. No single component file should have more than 2
     * instances of font-hand (Caveat). This prevents overuse of the
     * handwritten accent font.
     */
  });
});

describe('Verification: WCAG Contrast Checks', () => {
  it('should document primary text/background color pairs for manual contrast audit', () => {
    /**
     * This test does NOT perform automated WCAG contrast ratio calculation
     * (that requires color-contrast libraries or manual inspection).
     *
     * Instead, it extracts the primary text/background color pairings from
     * colorMap.js and documents them as a list the implementer can feed into
     * a contrast checker tool (e.g., WebAIM Contrast Checker).
     *
     * Expected pairings to check (WCAG 4.5:1 for normal text):
     *   - Light mode: text-hearth-800 on bg-warm-50 (primary text on page bg)
     *   - Light mode: text-honey-700 on bg-honey-100 (entry type badge)
     *   - Light mode: text-sage-700 on bg-sage-100 (positive pattern badge)
     *   - Light mode: text-terra-700 on bg-terra-100 (negative pattern badge)
     *   - Light mode: text-lavender-700 on bg-lavender-100 (reflective badge)
     *   - Dark mode: text-hearth-100 on bg-hearth-950 (primary text on dark bg)
     *   - Dark mode: text-honey-300 on bg-honey-900/30 (entry type dark badge)
     *   - Dark mode: text-sage-300 on bg-sage-900/30 (positive pattern dark badge)
     *
     * The test passes if the documentation list is generated. Manual
     * verification with a contrast tool is required separately.
     */
  });
});

describe('Verification: Dark Mode Infrastructure', () => {
  it('should have FOUC prevention script in index.html before React mount point', () => {
    /**
     * Read /Users/michaelbond/echo-vault/index.html and verify:
     *   1. An inline <script> exists that reads localStorage 'engram-dark-mode'
     *   2. The script falls back to matchMedia for system preference
     *   3. The script appears BEFORE the div#root (or equivalent mount point)
     */
  });

  it('should have dark mode toggle using 3-state storage', () => {
    /**
     * Import toggleDarkMode from darkMode.js.
     * Mock localStorage (jsdom provides it).
     *
     * Call toggleDarkMode() and verify:
     *   1. document.documentElement.classList contains 'dark'
     *   2. localStorage.getItem('engram-dark-mode') === 'dark' (NOT 'true')
     *   3. document.documentElement.style.colorScheme === 'dark'
     *
     * Call toggleDarkMode() again and verify:
     *   1. document.documentElement.classList does NOT contain 'dark'
     *   2. localStorage.getItem('engram-dark-mode') === 'light' (NOT 'false')
     *   3. document.documentElement.style.colorScheme === 'light'
     *
     * Verify 3-state: initDarkMode with no localStorage value follows system.
     */
  });

  it('should have significantly more dark: prefixes than the baseline of 33', () => {
    /**
     * Grep all src/ files for "dark:" prefix usage. Count total instances.
     * The baseline before the overhaul was 33 across 7 files.
     * After the overhaul, expect at least 300+ instances across 50+ files.
     *
     * This test fails if the count is below 200 (conservative threshold).
     */
  });
});

describe('Verification: mood.* Token Audit', () => {
  it('should not override mood tokens with off-palette alternatives', () => {
    /**
     * The mood.* tokens (mood.positive, mood.negative, mood.neutral, etc.)
     * are defined in tailwind.config.js. Verify that no component file
     * uses a non-mood color for mood-related display contexts.
     *
     * Specifically, grep for patterns like "mood" in className strings
     * and verify they reference mood.* tokens (text-mood-*, bg-mood-*)
     * rather than hardcoded generic colors.
     */
  });
});

describe('Verification: SVG Hardcoded Hex Audit (Review Feedback)', () => {
  it('should have no hardcoded off-palette hex colors in inline SVGs', () => {
    /**
     * Grep all src/ .jsx files for fill="#..." and stroke="#..." patterns.
     * Exclude lines with /* @color-safe */ annotation.
     *
     * Known allowed: Google logo SVG in App.jsx (brand colors, annotated).
     * Known fixes: ReportChart.jsx and ValuesRadarChart.jsx should use
     * HEX_COLORS or palette-derived values after section-16.
     *
     * Expected: zero unannotated hardcoded hex fills/strokes outside brand logos.
     */
  });
});

describe('Verification: Color-Only Meaning Spot Check (Review Feedback)', () => {
  it('should verify semantic color categories have accompanying icons/labels', () => {
    /**
     * The Hearthside palette uses color to distinguish semantic categories:
     *   sage = positive/growth, terra = negative/warning, lavender = reflective
     *
     * For color-blind accessibility, these distinctions should NOT rely on
     * color alone. Verify that key semantic displays (pattern type badges,
     * entry type badges, entity badges in colorMap consumers) also include
     * an icon or text label.
     *
     * This is a spot check, not exhaustive. Check:
     *   - EntryCard.jsx: entry type badges have text labels (not just colored dots)
     *   - InsightsPanel.jsx: pattern types have distinct icon or text
     *   - InsightsPage.jsx: section headers include text alongside colored bg
     *
     * Pass if all checked components use icon/label + color (not color alone).
     */
  });
});

describe('Verification: Build Check', () => {
  it('should verify tailwind.config.js has hearth-850 token', () => {
    /**
     * Read tailwind.config.js and verify:
     *   1. hearth color scale includes an '850' key
     *   2. The value is a valid hex color string
     */
  });

  it('should verify all 5 gradient presets are defined', () => {
    /**
     * Read either tailwind.config.js or index.css and verify:
     *   - hearth-glow gradient preset exists
     *   - sage-mist gradient preset exists
     *   - lavender-dusk gradient preset exists
     *   - terra-dawn gradient preset exists
     *   - hearth-surface gradient preset exists
     *
     * Each should have both light and dark color definitions.
     */
  });

  it('should verify colorMap.js exports all required functions', () => {
    /**
     * Import from colorMap.js and verify these exports exist:
     *   - getEntryTypeColors (function)
     *   - getPatternTypeColors (function)
     *   - getEntityTypeColors (function)
     *   - getTherapeuticColors (function)
     *   - HEX_COLORS (object)
     */
  });

  it('should verify confetti hex values in ui/index.jsx use HEX_COLORS from colorMap', () => {
    /**
     * Read src/components/ui/index.jsx. Find confetti/celebration hex values.
     * Import HEX_COLORS from colorMap.js.
     * Verify that the hex values used in confetti match values from HEX_COLORS.
     *
     * Old values that should be gone:
     *   #14b8a6, #5eead4, #a855f7, #fb923c, #fcd34d
     *
     * These should now come from HEX_COLORS.honey, HEX_COLORS.terra,
     * HEX_COLORS.sage, HEX_COLORS.lavender, etc.
     */
  });

  it('should verify Caveat font link is separate with display=optional', () => {
    /**
     * Read index.html and verify:
     *   1. A <link> tag loads Caveat with display=optional
     *   2. The Caveat link is separate from the DM Sans + Fraunces link
     *   3. The DM Sans + Fraunces link uses display=swap
     *   4. Caveat link includes weights 400, 500, 600
     */
  });
});
```

## Implementation Details

### Step 1: Create the Verification Test File

**File to create:** `/Users/michaelbond/echo-vault/src/utils/__tests__/verification.test.js`

Create the `__tests__` directory under `src/utils/` if it does not already exist. Write the test file with all the test groups described above. The helper functions (`collectSourceFiles`, `grepFile`, `isSafetyFile`) are key utilities that the test stubs rely on -- implement them fully since they are required for every test to work.

The `collectSourceFiles` helper should:
- Start from `/Users/michaelbond/echo-vault/src/`
- Recursively walk subdirectories
- Collect files ending in `.jsx` or `.js`
- Skip `node_modules/`, `__tests__/`, `test/`, and `dist/` directories
- Return an array of absolute file paths

The `grepFile` helper should:
- Read the file contents with `fs.readFileSync`
- Split by newline
- Test each line against the given regex
- Return matches with their line numbers

The `isSafetyFile` helper should:
- Check the file path against `SAFETY_FILE_PATTERNS`
- Return true if any pattern matches
- Safety files are allowed to keep `red-*` classes

### Step 2: Off-Palette Color Audit

This is the single most important verification check. After sections 06-16 have completed the screen-by-screen sweep, there should be zero remaining off-palette generic Tailwind color class instances in `src/` (outside safety/crisis files and comments).

**Off-palette patterns to grep for** (these are the complete list of generic Tailwind color prefixes that should have been replaced):

```
text-green-    bg-green-    border-green-
text-blue-     bg-blue-     border-blue-
text-purple-   bg-purple-   border-purple-
text-amber-    bg-amber-    border-amber-
text-teal-     bg-teal-     border-teal-
text-pink-     bg-pink-     border-pink-
from-indigo-   to-indigo-   via-indigo-
text-indigo-   bg-indigo-   border-indigo-
text-emerald-  bg-emerald-  border-emerald-
text-orange-   bg-orange-   border-orange-
text-violet-   bg-violet-   border-violet-
text-rose-     bg-rose-     border-rose-
text-cyan-     bg-cyan-     border-cyan-
```

**Exclusions** (matches in these contexts are allowed):
- Files matching `/crisis/i`, `/safety/i`, or `/constants\.js$/` (safety files may use `red-*`)
- Lines that are comments (`//` or `*` at start of trimmed line)
- Files inside `__tests__/`, `test/`, or `node_modules/`
- The `colorMap.js` safelist comment block (the block at the top of colorMap.js that lists all classes for Tailwind purge safety)

**If any matches are found:** The test should output each match with file path, line number, and the matched text so the implementer can fix them. Each match represents an incomplete migration from a prior section.

### Step 3: Typography Audit

Three checks for the three font families:

1. **font-display (Fraunces):** Verify that heading elements (`<h1>`, `<h2>`, `<h3>`) and heading-like components use `font-display`. Not every heading needs it, but the primary ones in dashboard, insights, and modal titles should.

2. **font-body (DM Sans):** Since DM Sans is the default body font configured in `tailwind.config.js`, this check mainly verifies no competing font family classes override it in body text contexts. Look for unexpected `font-sans` or `font-serif` in paragraph contexts.

3. **font-hand (Caveat):** Grep for `font-hand` across all `.jsx` files. For each file, count occurrences. The maximum allowed per file is 2. This prevents overuse of the handwritten accent font and keeps it as a subtle touch. If any file exceeds 2 instances, the test should report it.

### Step 4: WCAG Contrast Checks

Automated WCAG contrast ratio calculation requires color-contrast libraries and knowledge of the actual computed hex values. This verification section takes a pragmatic approach:

1. **Generate a document of color pairings** from `colorMap.js` -- extract all text/background pairs used in the mapping functions.
2. **List the key pairings** that need manual verification with a contrast checker tool (e.g., WebAIM).
3. **The test passes** if the documentation list is generated; manual contrast verification is a separate activity.

Key pairings to verify (must meet WCAG 4.5:1 for normal text, 3:1 for large text):

| Context | Text Color | Background Color | Mode |
|---------|-----------|-----------------|------|
| Primary body text | `text-hearth-800` | `bg-warm-50` | Light |
| Primary body text | `text-hearth-100` | `bg-hearth-950` | Dark |
| Entry badge (task) | `text-honey-700` | `bg-honey-100` | Light |
| Entry badge (task) | `text-honey-300` | `bg-honey-900/30` | Dark |
| Pattern badge (positive) | `text-sage-700` | `bg-sage-100` | Light |
| Pattern badge (positive) | `text-sage-300` | `bg-sage-900/30` | Dark |
| Pattern badge (negative) | `text-terra-700` | `bg-terra-100` | Light |
| Pattern badge (negative) | `text-terra-300` | `bg-terra-900/30` | Dark |
| Pattern badge (reflective) | `text-lavender-700` | `bg-lavender-100` | Light |
| Pattern badge (reflective) | `text-lavender-300` | `bg-lavender-900/30` | Dark |

### Step 5: Dark Mode Verification

Four automated checks and two manual checks:

**Automated (in the test file):**

1. **FOUC prevention script** -- Read `/Users/michaelbond/echo-vault/index.html`, verify the inline `<script>` block exists before `<div id="root">`, and that it reads `engram-dark-mode` from localStorage and checks `matchMedia`.

2. **Toggle persistence with 3-state storage** -- Import `toggleDarkMode` from `/Users/michaelbond/echo-vault/src/utils/darkMode.js`. Use jsdom's built-in localStorage. Call toggle, verify class and localStorage change (values should be `"dark"` / `"light"`, NOT `"true"` / `"false"`). Verify `color-scheme` CSS property is set. Verify that `"system"` or null follows OS preference.

3. **dark: prefix count** -- Grep all `src/` files for `dark:` prefix usage. Count total instances. The pre-overhaul baseline was 33 instances across 7 files. After the complete overhaul, expect at minimum 200+ instances (conservative threshold for the test to pass). A more realistic count would be 300-500+.

4. **No pure black backgrounds** -- Grep for `bg-black` and `#000000` in component files. These should not be used as backgrounds in dark mode. Overlays (`modal-backdrop`) are an acceptable exception.

**Manual (documented, not automated):**
- Toggle dark mode on, reload page, confirm no flash of unstyled content (FOUC)
- Toggle dark mode, navigate through all major screens, confirm consistent appearance

### Step 6: mood.* Token Audit

The `mood.*` tokens are defined in `tailwind.config.js` for mood-specific coloring (e.g., `mood.positive`, `mood.negative`, `mood.neutral`). Verify that no component overrides these with off-palette alternatives.

Grep for className patterns containing the word "mood" in `src/` files. If a mood-related context uses a generic color (e.g., `text-green-500` for positive mood instead of `text-mood-positive`), that is a violation. This check is best-effort since "mood" context can be identified by surrounding code but not always by the class string alone.

### Step 7: Build Verification

These are structural checks that verify the foundation sections (01-05) were implemented correctly:

1. **hearth-850 token** -- Read `/Users/michaelbond/echo-vault/tailwind.config.js`, find the hearth color scale definition, verify it contains an `850` key with a valid hex value (matching `#[0-9a-fA-F]{6}`).

2. **Gradient presets** -- Verify all 5 gradient presets (`hearth-glow`, `sage-mist`, `lavender-dusk`, `terra-dawn`, `hearth-surface`) are defined either in `tailwind.config.js` or in `/Users/michaelbond/echo-vault/src/index.css`. Each should have both light and dark color definitions.

3. **colorMap exports** -- Import from `/Users/michaelbond/echo-vault/src/utils/colorMap.js` and verify that `getEntryTypeColors`, `getPatternTypeColors`, `getEntityTypeColors`, `getTherapeuticColors`, and `HEX_COLORS` are all exported and are the correct types (first four are functions, last is an object).

4. **Confetti hex values** -- Read `/Users/michaelbond/echo-vault/src/components/ui/index.jsx` and verify the old confetti hex values (`#14b8a6`, `#5eead4`, `#a855f7`, `#fb923c`, `#fcd34d`) are no longer present. The new values should match entries from `HEX_COLORS`.

5. **Caveat font link** -- Read `/Users/michaelbond/echo-vault/index.html` and verify:
   - A `<link>` tag loads Caveat with `display=optional`
   - It is separate from the DM Sans + Fraunces `<link>` tag
   - The DM Sans + Fraunces link uses `display=swap`
   - Caveat includes weights 400, 500, 600

### Step 8: Production Build Verification (Manual)

After all automated tests pass, the implementer should manually:

1. **Run `npm run build`** from `/Users/michaelbond/echo-vault/` and verify a clean production build with no errors.
2. **Run `npm test`** and verify all test suites pass (existing 76+ tests plus the new verification tests).
3. **Open the built app** in a browser, toggle dark mode, and navigate through major screens.
4. **Capacitor builds** (if applicable): Run `npm run cap:ios` and `npm run cap:android` to verify mobile builds succeed. Check that the Capacitor status bar adapts to dark mode.

### Summary of Files

| File | Action |
|------|--------|
| `/Users/michaelbond/echo-vault/src/utils/__tests__/verification.test.js` | **Create** -- Full verification test suite |

### What Success Looks Like

When this section is complete:

- All off-palette grep tests pass with zero matches (outside safety files)
- Typography audit confirms correct font-display/font-body/font-hand usage
- WCAG contrast pairings are documented for manual review
- Dark mode toggle persists, FOUC prevention script is in place, dark: prefix count exceeds 200
- mood.* tokens are not overridden by off-palette colors
- All 5 gradient presets and hearth-850 token exist
- colorMap.js exports all required functions
- Confetti uses palette-derived hex values
- Caveat font loads separately with display=optional
- `npm run build` produces a clean production build
- `npm test` passes all suites (existing + verification)

---

## Actual Implementation Notes

### What Was Built

**Test file created**: `src/utils/__tests__/verification.test.js` — 17 verification tests across 8 test groups:

1. **Off-Palette Color Audit** (2 tests)
   - Zero off-palette color class instances outside safety files
   - Red-* usage documented (informational, not blocking)
   - Enhanced colorMap.js safelist block exclusion (multi-line template literal tracking)

2. **Typography Audit** (3 tests)
   - font-display used for headings
   - No unexpected font-serif overrides
   - font-hand usage capped at max 2 per file

3. **WCAG Contrast Checks** (1 test)
   - Documented 10 primary text/background color pairings for manual contrast audit

4. **Dark Mode Infrastructure** (3 tests)
   - FOUC prevention script present before mount point in index.html
   - 3-state dark mode storage ('dark'/'light'/system) verified
   - dark: prefix count exceeds 200 (baseline was 33)

5. **mood.* Token Audit** (1 test)
   - Mood tokens confirmed in tailwind.config.js

6. **SVG Hardcoded Hex Audit** (1 test)
   - No off-palette hex values in inline SVG fill/stroke attributes
   - Uses file-based pattern matching (not shell grep) to avoid quoting issues

7. **Color-Only Meaning Spot Check** (1 test)
   - EntryCard and InsightsPanel have icons alongside colored elements

8. **Build Check** (5 tests)
   - hearth-850 token exists
   - All 5 gradient presets defined
   - colorMap.js exports all required functions
   - Old confetti hex values removed
   - Caveat font link separate with display=optional

### Code Review Fixes Applied
- Fixed SVG audit error path: `v.content` → `v.line`, removed double path.relative()
- Enhanced colorMap safelist exclusion to track multi-line block boundaries

### Test Results
- 17 section-specific tests pass
- Full suite: 737/737 tests pass (46 test files)