import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexHtml = fs.readFileSync(
  path.resolve(__dirname, '../../../index.html'),
  'utf-8'
);

const indexCss = fs.readFileSync(
  path.resolve(__dirname, '../../index.css'),
  'utf-8'
);

// Cloud uses a privacy-preserving system stack: no runtime font requests.
const fontLinks = indexHtml.match(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2[^"]*"[^>]*>/g) || [];

describe('Font loading — index.html', () => {
  it('does not load remote Google Fonts', () => {
    expect(fontLinks).toHaveLength(0);
  });

  it('boots with the Cloud system font stack', () => {
    expect(indexHtml).toContain('font-family: Geist, Inter');
    expect(indexHtml).not.toContain('fonts.gstatic.com');
  });

  it('does not reference any remote font host anywhere in the document', () => {
    expect(indexHtml).not.toMatch(/https?:\/\/fonts\.(googleapis|gstatic)\.com/);
  });
});

describe('Font loading — self-hosted @fontsource imports (src/index.css)', () => {
  it('imports Geist Sans weights 400/500/600/700 from @fontsource', () => {
    ['400', '500', '600', '700'].forEach((weight) => {
      expect(indexCss).toContain(`@fontsource/geist-sans/${weight}.css`);
    });
  });

  it('imports Newsreader weights 400/500/600 (roman + italic) from @fontsource', () => {
    ['400', '500', '600'].forEach((weight) => {
      expect(indexCss).toContain(`@fontsource/newsreader/${weight}.css`);
      expect(indexCss).toContain(`@fontsource/newsreader/${weight}-italic.css`);
    });
  });

  it('does not import any remote font stylesheet from index.css', () => {
    expect(indexCss).not.toMatch(/https?:\/\/fonts\.(googleapis|gstatic)\.com/);
  });
});
