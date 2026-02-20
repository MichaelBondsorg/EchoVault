/**
 * CSS Component Classes - Verification Tests
 *
 * Reads src/index.css and verifies:
 * - Dark mode variants exist for all component classes
 * - New card variants (.card-elevated, .card-featured) exist
 * - Gradient utility classes are defined with dark mode
 * - Global CSS primitives (scrollbar, autofill, shimmer dark)
 * - .btn-success variant exists
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const cssPath = path.resolve(__dirname, '../../index.css');
const css = fs.readFileSync(cssPath, 'utf-8');

describe('CSS Component Classes - Dark Mode', () => {
  it('card has dark variant with warm background', () => {
    expect(css).toMatch(/html\.dark\s+\.card\s*\{/);
    // Should use hearth-850 tone (~rgba(35, 29, 27, ...)), not pure black
    const darkCardMatch = css.match(/html\.dark\s+\.card\s*\{[^}]+\}/);
    expect(darkCardMatch).toBeTruthy();
    expect(darkCardMatch[0]).toMatch(/background/);
    expect(darkCardMatch[0]).not.toMatch(/#000/);
  });

  it('btn-primary has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.btn-primary/);
  });

  it('btn-secondary has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.btn-secondary/);
  });

  it('btn-ghost has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.btn-ghost/);
  });

  it('badge variants have dark variants', () => {
    expect(css).toMatch(/html\.dark\s+\.badge-primary/);
    expect(css).toMatch(/html\.dark\s+\.badge-secondary/);
    expect(css).toMatch(/html\.dark\s+\.badge-accent/);
    expect(css).toMatch(/html\.dark\s+\.badge-terra/);
  });

  it('badge-mood variants have dark variants', () => {
    expect(css).toMatch(/html\.dark\s+\.badge-mood-great/);
    expect(css).toMatch(/html\.dark\s+\.badge-mood-low/);
  });

  it('modal-content has dark variant with warm background', () => {
    expect(css).toMatch(/html\.dark\s+\.modal-content/);
    const darkModalMatch = css.match(/html\.dark\s+\.modal-content\s*\{[^}]+\}/);
    expect(darkModalMatch).toBeTruthy();
    expect(darkModalMatch[0]).toMatch(/background/);
  });

  it('input has dark variant with warm colors', () => {
    expect(css).toMatch(/html\.dark\s+\.input\s*[\{:]/);
    const darkInputMatch = css.match(/html\.dark\s+\.input\s*\{[^}]+\}/);
    expect(darkInputMatch).toBeTruthy();
    expect(darkInputMatch[0]).toMatch(/background/);
    expect(darkInputMatch[0]).toMatch(/border/);
    expect(darkInputMatch[0]).toMatch(/color/);
  });

  it('card-glass has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.card-glass/);
  });

  it('card-warm has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.card-warm/);
  });

  it('shimmer has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.shimmer/);
  });

  it('action-checkbox has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.action-checkbox/);
  });

  it('badge-recurring has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.badge-recurring/);
  });
});

describe('CSS Component Classes - New Variants', () => {
  it('card-elevated exists with hover shadow', () => {
    expect(css).toMatch(/\.card-elevated/);
    const cardElevatedMatch = css.match(/\.card-elevated[^{]*\{[^}]+\}/);
    expect(cardElevatedMatch).toBeTruthy();
  });

  it('card-elevated has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.card-elevated/);
  });

  it('card-featured exists with gradient background', () => {
    expect(css).toMatch(/\.card-featured/);
    const match = css.match(/\.card-featured[^{]*\{[^}]+\}/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/gradient/i);
  });

  it('card-featured has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+\.card-featured/);
  });

  it('btn-success exists with sage gradient', () => {
    expect(css).toMatch(/\.btn-success/);
    const match = css.match(/\.btn-success[^{]*\{[^}]+\}/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/gradient/i);
  });
});

describe('CSS Gradient Utilities', () => {
  const gradients = [
    'gradient-hearth-glow',
    'gradient-sage-mist',
    'gradient-lavender-dusk',
    'gradient-terra-dawn',
    'gradient-hearth-surface',
  ];

  gradients.forEach((gradient) => {
    it(`${gradient} is defined`, () => {
      expect(css).toMatch(new RegExp(`\\.${gradient}\\s*\\{`));
    });

    it(`${gradient} has dark mode definition`, () => {
      expect(css).toMatch(new RegExp(`html\\.dark\\s+\\.${gradient}`));
    });
  });
});

describe('CSS Global Primitives', () => {
  it('custom scrollbar styling exists', () => {
    expect(css).toMatch(/::-webkit-scrollbar/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb/);
  });

  it('scrollbar has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+::-webkit-scrollbar-thumb/);
  });

  it('chrome autofill override exists', () => {
    expect(css).toMatch(/:-webkit-autofill/);
  });

  it('chrome autofill has dark variant', () => {
    expect(css).toMatch(/html\.dark\s+input:-webkit-autofill/);
  });
});
