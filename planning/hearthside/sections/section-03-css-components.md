I now have all the context needed. Let me generate the section content.

# Section 3: CSS Component Class Extensions

## Overview

This section extends the existing CSS component classes in `/Users/michaelbond/echo-vault/src/index.css` with dark mode variants, adds missing card variants, creates gradient utility classes, and reconciles the `Button` component in `/Users/michaelbond/echo-vault/src/components/ui/index.jsx` with the CSS-based `.btn-*` classes.

This is a Phase 1 (Foundation) task. It depends on **section-01-tokens-config** (the `hearth-850` token and gradient presets must exist in `tailwind.config.js` before gradient utility classes can reference them). It blocks **section-06-collapsible-section** and all screen sweep sections (07-16) which rely on the dark-mode-ready component classes.

---

## Background and Context

### Current State of `src/index.css`

The file at `/Users/michaelbond/echo-vault/src/index.css` already defines the following CSS component classes within `@layer components`:

- **Buttons:** `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`
- **Cards:** `.card`, `.card-interactive`, `.card-glass`, `.card-warm`
- **Modals:** `.modal-backdrop`, `.modal-content`
- **Inputs:** `.input`, `.input-lg`, `.textarea`
- **Badges:** `.badge`, `.badge-primary`, `.badge-secondary`, `.badge-accent`, `.badge-terra`, `.badge-mood-great`, `.badge-mood-low`
- **Mood indicators, loading states, effects, entry cards, recording animations, prompt cards**

None of these classes (except the base `html` typography and focus/selection styles) have `dark:` variants. The dark mode configuration is enabled in `tailwind.config.js` (`darkMode: 'class'`), but only 33 `dark:` prefixes exist across 7 files in the entire codebase.

### Current State of `src/components/ui/index.jsx`

This file defines React components (`Button`, `Card`, `Badge`, `Toast`, etc.) that use inline Tailwind class strings. The `Button` component has 5 variants (primary, secondary, ghost, danger, success) with different class strings than the `.btn-*` CSS classes in `index.css`. There are also off-palette colors used:

- `Button.success` uses `from-emerald-500 to-emerald-600` (off-palette)
- `Badge.success` uses `bg-emerald-100 text-emerald-700` (off-palette)
- `Badge.warning` uses `bg-amber-100 text-amber-700` (off-palette)
- `Toast.success` uses `bg-emerald-500` (off-palette)
- `Toast.warning` uses `bg-amber-500` (off-palette)
- `EntryCard.moodColors` uses `to-emerald-600`, `to-emerald-500`, `to-blue-600`, `to-indigo-600` (off-palette)

### Design System Palette Reference

The Hearthside palette (defined in `tailwind.config.js`) provides:

| Token | Purpose |
|-------|---------|
| `hearth-50` to `hearth-950` | Surface colors (light to deepest dark) |
| `honey-50` to `honey-900` | Primary accent, warmth |
| `terra-50` to `terra-900` | Grounding, earth tones |
| `sage-50` to `sage-900` | Growth, success |
| `lavender-50` to `lavender-900` | Calm, reflection |
| `warm-50` to `warm-900` | Neutral warm tones (alias of hearth) |

Dark mode backgrounds should use warm-tinted dark tones (never pure black):
- `hearth-950` for deepest background
- `hearth-900` for primary dark background
- `hearth-850` (added by section-01) for raised surfaces/cards
- `hearth-800` for elevated/hover surfaces

---

## Tests

Tests for this section are CSS content verification tests. They can be implemented as grep-based checks in a test file or as a verification script. Create the test file at `/Users/michaelbond/echo-vault/src/utils/__tests__/cssComponents.test.js`.

### Test Specifications

```
Test: index.css .card class includes dark: variant rules
  - Read src/index.css content
  - Verify that within the .card definition (or in a html.dark .card rule), dark background, dark border values are present
  - The dark card background should reference hearth-850 tones (warm dark, not pure black)

Test: index.css .btn-primary includes dark: variant rules
  - Read src/index.css content
  - Verify that a dark variant exists for .btn-primary
  - The dark variant should maintain the honey gradient but adjust for dark backgrounds

Test: index.css .badge-primary includes dark: variant rules
  - Read src/index.css content
  - Verify that dark variants exist for .badge-primary, .badge-secondary, .badge-accent, .badge-terra

Test: index.css .modal-content includes dark: variant rules
  - Read src/index.css content
  - Verify that a dark variant exists for .modal-content with a warm dark background

Test: index.css .input includes dark: variant rules
  - Read src/index.css content
  - Verify that a dark variant exists for .input with dark background and border colors

Test: .card-elevated class exists with hover shadow
  - Read src/index.css content
  - Verify .card-elevated class is defined
  - Verify it includes hover shadow upgrade behavior

Test: .card-featured class exists with gradient background
  - Read src/index.css content
  - Verify .card-featured class is defined
  - Verify it includes gradient background

Test: gradient utility classes (gradient-hearth-glow, gradient-sage-mist, etc.) are defined
  - Read src/index.css content
  - Verify .gradient-hearth-glow, .gradient-sage-mist, .gradient-lavender-dusk, .gradient-terra-dawn, .gradient-hearth-surface classes exist
  - Each should have both light and dark mode definitions
```

### Test Implementation Approach

The tests should read the raw CSS file content and check for the presence of expected class names and dark mode selectors. Since these are CSS classes (not JavaScript), the tests use `fs.readFileSync` to load `src/index.css` and perform string/regex matching.

```javascript
// File: /Users/michaelbond/echo-vault/src/utils/__tests__/cssComponents.test.js
// 
// Reads src/index.css and verifies:
// - Dark mode variants exist for all component classes
// - New card variants (.card-elevated, .card-featured) exist
// - Gradient utility classes are defined
//
// Implementation: Use fs.readFileSync to load index.css,
// then use string includes/regex matching to verify class presence.
// 
// describe('CSS Component Classes - Dark Mode')
//   it('card has dark variant')
//   it('btn-primary has dark variant')
//   it('badge variants have dark variants')
//   it('modal-content has dark variant')
//   it('input has dark variant')
//
// describe('CSS Component Classes - New Variants')
//   it('card-elevated exists with hover shadow')
//   it('card-featured exists with gradient background')
//
// describe('CSS Gradient Utilities')
//   it('gradient-hearth-glow is defined')
//   it('gradient-sage-mist is defined')
//   it('gradient-lavender-dusk is defined')
//   it('gradient-terra-dawn is defined')
//   it('gradient-hearth-surface is defined')
//   it('each gradient has dark mode definition')
```

---

## Implementation Details

### Part 1: Add Dark Mode Variants to Existing CSS Component Classes

**File:** `/Users/michaelbond/echo-vault/src/index.css`

Dark mode CSS variants in Tailwind's class-based dark mode use `html.dark` as the parent selector. Since the existing component classes use raw CSS (not just `@apply` with Tailwind utilities), dark mode variants must be added as `html.dark .classname` rules.

**Strategy:** For each existing component class, add a corresponding `html.dark` rule immediately after the light mode definition. Dark mode styles should:

- Replace light backgrounds with `hearth-850` / `hearth-900` tones
- Replace light borders with `hearth-700` / `hearth-800` tones with reduced opacity
- Adjust text colors to lighter values (`hearth-100`, `hearth-200`)
- Adjust shadows to use `dark-soft` variants or border-based elevation
- Maintain the warm tone throughout (never use pure black `#000` or cool grays)

**Specific dark mode rules to add:**

1. **`.card`** -- Dark background should use `rgba(35, 29, 27, 0.95)` (approximately hearth-850 with opacity). Dark border should use `rgba(74, 61, 50, 0.4)` (hearth-700 at low opacity). Shadow shifts to `dark-soft`.

2. **`.card-interactive`** -- Inherits from `.card` dark variant. Hover shadow shifts to `dark-soft-md`.

3. **`.card-glass`** -- Dark background uses `rgba(28, 25, 22, 0.3)` (hearth-900 at low opacity). Border uses `rgba(74, 61, 50, 0.2)`.

4. **`.card-warm`** -- Dark gradient uses `rgba(74, 69, 18, 0.15)` to `rgba(94, 45, 36, 0.1)` (honey-900/terra-800 tones at very low opacity).

5. **`.btn-primary`** -- Keep the honey gradient (it reads well on dark). Adjust hover glow opacity slightly. Text stays dark on the amber button.

6. **`.btn-secondary`** -- Dark background `rgba(74, 61, 50, 0.3)`. Dark text color `#F5EDE3` (hearth-100). Border `rgba(74, 61, 50, 0.4)`.

7. **`.btn-ghost`** -- Dark text color `#B8A48E` (hearth-400). Hover: text `#F5EDE3`, bg `rgba(74, 61, 50, 0.3)`.

8. **`.btn-danger`** -- Keep as-is (red/terra gradient reads well on dark).

9. **`.modal-content`** -- Dark background `#231D1B` (hearth-850). Add subtle border `1px solid rgba(74, 61, 50, 0.3)`.

10. **`.input`** -- Dark background `rgba(28, 25, 22, 0.6)`. Dark border `rgba(74, 61, 50, 0.5)`. Dark text `#F5EDE3`. Placeholder `#8E7A66`. Focus border color `rgba(232, 168, 76, 0.5)`. Focus background `rgba(42, 36, 32, 0.8)`.

11. **`.input-lg`** and **`.textarea`** -- Inherit from `.input` dark variant.

12. **`.badge-primary`** -- Dark: `bg-sage-900/30 text-sage-300` equivalent hex values.

13. **`.badge-secondary`** -- Dark: `bg-lavender-900/30 text-lavender-300` equivalent hex values.

14. **`.badge-accent`** -- Dark: `bg-honey-900/30 text-honey-300` equivalent hex values.

15. **`.badge-terra`** -- Dark: `bg-terra-900/30 text-terra-300` equivalent hex values.

16. **`.badge-mood-great`** -- Dark: sage dark tones.

17. **`.badge-mood-low`** -- Dark: lavender dark tones.

18. **Mood indicators** (`.mood-great` through `.mood-struggling`) -- These are simple bg colors that read fine on dark backgrounds; no changes needed.

19. **`.breathing-loader`** -- Keep gradient as-is; reads well on dark.

20. **`.shimmer`** -- Dark: use hearth-800/hearth-700/hearth-800 tones.

21. **`.entry-card`** -- Dark background should inherit from `.card` dark variant. The `::before` gradient accents remain as-is (they're palette colors).

22. **`.prompt-card`** -- Inherits from `.card-warm` dark variant.

23. **`.badge-recurring`** -- Dark: `bg-lavender-800/30 text-lavender-300` (currently uses lavender-100/lavender-600 hex values).

24. **`.action-checkbox`** -- Dark border: `#4A3D32`. Hover border: `#E8A84C`. Hover bg: `#2A2420`.

25. **Focus visible** -- Already has dark variant (lines 43-45 of current file). No changes needed.

26. **Selection** -- Already has dark variant (lines 52-55). No changes needed.

### Part 2: Add New Card Variants

Add to `@layer components` in `/Users/michaelbond/echo-vault/src/index.css`:

**`.card-elevated`:**
- Extends `.card` base styles
- Adds hover shadow upgrade (transitions from `shadow-soft` to `shadow-soft-lg`)
- Adds `translateY(-2px)` on hover
- Dark variant: uses border-based elevation (`border` color shifts lighter on hover) instead of shadow

**`.card-featured`:**
- Uses gradient background (the `hearth-glow` gradient: honey-300 to terra-400 in light mode)
- Text color adjusted for readability on gradient
- Dark variant: gradient uses `honey-800/60 to terra-800/60` over dark surface
- Rounded corners, padding, shadow consistent with `.card`

### Part 3: Add Gradient Utility Classes

Add to `@layer utilities` in `/Users/michaelbond/echo-vault/src/index.css`:

Define five gradient utility classes, each with light and dark mode definitions:

| Class | Light | Dark |
|-------|-------|------|
| `.gradient-hearth-glow` | `honey-300 -> terra-400` | `honey-800/60 -> terra-800/60` |
| `.gradient-sage-mist` | `sage-100 -> sage-300` | `sage-900/40 -> sage-800/40` |
| `.gradient-lavender-dusk` | `lavender-100 -> lavender-300` | `lavender-900/40 -> lavender-800/40` |
| `.gradient-terra-dawn` | `terra-100 -> honey-100` | `terra-900/40 -> honey-900/40` |
| `.gradient-hearth-surface` | `warm-50 -> white` | `hearth-900 -> hearth-850` |

Implementation uses `background: linear-gradient(...)` with hex values from the palette. Dark variants use `html.dark .gradient-*` selectors.

### Part 4: Reconcile Button Component with CSS Classes

**File:** `/Users/michaelbond/echo-vault/src/components/ui/index.jsx`

The `Button` component (line 121-176) currently defines its own variant class strings inline. The CSS `.btn-*` classes in `index.css` define different styles. The goal is to:

1. **Update the CSS `.btn-*` classes** to include the `success` variant (`.btn-success`) that exists in the component but not in CSS. The success variant should use sage palette (replacing `emerald`):
   - Light: gradient from `sage-400` to `sage-600`, white text
   - Dark: same gradient, slightly adjusted opacity

2. **Update the `Button` component** to reference the CSS classes instead of inline Tailwind strings. The `variants` object in the component should map to CSS class names:
   - `primary` -> `'btn-primary'`
   - `secondary` -> `'btn-secondary'`
   - `ghost` -> `'btn-ghost'`
   - `danger` -> `'btn-danger'`
   - `success` -> `'btn-success'`

3. **Fix off-palette colors in other ui/index.jsx components.** Replace:
   - `Badge.success`: `bg-emerald-100 text-emerald-700` -> `bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300`
   - `Badge.warning`: `bg-amber-100 text-amber-700` -> `bg-honey-100 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300`
   - `Toast.success`: `bg-emerald-500` -> `bg-sage-500`
   - `Toast.warning`: `bg-amber-500` -> `bg-honey-500`
   - `EntryCard.moodColors`: Replace `to-emerald-600`, `to-emerald-500` with `to-sage-600`, `to-sage-500`. Replace `to-blue-600` with `to-lavender-500`. Replace `to-indigo-600` with `to-lavender-600`.

4. **Add dark mode classes to all components** in `ui/index.jsx`:
   - `Card` default variant: add `dark:bg-hearth-850/95 dark:border-hearth-700/30`
   - `Card` glass variant: add `dark:bg-hearth-900/20 dark:border-hearth-700/20`
   - `Modal` backdrop: `dark:from-hearth-950/90 dark:to-hearth-900/90`
   - `Modal` content: add `dark:bg-hearth-850 dark:border dark:border-hearth-700/30`
   - `Input`/`Textarea`: add dark mode classes for background, border, text, placeholder, focus states
   - `EmptyState` icon circle: add `dark:bg-honey-900/30`
   - `BreathingLoader` text: add `dark:text-warm-400`

**Important:** The `Button` component uses `motion.button` from Framer Motion with `whileHover` and `whileTap` props. After switching to CSS classes, these motion props should be kept (they provide the scale animation). The CSS classes handle colors/backgrounds, while Framer Motion handles the scale transform.

---

## Files Created or Modified (Actual)

| File | Action | Description |
|------|--------|-------------|
| `src/index.css` | Modified | Added `html.dark` variants for .card, .card-interactive, .card-glass, .card-warm, .btn-primary, .btn-secondary, .btn-ghost, .btn-success (new), .modal-content, .input, all badges, .shimmer, .entry-card, .prompt-card, .action-checkbox, .badge-recurring. Added .card-elevated, .card-featured. Added global primitives: scrollbar, autofill override. |
| `src/components/ui/index.jsx` | Modified | Button component now uses CSS class names (`btn-primary`, etc.). Fixed off-palette: emerald->sage, amber->honey, blue/indigo->lavender. Added dark: classes to Card, EntryCard, Modal, Input, Textarea, EmptyState, BreathingLoader. Focus ring-offset for dark mode. |
| `src/utils/__tests__/cssComponents.test.js` | Created | 32 verification tests for CSS dark mode variants, new card variants, gradient utilities, scrollbar, and autofill. |

### Deviations from Plan
- **Badge `primary` kept as honey in React component** (user decision): CSS `.badge-primary` uses sage, but React Badge `primary` stays honey to match the app's warm accent feel.
- **Toast wrapper dark mode skipped**: Colored bg variants (sage, red, honey, lavender) provide sufficient contrast without additional dark: wrapper classes.
- **`.card-featured` doesn't extend `.card` base via @apply**: Uses duplicated base styles for explicit control. Acceptable maintenance trade-off.
- **Review fixes added**: `html.dark .card-interactive`, `html.dark .entry-card`, `html.dark .prompt-card`, `html.dark .btn-success`, dark autofill transition, EmptyState dark text, Input/Textarea dark ring-offset.

### Test Results
- 32 tests, all passing

---

## Dependencies

- **section-01-tokens-config** must be complete first. The `hearth-850` color token must exist in `tailwind.config.js` before the dark mode card backgrounds can reference it, and gradient presets must be defined before gradient utility classes can use their color values.
- **section-02-color-map** is developed in parallel but is NOT a dependency -- this section does not import from `colorMap.js`.
- **section-04-dark-mode-infra** is developed in parallel -- the `dark` class toggle mechanism is separate from the CSS rules that respond to it.

---

## Implementation Notes

### Dark Mode CSS Pattern

Since `index.css` uses raw CSS (not Tailwind utility classes in JSX), dark mode variants use the `html.dark` ancestor selector:

```css
/* Light mode (default) */
.card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(232, 221, 208, 0.6);
}

/* Dark mode variant */
html.dark .card {
  background: rgba(35, 29, 27, 0.95);
  border: 1px solid rgba(74, 61, 50, 0.4);
}
```

This pattern is already used in the file for `html.dark :focus-visible` and `html.dark ::selection`.

### Warm Dark Tone Principle

All dark mode backgrounds must feel warm, not cold. The hearth palette provides this naturally:
- hearth-950 `#131110` -- deepest, for page backgrounds
- hearth-900 `#1C1916` -- standard dark background
- hearth-850 `~#231D1B` -- raised surfaces, cards (from section-01)
- hearth-800 `#2A2420` -- higher elevation, hover states

Never use `bg-gray-*`, `bg-slate-*`, `bg-zinc-*`, or `bg-black` for dark mode backgrounds.

### Button Reconciliation Strategy

The CSS `.btn-*` classes use raw CSS (`background: linear-gradient(...)`) while the React `Button` component uses Tailwind utility classes (`bg-gradient-to-r from-honey-500 to-honey-600`). After reconciliation:

- The CSS class handles the visual styling (gradient, colors, shadows)
- The React component applies the CSS class name plus Framer Motion for interactivity
- The `sizes` object in the React component stays as inline Tailwind (size variants are not in the CSS classes)
- The `disabled` and `loading` states stay as inline Tailwind

### Red/Safety Colors

Per the project's risk criteria: `red-*` colors used for danger/error purposes (like `btn-danger`, `Badge.danger`, `Toast.error`, and `Input` error states) are intentional and must NOT be replaced with palette colors. These remain `red-*` in both light and dark modes.

### Part 5: Global CSS Primitives (Review Feedback Integration)

These items were identified during external review as commonly-missed "invisible" UI elements that break immersion if left as browser defaults.

**5a. Custom Scrollbar Styling**

The codebase only has `.scrollbar-hide` (hides scrollbar entirely). Visible scrollbars on desktop will render in default gray/blue, clashing with warm Hearthside surfaces. Add custom scrollbar styles to `@layer base` in `index.css`:

```css
/* Warm scrollbar styling (webkit) */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(180, 164, 142, 0.4); /* warm-400 */
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(180, 164, 142, 0.6);
}

html.dark ::-webkit-scrollbar-thumb {
  background: rgba(74, 61, 50, 0.5); /* hearth-800 */
}
html.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(74, 61, 50, 0.7);
}

/* Firefox */
* { scrollbar-color: rgba(180, 164, 142, 0.4) transparent; scrollbar-width: thin; }
html.dark * { scrollbar-color: rgba(74, 61, 50, 0.5) transparent; }
```

**5b. Chrome Autofill Override**

Chrome's default yellow `-webkit-autofill` background clashes with both light and dark modes. The auth form has email/password inputs without `autocomplete` attributes, so Chrome will autofill them. Add to `@layer base`:

```css
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #FAF5EF inset; /* warm-50 */
  -webkit-text-fill-color: #3D3229; /* hearth-800 */
  transition: background-color 5000s ease-in-out 0s;
}

html.dark input:-webkit-autofill,
html.dark input:-webkit-autofill:hover,
html.dark input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #231D1B inset; /* hearth-850 */
  -webkit-text-fill-color: #F5EDE3; /* hearth-100 */
}
```

**5c. Shimmer Dark Mode Variant**

The `.shimmer` class (line 222) exists but has no dark variant. The current `hearth-200 via hearth-100` gradient would be nearly invisible on dark backgrounds. Add:

```css
html.dark .shimmer {
  @apply bg-gradient-to-r from-hearth-800 via-hearth-700 to-hearth-800;
}
```

**5d. Toast Component Dark Mode**

The custom Toast in `ui/index.jsx` (lines 599-636) has 4 type variants (success, error, warning, info) with off-palette colors. While section 16 catches the success/warning colors, the Toast container itself needs dark mode. Ensure the Toast wrapper gets `dark:bg-hearth-900 dark:border-hearth-700` and type-specific dark variants are applied alongside the palette migration in Part 4 above.