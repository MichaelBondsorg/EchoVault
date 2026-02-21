import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { HEX_COLORS } from '../colorMap.js';

const SRC_ROOT = resolve(__dirname, '../../..');
const readFile = (relativePath) =>
  readFileSync(resolve(SRC_ROOT, relativePath), 'utf-8');

// Recursively collect .jsx/.js files under a directory
function collectFiles(dir, ext = /\.(jsx?|tsx?)$/) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'planning') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, ext));
    } else if (ext.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

// Off-palette pattern (excludes red which is allowed for safety/semantic uses)
const OFF_PALETTE =
  /(?:text|bg|border|from|to|via|ring|hover:text|hover:bg|hover:border)-(?:green|blue|purple|amber|teal|pink|indigo|emerald|orange|violet|rose|cyan|sky)-\d+/g;

// Files and patterns explicitly exempted from off-palette checks
const EXEMPT_FILES = [
  'services/safety/',     // Crisis detection
  'config/constants.js',  // Safety keywords
  '__tests__/',           // Test files
];

// Known off-palette hex values that should not appear in confetti
const OLD_CONFETTI_HEX = ['#14b8a6', '#5eead4', '#a855f7', '#fb923c', '#fcd34d'];

describe('Miscellaneous Sweep Verification', () => {
  describe('Confetti colors in ui/index.jsx', () => {
    it('should not contain old off-palette hex values', () => {
      const content = readFile('src/components/ui/index.jsx');
      for (const hex of OLD_CONFETTI_HEX) {
        expect(content).not.toContain(hex);
      }
    });

    it('should use HEX_COLORS values from colorMap', () => {
      const content = readFile('src/components/ui/index.jsx');
      const hexValues = Object.values(HEX_COLORS);
      // Extract hex strings from celebrate object (first ~120 lines)
      const celebrateSection = content.slice(0, content.indexOf('// Button Components') || 3000);
      const hexMatches = celebrateSection.match(/#[0-9a-fA-F]{6}/g) || [];
      // All hex colors in celebrate should come from HEX_COLORS
      for (const hex of hexMatches) {
        expect(hexValues).toContain(hex);
      }
    });
  });

  describe('Caveat font-hand integration', () => {
    it('should have font-hand class in at least 3 component files', () => {
      const files = collectFiles(resolve(SRC_ROOT, 'src/components'));
      const filesWithFontHand = files.filter((f) => {
        const content = readFileSync(f, 'utf-8');
        return content.includes('font-hand');
      });
      expect(filesWithFontHand.length).toBeGreaterThanOrEqual(3);
    });

    it('should not exceed 2 font-hand usages per component file', () => {
      const files = collectFiles(resolve(SRC_ROOT, 'src/components'));
      for (const f of files) {
        const content = readFileSync(f, 'utf-8');
        const count = (content.match(/font-hand/g) || []).length;
        if (count > 0) {
          expect(count, `${f} has ${count} font-hand usages`).toBeLessThanOrEqual(2);
        }
      }
    });
  });

  describe('Off-palette color sweep', () => {
    it('should have zero remaining off-palette color classes outside exempted files', () => {
      const files = collectFiles(resolve(SRC_ROOT, 'src'));
      const violations = [];

      for (const f of files) {
        const relativePath = f.replace(SRC_ROOT + '/', '');
        // Skip exempted files
        if (EXEMPT_FILES.some((exempt) => relativePath.includes(exempt))) continue;

        const content = readFileSync(f, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip lines with @color-safe annotation
          if (line.includes('@color-safe')) continue;
          // Skip lines that are comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

          const matches = line.match(OFF_PALETTE);
          if (matches) {
            // Allow gray-* in specific contexts (Google brand, auth forms)
            const filtered = matches.filter((m) => !m.includes('gray-'));
            if (filtered.length > 0) {
              violations.push(`${relativePath}:${i + 1}: ${filtered.join(', ')}`);
            }
          }
        }
      }

      expect(violations, `Off-palette violations:\n${violations.join('\n')}`).toHaveLength(0);
    });
  });
});
