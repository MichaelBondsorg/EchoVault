import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexHtml = fs.readFileSync(
  path.resolve(__dirname, '../../../index.html'),
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
});
