/**
 * Guard: no shut-down Gemini 2.0 model id may appear in shipping source under
 * functions/ or relay-server/src (plan task M2). text-embedding-004 is still a
 * live legacy embedding space during the dual-index migration, so it is not
 * scanned here. Test files and node_modules are excluded.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Raw substring scan: a bare `.includes` intentionally also flags the model id
// in COMMENTS, not just code. That strictness is deliberate — a shut-down model
// id should not linger anywhere in shipping source, even in a stale comment.
const FORBIDDEN = ['gemini-2.0-flash', 'gemini-2.0-flash-exp'];

const ROOTS = [
  join(process.cwd(), 'functions'),
  join(process.cwd(), 'relay-server', 'src'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'coverage']);

function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(js|ts)$/.test(name) && !/\.test\.(js|ts)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('dead-model guard', () => {
  const files = ROOTS.flatMap(collectSourceFiles);

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const bad of FORBIDDEN) {
    it(`no shipping source contains "${bad}"`, () => {
      const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(bad));
      expect(offenders, `Found "${bad}" in:\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});
