# Section 18 (Verification) - Code Review

**File reviewed:** `src/utils/__tests__/verification.test.js`
**Plan:** `section-18-verification.md`

## Issue 1: Runtime crash in SVG Hex Audit error reporting path (HIGH)
Error summary references `v.content` which doesn't exist on violation objects. Also double-relativizes `v.file`.

## Issue 2: Shell injection in grepSrc helper (HIGH)
Pattern parameter interpolated into execSync shell command. Low exploitation risk in test file but poor practice.

## Issue 3: colorMap.js safelist exclusion too narrow (MEDIUM)
Only skips lines containing literal "TAILWIND_SAFELIST" string, not the entire multi-line block.

## Issue 4: Dark mode toggle test doesn't test behavior (MEDIUM)
Plan required importing and calling toggleDarkMode; implementation just does string search on file contents.

## Issue 5: mood.* token audit is effectively a no-op (MEDIUM)
Only checks tailwind.config.js contains "mood" string. Doesn't verify component files use mood tokens.

## Issue 6: Color-Only Meaning spot check is superficial (MEDIUM)
Assertions too weak — checking for "className" or "size=" doesn't verify accessibility.

## Issue 7: Missing "No pure black backgrounds" dark mode check (MEDIUM)
Plan specifies bg-black/000000 check but test is absent from implementation.

## Issue 8: grepSrc parses grep output incorrectly for colons in path (LOW)
Line number is included in content field, potentially affecting comment filtering.

## Issue 9: Off-palette audit misses CSS files (LOW)
collectSourceFiles only collects .jsx/.js, not .css files.

## Issue 10: Caveat font weight check missing (LOW)
Doesn't verify weights 400, 500, 600 are present in Caveat link.

## Issue 11: Typography heading check too weak (LOW)
Just checks font-display exists somewhere, not on headings.

## Issue 12: grepFile regex reuse bug potential (LOW)
RegExp with global flag would cause alternating results.

## Issue 13: Inconsistent exclusion rules between helpers (LOW)
collectSourceFiles excludes __tests__/dist but grepSrc does not.
