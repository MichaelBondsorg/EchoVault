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

describe('tailwind.config.js — safelist', () => {
  it('safelist array is defined and non-empty', () => {
    expect(tailwindConfig.safelist).toBeDefined();
    expect(Array.isArray(tailwindConfig.safelist)).toBe(true);
    expect(tailwindConfig.safelist.length).toBeGreaterThan(0);
  });

  it('safelist includes pattern entries for bg-, text-, and border- with palette colors', () => {
    // Safelist contains regex patterns — serialize regex source for inspection
    const safelistStr = tailwindConfig.safelist
      .map((entry) => (entry.pattern ? entry.pattern.source : JSON.stringify(entry)))
      .join(' ');
    expect(safelistStr).toContain('honey');
    expect(safelistStr).toContain('terra');
    expect(safelistStr).toContain('sage');
    expect(safelistStr).toContain('lavender');
    expect(safelistStr).toContain('hearth');
  });
});

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
