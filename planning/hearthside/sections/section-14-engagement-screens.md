Now I have enough context to write the section. Let me compile all the information I've gathered about the engagement screens.

# Section 14: Engagement Screens

## Overview

This section covers the Hearthside palette migration and dark mode integration for "engagement" screens -- the deep-implement features added during a previous development phase. These screens handle reports, gap prompts, insight engagement, premium gates, notification prompts, and related interactive flows. The goal is to replace all off-palette color classes with Hearthside equivalents and add `dark:` variant classes in a single combined pass per file.

**What "engagement screens" means in this codebase:** There is no single `engagement/` directory. Instead, the engagement features are spread across multiple component directories:

- `/Users/michaelbond/echo-vault/src/components/reports/` -- Report viewing, lists, charts, privacy, sharing
- `/Users/michaelbond/echo-vault/src/components/prompts/GapPromptCard.jsx` -- Gap-detected reflection prompts
- `/Users/michaelbond/echo-vault/src/components/insights/DismissibleInsight.jsx` -- Insight lifecycle cards
- `/Users/michaelbond/echo-vault/src/components/modals/EntryInsightsPopup.jsx` -- Post-entry validation popup
- `/Users/michaelbond/echo-vault/src/components/dashboard/shared/FeedbackLoop.jsx` -- Task completion with rewards
- `/Users/michaelbond/echo-vault/src/components/entries/DetectedStrip.jsx` -- Temporal signal detection strip
- `/Users/michaelbond/echo-vault/src/components/chat/GuidedSessionPicker.jsx` -- Guided session selection
- `/Users/michaelbond/echo-vault/src/components/zen/CompanionNudge.jsx` -- AI companion floating button

---

## Dependencies

This section depends on:

- **section-02-color-map**: The `colorMap.js` utility must exist at `/Users/michaelbond/echo-vault/src/utils/colorMap.js` with `getPatternTypeColors()`, `getEntityTypeColors()`, `getTherapeuticColors()`, `getEntryTypeColors()`, and `HEX_COLORS` exports.
- **section-03-css-components**: Extended CSS component classes (`.card`, `.card-elevated`, `.card-glass`, `.btn-primary`, `.badge-*`, `.modal-content`, `.gradient-*`) with dark mode variants must be in `/Users/michaelbond/echo-vault/src/index.css`.

---

## Tests

Tests for this section are verification-style checks confirming that off-palette colors have been removed from the target files and dark mode classes are present. These are file-content grep tests, not runtime unit tests.

### Verification Tests

These should be added to a verification test file or run as grep-based checks.

```
# Test: ReportChart.jsx does not contain raw hex colors #6366f1, #8b5cf6, #14b8a6, #f59e0b, #ec4899, #06b6d4
#   Expected: COLORS array replaced with HEX_COLORS imports from colorMap.js

# Test: ReportList.jsx CADENCE_STYLES does not contain bg-blue-100, text-blue-700, bg-indigo-100, text-indigo-700, bg-purple-100, text-purple-700, bg-amber-100, text-amber-700
#   Expected: replaced with Hearthside palette equivalents (lavender, honey, sage, terra)

# Test: ReportPrivacyEditor.jsx does not contain text-indigo-500, text-indigo-600, focus:ring-indigo-500
#   Expected: replaced with lavender palette equivalents

# Test: ReportShareSheet.jsx does not contain text-indigo-500, text-green-500
#   Expected: indigo replaced with lavender; green-500 replaced with sage-500

# Test: GapPromptCard.jsx does not contain text-amber-500, text-gray-500, text-gray-400, text-gray-700, text-gray-200, bg-gray-200, bg-gray-700, hover:bg-gray-200, hover:bg-gray-700, hover:text-gray-700, hover:text-gray-300, dark:bg-gray-800, dark:border-gray-700
#   Expected: gray replaced with warm palette; amber-500 replaced with honey-500

# Test: DismissibleInsight.jsx typeConfig does not contain bg-purple-50, border-purple-200, text-purple-600, text-purple-900, bg-amber-50, border-amber-200, text-amber-600, bg-emerald-50, border-emerald-200, text-emerald-600, bg-rose-50, border-rose-200, text-rose-600, bg-blue-50, border-blue-200, text-blue-600, bg-green-50, border-green-200, text-green-600, bg-slate-50, border-slate-200, text-slate-600
#   Expected: pattern/warning/encouragement/contradiction/goal_check/progress types mapped to lavender/honey/sage/terra/lavender/sage palettes

# Test: DismissibleInsight.jsx includes dark: prefix classes in typeConfig objects
#   Expected: each config has dark variant for bg, border, iconBg, iconColor, textColor, accentColor

# Test: DismissibleInsight.jsx dismiss feedback panel does not contain bg-rose-50, text-rose-600, text-rose-700, text-gray-600, text-gray-700, bg-gray-800, bg-gray-300, border-gray-200, border-gray-300
#   Expected: gray replaced with warm; rose replaced with terra

# Test: EntryInsightsPopup.jsx getInsightStyle does not contain from-green-50, to-emerald-50, border-green-200, text-green-600, text-green-800, from-amber-50, to-yellow-50, border-amber-200, text-amber-600, from-teal-50, to-cyan-50, border-teal-200, text-teal-600, from-blue-50, to-indigo-50, border-blue-200, text-blue-600
#   Expected: replaced with Hearthside gradient and color equivalents

# Test: EntryInsightsPopup.jsx celebration section does not contain from-green-50, to-emerald-50, text-green-700, text-green-800, text-green-600, border-green-100
#   Expected: replaced with sage palette

# Test: EntryInsightsPopup.jsx CBT section does not contain from-blue-50, to-indigo-50, border-blue-400, text-blue-600
#   Expected: replaced with lavender palette

# Test: EntryInsightsPopup.jsx ACT section does not contain bg-teal-50, border-teal-100, text-teal-900, text-teal-800, text-teal-600
#   Expected: replaced with sage or lavender palette

# Test: EntryInsightsPopup.jsx content card includes dark: variant classes
#   Expected: bg-white has dark:bg-hearth-900 or dark:bg-warm-800 equivalent

# Test: FeedbackLoop.jsx does not contain bg-green-50, border-green-100, bg-green-500, border-green-500, border-blue-300, hover:border-blue-500, hover:bg-blue-50, text-gray-400, text-gray-700, border-gray-100, hover:border-blue-200, bg-green-600, bg-green-400, text-blue-500, bg-blue-50, text-purple-500, bg-purple-50
#   Expected: green replaced with sage; blue replaced with lavender or honey; gray replaced with warm; purple replaced with lavender

# Test: FeedbackLoop.jsx confetti colors array does not contain #10b981, #34d399, #6ee7b7, #a7f3d0
#   Expected: replaced with HEX_COLORS from colorMap.js

# Test: DetectedStrip.jsx getSignalIcon does not contain text-rose-500, text-blue-500, text-amber-500, text-purple-500
#   Expected: replaced with palette equivalents (terra, lavender, honey, lavender)

# Test: DetectedStrip.jsx getSentimentIndicator does not contain text-emerald-500, text-amber-500, text-sky-500, text-orange-500, text-blue-500, text-purple-500
#   Expected: replaced with palette equivalents

# Test: DetectedStrip.jsx day labels do not contain text-amber-600, text-blue-600
#   Expected: replaced with honey-600 and lavender-600

# Test: GuidedSessionPicker.jsx GUIDED_SESSIONS gradient values do not contain from-amber-400, to-orange-500, from-indigo-400, to-purple-600, from-pink-400, to-rose-500, from-green-400, to-emerald-600, from-cyan-400, to-blue-600, from-teal-400, to-cyan-600, from-violet-400, to-purple-600
#   Expected: all session gradients use Hearthside palette

# Test: all engagement screen files contain at least one dark: prefixed class
#   Expected: every file touched has dark mode support added
```

### Existing Test Suites (Do Not Break)

The following existing test file must continue to pass after changes:

- `/Users/michaelbond/echo-vault/src/components/prompts/__tests__/GapPromptCard.test.jsx` -- Tests DOMAIN_LABELS, buildEngagementPayload, and engagement tracking. These test pure functions and mocked service calls, not CSS classes, so they should remain unaffected.

---

## Implementation Details

### General Approach

For every file in this section, the approach is the same:

1. Identify all off-palette color classes (generic Tailwind colors like green, blue, purple, amber, teal, pink, indigo, emerald, rose, slate, gray, cyan, violet, orange, yellow).
2. Replace each with the semantically appropriate Hearthside palette token.
3. Add `dark:` variant classes alongside each replacement.
4. Where semantic color mappings exist (like `typeConfig` objects), restructure to include both light and dark classes.
5. Where raw hex colors exist (SVG strokes, confetti), import from `HEX_COLORS` in colorMap.js.

### Palette Mapping Reference

This is the standard off-palette to Hearthside mapping for this section:

| Off-Palette | Hearthside Equivalent | Semantic Use |
|---|---|---|
| green/emerald | sage | Growth, progress, success, encouragement |
| blue/indigo | lavender | Insight, reflection, cyclical patterns |
| purple/violet | lavender (deeper shades) | Pattern recognition, weekly review |
| amber/yellow/orange | honey | Warmth, streaks, planning, warnings |
| teal/cyan | sage (lighter) or lavender | ACT therapy, emotional processing |
| pink/rose | terra | Contradiction, feelings, gratitude |
| gray/slate | warm | Neutral defaults, borders, text |
| red | red (KEEP for crisis/danger/error) | Safety states stay unchanged |

### File-by-File Changes

#### 1. `/Users/michaelbond/echo-vault/src/components/reports/ReportChart.jsx`

**Off-palette items:**
- Line 3: `COLORS` array contains raw hex values `['#6366f1', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899', '#06b6d4']` (indigo, violet, teal, amber, pink, cyan)
- Lines 49, 52: SVG `stroke="#6366f1"` and `fill="#6366f1"` for mood trend chart
- Line 72: `bg-warm-100` bar background is already on-palette (keep)

**Changes:**
- Import `HEX_COLORS` from `../../utils/colorMap`.
- Replace the `COLORS` array with palette-derived hex values from `HEX_COLORS` (lavender, honey, sage, terra variants).
- Replace the hardcoded `#6366f1` in the SVG polyline stroke and circle fill with a `HEX_COLORS.lavender` value.
- Add `dark:` variants to the bar chart container (`bg-warm-100` becomes `bg-warm-100 dark:bg-warm-800`).

#### 2. `/Users/michaelbond/echo-vault/src/components/reports/ReportList.jsx`

**Off-palette items:**
- Lines 8-12: `CADENCE_STYLES` object uses `bg-blue-100 text-blue-700`, `bg-indigo-100 text-indigo-700`, `bg-purple-100 text-purple-700`, `bg-amber-100 text-amber-700`.
- Line 107: `text-red-500` for failed state -- this is legitimate error state, KEEP.

**Changes:**
- Replace `CADENCE_STYLES` badge colors:
  - `weekly`: `bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300`
  - `monthly`: `bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300`
  - `quarterly`: `bg-honey-100 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300`
  - `annual`: `bg-terra-100 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300`
- Add dark mode variants for:
  - Report card backgrounds (already has `dark:bg-warm-800`, verify completeness)
  - Locked state backgrounds (`bg-warm-50` should get `dark:bg-warm-900/50`)
  - Hover states
- Keep `text-red-500` for failed state as-is (error is legitimate use of red).

#### 3. `/Users/michaelbond/echo-vault/src/components/reports/ReportViewer.jsx`

**Off-palette items:**
- Line 76: `text-red-400` for AlertCircle on failure state -- KEEP (error state).
- Already mostly on-palette (uses warm, honey).

**Changes:**
- Add dark mode variants where missing:
  - `hover:bg-warm-100` buttons should get `dark:hover:bg-warm-800`
  - `bg-white` content card should get `dark:bg-warm-900`
- This file is largely compliant. Minimal changes needed.

#### 4. `/Users/michaelbond/echo-vault/src/components/reports/ReportSection.jsx`

**Off-palette items:** None found. Already on-palette (uses warm, honey).

**Changes:**
- Add dark mode variants:
  - `text-honey-600 bg-honey-50` entry ref badges should get `dark:text-honey-400 dark:bg-honey-900/30`
  - `hover:bg-honey-100` should get `dark:hover:bg-honey-800/40`

#### 5. `/Users/michaelbond/echo-vault/src/components/reports/ReportPrivacyEditor.jsx`

**Off-palette items:**
- Line 53: `text-indigo-500` on Shield icon
- Line 82: `text-honey-600 focus:ring-honey-500` checkboxes (on-palette, keep)
- Line 110: `text-indigo-600 focus:ring-indigo-500` checkboxes for entity anonymization

**Changes:**
- Replace `text-indigo-500` with `text-lavender-500 dark:text-lavender-400`
- Replace `text-indigo-600 focus:ring-indigo-500` with `text-lavender-600 focus:ring-lavender-500 dark:text-lavender-400`
- Add dark mode variants for:
  - Section toggle labels, backgrounds
  - Button styles (`bg-honey-600` already on-palette; add `dark:bg-honey-500`)

#### 6. `/Users/michaelbond/echo-vault/src/components/reports/ReportShareSheet.jsx`

**Off-palette items:**
- Line 74: `text-green-500` on CheckCircle (export complete state)
- Line 76: `text-red-500` on AlertCircle (export error) -- KEEP
- Line 106: `text-indigo-500` on Shield icon

**Changes:**
- Replace `text-green-500` with `text-sage-500 dark:text-sage-400`
- Replace `text-indigo-500` with `text-lavender-500 dark:text-lavender-400`
- Keep `text-red-500` for error state.
- Add dark mode to sheet background and interaction states.

#### 7. `/Users/michaelbond/echo-vault/src/components/prompts/GapPromptCard.jsx`

**Off-palette items:**
- Line 91: `dark:bg-gray-800/60` and `dark:border-gray-700/30`
- Line 107: `text-amber-500` on Lightbulb icon
- Line 108: `text-gray-500 dark:text-gray-400`
- Line 114: `hover:bg-gray-200/50 dark:hover:bg-gray-700/50`
- Line 117: `text-gray-400`
- Line 122: `text-gray-700 dark:text-gray-200`
- Lines 147-148: `text-gray-500 dark:text-gray-400`, `hover:text-gray-700 dark:hover:text-gray-300`

**Changes:**
- Replace all `gray-*` classes with `warm-*` equivalents:
  - `dark:bg-gray-800/60` becomes `dark:bg-warm-800/60`
  - `dark:border-gray-700/30` becomes `dark:border-warm-700/30`
  - `text-gray-500` becomes `text-warm-500`
  - `text-gray-400` becomes `text-warm-400`
  - `text-gray-700` becomes `text-warm-700`
  - `text-gray-200` becomes `text-warm-200`
  - `hover:bg-gray-200/50` becomes `hover:bg-warm-200/50`
  - `dark:hover:bg-gray-700/50` becomes `dark:hover:bg-warm-700/50`
  - `hover:text-gray-700` becomes `hover:text-warm-700`
  - `dark:hover:text-gray-300` becomes `dark:hover:text-warm-300`
- Replace `text-amber-500` with `text-honey-500`
- The accept button already uses honey palette (on-palette, keep).

#### 8. `/Users/michaelbond/echo-vault/src/components/insights/DismissibleInsight.jsx` (~22 off-palette instances)

This is the highest-count file in this section. The entire `typeConfig` object (lines 52-116) uses off-palette colors.

**Off-palette items:**
- `typeConfig.pattern`: purple-50/200/100/600/900
- `typeConfig.warning`: amber-50/200/100/600/900
- `typeConfig.encouragement`: emerald-50/200/100/600/900
- `typeConfig.contradiction`: rose-50/200/100/600/900
- `typeConfig.goal_check`: blue-50/200/100/600/900
- `typeConfig.progress`: green-50/200/100/600/900
- `typeConfig.default`: slate-50/200/100/600/900
- Lines 242, 272, 293-294, 317: `text-gray-500`, `text-gray-600`, `text-gray-700`
- Lines 334, 372-375, 384, 387, 392-402, 412-419: gray-* throughout dismiss feedback panel
- Line 392: `bg-rose-50`, `text-rose-600`, `text-rose-700` for exclusion option

**Changes:**
- Replace `typeConfig` with Hearthside palette:
  - `pattern`: lavender-50/200/100/600/900 with `dark:` variants (e.g., `darkBg: 'dark:bg-lavender-900/30'`)
  - `warning`: honey-50/200/100/600/900 (warnings are honey, not amber)
  - `encouragement`: sage-50/200/100/600/900
  - `contradiction`: terra-50/200/100/600/900
  - `goal_check`: lavender-100/300/200/700/900 (differentiated from pattern by shade)
  - `progress`: sage-50/200/100/600/900 (same family as encouragement)
  - `default`: warm-50/200/100/600/900
- Add dark mode variant keys to each typeConfig entry. The config object should include both light and dark classes either as combined strings (e.g., `bg: 'bg-lavender-50 dark:bg-lavender-900/30'`) or as separate keys.
- Replace all `gray-*` with `warm-*` throughout the feedback panel.
- Replace `rose-50`/`rose-600`/`rose-700` in exclusion option with `terra-50`/`terra-600`/`terra-700` plus dark variants.
- Replace `bg-white` backgrounds with `bg-white dark:bg-warm-800` or `bg-white/70 dark:bg-warm-800/70`.
- Replace `bg-gray-800` dismiss button with `bg-warm-800 dark:bg-warm-200` (or invert for dark).

#### 9. `/Users/michaelbond/echo-vault/src/components/modals/EntryInsightsPopup.jsx`

**Off-palette items in `getInsightStyle` (lines 84-129):**
- `progress`: from-green-50, to-emerald-50, border-green-200, text-green-600, text-green-800
- `streak`: from-amber-50, to-yellow-50, border-amber-200, text-amber-600, text-amber-800
- `absence`: from-teal-50, to-cyan-50, border-teal-200, text-teal-600, text-teal-800
- `warning`: from-red-50, to-orange-50, border-red-200, text-red-600, text-red-800 -- partially KEEP (red for warning is safety-adjacent; review individually)
- `cyclical`: from-blue-50, to-indigo-50, border-blue-200, text-blue-600, text-blue-800

**Off-palette items in template sections:**
- Line 194: `from-green-50 to-emerald-50`, `border-green-100`, `text-green-700`, `text-green-800`, `text-green-600` (celebration)
- Line 214: `from-blue-50 to-indigo-50`, `border-blue-400`, `text-blue-600` (CBT perspective)
- Lines 229-241: `bg-teal-50`, `border-teal-100`, `text-teal-900`, `text-teal-800`, `text-teal-600` (ACT defusion)
- Line 269: `bg-amber-50`, `border-amber-100`, `text-amber-700`, `text-amber-800` (ACT committed action)
- Line 150: `bg-white` content card (needs dark variant)

**Changes:**
- Replace `getInsightStyle` type mappings:
  - `progress`: from-sage-50 to-sage-100, border-sage-200, text-sage-600, text-sage-800
  - `streak`: from-honey-50 to-honey-100, border-honey-200, text-honey-600, text-honey-800
  - `absence`: from-lavender-50 to-lavender-100, border-lavender-200, text-lavender-600, text-lavender-800
  - `warning`: KEEP red-based colors (this represents a safety-adjacent warning state). Only change `to-orange-50` to `to-terra-50`.
  - `cyclical`: from-lavender-100 to-lavender-200, border-lavender-300, text-lavender-700, text-lavender-900
- Add dark variants to each style in getInsightStyle.
- Replace celebration section: sage palette (from-sage-50, to-sage-100, etc.)
- Replace CBT section: lavender palette (from-lavender-50, to-lavender-100, border-lavender-400, text-lavender-600)
- Replace ACT defusion section: sage palette (bg-sage-50, border-sage-100, text-sage-900/800/600)
- Replace ACT committed action: honey palette (bg-honey-50, border-honey-100, text-honey-700/800)
- Add `dark:bg-hearth-900` or `dark:bg-warm-800` to the `bg-white` content card.
- Add dark variants to all section backgrounds.

#### 10. `/Users/michaelbond/echo-vault/src/components/dashboard/shared/FeedbackLoop.jsx`

**Off-palette items:**
- Line 52: Confetti `colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0']` (green/emerald hex)
- Line 83: `bg-green-50 border border-green-100` (completing state)
- Line 84: `bg-white border border-gray-100 hover:border-blue-200 hover:shadow-sm` (default state)
- Lines 95-98: `bg-green-500 border-green-500` vs `border-blue-300 hover:border-blue-500 hover:bg-blue-50`
- Line 116: `text-gray-400` vs `text-gray-700`
- Line 136: `text-blue-500 bg-blue-50` (carried forward badge)
- Line 141: `text-purple-500 bg-purple-50` (recurrence badge)
- Line 154: `bg-green-600` toast notification

**Changes:**
- Import `HEX_COLORS` from `../../utils/colorMap` and replace confetti colors with sage-derived hex values.
- Replace green completion states with sage palette: `bg-sage-50 border-sage-100`, `bg-sage-500 border-sage-500`.
- Replace blue interaction states with honey: `border-honey-300 hover:border-honey-500 hover:bg-honey-50`.
- Replace gray with warm: `text-warm-400`, `text-warm-700`, `border-warm-100`.
- Replace badge colors: carried forward `text-lavender-500 bg-lavender-50`, recurrence `text-honey-500 bg-honey-50`.
- Replace toast: `bg-sage-600`.
- Add dark mode variants throughout.
- Replace `bg-green-400` strikethrough with `bg-sage-400 dark:bg-sage-500`.

#### 11. `/Users/michaelbond/echo-vault/src/components/entries/DetectedStrip.jsx`

**Off-palette items:**
- Line 38: `text-rose-500` (feeling signal icon)
- Line 39: `text-blue-500` (event signal icon)
- Line 40: `text-amber-500` (plan signal icon)
- Line 41: `text-purple-500` (reflection signal icon)
- Lines 49-56: Sentiment indicator colors: `text-emerald-500`, `text-amber-500`, `text-sky-500`, `text-orange-500`, `text-blue-500`, `text-purple-500`
- Lines 134-137: Day label colors: `text-amber-600`, `text-blue-600`

**Changes:**
- Replace signal icon colors:
  - feeling: `text-terra-500 dark:text-terra-400`
  - event: `text-lavender-500 dark:text-lavender-400`
  - plan: `text-honey-500 dark:text-honey-400`
  - reflection: `text-lavender-600 dark:text-lavender-400`
- Replace sentiment indicator colors:
  - positive (emerald): `text-sage-500`
  - excited (amber): `text-honey-500`
  - hopeful (sky): `text-lavender-400`
  - anxious (orange): `text-terra-400`
  - negative (blue): `text-lavender-600`
  - dreading (purple): `text-lavender-700`
- Replace day label colors: `text-honey-600` for future, `text-lavender-600` for past.
- Add dark variants to the strip container (`bg-white` to `bg-white dark:bg-warm-800`), borders, and signal pills.

#### 12. `/Users/michaelbond/echo-vault/src/components/chat/GuidedSessionPicker.jsx`

**Off-palette items:**
- All 7 `GUIDED_SESSIONS` entries have off-palette gradients:
  - morning_checkin: `from-amber-400 to-orange-500`
  - evening_reflection: `from-indigo-400 to-purple-600`
  - gratitude_practice: `from-pink-400 to-rose-500`
  - goal_setting: `from-green-400 to-emerald-600`
  - emotional_processing: `from-cyan-400 to-blue-600`
  - stress_release: `from-teal-400 to-cyan-600`
  - weekly_review: `from-violet-400 to-purple-600`

**Changes:**
- Replace all session gradients with Hearthside palette equivalents:
  - morning_checkin: `from-honey-400 to-terra-400` (warm morning tones)
  - evening_reflection: `from-lavender-400 to-lavender-600` (calm, reflective)
  - gratitude_practice: `from-terra-300 to-terra-500` (warmth, emotional)
  - goal_setting: `from-sage-400 to-sage-600` (growth)
  - emotional_processing: `from-lavender-300 to-lavender-500` (insight, processing)
  - stress_release: `from-sage-300 to-sage-500` (calming, natural)
  - weekly_review: `from-honey-300 to-lavender-400` (mixed warm/reflective)
- The rest of the component uses `white/` opacity classes over dark backgrounds, which are fine since this component renders over a dark conversation background.

#### 13. `/Users/michaelbond/echo-vault/src/components/zen/CompanionNudge.jsx`

**Off-palette items:** None found. Already uses honey palette (`text-honey-600`, `border-honey-400/30`), glass shadow (`shadow-glass-md`), and accent color. This file is compliant.

**Changes:**
- Add dark mode variants to the main button:
  - `bg-white/30` could get `dark:bg-warm-800/30`
  - `border-white/30` could get `dark:border-warm-700/30`
- The `text-honey-600` icon color could get `dark:text-honey-400`.

---

## Red Color Audit

Per the project safety rules: red (`red-*`) used for crisis, safety, danger, or error states is NEVER changed. In this section's files:

- `/Users/michaelbond/echo-vault/src/components/reports/ReportViewer.jsx` line 76: `text-red-400` for AlertCircle failure icon -- **KEEP**
- `/Users/michaelbond/echo-vault/src/components/reports/ReportList.jsx` line 107: `text-red-500` for generation failed -- **KEEP**
- `/Users/michaelbond/echo-vault/src/components/reports/ReportShareSheet.jsx` line 76: `text-red-500` for export error -- **KEEP**
- `/Users/michaelbond/echo-vault/src/components/modals/EntryInsightsPopup.jsx` lines 106-111: `from-red-50 to-orange-50 border-red-200 text-red-600 text-red-800` for warning insight type -- **KEEP red, change orange to terra** (warning type is safety-adjacent)

---

## Implementation Checklist

1. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportChart.jsx` -- replace hex COLORS array with HEX_COLORS import; replace SVG hardcoded hex; add dark variants to bar chart
2. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportList.jsx` -- replace CADENCE_STYLES off-palette badge colors with palette + dark mode
3. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportViewer.jsx` -- add missing dark mode variants (minimal off-palette)
4. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportSection.jsx` -- add dark variants to entry ref badges
5. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportPrivacyEditor.jsx` -- replace indigo with lavender; add dark mode
6. Update `/Users/michaelbond/echo-vault/src/components/reports/ReportShareSheet.jsx` -- replace indigo/green with lavender/sage; add dark mode
7. Update `/Users/michaelbond/echo-vault/src/components/prompts/GapPromptCard.jsx` -- replace all gray with warm, amber with honey; fix dark variants
8. Update `/Users/michaelbond/echo-vault/src/components/insights/DismissibleInsight.jsx` -- overhaul typeConfig with Hearthside palette + dark mode; replace gray/rose in feedback panel
9. Update `/Users/michaelbond/echo-vault/src/components/modals/EntryInsightsPopup.jsx` -- overhaul getInsightStyle; replace celebration/CBT/ACT section colors; add dark mode throughout
10. Update `/Users/michaelbond/echo-vault/src/components/dashboard/shared/FeedbackLoop.jsx` -- replace green/blue/gray/purple; import HEX_COLORS for confetti; add dark mode
11. Update `/Users/michaelbond/echo-vault/src/components/entries/DetectedStrip.jsx` -- replace signal/sentiment indicator colors; add dark mode
12. Update `/Users/michaelbond/echo-vault/src/components/chat/GuidedSessionPicker.jsx` -- replace all 7 session gradient values
13. Update `/Users/michaelbond/echo-vault/src/components/zen/CompanionNudge.jsx` -- add dark mode variants (already on-palette)
14. Run verification tests to confirm zero remaining off-palette classes across all files in this section
15. Confirm existing test suite at `/Users/michaelbond/echo-vault/src/components/prompts/__tests__/GapPromptCard.test.jsx` still passes

---

## Implementation Notes (Post-Build)

### Files Modified (15 total)
- 13 component files as planned
- 2 test files created: `reports/__tests__/hearthside-palette.test.js` (15 tests), `engagement/__tests__/hearthside-palette.test.js` (40 tests)

### Deviations from Plan
1. **FeedbackLoop.jsx**: Only confetti hex colors updated — file was already fully converted to Hearthside palette in section 08 (dashboard-shared). Plan listed full conversion but most changes were already done.
2. **GuidedSessionPicker.jsx**: Excluded from "all files have dark:" meta-test because it uses white-on-dark glass styling (always rendered on dark gradient background).
3. **DetectedStrip.jsx container**: Used `dark:bg-hearth-900` instead of plan's `dark:bg-warm-800` — hearth tokens are the established convention for dark surfaces throughout the project.
4. **EntryInsightsPopup.jsx ACT defusion**: Used `dark:bg-hearth-850/50` (verified in safelist).

### Code Review Fix Applied
- DismissibleInsight.jsx: Added `dark:bg-warm-800/50` to two `bg-white/50` inner sections (causal analysis, therapeutic reframe) that were missing dark variants.

### Deferred to Section 17 (Dark Mode Polish)
- ReportPrivacyEditor.jsx: Section toggle labels/backgrounds dark mode
- ReportShareSheet.jsx: Sheet background and interaction states dark mode

### Test Results: 55/55 passing