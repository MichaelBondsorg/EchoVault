/**
 * Storage-registry enforcement lint (QA-01, PRIV-01 reviewer mandate).
 *
 * HARD BLOCKER: fails when any `src/` file calls
 * `localStorage.setItem/getItem/removeItem` with a literal string key that
 * is not accounted for by `src/services/storage/storageRegistry.js` — i.e.
 * a brand-new local-storage key someone hardcoded inline instead of routing
 * through a named helper (`ownerStorageKey`, a `KEY` constant, etc.) and
 * declaring it somewhere.
 *
 * Deliberately scoped to LITERAL call sites only —
 * `localStorage.setItem(SOME_CONST, ...)` or
 * `localStorage.setItem(ownerStorageKey(uid, 'area'), ...)` do not match:
 * those already go through a named, greppable identifier or helper. This
 * lint exists to catch the specific anti-pattern of a raw string typed
 * directly into a `localStorage` call with no name attached to it at all.
 *
 * A literal key passes if it is:
 *  - listed in `KNOWN_LITERAL_KEYS` (pre-existing, non-sensitive, genuinely
 *    device-scoped keys that predate this lint and don't fit
 *    `STORAGE_REGISTRY`'s owner-scoped schema — see that array's own
 *    header comment in storageRegistry.js for why), or
 *  - it starts with one of `LEGACY_PREFIX_SWEEPS`'s declared prefixes
 *    (the voice-transcript / audio-backup legacy quarantine sweeps).
 *
 * Exempted files (not scanned): the registry module itself (it does not
 * call `localStorage` — this is belt-and-suspenders), every test file, and
 * the legacy-sweep modules named in this ticket
 * (`legacyAudioBackupSweep.js`, `sessionBuffer.js`, `useVoiceRelay.js`) —
 * per QA-01's explicit instruction. In practice none of those three
 * currently have a literal call site (they route legacy keys through named
 * constants/helper functions too), so the exemption is a no-op safety net
 * today, not a live carve-out — see task-qa01-report.md.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LEGACY_PREFIX_SWEEPS, KNOWN_LITERAL_KEYS } from '../storageRegistry.js';

const SRC_ROOT = join(process.cwd(), 'src');

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'test']);

const EXEMPT_FILES = new Set([
  'src/services/storage/storageRegistry.js',
  'src/services/storage/legacyAudioBackupSweep.js',
  'src/services/memory/sessionBuffer.js',
  'src/hooks/useVoiceRelay.js',
]);

// Literal string/template-literal opener right after the call's open-paren
// (optional whitespace only in between) — deliberately does NOT match a
// variable, member expression, or function-call argument.
const LITERAL_CALL_RX = /localStorage\.(setItem|getItem|removeItem)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;

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
    } else if (/\.(js|jsx|ts|tsx)$/.test(name) && !/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function isKnownKey(key) {
  if (KNOWN_LITERAL_KEYS.some((entry) => entry.key === key)) return true;
  if (LEGACY_PREFIX_SWEEPS.some((entry) => key.startsWith(entry.prefix))) return true;
  return false;
}

describe('storage-key registry-enforcement lint (QA-01 / PRIV-01 hard blocker)', () => {
  const files = collectSourceFiles(SRC_ROOT).filter(
    (f) => !EXEMPT_FILES.has(relative(process.cwd(), f).split('\\').join('/'))
  );

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every literal localStorage key is registered in storageRegistry.js', () => {
    const offenders = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const relPath = relative(process.cwd(), file);
      for (const match of content.matchAll(LITERAL_CALL_RX)) {
        const key = match[3];
        if (!isKnownKey(key)) {
          const line = content.slice(0, match.index).split('\n').length;
          offenders.push(`${relPath}:${line} — localStorage.${match[1]}("${key}")`);
        }
      }
    }
    expect(
      offenders,
      `Found unregistered literal localStorage key(s):\n${offenders.join('\n')}\n\n` +
      `Add the key to KNOWN_LITERAL_KEYS (non-sensitive/device-scoped) or a proper ` +
      `STORAGE_REGISTRY entry (owner-scoped/sensitive) in src/services/storage/storageRegistry.js, ` +
      `or route it through a named helper/constant instead of a raw literal.`
    ).toEqual([]);
  });
});
