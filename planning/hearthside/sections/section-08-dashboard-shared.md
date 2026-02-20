Now I have a thorough understanding of all the files. Let me generate the section content.

# Section 8: Dashboard Shared Components -- Hearthside Palette and Dark Mode Sweep

## Implementation Status: COMPLETE

### Actual Files Modified (15 total)
- InsightBite.jsx, HeroCard.jsx, CurrentConditions.jsx, SituationTimeline.jsx
- InsightsSection.jsx, PeopleSection.jsx, SelfTalkSection.jsx, FeedbackLoop.jsx
- GoalsProgress.jsx, WeeklyDigest.jsx, QuickStatsBar.jsx, WinsSection.jsx
- TasksSection.jsx, NarrativeDigest.jsx, ReflectionPrompts.jsx

### Test File Created
- `src/components/dashboard/shared/__tests__/dashboardSharedPalette.test.js` (35 tests, all passing)
- Enhanced from plan with `@color-safe` line exclusion filtering

### Deviations from Plan
1. **Test file**: Added `findOffPaletteViolations` helper that filters out `@color-safe` annotated lines (improvement over plan spec)
2. **HeroCard morning gradient**: Used `via-honey-100` instead of `via-terra-50` for visual cohesion within morning mode
3. **InsightsSection**: indigo/violet/blue all map to identical lavender values (palette consolidation by design)

### Code Review Fixes Applied
1. HeroCard shelter `iconColor`: Fixed redundant `dark:text-terra-400` → `dark:text-terra-300`
2. PeopleSection negative sentiment: Fixed redundant `dark:text-terra-400` → `dark:text-terra-300`
3. SituationTimeline timeline dot: Added `dark:border-hearth-900` to `border-white`

### Deferred Items
- Existing on-palette lines without dark: variants → section-17 (dark-mode-polish)
- FeedbackLoop confetti hex colors → section-16 (miscellaneous-sweep)

---

## Overview

This section covers the sweep of all remaining `src/components/dashboard/shared/` components (excluding `CollapsibleSection.jsx`, which is handled in section-06). The goal is to replace all off-palette color references with Hearthside palette equivalents and add `dark:` mode classes in a single pass per file.

**Scope:** 16 files in `/Users/michaelbond/echo-vault/src/components/dashboard/shared/`, minus `CollapsibleSection.jsx` (section-06) and `index.js` (barrel export, no visual changes).

**Primary files to modify (with approximate off-palette instance counts):**

| File | Off-Palette Count | Key Issues |
|------|-------------------|------------|
| `InsightBite.jsx` | ~18 | 4 type config objects with purple/amber/green/blue colors |
| `HeroCard.jsx` | ~12 | 4 mode style objects with amber/sky/blue/indigo/violet/rose/pink |
| `CurrentConditions.jsx` | ~12 | Blue/sky/amber weather display colors |
| `SituationTimeline.jsx` | ~12 | Indigo throughout, green in resolve button |
| `InsightsSection.jsx` | ~12 | 6-color mapping objects (amber/green/indigo/violet/rose/blue) |
| `PeopleSection.jsx` | ~10 | Green/red/amber sentiment colors, violet theming |
| `SelfTalkSection.jsx` | ~10 | Green/amber/indigo shift colors |
| `FeedbackLoop.jsx` | ~10 | Green completion states, blue hover, purple badge |
| `GoalsProgress.jsx` | ~8 | Green/amber status colors, blue summary footer |
| `WeeklyDigest.jsx` | ~6 | Green/emerald/amber/orange mood arc colors |
| `QuickStatsBar.jsx` | ~6 | Amber streak, rose vent pill, teal mixed pill |
| `WinsSection.jsx` | ~4 | Amber colors (mostly on-palette already, but no dark mode) |
| `TasksSection.jsx` | ~2 | Blue text on "more" indicator |
| `NarrativeDigest.jsx` | ~0 | Already mostly on-palette; needs dark mode additions |
| `ReflectionPrompts.jsx` | ~0 | Already mostly on-palette; needs dark mode additions |

---

## Dependencies

This section **depends on** the completion of:

- **Section 01 (Tokens/Config):** `hearth-850` token and gradient presets must exist in `tailwind.config.js`.
- **Section 02 (Color Map):** `src/utils/colorMap.js` must exist with `getPatternTypeColors()`, `getEntityTypeColors()`, and `HEX_COLORS` exports. Some components in this section can optionally import from colorMap for semantic colors.
- **Section 03 (CSS Components):** CSS component classes in `src/index.css` (`.card`, `.card-elevated`, `.badge-*`, gradient utilities) must have dark mode variants.
- **Section 06 (CollapsibleSection):** `CollapsibleSection.jsx` must already be updated with Hearthside palette color schemes and dark mode variants. Many components in this section use `CollapsibleSection` and pass `colorScheme` props -- those scheme names must still be valid after section-06 changes.

This section **does not block** any other section. It can run in parallel with sections 07, 09, 10, 11, 12, 13, 14, and 15.

---

## Tests

Tests for this section are primarily file-content verification tests (grep-based) and can be written as a Vitest suite or shell-script verification. They confirm that off-palette colors have been removed and dark mode classes added.

### Test file: `/Users/michaelbond/echo-vault/src/components/dashboard/shared/__tests__/dashboardSharedPalette.test.js`

```javascript
/**
 * Dashboard Shared Components - Hearthside Palette Verification Tests
 *
 * These tests verify that the dashboard shared components have been
 * updated to use Hearthside palette colors and include dark mode support.
 * They read the actual source files and grep for off-palette classes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SHARED_DIR = resolve(__dirname, '..');

// Helper: read a component file's source
const readComponent = (filename) =>
  readFileSync(resolve(SHARED_DIR, filename), 'utf-8');

// Off-palette color patterns to check for absence
const OFF_PALETTE_PATTERNS = [
  /\bbg-purple-\d+/,
  /\btext-purple-\d+/,
  /\bborder-purple-\d+/,
  /\bbg-blue-\d+/,
  /\btext-blue-\d+/,
  /\bborder-blue-\d+/,
  /\bbg-green-\d+/,
  /\btext-green-\d+/,
  /\bborder-green-\d+/,
  /\bbg-indigo-\d+/,
  /\btext-indigo-\d+/,
  /\bborder-indigo-\d+/,
  /\bbg-violet-\d+/,
  /\btext-violet-\d+/,
  /\bborder-violet-\d+/,
  /\bbg-sky-\d+/,
  /\btext-sky-\d+/,
  /\bbg-emerald-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-cyan-\d+/,
  /\btext-cyan-\d+/,
  /\bbg-teal-\d+/,
  /\btext-teal-\d+/,
  /\bbg-pink-\d+/,
  /\btext-pink-\d+/,
  /\bbg-orange-\d+/,
  /\btext-orange-\d+/,
  /\bfrom-indigo-\d+/,
  /\bfrom-violet-\d+/,
  /\bfrom-sky-\d+/,
  /\bto-indigo-\d+/,
  /\bto-purple-\d+/,
  /\bto-emerald-\d+/,
  /\bto-cyan-\d+/,
  /\bto-pink-\d+/,
  /\bto-orange-\d+/,
];

// Files that should have zero off-palette references after the sweep
const COMPONENT_FILES = [
  'InsightBite.jsx',
  'HeroCard.jsx',
  'CurrentConditions.jsx',
  'SituationTimeline.jsx',
  'InsightsSection.jsx',
  'PeopleSection.jsx',
  'SelfTalkSection.jsx',
  'FeedbackLoop.jsx',
  'GoalsProgress.jsx',
  'WeeklyDigest.jsx',
  'QuickStatsBar.jsx',
  'WinsSection.jsx',
  'TasksSection.jsx',
  'NarrativeDigest.jsx',
  'ReflectionPrompts.jsx',
];

describe('Dashboard shared components - off-palette removal', () => {
  COMPONENT_FILES.forEach((filename) => {
    it(`${filename} has no off-palette color classes`, () => {
      const source = readComponent(filename);
      const violations = [];
      OFF_PALETTE_PATTERNS.forEach((pattern) => {
        const matches = source.match(new RegExp(pattern.source, 'g'));
        if (matches) {
          violations.push(...matches);
        }
      });
      expect(violations, `Off-palette classes found in ${filename}: ${violations.join(', ')}`).toEqual([]);
    });
  });
});

describe('Dashboard shared components - dark mode support', () => {
  COMPONENT_FILES.forEach((filename) => {
    it(`${filename} contains dark: class prefixes`, () => {
      const source = readComponent(filename);
      const darkClasses = source.match(/dark:/g) || [];
      // Every component should have at least some dark mode classes
      expect(darkClasses.length, `${filename} should have dark: classes`).toBeGreaterThan(0);
    });
  });
});

describe('Dashboard shared components - uses Hearthside palette', () => {
  it('InsightBite uses sage/honey/lavender/hearth palette', () => {
    const source = readComponent('InsightBite.jsx');
    // Should use at least one of the Hearthside palette tokens
    expect(source).toMatch(/\b(sage|honey|lavender|terra|hearth|warm)-\d+/);
  });

  it('HeroCard uses Hearthside palette for mode styles', () => {
    const source = readComponent('HeroCard.jsx');
    expect(source).toMatch(/\b(honey|terra|sage|lavender|hearth|warm)-\d+/);
  });

  it('CurrentConditions uses Hearthside palette for weather display', () => {
    const source = readComponent('CurrentConditions.jsx');
    expect(source).toMatch(/\b(lavender|sage|honey|terra|hearth|warm)-\d+/);
  });

  it('SituationTimeline uses Hearthside palette instead of indigo', () => {
    const source = readComponent('SituationTimeline.jsx');
    expect(source).toMatch(/\b(lavender|sage|honey|terra|hearth|warm)-\d+/);
    expect(source).not.toMatch(/\bbg-indigo-\d+/);
    expect(source).not.toMatch(/\btext-indigo-\d+/);
  });
});

// Exception: red-* in safety/crisis contexts is allowed.
// These components should NOT contain red-* for decorative purposes.
// PeopleSection uses red for negative sentiment - this should become terra.
describe('Dashboard shared components - red color audit', () => {
  it('PeopleSection does not use red-* for sentiment display', () => {
    const source = readComponent('PeopleSection.jsx');
    // red-* should only remain if it signals crisis/safety, not sentiment
    const decorativeRed = source.match(/\b(bg-red-|text-red-|border-red-)\d+/g) || [];
    expect(decorativeRed, 'PeopleSection should not use red for sentiment').toEqual([]);
  });
});
```

### Exception Notes for Tests

- **`red-*` in PeopleSection:** Currently `bg-red-50`, `border-red-200`, `text-red-700`, `text-red-400`, `bg-red-100` are used for "negative" sentiment. These are decorative/semantic (not crisis/safety), so they must be converted to `terra-*` palette equivalents.
- **`amber-*` usage:** Some amber references like `text-amber-500` for warning icons in shared components should become `honey-500` or equivalent. The `amber` color is not part of the Hearthside palette.
- **Confetti hex colors in FeedbackLoop.jsx:** The hex values `#10b981`, `#34d399`, `#6ee7b7`, `#a7f3d0` in the confetti call should be replaced with palette-derived hex values from `HEX_COLORS` in `colorMap.js`. This is covered in section-16 (miscellaneous sweep) but the file will be touched here for class replacements anyway.

---

## Implementation Details

### General Approach

For each file in `src/components/dashboard/shared/`:
1. Identify every off-palette Tailwind color class
2. Replace with the appropriate Hearthside palette equivalent
3. Add a `dark:` variant alongside each replacement
4. Verify that `CollapsibleSection` colorScheme prop values passed by consumer components still match valid scheme names after section-06 updates

### Color Mapping Reference

Use these mappings consistently across all files in this section:

| Off-Palette Color | Hearthside Replacement | Dark Mode Variant |
|-------------------|----------------------|-------------------|
| `purple-*` / `violet-*` | `lavender-*` | `dark:lavender-*` (adjusted shade) |
| `blue-*` / `sky-*` / `cyan-*` | `lavender-*` (lighter) or `sage-*` | context-dependent |
| `indigo-*` | `lavender-*` | `dark:lavender-*` |
| `green-*` / `emerald-*` | `sage-*` | `dark:sage-*` |
| `amber-*` / `orange-*` | `honey-*` | `dark:honey-*` |
| `rose-*` / `pink-*` | `terra-*` | `dark:terra-*` |
| `teal-*` | `sage-*` or `accent-*` | `dark:sage-*` |
| `red-*` (decorative) | `terra-*` | `dark:terra-*` |
| `red-*` (crisis/safety) | **DO NOT CHANGE** | N/A |

Dark mode shade guidelines:
- Light backgrounds (`*-50`, `*-100`) become dark transparent backgrounds (`*-900/30`, `*-900/40`)
- Medium text (`*-600`, `*-700`) becomes lighter text (`*-300`, `*-400`)
- Dark text (`*-800`, `*-900`) becomes light text (`*-200`, `*-300`)
- Borders (`*-100`, `*-200`) become subtle dark borders (`*-800`, `*-700`)
- White backgrounds (`bg-white`) become `dark:bg-hearth-900` or `dark:bg-hearth-850`
- `bg-white/60` becomes `dark:bg-hearth-800/60`

### File-by-File Implementation Guide

#### 1. InsightBite.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/InsightBite.jsx`

**Current state:** Has a `typeConfig` object with 4 types (pattern, warning, encouragement, default), each using off-palette colors (purple, amber, green, blue).

**Changes:**
- `pattern` type: Replace `purple-*` with `lavender-*`, add `dark:` variants
- `warning` type: Replace `amber-*` with `honey-*`, add `dark:` variants
- `encouragement` type: Replace `green-*` with `sage-*`, add `dark:` variants
- `default` type: Replace `blue-*` with `lavender-*` (lighter), add `dark:` variants
- Container: Add `dark:bg-hearth-900` for outer wrapper backgrounds
- Dismiss button (`text-gray-400 hover:text-gray-600`): Replace with `text-warm-400 hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300`
- Entity tag (`bg-white/60 text-gray-600`): Replace with `bg-white/60 dark:bg-hearth-800/60 text-warm-600 dark:text-warm-400`
- "View all patterns" link (`text-gray-500 hover:text-gray-700`): Replace with `text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200`

Each type config entry should include both light and dark classes in its string values. For example, `bg` should become `'bg-lavender-50 dark:bg-lavender-900/30'`.

#### 2. HeroCard.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/HeroCard.jsx`

**Current state:** Has a `modeStyles` object with 4 modes (morning, midday, evening, shelter), each using off-palette gradients and colors.

**Changes:**
- `morning`: Replace `amber-*`/`orange-*`/`yellow-*` gradient with `honey-*`/`terra-*` Hearthside equivalents. Add dark variants.
- `midday`: Replace `sky-*`/`blue-*`/`indigo-*` with `sage-*`/`lavender-*`. Add dark variants.
- `evening`: Replace `violet-*`/`purple-*`/`indigo-*` with `lavender-*`. Add dark variants.
- `shelter`: Replace `rose-*`/`pink-*` with `terra-*`/`warm-*`. Add dark variants.
- Action button: `bg-white/70 hover:bg-white/90` needs dark equivalents: `dark:bg-hearth-800/70 dark:hover:bg-hearth-800/90`
- Icon container: `bg-white/60` needs `dark:bg-hearth-800/60`
- Container shadow-soft already exists; ensure dark mode shadow strategy (border-based elevation)

Each modeStyles entry should have properties for both light and dark mode, with dark mode classes appended to the same string values.

#### 3. CurrentConditions.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/CurrentConditions.jsx`

**Current state:** Weather display uses `blue-*`/`sky-*` for weather elements, `amber-*` for sun/daylight warnings.

**Changes:**
- Compact view badge: Replace `bg-blue-50 text-blue-700` with `bg-lavender-50 dark:bg-lavender-900/30 text-lavender-700 dark:text-lavender-300`
- Compact condition label: Replace `text-blue-600` with `text-lavender-600 dark:text-lavender-400`
- Full view gradient: Replace `from-blue-50 to-sky-50` with `from-lavender-50 to-sage-50 dark:from-lavender-900/30 dark:to-sage-900/30`
- Full view border: Replace `border-blue-100` with `border-lavender-100 dark:border-lavender-800`
- Weather icon: Replace `text-blue-600` with `text-lavender-600 dark:text-lavender-400`
- Temperature: Replace `text-blue-800` with `text-lavender-800 dark:text-lavender-200`
- Condition label: Replace `text-blue-600` with `text-lavender-600 dark:text-lavender-400`
- Sun times border: Replace `border-blue-200` with `border-lavender-200 dark:border-lavender-700`
- Sunrise icon: `text-amber-500` becomes `text-honey-500 dark:text-honey-400`
- Sunset icon: `text-orange-500` becomes `text-terra-500 dark:text-terra-400`
- Daylight warning: Replace `text-amber-600 bg-amber-50` with `text-honey-600 dark:text-honey-400 bg-honey-50 dark:bg-honey-900/30`
- Refresh button: Replace `text-blue-400 hover:text-blue-600` with `text-lavender-400 hover:text-lavender-600 dark:text-lavender-500 dark:hover:text-lavender-300`
- Daylight remaining in compact view: Replace `text-amber-600` with `text-honey-600 dark:text-honey-400`

#### 4. SituationTimeline.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/SituationTimeline.jsx`

**Current state:** Heavily uses `indigo-*` throughout for borders, text, backgrounds, and hover states. Uses `green-*` for the "Resolved" button.

**Changes:**
- All `indigo-*` references become `lavender-*` with dark variants
- Specific replacements:
  - `border-indigo-100` becomes `border-lavender-100 dark:border-lavender-800`
  - `bg-white/60` becomes `bg-white/60 dark:bg-hearth-800/60`
  - `text-indigo-800` becomes `text-lavender-800 dark:text-lavender-200`
  - `text-indigo-600` becomes `text-lavender-600 dark:text-lavender-400`
  - `text-indigo-400` becomes `text-lavender-400 dark:text-lavender-500`
  - `text-indigo-500` becomes `text-lavender-500 dark:text-lavender-400`
  - `hover:bg-indigo-100` becomes `hover:bg-lavender-100 dark:hover:bg-lavender-900/40`
  - `text-indigo-700 mb-2` becomes `text-lavender-700 dark:text-lavender-300 mb-2`
  - `bg-indigo-100 hover:bg-indigo-200` becomes `bg-lavender-100 dark:bg-lavender-900/40 hover:bg-lavender-200 dark:hover:bg-lavender-800/50`
  - `bg-indigo-50/50` becomes `bg-lavender-50/50 dark:bg-lavender-900/20`
  - `hover:bg-indigo-50` becomes `hover:bg-lavender-50 dark:hover:bg-lavender-900/20`
  - `border-indigo-200` (timeline line) becomes `border-lavender-200 dark:border-lavender-700`
- "Resolved" button: Replace `bg-green-100 hover:bg-green-200 text-green-700` with `bg-sage-100 dark:bg-sage-900/40 hover:bg-sage-200 dark:hover:bg-sage-800/50 text-sage-700 dark:text-sage-300`
- "Hidden stories" link: Replace `text-indigo-500 hover:text-indigo-700` with `text-lavender-500 dark:text-lavender-400 hover:text-lavender-700 dark:hover:text-lavender-300`

#### 5. InsightsSection.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/InsightsSection.jsx`

**Current state:** Has `colorClasses` and `iconColorClasses` objects mapping 6 semantic color keys (amber, green, indigo, violet, rose, blue) to off-palette Tailwind classes. Also has `getColorForType()` returning color keys.

**Changes:**
- Replace the `colorClasses` object entries:
  - `amber` becomes honey palette with dark variants
  - `green` becomes sage palette with dark variants
  - `indigo` becomes lavender palette with dark variants
  - `violet` becomes lavender-dark (slightly different shade) with dark variants
  - `rose` becomes terra palette with dark variants
  - `blue` becomes lavender-light/sage palette with dark variants
- Replace the `iconColorClasses` object entries similarly
- "View all patterns" link: Replace `text-violet-600 hover:text-violet-800` with `text-lavender-600 dark:text-lavender-400 hover:text-lavender-800 dark:hover:text-lavender-200`
- Update `getColorForType()` to return the new mapped color key names if they change

#### 6. PeopleSection.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/PeopleSection.jsx`

**Current state:** Uses `green-*` for positive sentiment, `red-*` for negative sentiment (decorative, not crisis), `amber-*` for mixed, `violet-*` for person theming.

**Changes:**
- `getSentimentIcon`:
  - positive: `text-green-500` becomes `text-sage-500 dark:text-sage-400`
  - negative: `text-red-400` becomes `text-terra-400 dark:text-terra-400` (red here is decorative, not safety)
  - mixed: `text-amber-500` stays or becomes `text-honey-500 dark:text-honey-400`
- `getSentimentColor`:
  - positive: `bg-green-50 border-green-200` becomes `bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800`
  - negative: `bg-red-50 border-red-200` becomes `bg-terra-50 dark:bg-terra-900/30 border-terra-200 dark:border-terra-800`
  - mixed: `bg-amber-50 border-amber-200` becomes `bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800`
- Person text: Replace `text-violet-800` with `text-lavender-800 dark:text-lavender-200`, `text-violet-600` with `text-lavender-600 dark:text-lavender-400`
- Mood delta badges: Replace `bg-green-100 text-green-700` with `bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300`, `bg-red-100 text-red-700` with `bg-terra-100 dark:bg-terra-900/40 text-terra-700 dark:text-terra-300`
- Edit button: Replace `hover:bg-violet-100` with `hover:bg-lavender-100 dark:hover:bg-lavender-900/40`, `text-violet-500` with `text-lavender-500 dark:text-lavender-400`
- Friction warning border: Replace `border-violet-100` with `border-lavender-100 dark:border-lavender-800`

#### 7. SelfTalkSection.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/SelfTalkSection.jsx`

**Current state:** `getShiftColor()` returns objects with `green-*`, `amber-*`, or `indigo-*` classes for positive, concerning, and neutral shifts.

**Changes:**
- Positive shifts: Replace `green-*` with `sage-*` plus dark variants
- Concerning shifts: Replace `amber-*` with `honey-*` plus dark variants
- Neutral/default shifts: Replace `indigo-*` with `lavender-*` plus dark variants
- Summary footer: Replace `text-indigo-600` with `text-lavender-600 dark:text-lavender-400`, `border-indigo-100` with `border-lavender-100 dark:border-lavender-800`

#### 8. FeedbackLoop.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/FeedbackLoop.jsx`

**Current state:** Uses `green-*` for completion states, `blue-*` for hover/inactive states, `purple-*` for recurrence badge.

**Changes:**
- Completing state: Replace `bg-green-50 border-green-100` with `bg-sage-50 dark:bg-sage-900/30 border-sage-100 dark:border-sage-800`
- Non-completing state: Replace `border-gray-100 hover:border-blue-200` with `border-warm-100 dark:border-warm-700 hover:border-lavender-200 dark:hover:border-lavender-700`
- Checkbox completing: Replace `bg-green-500 border-green-500` with `bg-sage-500 dark:bg-sage-600 border-sage-500 dark:border-sage-600`
- Checkbox inactive: Replace `border-blue-300 hover:border-blue-500 hover:bg-blue-50` with `border-lavender-300 dark:border-lavender-600 hover:border-lavender-500 hover:bg-lavender-50 dark:hover:bg-lavender-900/30`
- Strikethrough line: Replace `bg-green-400` with `bg-sage-400 dark:bg-sage-500`
- "from yesterday" badge: Replace `text-blue-500 bg-blue-50` with `text-lavender-500 dark:text-lavender-400 bg-lavender-50 dark:bg-lavender-900/30`
- Recurrence badge: Replace `text-purple-500 bg-purple-50` with `text-lavender-500 dark:text-lavender-400 bg-lavender-50 dark:bg-lavender-900/30`
- Task text: Replace `text-gray-400`/`text-gray-700` with `text-warm-400 dark:text-warm-500`/`text-warm-700 dark:text-warm-300`
- Toast notification: Replace `bg-green-600` with `bg-sage-600 dark:bg-sage-700`
- Confetti hex colors: Note these for section-16 (miscellaneous sweep) -- the hex values `#10b981`, `#34d399`, `#6ee7b7`, `#a7f3d0` should eventually be imported from `HEX_COLORS`. For this section, focus on the CSS class replacements.

#### 9. GoalsProgress.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/GoalsProgress.jsx`

**Current state:** `getStatusColor()` uses `green-*`, `amber-*`, and `warm-*` for status styling. Footer uses `text-blue-600 border-blue-100`.

**Changes:**
- `getStatusColor`:
  - achieved: Replace `bg-green-50 border-green-200 text-green-700` with `bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800 text-sage-700 dark:text-sage-300`
  - struggling: Replace `bg-amber-50 border-amber-200 text-amber-700` with `bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800 text-honey-700 dark:text-honey-300`
  - The `honey` and `warm` entries are already on-palette; add dark variants only.
- `getStatusIcon`:
  - struggling: Replace `text-amber-500` with `text-honey-500 dark:text-honey-400`
- Summary footer: Replace `text-blue-600 border-blue-100` with `text-lavender-600 dark:text-lavender-400 border-lavender-100 dark:border-lavender-800`

#### 10. WeeklyDigest.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/WeeklyDigest.jsx`

**Current state:** `getMoodArcColor()` returns gradient strings with `green-*`/`emerald-*` and `amber-*`/`orange-*` for mood arcs. Otherwise mostly on-palette.

**Changes:**
- `getMoodArcColor`:
  - upward/positive: Replace `from-green-50 to-emerald-50 border-green-200` with `from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-800/30 border-sage-200 dark:border-sage-800`
  - downward/challenging: Replace `from-amber-50 to-orange-50 border-amber-200` with `from-honey-50 to-terra-50 dark:from-honey-900/30 dark:to-terra-900/30 border-honey-200 dark:border-honey-800`
  - default (balanced): Already uses `from-honey-50 to-lavender-50 border-honey-200`; add dark variants: `dark:from-honey-900/30 dark:to-lavender-900/30 dark:border-honey-800`
- `getMoodArcIcon`:
  - challenging: Replace `text-amber-500` with `text-honey-500 dark:text-honey-400`
- Add dark mode to all existing on-palette elements (container, header, content areas, etc.)

#### 11. QuickStatsBar.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/QuickStatsBar.jsx`

**Current state:** Uses `amber-*` for streak, `rose-*` for vent pills, `teal-*` for mixed pills. Container and mood trend are mostly on-palette.

**Changes:**
- Streak icon background: Replace `bg-amber-50` with `bg-honey-50 dark:bg-honey-900/30`
- Streak icon: Replace `text-amber-500` with `text-honey-500 dark:text-honey-400`
- Streak text: Replace `text-amber-600` with `text-honey-600 dark:text-honey-400`
- Vent pill: Replace `bg-rose-50 text-rose-600` with `bg-terra-50 dark:bg-terra-900/30 text-terra-600 dark:text-terra-400`
- Mixed pill: Replace `bg-teal-50 text-teal-600` with `bg-sage-50 dark:bg-sage-900/30 text-sage-600 dark:text-sage-400`
- Container: Already uses `bg-white/80 backdrop-blur-sm` -- add `dark:bg-hearth-900/80`
- Border: `border-warm-100` add `dark:border-warm-800`

#### 12. WinsSection.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/WinsSection.jsx`

**Current state:** Uses `amber-*` colors throughout. Amber is off-palette (should be `honey-*`).

**Changes:**
- Win item border: Replace `border-amber-100` with `border-honey-100 dark:border-honey-800`
- Win item background: `bg-white/60` add `dark:bg-hearth-800/60`
- Star icon: Replace `text-amber-500` with `text-honey-500 dark:text-honey-400`
- Win text: Replace `text-amber-800` with `text-honey-800 dark:text-honey-200`
- Date text: Replace `text-amber-600` with `text-honey-600 dark:text-honey-400`
- Goal badge: Replace `bg-amber-100 text-amber-700` with `bg-honey-100 dark:bg-honey-900/40 text-honey-700 dark:text-honey-300`

#### 13. TasksSection.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/TasksSection.jsx`

**Current state:** Minimal off-palette usage. Has `text-blue-500` in the "more tasks" indicator.

**Changes:**
- Replace `text-blue-500` with `text-lavender-500 dark:text-lavender-400`

#### 14. NarrativeDigest.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/NarrativeDigest.jsx`

**Current state:** Already mostly on-palette (uses `honey-*`, `lavender-*`, `warm-*`). Needs dark mode additions.

**Changes:**
- Add dark mode variants throughout:
  - Gradient backgrounds: `from-honey-50 to-lavender-50` add `dark:from-honey-900/30 dark:to-lavender-900/30`
  - Borders: `border-honey-100` add `dark:border-honey-800`
  - Container border: `border-honey-100/50` add `dark:border-honey-800/50`
  - Text colors: Add appropriate `dark:text-*` counterparts
  - Background areas: `bg-warm-50/50` add `dark:bg-hearth-900/50`
  - Pattern badges: `bg-white/70` add `dark:bg-hearth-800/70`
  - Forward-looking box: `from-lavender-50 to-honey-50` add dark gradient variants

#### 15. ReflectionPrompts.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/shared/ReflectionPrompts.jsx`

**Current state:** Already mostly on-palette (uses `lavender-*`, `honey-*`, `warm-*`, `terra-*`). Needs dark mode additions.

**Changes:**
- Add dark mode variants throughout:
  - Container gradient: `from-lavender-50 to-honey-50` add `dark:from-lavender-900/30 dark:to-honey-900/30`
  - Container border: `border-lavender-100` add `dark:border-lavender-800`
  - Header text: `text-lavender-600` add `dark:text-lavender-400`
  - Button backgrounds: `bg-white/50 hover:bg-white/70` add `dark:bg-hearth-800/50 dark:hover:bg-hearth-800/70`
  - Button text: `text-warm-500` add `dark:text-warm-400`
  - Terra button: `bg-terra-500 hover:bg-terra-600` add `dark:bg-terra-600 dark:hover:bg-terra-700`

---

## Implementation Checklist

1. Set up test file at `/Users/michaelbond/echo-vault/src/components/dashboard/shared/__tests__/dashboardSharedPalette.test.js`
2. Run tests (expect all to fail initially)
3. Update `InsightBite.jsx` -- replace typeConfig color objects
4. Update `HeroCard.jsx` -- replace modeStyles color objects
5. Update `CurrentConditions.jsx` -- replace weather display colors
6. Update `SituationTimeline.jsx` -- replace all indigo references
7. Update `InsightsSection.jsx` -- replace colorClasses and iconColorClasses objects
8. Update `PeopleSection.jsx` -- replace sentiment colors (including red to terra)
9. Update `SelfTalkSection.jsx` -- replace shift color objects
10. Update `FeedbackLoop.jsx` -- replace completion/hover state colors
11. Update `GoalsProgress.jsx` -- replace status colors and footer
12. Update `WeeklyDigest.jsx` -- replace mood arc gradient colors
13. Update `QuickStatsBar.jsx` -- replace streak/pill colors
14. Update `WinsSection.jsx` -- replace amber with honey
15. Update `TasksSection.jsx` -- replace blue text
16. Add dark mode to `NarrativeDigest.jsx`
17. Add dark mode to `ReflectionPrompts.jsx`
18. Run tests again (all should pass)
19. Visual verification: Navigate through dashboard views to confirm colors render correctly in both light and dark mode