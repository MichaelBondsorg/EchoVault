# Code Review: Section 17 - Dark Mode Polish

## Critical Issues

### 1. MoodBackgroundProvider does not react to dark mode toggle (HIGH SEVERITY)

`isDarkMode()` is called directly as a plain function invocation outside of any hook. When the user toggles dark mode, this component will NOT re-render. Should use a reactive hook (like `useDarkMode()` if it exists) or a MutationObserver.

### 2. Surface hierarchy violations remain unaddressed (MEDIUM SEVERITY)

The plan mandates strict enforcement of the 4-tier dark surface hierarchy. Several components use `dark:bg-hearth-800` where they should use `hearth-900` (modals) or `hearth-850` (cards/inputs).

## Significant Gaps vs. Plan Requirements

### 3. No cross-screen dark mode pass was performed (HIGH SEVERITY)

Section 6.3 specifies a comprehensive screen-by-screen checklist of 25+ screens. Only 5 files were modified. The plan explicitly states this is "the most labor-intensive part of the section."

### 4. No `motion-safe:transition-*` classes used anywhere (MEDIUM SEVERITY)

The plan requires `motion-safe:transition-*` Tailwind classes for screen-level transitions. Zero found in codebase.

### 5. Gradient preset verification incomplete (MEDIUM SEVERITY)

The five gradient presets in index.css were not verified or corrected. Colors differ from plan spec.

### 6. Test file fragility (MEDIUM SEVERITY)

Test assertions rely on exact CSS formatting and naive JS parsing. Some overlay context checks are too permissive.

### 7. Capacitor StatusBar dark mode integration not verified (LOW)

### 8. Form input dark mode not verified (LOW)

### 9. MoodBackgroundProvider dark gradients vs index.css gradient presets are duplicated

### 10. `dark` variable reactivity issue in MoodBackgroundProvider
