# Code Review Interview: Section 18 - Verification

**Date:** 2026-02-20

## Auto-Fixes

### FIX: SVG audit error path crash (Issue #1)
- **Issue:** Error summary references `v.content` (undefined) and double-relativizes path
- **Fix:** Change `v.content.trim()` to `v.line` and remove extra `path.relative()`
- **Status:** Auto-fix (clear bug)

### FIX: colorMap.js safelist exclusion (Issue #3)
- **Issue:** Only skips lines with literal "TAILWIND_SAFELIST", not the full block
- **Fix:** Track whether inside a safelist block (between TAILWIND_SAFELIST and closing bracket/backtick)
- **Status:** Auto-fix (logic gap)

### NOTE: bg-black check (Issue #7)
- **Issue:** No bg-black check in verification.test.js
- **Note:** Already covered comprehensively by darkModePolish.test.js (section 17). No duplication needed.
- **Status:** No action needed

## Let Go

- Issue #2 (shell injection in grepSrc): Test file only, all patterns are hardcoded string literals. Not exploitable.
- Issue #4 (behavioral dark mode test): File content checks verify the structure; behavioral testing requires complex jsdom mocking of localStorage/classList. Pragmatic tradeoff.
- Issue #5 (mood token no-op): Tailwind config check confirms tokens exist. Component-level usage verification is best-effort given the complexity.
- Issue #6 (color-only meaning superficial): Plan calls this "spot check, not exhaustive." Current checks verify icons exist.
- Issue #8 (grep output colon parsing): Works correctly for all current paths. No colons in any source file paths.
- Issue #9 (CSS files in off-palette): CSS off-palette classes use @apply which was already migrated in section-03.
- Issue #10 (Caveat weights): The font link is verified; missing specific weight assertion is low risk.
- Issue #11 (heading check weak): Plan says "best-effort." Single instance confirms font-display is being used.
- Issue #12 (grepFile regex flag): No callers use global flag. Low risk.
- Issue #13 (inconsistent exclusions): grepSrc callers filter with isTestFile() post-hoc. Works in practice.
