/**
 * `scripts/check-bundle-budget.js` — PERF-01 bundle budget gate.
 *
 * The script's own I/O (reading dist/index.html, statting the entry chunk)
 * is exercised for real by `npm run build` itself — that's the actual
 * end-to-end check. What's unit-testable in isolation is the pure decision
 * logic: which script tag counts as "the entry", and the pass/fail boundary
 * against the budget (including the exactly-at-budget edge, which is easy
 * to get backwards with a stray `<` vs `<=`).
 */
import { describe, it, expect } from 'vitest';
import { findEntryScriptSrc, evaluateBudget, BUDGET_BYTES } from '../check-bundle-budget.js';

describe('findEntryScriptSrc', () => {
  it('finds the single module script src', () => {
    const html = `
      <html><head>
        <script type="module" crossorigin src="/assets/index-BlDmqzu3.js"></script>
        <script src="/boot-theme.js"></script>
      </head></html>
    `;
    expect(findEntryScriptSrc(html)).toBe('/assets/index-BlDmqzu3.js');
  });

  it('ignores non-module scripts entirely', () => {
    const html = `<script src="/boot-theme.js"></script><script type="module" src="/assets/entry-abc.js"></script>`;
    expect(findEntryScriptSrc(html)).toBe('/assets/entry-abc.js');
  });

  it('throws when no module script is present', () => {
    const html = `<script src="/boot-theme.js"></script>`;
    expect(() => findEntryScriptSrc(html)).toThrow(/No <script type="module"/);
  });

  it('throws when more than one module script is present', () => {
    const html = `
      <script type="module" src="/assets/a.js"></script>
      <script type="module" src="/assets/b.js"></script>
    `;
    expect(() => findEntryScriptSrc(html)).toThrow(/exactly one entry module script/);
  });
});

describe('evaluateBudget', () => {
  it('passes when strictly under budget', () => {
    const result = evaluateBudget(500_000, 900_000);
    expect(result.pass).toBe(true);
    expect(result.overBytes).toBe(0);
  });

  it('passes exactly at budget (boundary is inclusive)', () => {
    const result = evaluateBudget(900_000, 900_000);
    expect(result.pass).toBe(true);
    expect(result.overBytes).toBe(0);
  });

  it('fails one byte over budget and reports the overage', () => {
    const result = evaluateBudget(900_001, 900_000);
    expect(result.pass).toBe(false);
    expect(result.overBytes).toBe(1);
  });

  it('fails by the full delta when far over budget', () => {
    const result = evaluateBudget(1_035_674, 900_000);
    expect(result.pass).toBe(false);
    expect(result.overBytes).toBe(135_674);
  });

  it('documents the current budget stays a five-figure-plus byte count', () => {
    // Guards against an accidental unit slip (e.g. someone "fixing" the
    // constant to KiB) silently making the gate pass/fail everything.
    expect(BUDGET_BYTES).toBeGreaterThan(100_000);
    expect(BUDGET_BYTES).toBeLessThan(2_000_000);
  });
});
