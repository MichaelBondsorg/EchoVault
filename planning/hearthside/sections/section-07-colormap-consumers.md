Now I have all the context I need. Let me produce the section content.

# Section 07: colorMap Consumer Updates

## Overview

This section covers updating three high-impact components to import semantic color mappings from the centralized `colorMap.js` utility instead of using inline off-palette Tailwind classes. The three target files are:

- **`/Users/michaelbond/echo-vault/src/components/entries/EntryCard.jsx`** (~41 off-palette instances)
- **`/Users/michaelbond/echo-vault/src/components/modals/InsightsPanel.jsx`** (~16 off-palette instances)
- **`/Users/michaelbond/echo-vault/src/components/modals/DailySummaryModal.jsx`** (~14 off-palette instances)

These three components are the primary consumers of semantic color assignments: entity badges, entry type badges, pattern type colors, and therapeutic framework displays. By switching them to `colorMap.js` imports, the palette becomes centrally managed and dark mode comes along automatically.

## Dependencies

This section requires the following sections to be completed first:

- **section-02-color-map**: Provides `src/utils/colorMap.js` with `getEntryTypeColors()`, `getPatternTypeColors()`, `getEntityTypeColors()`, and `getTherapeuticColors()` functions.
- **section-03-css-components**: Provides the extended CSS component classes in `src/index.css` with dark mode variants.
- **section-05-font-loading**: Provides the Caveat font split (relevant because Caveat integration touchpoints overlap with some of these components).

This section does not block any other section.

---

## Tests First

All tests for this section are file-content verification (grep-based) rather than runtime unit tests. They confirm that off-palette color classes have been removed from the three target files.

### Test File: `/Users/michaelbond/echo-vault/src/utils/__tests__/colormapConsumers.test.js`

```
# Test: EntryCard does not contain off-palette color classes (grep for green-50, amber-50, blue-50, purple-50, orange-50, teal-*, pink-*)
# Test: InsightsPanel does not contain off-palette color classes
# Test: DailySummaryModal does not contain off-palette color classes
```

These tests read the source files and verify no off-palette generic Tailwind classes remain. They should be implemented as Vitest tests that use `fs.readFileSync` to load each component file and assert the absence of specific color class patterns.

**Specific off-palette patterns to check for in each file:**

For **EntryCard.jsx**, assert absence of:
- `green-50`, `green-100`, `green-600`, `green-700`, `green-800` (entity badges, celebration, CBT reframe)
- `amber-50`, `amber-100`, `amber-600`, `amber-700`, `amber-800` (entity badges, committed action, values context)
- `blue-50`, `blue-600`, `blue-700` (entity badges, weather context)
- `purple-50`, `purple-600`, `purple-700` (entity badges, sleep context)
- `orange-50`, `orange-100`, `orange-600`, `orange-700` (entity badges, HRV)
- `teal-50`, `teal-100`, `teal-600`, `teal-700`, `teal-800`, `teal-900` (ACT framework, mixed entry type)
- `pink-100`, `pink-700` (vent entry type)
- `emerald-50` (celebration)
- `rose-50`, `rose-600` (self entity tag)
- `slate-50`, `slate-600` (topic entity tag)
- `yellow-50`, `yellow-100`, `yellow-200`, `yellow-700` (task entry type, task card background)

**Exception:** `red-*` classes used for crisis/safety/danger/delete contexts are intentionally kept and should NOT be flagged. Specifically, `red-400` on the delete button and `red-50`/`red-100`/`red-200`/`red-700`/`red-800` on the crisis insight box and the "Never show again" dismiss button are legitimate uses of red.

For **InsightsPanel.jsx**, assert absence of:
- `green-50`, `green-200`, `green-500`, `green-600` (positive activity, activity section header)
- `amber-50`, `amber-200`, `amber-500`, `amber-600` (best day, trigger, absence warning)
- `blue-50`, `blue-200`, `blue-500`, `blue-600` (worst day, temporal section header)
- `purple-50`, `purple-200`, `purple-500`, `purple-600` (sentiment contradiction, contradictions header)
- `orange-50`, `orange-200`, `orange-500` (goal abandonment)
- `violet-50`, `violet-200`, `violet-500`, `violet-600` (shadow friction)
- `indigo-50`, `indigo-200`, `indigo-500`, `indigo-600` (linguistic shift, avoidance contradiction)
- `pink-50`, `pink-200`, `pink-500` (recovery pattern)

**Exception:** `red-50`, `red-100`, `red-600` on the "Never show again" dismiss button and `red-400` on `negative_activity` icon are safety/destructive action uses and may remain. Review individually.

For **DailySummaryModal.jsx**, assert absence of:
- `yellow-100`, `yellow-700` (task entry type badge)
- `teal-100`, `teal-700` (mixed entry type badge)
- `pink-100`, `pink-700` (vent entry type badge)

**Exception:** `red-400` on the delete button is intentional.

---

## Implementation Details

### 1. EntryCard.jsx (`/Users/michaelbond/echo-vault/src/components/entries/EntryCard.jsx`)

This is the largest consumer with ~41 off-palette instances across several categories. Import the colorMap functions at the top of the file:

```javascript
import { getEntryTypeColors, getEntityTypeColors, getTherapeuticColors } from '../../utils/colorMap';
```

#### 1a. Entity Tag Badges (Lines 383-407)

The tag rendering section has a long if/else chain mapping entity prefixes (`@person:`, `@place:`, `@goal:`, `@activity:`, `@event:`, `@food:`, `@media:`, `@situation:`, `@self:`, `@topic:`) to inline color classes. Replace each branch with a call to `getEntityTypeColors()`.

**Current pattern (repeated for each entity type):**
```jsx
<span className="text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
```

**Target pattern:**
```jsx
const colors = getEntityTypeColors('place');
<span className={`text-[10px] font-semibold ${colors.text} ${colors.bg} px-2 py-0.5 rounded-full`}>
```

The entity type mapping from tag prefix to colorMap key:
- `@person:` maps to `'person'`
- `@place:` maps to `'place'`
- `@goal:` maps to `'goal'`
- `@activity:` maps to `'activity'`
- `@event:` maps to `'event'`
- `@food:` maps to `'food'`
- `@media:` maps to `'media'`
- `@situation:` maps to `'situation'` (or closest match in colorMap)
- `@self:` maps to `'self'` (or closest match)
- `@topic:` maps to `'topic'` (or closest match)

If `getEntityTypeColors` does not define a key for `@situation`, `@self`, or `@topic`, add those mappings in colorMap.js (coordinate with section-02) or use the fallback return. The implementer should verify that colorMap.js covers all entity types present in EntryCard. If not, use the fallback and file a note.

#### 1b. Entry Type Badges (Lines 361-368)

The entry type badge uses inline ternary logic:
```jsx
isTask ? 'bg-yellow-100 text-yellow-700' :
isMixed ? 'bg-teal-100 text-teal-700' :
isVent ? 'bg-pink-100 text-pink-700' : 'bg-warm-100 text-warm-600'
```

Replace with:
```jsx
const entryColors = getEntryTypeColors(entryType);
// Then use entryColors.bg and entryColors.text
```

The `getEntryTypeColors` function returns objects with both light and dark mode classes combined (e.g., `'bg-honey-100 dark:bg-honey-900/30'`), so dark mode comes for free.

Also update the task card background on line 140-142:
```jsx
const cardStyle = isTask
  ? 'bg-yellow-50 border-yellow-200'
  : 'bg-white border-warm-100';
```
Replace `bg-yellow-50 border-yellow-200` with the appropriate Hearthside equivalent from `getEntryTypeColors('task')` or use `bg-honey-50 border-honey-200 dark:bg-honey-900/20 dark:border-honey-800`.

#### 1c. Therapeutic Framework Displays

**Celebration section (Lines 200-214):** Currently uses `from-green-50 to-emerald-50`, `border-green-100`, `text-green-700`, `text-green-800`, `text-green-600`. Replace with `getTherapeuticColors('celebration')` which should return sage-palette equivalents with dark mode variants.

**ACT framework section (Lines 217-270):** Currently uses extensive `teal-*` classes (`teal-50`, `teal-100`, `teal-600`, `teal-700`, `teal-800`, `teal-900`, `teal-300`). Replace with `getTherapeuticColors('ACT')` which should return lavender-palette or sage-palette equivalents.

**ACT values context (Lines 249-256):** Uses `amber-600` and `amber-800` for the values compass. Replace with `getTherapeuticColors('values')`.

**ACT committed action (Lines 261-268):** Uses `amber-50`, `amber-100`, `amber-700`, `amber-800`, `amber-600`. Replace with `getTherapeuticColors('committed_action')` which should return honey-palette equivalents.

**CBT reframe text (Lines 320-323):** Uses `text-green-700` and `text-green-800` for "Try thinking:" text. Replace with sage-palette equivalents from `getTherapeuticColors('CBT')` or direct Hearthside classes (`text-sage-700 dark:text-sage-300`).

**Legacy CBT challenge (Line 345):** Uses `text-green-700` inside the challenge section. Replace with sage-palette equivalent.

#### 1d. Insight Box Colors (Lines 155-179)

The positive insight uses `bg-green-50 border-green-100 text-green-800`. Replace with sage-palette equivalents: `bg-sage-50 border-sage-100 text-sage-800 dark:bg-sage-900/30 dark:border-sage-800 dark:text-sage-200`.

The warning insight uses `bg-red-50 border-red-100 text-red-800`. This is a **safety-adjacent** display (warnings about user patterns). Review individually -- if it represents a genuine warning/alert state, keep the red. If it is purely decorative, convert to terra-palette.

#### 1e. Health Context Strip (Lines 534-633)

**PrimaryReadinessMetric component (Lines 39-94):** Uses health-metric color coding:
- Recovery score: `bg-green-100 text-green-700 border-green-200` (good), `bg-yellow-100 text-yellow-700 border-yellow-200` (moderate), `bg-red-100 text-red-700 border-red-200` (low)
- Sleep score: `bg-green-100`, `bg-purple-100 text-purple-700`, `bg-orange-100 text-orange-700`
- Sleep hours fallback: `bg-green-50 text-green-700`, `bg-yellow-50 text-yellow-700`, `bg-red-50 text-red-700`

These are health-metric status indicators. Convert to Hearthside palette:
- Good/high: `sage` palette (green equivalent)
- Moderate/medium: `honey` palette (yellow/amber equivalent)
- Low/poor: `terra` palette (orange/red equivalent) -- except genuine danger (very low recovery) which may keep red per safety audit criteria
- Sleep purple: `lavender` palette

**Weather context (Line 545):** `bg-blue-50 text-blue-700` -- replace with `bg-lavender-50 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300`.

**Day summary (Line 556):** `bg-slate-50 text-slate-600` -- replace with `bg-warm-50 text-warm-600 dark:bg-warm-900/30 dark:text-warm-300`.

**Sunshine percent (Line 571):** `text-amber-600` -- replace with `text-honey-600 dark:text-honey-400`.

**Sleep hours secondary (Line 593):** `bg-purple-50 text-purple-700` -- replace with `bg-lavender-50 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300`.

**HRV (Lines 601-608):** `bg-green-50 text-green-700` (improving), `bg-orange-50 text-orange-700` (declining) -- replace with sage/terra equivalents.

**Strain (Lines 613-617):** `bg-red-50 text-red-700` (high), `bg-orange-50 text-orange-700` (moderate), `bg-blue-50 text-blue-700` (low) -- convert to terra (high strain could remain terra since it is a warning indicator, not safety-critical), honey, lavender.

**Steps (Line 625):** `bg-green-50 text-green-700` -- replace with `bg-sage-50 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300`.

#### 1f. Edit Save Button (Line 501)

`text-green-600 hover:text-green-700` on the check/save button. Replace with `text-sage-600 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300`.

---

### 2. InsightsPanel.jsx (`/Users/michaelbond/echo-vault/src/components/modals/InsightsPanel.jsx`)

This component has two switch/case blocks (`getPatternIcon` and `getPatternColor`) that map pattern types to inline color classes. Replace both with `getPatternTypeColors()` from colorMap.

Import at the top:
```javascript
import { getPatternTypeColors } from '../../utils/colorMap';
```

#### 2a. `getPatternColor` Function (Lines 106-134)

The entire switch statement maps pattern types to `bg-*/border-*` class pairs. Replace with a single call to `getPatternTypeColors(type)` which returns `{ bg, border, text }`.

**Current off-palette mappings to replace:**
| Pattern Type | Current | Target Palette |
|---|---|---|
| `weekly_high` | `bg-green-50 border-green-200` | sage |
| `best_day` | `bg-amber-50 border-amber-200` | honey |
| `worst_day` | `bg-blue-50 border-blue-200` | lavender |
| `positive_activity` | `bg-green-50 border-green-200` | sage |
| `negative_activity` | `bg-red-50 border-red-200` | terra |
| `shadow_friction` | `bg-violet-50 border-violet-200` | lavender (dark) |
| `absence_warning` | `bg-amber-50 border-amber-200` | honey |
| `linguistic_shift` | `bg-indigo-50 border-indigo-200` | lavender |
| `trigger_correlation` | `bg-amber-50 border-amber-200` | honey |
| `trigger` | `bg-amber-50 border-amber-200` | honey |
| `goal_abandonment` | `bg-orange-50 border-orange-200` | terra |
| `sentiment_contradiction` | `bg-purple-50 border-purple-200` | lavender |
| `avoidance_contradiction` | `bg-indigo-50 border-indigo-200` | lavender |
| `recovery_pattern` | `bg-pink-50 border-pink-200` | sage (recovery = positive) or accent |

All replacements include dark mode variants (provided by `getPatternTypeColors()`).

The `weekly_low` case already uses `bg-lavender-50 border-lavender-400` (on-palette) and `monthly_summary` already uses `bg-lavender-50 border-lavender-200` (on-palette). These are fine to keep or migrate to use `getPatternTypeColors()` for consistency.

#### 2b. `getPatternIcon` Function (Lines 76-103)

The icon colors also use off-palette classes. Replace each icon's `className` with the text color from `getPatternTypeColors()`:

**Current off-palette icon colors to replace:**
- `text-amber-500` (best_day, trigger_correlation, trigger, absence_warning) -- replace with `text-honey-500`
- `text-blue-500` (worst_day) -- replace with `text-lavender-500`
- `text-green-500` (positive_activity) -- replace with `text-sage-500`
- `text-violet-500` (shadow_friction) -- replace with `text-lavender-600`
- `text-indigo-500` (linguistic_shift, avoidance_contradiction) -- replace with `text-lavender-500`
- `text-orange-500` (goal_abandonment) -- replace with `text-terra-500`
- `text-purple-500` (sentiment_contradiction) -- replace with `text-lavender-600`
- `text-pink-500` (recovery_pattern) -- replace with `text-sage-500` or `text-accent`

The `text-red-400` on `negative_activity` is borderline. It represents a pattern where activities correlate with lower mood. This is not a safety/crisis indicator, so convert to `text-terra-500`.

#### 2c. Section Headers (Lines 347, 370, 392, 414, 438, 463)

Each `SectionHeader` receives a `color` prop with off-palette classes:
- `text-amber-600` (Heads Up) -- replace with `text-honey-600 dark:text-honey-400`
- `text-indigo-600` (Your Self-Talk) -- replace with `text-lavender-600 dark:text-lavender-400`
- `text-purple-600` (Worth Reflecting On) -- replace with `text-lavender-600 dark:text-lavender-400`
- `text-violet-600` (Relationship Dynamics) -- replace with `text-lavender-600 dark:text-lavender-400`
- `text-green-600` (Activities & Mood) -- replace with `text-sage-600 dark:text-sage-400`
- `text-blue-600` (Time Patterns) -- replace with `text-lavender-600 dark:text-lavender-400`

#### 2d. Dark Mode for Panel Shell

While replacing pattern colors, also add dark mode classes to the panel's structural elements:
- Panel background `bg-white` (line 295) -- add `dark:bg-hearth-900`
- Header gradient `from-honey-500 to-honey-600` (line 297) -- already on-palette, add `dark:from-honey-700 dark:to-honey-800`
- Footer `bg-warm-50` (line 512) -- add `dark:bg-hearth-850`
- Empty state circle `bg-warm-100` (line 322) -- add `dark:bg-hearth-800`
- Text colors throughout -- add dark mode text variants

---

### 3. DailySummaryModal.jsx (`/Users/michaelbond/echo-vault/src/components/modals/DailySummaryModal.jsx`)

This component has ~14 off-palette instances, primarily in entry type badges.

Import at the top:
```javascript
import { getEntryTypeColors } from '../../utils/colorMap';
```

#### 3a. Entry Type Badges (Lines 117-121)

Identical pattern to EntryCard -- the same ternary chain for task/mixed/vent:
```jsx
entry.entry_type === 'task' ? 'bg-yellow-100 text-yellow-700' :
entry.entry_type === 'mixed' ? 'bg-teal-100 text-teal-700' :
entry.entry_type === 'vent' ? 'bg-pink-100 text-pink-700' : 'bg-warm-100 text-warm-600'
```

Replace with:
```jsx
const typeColors = getEntryTypeColors(entry.entry_type);
// Then use `${typeColors.bg} ${typeColors.text}`
```

This is the only off-palette color issue in DailySummaryModal. The rest of the component already uses on-palette colors (lavender, warm, honey).

#### 3b. Dark Mode for Modal Shell

While updating, add dark mode classes to the modal's structural elements:
- Modal background `bg-white` (line 53) -- add `dark:bg-hearth-900`
- Entry cards `border border-warm-100` (line 111) -- add `dark:border-hearth-800`
- Text colors `text-warm-800`, `text-warm-600`, `text-warm-500` -- add dark variants

---

## Red-Color Audit Criteria

Per the project risk considerations, red classes in these files require individual review:

**EntryCard.jsx:**
- `text-red-400` on delete button (line 441): **Keep** -- destructive action, appropriate use of red.
- `bg-red-100 text-red-700 border-red-200` on low recovery metric (line 56): **Review** -- this is a health warning indicator. Could keep red for genuine health danger or convert to terra for visual consistency. Recommended: keep red for health warnings under 34% recovery.
- `bg-red-50 text-red-700` on very low sleep hours (line 84): **Review** -- same as above, keep red for health concern.
- `bg-red-50 text-red-700` on high strain (line 614): **Review** -- strain over 15 is a physical stress indicator, keep red.
- `bg-red-50 border-red-100 text-red-800` on warning insight (line 160): **Review** -- this represents AI-detected warning patterns. Keep red as it signals genuine concern.

**InsightsPanel.jsx:**
- `bg-red-50 border-red-200` on negative_activity pattern (line 115): **Convert** to terra -- this is not a safety indicator, just a negative mood correlation.
- `text-red-400` on negative_activity icon (line 85): **Convert** to `text-terra-500`.
- `bg-red-50 hover:bg-red-100 text-red-600` on "Never show again" button (line 234): **Keep** -- destructive/permanent action, appropriate red.

**DailySummaryModal.jsx:**
- `text-red-400` on delete button (line 127): **Keep** -- destructive action.

---

## Caveat Font Integration Note

Section 05 handles font loading, and section 16 handles Caveat integration touchpoints. However, while working in EntryCard.jsx, the implementer may notice natural touchpoints for `font-hand` (Caveat), such as:
- The "Try:" text in ACT defusion (line 243)
- The "Nice!" celebration header (line 205)

Do NOT add Caveat in this section. Caveat integration is handled in section-16 to ensure consistent application across the app. Focus only on color migration here.

---

## Summary of Changes

| File | Action | Off-Palette Count |
|------|--------|-------------------|
| `src/components/entries/EntryCard.jsx` | Import colorMap functions; replace entity badges (using hoisted ENTITY_EMOJIS/ENTITY_PREFIXES constants), entry type badges, therapeutic framework colors (celebration/ACT/CBT with destructured color vars), health metric colors, weather/day-summary/HRV/strain/steps context colors with Hearthside palette + dark mode. Red kept for health warnings and delete buttons with @color-safe annotations. | ~41 |
| `src/components/modals/InsightsPanel.jsx` | Import `getPatternTypeColors`; replace `getPatternColor` switch with single colorMap call; replace icon colors in `getPatternIcon`; update 6 section header colors to Hearthside palette; add dark mode to panel shell, empty state, and footer. | ~16 |
| `src/components/modals/DailySummaryModal.jsx` | Import `getEntryTypeColors`; replace entry type badge ternary with IIFE using colorMap; add dark mode to modal shell and entry card borders. | ~14 |
| `src/utils/colorMap.js` | Added missing entity types (@situation, @self, @topic) and pattern types (shadow_friction, absence_warning, linguistic_shift, trigger, monthly_summary); updated TAILWIND_SAFELIST. | Modified |
| `src/utils/__tests__/colormapConsumers.test.js` | 25 grep-based verification tests across all three consumer files. | New file |

**Total off-palette instances addressed:** ~71

## Deviations from Plan
- **`@person` entity tag**: Was already on sage-palette; now changed to terra per colorMap design (user confirmed)
- **`best_day` pattern**: Plan suggested honey but kept as sage (groups with positive patterns; user confirmed)
- **Performance optimization**: Hoisted entity emoji map to module-level constants (not in plan)
- **Therapeutic color calls**: Destructured into local variables in celebration/ACT blocks (not in plan)
- **Dark mode shell text colors**: Deferred to section-17-dark-mode-polish (InsightsPanel text-warm-800, DailySummaryModal text-warm-*)