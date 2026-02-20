Now I have all the information I need. Let me generate the section content.

# Section 11: Environment and Social Components Sweep

## Overview

This section covers the Hearthside palette migration and dark mode implementation for all **environment** and **social** components. These two feature areas have a combined ~116 off-palette color instances across 6 files. The work involves replacing generic Tailwind colors (amber, blue, orange, green, rose, purple, indigo, sky, slate) with Hearthside palette equivalents (honey, lavender, terra, sage) and adding `dark:` variant classes throughout.

## Dependencies

This section depends on:
- **section-01-tokens-config** -- `hearth-850` token, gradient presets, and Tailwind safelist must be in place
- **section-02-color-map** -- `src/utils/colorMap.js` must exist with mapping functions and `HEX_COLORS` exports
- **section-03-css-components** -- Extended CSS component classes in `src/index.css` with dark mode variants must be ready

This section can be implemented in parallel with sections 07-10 and 12-15 (the main screen sweep).

## Files to Modify

### Environment Components (`/Users/michaelbond/echo-vault/src/components/environment/`)

| File | Off-Palette Count | Key Issues |
|------|-------------------|------------|
| `SADInsightCard.jsx` | ~29 | amber-*, blue-*, sky-*, orange-* throughout; dual-color theme (high priority vs normal) |
| `DaylightStatusBar.jsx` | ~11 | Full color mapping objects with amber, orange, blue, slate, indigo; progress bar with green/amber/orange |
| `LightContextNudge.jsx` | ~2 | Gradient backgrounds using amber-500, orange-500, blue-500, sky-500 |

### Social Components (`/Users/michaelbond/echo-vault/src/components/social/`)

| File | Off-Palette Count | Key Issues |
|------|-------------------|------------|
| `SocialResilienceAlert.jsx` | ~28 | Full COLOR_MAP with rose, amber, blue, green, purple; success state with green-* |
| `SocialHealthWidget.jsx` | ~12 | Balance meter with blue-400/rose-400; quick action buttons with blue-50, green-50, purple-50; isolation alert with rose-*; positive reinforcement with green-* |
| `RelationshipCorrectionModal.jsx` | ~11 | Category selection with rose, blue, purple colors; save button blue-500; success state green-50; error state red-50 (red for error stays) |

### Index Files (no changes needed)
- `/Users/michaelbond/echo-vault/src/components/environment/index.js` -- Pure re-exports, no color references
- `/Users/michaelbond/echo-vault/src/components/social/index.js` -- Pure re-exports, no color references

---

## Tests

Tests for this section are file-content verification (grep-based) tests, not runtime unit tests. They verify that off-palette colors have been replaced and dark mode classes have been added.

Create these as part of a verification test file or run as manual grep checks after implementation.

### Environment Component Tests

```
# Test: SADInsightCard.jsx contains zero instances of amber-, blue-, sky-, orange- color classes
# Test: SADInsightCard.jsx contains dark: prefix classes for backgrounds, text, and borders
# Test: SADInsightCard.jsx uses honey-* for high-priority variant (replacing amber-*)
# Test: SADInsightCard.jsx uses lavender-* for normal variant (replacing blue-*/sky-*)

# Test: DaylightStatusBar.jsx contains zero instances of amber-, orange-, blue-, slate-, indigo-, green- color classes
# Test: DaylightStatusBar.jsx colorClasses object uses only Hearthside palette tokens
# Test: DaylightStatusBar.jsx iconColorClasses object uses only Hearthside palette tokens
# Test: DaylightStatusBar.jsx progress bar uses sage-* instead of green-400, honey-* instead of amber-400, terra-* instead of orange-400
# Test: DaylightStatusBar.jsx contains dark: prefix classes in colorClasses and iconColorClasses

# Test: LightContextNudge.jsx contains zero instances of amber-500, orange-500, blue-500, sky-500
# Test: LightContextNudge.jsx gradient backgrounds use Hearthside palette colors
# Test: LightContextNudge.jsx contains dark: prefix classes for gradient backgrounds
```

### Social Component Tests

```
# Test: SocialResilienceAlert.jsx COLOR_MAP contains zero instances of rose-, amber-, blue-, green-, purple- (as generic Tailwind)
# Test: SocialResilienceAlert.jsx COLOR_MAP uses terra, honey, lavender, sage palette equivalents
# Test: SocialResilienceAlert.jsx COLOR_MAP entries include dark: variants for bg, border, icon, title, text, button
# Test: SocialResilienceAlert.jsx success state uses sage-* instead of green-*
# Test: SocialResilienceAlert.jsx NeglectedConnectionsList "Reach out" button uses lavender-* instead of blue-*

# Test: SocialHealthWidget.jsx contains zero instances of blue-400, rose-400, blue-50, green-50, purple-50, rose-50, rose-100 (outside isolation risk context)
# Test: SocialHealthWidget.jsx balance meter uses lavender-400/terra-400 instead of blue-400/rose-400
# Test: SocialHealthWidget.jsx quick action buttons use Hearthside palette colors
# Test: SocialHealthWidget.jsx positive reinforcement uses sage-* instead of green-*
# Test: SocialHealthWidget.jsx isolation alert uses terra-* instead of rose-*
# Test: SocialHealthWidget.jsx contains dark: prefix classes for all color-bearing elements

# Test: RelationshipCorrectionModal.jsx category selection uses terra (personal), lavender (work), honey (ambiguous) instead of rose, blue, purple
# Test: RelationshipCorrectionModal.jsx save button uses lavender-500 instead of blue-500
# Test: RelationshipCorrectionModal.jsx success state uses sage-* instead of green-*
# Test: RelationshipCorrectionModal.jsx error state keeps red-* (red for errors is intentional, do NOT change)
# Test: RelationshipCorrectionModal.jsx modal container, header, and actions include dark: variants
```

---

## Implementation Details

### General Approach

For every file in this section, apply the following in a single pass:
1. Replace off-palette generic Tailwind colors with Hearthside palette equivalents
2. Add `dark:` variant classes alongside every light-mode color class
3. Where color mapping objects exist (like `COLOR_MAP` or `colorClasses`), restructure them with palette colors and dark variants
4. Preserve all component behavior, props, and structure -- this is a visual-only change

### Color Mapping Reference

Use these consistent palette mappings across all files in this section:

| Generic Tailwind | Hearthside Equivalent | Semantic Meaning |
|------------------|-----------------------|-----------------|
| `amber-*` | `honey-*` | Warmth, attention, daylight |
| `orange-*` | `terra-*` | Urgency, fading, grounding |
| `blue-*` / `sky-*` | `lavender-*` | Calm, normal state, work |
| `green-*` | `sage-*` | Positive, healthy, success |
| `rose-*` | `terra-*` | Personal connections, alerts |
| `purple-*` | `lavender-*` (darker end) | Ambiguous, mixed, night |
| `indigo-*` | `lavender-*` (darker end) | Night, dark conditions |
| `slate-*` | `warm-*` | Neutral, muted states |

### Dark Mode Pattern

For every color class, add a corresponding `dark:` class. The general pattern:

- Light backgrounds (`bg-honey-50`) get dark equivalents with transparency: `dark:bg-honey-900/30`
- Light borders (`border-honey-200`) get dark equivalents: `dark:border-honey-800`
- Light text (`text-honey-700`) gets dark equivalents: `dark:text-honey-300`
- Dark text headings (`text-honey-800`) get dark equivalents: `dark:text-honey-200`
- Muted text (`text-honey-600`) gets dark: `dark:text-honey-400`
- Subtle text (`text-honey-500`) gets dark: `dark:text-honey-400`
- Icon backgrounds (`bg-honey-100`) get dark: `dark:bg-honey-800/40`
- Buttons (`bg-honey-500 hover:bg-honey-600`) get dark: `dark:bg-honey-600 dark:hover:bg-honey-500`
- Gradients (`from-honey-50 to-terra-50`) get dark: `dark:from-honey-900/30 dark:to-terra-900/30`

For container backgrounds that are currently `bg-white`, add `dark:bg-hearth-900` or `dark:bg-hearth-850`.

---

### File-by-File Implementation

#### 1. SADInsightCard.jsx (`/Users/michaelbond/echo-vault/src/components/environment/SADInsightCard.jsx`)

**Current state:** Uses a dual-color theme based on `isHighPriority` -- amber/orange palette for high priority, blue/sky for normal priority. This pattern repeats ~29 times throughout the component.

**Target state:** Replace amber/orange with honey/terra palette, blue/sky with lavender palette. Add dark mode variants.

**Key changes:**

The outer container gradient:
- High priority: `from-amber-50 to-orange-50 border-amber-200` becomes `from-honey-50 to-terra-50 border-honey-200` with dark variants `dark:from-honey-900/30 dark:to-terra-900/30 dark:border-honey-800`
- Normal: `from-blue-50 to-sky-50 border-blue-200` becomes `from-lavender-50 to-lavender-100 border-lavender-200` with dark variants `dark:from-lavender-900/30 dark:to-lavender-800/30 dark:border-lavender-800`

Icon containers:
- `bg-amber-100` becomes `bg-honey-100 dark:bg-honey-800/40`
- `bg-blue-100` becomes `bg-lavender-100 dark:bg-lavender-800/40`

Icon colors:
- `text-amber-600` becomes `text-honey-600 dark:text-honey-400`
- `text-blue-600` becomes `text-lavender-600 dark:text-lavender-400`

Text colors -- apply the full set of replacements across all ~29 instances:
- `text-amber-800` to `text-honey-800 dark:text-honey-200`
- `text-amber-700` to `text-honey-700 dark:text-honey-300`
- `text-amber-600` to `text-honey-600 dark:text-honey-400`
- `text-amber-500` to `text-honey-500 dark:text-honey-400`
- `text-amber-400` to `text-honey-400 dark:text-honey-500`
- `text-blue-800` to `text-lavender-800 dark:text-lavender-200`
- `text-blue-700` to `text-lavender-700 dark:text-lavender-300`
- `text-blue-600` to `text-lavender-600 dark:text-lavender-400`
- `text-blue-500` to `text-lavender-500 dark:text-lavender-400`
- `text-blue-400` to `text-lavender-400 dark:text-lavender-500`

Hover backgrounds:
- `hover:bg-amber-100` becomes `hover:bg-honey-100 dark:hover:bg-honey-800/40`
- `hover:bg-blue-100` becomes `hover:bg-lavender-100 dark:hover:bg-lavender-800/40`

Intervention panels:
- `bg-amber-100/50` becomes `bg-honey-100/50 dark:bg-honey-800/30`
- `bg-blue-100/50` becomes `bg-lavender-100/50 dark:bg-lavender-800/30`

Priority badge (line 223):
- `bg-amber-200 text-amber-700` becomes `bg-honey-200 text-honey-700 dark:bg-honey-800 dark:text-honey-300`

Expanded section border:
- `border-amber-200` becomes `border-honey-200 dark:border-honey-800`
- `border-blue-200` becomes `border-lavender-200 dark:border-lavender-800`

Severity dots in expanded insights (lines 180-186):
- `bg-amber-500` becomes `bg-honey-500 dark:bg-honey-400`
- `bg-amber-400` becomes `bg-honey-400 dark:bg-honey-500`
- `bg-amber-300` becomes `bg-honey-300 dark:bg-honey-600`

Learn more link:
- `text-amber-600 hover:text-amber-700` becomes `text-honey-600 hover:text-honey-700 dark:text-honey-400 dark:hover:text-honey-300`
- `text-blue-600 hover:text-blue-700` becomes `text-lavender-600 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300`

#### 2. DaylightStatusBar.jsx (`/Users/michaelbond/echo-vault/src/components/environment/DaylightStatusBar.jsx`)

**Current state:** Defines two color mapping objects (`colorClasses` and `iconColorClasses`) with 6 entries each using generic Tailwind colors. Also has a progress bar with conditional green/amber/orange colors.

**Target state:** Replace all color mappings with Hearthside palette and add dark variants.

**Key changes:**

The `getStatus()` return values -- change the `color` keys to match new palette names:
- `'amber'` stays as a key name but maps to honey palette in colorClasses
- `'orange'` stays as a key name but maps to terra palette
- `'blue'` stays as a key name but maps to lavender palette
- `'slate'` stays as a key name but maps to warm palette
- `'indigo'` stays as a key name but maps to lavender-dark palette
- `'warm'` stays as-is (already on palette)

Replace the `colorClasses` object (lines 83-90):
```javascript
const colorClasses = {
  amber: 'bg-honey-100 text-honey-700 border-honey-200 dark:bg-honey-900/30 dark:text-honey-300 dark:border-honey-800',
  orange: 'bg-terra-100 text-terra-700 border-terra-200 dark:bg-terra-900/30 dark:text-terra-300 dark:border-terra-800',
  blue: 'bg-lavender-100 text-lavender-700 border-lavender-200 dark:bg-lavender-900/30 dark:text-lavender-300 dark:border-lavender-800',
  slate: 'bg-warm-100 text-warm-700 border-warm-200 dark:bg-warm-800/30 dark:text-warm-300 dark:border-warm-700',
  indigo: 'bg-lavender-200 text-lavender-800 border-lavender-300 dark:bg-lavender-900/40 dark:text-lavender-300 dark:border-lavender-700',
  warm: 'bg-warm-100 text-warm-700 border-warm-200 dark:bg-warm-800/30 dark:text-warm-300 dark:border-warm-700'
};
```

Replace the `iconColorClasses` object (lines 92-99):
```javascript
const iconColorClasses = {
  amber: 'text-honey-500 dark:text-honey-400',
  orange: 'text-terra-500 dark:text-terra-400',
  blue: 'text-lavender-500 dark:text-lavender-400',
  slate: 'text-warm-500 dark:text-warm-400',
  indigo: 'text-lavender-600 dark:text-lavender-400',
  warm: 'text-warm-500 dark:text-warm-400'
};
```

The inner icon container (line 116):
- `bg-white/50` becomes `bg-white/50 dark:bg-white/10`

The progress bar background (line 130):
- `bg-white/50` becomes `bg-white/50 dark:bg-white/10`

Progress bar fill colors (lines 136-139):
- `bg-orange-400` (under 1 hour) becomes `bg-terra-400 dark:bg-terra-500`
- `bg-amber-400` (under 3 hours) becomes `bg-honey-400 dark:bg-honey-500`
- `bg-green-400` (3+ hours) becomes `bg-sage-400 dark:bg-sage-500`

#### 3. LightContextNudge.jsx (`/Users/michaelbond/echo-vault/src/components/environment/LightContextNudge.jsx`)

**Current state:** Uses gradient backgrounds for the floating nudge based on priority level. Only ~2 off-palette gradient instances, but they are visually prominent.

**Target state:** Replace gradients with Hearthside palette colors and add dark variants.

**Key changes:**

The main container gradient (lines 120-124):
- High priority: `from-amber-500 to-orange-500` becomes `from-honey-500 to-terra-500 dark:from-honey-600 dark:to-terra-600`
- Medium priority: `from-blue-500 to-sky-500` becomes `from-lavender-500 to-lavender-400 dark:from-lavender-600 dark:to-lavender-500`
- Low priority: `from-warm-500 to-warm-600` stays as-is (already on palette), add `dark:from-warm-600 dark:to-warm-700`

The rest of this component uses white text on colored backgrounds (`text-white`, `text-white/80`, `text-white/60`, `bg-white/20`, `bg-white/30`), which are already palette-neutral and work in both light and dark modes. No additional changes needed for those.

#### 4. SocialResilienceAlert.jsx (`/Users/michaelbond/echo-vault/src/components/social/SocialResilienceAlert.jsx`)

**Current state:** Defines a `COLOR_MAP` object with 5 color schemes (rose, amber, blue, green, purple) using generic Tailwind classes. The success state also uses green-*. The `NeglectedConnectionsList` sub-component uses blue-600 for "Reach out" links.

**Target state:** Replace COLOR_MAP with Hearthside palette equivalents, add dark variants, and update sub-components.

**Key changes:**

Replace the entire `COLOR_MAP` object (lines 31-72). The key names can stay the same for backward compatibility (nudge data passes `nudge.color` which uses these keys), but the class values change:

```javascript
const COLOR_MAP = {
  rose: {
    bg: 'bg-terra-50 dark:bg-terra-900/30',
    border: 'border-terra-200 dark:border-terra-800',
    icon: 'bg-terra-100 text-terra-600 dark:bg-terra-800/40 dark:text-terra-400',
    title: 'text-terra-800 dark:text-terra-200',
    text: 'text-terra-700 dark:text-terra-300',
    button: 'bg-terra-500 hover:bg-terra-600 text-white dark:bg-terra-600 dark:hover:bg-terra-500'
  },
  amber: {
    bg: 'bg-honey-50 dark:bg-honey-900/30',
    border: 'border-honey-200 dark:border-honey-800',
    icon: 'bg-honey-100 text-honey-600 dark:bg-honey-800/40 dark:text-honey-400',
    title: 'text-honey-800 dark:text-honey-200',
    text: 'text-honey-700 dark:text-honey-300',
    button: 'bg-honey-500 hover:bg-honey-600 text-white dark:bg-honey-600 dark:hover:bg-honey-500'
  },
  blue: {
    bg: 'bg-lavender-50 dark:bg-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-800',
    icon: 'bg-lavender-100 text-lavender-600 dark:bg-lavender-800/40 dark:text-lavender-400',
    title: 'text-lavender-800 dark:text-lavender-200',
    text: 'text-lavender-700 dark:text-lavender-300',
    button: 'bg-lavender-500 hover:bg-lavender-600 text-white dark:bg-lavender-600 dark:hover:bg-lavender-500'
  },
  green: {
    bg: 'bg-sage-50 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-800',
    icon: 'bg-sage-100 text-sage-600 dark:bg-sage-800/40 dark:text-sage-400',
    title: 'text-sage-800 dark:text-sage-200',
    text: 'text-sage-700 dark:text-sage-300',
    button: 'bg-sage-500 hover:bg-sage-600 text-white dark:bg-sage-600 dark:hover:bg-sage-500'
  },
  purple: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/40',
    border: 'border-lavender-300 dark:border-lavender-700',
    icon: 'bg-lavender-200 text-lavender-700 dark:bg-lavender-800/50 dark:text-lavender-300',
    title: 'text-lavender-900 dark:text-lavender-200',
    text: 'text-lavender-800 dark:text-lavender-300',
    button: 'bg-lavender-600 hover:bg-lavender-700 text-white dark:bg-lavender-700 dark:hover:bg-lavender-600'
  }
};
```

Success state (lines 96-113):
- `bg-green-50` becomes `bg-sage-50 dark:bg-sage-900/30`
- `border-green-200` becomes `border-sage-200 dark:border-sage-800`
- `bg-green-100` becomes `bg-sage-100 dark:bg-sage-800/40`
- `text-green-600` becomes `text-sage-600 dark:text-sage-400`
- `text-green-800` becomes `text-sage-800 dark:text-sage-200`
- The `text-green-600 text-sm` message text becomes `text-sage-600 dark:text-sage-400 text-sm`

Secondary action button (line 164):
- `bg-white/50 text-warm-600 hover:bg-white` -- add dark variants: `dark:bg-white/10 dark:text-warm-300 dark:hover:bg-white/20`

Dismiss options section (line 183):
- `bg-white/50` -- add `dark:bg-hearth-850/50`

`NeglectedConnectionsList` component (line 267):
- `text-blue-600 hover:text-blue-700` becomes `text-lavender-600 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300`
- `bg-warm-50` on the list item -- add `dark:bg-warm-800/30`
- `text-warm-800` -- add `dark:text-warm-200`
- `text-warm-500` on "People you haven't mentioned" and days text -- add `dark:text-warm-400`

#### 5. SocialHealthWidget.jsx (`/Users/michaelbond/echo-vault/src/components/social/SocialHealthWidget.jsx`)

**Current state:** Has numerous off-palette colors throughout: blue-400 and rose-400 in the balance meter, blue-50/green-50/purple-50 in quick action buttons, rose-* in isolation alerts, green-* in positive reinforcement, blue-300/rose-300 in timeline bars, and purple-50 in ambiguous connections.

**Target state:** Replace all off-palette colors with Hearthside equivalents and add dark mode.

**Key changes:**

Loading state (line 94):
- `bg-white` -- add `dark:bg-hearth-900`
- `border-warm-200` -- add `dark:border-warm-800`

No data state (line 103):
- `bg-warm-50` -- add `dark:bg-warm-900/30`
- `border-warm-200` -- add `dark:border-warm-800`

Main container (line 118):
- `bg-white` -- add `dark:bg-hearth-900`
- `border-warm-200` -- add `dark:border-warm-800`

Header border (line 121):
- `border-warm-100` -- add `dark:border-warm-800`

Risk level badges (lines 128-134):
- `bg-rose-100 text-rose-600` becomes `bg-terra-100 text-terra-600 dark:bg-terra-900/40 dark:text-terra-400`
- `bg-amber-100 text-amber-600` becomes `bg-honey-100 text-honey-600 dark:bg-honey-900/40 dark:text-honey-400`
- `bg-green-100 text-green-600` becomes `bg-sage-100 text-sage-600 dark:bg-sage-900/40 dark:text-sage-400`

Balance meter (lines 154-159):
- Work portion `bg-blue-400` becomes `bg-lavender-400 dark:bg-lavender-500`
- Personal portion `bg-rose-400` becomes `bg-terra-400 dark:bg-terra-500`
- Background `bg-warm-100` -- add `dark:bg-warm-800`

Balance text labels (lines 167-176):
- `text-blue-600` becomes `text-lavender-600 dark:text-lavender-400`
- `text-rose-600` becomes `text-terra-600 dark:text-terra-400`

Timeline bars (lines 194-200):
- `bg-rose-300` becomes `bg-terra-300 dark:bg-terra-500`
- `bg-blue-300` becomes `bg-lavender-300 dark:bg-lavender-500`
- Timeline border `border-warm-100` -- add `dark:border-warm-800`

Isolation alert section (lines 210-223):
- `bg-rose-50` becomes `bg-terra-50 dark:bg-terra-900/30`
- `border-rose-100` becomes `border-terra-100 dark:border-terra-800`
- `text-rose-500` becomes `text-terra-500 dark:text-terra-400`
- `text-rose-700` becomes `text-terra-700 dark:text-terra-300`
- `text-rose-600` becomes `text-terra-600 dark:text-terra-400`

Neglected connections section (lines 226-241):
- Various `border-warm-*` and `bg-warm-*` classes -- add dark variants
- `bg-warm-100 hover:bg-warm-200` -- add `dark:bg-warm-800 dark:hover:bg-warm-700`

Quick action buttons (lines 247-258):
- `bg-blue-50 hover:bg-blue-100 text-blue-700` becomes `bg-lavender-50 hover:bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:hover:bg-lavender-800/40 dark:text-lavender-300`
- `bg-green-50 hover:bg-green-100 text-green-700` becomes `bg-sage-50 hover:bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:hover:bg-sage-800/40 dark:text-sage-300`
- `bg-purple-50 hover:bg-purple-100 text-purple-700` becomes `bg-lavender-100 hover:bg-lavender-200 text-lavender-800 dark:bg-lavender-900/40 dark:hover:bg-lavender-800/50 dark:text-lavender-300`

Positive reinforcement (lines 265-271):
- `bg-green-50` becomes `bg-sage-50 dark:bg-sage-900/30`
- `text-green-500` becomes `text-sage-500 dark:text-sage-400`
- `text-green-700` becomes `text-sage-700 dark:text-sage-300`

Ambiguous connections (lines 275-293):
- `bg-purple-50 hover:bg-purple-100 text-purple-700` becomes `bg-lavender-100 hover:bg-lavender-200 text-lavender-700 dark:bg-lavender-900/40 dark:hover:bg-lavender-800/50 dark:text-lavender-300`

`SocialHealthCompact` sub-component (lines 315-350):
- `bg-white` -- add `dark:bg-hearth-900`
- `border-warm-200` -- add `dark:border-warm-800`
- `bg-gradient-to-r from-blue-400 to-rose-400` becomes `bg-gradient-to-r from-lavender-400 to-terra-400 dark:from-lavender-500 dark:to-terra-500`
- `text-rose-600` (isolation risk text) becomes `text-terra-600 dark:text-terra-400`
- `text-rose-500` (isolation risk icon) becomes `text-terra-500 dark:text-terra-400`

#### 6. RelationshipCorrectionModal.jsx (`/Users/michaelbond/echo-vault/src/components/social/RelationshipCorrectionModal.jsx`)

**Current state:** Uses rose for personal, blue for work, purple for ambiguous categories. Save button is blue-500. Success state is green-50/green-600. Error state is red-50/red-600.

**Target state:** Replace rose/blue/purple/green with Hearthside palette. Keep red for error state (red for errors is intentional and must NOT be changed per the project risk guidelines).

**Key changes:**

The `CATEGORY_OPTIONS` array color field (lines 16-38):
- Personal `'rose'` key stays as-is (used for conditional mapping below)
- Work `'blue'` key stays as-is
- Ambiguous `'purple'` key stays as-is

The conditional selection styling (lines 140-147) -- replace the inline ternary color checks:
- `border-rose-300 bg-rose-50` becomes `border-terra-300 bg-terra-50 dark:border-terra-700 dark:bg-terra-900/30`
- `border-blue-300 bg-blue-50` becomes `border-lavender-300 bg-lavender-50 dark:border-lavender-700 dark:bg-lavender-900/30`
- `border-purple-300 bg-purple-50` becomes `border-honey-300 bg-honey-50 dark:border-honey-700 dark:bg-honey-900/30`
- Unselected: `border-warm-200 hover:border-warm-300 bg-white` -- add `dark:border-warm-700 dark:hover:border-warm-600 dark:bg-hearth-850`

Icon container selected states (lines 149-157):
- `bg-rose-200 text-rose-600` becomes `bg-terra-200 text-terra-600 dark:bg-terra-800/50 dark:text-terra-400`
- `bg-blue-200 text-blue-600` becomes `bg-lavender-200 text-lavender-600 dark:bg-lavender-800/50 dark:text-lavender-400`
- `bg-purple-200 text-purple-600` becomes `bg-honey-200 text-honey-600 dark:bg-honey-800/50 dark:text-honey-400`
- Unselected: `bg-warm-100 text-warm-500` -- add `dark:bg-warm-800 dark:text-warm-400`

Check icon colors (lines 164-169):
- `text-rose-500` becomes `text-terra-500 dark:text-terra-400`
- `text-blue-500` becomes `text-lavender-500 dark:text-lavender-400`
- `text-purple-500` becomes `text-honey-500 dark:text-honey-400`

Modal container (line 96):
- `bg-white` becomes `bg-white dark:bg-hearth-900`

Error state (lines 184-189):
- **Keep `bg-red-50 text-red-600` unchanged** -- red for errors is intentional. Add only dark variant: `dark:bg-red-900/30 dark:text-red-400`

Success state (lines 193-199):
- `bg-green-50` becomes `bg-sage-50 dark:bg-sage-900/30`
- `text-green-600` becomes `text-sage-600 dark:text-sage-400`

Save button (lines 213-218):
- `bg-blue-500 hover:bg-blue-600 text-white` becomes `bg-lavender-500 hover:bg-lavender-600 text-white dark:bg-lavender-600 dark:hover:bg-lavender-500`

Cancel button (lines 205-207):
- `bg-warm-100 hover:bg-warm-200 text-warm-700` -- add dark: `dark:bg-warm-800 dark:hover:bg-warm-700 dark:text-warm-300`

Disabled save state:
- `bg-warm-200 text-warm-400` -- add `dark:bg-warm-800 dark:text-warm-500`

Header (line 100):
- `border-warm-100` -- add `dark:border-warm-800`

Current detection section (line 119):
- `bg-warm-50` -- add `dark:bg-warm-900/30`
- `border-warm-100` -- add `dark:border-warm-800`

Actions footer border (line 203):
- `border-warm-100` -- add `dark:border-warm-800`

---

## Implementation Checklist

1. Update `/Users/michaelbond/echo-vault/src/components/environment/SADInsightCard.jsx` -- Replace all ~29 off-palette instances with honey/lavender + dark mode variants
2. Update `/Users/michaelbond/echo-vault/src/components/environment/DaylightStatusBar.jsx` -- Replace colorClasses and iconColorClasses objects + progress bar colors with Hearthside palette + dark mode
3. Update `/Users/michaelbond/echo-vault/src/components/environment/LightContextNudge.jsx` -- Replace gradient backgrounds with Hearthside palette + dark mode
4. Update `/Users/michaelbond/echo-vault/src/components/social/SocialResilienceAlert.jsx` -- Replace COLOR_MAP and success state with Hearthside palette + dark mode, update NeglectedConnectionsList
5. Update `/Users/michaelbond/echo-vault/src/components/social/SocialHealthWidget.jsx` -- Replace balance meter, quick actions, alerts, reinforcement, timeline, and compact variant with Hearthside palette + dark mode
6. Update `/Users/michaelbond/echo-vault/src/components/social/RelationshipCorrectionModal.jsx` -- Replace category selection colors, save button, success state with Hearthside palette + dark mode. Keep red for error state.
7. Run grep verification to confirm zero remaining off-palette instances (excluding red in error states)

## Critical Reminders

- **DO NOT change `red-*` used for error states** in RelationshipCorrectionModal.jsx. Red for errors/danger is intentional per the safety-color audit criteria.
- **DO NOT change any component logic, props, or data flow.** This is a visual-only change.
- The `COLOR_MAP` key names in SocialResilienceAlert.jsx (rose, amber, blue, green, purple) must remain unchanged because external nudge data references them by name. Only the class string values change.
- The `colorClasses` and `iconColorClasses` key names in DaylightStatusBar.jsx (amber, orange, blue, slate, indigo, warm) must remain unchanged because the `getStatus()` function references them.
- Every `bg-white` container should get a `dark:bg-hearth-900` or `dark:bg-hearth-850` variant for proper dark mode support.
- The `bg-white/50` and similar transparency-based backgrounds should get `dark:bg-white/10` or `dark:bg-hearth-850/50` equivalents.

---

## Implementation Notes (Actual)

**Implemented:** 2026-02-20

### Files Modified
1. `src/components/environment/SADInsightCard.jsx` - All ~29 off-palette instances replaced with honey/lavender + 30 dark: variants
2. `src/components/environment/DaylightStatusBar.jsx` - colorClasses and iconColorClasses objects replaced + progress bar colors + 17 dark: variants
3. `src/components/environment/LightContextNudge.jsx` - Gradient backgrounds replaced + 3 dark: variants
4. `src/components/social/SocialResilienceAlert.jsx` - COLOR_MAP fully replaced + success state + NeglectedConnectionsList + dismiss area + 45 dark: variants
5. `src/components/social/SocialHealthWidget.jsx` - Balance meter, risk badges, timeline, isolation alert, quick actions, positive reinforcement, ambiguous connections, compact variant + 46 dark: variants
6. `src/components/social/RelationshipCorrectionModal.jsx` - Category selection, save button, success state + modal/header dark variants + 28 dark: variants. Red error state preserved.

### Deviations from Plan
- **Purple -> honey mapping for ambiguous category** in RelationshipCorrectionModal.jsx: The plan's general mapping table says purple -> lavender, but the file-specific instructions correctly use honey for the "ambiguous" category to differentiate it from "work" (which also uses lavender). Followed the file-specific instructions.

### Code Review Fixes Applied
1. Fixed warm-400/warm-500 inversion on balance label dark mode text (SocialHealthWidget.jsx)
2. Added missing dark: variants on loading spinner and no-data icon (SocialHealthWidget.jsx)

### Verification
- Grep confirmed zero off-palette instances (amber-, blue-, sky-, orange-, green-, rose-, purple-, indigo-, slate-) across all 6 files
- Red error state preserved in RelationshipCorrectionModal.jsx with dark variant added
- All 615 tests pass (38 test files)