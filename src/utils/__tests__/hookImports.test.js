import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

/**
 * Guard against "ReferenceError: <hook> is not defined" at runtime.
 *
 * A component that CALLS a React hook without importing it builds fine (esbuild
 * doesn't error on undefined globals) and passes any test that doesn't render
 * it — then throws in production. This exact bug shipped once when useState was
 * used in App.jsx (migrated off useState to Zustand, so the import had been
 * removed) and crashed the deployed app for every user on load. This test scans
 * the source tree and fails if any file calls a hook it doesn't import.
 */

const SRC = resolve(__dirname, '../..');
const REACT_HOOKS = [
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef',
  'useContext', 'useReducer', 'useLayoutEffect', 'useImperativeHandle',
];

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'test') continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function reactNamedImports(content) {
  const names = new Set();
  const re = /import\s+(?:React\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('React hook imports', () => {
  const files = collectSourceFiles(SRC);

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every file that calls a React hook imports it', () => {
    const violations = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const named = reactNamedImports(content);
      for (const hook of REACT_HOOKS) {
        const callsHook = new RegExp(`\\b${hook}\\s*\\(`).test(content);
        if (!callsHook) continue;
        const imported = named.has(hook) || content.includes(`React.${hook}`);
        if (!imported) {
          violations.push(`${file.replace(SRC, 'src')} calls ${hook}() without importing it`);
        }
      }
    }
    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
