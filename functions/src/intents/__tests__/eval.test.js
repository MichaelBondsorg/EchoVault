/**
 * Activation-policy eval gate (PRD 0B, plan task I3).
 *
 * The hard-negative fixtures are the product's trust contract: every one of
 * them must be STRUCTURALLY INCAPABLE of going active. This suite fails the
 * build if any hard-negative activates, or if active precision drops below 1.0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { evaluate, normalizeFixtureCandidate } from '../__evals__/runEval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDoc = JSON.parse(readFileSync(path.join(__dirname, '../__evals__/fixtures.json'), 'utf8'));
const fixtures = fixturesDoc.fixtures;

describe('activation-policy eval harness', () => {
  const report = evaluate(fixtures);

  it('has a fixture set of at least 60 labeled examples', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(60);
  });

  it('covers >= 30 hard-negatives and >= 20 active positives', () => {
    const hardNegatives = fixtures.filter((f) => f.hardNegative === true);
    const positives = fixtures.filter((f) => f.expectedState === 'active');
    expect(hardNegatives.length).toBeGreaterThanOrEqual(30);
    expect(positives.length).toBeGreaterThanOrEqual(20);
  });

  it('NO hard-negative fixture ever lands active (the trust contract)', () => {
    expect(report.activeMisfires).toEqual([]);
  });

  it('every hard-negative is structurally non-active (abstain or suggested-never-active)', () => {
    for (const fx of fixtures.filter((f) => f.hardNegative === true)) {
      const { state } = { state: report.results.find((r) => r.id === fx.id).actual };
      expect(state).not.toBe('active');
    }
  });

  it('active precision is exactly 1.0 on the fixture set', () => {
    expect(report.activePrecision).toBe(1.0);
  });

  it('recalls every labeled active positive (recall 1.0)', () => {
    expect(report.activeRecall).toBe(1.0);
  });

  it('produces a per-category breakdown', () => {
    expect(Object.keys(report.perCategory).length).toBeGreaterThan(5);
    for (const stats of Object.values(report.perCategory)) {
      expect(stats.total).toBeGreaterThan(0);
    }
  });

  it('the normalizer fills omitted attributes as strict false', () => {
    const c = normalizeFixtureCandidate({ kind: 'task', attributes: { agency: true } });
    expect(c.attributes.agency).toBe(true);
    expect(c.attributes.concrete).toBe(false);
    expect(c.explicitCommand).toBe(false);
    expect(c.targetAt).toBeNull();
  });
});
