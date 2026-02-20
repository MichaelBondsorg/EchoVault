Now I have all the context I need. Let me produce the section content.

# Section 06: CollapsibleSection Color Scheme Replacement

## Overview

This section covers replacing the 7 off-palette color scheme objects in `CollapsibleSection.jsx` with Hearthside palette equivalents and adding dark mode variants. This is the single highest-leverage file change in the entire Hearthside visual overhaul -- the color schemes defined here propagate to 8 consumer components across the dashboard.

## Dependencies

- **section-01-tokens-config** must be complete (the `hearth-850` token and any Tailwind config changes need to be in place)
- **section-03-css-components** must be complete (dark mode CSS component class extensions should be ready)

## Background

### What CollapsibleSection Does

`CollapsibleSection` is a reusable collapsible/expandable panel component used throughout the dashboard. It lives at `/Users/michaelbond/echo-vault/src/components/dashboard/shared/CollapsibleSection.jsx`. The component accepts a `colorScheme` prop that selects from one of 7 predefined color scheme objects, each containing 8 CSS class string properties: `bg`, `border`, `iconBg`, `iconText`, `title`, `subtitle`, `chevron`, and `content`.

### Current Color Schemes (Off-Palette)

The component currently defines these 7 schemes using generic Tailwind colors that are NOT part of the Hearthside palette:

| Scheme Key | Current Palette | Used By |
|-----------|----------------|---------|
| `indigo` | indigo-50/100/400/600/800, violet-50 | `SelfTalkSection.jsx`, `SituationTimeline.jsx` |
| `green` | green-50/100/400/600/800, emerald-50 | (no current consumers found using this key directly) |
| `amber` | amber-50/100/400/600/800, orange-50 | `WinsSection.jsx` |
| `violet` | violet-50/100/400/600/800, purple-50 | `InsightsSection.jsx`, `PeopleSection.jsx` |
| `rose` | rose-50/100/400/600/800, pink-50 | (no current consumers found using this key directly) |
| `blue` | blue-50/100/400/600/800, cyan-50 | `GoalsProgress.jsx`, `TasksSection.jsx` |
| `warm` | warm-50/100/200/400/600/800 | (already on-palette) |

Each scheme object has 8 properties used in the template:
- `bg` -- gradient background classes on the outer container (e.g., `from-indigo-50 to-violet-50`)
- `border` -- border color class on the outer container
- `iconBg` -- background class on the icon wrapper div
- `iconText` -- text color class on the icon
- `title` -- text color class on the heading
- `subtitle` -- text color class on the subtitle/collapsed content
- `chevron` -- text color class on the chevron icon
- `content` -- border color class on the expanded content area

### Consumer Components

These components import `CollapsibleSection` and pass a `colorScheme` prop:

| Consumer File | Color Scheme Used |
|--------------|-------------------|
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/WinsSection.jsx` | `amber` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/PeopleSection.jsx` | `violet` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/SituationTimeline.jsx` | `indigo` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/TasksSection.jsx` | `blue` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/GoalsProgress.jsx` | `blue` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/InsightsSection.jsx` | `violet` |
| `/Users/michaelbond/echo-vault/src/components/dashboard/shared/SelfTalkSection.jsx` | `indigo` |

No consumer components need to be modified. The `colorScheme` prop keys remain the same (`indigo`, `green`, `amber`, `violet`, `rose`, `blue`, `warm`) so the interface is backward-compatible. Only the CSS class strings inside each scheme object change.

### Hearthside Palette Available

The Tailwind config at `/Users/michaelbond/echo-vault/tailwind.config.js` defines these palettes (each with shades 50-900):
- `hearth` -- core surface colors (linen cream to deep charcoal)
- `honey` -- primary amber warmth
- `terra` -- terracotta grounding
- `sage` -- sage green growth
- `lavender` -- dusty lavender reflection
- `warm` -- alias for hearth (already on-palette)

Dark mode uses `darkMode: 'class'` strategy.

## Tests First

Create the test file at `/Users/michaelbond/echo-vault/src/components/dashboard/shared/__tests__/CollapsibleSection.test.js`.

These tests verify the color scheme objects in CollapsibleSection contain Hearthside palette tokens and include dark mode variants. Since the color scheme objects are internal to the component, the tests can either: (a) import the component and inspect rendered output, or (b) read the file contents and verify patterns via string matching. The string-matching approach is simpler and does not require rendering infrastructure.

### Test Stubs

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = resolve(__dirname, '../CollapsibleSection.jsx');
const fileContent = readFileSync(filePath, 'utf-8');

describe('CollapsibleSection color schemes', () => {

  it('does not contain off-palette indigo color classes', () => {
    // After replacement, the indigo scheme should use lavender palette instead.
    // Verify no from-indigo, bg-indigo, text-indigo, border-indigo classes remain.
  });

  it('does not contain off-palette green/emerald color classes', () => {
    // After replacement, the green scheme should use sage palette instead.
    // Verify no from-green, bg-green, text-green, border-green,
    // from-emerald, bg-emerald, text-emerald, border-emerald classes remain.
  });

  it('does not contain off-palette amber/orange color classes', () => {
    // After replacement, the amber scheme should use honey palette instead.
    // Verify no from-amber, bg-amber, text-amber, border-amber,
    // from-orange, bg-orange classes remain.
  });

  it('does not contain off-palette violet/purple color classes', () => {
    // After replacement, the violet scheme should use lavender (darker shades) instead.
    // Verify no from-violet, bg-violet, text-violet, border-violet,
    // from-purple, bg-purple classes remain.
  });

  it('does not contain off-palette rose/pink color classes', () => {
    // After replacement, the rose scheme should use terra palette instead.
    // Verify no from-rose, bg-rose, text-rose, border-rose,
    // from-pink, bg-pink classes remain.
  });

  it('does not contain off-palette blue/cyan color classes', () => {
    // After replacement, the blue scheme should use lavender-light palette instead.
    // Verify no from-blue, bg-blue, text-blue, border-blue,
    // from-cyan, bg-cyan classes remain.
  });

  it('retains all 7 color scheme keys for backward compatibility', () => {
    // Verify the colors object still contains: indigo, green, amber, violet, rose, blue, warm
  });

  it('each color scheme includes dark: variant classes', () => {
    // For each of the 7 schemes, verify that the scheme properties
    // contain 'dark:' prefixed classes (at minimum in bg, iconBg, iconText, title, subtitle)
  });

  it('warm color scheme remains unchanged (already on-palette)', () => {
    // Verify the warm scheme still uses warm-50, warm-100, warm-200, warm-400, warm-600, warm-800
  });

  it('all color class strings use only Hearthside palette names', () => {
    // Extract all class strings from the color scheme objects.
    // Verify every color reference is one of: hearth, honey, terra, sage, lavender, warm, white, black
    // (plus opacity modifiers and dark: prefixes).
  });

});
```

## Implementation Details

### File to Modify

`/Users/michaelbond/echo-vault/src/components/dashboard/shared/CollapsibleSection.jsx`

### Palette Mapping Strategy

Replace each off-palette scheme with the Hearthside equivalent. The mapping follows the semantic intent of the original colors:

| Original Scheme | Maps To | Rationale |
|----------------|---------|-----------|
| `indigo` | `lavender` | Indigo/violet tones map naturally to the lavender palette (calm/reflection) |
| `green` | `sage` | Green maps directly to sage (growth) |
| `amber` | `honey` | Amber maps directly to honey (warmth) |
| `violet` | `lavender` (darker shades) | Violet/purple also maps to lavender, using slightly different shade selections to distinguish from `indigo` mapping |
| `rose` | `terra` | Rose/pink maps to terracotta (warm earth tones) |
| `blue` | `lavender` (lighter shades) | Blue/cyan maps to lighter lavender for a cooler but still on-palette feel |
| `warm` | `warm` (no change) | Already on-palette |

### Color Scheme Object Structure

Each scheme object should follow this pattern, providing both light and dark mode classes in a single string per property. The `dark:` prefix classes are appended to the same string so Tailwind applies them when the `dark` class is on `<html>`.

Example structure for one scheme:

```javascript
lavender: {
  bg: 'from-lavender-50 to-lavender-100 dark:from-lavender-900/40 dark:to-lavender-800/40',
  border: 'border-lavender-100 dark:border-lavender-800',
  iconBg: 'bg-lavender-100 dark:bg-lavender-800/50',
  iconText: 'text-lavender-600 dark:text-lavender-300',
  title: 'text-lavender-800 dark:text-lavender-200',
  subtitle: 'text-lavender-600 dark:text-lavender-400',
  chevron: 'text-lavender-400 dark:text-lavender-500',
  content: 'border-lavender-100 dark:border-lavender-800'
}
```

### Detailed Replacements for All 7 Schemes

**`indigo` scheme** (consumers: SelfTalkSection, SituationTimeline) -- Replace with lavender palette:
- `bg`: `from-indigo-50 to-violet-50` becomes `from-lavender-50 to-lavender-100` with dark variants using `dark:from-lavender-900/40 dark:to-lavender-800/40`
- `border`: `border-indigo-100` becomes `border-lavender-100` with `dark:border-lavender-800`
- `iconBg`: `bg-indigo-100` becomes `bg-lavender-100` with `dark:bg-lavender-800/50`
- `iconText`: `text-indigo-600` becomes `text-lavender-600` with `dark:text-lavender-300`
- `title`: `text-indigo-800` becomes `text-lavender-800` with `dark:text-lavender-200`
- `subtitle`: `text-indigo-600` becomes `text-lavender-600` with `dark:text-lavender-400`
- `chevron`: `text-indigo-400` becomes `text-lavender-400` with `dark:text-lavender-500`
- `content`: `border-indigo-100` becomes `border-lavender-100` with `dark:border-lavender-800`

**`green` scheme** -- Replace with sage palette:
- `bg`: `from-green-50 to-emerald-50` becomes `from-sage-50 to-sage-100` with `dark:from-sage-900/40 dark:to-sage-800/40`
- `border`: `border-green-100` becomes `border-sage-100` with `dark:border-sage-800`
- `iconBg`: `bg-green-100` becomes `bg-sage-100` with `dark:bg-sage-800/50`
- `iconText`: `text-green-600` becomes `text-sage-600` with `dark:text-sage-300`
- `title`: `text-green-800` becomes `text-sage-800` with `dark:text-sage-200`
- `subtitle`: `text-green-600` becomes `text-sage-600` with `dark:text-sage-400`
- `chevron`: `text-green-400` becomes `text-sage-400` with `dark:text-sage-500`
- `content`: `border-green-100` becomes `border-sage-100` with `dark:border-sage-800`

**`amber` scheme** (consumer: WinsSection) -- Replace with honey palette:
- `bg`: `from-amber-50 to-orange-50` becomes `from-honey-50 to-honey-100` with `dark:from-honey-900/40 dark:to-honey-800/40`
- `border`: `border-amber-100` becomes `border-honey-100` with `dark:border-honey-800`
- `iconBg`: `bg-amber-100` becomes `bg-honey-100` with `dark:bg-honey-800/50`
- `iconText`: `text-amber-600` becomes `text-honey-600` with `dark:text-honey-300`
- `title`: `text-amber-800` becomes `text-honey-800` with `dark:text-honey-200`
- `subtitle`: `text-amber-600` becomes `text-honey-600` with `dark:text-honey-400`
- `chevron`: `text-amber-400` becomes `text-honey-400` with `dark:text-honey-500`
- `content`: `border-amber-100` becomes `border-honey-100` with `dark:border-honey-800`

**`violet` scheme** (consumers: InsightsSection, PeopleSection) -- Replace with lavender (using slightly different shades to provide visual distinction from the `indigo` scheme):
- `bg`: `from-violet-50 to-purple-50` becomes `from-lavender-100 to-lavender-50` (note: reversed gradient direction for distinction) with `dark:from-lavender-900/50 dark:to-lavender-800/50`
- `border`: `border-violet-100` becomes `border-lavender-200` with `dark:border-lavender-700`
- `iconBg`: `bg-violet-100` becomes `bg-lavender-200` with `dark:bg-lavender-700/50`
- `iconText`: `text-violet-600` becomes `text-lavender-500` with `dark:text-lavender-300`
- `title`: `text-violet-800` becomes `text-lavender-700` with `dark:text-lavender-200`
- `subtitle`: `text-violet-600` becomes `text-lavender-500` with `dark:text-lavender-400`
- `chevron`: `text-violet-400` becomes `text-lavender-300` with `dark:text-lavender-500`
- `content`: `border-violet-100` becomes `border-lavender-200` with `dark:border-lavender-700`

**`rose` scheme** -- Replace with terra palette:
- `bg`: `from-rose-50 to-pink-50` becomes `from-terra-50 to-terra-100` with `dark:from-terra-900/40 dark:to-terra-800/40`
- `border`: `border-rose-100` becomes `border-terra-100` with `dark:border-terra-800`
- `iconBg`: `bg-rose-100` becomes `bg-terra-100` with `dark:bg-terra-800/50`
- `iconText`: `text-rose-600` becomes `text-terra-600` with `dark:text-terra-300`
- `title`: `text-rose-800` becomes `text-terra-800` with `dark:text-terra-200`
- `subtitle`: `text-rose-600` becomes `text-terra-600` with `dark:text-terra-400`
- `chevron`: `text-rose-400` becomes `text-terra-400` with `dark:text-terra-500`
- `content`: `border-rose-100` becomes `border-terra-100` with `dark:border-terra-800`

**`blue` scheme** (consumers: GoalsProgress, TasksSection) -- Replace with sage palette (provides visual distinction from lavender-based schemes while staying on-palette):
- `bg`: `from-blue-50 to-cyan-50` becomes `from-sage-50 to-sage-100` with `dark:from-sage-900/40 dark:to-sage-800/40`
- `border`: `border-blue-100` becomes `border-sage-200` with `dark:border-sage-700`
- `iconBg`: `bg-blue-100` becomes `bg-sage-200` with `dark:bg-sage-700/50`
- `iconText`: `text-blue-600` becomes `text-sage-600` with `dark:text-sage-300`
- `title`: `text-blue-800` becomes `text-sage-700` with `dark:text-sage-200`
- `subtitle`: `text-blue-600` becomes `text-sage-600` with `dark:text-sage-400`
- `chevron`: `text-blue-400` becomes `text-sage-400` with `dark:text-sage-500`
- `content`: `border-blue-100` becomes `border-sage-200` with `dark:border-sage-700`

**`warm` scheme** -- Keep existing light mode values, add dark mode variants:
- `bg`: `from-warm-50 to-warm-100` add `dark:from-hearth-900/40 dark:to-hearth-850/40`
- `border`: `border-warm-200` add `dark:border-hearth-700`
- `iconBg`: `bg-warm-100` add `dark:bg-hearth-800/50`
- `iconText`: `text-warm-600` add `dark:text-warm-400`
- `title`: `text-warm-800` add `dark:text-hearth-200`
- `subtitle`: `text-warm-600` add `dark:text-warm-400`
- `chevron`: `text-warm-400` add `dark:text-warm-500`
- `content`: `border-warm-200` add `dark:border-hearth-700`

Note: The `warm` scheme's dark variants use `hearth` tokens instead of `warm` at the extreme dark end because `warm` is an alias for `hearth` anyway. The `hearth-850` token (added in section-01) is used for the subtle gradient endpoint in the warm dark variant.

### Additional Template Dark Mode Adjustments

Beyond the color scheme objects, the component template itself has one hover class that needs a dark variant:

- Line 117: `hover:bg-white/30` on the header button should also include `dark:hover:bg-white/5` so the hover state is visible on dark backgrounds without being too bright.

### No Changes to Consumer Components

The 7 scheme keys (`indigo`, `green`, `amber`, `violet`, `rose`, `blue`, `warm`) remain identical. Consumer components continue to pass the same `colorScheme="indigo"` (etc.) prop. Only the CSS class strings inside CollapsibleSection change. This is why this is the highest-leverage single file change: one file modification propagates the Hearthside palette to the entire dashboard section system.

## Implementation Checklist

1. Create test file at `/Users/michaelbond/echo-vault/src/components/dashboard/shared/__tests__/CollapsibleSection.test.js` with the test stubs above
2. Run tests to confirm they fail (all schemes are currently off-palette)
3. Replace all 7 color scheme objects in `/Users/michaelbond/echo-vault/src/components/dashboard/shared/CollapsibleSection.jsx` with Hearthside palette equivalents as specified above
4. Add `dark:hover:bg-white/5` to the header button hover state
5. Run tests to confirm they pass
6. Visually verify the dashboard in the browser -- all CollapsibleSection instances should now show Hearthside palette colors
7. If dark mode infrastructure (section-04) is available, toggle dark mode and verify the dark variants render correctly

## Implementation Notes

**Implemented as planned.** All 7 color scheme replacements match plan exactly.

**Code review fix applied:**
- Extended Tailwind safelist pattern in `tailwind.config.js` to include `from` and `to` gradient prefixes (was only `bg|text|border`, now `bg|text|border|from|to`). This prevents production purging of gradient classes used in color schemes.

**Known pre-existing issues noted but not fixed (out of scope):**
- Dynamic `hover:${c.title}` interpolation on line 156 (clear-all button) - Tailwind cannot detect dynamically constructed class names
- `content` property defined in all schemes but never referenced as `c.content` in the template

**Files modified:** `src/components/dashboard/shared/CollapsibleSection.jsx`, `tailwind.config.js`
**Files created:** `src/components/dashboard/shared/__tests__/CollapsibleSection.test.js`
**Tests:** 10 passing