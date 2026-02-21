I now have a comprehensive understanding of all files and their off-palette instances. Let me produce the section content.

# Section 15: Legacy Screens

## Overview

This section covers the Hearthside palette migration and dark mode integration for "legacy" screens -- components that predate the most recent feature additions but still use off-palette generic Tailwind colors. The screens in scope are:

- **WhatsNewModal.jsx** -- the post-update feature announcement modal
- **HealthSettingsScreen.jsx** -- health data source connection and backfill UI
- **MorningCompass.jsx** -- morning dashboard view
- **MidDayCheckIn.jsx** -- midday dashboard view
- **EveningMirror.jsx** -- evening dashboard view
- **ShelterView.jsx** -- low-mood / burnout safe space with grounding exercises

There is no standalone onboarding flow file in the codebase at this time. If one is added in a future section, it should follow the same Hearthside patterns described here.

## Dependencies

This section depends on:

- **section-01-tokens-config**: `hearth-850` token, gradient presets, Tailwind safelist must exist in `tailwind.config.js`
- **section-02-color-map**: `src/utils/colorMap.js` must exist with `getEntityTypeColors()`, `getEntryTypeColors()`, `getPatternTypeColors()`, `getTherapeuticColors()`, and `HEX_COLORS` exports
- **section-03-css-components**: Dark mode variants for `.card`, `.btn-*`, `.badge-*`, `.modal-*`, `.input` must be in `src/index.css`. Gradient utility classes (`.gradient-hearth-glow`, `.gradient-sage-mist`, etc.) must be available.

This section does not block any other sections and can be implemented in parallel with sections 07 through 14.

---

## Tests First

All tests for this section are file-content grep-based verification tests. They confirm that off-palette colors have been removed and dark mode classes have been added. These can be implemented as a Vitest test file or as a standalone verification script.

**Test file:** `src/utils/__tests__/legacyScreens.test.js`

```
# Test: WhatsNewModal.jsx does not contain off-palette color classes
#   grep for: red-400, pink-500, red-500, amber-500, red-600, amber-600, red-100, red-500, amber-100, amber-500, blue-100, blue-500, green-100, green-500
#   Expected: zero matches (all replaced with Hearthside palette)

# Test: WhatsNewModal.jsx modal container has dark mode variant
#   grep for: dark:bg- on the modal panel element
#   Expected: at least 1 match

# Test: HealthSettingsScreen.jsx does not contain off-palette teal/blue/purple/indigo/green/orange/sky classes
#   grep for: teal-100, teal-200, teal-500, teal-600, teal-700, teal-800,
#             blue-100, blue-500, blue-700, purple-100, purple-600, purple-700,
#             indigo-50, indigo-500, green-50, green-100, green-200, green-500, green-600, green-700, green-800,
#             orange-50, orange-500, amber-50, amber-200, amber-500, amber-600, amber-800,
#             sky-50, sky-200, sky-400, sky-500, sky-600, sky-700, sky-800
#   Expected: zero matches

# Test: HealthSettingsScreen.jsx has dark mode variants on key containers
#   grep for: dark: prefix
#   Expected: significant count (at least 15)

# Test: MorningCompass.jsx does not contain off-palette color classes
#   grep for: blue-50, blue-100, blue-500, blue-800, indigo-50, amber-500, amber-700
#   Expected: zero matches

# Test: MorningCompass.jsx has dark mode variants
#   grep for: dark: prefix
#   Expected: at least 5 matches

# Test: MidDayCheckIn.jsx does not contain off-palette color classes
#   grep for: blue-50, blue-100, blue-200, blue-500, blue-700, blue-800, indigo-50, green-50, green-100, green-500, green-700, green-800, emerald-50
#   Expected: zero matches

# Test: MidDayCheckIn.jsx has dark mode variants
#   grep for: dark: prefix
#   Expected: at least 8 matches

# Test: EveningMirror.jsx does not contain off-palette color classes
#   grep for: green-50, green-100, green-200, green-500, green-600, green-700, green-800, emerald-50, violet-200
#   Expected: zero matches

# Test: EveningMirror.jsx has dark mode variants
#   grep for: dark: prefix
#   Expected: at least 6 matches

# Test: ShelterView.jsx does not contain off-palette teal/blue/purple/green/cyan/gray classes
#   grep for: teal-50, teal-100, teal-200, teal-400, teal-500, teal-600, teal-700, teal-800,
#             blue-100, blue-200, blue-500, blue-700, blue-900,
#             purple-100, purple-200, purple-500, purple-700, purple-900,
#             cyan-50, green-400, green-500, gray-800, gray-900,
#             indigo-900
#   Expected: zero matches
#   Note: rose-* and amber-* in ShelterView hero/burnout contexts must be assessed individually.
#         rose-* for the Vent button is thematic and may stay or be mapped to terra.
#         amber-* for burnout context is thematic and may stay or be mapped to honey.

# Test: ShelterView.jsx has dark mode variants
#   grep for: dark: prefix
#   Expected: at least 20 matches
```

These tests are implemented by reading file contents and running regex matches. They use Vitest's `expect()` with string matching or regular expression counting. The test stubs look like:

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Legacy screen verification tests.
 * Confirms off-palette colors are removed and dark mode classes are present.
 */

const readComponent = (relativePath) =>
  readFileSync(resolve(__dirname, '../../..', relativePath), 'utf-8');

const OFF_PALETTE_PATTERN =
  /(?:text|bg|border|from|to|via)-(?:indigo|teal|cyan|sky)-\d+/g;

describe('Legacy Screens - Off-Palette Removal', () => {
  it('WhatsNewModal.jsx has no off-palette color classes', () => {
    /** Read file, match against OFF_PALETTE_PATTERN and specific red/pink/green/blue/amber classes */
  });

  it('HealthSettingsScreen.jsx has no off-palette color classes', () => {
    /** Read file, match against OFF_PALETTE_PATTERN and specific teal/blue/purple/green/orange/sky classes */
  });

  it('MorningCompass.jsx has no off-palette color classes', () => {
    /** Read file, match against blue/indigo/amber off-palette classes */
  });

  it('MidDayCheckIn.jsx has no off-palette color classes', () => {
    /** Read file, match against blue/indigo/green/emerald off-palette classes */
  });

  it('EveningMirror.jsx has no off-palette color classes', () => {
    /** Read file, match against green/emerald/violet off-palette classes */
  });

  it('ShelterView.jsx has no off-palette teal/blue/purple/cyan/gray classes', () => {
    /** Read file, match against teal/blue/purple/cyan/gray off-palette classes.
     *  rose-* and amber-* require individual assessment (see implementation notes). */
  });
});

describe('Legacy Screens - Dark Mode Coverage', () => {
  it('WhatsNewModal.jsx contains dark: variants', () => {
    /** Count occurrences of "dark:" in the file, expect >= 1 */
  });

  it('HealthSettingsScreen.jsx contains dark: variants', () => {
    /** Count occurrences of "dark:", expect >= 15 */
  });

  it('MorningCompass.jsx contains dark: variants', () => {
    /** Count >= 5 */
  });

  it('MidDayCheckIn.jsx contains dark: variants', () => {
    /** Count >= 8 */
  });

  it('EveningMirror.jsx contains dark: variants', () => {
    /** Count >= 6 */
  });

  it('ShelterView.jsx contains dark: variants', () => {
    /** Count >= 20 */
  });
});
```

---

## Implementation Details

### General Approach

For every file in this section, the implementer should:

1. Open the file and identify all off-palette Tailwind color classes (anything using generic `green-`, `blue-`, `purple-`, `teal-`, `indigo-`, `pink-`, `amber-`, `orange-`, `cyan-`, `sky-`, `emerald-`, `violet-`, `rose-`, `gray-` instead of the Hearthside palette `sage-`, `lavender-`, `honey-`, `terra-`, `hearth-`, `warm-`, `accent-`)
2. Replace each off-palette class with its Hearthside equivalent
3. Add a `dark:` variant alongside each replacement
4. For gradients, use Hearthside gradient presets or direct palette gradient stops

The palette mapping conventions are:

| Off-Palette | Hearthside Equivalent | Semantic Use |
|---|---|---|
| `green-*`, `emerald-*` | `sage-*` | Growth, wins, success, healing |
| `blue-*`, `indigo-*` | `lavender-*` | Insight, focus, tasks, patterns |
| `purple-*`, `violet-*` | `lavender-*` (darker) | Reflection, mindfulness |
| `amber-*` | `honey-*` | Warmth, encouragement, notifications |
| `orange-*` | `terra-*` or `honey-*` | Energy, activity |
| `teal-*`, `cyan-*` | `sage-*` or `accent-*` | Grounding, calm, connections |
| `pink-*`, `rose-*` | `terra-*` | Emotional expression, comfort |
| `sky-*` | `lavender-*` (lighter) | Environment, weather |
| `red-*` | **Keep for safety/crisis; otherwise `terra-*`** | Danger, heart rate (health context ok to keep red for heart) |
| `gray-*` | `hearth-*` or `warm-*` | Neutral surfaces |

### Safety Note

Red classes (`red-*`) used in health contexts for heart rate display (`text-red-400`, `bg-red-50`) in HealthSettingsScreen are **acceptable to keep** since they semantically represent heart/health. Red used for crisis/safety states in ShelterView (via the Whoop recovery "red" status) should also be preserved. Only decorative red/pink (like in WhatsNewModal gradients) gets converted.

---

### File 1: WhatsNewModal.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/shared/WhatsNewModal.jsx`

**Off-palette instance count:** ~16 (6 unique color families: red, pink, amber, blue, green)

**Changes required:**

1. **Modal panel background** (line 53): Replace `bg-white` with `bg-white dark:bg-hearth-900` (or use the `.modal-content` CSS class if it fits the rounded-3xl style).

2. **Header gradient** (line 60): Replace `from-red-400 via-pink-500 to-amber-500` with a Hearthside gradient. Use `from-terra-400 via-honey-400 to-honey-500` for warmth, or the `hearth-glow` gradient preset (`from-honey-300 to-terra-400`). Add dark variant: `dark:from-terra-700/60 dark:via-honey-700/60 dark:to-honey-800/60`.

3. **Feature icon backgrounds** (lines 83, 96, 109, 122): Replace the per-feature icon backgrounds:
   - Heart feature: `bg-red-100` / `text-red-500` -- keep red for the Heart icon (semantically appropriate). Add dark variants: `dark:bg-red-900/30` / `dark:text-red-400`.
   - Sun feature: `bg-amber-100` / `text-amber-500` -- replace with `bg-honey-100 dark:bg-honey-900/30` / `text-honey-600 dark:text-honey-400`.
   - TrendingUp feature: `bg-blue-100` / `text-blue-500` -- replace with `bg-lavender-100 dark:bg-lavender-900/30` / `text-lavender-600 dark:text-lavender-400`.
   - Lightbulb feature: `bg-green-100` / `text-green-500` -- replace with `bg-sage-100 dark:bg-sage-900/30` / `text-sage-600 dark:text-sage-400`.

4. **CTA button gradient** (line 138): Replace `from-red-500 to-amber-500` and hover variants with `from-terra-500 to-honey-500 hover:from-terra-600 hover:to-honey-600`. Add dark variant: `dark:from-terra-600 dark:to-honey-600 dark:hover:from-terra-500 dark:hover:to-honey-500`.

5. **Heading text**: Line 70 already uses `font-display` which is correct. Feature heading text on lines 87, 100, 113, 127 uses `text-warm-800` (already on-palette). Feature description text uses `text-warm-600` (already on-palette). No changes needed there.

6. **Footer hint text** (line 145): Already uses `text-warm-400`. No change.

---

### File 2: HealthSettingsScreen.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/screens/HealthSettingsScreen.jsx`

**Off-palette instance count:** ~49 (teal, blue, purple, indigo, green, orange, amber, sky, red)

This is the most complex file in this section due to the many health-source-specific color treatments.

**Changes required:**

1. **SourceBadge component** (lines 59-66): Replace the badge color config object:
   - `whoop`: `bg-teal-100 text-teal-700` becomes `bg-sage-100 dark:bg-sage-900/30 text-sage-700 dark:text-sage-300`
   - `healthkit`: `bg-gray-100 text-gray-700` becomes `bg-warm-100 dark:bg-warm-800 text-warm-700 dark:text-warm-300`
   - `googlefit`: `bg-blue-100 text-blue-700` becomes `bg-lavender-100 dark:bg-lavender-900/30 text-lavender-700 dark:text-lavender-300`
   - `merged`: `bg-purple-100 text-purple-700` becomes `bg-lavender-200 dark:bg-lavender-900/40 text-lavender-700 dark:text-lavender-300`

2. **Data types array** (lines 362-368): Replace icon colors and backgrounds:
   - Sleep: `text-indigo-500` / `bg-indigo-50` becomes `text-lavender-500 dark:text-lavender-400` / `bg-lavender-50 dark:bg-lavender-900/30`
   - Steps: `text-green-500` / `bg-green-50` becomes `text-sage-500 dark:text-sage-400` / `bg-sage-50 dark:bg-sage-900/30`
   - Workouts: `text-orange-500` / `bg-orange-50` becomes `text-terra-500 dark:text-terra-400` / `bg-terra-50 dark:bg-terra-900/30`
   - Heart: Keep `text-red-400` / `bg-red-50` (semantic heart color). Add dark: `dark:text-red-400` / `dark:bg-red-900/30`.
   - HRV: `text-purple-500` / `bg-purple-50` becomes `text-lavender-600 dark:text-lavender-400` / `bg-lavender-50 dark:bg-lavender-900/30`

3. **Header gradient icon** (line 412): Replace `from-honey-400 to-teal-500` with `from-honey-400 to-sage-500`.

4. **Modal container and cards**: Add dark mode to:
   - Main panel (line 402): `bg-warm-50` add `dark:bg-hearth-950`
   - Header (line 409): `bg-white` add `dark:bg-hearth-900`, `border-warm-100` add `dark:border-hearth-800`
   - Each card (lines 441, 555, etc.): `bg-white` add `dark:bg-hearth-900`, `border-warm-200` add `dark:border-hearth-800`

5. **Native health source chip connected state** (lines 466-488):
   - `bg-green-50 border-green-200` becomes `bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800`
   - `bg-green-100` becomes `bg-sage-100 dark:bg-sage-900/40`
   - `text-green-600` becomes `text-sage-600 dark:text-sage-400`
   - `text-green-800` becomes `text-sage-800 dark:text-sage-200`
   - `text-green-500` (CheckCircle) becomes `text-sage-500 dark:text-sage-400`

6. **Whoop chip connected state** (lines 496-516):
   - `bg-teal-50 border-teal-200` becomes `bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800`
   - `bg-teal-100` becomes `bg-sage-100 dark:bg-sage-900/40`
   - `text-teal-600` becomes `text-sage-600 dark:text-sage-400`
   - `text-teal-800` becomes `text-sage-800 dark:text-sage-200`
   - `text-teal-500` becomes `text-sage-500 dark:text-sage-400`

7. **Smart merged badge** (line 565): `text-purple-600 bg-purple-50` becomes `text-lavender-600 dark:text-lavender-400 bg-lavender-50 dark:bg-lavender-900/30`.

8. **Today's Health metric rows** (lines 576, 594, 612, 630, 649): Replace each metric's icon container with the colors from the data types mapping (step 2 above).

9. **Whoop Recovery status** (lines 666-686): The recovery status uses `green-*`, `yellow-*`, and `red-*` semantically (health traffic light). These are acceptable to keep but should get dark variants:
   - `bg-green-50 border-green-200` add `dark:bg-sage-900/30 dark:border-sage-800`
   - `bg-yellow-50 border-yellow-200` add `dark:bg-honey-900/30 dark:border-honey-800`
   - `bg-red-50 border-red-200` add `dark:bg-red-900/30 dark:border-red-800` (keep red for health danger)
   - Icon text colors: add corresponding dark variants

10. **Backfill section** (lines 708-810):
    - History icon: `bg-amber-50` / `text-amber-600` becomes `bg-honey-50 dark:bg-honey-900/30` / `text-honey-600 dark:text-honey-400`
    - Backfill button gradient: `from-amber-500 to-orange-500` becomes `from-honey-500 to-terra-500`. Add dark variants.
    - Progress bar: Same gradient change.
    - Progress text: `text-green-600` becomes `text-sage-600 dark:text-sage-400`
    - Completion card: `bg-green-50 border-green-200` becomes `bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800`. All text-green-* become text-sage-*.

11. **Environment Backfill section** (lines 813-930):
    - Weather icon gradient: `from-sky-400 to-blue-500` becomes `from-lavender-400 to-lavender-600`.
    - Button gradient: `from-sky-500 to-blue-500` becomes `from-lavender-500 to-lavender-600`. Add dark variants.
    - Progress bar: Same gradient change.
    - Completion card: `bg-sky-50 border-sky-200` becomes `bg-lavender-50 dark:bg-lavender-900/30 border-lavender-200 dark:border-lavender-800`. All `text-sky-*` become `text-lavender-*`.

12. **Web platform notice** (lines 527-536): `bg-amber-50 border-amber-200` becomes `bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800`. `text-amber-500/600/800` become `text-honey-500/600/800` with dark variants.

13. **"Why connect" card** (line 966): `from-honey-50 to-blue-50` becomes `from-honey-50 to-lavender-50 dark:from-honey-900/30 dark:to-lavender-900/30`. `border-honey-100` add `dark:border-honey-800`.

14. **Cancel button in environment backfill** (line 879): `text-red-500` -- this is for a cancel action, which is semantically appropriate. Keep it but add `dark:text-red-400`.

---

### File 3: MorningCompass.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/views/MorningCompass.jsx`

**Off-palette instance count:** ~8 (amber, blue, indigo)

**Changes required:**

1. **Intention prompt** (lines 63-71):
   - `border-amber-100` becomes `border-honey-100 dark:border-honey-800`
   - `text-amber-700` becomes `text-honey-700 dark:text-honey-300`
   - `text-amber-500` becomes `text-honey-500 dark:text-honey-400`

2. **Action Items card** (line 82):
   - `from-blue-50 to-indigo-50` becomes `from-lavender-50 to-lavender-100 dark:from-lavender-900/30 dark:to-lavender-900/20`
   - `border-blue-100` becomes `border-lavender-200 dark:border-lavender-800`

3. **Tasks heading and icon** (lines 88-89):
   - `text-blue-500` becomes `text-lavender-500 dark:text-lavender-400`
   - `text-blue-800` becomes `text-lavender-800 dark:text-lavender-200`

4. **Tasks overflow text** (line 102):
   - `text-blue-500` becomes `text-lavender-500 dark:text-lavender-400`

5. **Quick prompts hover** (line 127):
   - `hover:border-amber-200` becomes `hover:border-honey-200 dark:hover:border-honey-700`

6. **Quick prompt cards** (line 127): Add dark: to `bg-white` and `border-warm-100`:
   - `bg-white dark:bg-hearth-900 border-warm-100 dark:border-hearth-800`

---

### File 4: MidDayCheckIn.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/views/MidDayCheckIn.jsx`

**Off-palette instance count:** ~14 (blue, indigo, green, emerald)

**Changes required:**

1. **Energy check-in button** (lines 65-73):
   - `border-blue-100` becomes `border-lavender-100 dark:border-lavender-800`
   - `text-blue-700` becomes `text-lavender-700 dark:text-lavender-300`
   - `text-blue-500` becomes `text-lavender-500 dark:text-lavender-400`

2. **Tasks section** (lines 80-105): Same pattern as MorningCompass:
   - `from-blue-50 to-indigo-50` becomes `from-lavender-50 to-lavender-100 dark:from-lavender-900/30 dark:to-lavender-900/20`
   - `border-blue-100` becomes `border-lavender-200 dark:border-lavender-800`
   - `text-blue-500` becomes `text-lavender-500 dark:text-lavender-400`
   - `text-blue-800` becomes `text-lavender-800 dark:text-lavender-200`
   - `text-blue-500` (overflow) becomes `text-lavender-500 dark:text-lavender-400`

3. **Wins section** (lines 109-130):
   - `from-green-50 to-emerald-50` becomes `from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20`
   - `border-green-100` becomes `border-sage-200 dark:border-sage-800`
   - `text-green-500` becomes `text-sage-500 dark:text-sage-400`
   - `text-green-800` becomes `text-sage-800 dark:text-sage-200`
   - `text-green-700` becomes `text-sage-700 dark:text-sage-300`

4. **Empty state hover** (line 163):
   - `hover:border-blue-200` becomes `hover:border-lavender-200 dark:hover:border-lavender-700`

5. **Empty state prompt cards**: Add dark mode to `bg-white` and `border-warm-100`:
   - `bg-white dark:bg-hearth-900 border-warm-100 dark:border-hearth-800`

---

### File 5: EveningMirror.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/views/EveningMirror.jsx`

**Off-palette instance count:** ~10 (green, emerald, violet)

**Changes required:**

1. **Wins section** (lines 74-112):
   - `from-green-50 to-emerald-50` becomes `from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20`
   - `border-green-100` becomes `border-sage-200 dark:border-sage-800`
   - `text-green-500` (icon) becomes `text-sage-500 dark:text-sage-400`
   - `text-green-800` (heading) becomes `text-sage-800 dark:text-sage-200`
   - `text-green-700` (list items) becomes `text-sage-700 dark:text-sage-300`
   - `text-green-500` (CheckCircle2) becomes `text-sage-500 dark:text-sage-400`
   - `border-green-200` (affirmation border) becomes `border-sage-200 dark:border-sage-800`
   - `text-green-600` (affirmation text) becomes `text-sage-600 dark:text-sage-400`

2. **Empty state prompt hover** (line 201):
   - `hover:border-violet-200` becomes `hover:border-lavender-200 dark:hover:border-lavender-700`

3. **Collapsible tasks section** (line 133):
   - `bg-white` add `dark:bg-hearth-900`
   - `border-warm-100` add `dark:border-hearth-800`
   - `hover:bg-warm-50` add `dark:hover:bg-hearth-850`

4. **Empty state prompt cards**: Add dark mode to `bg-white` and `border-warm-100` (same as other views).

---

### File 6: ShelterView.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/views/ShelterView.jsx`

**Off-palette instance count:** ~60+ (teal, blue, indigo, purple, green, cyan, gray, rose, amber)

This is the largest file in scope. ShelterView is a safety-adjacent component used during low mood and burnout states. Color changes must be done carefully, and the rose/amber colors used for burnout and emotional themes should be mapped thoughtfully.

**Mapping decisions for ShelterView:**

- **teal-*** (Drop Anchor grounding exercise) maps to **sage-*** -- grounding/healing semantic
- **blue-*** (breathing, back links) maps to **lavender-*** -- calm/reflection
- **purple-*** (5-4-3-2-1 grounding) maps to **lavender-*** (darker end)
- **green-*** (CBT reframe leaf, activity completion) maps to **sage-***
- **cyan-*** (Drop Anchor container gradient) maps to **sage-*** (lighter)
- **gray-*** (timer container) maps to **hearth-*** or **warm-***
- **rose-*** (hero for low-mood, Vent button) maps to **terra-*** -- emotional expression
- **amber-*** (burnout context) maps to **honey-*** -- warmth/alert

**Changes required:**

1. **DropAnchorExercise component** (all teal instances, lines 44-288):
   - All `bg-teal-*` become `bg-sage-*` with dark variants
   - All `text-teal-*` become `text-sage-*` with dark variants
   - `from-teal-200 to-teal-400` (breathing animation) becomes `from-sage-200 to-sage-400 dark:from-sage-700 dark:to-sage-500`
   - `from-teal-50 via-cyan-50 to-teal-50` (container gradient) becomes `from-sage-50 via-sage-100 to-sage-50 dark:from-sage-900/40 dark:via-sage-900/30 dark:to-sage-900/40`
   - `border-teal-100` becomes `border-sage-200 dark:border-sage-800`
   - `border-teal-200` (input) becomes `border-sage-200 dark:border-sage-700` with focus ring `focus:border-sage-400 focus:ring-sage-100 dark:focus:ring-sage-900`
   - Progress dots: `bg-teal-500` / `bg-teal-200` become `bg-sage-500 dark:bg-sage-400` / `bg-sage-200 dark:bg-sage-700`

2. **Breathing mode** (lines 343-364):
   - Back link: `text-blue-500 hover:text-blue-700` becomes `text-lavender-500 dark:text-lavender-400 hover:text-lavender-700 dark:hover:text-lavender-300`
   - Container: `from-blue-900/50 to-indigo-900/50 border-blue-500/30` becomes `from-lavender-900/50 to-lavender-800/50 dark:from-lavender-950/70 dark:to-lavender-900/70 border-lavender-500/30 dark:border-lavender-600/30`

3. **Grounding mode** (lines 367-388):
   - Back link: `text-purple-500 hover:text-purple-700` becomes `text-lavender-600 dark:text-lavender-400 hover:text-lavender-800 dark:hover:text-lavender-300`
   - Container: `from-purple-900/50 to-blue-900/50 border-purple-500/30` becomes `from-lavender-800/50 to-lavender-900/50 dark:from-lavender-950/70 dark:to-lavender-900/70 border-lavender-500/30 dark:border-lavender-600/30`

4. **Timer mode** (lines 391-416):
   - Back link: `text-blue-500 hover:text-blue-700` -- same as breathing mode mapping
   - Container: `from-gray-800/80 to-gray-900/80 border-white/10` becomes `from-hearth-800/80 to-hearth-900/80 dark:from-hearth-900/90 dark:to-hearth-950/90 border-warm-200/10 dark:border-warm-100/10`

5. **Breathing select mode** (lines 419-444):
   - Back link: same blue-to-lavender mapping
   - Container: `from-blue-900/30 to-indigo-900/30 border-blue-500/20` becomes `from-lavender-900/30 to-lavender-800/30 dark:from-lavender-950/50 dark:to-lavender-900/50 border-lavender-500/20 dark:border-lavender-600/20`
   - Heading: `text-white` is fine for dark containers

6. **Main menu hero** (lines 511-547):
   - Low-mood hero: `from-rose-50 via-pink-50 to-warm-50 border-rose-100` becomes `from-terra-50 via-terra-100 to-warm-50 dark:from-terra-900/30 dark:via-terra-900/20 dark:to-hearth-900 border-terra-200 dark:border-terra-800`
   - Burnout hero: `from-amber-50 via-orange-50 to-warm-50 border-amber-200` becomes `from-honey-50 via-honey-100 to-warm-50 dark:from-honey-900/30 dark:via-honey-900/20 dark:to-hearth-900 border-honey-200 dark:border-honey-800`
   - Icon containers: `bg-rose-100` becomes `bg-terra-100 dark:bg-terra-900/40`, `bg-amber-100` becomes `bg-honey-100 dark:bg-honey-900/40`
   - Icon colors: `text-rose-400` becomes `text-terra-400 dark:text-terra-300`, `text-amber-500` becomes `text-honey-500 dark:text-honey-400`
   - Heading: `text-rose-800` becomes `text-terra-800 dark:text-terra-200`, `text-amber-800` becomes `text-honey-800 dark:text-honey-200`
   - Body: `text-rose-600` becomes `text-terra-600 dark:text-terra-300`, `text-amber-700` becomes `text-honey-700 dark:text-honey-300`

7. **Vent button** (lines 551-567):
   - `bg-rose-500 hover:bg-rose-600` becomes `bg-terra-500 hover:bg-terra-600 dark:bg-terra-600 dark:hover:bg-terra-500`
   - `text-rose-100` becomes `text-terra-100 dark:text-terra-200`

8. **Decompression tools grid** (lines 570-626):
   - Write it down (warm-100/200): Already on-palette. Add dark: `dark:bg-hearth-850 dark:hover:bg-hearth-800 dark:text-warm-300`.
   - Breathing: `bg-blue-100 hover:bg-blue-200 text-blue-700` becomes `bg-lavender-100 dark:bg-lavender-900/30 hover:bg-lavender-200 dark:hover:bg-lavender-900/40 text-lavender-700 dark:text-lavender-300`
   - Grounding: `bg-purple-100 hover:bg-purple-200 text-purple-700` becomes `bg-lavender-200 dark:bg-lavender-900/40 hover:bg-lavender-300 dark:hover:bg-lavender-900/50 text-lavender-700 dark:text-lavender-300`
   - Timer: `bg-teal-100 hover:bg-teal-200 text-teal-700` becomes `bg-sage-100 dark:bg-sage-900/30 hover:bg-sage-200 dark:hover:bg-sage-900/40 text-sage-700 dark:text-sage-300`

9. **Drop Anchor CTA button** (line 631):
   - `bg-teal-500 hover:bg-teal-600` becomes `bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-500`

10. **CBT Reframe** (lines 643-659):
    - `text-green-500` (Leaf icon) becomes `text-sage-500 dark:text-sage-400`
    - Card: `bg-white border-warm-100` add dark variants: `dark:bg-hearth-900 dark:border-hearth-800`

11. **Burnout context section** (lines 482-507):
    - `from-amber-900/30 to-red-900/30 border-amber-500/30` becomes `from-honey-900/30 to-terra-900/30 dark:from-honey-950/50 dark:to-terra-950/50 border-honey-500/30 dark:border-honey-600/30`
    - `text-amber-400` becomes `text-honey-400 dark:text-honey-300`
    - `text-amber-200` becomes `text-honey-200 dark:text-honey-300`
    - `text-amber-100` becomes `text-honey-100 dark:text-honey-200`
    - `text-amber-200/70` becomes `text-honey-200/70 dark:text-honey-300/70`

12. **Activity completed indicator** (line 459):
    - `text-green-400` becomes `text-sage-400 dark:text-sage-300`

---

### File Summary Table

| File | Path | Off-Palette Count | Primary Off-Palette Colors |
|---|---|---|---|
| WhatsNewModal.jsx | `/Users/michaelbond/echo-vault/src/components/shared/WhatsNewModal.jsx` | ~16 | red, pink, amber, blue, green |
| HealthSettingsScreen.jsx | `/Users/michaelbond/echo-vault/src/components/screens/HealthSettingsScreen.jsx` | ~49 | teal, blue, purple, indigo, green, orange, amber, sky, red |
| MorningCompass.jsx | `/Users/michaelbond/echo-vault/src/components/dashboard/views/MorningCompass.jsx` | ~8 | amber, blue, indigo |
| MidDayCheckIn.jsx | `/Users/michaelbond/echo-vault/src/components/dashboard/views/MidDayCheckIn.jsx` | ~14 | blue, indigo, green, emerald |
| EveningMirror.jsx | `/Users/michaelbond/echo-vault/src/components/dashboard/views/EveningMirror.jsx` | ~10 | green, emerald, violet |
| ShelterView.jsx | `/Users/michaelbond/echo-vault/src/components/dashboard/views/ShelterView.jsx` | ~60+ | teal, cyan, blue, indigo, purple, green, gray, rose, amber |

**Total estimated off-palette instances:** ~157

---

## Implementation Checklist

1. Create test file `src/utils/__tests__/legacyScreens.test.js` with the verification stubs described above
2. Update WhatsNewModal.jsx -- replace off-palette colors and add dark mode
3. Update HealthSettingsScreen.jsx -- replace off-palette colors, add dark mode to all cards, metrics, badges, and backfill sections
4. Update MorningCompass.jsx -- replace blue/indigo/amber with lavender/honey, add dark mode
5. Update MidDayCheckIn.jsx -- replace blue/indigo/green/emerald with lavender/sage, add dark mode
6. Update EveningMirror.jsx -- replace green/emerald/violet with sage/lavender, add dark mode
7. Update ShelterView.jsx -- replace teal/blue/purple/green with sage/lavender, replace rose/amber with terra/honey for hero/burnout, add dark mode throughout
8. Run the verification tests to confirm zero off-palette classes remain and dark mode class counts meet thresholds
9. Visual spot-check: toggle dark mode on each screen to verify readability and contrast

---

## Actual Implementation Notes

### What was built

All 6 files were migrated to the Hearthside palette with dark mode support. ShelterView was already converted in a prior session (section 12), so only 5 files needed changes.

**Files created:**
- `src/utils/__tests__/legacyScreens.test.js` — 12 tests (6 off-palette removal + 6 dark mode coverage)

**Files modified:**
- `src/components/shared/WhatsNewModal.jsx`
- `src/components/screens/HealthSettingsScreen.jsx`
- `src/components/dashboard/views/MorningCompass.jsx`
- `src/components/dashboard/views/MidDayCheckIn.jsx`
- `src/components/dashboard/views/EveningMirror.jsx`
- `src/components/dashboard/views/ShelterView.jsx` (minor fix only — burnout card gradient)

### Deviations from plan

1. **ShelterView was already converted** — Section 12 (anticipatory-shelter) had already migrated most of ShelterView. Only the burnout context card gradient (`to-red-900/30` → `to-terra-900/30` + dark variants) needed fixing.

2. **Heart icon kept as semantic red** — The plan correctly specified keeping red for the Heart icon in WhatsNewModal. During implementation it was incorrectly changed to terra, then reverted during code review. Final state: `bg-red-100 dark:bg-red-900/30` / `text-red-500 dark:text-red-400`.

3. **Additional dark text variants added** — Code review identified missing `dark:text-warm-200` on headings and `dark:text-warm-400` on descriptions in both WhatsNewModal and HealthSettingsScreen. These were added to prevent invisible text in dark mode.

4. **"Why connect?" card children** — The plan covered the card container gradient and border but didn't explicitly list dark variants for the icon, heading, and body text children. These were added during review.

5. **Test updated for semantic red** — The WhatsNewModal off-palette test was updated to exclude `bg-red-100` and `text-red-500` (Heart icon) from the off-palette check, since red is semantically appropriate for health/heart.

### Test results
- 12/12 section tests pass
- 704/704 full suite tests pass