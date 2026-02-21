# Code Review Interview: Section 17 - Dark Mode Polish

**Date:** 2026-02-20

## Auto-Fixes

### FIX: MoodBackgroundProvider reactivity bug
- **Issue:** `isDarkMode()` called directly (non-reactive). Gradient won't update on toggle.
- **Fix:** Replace with `useDarkMode()` hook from `src/hooks/useDarkMode.js`
- **Status:** Auto-fix (clear bug)

## User Decisions

### DECISION: Surface hierarchy violations
- **Issue:** ~8 files from earlier sections use `dark:bg-hearth-800` where hierarchy spec says `hearth-900` (modals) or `hearth-850` (cards/inputs)
- **User Choice:** Fix hierarchy now
- **Action:** Update files to enforce 950/900/850/800 tiers

### DECISION: Cross-screen visual pass
- **Issue:** Plan called for 25+ screen visual pass, not possible programmatically
- **User Choice:** Proceed as-is — grep-based tests cover automated verification
- **Action:** No additional changes

## Let Go

- Issue #4 (motion-safe:transition-* classes): Tailwind motion-safe prefix convention — nice to have but low impact
- Issue #5 (gradient preset verification): Existing gradient dark variants already use rgba transparency, values work well
- Issue #6 (test fragility): Tests work correctly today, can be hardened later if CSS formatting changes
- Issue #7 (Capacitor StatusBar): Already handled in darkMode.js section-04
- Issue #8 (form input dark mode): .input class in index.css already has dark variants
- Issue #9 (gradient duplication): MoodBackgroundProvider and index.css serve different purposes (JS animation vs CSS utility)
