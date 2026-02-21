import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Legacy screen verification tests.
 * Confirms off-palette colors are removed and dark mode classes are present.
 */

const readComponent = (relativePath) =>
  readFileSync(resolve(__dirname, '../../..', relativePath), 'utf-8');

// Generic off-palette pattern for indigo/teal/cyan/sky
const GENERIC_OFF_PALETTE =
  /(?:text|bg|border|from|to|via|ring|hover:text|hover:bg|hover:border)-(?:indigo|teal|cyan|sky)-\d+/g;

describe('Legacy Screens - Off-Palette Removal', () => {
  it('WhatsNewModal.jsx has no off-palette color classes', () => {
    const content = readComponent('src/components/shared/WhatsNewModal.jsx');

    // Check for specific off-palette classes that should be replaced
    const offPalette = [
      /(?:text|bg|border|from|to|via)-(?:pink)-\d+/g,
      /(?:text|bg|border|from|to|via)-(?:blue)-\d+/g,
      /(?:text|bg|border|from|to|via)-(?:green)-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }

    // bg-red-100/text-red-500 for Heart icon is acceptable (semantic), but decorative red gradients should be gone
    const redGradients = content.match(/(?:from|to|via)-red-\d+/g) || [];
    expect(redGradients, `Found off-palette red gradients: ${redGradients.join(', ')}`).toHaveLength(0);
  });

  it('WhatsNewModal.jsx modal container has dark mode variant', () => {
    const content = readComponent('src/components/shared/WhatsNewModal.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('HealthSettingsScreen.jsx has no off-palette teal/blue/purple/indigo/green/orange/sky classes', () => {
    const content = readComponent('src/components/screens/HealthSettingsScreen.jsx');

    const offPalette = [
      /(?:text|bg|border|from|to|via)-teal-\d+/g,
      /(?:text|bg|border|from|to|via)-blue-\d+/g,
      /(?:text|bg|border|from|to|via)-purple-\d+/g,
      /(?:text|bg|border|from|to|via)-indigo-\d+/g,
      /(?:text|bg|border|from|to|via)-orange-\d+/g,
      /(?:text|bg|border|from|to|via)-sky-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }

    // green-* should be replaced EXCEPT in recovery status (semantic health traffic light)
    // and bg-gray-100/text-gray-700 should become warm-*
    const grayMatches = content.match(/(?:text|bg|border)-gray-\d+/g) || [];
    expect(grayMatches, `Found off-palette gray: ${grayMatches.join(', ')}`).toHaveLength(0);
  });

  it('HealthSettingsScreen.jsx has dark mode variants on key containers', () => {
    const content = readComponent('src/components/screens/HealthSettingsScreen.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(15);
  });

  it('MorningCompass.jsx has no off-palette color classes', () => {
    const content = readComponent('src/components/dashboard/views/MorningCompass.jsx');

    const offPalette = [
      /(?:text|bg|border|from|to|via|hover:border)-(?:blue|indigo|amber)-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }
  });

  it('MorningCompass.jsx has dark mode variants', () => {
    const content = readComponent('src/components/dashboard/views/MorningCompass.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('MidDayCheckIn.jsx has no off-palette color classes', () => {
    const content = readComponent('src/components/dashboard/views/MidDayCheckIn.jsx');

    const offPalette = [
      /(?:text|bg|border|from|to|via|hover:border)-(?:blue|indigo|green|emerald)-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }
  });

  it('MidDayCheckIn.jsx has dark mode variants', () => {
    const content = readComponent('src/components/dashboard/views/MidDayCheckIn.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(8);
  });

  it('EveningMirror.jsx has no off-palette color classes', () => {
    const content = readComponent('src/components/dashboard/views/EveningMirror.jsx');

    const offPalette = [
      /(?:text|bg|border|from|to|via|hover:border)-(?:green|emerald|violet)-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }
  });

  it('EveningMirror.jsx has dark mode variants', () => {
    const content = readComponent('src/components/dashboard/views/EveningMirror.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(6);
  });

  it('ShelterView.jsx has no off-palette teal/blue/purple/cyan/gray classes', () => {
    const content = readComponent('src/components/dashboard/views/ShelterView.jsx');

    const offPalette = [
      /(?:text|bg|border|from|to|via)-teal-\d+/g,
      /(?:text|bg|border|from|to|via)-blue-\d+/g,
      /(?:text|bg|border|from|to|via)-purple-\d+/g,
      /(?:text|bg|border|from|to|via)-cyan-\d+/g,
      /(?:text|bg|border|from|to|via)-gray-\d+/g,
      /(?:text|bg|border|from|to|via)-indigo-\d+/g,
    ];

    for (const pattern of offPalette) {
      const matches = content.match(pattern) || [];
      expect(matches, `Found off-palette: ${matches.join(', ')}`).toHaveLength(0);
    }
  });

  it('ShelterView.jsx has dark mode variants', () => {
    const content = readComponent('src/components/dashboard/views/ShelterView.jsx');
    const darkMatches = content.match(/dark:/g) || [];
    expect(darkMatches.length).toBeGreaterThanOrEqual(20);
  });
});
