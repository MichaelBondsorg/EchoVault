/**
 * Pinned model manifest drift test (product review MOD-01).
 *
 * The checked-in `../model-manifest.json` must always equal a FRESH
 * `generateManifest()` run against the current `registry.js`. If someone
 * bumps a `MODEL_DEFAULTS` entry (or adds/removes a workload) without
 * regenerating the manifest (`node scripts/generate-model-manifest.mjs`
 * from repo root), this test fails CI — that's the whole governance point:
 * a model change is only "pinned" once the checked-in file agrees with the
 * source it was derived from.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WORKLOADS } from '../registry.js';
import { generateManifest, serializeManifest, WORKLOAD_PROMPT_VERSIONS } from '../manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, '..', 'model-manifest.json');

describe('pinned model manifest — drift guard', () => {
  it('the checked-in manifest matches a freshly generated one (no drift)', () => {
    const checkedIn = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const fresh = generateManifest();
    expect(checkedIn).toEqual(fresh);
  });

  it('the checked-in file is byte-identical to the deterministic serialization (formatting drift guard)', () => {
    const checkedInRaw = readFileSync(manifestPath, 'utf8');
    const freshRaw = serializeManifest(generateManifest());
    expect(checkedInRaw).toBe(freshRaw);
  });

  it('generateManifest() is deterministic across repeated calls in the same process', () => {
    const first = serializeManifest(generateManifest());
    const second = serializeManifest(generateManifest());
    const third = serializeManifest(generateManifest());
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('every registry workload appears exactly once in the manifest', () => {
    const { workloads } = generateManifest();
    const names = workloads.map((w) => w.workload);
    const expected = Object.values(WORKLOADS).slice().sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(expected);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every manifest entry has a non-empty modelId and a number-or-null promptVersion', () => {
    const { workloads } = generateManifest();
    for (const entry of workloads) {
      expect(typeof entry.modelId).toBe('string');
      expect(entry.modelId.length).toBeGreaterThan(0);
      expect(entry.promptVersion === null || typeof entry.promptVersion === 'number').toBe(true);
    }
  });

  it('WORKLOAD_PROMPT_VERSIONS only names real workloads (typo guard)', () => {
    for (const workload of Object.keys(WORKLOAD_PROMPT_VERSIONS)) {
      expect(Object.values(WORKLOADS)).toContain(workload);
    }
  });
});
