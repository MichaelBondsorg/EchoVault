import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexHtml = fs.readFileSync(
  path.resolve(__dirname, '../../../index.html'),
  'utf-8'
);

// Extract all <link> tags with href pointing to fonts.googleapis.com/css2
const fontLinks = indexHtml.match(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>/g) || [];

describe('Font loading — index.html', () => {
  it('has exactly two Google Fonts <link> tags', () => {
    expect(fontLinks).toHaveLength(2);
  });

  it('has a Caveat link with display=optional', () => {
    const caveatLink = fontLinks.find(link => link.includes('family=Caveat'));
    expect(caveatLink).toBeDefined();
    expect(caveatLink).toContain('display=optional');
    expect(caveatLink).not.toContain('display=swap');
  });

  it('Caveat link includes weights 400, 500, and 600', () => {
    const caveatLink = fontLinks.find(link => link.includes('family=Caveat'));
    expect(caveatLink).toContain('wght@400;500;600');
  });

  it('DM Sans + Fraunces link does NOT include Caveat', () => {
    const essentialLink = fontLinks.find(link => link.includes('family=DM+Sans'));
    expect(essentialLink).toBeDefined();
    expect(essentialLink).toContain('family=Fraunces');
    expect(essentialLink).not.toContain('Caveat');
  });

  it('DM Sans + Fraunces link uses display=swap', () => {
    const essentialLink = fontLinks.find(link => link.includes('family=DM+Sans'));
    expect(essentialLink).toContain('display=swap');
  });

  it('does not preload Caveat', () => {
    const preloadLinks = indexHtml.match(/<link[^>]*rel=["']preload["'][^>]*>/g) || [];
    const caveatPreload = preloadLinks.find(link => link.includes('Caveat'));
    expect(caveatPreload).toBeUndefined();
  });
});
