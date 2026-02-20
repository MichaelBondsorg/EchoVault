Now I have all the context needed. Let me produce the section content.

# Section 09: InsightsPage.jsx -- Hearthside Palette and Dark Mode

## Overview

This section covers the Hearthside visual overhaul of `/Users/michaelbond/echo-vault/src/pages/InsightsPage.jsx`, the single worst off-palette file in the codebase with approximately 49 off-palette color instances. The work involves replacing all generic Tailwind color classes (green, blue, amber, teal, emerald, pink, indigo, purple, sky) with Hearthside palette equivalents (sage, lavender, honey, terra, hearth, warm) and adding dark mode support (`dark:` class variants) throughout the file.

## Dependencies

- **section-02-color-map**: The `colorMap.js` utility must exist at `/Users/michaelbond/echo-vault/src/utils/colorMap.js` before starting. This section uses `getPatternTypeColors()` as a reference but does not import it directly -- InsightsPage uses local style functions. However, the palette tokens and conventions defined in section-02 are assumed.
- **section-03-css-components**: The extended CSS component classes in `/Users/michaelbond/echo-vault/src/index.css` (dark mode variants for `.card`, `.btn-*`, `.badge-*`, `.modal-*`, `.input`) should be available.
- **section-01-tokens-config**: The `hearth-850` token and gradient presets must be defined in `tailwind.config.js`.

No other sections need to be completed first. This section does not block any other sections.

## Implementation Status: COMPLETE

### Files Modified
- **`/Users/michaelbond/echo-vault/src/pages/InsightsPage.jsx`** (1874 → ~1920 lines, class additions only)

### Files Created
- **`/Users/michaelbond/echo-vault/src/pages/__tests__/InsightsPage.palette.test.js`** (32 tests, all passing)

### Deviations from Plan
1. **NexusInsightCard getInsightStyle()**: Plan said "no replacements needed" but code review identified poor dark mode contrast. Added `dark:text-*-400` variants and `dark:border-*-800/30` + `dark:from-*/dark:to-*` gradient variants to all 6 style objects (user approved).
2. **text-warm-700/800 dark variants**: Plan focused on off-palette color replacements only. Code review identified many heading/body text elements lacking dark mode readability. Added `dark:text-warm-100/200` variants to all warm-700/800 text throughout the file (user approved).
3. **Additional dark mode surfaces**: Added dark variants to modal borders (`dark:border-hearth-800`), tag pills (`dark:bg-hearth-800`), calibration progress bar (`dark:bg-warm-800`), and several hover states not explicitly listed in the plan.

### Test Results
- 32/32 tests passing
- Zero off-palette color classes remaining (verified by grep)
- 80+ dark: mode variant classes added
- All red-* classes preserved for error/crisis states

## File to Modify

**`/Users/michaelbond/echo-vault/src/pages/InsightsPage.jsx`** (1874 lines, single file)

This file contains the main `InsightsPage` component and four sub-components:
- `GenerationStatus` -- Shows insight generation progress/status
- `CorrelationsSection` -- Health and environment correlations with mood
- `RecommendationsSection` -- Today's personalized recommendations
- `QuickInsightsSection` -- Basic statistical insights with expandable entries
- `NexusInsightCard` -- Expandable AI insight display

## Tests First

### Verification Tests (grep-based / file content)

Create a verification test file at `/Users/michaelbond/echo-vault/src/pages/__tests__/InsightsPage.palette.test.js`.

The tests verify that off-palette colors have been fully replaced and dark mode classes have been added. These are file-content verification tests (reading the source file and checking patterns), not runtime component tests.

```javascript
/**
 * InsightsPage.palette.test.js
 *
 * Verifies InsightsPage.jsx uses only Hearthside palette colors
 * and includes dark mode variants throughout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = resolve(__dirname, '../InsightsPage.jsx');
const source = readFileSync(filePath, 'utf-8');

describe('InsightsPage Hearthside palette compliance', () => {
  // Off-palette color classes that should NOT appear
  // (except red-* which is allowed for error/crisis states)
  const offPalettePatterns = [
    'text-green-',
    'bg-green-',
    'text-blue-',
    'bg-blue-',
    'text-teal-',
    'bg-teal-',
    'text-emerald-',
    'bg-emerald-',
    'from-emerald-',
    'to-emerald-',
    'from-teal-',
    'to-teal-',
    'border-emerald-',
    'text-pink-',
    'bg-pink-',
    'text-indigo-',
    'bg-indigo-',
    'text-purple-',
    'bg-purple-',
    'text-sky-',
    'bg-sky-',
    'text-amber-',
    'bg-amber-',
    'border-amber-',
    'hover:bg-emerald-',
    'hover:text-emerald-',
    'hover:bg-green-',
  ];

  it.each(offPalettePatterns)(
    'does not contain off-palette class "%s"',
    (pattern) => {
      /** Expect zero occurrences of each off-palette color pattern */
      const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = source.match(regex);
      expect(matches).toBeNull();
    }
  );

  it('contains dark: mode variant classes', () => {
    /** At minimum, several dark: prefixed classes should exist after the sweep */
    const darkMatches = source.match(/dark:/g);
    expect(darkMatches).not.toBeNull();
    expect(darkMatches.length).toBeGreaterThanOrEqual(20);
  });

  it('preserves red-* classes only for error/crisis states', () => {
    /**
     * red-* is allowed in error/crisis contexts (GenerationStatus error state,
     * high-priority recommendations, mood score indicators, thumbs-down hover).
     * Verify they still exist in those contexts.
     */
    expect(source).toContain('text-red-');
    expect(source).toContain('bg-red-');
  });

  it('uses Hearthside palette colors for health correlation strength', () => {
    /**
     * Health correlation strength colors should use sage (strong) and
     * lavender (moderate) instead of green/blue.
     */
    expect(source).toContain('sage');
    expect(source).toContain('lavender');
  });

  it('uses Hearthside palette for Quick Insights section gradients', () => {
    /**
     * Quick Insights section should use sage gradient instead of
     * emerald/teal gradient.
     */
    expect(source).not.toContain('from-emerald-');
    expect(source).toContain('from-sage-');
  });

  it('uses Hearthside palette for category styles in getCategoryStyle', () => {
    /**
     * getCategoryStyle should map categories to palette colors:
     * activity -> sage, people -> terra or lavender, environment -> honey,
     * time -> lavender, default -> honey
     */
    expect(source).not.toContain("color: 'text-green-600'");
    expect(source).not.toContain("color: 'text-pink-600'");
    expect(source).not.toContain("color: 'text-indigo-600'");
    expect(source).not.toContain("color: 'text-purple-600'");
  });
});
```

## Implementation Details

### Safety Rule

**Red-color audit criteria**: Any `red-*` class used for error states, crisis/safety states, or destructive actions must remain unchanged. In InsightsPage.jsx, the following red usages are legitimate and must be preserved:
- `GenerationStatus` error state: `bg-red-50`, `border-red-200/50`, `text-red-500`, `text-red-700`
- `RecommendationsSection` high priority: `bg-red-50`, `border-red-200/50`, `text-red-500`, `text-red-800`
- `QuickInsightsSection` health category: `text-red-600`, `bg-red-50` (health = heart/medical connotation)
- Mood score indicators: `text-red-600` for low mood (below 0.4)
- Thumbs-down feedback button: `hover:bg-red-100`, `text-red-500`

All of these stay as-is.

### Color Replacement Map

Below is the complete mapping of off-palette colors to Hearthside palette equivalents for each sub-component.

#### 1. GenerationStatus Component

| Line(s) | Current | Replacement | Rationale |
|---------|---------|-------------|-----------|
| 420 | `text-green-500` (CheckCircle2 icon) | `text-sage-500 dark:text-sage-400` | Success/positive indicator |
| 431 | `text-teal-500` (Activity/Whoop icon) | `text-sage-500 dark:text-sage-400` | Health/activity indicator |

Also add dark mode to the container elements:
- Line 343: `bg-white/50 border border-white/30` -- add `dark:bg-hearth-900/50 dark:border-hearth-800/30`
- Line 362: `bg-gradient-to-r from-honey-500/10 to-lavender-500/10` -- add `dark:from-honey-900/20 dark:to-lavender-900/20`
- Line 395: Error state containers -- keep red, add `dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400`
- Line 413: `bg-white/30 border border-white/20` -- add `dark:bg-hearth-900/30 dark:border-hearth-800/20`

#### 2. CorrelationsSection Component

**Health correlation strength colors** (line ~684-687):

| Current | Replacement |
|---------|-------------|
| `'text-green-600 bg-green-50'` (strong) | `'text-sage-600 bg-sage-50 dark:text-sage-400 dark:bg-sage-900/30'` |
| `'text-blue-600 bg-blue-50'` (moderate) | `'text-lavender-600 bg-lavender-50 dark:text-lavender-400 dark:bg-lavender-900/30'` |

**Health "How?" methodology section** (lines ~720-752):

| Current | Replacement |
|---------|-------------|
| `text-teal-600 hover:text-teal-700` | `text-sage-600 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300` |
| `bg-teal-50/30` | `bg-sage-50/30 dark:bg-sage-900/20` |
| `text-teal-600` (Brain icon) | `text-sage-600 dark:text-sage-400` |
| `text-teal-700` (method title) | `text-sage-700 dark:text-sage-300` |
| `bg-teal-400` (bullet dot) | `bg-sage-400 dark:bg-sage-500` |

**Environment section icon** (line 772):

| Current | Replacement |
|---------|-------------|
| `text-amber-500` (Sun icon) | `text-honey-500 dark:text-honey-400` |

**Environment correlation strength colors** (lines ~781-782):

| Current | Replacement |
|---------|-------------|
| `'text-amber-600 bg-amber-50'` (strong) | `'text-honey-600 bg-honey-50 dark:text-honey-400 dark:bg-honey-900/30'` |
| `'text-sky-600 bg-sky-50'` (moderate) | `'text-lavender-600 bg-lavender-50 dark:text-lavender-400 dark:bg-lavender-900/30'` |

**Environment "How?" methodology section** (lines ~816-848):

| Current | Replacement |
|---------|-------------|
| `text-amber-600 hover:text-amber-700` | `text-honey-600 hover:text-honey-700 dark:text-honey-400 dark:hover:text-honey-300` |
| `bg-amber-50/30` | `bg-honey-50/30 dark:bg-honey-900/20` |
| `text-amber-600` (Brain icon) | `text-honey-600 dark:text-honey-400` |
| `text-amber-700` (method title) | `text-honey-700 dark:text-honey-300` |
| `bg-amber-400` (bullet dot) | `bg-honey-400 dark:bg-honey-500` |

**SAD Warning** (lines ~865-876):

| Current | Replacement |
|---------|-------------|
| `bg-amber-50 border border-amber-200/50` | `bg-honey-50 border border-honey-200/50 dark:bg-honey-950/30 dark:border-honey-800/50` |
| `text-amber-600` (AlertTriangle) | `text-honey-600 dark:text-honey-400` |
| `text-amber-800` | `text-honey-800 dark:text-honey-200` |
| `text-amber-600` (recommendation) | `text-honey-600 dark:text-honey-400` |

Also add dark mode to shared containers:
- Line 634: `bg-white/50 border border-white/30` -- add `dark:bg-hearth-900/50 dark:border-hearth-800/30`
- Line 640: `hover:bg-white/30` -- add `dark:hover:bg-hearth-800/30`
- Line 695: `bg-white/60` -- add `dark:bg-hearth-850/60`

#### 3. RecommendationsSection Component

**`getPriorityStyle` function** (lines ~910-933):

| Priority | Current | Replacement |
|----------|---------|-------------|
| `high` | Keep red (legitimate priority indicator) | Add dark variants: `dark:bg-red-950/30`, `dark:border-red-900/50`, `dark:text-red-400`, `dark:text-red-300` |
| `medium` | `bg-amber-50`, `border-amber-200/50`, `text-amber-500`, `text-amber-800` | `bg-honey-50 dark:bg-honey-950/30`, `border-honey-200/50 dark:border-honey-800/50`, `text-honey-500 dark:text-honey-400`, `text-honey-800 dark:text-honey-200` |
| `default` (low) | `bg-green-50`, `border-green-200/50`, `text-green-500`, `text-green-800` | `bg-sage-50 dark:bg-sage-950/30`, `border-sage-200/50 dark:border-sage-800/50`, `text-sage-500 dark:text-sage-400`, `text-sage-800 dark:text-sage-200` |

Also add dark mode to the outer container (line 948): add `dark:from-honey-900/20 dark:to-sage-900/20 dark:border-honey-800/30`.

#### 4. QuickInsightsSection Component

**Generating/empty states -- replace emerald/teal gradient** (lines ~1203-1251):

The entire Quick Insights section uses a `from-emerald-50/50 to-teal-50/50` gradient theme. Replace with sage palette throughout:

| Current | Replacement |
|---------|-------------|
| `from-emerald-50/50 to-teal-50/50` | `from-sage-50/50 to-sage-100/50 dark:from-sage-950/30 dark:to-sage-900/30` |
| `border-emerald-200/30` | `border-sage-200/30 dark:border-sage-800/30` |
| `from-emerald-400/20 to-teal-400/20` | `from-sage-400/20 to-sage-300/20 dark:from-sage-600/20 dark:to-sage-500/20` |
| `text-emerald-600` | `text-sage-600 dark:text-sage-400` |
| `bg-emerald-500 text-white ... hover:bg-emerald-600` | `bg-sage-500 text-white ... hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-500` |

This pattern appears in four places: generating state (line 1203), has-enough-data prompt (line 1225), main section header (line 1276), and the header icon area (line 1283).

**`getCategoryStyle` function** (lines ~1257-1271):

| Category | Current | Replacement |
|----------|---------|-------------|
| `activity` | `text-green-600`, `bg-green-50` | `text-sage-600 dark:text-sage-400`, `bg-sage-50 dark:bg-sage-900/30` |
| `people` | `text-pink-600`, `bg-pink-50` | `text-terra-600 dark:text-terra-400`, `bg-terra-50 dark:bg-terra-900/30` |
| `health` | `text-red-600`, `bg-red-50` | Keep (legitimate health/medical connotation) -- add dark: `text-red-400`, `bg-red-950/30` |
| `environment` | `text-amber-600`, `bg-amber-50` | `text-honey-600 dark:text-honey-400`, `bg-honey-50 dark:bg-honey-900/30` |
| `time` | `text-indigo-600`, `bg-indigo-50` | `text-lavender-600 dark:text-lavender-400`, `bg-lavender-50 dark:bg-lavender-900/30` |
| `default` | `text-purple-600`, `bg-purple-50` | `text-honey-600 dark:text-honey-400`, `bg-honey-50 dark:bg-honey-900/30` |

**Strength badges** (lines ~1339-1341):

| Current | Replacement |
|---------|-------------|
| `bg-green-100 text-green-700` (strong) | `bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-300` |
| `bg-blue-100 text-blue-700` (moderate) | `bg-lavender-100 text-lavender-700 dark:bg-lavender-900/40 dark:text-lavender-300` |

**Mood delta indicator** (line ~1345):

| Current | Replacement |
|---------|-------------|
| `text-green-600` (positive) | `text-sage-600 dark:text-sage-400` |
| `text-amber-600` (negative) | `text-terra-600 dark:text-terra-400` |

**Feedback area** (lines ~1387-1397):

| Current | Replacement |
|---------|-------------|
| `text-green-600` (feedback thanks) | `text-sage-600 dark:text-sage-400` |
| `hover:bg-green-100` (thumbs up hover) | `hover:bg-sage-100 dark:hover:bg-sage-900/30` |
| `text-green-600` (ThumbsUp icon) | `text-sage-600 dark:text-sage-400` |
| `hover:bg-red-100` / `text-red-500` (thumbs down) | Keep red -- add `dark:hover:bg-red-950/30 dark:text-red-400` |

**Mood score in entry list** (lines ~1437-1438 and 1518-1519):

| Current | Replacement |
|---------|-------------|
| `text-green-600` (mood >= 0.6) | `text-sage-600 dark:text-sage-400` |
| `text-amber-600` (mood 0.4-0.6) | `text-honey-600 dark:text-honey-400` |
| `text-red-600` (mood < 0.4) | Keep red -- add `dark:text-red-400` |

**Show more entries link** (line ~1456):

| Current | Replacement |
|---------|-------------|
| `text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50` | `text-sage-600 hover:text-sage-700 hover:bg-sage-50 dark:text-sage-400 dark:hover:text-sage-300 dark:hover:bg-sage-900/30` |

**Various container dark modes in QuickInsightsSection**:
- Line 1155: `bg-white/30 border border-white/20` -- add `dark:bg-hearth-900/30 dark:border-hearth-800/20`
- Line 1177: same pattern
- Line 1324: `bg-white/60` -- add `dark:bg-hearth-850/60`
- Line 1379: `border-warm-200/50 bg-warm-50/50` -- add `dark:border-hearth-800/50 dark:bg-hearth-900/50`
- Line 1426: `bg-white/80 hover:bg-white` -- add `dark:bg-hearth-850/80 dark:hover:bg-hearth-800`
- Line 1493: `bg-white` (modal) -- add `dark:bg-hearth-900`
- Line 1485: `bg-black/50` (overlay) -- this is acceptable for overlays, keep as-is

#### 5. NexusInsightCard Component

The `NexusInsightCard` `getInsightStyle()` function (lines ~1595-1657) already uses Hearthside palette colors (terra, sage, honey, lavender). No replacements needed there.

**Biometric evidence** (line ~1819):

| Current | Replacement |
|---------|-------------|
| `bg-teal-50/50 ... text-teal-700` | `bg-sage-50/50 dark:bg-sage-900/30 ... text-sage-700 dark:text-sage-300` |

**Container dark mode variants to add across NexusInsightCard**:
- Line 1796: `bg-white/40` -- add `dark:bg-hearth-850/40`
- Line 1814: `bg-white/40` -- add `dark:bg-hearth-850/40`

#### 6. Top-level InsightsPage Component

Dark mode additions to existing containers:
- Line 199: `bg-white/50 hover:bg-white/80` (refresh button) -- add `dark:bg-hearth-900/50 dark:hover:bg-hearth-800/80`
- Line 209: `bg-warm-50/50 border border-warm-200/30` (disclaimer) -- add `dark:bg-hearth-900/50 dark:border-hearth-800/30`
- Line 288: `bg-white/30 ... border border-white/20` (empty state) -- add `dark:bg-hearth-900/30 dark:border-hearth-800/20`

### Implementation Approach

1. Work through the file top-to-bottom, component by component.
2. For each off-palette class: replace with the Hearthside equivalent from the mapping above.
3. For each container/surface element: add the corresponding `dark:` variant class alongside the existing light-mode class.
4. Do NOT change any red-* classes used for error states, crisis states, or destructive actions -- only add dark variants to those.
5. Do NOT change any functional logic, state management, or component structure. This is purely a class-name replacement pass.
6. After all changes, run the verification tests to confirm zero remaining off-palette classes.

### Palette Quick Reference

For this file, the primary mappings are:

| Generic Color | Hearthside Equivalent | Semantic Use |
|---------------|----------------------|--------------|
| green | sage | Positive, growth, activity, success |
| blue | lavender | Moderate strength, reflection, time |
| amber | honey | Environment, warnings, neutral |
| teal | sage | Health, methodology, biometric |
| emerald | sage | Quick insights section theme |
| pink | terra | People, social connections |
| indigo | lavender | Time-based, reflective |
| purple | honey | Default/fallback category |
| sky | lavender | Moderate environment strength |

### Dark Mode Surface Hierarchy

For containers and surfaces in this file, follow this elevation hierarchy:

| Element Type | Light | Dark |
|-------------|-------|------|
| Page background | (inherited) | (inherited from app) |
| Section containers | `bg-white/50`, `bg-white/30` | `dark:bg-hearth-900/50`, `dark:bg-hearth-900/30` |
| Cards within sections | `bg-white/60` | `dark:bg-hearth-850/60` |
| Expanded/detail panels | `bg-warm-50/50`, `bg-white/40` | `dark:bg-hearth-900/50`, `dark:bg-hearth-850/40` |
| Modals | `bg-white` | `dark:bg-hearth-900` |
| Badge/pill backgrounds | `bg-{color}-50`, `bg-{color}-100` | `dark:bg-{color}-900/30`, `dark:bg-{color}-900/40` |
| Gradient sections | `from-{color}-50/50 to-...` | `dark:from-{color}-950/30 dark:to-...` |
| Hover states | `hover:bg-white/30` | `dark:hover:bg-hearth-800/30` |
| Borders | `border-white/20`, `border-warm-200/50` | `dark:border-hearth-800/20`, `dark:border-hearth-800/50` |

### Verification Checklist

After implementation, verify:

1. Run `npm test` -- the palette verification test should pass with zero off-palette hits.
2. Grep the file for each off-palette pattern to confirm zero matches: `grep -c 'text-green-\|bg-green-\|text-blue-\|bg-blue-\|text-teal-\|bg-teal-\|text-emerald-\|bg-emerald-\|from-emerald-\|to-emerald-\|from-teal-\|to-teal-\|text-pink-\|bg-pink-\|text-indigo-\|bg-indigo-\|text-purple-\|bg-purple-\|text-sky-\|bg-sky-\|text-amber-\|bg-amber-\|border-amber-\|border-emerald-\|hover:bg-emerald-\|hover:text-emerald-\|hover:bg-green-' src/pages/InsightsPage.jsx`
3. Grep for `dark:` and confirm at least 20+ instances exist.
4. Visually confirm that `red-*` classes remain ONLY in error/crisis/destructive contexts.
5. No functional behavior has changed -- the component renders and behaves identically except for visual styling.