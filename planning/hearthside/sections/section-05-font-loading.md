Now I have all the context I need. Here is the section content:

# Section 05: Font Loading

## Overview

This section covers splitting the Caveat font into its own Google Fonts `<link>` tag with `display=optional` while keeping DM Sans and Fraunces together with `display=swap`. This is a targeted change to a single file (`/Users/michaelbond/echo-vault/index.html`) that optimizes font loading behavior so that Caveat -- a decorative handwritten accent font -- does not block rendering or cause layout shifts if it loads late.

## Dependencies

- **section-01-tokens-config** must be complete first. The Tailwind config defines `font-hand: ['Caveat', 'cursive']` which this section's font loading supports. The font family definitions in `tailwind.config.js` at `/Users/michaelbond/echo-vault/tailwind.config.js` (lines 162-166) are already in place and do not need modification here.

## Background and Rationale

### Current State

The file `/Users/michaelbond/echo-vault/index.html` (line 23) loads all three fonts in a single Google Fonts `<link>` tag:

```html
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&display=swap" rel="stylesheet" />
```

This single link uses `display=swap` for all three fonts. The `swap` strategy means the browser will immediately render text using a fallback font and then swap in the web font once loaded. This is ideal for DM Sans and Fraunces (primary body and heading fonts) because they should always eventually display. However, for Caveat (a decorative handwritten accent font used sparingly), a swap can cause a noticeable layout shift when the font loads late, and if Caveat fails to load entirely, a fallback cursive font is perfectly acceptable.

### Target State

Split into two `<link>` tags:

1. **DM Sans + Fraunces** -- kept together with `display=swap` (these are essential fonts)
2. **Caveat** -- separate `<link>` with `display=optional` (decorative accent font)

The `display=optional` strategy gives the browser a very short window (typically ~100ms) to use the web font if it is already cached; otherwise it uses the fallback for that page load. This means:
- No layout shift from Caveat loading
- No flash of unstyled text for Caveat
- Caveat still appears when cached (second+ page load)
- If Caveat never loads, the `cursive` fallback from the Tailwind font stack works fine

Additionally, the existing `<link rel="preconnect">` tags for Google Fonts (lines 21-22) remain unchanged. Caveat should NOT be preloaded -- only DM Sans and Fraunces benefit from preloading as essential fonts.

## Tests

Tests for this section are file-content verification tests, not runtime unit tests. They can be implemented as a dedicated test file or as part of a verification script. Place in `/Users/michaelbond/echo-vault/src/utils/__tests__/fontLoading.test.js`.

```
Test: index.html contains separate <link> for Caveat with display=optional
Test: index.html DM Sans + Fraunces <link> does NOT include Caveat
Test: index.html Caveat link has correct weights (400, 500, 600)
```

### Test File

Create `/Users/michaelbond/echo-vault/src/utils/__tests__/fontLoading.test.js`.

This test reads the contents of `index.html` and asserts on the font link structure. The tests should:

- Read the `index.html` file content as a string (using `fs.readFileSync`)
- Find all `<link>` tags that point to `fonts.googleapis.com`
- Assert that there are exactly two such `<link>` tags (one for DM Sans + Fraunces, one for Caveat)
- Assert that one link contains `family=Caveat` AND `display=optional`
- Assert that the Caveat link includes weights `400`, `500`, and `600`
- Assert that the other link contains `family=DM+Sans` and `family=Fraunces` but does NOT contain `Caveat`
- Assert that the DM Sans + Fraunces link uses `display=swap`
- Assert that there is no `<link rel="preload">` for Caveat

The test file should import `fs` from `node:fs` and `path` from `node:path`, resolve the path to `index.html` relative to the project root, and use `describe`/`it`/`expect` from Vitest.

## Implementation Details

### File to Modify

`/Users/michaelbond/echo-vault/index.html`

### What to Change

**Line 23** -- Replace the single combined Google Fonts `<link>` tag with two separate tags.

The current single link (line 23):
```html
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&display=swap" rel="stylesheet" />
```

Should be replaced with two links:

1. **DM Sans + Fraunces** (essential fonts, `display=swap`):
   - URL: `https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&display=swap`

2. **Caveat** (decorative accent font, `display=optional`):
   - URL: `https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&display=optional`

### What NOT to Change

- The `<link rel="preconnect">` tags on lines 21-22 remain exactly as they are
- The HTML comments above the font links (lines 17-20) can be kept as-is or lightly updated to note the split
- The inline `<style>` block (lines 25-83) is unchanged
- The `font-family` in the body style (line 28) referencing `'DM Sans'` is unchanged
- No preload link should be added for Caveat
- The `tailwind.config.js` font family definitions are unchanged (they are already correct)

### Placement

The two new `<link>` tags go in the same location as the original single link -- after the preconnect links and before the inline `<style>` block. The DM Sans + Fraunces link should come first (it is higher priority), followed by the Caveat link.

### Verification

After implementation, verify:
1. Run `npm test` -- the new font loading test should pass
2. Open the app in a browser with DevTools Network tab open
3. Confirm two separate Google Fonts CSS requests are made
4. Confirm the Caveat CSS response contains `font-display: optional`
5. Confirm the DM Sans/Fraunces CSS response contains `font-display: swap`
6. Throttle network to "Slow 3G" -- confirm no layout shift from Caveat on first load

## Implementation Notes

**Implemented as planned.** Minor deviations from code review:

- Test regex refined to match `fonts.googleapis.com/css2` (with `/css2` path) instead of just `fonts.googleapis.com` to avoid false-matching preconnect `<link>` tags
- Weight assertion tightened to assert on full `wght@400;500;600` substring instead of individual `'400'`, `'500'`, `'600'` checks
- Added negative assertion `expect(caveatLink).not.toContain('display=swap')` for defense against accidental dual display parameters

**Files modified:** `index.html` (line 23-24), `src/utils/__tests__/fontLoading.test.js` (new)
**Tests:** 6 passing