Now I have a thorough understanding of all the files involved. Let me produce the section content.

# Section 12: Anticipatory and Shelter Component Sweep

## Overview

This section covers the Hearthside palette migration and dark mode addition for all **anticipatory** and **shelter** components. These components provide anxiety management, grounding exercises, breathing exercises, burnout detection, and decompression tools. The work involves replacing off-palette Tailwind color classes (blue, green, purple, amber, rose, teal, orange, cyan, gray, indigo, pink) with Hearthside palette equivalents (sage, lavender, honey, terra, hearth, warm) and adding `dark:` variant classes throughout.

**Estimated off-palette instance counts:**
- `EventReflectionPrompt.jsx` -- ~22 instances
- `GroundingExercise.jsx` (anticipatory) -- ~20 instances
- `FutureSelfCheckIn.jsx` -- ~18 instances
- `DecompressionTimer.jsx` (shelter) -- ~8 instances
- `GroundingExercise.jsx` (shelter) -- ~8 instances
- `BreathingExercise.jsx` (shelter) -- ~12 instances
- `BurnoutNudgeBanner.jsx` (shelter) -- ~10 instances (orange/yellow/red -- needs safety audit)
- `ShelterView.jsx` (dashboard) -- ~30+ instances (teal, blue, purple, rose, green, indigo, pink, gray)

## Dependencies

This section depends on:
- **Section 01 (Tokens Config):** `hearth-850` token and gradient presets must exist in `tailwind.config.js`
- **Section 02 (Color Map):** `src/utils/colorMap.js` must exist with `getTherapeuticColors()` for ACT/CBT framework references
- **Section 03 (CSS Components):** Extended CSS component classes in `src/index.css` with dark mode variants must be available

This section does NOT block any other section. It is parallelizable with sections 07 through 15.

## Files to Modify

All file paths are absolute:

1. `/Users/michaelbond/echo-vault/src/components/anticipatory/EventReflectionPrompt.jsx`
2. `/Users/michaelbond/echo-vault/src/components/anticipatory/GroundingExercise.jsx`
3. `/Users/michaelbond/echo-vault/src/components/anticipatory/FutureSelfCheckIn.jsx`
4. `/Users/michaelbond/echo-vault/src/components/shelter/DecompressionTimer.jsx`
5. `/Users/michaelbond/echo-vault/src/components/shelter/GroundingExercise.jsx`
6. `/Users/michaelbond/echo-vault/src/components/shelter/BreathingExercise.jsx`
7. `/Users/michaelbond/echo-vault/src/components/shelter/BurnoutNudgeBanner.jsx`
8. `/Users/michaelbond/echo-vault/src/components/dashboard/views/ShelterView.jsx`

No new files are created in this section.

---

## Tests

Tests for this section are file-content verification (grep-based), not runtime tests. They confirm that off-palette colors have been removed and dark mode classes have been added.

### Verification Test Stubs

Create or extend a verification test file. The following test descriptions define what to verify after implementation:

```
# Anticipatory Components - Off-palette removal
# Test: EventReflectionPrompt.jsx contains no off-palette classes (amber-100, amber-500, amber-600, amber-700, green-100, green-400, green-700, rose-100, rose-700, purple-100, purple-500, purple-800, purple-50, purple-600, green-50, green-600, green-800, blue-50, blue-700)
# Test: GroundingExercise.jsx (anticipatory) contains no off-palette classes (blue-100, blue-500, blue-600, green-100, green-500, green-600, purple-100, purple-500, purple-600, amber-100, amber-500, amber-600, rose-100, rose-500, rose-600, green-50, green-800)
# Test: FutureSelfCheckIn.jsx contains no off-palette classes (amber-100, amber-500, rose-100, rose-500, blue-100, blue-500, green-100, green-500, green-50, green-800, green-600, green-700, green-300, purple-100, purple-500, purple-50, purple-700, purple-600, purple-300)

# Shelter Components - Off-palette removal
# Test: DecompressionTimer.jsx contains no off-palette classes (blue-400, blue-500, blue-600, green-500, amber-400)
# Test: GroundingExercise.jsx (shelter) contains no off-palette classes (blue-500, green-500, purple-500, amber-500, rose-500, blue-400, green-400, purple-400, amber-400, rose-400, green-500 in completion state, gray-900)
# Test: BreathingExercise.jsx contains no off-palette classes (blue-500, blue-700, purple-500, purple-700, teal-500, teal-700, blue-400, purple-400, teal-400, gray-900)
# Test: BurnoutNudgeBanner.jsx - red-* classes are RETAINED (safety/crisis context). Only orange-* and yellow-* are replaced.
# Test: ShelterView.jsx contains no off-palette classes (teal-*, blue-100, blue-200, blue-500, blue-700, blue-900, purple-100, purple-200, purple-500, purple-700, purple-900, rose-*, pink-*, green-*, orange-*, indigo-*, cyan-*, gray-800, gray-900)

# Dark mode addition
# Test: EventReflectionPrompt.jsx contains dark: prefixed classes
# Test: GroundingExercise.jsx (anticipatory) contains dark: prefixed classes
# Test: FutureSelfCheckIn.jsx contains dark: prefixed classes
# Test: DecompressionTimer.jsx contains dark: prefixed classes
# Test: GroundingExercise.jsx (shelter) contains dark: prefixed classes
# Test: BreathingExercise.jsx contains dark: prefixed classes
# Test: BurnoutNudgeBanner.jsx contains dark: prefixed classes
# Test: ShelterView.jsx contains dark: prefixed classes
```

These checks can be implemented as a shell script or as a Vitest file that reads file content and uses regex assertions. The pattern for each check:

```javascript
// Example test structure (stub only)
import { readFileSync } from 'fs';

describe('Section 12: Anticipatory & Shelter off-palette removal', () => {
  const anticipatoryDir = '/Users/michaelbond/echo-vault/src/components/anticipatory';
  const shelterDir = '/Users/michaelbond/echo-vault/src/components/shelter';

  it('EventReflectionPrompt has no off-palette amber/green/rose/purple/blue classes', () => {
    /** Read file, assert no matches for /\b(amber|green|rose|purple|blue)-\d{2,3}\b/ 
     *  outside of allowed exceptions */
  });

  it('BurnoutNudgeBanner retains red-* classes for safety states', () => {
    /** Read file, assert red-* classes still present for crisis indicators */
  });

  it('All anticipatory files have dark: prefixed classes', () => {
    /** Read each file, assert /dark:/ appears at least once */
  });
});
```

---

## Implementation Details

### General Approach

For every file in this section, the process is the same:

1. Identify all off-palette Tailwind color classes (e.g., `bg-blue-500`, `text-green-700`, `from-teal-200`)
2. Replace with Hearthside palette equivalents using the mapping table below
3. Add `dark:` variant classes alongside every light-mode color class
4. For components that use color mapping objects/functions (like `phaseColors`, `colorClasses`, `getColorClasses`), update the entire mapping structure

### Master Color Replacement Mapping

This mapping is used across all files in this section:

| Off-Palette Color | Hearthside Replacement | Semantic Reason |
|---|---|---|
| `blue-*` | `lavender-*` | Calm/breathing/trust |
| `green-*` | `sage-*` | Growth/success/healing |
| `purple-*` | `lavender-*` (darker shades) | Insight/reflection |
| `amber-*` | `honey-*` | Warmth/acknowledgment |
| `rose-*` | `terra-*` | Body/grounding/emotion |
| `teal-*` | `sage-*` | Grounding/ACT exercises |
| `orange-*` | `terra-*` or `honey-*` | Warning/caution |
| `pink-*` | `terra-*` (lighter shades) | Softness/emotion |
| `indigo-*` | `lavender-*` (darker shades) | Depth/night |
| `cyan-*` | `sage-*` (lighter shades) | Freshness |
| `gray-900` / `gray-800` | `hearth-900` / `hearth-800` | Dark surfaces |

### Dark Mode Pattern

For every light-mode class, add a `dark:` counterpart following these conventions:

- Light backgrounds (`bg-{color}-50`, `bg-{color}-100`) become `dark:bg-{color}-900/30` or `dark:bg-hearth-800`
- Text on light backgrounds (`text-{color}-700`, `text-{color}-800`) becomes `dark:text-{color}-300` or `dark:text-{color}-200`
- Borders (`border-{color}-200`) become `dark:border-{color}-700` or `dark:border-hearth-700`
- White backgrounds (`bg-white`) become `dark:bg-hearth-900` or `dark:bg-hearth-850`
- Gradient starts/ends shift to darker, more transparent versions

---

### File-by-File Implementation

#### 1. EventReflectionPrompt.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/anticipatory/EventReflectionPrompt.jsx`

**Off-palette instances to replace (~22):**

**Step 0 (Intro):**
- `bg-amber-100` -> `bg-honey-100 dark:bg-honey-900/30`
- `text-amber-500` -> `text-honey-500 dark:text-honey-400`
- `bg-amber-500` -> `bg-honey-500 dark:bg-honey-600`
- `hover:bg-amber-600` -> `hover:bg-honey-600 dark:hover:bg-honey-700`

**Step 1 (Anxiety comparison):**
- `bg-amber-100` (after card) -> `bg-honey-100 dark:bg-honey-900/30`
- `text-amber-600` -> `text-honey-600 dark:text-honey-400`
- `text-amber-700` -> `text-honey-700 dark:text-honey-300`
- `text-amber-500` -> `text-honey-500 dark:text-honey-400`
- `bg-green-100 text-green-700` (trend positive) -> `bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300`
- `bg-rose-100 text-rose-700` (trend negative) -> `bg-terra-100 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300`
- `bg-amber-500` / `hover:bg-amber-600` (Continue button) -> `bg-honey-500 dark:bg-honey-600` / `hover:bg-honey-600 dark:hover:bg-honey-700`

**Step 2 (What Happened):**
- `bg-amber-500 text-white` (selected coping button) -> `bg-honey-500 text-white dark:bg-honey-600`
- `bg-amber-500 text-white hover:bg-amber-600` (See Insights button) -> `bg-honey-500 text-white hover:bg-honey-600 dark:bg-honey-600 dark:hover:bg-honey-700`

**Step 3 (Insight):**
- `bg-purple-100` (icon circle) -> `bg-lavender-100 dark:bg-lavender-900/30`
- `text-purple-500` (icon) -> `text-lavender-500 dark:text-lavender-400`
- `bg-purple-50` (insight card) -> `bg-lavender-50 dark:bg-lavender-900/20`
- `text-purple-800` (insight text) -> `text-lavender-800 dark:text-lavender-200`
- `bg-green-400` / `bg-rose-400` (anxiety bar) -> `bg-sage-400 dark:bg-sage-500` / `bg-terra-400 dark:bg-terra-500`
- `bg-green-50` / `text-green-600` / `text-green-800` (reframe card) -> `bg-sage-50 dark:bg-sage-900/20` / `text-sage-600 dark:text-sage-400` / `text-sage-800 dark:text-sage-200`
- `bg-blue-50` / `text-blue-700` (grounding insight) -> `bg-lavender-50 dark:bg-lavender-900/20` / `text-lavender-700 dark:text-lavender-300`
- `bg-purple-500` / `hover:bg-purple-600` (Done button) -> `bg-lavender-500 dark:bg-lavender-600` / `hover:bg-lavender-600 dark:hover:bg-lavender-700`

**Outer container:**
- `bg-white` -> `bg-white dark:bg-hearth-900`
- `border-warm-200` -> add `dark:border-hearth-700`
- `border-warm-100` (header border) -> add `dark:border-hearth-800`

**Text classes already using `warm-*`:** These are already on-palette. Add dark mode variants:
- `text-warm-900` -> add `dark:text-warm-100`
- `text-warm-600` -> add `dark:text-warm-300`
- `text-warm-500` -> add `dark:text-warm-400`
- `text-warm-400` -> add `dark:text-warm-500`
- `text-warm-800` -> add `dark:text-warm-200`
- `bg-warm-100` -> add `dark:bg-hearth-800`
- `bg-warm-200` -> add `dark:bg-hearth-700`
- `border-warm-200` -> add `dark:border-hearth-700`
- `placeholder-warm-400` -> add `dark:placeholder-warm-500`

---

#### 2. GroundingExercise.jsx (anticipatory)

**Path:** `/Users/michaelbond/echo-vault/src/components/anticipatory/GroundingExercise.jsx`

This file has three sub-components: `BoxBreathing`, `FiveSenses`, and `QuickBodyScan`.

**BoxBreathing -- `phaseColors` object (6 entries):**

Replace the entire `phaseColors` mapping:
- `'bg-blue-100'` -> `'bg-lavender-100 dark:bg-lavender-900/30'` (inhale)
- `'bg-purple-100'` -> `'bg-lavender-200 dark:bg-lavender-800/30'` (hold1)
- `'bg-green-100'` -> `'bg-sage-100 dark:bg-sage-900/30'` (exhale)
- `'bg-amber-100'` -> `'bg-honey-100 dark:bg-honey-900/30'` (hold2)
- `'bg-green-100'` -> `'bg-sage-100 dark:bg-sage-900/30'` (complete)
- `'bg-warm-100'` -> stays, add `'bg-warm-100 dark:bg-hearth-800'` (ready)

**BoxBreathing -- Start button:**
- `bg-blue-500 hover:bg-blue-600` -> `bg-lavender-500 hover:bg-lavender-600 dark:bg-lavender-600 dark:hover:bg-lavender-700`

**FiveSenses -- `senses` array color property and `colorClasses` object:**

The `senses` array assigns colors per sense. The `colorClasses` object maps those to Tailwind classes. Replace the entire `colorClasses`:
- `blue` -> `{ bg: 'bg-lavender-100 dark:bg-lavender-900/30', text: 'text-lavender-600 dark:text-lavender-400', button: 'bg-lavender-500 hover:bg-lavender-600 dark:bg-lavender-600 dark:hover:bg-lavender-700' }`
- `green` -> `{ bg: 'bg-sage-100 dark:bg-sage-900/30', text: 'text-sage-600 dark:text-sage-400', button: 'bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700' }`
- `purple` -> `{ bg: 'bg-lavender-200 dark:bg-lavender-800/30', text: 'text-lavender-700 dark:text-lavender-300', button: 'bg-lavender-600 hover:bg-lavender-700 dark:bg-lavender-700 dark:hover:bg-lavender-800' }`
- `amber` -> `{ bg: 'bg-honey-100 dark:bg-honey-900/30', text: 'text-honey-600 dark:text-honey-400', button: 'bg-honey-500 hover:bg-honey-600 dark:bg-honey-600 dark:hover:bg-honey-700' }`
- `rose` -> `{ bg: 'bg-terra-100 dark:bg-terra-900/30', text: 'text-terra-600 dark:text-terra-400', button: 'bg-terra-500 hover:bg-terra-600 dark:bg-terra-600 dark:hover:bg-terra-700' }`

**FiveSenses -- Progress dots (completed):**
- `bg-green-500 text-white` -> `bg-sage-500 text-white dark:bg-sage-600`

**FiveSenses -- Completion state:**
- `bg-green-50` -> `bg-sage-50 dark:bg-sage-900/20`
- `text-green-800` -> `text-sage-800 dark:text-sage-200`
- `text-green-600` -> `text-sage-600 dark:text-sage-400`

**QuickBodyScan:**
- `bg-purple-100` / `text-purple-500` (icon) -> `bg-lavender-100 dark:bg-lavender-900/30` / `text-lavender-500 dark:text-lavender-400`
- `bg-purple-500` / `hover:bg-purple-600` (Start Scan / progress bar) -> `bg-lavender-500 dark:bg-lavender-600` / `hover:bg-lavender-600 dark:hover:bg-lavender-700`
- `text-purple-800` (area label) -> `text-lavender-800 dark:text-lavender-200`
- `bg-purple-100` (breathing indicator) -> `bg-lavender-100 dark:bg-lavender-900/30`

**All warm-* classes:** Add dark mode variants as listed in the EventReflectionPrompt section above (same pattern).

---

#### 3. FutureSelfCheckIn.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/anticipatory/FutureSelfCheckIn.jsx`

**Acknowledge step:**
- `bg-amber-100` / `text-amber-500` (Sun icon circle) -> `bg-honey-100 dark:bg-honey-900/30` / `text-honey-500 dark:text-honey-400`

**Body Scan step:**
- `bg-rose-100` / `text-rose-500` (Heart icon circle) -> `bg-terra-100 dark:bg-terra-900/30` / `text-terra-500 dark:text-terra-400`
- `bg-rose-500 text-white` (selected body location) -> `bg-terra-500 text-white dark:bg-terra-600`

**Grounding step:**
- `bg-blue-100` / `text-blue-500` (Wind icon circle) -> `bg-lavender-100 dark:bg-lavender-900/30` / `text-lavender-500 dark:text-lavender-400`
- `bg-green-50` / `text-green-500` / `text-green-800` / `text-green-600` (grounding completion) -> `bg-sage-50 dark:bg-sage-900/20` / `text-sage-500 dark:text-sage-400` / `text-sage-800 dark:text-sage-200` / `text-sage-600 dark:text-sage-400`

**Reframe step:**
- `bg-purple-100` / `text-purple-500` (Sparkles icon) -> `bg-lavender-100 dark:bg-lavender-900/30` / `text-lavender-500 dark:text-lavender-400`
- `bg-purple-50` / `text-purple-700` / `text-purple-600` (reframe prompts card) -> `bg-lavender-50 dark:bg-lavender-900/20` / `text-lavender-700 dark:text-lavender-300` / `text-lavender-600 dark:text-lavender-400`
- `focus:ring-purple-300` (textarea) -> `focus:ring-lavender-300 dark:focus:ring-lavender-700`

**Commit step:**
- `bg-green-100` / `text-green-500` (Target icon circle) -> `bg-sage-100 dark:bg-sage-900/30` / `text-sage-500 dark:text-sage-400`
- `bg-green-500 text-white` (selected commitment) -> `bg-sage-500 text-white dark:bg-sage-600`
- `focus:ring-green-300` (custom input) -> `focus:ring-sage-300 dark:focus:ring-sage-700`
- `bg-green-50` / `text-green-700` (encouragement) -> `bg-sage-50 dark:bg-sage-900/20` / `text-sage-700 dark:text-sage-300`

**Outer container:**
- `from-warm-50 to-white` (full-screen gradient) -> `from-warm-50 to-white dark:from-hearth-950 dark:to-hearth-900`

**warm-* text classes:** Add dark variants following the same pattern as above.

---

#### 4. DecompressionTimer.jsx (shelter)

**Path:** `/Users/michaelbond/echo-vault/src/components/shelter/DecompressionTimer.jsx`

This component uses a dark-on-dark UI (white text on dark backgrounds, used within the shelter view). The off-palette instances are accent colors:

- `text-blue-400` (Clock icon in header) -> `text-lavender-400 dark:text-lavender-300`
- `text-blue-500` (progress circle SVG stroke) -> `text-lavender-500 dark:text-lavender-400`
- `bg-blue-500` (selected preset, start button) -> `bg-lavender-500 dark:bg-lavender-600`
- `ring-blue-500/50` (recommended preset ring) -> `ring-lavender-500/50 dark:ring-lavender-400/50`
- `hover:bg-blue-600` (start button hover) -> `hover:bg-lavender-600 dark:hover:bg-lavender-700`
- `bg-green-500` (completion circle) -> `bg-sage-500 dark:bg-sage-600`
- `text-amber-400/80` (minimum time warning) -> `text-honey-400/80 dark:text-honey-300/80`

**DecompressionTimerCompact:**
- `bg-blue-500/20` / `text-blue-400` -> `bg-lavender-500/20 dark:bg-lavender-400/20` / `text-lavender-400 dark:text-lavender-300`

**Note:** The `text-white`, `bg-white/*`, `bg-black/*` classes in this component are intentional for the dark overlay UI. Keep them but ensure they work in both light and dark mode contexts. If the shelter view is always dark-surfaced, these may not need `dark:` variants. However, for consistency if the parent ever changes, add `dark:` variants to the white text/background opacity classes.

---

#### 5. GroundingExercise.jsx (shelter)

**Path:** `/Users/michaelbond/echo-vault/src/components/shelter/GroundingExercise.jsx`

This file uses a dark-surface UI context (within shelter mode). The `getColorClasses` function returns off-palette colors:

**`getColorClasses` function -- replace entire mapping:**
- `blue` -> `{ bg: 'bg-lavender-500', text: 'text-lavender-400', ring: 'ring-lavender-500', focusBorder: 'focus:border-lavender-500' }`
- `green` -> `{ bg: 'bg-sage-500', text: 'text-sage-400', ring: 'ring-sage-500', focusBorder: 'focus:border-sage-500' }`
- `purple` -> `{ bg: 'bg-lavender-600', text: 'text-lavender-400', ring: 'ring-lavender-600', focusBorder: 'focus:border-lavender-600' }`
- `amber` -> `{ bg: 'bg-honey-500', text: 'text-honey-400', ring: 'ring-honey-500', focusBorder: 'focus:border-honey-500' }`
- `rose` -> `{ bg: 'bg-terra-500', text: 'text-terra-400', ring: 'ring-terra-500', focusBorder: 'focus:border-terra-500' }`

**Completion state:**
- `bg-green-500` (check circle) -> `bg-sage-500`
- `ring-offset-gray-900` (progress indicator ring offset) -> `ring-offset-hearth-900`

**"Do Again" button:**
- `text-gray-900` -> `text-hearth-900`

**GroundingExerciseCompact:**
- `from-blue-500 to-purple-500` (gradient icon) -> `from-lavender-500 to-lavender-700` or use the `lavender-dusk` gradient preset

**GROUNDING_STEPS color values:** The `color` properties in the steps array reference keys that map into `getColorClasses`. Keep the key names but update the mapping function as above. Alternatively, rename the keys to match palette names (lavender, sage, etc.) -- either approach works as long as the mapping function matches.

---

#### 6. BreathingExercise.jsx (shelter)

**Path:** `/Users/michaelbond/echo-vault/src/components/shelter/BreathingExercise.jsx`

**BREATHING_EXERCISES config -- color property and `getCircleColor` function:**

The `color` property per exercise type feeds into `getCircleColor()`:
- `blue` -> replace gradient `'from-blue-500 to-blue-700'` with `'from-lavender-500 to-lavender-700'`
- `purple` -> replace gradient `'from-purple-500 to-purple-700'` with `'from-lavender-600 to-lavender-800'`
- `teal` -> replace gradient `'from-teal-500 to-teal-700'` with `'from-sage-500 to-sage-700'`

**BreathingExerciseSelector:**
- `text-blue-400` / `text-purple-400` / `text-teal-400` (Wind icon colors) -> `text-lavender-400` / `text-lavender-500` / `text-sage-400`

**Start/Resume button:**
- `text-gray-900` (play button text) -> `text-hearth-900`

The rest of the component uses `text-white`, `bg-white/*` opacity classes which are intentional for the dark shelter surface context.

---

#### 7. BurnoutNudgeBanner.jsx (shelter)

**Path:** `/Users/michaelbond/echo-vault/src/components/shelter/BurnoutNudgeBanner.jsx`

**CRITICAL SAFETY NOTE:** This component uses `red-*` classes for critical burnout states. Per the project's red-color audit criteria: `red-*` in files matching `crisis`, `safety`, `danger`, or `error` is NEVER changed without individual review. The `BurnoutNudgeBanner` represents a health/safety alert. **All `red-*` classes in this file must be retained.**

**What to change:**
- `orange-900/90` / `orange-500` / `orange-400` (high risk) -> `terra-900/90` / `terra-500` / `terra-400`
- `yellow-900/90` / `yellow-500` / `yellow-400` (moderate risk) -> `honey-900/90` / `honey-500` / `honey-400`
- `amber-500` (checkbox focus ring) -> `honey-500` and `focus:ring-honey-500`
- `amber-900/90` in high-risk gradient -> `honey-900/90`

**What to KEEP unchanged:**
- `red-900/90`, `red-800/90`, `red-500`, `red-400` (critical risk -- safety coloring)
- `bg-white text-red-900` (critical CTA button -- safety emphasis)
- `bg-red-500` (risk score progress bar for critical -- safety indicator)
- `bg-orange-500` in risk score bar for high -> replace with `bg-terra-500`
- `bg-yellow-500` in risk score bar for moderate -> replace with `bg-honey-500`

**Dark mode additions:** This component is already styled for dark contexts (uses transparent dark gradients, white text). Add `dark:` variants to ensure it works if the parent context changes:
- No major dark mode changes needed since the component is already designed for dark surfaces
- Optionally add `dark:` variants to border colors and gradient stops for robustness

---

#### 8. ShelterView.jsx (dashboard view)

**Path:** `/Users/michaelbond/echo-vault/src/components/dashboard/views/ShelterView.jsx`

This is the largest file in this section with the most off-palette instances. It contains the `DropAnchorExercise` sub-component and the main `ShelterView` component.

**DropAnchorExercise -- Replace all `teal-*` with `sage-*`:**

The entire DropAnchor exercise uses `teal-*` extensively (teal-100, teal-200, teal-400, teal-500, teal-600, teal-700, teal-800, teal-50). Replace all with `sage-*` equivalents:

- `bg-teal-100` -> `bg-sage-100 dark:bg-sage-900/30`
- `text-teal-600` -> `text-sage-600 dark:text-sage-400`
- `text-teal-800` -> `text-sage-800 dark:text-sage-200`
- `text-teal-500` -> `text-sage-500 dark:text-sage-400`
- `text-teal-700` -> `text-sage-700 dark:text-sage-300`
- `text-teal-400` -> `text-sage-400 dark:text-sage-500`
- `bg-teal-500` / `hover:bg-teal-600` -> `bg-sage-500 dark:bg-sage-600` / `hover:bg-sage-600 dark:hover:bg-sage-700`
- `bg-teal-100` / `text-teal-400` -> `bg-sage-100 dark:bg-sage-800` / `text-sage-400 dark:text-sage-500`
- `border-teal-200` -> `border-sage-200 dark:border-sage-700`
- `focus:border-teal-400` / `focus:ring-teal-100` -> `focus:border-sage-400 dark:focus:border-sage-600` / `focus:ring-sage-100 dark:focus:ring-sage-900/30`
- `bg-teal-200` -> `bg-sage-200 dark:bg-sage-800`
- `bg-teal-50` / `via-cyan-50` -> `bg-sage-50 dark:bg-sage-950/20` / remove `via-cyan-50` or replace with `via-sage-100 dark:via-sage-900/20`
- `border-teal-100` -> `border-sage-100 dark:border-sage-800`
- `bg-teal-200` (progress dots) -> `bg-sage-200 dark:bg-sage-700`

**ShelterView main -- breathing mode:**
- `text-blue-500 hover:text-blue-700` (back button) -> `text-lavender-500 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300`
- `from-blue-900/50 to-indigo-900/50` / `border-blue-500/30` (breathing container) -> `from-lavender-900/50 to-lavender-950/50 dark:from-lavender-950/50 dark:to-hearth-950/50` / `border-lavender-500/30 dark:border-lavender-600/30`

**ShelterView main -- grounding mode:**
- `text-purple-500 hover:text-purple-700` (back button) -> `text-lavender-600 hover:text-lavender-800 dark:text-lavender-400 dark:hover:text-lavender-300`
- `from-purple-900/50 to-blue-900/50` / `border-purple-500/30` -> `from-lavender-800/50 to-lavender-950/50 dark:from-lavender-900/50 dark:to-hearth-950/50` / `border-lavender-500/30 dark:border-lavender-600/30`

**ShelterView main -- timer mode:**
- `text-blue-500 hover:text-blue-700` (back button) -> same as breathing
- `from-gray-800/80 to-gray-900/80` / `border-white/10` -> `from-hearth-800/80 to-hearth-900/80 dark:from-hearth-900/80 dark:to-hearth-950/80` / keep `border-white/10`

**ShelterView main -- breathing-select mode:**
- `text-blue-500 hover:text-blue-700` (back button) -> same as breathing
- `from-blue-900/30 to-indigo-900/30` / `border-blue-500/20` -> `from-lavender-900/30 to-lavender-950/30` / `border-lavender-500/20`

**ShelterView main menu -- activity progress:**
- `text-green-400` -> `text-sage-400 dark:text-sage-300`

**ShelterView main menu -- burnout context card:**
- `from-amber-900/30 to-red-900/30` / `border-amber-500/30` -> keep `to-red-900/30` (safety). Replace `from-amber-900/30` with `from-honey-900/30`, `border-amber-500/30` with `border-honey-500/30`
- `text-amber-400` / `text-amber-200` / `text-amber-100` / `text-amber-200/70` -> `text-honey-400` / `text-honey-200` / `text-honey-100` / `text-honey-200/70`

**ShelterView main menu -- hero section:**
- `from-amber-50 via-orange-50 to-warm-50` (burnout) -> `from-honey-50 via-honey-100 to-warm-50 dark:from-honey-900/20 dark:via-honey-950/20 dark:to-hearth-900`
- `border-amber-200` (burnout) -> `border-honey-200 dark:border-honey-700`
- `bg-amber-100` / `text-amber-500` -> `bg-honey-100 dark:bg-honey-900/30` / `text-honey-500 dark:text-honey-400`
- `text-amber-800` / `text-amber-700` -> `text-honey-800 dark:text-honey-200` / `text-honey-700 dark:text-honey-300`
- `from-rose-50 via-pink-50 to-warm-50` (low mood) -> `from-terra-50 via-terra-100 to-warm-50 dark:from-terra-900/20 dark:via-terra-950/20 dark:to-hearth-900`
- `border-rose-100` -> `border-terra-100 dark:border-terra-800`
- `bg-rose-100` / `text-rose-400` -> `bg-terra-100 dark:bg-terra-900/30` / `text-terra-400 dark:text-terra-500`
- `text-rose-800` / `text-rose-600` -> `text-terra-800 dark:text-terra-200` / `text-terra-600 dark:text-terra-400`

**ShelterView main menu -- Vent button:**
- `bg-rose-500 hover:bg-rose-600` -> `bg-terra-500 hover:bg-terra-600 dark:bg-terra-600 dark:hover:bg-terra-700`
- `text-rose-100` -> `text-terra-100 dark:text-terra-200`

**ShelterView main menu -- tool grid:**
- `bg-blue-100 hover:bg-blue-200 text-blue-700` (Breathing) -> `bg-lavender-100 hover:bg-lavender-200 text-lavender-700 dark:bg-lavender-900/30 dark:hover:bg-lavender-800/40 dark:text-lavender-300`
- `bg-purple-100 hover:bg-purple-200 text-purple-700` (5-4-3-2-1) -> `bg-lavender-200 hover:bg-lavender-300 text-lavender-800 dark:bg-lavender-800/30 dark:hover:bg-lavender-700/40 dark:text-lavender-300`
- `bg-teal-100 hover:bg-teal-200 text-teal-700` (Take a Break) -> `bg-sage-100 hover:bg-sage-200 text-sage-700 dark:bg-sage-900/30 dark:hover:bg-sage-800/40 dark:text-sage-300`

**ShelterView main menu -- Drop Anchor button:**
- `bg-teal-500 hover:bg-teal-600` -> `bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700`

**ShelterView main menu -- CBT Reframe:**
- `text-green-500` (Leaf icon) -> `text-sage-500 dark:text-sage-400`
- `bg-white` / `border-warm-100` -> `bg-white dark:bg-hearth-850` / `border-warm-100 dark:border-hearth-700`

---

## Checklist

Use this as an implementation checklist:

- [ ] Replace all `amber-*` with `honey-*` in EventReflectionPrompt.jsx
- [ ] Replace all `green-*` / `rose-*` / `purple-*` / `blue-*` with sage/terra/lavender in EventReflectionPrompt.jsx
- [ ] Add `dark:` variants to all color classes in EventReflectionPrompt.jsx
- [ ] Replace `phaseColors` and `colorClasses` objects in anticipatory GroundingExercise.jsx
- [ ] Add `dark:` variants to all color classes in anticipatory GroundingExercise.jsx
- [ ] Replace all off-palette colors per step in FutureSelfCheckIn.jsx
- [ ] Add `dark:` variants to all color classes in FutureSelfCheckIn.jsx
- [ ] Replace `blue-*` with `lavender-*` and `green-*` with `sage-*` in DecompressionTimer.jsx
- [ ] Replace `getColorClasses` mapping in shelter GroundingExercise.jsx
- [ ] Replace `getCircleColor` mapping in BreathingExercise.jsx
- [ ] Replace `gray-*` with `hearth-*` in shelter components
- [ ] Audit BurnoutNudgeBanner.jsx -- replace orange/yellow/amber, KEEP all red-* classes
- [ ] Replace all teal-* with sage-* in ShelterView DropAnchorExercise
- [ ] Replace blue/purple/indigo/rose/pink/green/gray with palette equivalents in ShelterView
- [ ] Add `dark:` variants throughout ShelterView.jsx
- [x] Run grep verification: no off-palette classes remain (excluding red-* in BurnoutNudgeBanner)
- [x] Run grep verification: all 8 files contain `dark:` prefixed classes

---

## Implementation Notes (Post-Implementation)

### Files Modified
All 8 files listed in the plan were modified as specified:
1. `src/components/anticipatory/EventReflectionPrompt.jsx` - ~55 dark: classes added
2. `src/components/anticipatory/GroundingExercise.jsx` - ~38 dark: classes added (phaseColors, colorClasses objects)
3. `src/components/anticipatory/FutureSelfCheckIn.jsx` - ~56 dark: classes added (per-step color objects)
4. `src/components/shelter/DecompressionTimer.jsx` - 9 dark: classes added
5. `src/components/shelter/GroundingExercise.jsx` - 5 dark: classes added (getColorClasses)
6. `src/components/shelter/BreathingExercise.jsx` - 3 dark: classes added (getCircleColor)
7. `src/components/shelter/BurnoutNudgeBanner.jsx` - 3 dark: classes added (getBannerStyles borders)
8. `src/components/dashboard/views/ShelterView.jsx` - ~60 dark: classes added

### Deviations from Plan
1. **BurnoutNudgeBanner moderate gradient**: Plan mapped both `yellow-*` and `amber-*` to `honey-*`, creating a degenerate `from-honey-900/90 to-honey-900/90`. Fixed to `from-honey-800/90 to-honey-900/90` to preserve visual gradient.
2. **Shelter dark: classes**: Plan noted dark: was "optional" for shelter components (lines 367-369) but verification tests (line 73) required them. Added minimal dark: variants for robustness.
3. **breathing-select container**: Plan didn't specify dark: for the breathing-select mode container but all sibling mode containers had them. Added for consistency.

### Verification Results
- 0 off-palette color instances across all 8 files (grep verified)
- All 8 files contain dark: prefixed classes (grep verified)
- All red-* safety classes preserved in BurnoutNudgeBanner (grep verified)
- 615 tests passing across 38 test suites
- 246 insertions, 246 deletions (net zero line count change)