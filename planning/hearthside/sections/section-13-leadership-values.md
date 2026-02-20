Now I have a complete understanding of all four target files and the project context. Let me generate the section content.

# Section 13: Leadership and Values Components -- Hearthside Palette + Dark Mode

## Overview

This section covers the Hearthside palette migration and dark mode support for four component files in the leadership and values feature areas:

- `/Users/michaelbond/echo-vault/src/components/leadership/PostMortem.jsx` (~16 off-palette instances)
- `/Users/michaelbond/echo-vault/src/components/leadership/LeadershipThreadCard.jsx` (~10 off-palette instances)
- `/Users/michaelbond/echo-vault/src/components/values/ValuesDashboard.jsx` (~11 off-palette instances)
- `/Users/michaelbond/echo-vault/src/components/values/ValueGapCard.jsx` (~10 off-palette instances)

Additionally, the read-only SVG file `/Users/michaelbond/echo-vault/src/components/values/ValuesRadarChart.jsx` uses inline hex colors for the chart polygon that should be updated to palette-derived values.

**No functional changes.** Only CSS class replacements and dark mode additions.

## Dependencies

This section depends on:

- **section-01-tokens-config**: The `hearth-850` token and gradient system must exist in `tailwind.config.js`
- **section-02-color-map**: The `src/utils/colorMap.js` utility must exist (though these components do not import from it -- they use direct Tailwind classes since their color logic is local, not semantic-mapping-based)
- **section-03-css-components**: Dark mode variants for `.card`, `.btn-*`, `.badge-*`, `.modal-*`, `.input` CSS classes must exist in `src/index.css`

## Hearthside Palette Reference

These are the Hearthside palette names used throughout this section as replacements:

| Generic Tailwind | Hearthside Replacement | Semantic Use |
|------------------|----------------------|--------------|
| `blue-*` | `lavender-*` | Reflection, initial feedback, trade-off awareness |
| `rose-*` / `pink-*` | `terra-*` | Emotions, feelings, gentle awareness |
| `purple-*` | `lavender-*` (darker shades) | Thinking patterns, distortions, CBT |
| `amber-*` / `orange-*` | `honey-*` | Values, pattern awareness, warmth |
| `green-*` / `emerald-*` | `sage-*` | Growth, improving trends, strengths, commitments |
| `teal-*` | `sage-*` (or `accent-*`) | Self-compassion, completion |
| `red-*` | **Keep as-is** | Concerning trends, declining values (semantic danger/warning -- do NOT change) |

## Tests

Tests for this section are file-content verification (grep-based) rather than runtime unit tests. They confirm that off-palette color classes have been removed from each file.

### Test file: `/Users/michaelbond/echo-vault/src/components/leadership/__tests__/hearthside-palette.test.js`

```javascript
/**
 * Hearthside palette verification for leadership components.
 * Ensures off-palette generic Tailwind colors have been replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readComponent = (filename) =>
  readFileSync(join(__dirname, '..', filename), 'utf-8');

describe('PostMortem - Hearthside palette compliance', () => {
  const source = readComponent('PostMortem.jsx');

  it('does not contain off-palette blue classes', () => {
    // blue-100, blue-400, blue-500, blue-600, blue-700 were used
    expect(source).not.toMatch(/\bborder-blue-\d/);
    expect(source).not.toMatch(/\bfrom-blue-\d/);
    expect(source).not.toMatch(/\bto-blue-\d/);
    expect(source).not.toMatch(/\bbg-blue-\d/);
    expect(source).not.toMatch(/\btext-blue-\d/);
    expect(source).not.toMatch(/\bfocus:border-blue/);
    expect(source).not.toMatch(/\bfocus:ring-blue/);
  });

  it('does not contain off-palette rose classes', () => {
    expect(source).not.toMatch(/\bborder-rose-\d/);
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-rose-\d/);
    expect(source).not.toMatch(/\bbg-rose-\d/);
    expect(source).not.toMatch(/\btext-rose-\d/);
  });

  it('does not contain off-palette purple classes', () => {
    expect(source).not.toMatch(/\bborder-purple-\d/);
    expect(source).not.toMatch(/\bfrom-purple-\d/);
    expect(source).not.toMatch(/\bto-purple-\d/);
    expect(source).not.toMatch(/\bbg-purple-\d/);
    expect(source).not.toMatch(/\btext-purple-\d/);
    expect(source).not.toMatch(/\bfocus:ring-purple/);
  });

  it('does not contain off-palette amber classes (except in palette names)', () => {
    expect(source).not.toMatch(/\bborder-amber-\d/);
    expect(source).not.toMatch(/\bfrom-amber-\d/);
    expect(source).not.toMatch(/\bto-amber-\d/);
    expect(source).not.toMatch(/\bbg-amber-\d/);
    expect(source).not.toMatch(/\btext-amber-\d/);
  });

  it('does not contain off-palette green classes', () => {
    expect(source).not.toMatch(/\bfrom-green-\d/);
    expect(source).not.toMatch(/\bto-green-\d/);
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\bfocus:border-green/);
    expect(source).not.toMatch(/\bfocus:ring-green/);
  });

  it('does not contain off-palette teal classes', () => {
    expect(source).not.toMatch(/\bborder-teal-\d/);
    expect(source).not.toMatch(/\bfrom-teal-\d/);
    expect(source).not.toMatch(/\bto-teal-\d/);
    expect(source).not.toMatch(/\bbg-teal-\d/);
    expect(source).not.toMatch(/\btext-teal-\d/);
    expect(source).not.toMatch(/\bfocus:border-teal/);
    expect(source).not.toMatch(/\bfocus:ring-teal/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('LeadershipThreadCard - Hearthside palette compliance', () => {
  const source = readComponent('LeadershipThreadCard.jsx');

  it('does not contain off-palette green classes (excluding red for concerning)', () => {
    // green-50, green-100, green-200, green-500, green-600, green-700 were used
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
    expect(source).not.toMatch(/\bborder-green-\d/);
    expect(source).not.toMatch(/\bfocus:border-green/);
  });

  it('does not contain off-palette blue classes', () => {
    expect(source).not.toMatch(/\bbg-blue-\d/);
    expect(source).not.toMatch(/\btext-blue-\d/);
  });

  it('preserves red classes for concerning/danger states', () => {
    // red-* is semantic for "concerning" trend -- must stay
    expect(source).toMatch(/red-/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});
```

### Test file: `/Users/michaelbond/echo-vault/src/components/values/__tests__/hearthside-palette.test.js`

```javascript
/**
 * Hearthside palette verification for values components.
 * Ensures off-palette generic Tailwind colors have been replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readComponent = (filename) =>
  readFileSync(join(__dirname, '..', filename), 'utf-8');

describe('ValuesDashboard - Hearthside palette compliance', () => {
  const source = readComponent('ValuesDashboard.jsx');

  it('does not contain off-palette green/emerald classes', () => {
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
    expect(source).not.toMatch(/\bborder-green-\d/);
    expect(source).not.toMatch(/\bfrom-green-\d/);
    expect(source).not.toMatch(/\bto-emerald-\d/);
    expect(source).not.toMatch(/\bfrom-emerald-\d/);
  });

  it('does not contain off-palette amber classes', () => {
    expect(source).not.toMatch(/\bbg-amber-\d/);
    expect(source).not.toMatch(/\btext-amber-\d/);
  });

  it('does not contain off-palette rose classes', () => {
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-rose-\d/);
  });

  it('preserves red for declining/danger states', () => {
    // red-50, red-500, red-600 used for "declining" trends -- semantic, keep
    expect(source).toMatch(/red-/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('ValueGapCard - Hearthside palette compliance', () => {
  const source = readComponent('ValueGapCard.jsx');

  it('does not contain off-palette blue/sky classes', () => {
    expect(source).not.toMatch(/\btext-blue-\d/);
    expect(source).not.toMatch(/\bfrom-blue-\d/);
    expect(source).not.toMatch(/\bto-sky-\d/);
    expect(source).not.toMatch(/\bborder-blue-\d/);
  });

  it('does not contain off-palette amber/orange classes', () => {
    expect(source).not.toMatch(/\btext-amber-\d/);
    expect(source).not.toMatch(/\bfrom-amber-\d/);
    expect(source).not.toMatch(/\bto-orange-\d/);
    expect(source).not.toMatch(/\bborder-amber-\d/);
  });

  it('does not contain off-palette rose/pink classes', () => {
    expect(source).not.toMatch(/\btext-rose-\d/);
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-pink-\d/);
    expect(source).not.toMatch(/\bborder-rose-\d/);
  });

  it('does not contain off-palette green classes', () => {
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('ValuesRadarChart - Hearthside palette compliance', () => {
  const source = readComponent('ValuesRadarChart.jsx');

  it('does not contain raw green/amber/red hex colors', () => {
    // Original used #22c55e, #f59e0b, #ef4444, #16a34a, #d97706, #dc2626
    expect(source).not.toMatch(/#22c55e/i);
    expect(source).not.toMatch(/#f59e0b/i);
    expect(source).not.toMatch(/#16a34a/i);
    expect(source).not.toMatch(/#d97706/i);
  });
});
```

## Implementation Details

### File 1: `/Users/michaelbond/echo-vault/src/components/leadership/PostMortem.jsx`

This component is a 6-step guided reflection flow (modal) for post-leadership-conversation processing. It has a `STEP_COLORS` object and per-step inline color usage.

**Current off-palette instances (~16):**

1. **`STEP_COLORS` object (lines 33-40)**: Uses `blue`, `rose`, `purple`, `amber`, `green`, `teal` border and gradient classes.
2. **Summary step (line 167)**: `focus:border-blue-400 focus:ring-2 focus:ring-blue-100`
3. **People badges (line 173)**: `bg-blue-100 text-blue-700`
4. **Feelings step (lines 195-196)**: `border-rose-400 bg-rose-50 text-rose-700`
5. **Distortions step (lines 227-229)**: `border-purple-400 bg-purple-50`, `border-purple-200 bg-purple-50/50`
6. **Checkbox (line 238)**: `text-purple-600 focus:ring-purple-500`
7. **Reframe text (line 248)**: `text-purple-600`
8. **Values step (lines 272-273)**: `border-amber-400 bg-amber-50 text-amber-700`
9. **Values feedback (line 282)**: `bg-amber-50`, `text-amber-800`
10. **Learnings step (line 301)**: `focus:border-green-400 focus:ring-2 focus:ring-green-100`
11. **Compassion step (line 319)**: `focus:border-teal-400 focus:ring-2 focus:ring-teal-100`
12. **Compassion box (line 321)**: `bg-teal-50`, `text-teal-800`
13. **Modal background (line 344)**: `bg-white` (needs dark variant)
14. **Complete button (line 408-409)**: `bg-teal-500 hover:bg-teal-600`

**Replacement mapping for `STEP_COLORS`:**

| Step | Current | Replace With | Dark Variant |
|------|---------|-------------|--------------|
| `blue` (Summary) | `border-blue-100`, `from-blue-500 to-blue-600` | `border-lavender-100`, `from-lavender-500 to-lavender-600` | `dark:border-lavender-800`, `dark:from-lavender-700 dark:to-lavender-800` |
| `rose` (Feelings) | `border-rose-100`, `from-rose-500 to-rose-600` | `border-terra-100`, `from-terra-400 to-terra-500` | `dark:border-terra-800`, `dark:from-terra-600 dark:to-terra-700` |
| `purple` (Distortions) | `border-purple-100`, `from-purple-500 to-purple-600` | `border-lavender-200`, `from-lavender-600 to-lavender-700` | `dark:border-lavender-800`, `dark:from-lavender-700 dark:to-lavender-800` |
| `amber` (Values) | `border-amber-100`, `from-amber-500 to-amber-600` | `border-honey-100`, `from-honey-500 to-honey-600` | `dark:border-honey-800`, `dark:from-honey-600 dark:to-honey-700` |
| `green` (Learnings) | `border-green-100`, `from-green-500 to-green-600` | `border-sage-100`, `from-sage-500 to-sage-600` | `dark:border-sage-800`, `dark:from-sage-600 dark:to-sage-700` |
| `teal` (Compassion) | `border-teal-100`, `from-teal-500 to-teal-600` | `border-sage-200`, `from-sage-400 to-sage-500` | `dark:border-sage-800`, `dark:from-sage-500 dark:to-sage-600` |

**Per-step inline color replacements (examples):**

- `bg-blue-100 text-blue-700` (people badges) becomes `bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300`
- `border-rose-400 bg-rose-50 text-rose-700` (feelings selected) becomes `border-terra-400 bg-terra-50 text-terra-700 dark:border-terra-500 dark:bg-terra-900/30 dark:text-terra-300`
- `border-purple-400 bg-purple-50` (distortions checked) becomes `border-lavender-400 bg-lavender-50 dark:border-lavender-500 dark:bg-lavender-900/30`
- `text-purple-600` (reframe text, checkbox) becomes `text-lavender-600 dark:text-lavender-400`
- `border-amber-400 bg-amber-50 text-amber-700` (values selected) becomes `border-honey-400 bg-honey-50 text-honey-700 dark:border-honey-500 dark:bg-honey-900/30 dark:text-honey-300`
- `bg-amber-50` / `text-amber-800` (values feedback box) becomes `bg-honey-50 dark:bg-honey-900/30` / `text-honey-800 dark:text-honey-200`
- `focus:border-green-400 focus:ring-green-100` (learnings textarea) becomes `focus:border-sage-400 focus:ring-sage-100 dark:focus:border-sage-500 dark:focus:ring-sage-900/40`
- `bg-teal-50` / `text-teal-800` (compassion box) becomes `bg-sage-50 dark:bg-sage-900/30` / `text-sage-800 dark:text-sage-200`
- `bg-teal-500 hover:bg-teal-600` (complete button) becomes `bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-500`

**Dark mode for structural elements:**

- Modal backdrop `bg-white` becomes `bg-white dark:bg-hearth-900`
- Navigation bar `bg-warm-50 border-warm-100` gains `dark:bg-hearth-850 dark:border-hearth-800`
- Progress bar background `bg-white/20` is fine for both modes (it is overlaid on the gradient header)

---

### File 2: `/Users/michaelbond/echo-vault/src/components/leadership/LeadershipThreadCard.jsx`

This component shows a leadership thread with a timeline of follow-ups. It has dynamic color functions for trend states.

**Current off-palette instances (~10):**

1. **`getTrendIcon` function (line 79)**: `text-green-500` for improving
2. **`getTrendColor` function (lines 87-88)**: `border-green-200 bg-green-50` for improving
3. **Trend label (line 137)**: `text-green-600` for improving
4. **Timeline initial dot (line 179)**: `bg-blue-500`
5. **Timeline label (line 185)**: `text-blue-600`
6. **Follow-up positive dot (line 203)**: `bg-green-500`
7. **Follow-up positive icon (line 213)**: `text-green-500`
8. **Progress indicator badges (line 225)**: `bg-green-100 text-green-700`
9. **Completion textarea focus (line 270)**: `focus:border-green-400`
10. **Archive button (line 279)**: `bg-green-500 hover:bg-green-600`

**Important: `red-*` classes in this file are semantic** (concerning trends, concern indicators, declining). They represent actual warnings and MUST remain as `red-*`.

**Replacement mapping:**

| Current | Replace With | Dark Variant |
|---------|-------------|--------------|
| `text-green-500` (trend icon) | `text-sage-500` | `dark:text-sage-400` |
| `border-green-200 bg-green-50` (trend card) | `border-sage-200 bg-sage-50` | `dark:border-sage-800 dark:bg-sage-900/30` |
| `text-green-600` (trend label) | `text-sage-600` | `dark:text-sage-400` |
| `bg-blue-500` (timeline dot) | `bg-lavender-500` | `dark:bg-lavender-400` |
| `text-blue-600` (initial feedback label) | `text-lavender-600` | `dark:text-lavender-400` |
| `bg-green-500` (positive follow-up dot) | `bg-sage-500` | `dark:bg-sage-400` |
| `text-green-500` (positive follow-up icon) | `text-sage-500` | `dark:text-sage-400` |
| `bg-green-100 text-green-700` (progress badges) | `bg-sage-100 text-sage-700` | `dark:bg-sage-900/30 dark:text-sage-300` |
| `focus:border-green-400` (textarea) | `focus:border-sage-400` | `dark:focus:border-sage-500` |
| `bg-green-500 hover:bg-green-600` (archive btn) | `bg-sage-500 hover:bg-sage-600` | `dark:bg-sage-600 dark:hover:bg-sage-500` |

**Dark mode for structural elements:**

- The `bg-white` avatar circle (line 122) becomes `bg-white dark:bg-hearth-850`
- Timeline connector line `bg-warm-200` gains `dark:bg-hearth-700`
- The `border-white/50` section dividers become `dark:border-hearth-700/50`
- Concern indicator badges (`bg-red-100 text-red-700`) gain `dark:bg-red-900/30 dark:text-red-300` -- note we ADD dark variants to red but do NOT change the base red classes

---

### File 3: `/Users/michaelbond/echo-vault/src/components/values/ValuesDashboard.jsx`

This is the main values dashboard with trend indicators, overall score, strengths section, and priority modal.

**Current off-palette instances (~11):**

1. **`getStatusColor` (lines 91-93)**: `text-green-600`, `text-amber-600`
2. **`getStatusBg` (lines 97-99)**: `bg-green-100`, `bg-amber-100`
3. **Overall message gradient (line 147)**: `from-warm-50 to-rose-50`
4. **Improving trend circle (line 181)**: `bg-green-100`
5. **Improving trend icon (line 182)**: `text-green-600`
6. **Improving trend labels (line 187)**: `text-green-700`
7. **Declining trend circle (line 217)**: `bg-red-50` -- **keep as red** (semantic)
8. **Declining trend icon (line 218)**: `text-red-500` -- **keep as red**
9. **Declining trend labels (line 224)**: `text-red-600` -- **keep as red**
10. **Strengths section (line 248)**: `from-green-50 to-emerald-50 border-green-200`
11. **Strengths heading (line 249)**: `text-green-800`
12. **Strengths text (lines 256-258)**: `text-green-700`, `text-green-600`

**Replacement mapping:**

| Current | Replace With | Dark Variant |
|---------|-------------|--------------|
| `text-green-600` (high score) | `text-sage-600` | `dark:text-sage-400` |
| `text-amber-600` (mid score) | `text-honey-600` | `dark:text-honey-400` |
| `bg-green-100` (high score bg) | `bg-sage-100` | `dark:bg-sage-900/30` |
| `bg-amber-100` (mid score bg) | `bg-honey-100` | `dark:bg-honey-900/30` |
| `from-warm-50 to-rose-50` (message) | `from-warm-50 to-terra-50` | `dark:from-hearth-850 dark:to-terra-900/20` |
| `bg-green-100` (improving circle) | `bg-sage-100` | `dark:bg-sage-900/30` |
| `text-green-600` (improving icon) | `text-sage-600` | `dark:text-sage-400` |
| `text-green-700` (improving labels) | `text-sage-700` | `dark:text-sage-300` |
| `from-green-50 to-emerald-50 border-green-200` (strengths) | `from-sage-50 to-sage-100 border-sage-200` | `dark:from-sage-900/30 dark:to-sage-900/20 dark:border-sage-800` |
| `text-green-800` (strengths heading) | `text-sage-800` | `dark:text-sage-200` |
| `text-green-700` / `text-green-600` (strengths text) | `text-sage-700` / `text-sage-600` | `dark:text-sage-300` / `dark:text-sage-400` |

**Red classes (declining) are KEPT as-is** but gain dark variants: `dark:bg-red-900/30`, `dark:text-red-400`, `dark:text-red-300`.

**Dark mode for structural elements:**

- `bg-white` on Radar Chart card (line 157) and Trends card (line 176) becomes `bg-white dark:bg-hearth-850`
- `border-warm-200` on cards gains `dark:border-hearth-700`
- Priority modal `bg-white` (line 281) becomes `bg-white dark:bg-hearth-900`
- Priority modal `bg-black/50` backdrop is already fine for dark mode

---

### File 4: `/Users/michaelbond/echo-vault/src/components/values/ValueGapCard.jsx`

This component shows individual value gap cards with compassionate framing. It uses three different color schemes based on `reframe.type`.

**Current off-palette instances (~10):**

1. **`getIcon` function**: `text-blue-500` (trade-off), `text-amber-500` (pattern), `text-rose-400` (gentle)
2. **`getGradient` function**: `from-blue-50 to-sky-50 border-blue-200` (trade-off), `from-amber-50 to-orange-50 border-amber-200` (pattern), `from-rose-50 to-pink-50 border-rose-200` (gentle)
3. **Micro-commitment icon container (line 150)**: `bg-green-100`
4. **Micro-commitment icon (line 151)**: `text-green-600`
5. **Micro-commitment button (line 164)**: `bg-green-500 hover:bg-green-600`
6. **Commitment accepted bg (line 177)**: `bg-green-100`
7. **Commitment accepted icon/text (lines 179-182)**: `text-green-600`, `text-green-800`, `text-green-600`

**Replacement mapping for `getIcon`:**

| Reframe Type | Current | Replace With | Dark Variant |
|-------------|---------|-------------|--------------|
| `trade_off_acknowledgment` | `text-blue-500` | `text-lavender-500` | `dark:text-lavender-400` |
| `pattern_awareness` | `text-amber-500` | `text-honey-500` | `dark:text-honey-400` |
| `gentle_awareness` | `text-rose-400` | `text-terra-400` | `dark:text-terra-300` |

**Replacement mapping for `getGradient`:**

| Reframe Type | Current | Replace With | Dark Variant |
|-------------|---------|-------------|--------------|
| `trade_off_acknowledgment` | `from-blue-50 to-sky-50 border-blue-200` | `from-lavender-50 to-lavender-100 border-lavender-200` | `dark:from-lavender-900/30 dark:to-lavender-900/20 dark:border-lavender-800` |
| `pattern_awareness` | `from-amber-50 to-orange-50 border-amber-200` | `from-honey-50 to-honey-100 border-honey-200` | `dark:from-honey-900/30 dark:to-honey-900/20 dark:border-honey-800` |
| `gentle_awareness` | `from-rose-50 to-pink-50 border-rose-200` | `from-terra-50 to-terra-100 border-terra-200` | `dark:from-terra-900/30 dark:to-terra-900/20 dark:border-terra-800` |

**Green replacements (micro-commitment section):**

| Current | Replace With | Dark Variant |
|---------|-------------|--------------|
| `bg-green-100` (icon bg) | `bg-sage-100` | `dark:bg-sage-900/30` |
| `text-green-600` (icon, text) | `text-sage-600` | `dark:text-sage-400` |
| `bg-green-500 hover:bg-green-600` (button) | `bg-sage-500 hover:bg-sage-600` | `dark:bg-sage-600 dark:hover:bg-sage-500` |
| `bg-green-100` (accepted bg) | `bg-sage-100` | `dark:bg-sage-900/30` |
| `text-green-800` (accepted heading) | `text-sage-800` | `dark:text-sage-200` |
| `text-green-600` (accepted subtext) | `text-sage-600` | `dark:text-sage-400` |

**Dark mode for structural elements:**

- `bg-white/50` inner containers become `bg-white/50 dark:bg-hearth-800/50`
- `bg-white/70` micro-commitment container becomes `bg-white/70 dark:bg-hearth-800/70`

---

### File 5: `/Users/michaelbond/echo-vault/src/components/values/ValuesRadarChart.jsx`

This SVG-based chart component uses inline hex colors for the polygon fill and stroke.

**Current hex colors (line 83-85):**

```javascript
const fillColor = overallScore >= 0.7 ? '#22c55e' : overallScore >= 0.5 ? '#f59e0b' : '#ef4444';
const strokeColor = overallScore >= 0.7 ? '#16a34a' : overallScore >= 0.5 ? '#d97706' : '#dc2626';
```

These map to: green-500/green-600 (good), amber-500/amber-600 (mid), red-500/red-600 (low).

**Replacement:** Use palette-derived hex values. The exact hex values come from the Hearthside palette defined in `tailwind.config.js`. The implementer should look up the actual hex values for `sage-500`, `sage-600`, `honey-500`, `honey-600` from the config. Red stays as-is (semantic for low alignment).

The approximate mapping:

| Current Hex | Generic Name | Replace With | Palette Token |
|------------|-------------|-------------|---------------|
| `#22c55e` | green-500 fill (good) | Sage-500 hex from config | `sage-500` |
| `#16a34a` | green-600 stroke (good) | Sage-600 hex from config | `sage-600` |
| `#f59e0b` | amber-500 fill (mid) | Honey-500 hex from config | `honey-500` |
| `#d97706` | amber-600 stroke (mid) | Honey-600 hex from config | `honey-600` |
| `#ef4444` | red-500 fill (low) | **Keep as-is** | -- |
| `#dc2626` | red-600 stroke (low) | **Keep as-is** | -- |

Additionally, the grid lines use generic grays (`#e5e5e5`, `#d4d4d4`). These should be updated to warm-palette grays (use `warm-200` and `warm-300` hex equivalents from the config, or import from `HEX_COLORS` in `colorMap.js` if available).

For dark mode, the SVG colors need to change dynamically. The implementer should either:
- Import `isDarkMode` from `src/utils/darkMode.js` and use conditional hex values, OR
- Add a `useDarkMode` hook/state and swap fill/stroke colors accordingly
- Dark mode grid lines should use hearth-700/hearth-600 hex equivalents

---

## Implementation Checklist (Completed)

All steps completed. Actual implementation notes:

1. Created test directories and wrote 2 test files (22 tests total)
2. Tests confirmed off-palette classes existed (20 failed, 2 passed for red preservation)
3. Updated all 5 files with Hearthside palette + dark mode variants
4. **PostMortem.jsx**: STEP_COLORS keys renamed from generic colors to palette names (lavender, terra, lavenderDeep, honey, sage, sageLight). All inline colors replaced.
5. **LeadershipThreadCard.jsx**: All green->sage, blue->lavender. Red kept for concerning states with dark variants added.
6. **ValuesDashboard.jsx**: green->sage, amber->honey, rose->terra. Red kept for declining with dark variants.
7. **ValueGapCard.jsx**: Three gradient schemes updated (trade_off->lavender, pattern->honey, gentle->terra). Green micro-commitment->sage.
8. **ValuesRadarChart.jsx**: Hex colors replaced with palette values from tailwind.config.js. Created `src/hooks/useDarkMode.js` (MutationObserver-based) for reactive dark mode in SVG.
9. All 22 tests pass.

### Files Created
- `src/components/leadership/__tests__/hearthside-palette.test.js`
- `src/components/values/__tests__/hearthside-palette.test.js`
- `src/hooks/useDarkMode.js` (MutationObserver-based React hook for reactive dark mode tracking)

### Files Modified
- `src/components/leadership/PostMortem.jsx`
- `src/components/leadership/LeadershipThreadCard.jsx`
- `src/components/values/ValuesDashboard.jsx`
- `src/components/values/ValueGapCard.jsx`
- `src/components/values/ValuesRadarChart.jsx`

### Deviations from Plan
- Plan suggested using `isDarkMode()` directly or a hook for ValuesRadarChart. Code review identified that `isDarkMode()` is not reactive. Created `src/hooks/useDarkMode.js` with MutationObserver for real-time updates.
- Added dark variants to critical warm-* text (headings, body text) beyond the scope of pure palette swap, per code review feedback.
- Plan's hex values for SVG grid/axis were approximate. Used exact hex values from tailwind.config.js (hearth-700=#4A3D32, warm-200=#E8DDD0, hearth-600=#6B5A4A, warm-300=#D4C4B0).

## Notes on Red Color Handling

Per the project's red-color audit criteria: `red-*` in these files is used for **concerning/declining/danger states** -- this is semantic and appropriate. These red classes are NOT converted. However, dark mode variants ARE added to them (e.g., `dark:bg-red-900/30 dark:text-red-300`) to ensure visibility on dark backgrounds.

The `red-*` concern indicator badges in `LeadershipThreadCard.jsx` (line 236: `bg-red-100 text-red-700`) represent actual concern warnings and fall under the safety/danger exception.