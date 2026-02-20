Now I have all the context I need. Let me produce the section content.

# Section 10: Core Features — RealtimeConversation, WeeklyReport, ErrorBoundary

## Overview

This section covers the Hearthside palette migration and dark mode implementation for three core feature components that use significant off-palette color classes. These components are part of the Phase 3 screen-by-screen sweep (plan section 5.3), where light mode palette fixes and dark mode classes are applied in a single pass per file.

**Files to modify:**

| File | Path | Off-Palette Instances | Key Issues |
|------|------|----------------------|------------|
| RealtimeConversation.jsx | `/Users/michaelbond/echo-vault/src/components/chat/RealtimeConversation.jsx` | ~15+ | indigo/purple gradients, green/yellow/gray status colors, indigo-500/600 buttons/inputs |
| WeeklyReport.jsx | `/Users/michaelbond/echo-vault/src/components/modals/WeeklyReport.jsx` | ~3 | text-indigo-600 heading, gray button, generic bg-white |
| ErrorBoundary.jsx | `/Users/michaelbond/echo-vault/src/components/ErrorBoundary.jsx` | ~10 | blue-50/purple-50 gradient background, amber icon container, blue-600 buttons, gray secondary elements |

**Dependencies (must be completed first):**
- **section-02-color-map**: `src/utils/colorMap.js` must exist (provides `getEntryTypeColors`, `getPatternTypeColors`, and related mapping functions)
- **section-03-css-components**: `src/index.css` must have extended dark mode variants for `.card`, `.btn-*`, `.modal-*`, and `.input` classes

**No files created in this section** -- only modifications to existing files.

---

## Tests

These are file-content verification tests (grep-based) rather than runtime tests. They confirm that off-palette color classes have been removed from each file and replaced with Hearthside palette equivalents.

### Test file: `/Users/michaelbond/echo-vault/src/components/__tests__/coreFeaturesPalette.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Verify that core feature components use only Hearthside palette colors.
 * These are file-content grep tests -- they read JSX source and assert
 * that off-palette Tailwind color classes have been replaced.
 */

const readComponent = (relativePath) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');

const OFF_PALETTE_PATTERNS = [
  /(?<!-)bg-indigo-/,
  /text-indigo-/,
  /from-indigo-/,
  /to-indigo-/,
  /via-indigo-/,
  /from-purple-/,
  /to-purple-/,
  /via-purple-/,
  /bg-purple-/,
  /text-purple-/,
  /border-purple-/,
  /bg-blue-(?!50\/)/,     // blue-50 in ErrorBoundary background
  /text-blue-/,
  /bg-amber-(?!100)/,     // allow amber-100 only in dev error display
  /text-amber-/,
  /shadow-purple-/,
  /shadow-green-/,
  /focus:border-indigo-/,
];

// Patterns that are ALLOWED (safety/crisis colors, semantic reds)
const ALLOWED_PATTERNS = [
  /bg-red-/,       // crisis/safety and destructive actions -- never changed
  /text-red-/,     // error states
  /border-red-/,   // error borders
];

describe('RealtimeConversation.jsx palette compliance', () => {
  it('should not contain off-palette indigo/purple gradient classes', () => {
    /** Read file content and verify no from-indigo-*, to-purple-*, etc. */
  });

  it('should not contain off-palette status indicator colors (green-400, yellow-400, indigo-500)', () => {
    /** statusColors object should use palette equivalents */
  });

  it('should not contain focus:border-indigo-500', () => {
    /** Input focus state should use palette border color */
  });

  it('should not contain bg-indigo-600 or bg-indigo-500/20 for buttons/tags', () => {
    /** Save button and suggested tag badges should use palette */
  });

  it('should contain dark: variant classes for backgrounds and text', () => {
    /** Verify dark mode classes are present */
  });

  it('should use palette gradient for main background (hearth/lavender, not indigo/purple)', () => {
    /** Main container gradient should reference hearth or lavender tokens */
  });

  it('should preserve red-500 for end-call button (semantic destructive action)', () => {
    /** Red is intentional for the phone disconnect button */
  });
});

describe('WeeklyReport.jsx palette compliance', () => {
  it('should not contain text-indigo-600', () => {
    /** Heading color should use lavender-600 or similar palette color */
  });

  it('should contain dark: variant classes for modal background and text', () => {
    /** Modal needs dark mode support */
  });

  it('should use palette-aware modal styling', () => {
    /** bg-white should have dark: counterpart, text-gray should use hearth */
  });
});

describe('ErrorBoundary.jsx palette compliance', () => {
  it('should not contain from-blue-50 or to-purple-50 gradients', () => {
    /** Background gradient should use warm-50/hearth palette */
  });

  it('should not contain bg-blue-600 for primary button', () => {
    /** Try Again button should use honey-500 or palette primary */
  });

  it('should not contain bg-amber-100 for icon background', () => {
    /** Should use honey-100 */
  });

  it('should not contain text-amber-600 for icon color', () => {
    /** Should use honey-600 */
  });

  it('should contain dark: variant classes throughout', () => {
    /** Full dark mode support for error screen */
  });

  it('should preserve red-50/red-700/red-800 in dev error details (semantic error color)', () => {
    /** Dev-only error display uses red intentionally for error semantics */
  });
});
```

---

## Implementation Details

### General Approach

For each file, apply the following in a single pass:
1. Replace every off-palette Tailwind color class with the nearest Hearthside palette equivalent
2. Add `dark:` variant classes alongside each replacement
3. Preserve all red-based colors used for crisis/safety/error/destructive semantics
4. Do NOT change any functional behavior -- only CSS classes

### Color Mapping Reference

These are the palette equivalents relevant to this section (from the Hearthside design system in `tailwind.config.js`):

| Off-Palette | Hearthside Equivalent | Usage Context |
|-------------|----------------------|---------------|
| `indigo-*` | `lavender-*` | Accents, interactive elements, headings |
| `purple-*` | `lavender-*` (darker shades) | Gradients, shadows |
| `blue-*` | `lavender-*` or `honey-*` | Buttons, backgrounds |
| `green-400/500` | `sage-400/500` | Status indicators (connected, listening) |
| `yellow-400/500` | `honey-400/500` | Status indicators (connecting), warning icons |
| `amber-*` | `honey-*` | Icon backgrounds, warning states |
| `gray-*` | `hearth-*` | Neutral surfaces, disabled states, text |

---

### File 1: RealtimeConversation.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/chat/RealtimeConversation.jsx`

This is the voice conversation full-screen overlay. It currently uses an indigo-to-purple gradient as its main background and has multiple off-palette color references for status indicators, buttons, inputs, and tags.

#### Changes Required

**1. Main background gradient (line 200)**

Current:
```jsx
<div className="fixed inset-0 bg-gradient-to-b from-indigo-900 to-purple-900 z-50 ...">
```

Replace with Hearthside dark gradient. Use `hearth-900` base with `lavender-900` accent, or the `lavender-dusk` dark variant. Add dark mode variant (the voice screen is always dark-styled, but adding explicit `dark:` ensures consistency if the component is ever used in a different context):

```
from-hearth-900 via-lavender-900/80 to-hearth-950
```

**2. Status indicator colors (lines 172-178)**

Current `statusColors` object:
```javascript
const statusColors = {
  disconnected: 'bg-gray-400',
  connecting: 'bg-yellow-400 animate-pulse',
  connected: 'bg-green-400',
  speaking: 'bg-indigo-500 animate-pulse',
  listening: 'bg-green-500 animate-pulse',
};
```

Replace with palette equivalents:
- `gray-400` becomes `hearth-400`
- `yellow-400` becomes `honey-400`
- `green-400` / `green-500` becomes `sage-400` / `sage-500`
- `indigo-500` becomes `lavender-500`

**3. Input focus state (line 332)**

Current: `focus:border-indigo-500`
Replace: `focus:border-lavender-500`

**4. Energy indicator icon colors (lines 343-345)**

Current:
- `text-yellow-400` (high energy)
- `text-green-400` (medium energy)
- `text-blue-400` (low energy)

Replace:
- `text-honey-400` (high energy)
- `text-sage-400` (medium energy)
- `text-lavender-400` (low energy)

**5. Mood slider emoji icon colors (lines 352, 364)**

Current: `text-red-400` (Frown) and `text-green-400` (Smile)

The `text-red-400` on the Frown icon is a semantic mood indicator (negative end of a mood scale). This is a reasonable use of red for meaning, but it is not a crisis/safety color. Replace with `text-terra-400` for the negative end and `text-sage-400` for the positive end, aligning with the warm Hearthside palette.

**6. Mood slider gradient (line 359)**

Current: `bg-gradient-to-r from-red-500 via-yellow-500 to-green-500`

Replace with palette gradient: `from-terra-500 via-honey-500 to-sage-500`

**7. Suggested tags badges (lines 393-396)**

Current: `bg-indigo-500/20 text-indigo-300`
Replace: `bg-lavender-500/20 text-lavender-300`

**8. Save button (line 417)**

Current: `bg-indigo-600 ... hover:bg-indigo-500`
Replace: `bg-lavender-600 ... hover:bg-lavender-500`

**9. Discard button (line 411)**

Current: `bg-gray-700 ... hover:bg-gray-600`
Replace: `bg-hearth-700 ... hover:bg-hearth-600`

**10. Save modal container (line 313)**

Current: `bg-gray-800`
Replace: `bg-hearth-800`

**11. Push-to-talk button gradient (line 470)**

Current: `bg-gradient-to-br from-indigo-500 to-purple-600 shadow-purple-500/30`
Replace: `bg-gradient-to-br from-lavender-500 to-lavender-700 shadow-lavender-500/30`

**12. Recording active button (line 467)**

Current: `bg-green-500 shadow-green-500/30`
Replace: `bg-sage-500 shadow-sage-500/30`

**13. Disabled button state (line 469)**

Current: `bg-gray-500`
Replace: `bg-hearth-500`

**14. Connecting spinner gradient (line 432)**

Current: `bg-gradient-to-br from-yellow-500 to-orange-600`
Replace: `bg-gradient-to-br from-honey-500 to-terra-500`

**Preserved (no change):**
- `bg-red-500` on the end-call button (line 441) -- semantic destructive action
- `shadow-red-500/30` on the end-call button -- associated with destructive action
- `bg-red-500/20`, `border-red-400/30`, `text-red-200`, `text-red-300` in the error display (lines 299-306) -- semantic error state
- `bg-black/50` on the save prompt overlay (line 312) -- standard overlay

**Dark mode notes:** Since RealtimeConversation is always rendered as a full-screen dark-themed overlay, most of its colors are already in dark-appropriate ranges. The palette replacements above (hearth-800, hearth-900, lavender-900) are inherently dark-mode-friendly. No additional `dark:` prefix variants are strictly necessary for this component's current usage pattern, but consider adding them for future-proofing if the component is ever embedded in a light context.

---

### File 2: WeeklyReport.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/modals/WeeklyReport.jsx`

This is a simple modal that displays a weekly synthesis report. It has minimal off-palette usage but needs dark mode support.

#### Changes Required

**1. Heading color (line 9)**

Current: `text-indigo-600`
Replace: `text-lavender-600 dark:text-lavender-400`

**2. Modal backdrop (line 6)**

Current: `bg-black/50`
This is standard and acceptable. No change needed.

**3. Modal container (line 7)**

Current: `bg-white rounded-2xl ... shadow-2xl`
Add dark mode: `bg-white dark:bg-hearth-800 rounded-2xl ... shadow-2xl dark:shadow-none dark:ring-1 dark:ring-hearth-700`

**4. Close button (line 8)**

Current: `text-gray-400 hover:text-gray-600`
Replace: `text-hearth-400 hover:text-hearth-600 dark:text-hearth-500 dark:hover:text-hearth-300`

**5. Consider using CSS component classes**

The modal could potentially use the `.modal-backdrop` and `.modal-content` CSS classes from `index.css` (extended in section-03) rather than inline classes. Evaluate whether the existing modal classes provide the correct styles. If so, apply them; if not, keep inline classes with the palette replacements above.

---

### File 3: ErrorBoundary.jsx

**Path:** `/Users/michaelbond/echo-vault/src/components/ErrorBoundary.jsx`

This is the app-wide error boundary. It shows a full-page error state with a retry button. It uses several off-palette colors for its background, icon container, and buttons.

#### Changes Required

**1. Page background gradient (line 43)**

Current: `bg-gradient-to-br from-blue-50 via-white to-purple-50`
Replace: `bg-gradient-to-br from-warm-50 via-white to-lavender-50 dark:from-hearth-950 dark:via-hearth-900 dark:to-hearth-950`

**2. Error card container (line 44)**

Current: `bg-white rounded-2xl shadow-xl`
Replace: `bg-white dark:bg-hearth-800 rounded-2xl shadow-xl dark:shadow-none dark:ring-1 dark:ring-hearth-700`

**3. Icon container (line 45)**

Current: `bg-amber-100`
Replace: `bg-honey-100 dark:bg-honey-900/30`

**4. Icon color (line 46)**

Current: `text-amber-600`
Replace: `text-honey-600 dark:text-honey-400`

**5. Heading text (line 49)**

Current: `text-gray-900`
Replace: `text-hearth-900 dark:text-hearth-100`

**6. Body text (line 53)**

Current: `text-gray-600`
Replace: `text-hearth-600 dark:text-hearth-400`

**7. Primary button -- Try Again (lines 60-65)**

Current: `bg-blue-600 text-white ... hover:bg-blue-700`
Replace: `bg-honey-500 text-white ... hover:bg-honey-600 dark:bg-honey-600 dark:hover:bg-honey-500`

Alternatively, apply the `.btn-primary` CSS class from `index.css` if it matches the desired appearance.

**8. Secondary button -- Reload Page (lines 68-72)**

Current: `bg-gray-100 text-gray-700 ... hover:bg-gray-200`
Replace: `bg-hearth-100 text-hearth-700 ... hover:bg-hearth-200 dark:bg-hearth-700 dark:text-hearth-200 dark:hover:bg-hearth-600`

Alternatively, apply the `.btn-secondary` CSS class.

**9. Support text (line 88)**

Current: `text-gray-500`
Replace: `text-hearth-500 dark:text-hearth-400`

**10. Dev error details section (lines 77-85)**

Current: `bg-red-50`, `text-red-800`, `text-red-700`

**Preserve as-is.** Red is used here semantically for error information. This is appropriate and should not be changed per the red-color audit criteria (red used for error states is never changed).

Add dark mode variants for the dev error section while keeping red:
- `bg-red-50 dark:bg-red-950/30`
- `text-red-800 dark:text-red-300`
- `text-red-700 dark:text-red-400`

---

## Verification Checklist

After implementing all changes, verify the following:

1. **RealtimeConversation.jsx**: Grep for `indigo`, `purple` (outside of palette-derived names), `green-400`, `green-500`, `yellow-400`, `blue-400`, `gray-` -- none should remain except in comments
2. **WeeklyReport.jsx**: Grep for `indigo`, `gray-` -- none should remain
3. **ErrorBoundary.jsx**: Grep for `blue-`, `amber-`, `gray-`, `purple-` -- none should remain. `red-` should only appear in the dev error details block
4. **Dark mode**: Toggle dark mode on and visually verify:
   - RealtimeConversation renders with warm dark tones (no harsh blue/purple)
   - WeeklyReport modal has warm dark background with legible text
   - ErrorBoundary page has warm dark gradient background, readable content, visible buttons
5. **Functional**: All three components work identically to before -- no behavioral changes, only visual
6. **Red preservation**: End-call button in RealtimeConversation remains red. Error display in ErrorBoundary remains red. These are semantic uses of red for destructive actions and error states respectively

---

## Post-Implementation Notes

**Implementation date:** 2026-02-20
**Commit:** (pending)
**Tests:** 26/26 passing (coreFeaturesPalette.test.js)

### Deviations from Plan
1. **WeeklyReport dark mode text**: Added `dark:text-hearth-100` to MarkdownLite container div (not in plan) — code review caught that rendered markdown content would be invisible on dark background
2. **Test file expanded**: Added assertions for `to-indigo-`, `to-orange-`, `from-orange-`, `hover:bg-indigo-`, and broadened `text-indigo-300` to `text-indigo-` (any shade) — code review identified gaps
3. **RealtimeConversation dark: variants**: Plan recommended adding dark: variants for future-proofing. Decision: skipped — component is always rendered as full-screen dark overlay, dark: variants unnecessary and would add noise

### Files Modified
- `src/components/chat/RealtimeConversation.jsx` — 15 palette replacements (indigo/purple/gray/green/yellow/blue/orange → lavender/hearth/sage/honey/terra)
- `src/components/modals/WeeklyReport.jsx` — 3 palette replacements + dark mode (indigo/gray → lavender/hearth)
- `src/components/ErrorBoundary.jsx` — 10 palette replacements + comprehensive dark mode (blue/purple/amber/gray → warm/lavender/honey/hearth)

### Files Created
- `src/components/__tests__/coreFeaturesPalette.test.js` — 26 grep-based file content verification tests