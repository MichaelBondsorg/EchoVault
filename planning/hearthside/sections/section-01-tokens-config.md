Now I have all the context I need. Let me produce the section content.

# Section 01: Tokens and Config -- `hearth-850` Token, Gradient System, and Tailwind Safelist

## Overview

This section is the foundation of the entire Hearthside visual overhaul. It modifies `tailwind.config.js` to add the missing `hearth-850` color token, define five gradient presets with light/dark variants, and add a safelist to prevent Tailwind from purging dynamically-referenced color classes used by the `colorMap.js` utility (created in Section 02).

**No other section can begin until this section is complete.** Sections 02 through 06 all depend on the tokens and configuration established here.

## Dependencies

- None -- this is the first section and has no dependencies.

## Blocks

- Section 02 (colorMap.js)
- Section 03 (CSS component extensions)
- Section 04 (dark mode infrastructure)
- Section 05 (font loading)
- Section 06 (CollapsibleSection)

## Files to Modify

| File | Action |
|------|--------|
| `/Users/michaelbond/echo-vault/tailwind.config.js` | Add hearth-850 token, gradient preset CSS custom properties, and safelist array |
| `/Users/michaelbond/echo-vault/src/index.css` | Add gradient utility classes using the new presets |

### OLED / Pure Black Decision (Document in Config)

The Hearthside dark mode deliberately uses warm-tinted darks (`hearth-950` = `#131110`, not `#000000`). This is an intentional design decision for a therapeutic app — pure black feels clinical, warm darks feel cozy. Add a comment in `tailwind.config.js` near the hearth color scale:

```javascript
// Dark mode uses warm-tinted surfaces, NOT pure black.
// hearth-950 is the darkest background. Do not add #000000.
// Rationale: therapeutic warmth > OLED battery savings.
```

This prevents future drift toward pure black and documents the reasoning.

## Files to Create

| File | Action |
|------|--------|
| `/Users/michaelbond/echo-vault/src/utils/__tests__/tailwindTokens.test.js` | Tests verifying token existence and gradient presets |

---

## Tests First

Create the test file at `/Users/michaelbond/echo-vault/src/utils/__tests__/tailwindTokens.test.js`. The `src/utils/` directory does not exist yet and must be created along with its `__tests__/` subdirectory.

These tests import and inspect the Tailwind config object directly (it uses `export default` so it can be imported as an ES module). They also read CSS file content for the gradient utility class verification.

### Test: hearth-850 token exists and is valid

```javascript
import { describe, it, expect } from 'vitest';
import tailwindConfig from '../../../tailwind.config.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const colors = tailwindConfig.theme.extend.colors;

describe('tailwind.config.js — hearth-850 token', () => {
  it('hearth scale includes 850 key', () => {
    expect(colors.hearth).toHaveProperty('850');
  });

  it('hearth-850 value is a valid hex color', () => {
    expect(colors.hearth[850]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('hearth-850 is between hearth-800 and hearth-900 in luminance', () => {
    // Simple numeric check: the hex value should fall between 800 and 900
    const toNum = (hex) => parseInt(hex.replace('#', ''), 16);
    const v800 = toNum(colors.hearth[800]);
    const v850 = toNum(colors.hearth[850]);
    const v900 = toNum(colors.hearth[900]);
    // 850 should be darker than 800 (lower numeric value) and lighter than 900
    expect(v850).toBeLessThan(v800);
    expect(v850).toBeGreaterThan(v900);
  });
});
```

### Test: gradient presets are defined

```javascript
describe('tailwind.config.js — gradient presets', () => {
  const gradientPresets = tailwindConfig.theme.extend.gradientPresets;

  it('all 5 gradient presets are defined', () => {
    const expectedPresets = [
      'hearth-glow',
      'sage-mist',
      'lavender-dusk',
      'terra-dawn',
      'hearth-surface',
    ];
    expectedPresets.forEach((name) => {
      expect(gradientPresets).toHaveProperty(name);
    });
  });

  it('each gradient preset has light and dark color values', () => {
    Object.entries(gradientPresets).forEach(([name, preset]) => {
      expect(preset).toHaveProperty('light');
      expect(preset).toHaveProperty('dark');
      expect(preset.light).toHaveProperty('from');
      expect(preset.light).toHaveProperty('to');
      expect(preset.dark).toHaveProperty('from');
      expect(preset.dark).toHaveProperty('to');
    });
  });
});
```

### Test: existing ambient presets still present

```javascript
describe('tailwind.config.js — existing ambient presets preserved', () => {
  it('ambient.warm still present', () => {
    expect(colors.ambient).toHaveProperty('warm');
    expect(colors.ambient.warm).toHaveProperty('from');
  });

  it('ambient.balanced still present', () => {
    expect(colors.ambient).toHaveProperty('balanced');
  });

  it('ambient.calm still present', () => {
    expect(colors.ambient).toHaveProperty('calm');
  });
});
```

### Test: safelist exists for colorMap classes

```javascript
describe('tailwind.config.js — safelist', () => {
  it('safelist array is defined and non-empty', () => {
    expect(tailwindConfig.safelist).toBeDefined();
    expect(Array.isArray(tailwindConfig.safelist)).toBe(true);
    expect(tailwindConfig.safelist.length).toBeGreaterThan(0);
  });

  it('safelist includes pattern entries for bg-, text-, and border- with palette colors', () => {
    // Safelist should contain regex patterns or string arrays covering palette classes
    const safelistStr = JSON.stringify(tailwindConfig.safelist);
    expect(safelistStr).toContain('honey');
    expect(safelistStr).toContain('terra');
    expect(safelistStr).toContain('sage');
    expect(safelistStr).toContain('lavender');
    expect(safelistStr).toContain('hearth');
  });
});
```

### Test: gradient utility classes exist in index.css

```javascript
describe('index.css — gradient utility classes', () => {
  const cssContent = readFileSync(
    resolve(__dirname, '../../index.css'),
    'utf-8'
  );

  it('gradient-hearth-glow class is defined', () => {
    expect(cssContent).toContain('.gradient-hearth-glow');
  });

  it('gradient-sage-mist class is defined', () => {
    expect(cssContent).toContain('.gradient-sage-mist');
  });

  it('gradient-lavender-dusk class is defined', () => {
    expect(cssContent).toContain('.gradient-lavender-dusk');
  });

  it('gradient-terra-dawn class is defined', () => {
    expect(cssContent).toContain('.gradient-terra-dawn');
  });

  it('gradient-hearth-surface class is defined', () => {
    expect(cssContent).toContain('.gradient-hearth-surface');
  });
});
```

---

## Implementation Details

### 1. Add `hearth-850` Token

In `/Users/michaelbond/echo-vault/tailwind.config.js`, the `hearth` color scale currently jumps from `800: '#2A2420'` to `900: '#1C1916'`. Add an interpolated value at `850` between them for dark mode raised surfaces (cards on dark backgrounds).

The interpolated hex value should be approximately `#231D1B`. This sits visually between the toasted brown of 800 and the deep charcoal of 900, providing a subtle elevation distinction in dark mode.

Add this entry to the `hearth` object inside `theme.extend.colors`, between the `800` and `900` entries:

```javascript
850: '#231D1B',  // Dark mode raised surface
```

### 2. Add Gradient Presets

Add a new `gradientPresets` key inside `theme.extend` in the Tailwind config. This is a custom key (not a built-in Tailwind key) that serves as a structured data source for both the CSS gradient utility classes in `index.css` and any JavaScript consumers that need to reference gradient colors programmatically.

The five gradient presets and their color values:

| Preset Name | Purpose | Light `from` | Light `to` | Dark `from` | Dark `to` |
|-------------|---------|-------------|-----------|------------|----------|
| `hearth-glow` | Warmth/comfort | `honey-300` hex (`#FCC44F`) | `terra-400` hex (`#C4725A`) | `honey-800/60` equivalent | `terra-800/60` equivalent |
| `sage-mist` | Growth/healing | `sage-100` hex (`#E0ECE2`) | `sage-300` hex (`#9DC0A3`) | `sage-900/40` equivalent | `sage-800/40` equivalent |
| `lavender-dusk` | Insight/reflection | `lavender-100` hex (`#E8E3F2`) | `lavender-300` hex (`#B5A7D4`) | `lavender-900/40` equivalent | `lavender-800/40` equivalent |
| `terra-dawn` | Grounding/aspiration | `terra-100` hex (`#FADDD5`) | `honey-100` hex (`#FEECC8`) | `terra-900/40` equivalent | `honey-900/40` equivalent |
| `hearth-surface` | Subtle card BG | `warm-50` hex (`#FAF5EF`) | white (`#FFFFFF`) | `hearth-900` hex (`#1C1916`) | `hearth-850` hex (`#231D1B`) |

For the dark variants using transparency (e.g., `honey-800/60`), compute the RGBA equivalents from the base hex values. For example, `honey-800` is `#6E4512` -- at 60% opacity that becomes `rgba(110, 69, 18, 0.6)`.

The structure in the config should look like:

```javascript
gradientPresets: {
  'hearth-glow': {
    light: { from: '#FCC44F', to: '#C4725A' },
    dark: { from: 'rgba(110, 69, 18, 0.6)', to: 'rgba(94, 45, 36, 0.6)' },
  },
  'sage-mist': {
    light: { from: '#E0ECE2', to: '#9DC0A3' },
    dark: { from: 'rgba(26, 36, 27, 0.4)', to: 'rgba(37, 53, 39, 0.4)' },
  },
  'lavender-dusk': {
    light: { from: '#E8E3F2', to: '#B5A7D4' },
    dark: { from: 'rgba(34, 30, 48, 0.4)', to: 'rgba(53, 47, 73, 0.4)' },
  },
  'terra-dawn': {
    light: { from: '#FADDD5', to: '#FEECC8' },
    dark: { from: 'rgba(63, 30, 24, 0.4)', to: 'rgba(74, 46, 13, 0.4)' },
  },
  'hearth-surface': {
    light: { from: '#FAF5EF', to: '#FFFFFF' },
    dark: { from: '#1C1916', to: '#231D1B' },
  },
},
```

### 3. Add Dark Variants for Ambient Presets

The existing `ambient.warm`, `ambient.balanced`, and `ambient.calm` presets under `colors` define `from`/`via`/`to` hex values for light mode only. Add corresponding dark-mode ambient colors. These can be added as sibling keys:

```javascript
ambient: {
  warm: {
    from: '#E8A84C',
    via:  '#7A9E7E',
    to:   '#C1D9C5',
  },
  'warm-dark': {
    from: 'rgba(110, 69, 18, 0.4)',
    via:  'rgba(37, 53, 39, 0.3)',
    to:   'rgba(37, 53, 39, 0.2)',
  },
  balanced: {
    from: '#D4C4B0',
    via:  '#E8DDD0',
    to:   '#F5EDE3',
  },
  'balanced-dark': {
    from: 'rgba(42, 36, 32, 0.6)',
    via:  'rgba(35, 29, 27, 0.5)',
    to:   'rgba(28, 25, 22, 0.4)',
  },
  calm: {
    from: '#9B8EC4',
    via:  '#B5A7D4',
    to:   '#D1C8E5',
  },
  'calm-dark': {
    from: 'rgba(53, 47, 73, 0.4)',
    via:  'rgba(53, 47, 73, 0.3)',
    to:   'rgba(34, 30, 48, 0.3)',
  },
},
```

### 4. Add Safelist for Dynamic Color Classes

The `colorMap.js` utility (Section 02) will reference Tailwind classes dynamically via string concatenation or object lookups. Tailwind's content scanner cannot detect these dynamically constructed class names during the build, so they would be purged from the production CSS unless safelisted.

Add a top-level `safelist` key to the Tailwind config (at the same level as `content`, `darkMode`, `theme`, `plugins`). The safelist should use regex patterns to cover the palette color classes that `colorMap.js` will reference:

```javascript
safelist: [
  // Safelist for colorMap.js dynamic class references
  {
    pattern: /^(bg|text|border)-(honey|terra|sage|lavender|hearth|accent)-(50|100|200|300|400|500|600|700|800|900)/,
    variants: ['dark'],
  },
],
```

This single pattern entry covers all `bg-`, `text-`, and `border-` classes for all five palette colors at all shade levels, in both normal and `dark:` variants. This is intentionally broad to ensure no colorMap class is accidentally purged. The trade-off is a slightly larger CSS output, but these are colors that should exist in the design system anyway.

### 5. Add Gradient Utility Classes to `index.css`

In `/Users/michaelbond/echo-vault/src/index.css`, add gradient utility classes inside the existing `@layer utilities` block. These classes provide a convenient way to apply the gradient presets with automatic light/dark switching.

Each gradient utility class applies a `background` (or `background-image`) for light mode, with a corresponding `html.dark &` override for dark mode. Since Tailwind's `dark:` prefix only works with utility classes (not arbitrary gradient definitions), use the explicit `html.dark` selector pattern that is already used elsewhere in `index.css`.

Add the following inside the `@layer utilities { ... }` block, after the existing `.text-gradient-sage` class:

```css
/* Gradient presets — light/dark auto-switching */
.gradient-hearth-glow {
  background: linear-gradient(135deg, #FCC44F, #C4725A);
}
html.dark .gradient-hearth-glow {
  background: linear-gradient(135deg, rgba(110, 69, 18, 0.6), rgba(94, 45, 36, 0.6));
}

.gradient-sage-mist {
  background: linear-gradient(135deg, #E0ECE2, #9DC0A3);
}
html.dark .gradient-sage-mist {
  background: linear-gradient(135deg, rgba(26, 36, 27, 0.4), rgba(37, 53, 39, 0.4));
}

.gradient-lavender-dusk {
  background: linear-gradient(135deg, #E8E3F2, #B5A7D4);
}
html.dark .gradient-lavender-dusk {
  background: linear-gradient(135deg, rgba(34, 30, 48, 0.4), rgba(53, 47, 73, 0.4));
}

.gradient-terra-dawn {
  background: linear-gradient(135deg, #FADDD5, #FEECC8);
}
html.dark .gradient-terra-dawn {
  background: linear-gradient(135deg, rgba(63, 30, 24, 0.4), rgba(74, 46, 13, 0.4));
}

.gradient-hearth-surface {
  background: linear-gradient(135deg, #FAF5EF, #FFFFFF);
}
html.dark .gradient-hearth-surface {
  background: linear-gradient(135deg, #1C1916, #231D1B);
}
```

Note that the `html.dark .gradient-*` selectors must be placed outside the `@layer utilities` block OR within a nested `@layer` that Tailwind respects. The safest approach is to place the dark overrides immediately after each class definition within the same `@layer utilities` block -- Tailwind processes these correctly since `html.dark` specificity naturally wins.

**Important:** The gradient hex values in `index.css` must exactly match the values defined in the `gradientPresets` object in `tailwind.config.js`. These are intentionally duplicated (config for JS access, CSS for class-based usage) -- keep them in sync.

---

## Implementation Notes

**Safelist regex fix (from code review):** The original regex `(50|100|200|300|400|500|600|700|800|900)` was expanded to include `850` and `950` shades: `(50|100|200|300|400|500|600|700|800|850|900|950)`. Without this, dynamically-referenced `bg-hearth-850` classes would be purged in production.

**Test improvement:** The safelist test uses `entry.pattern.source` to serialize regex patterns instead of `JSON.stringify`, which serializes RegExp objects as `{}`. This is a deviation from the original test spec that was necessary for the test to work correctly.

**Test results:** 15 tests pass. Full suite: 411 tests pass, 0 regressions.

---

## Verification Checklist

After implementation, verify:

1. `npm test` passes -- the new test file at `/Users/michaelbond/echo-vault/src/utils/__tests__/tailwindTokens.test.js` should have all tests green
2. The existing 76 tests still pass (no regressions)
3. `npm run build` succeeds -- Tailwind compiles without errors
4. The `hearth-850` class is available (e.g., `bg-hearth-850` can be used in components)
5. The gradient utility classes appear in the compiled CSS output
6. The safelist prevents purging of palette color classes in production builds

## Current State of Files

For reference, the key files in their current state:

- **`/Users/michaelbond/echo-vault/tailwind.config.js`**: 324 lines. Uses `export default`. Has `darkMode: 'class'` already configured. The `hearth` scale has shades 50-950 but no 850. No `safelist` key. No `gradientPresets` key. The `ambient` colors only have light-mode values.

- **`/Users/michaelbond/echo-vault/src/index.css`**: 417 lines. Has `@layer base`, `@layer components`, and `@layer utilities` blocks. The `@layer utilities` block (starting at line 320) contains `.text-gradient`, `.text-gradient-sage`, `.glass`, and other utility classes. Gradient presets are not yet defined.

- **`/Users/michaelbond/echo-vault/src/utils/`**: Does not exist yet. Must be created along with the `__tests__/` subdirectory.

- **`/Users/michaelbond/echo-vault/vitest.config.js`**: 83 lines. Configured with `environment: 'jsdom'`, `globals: true`, and include patterns that cover `src/**/*.{test,spec}.{js,jsx,ts,tsx}`. The new test file at `src/utils/__tests__/tailwindTokens.test.js` will be automatically picked up by this glob pattern.