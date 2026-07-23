/**
 * rebuildInsights — Fix C (2026-07-24 brief) service tests.
 *
 * Boundary-mocked at each engine (generateBasicInsights / Nexus's
 * generateInsights / listActiveClaims / getExcludedEntryIds) — this suite
 * proves rebuildInsights.js's OWN orchestration contract (flag branching,
 * exclusion filtering, concurrency, result shape, error classification).
 * The deeper claims-pipeline mechanics this module triggers as a byproduct
 * of calling the real `generateBasicInsights` in production (expire /
 * supersede / no-churn-on-equivalent / suppression) are covered by
 * claimsPipeline.test.js and claimsService.test.js — not re-proven here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let insightClaimsFlag = false;
vi.mock('../../../config/flags', () => ({
  getFlag: vi.fn((name) => (name === 'insightClaims' ? insightClaimsFlag : false)),
}));

const generateBasicInsights = vi.fn();
vi.mock('../../basicInsights/basicInsightsOrchestrator', () => ({
  generateBasicInsights: (...a) => generateBasicInsights(...a),
}));

const generateInsights = vi.fn();
vi.mock('../../nexus/orchestrator', () => ({
  generateInsights: (...a) => generateInsights(...a),
}));

const listActiveClaims = vi.fn();
vi.mock('../claims/claimsService', () => ({
  listActiveClaims: (...a) => listActiveClaims(...a),
}));

const getExcludedEntryIds = vi.fn();
vi.mock('../sourceExclusions', () => ({
  getExcludedEntryIds: (...a) => getExcludedEntryIds(...a),
}));

const { rebuildInsights, describeRebuildResult } = await import('../rebuildInsights.js');

const DB = { __db: true };
const UID = 'user-1';

function entry(id, createdAt) {
  return { id, createdAt, content: 'entry text', analysis: { mood_score: 0.6 } };
}

const ENTRIES = [
  entry('e1', '2026-07-01T10:00:00.000Z'),
  entry('e2', '2026-07-02T10:00:00.000Z'),
  entry('e3', '2026-07-03T10:00:00.000Z'),
];

beforeEach(() => {
  vi.clearAllMocks();
  insightClaimsFlag = false;
  getExcludedEntryIds.mockResolvedValue(new Set());
  generateBasicInsights.mockResolvedValue({ success: true, insights: [{ id: 'b1' }] });
  generateInsights.mockResolvedValue({ success: true, insights: [{ id: 'n1' }, { id: 'n2' }] });
  listActiveClaims.mockResolvedValue([
    { id: 'c1', status: 'verified' },
    { id: 'c2', status: 'candidate' },
  ]);
});

describe('rebuildInsights — source exclusions', () => {
  it('filters excluded entries out of the pool passed to generateBasicInsights', async () => {
    getExcludedEntryIds.mockResolvedValue(new Set(['e2']));

    await rebuildInsights(DB, UID, ENTRIES);

    const poolPassed = generateBasicInsights.mock.calls[0][1];
    expect(poolPassed.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('does not filter when there are no exclusions', async () => {
    await rebuildInsights(DB, UID, ENTRIES);
    const poolPassed = generateBasicInsights.mock.calls[0][1];
    expect(poolPassed.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('fails closed (aborts, does not generate) when the exclusions read itself throws', async () => {
    getExcludedEntryIds.mockRejectedValue(new Error('firestore down'));

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(result.ok).toBe(false);
    expect(generateBasicInsights).not.toHaveBeenCalled();
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it('does not call getExcludedEntryIds a second time for the Nexus branch (Nexus filters its own exclusions internally)', async () => {
    await rebuildInsights(DB, UID, ENTRIES);
    expect(getExcludedEntryIds).toHaveBeenCalledTimes(1);
  });
});

describe('rebuildInsights — insightClaims OFF (legacy branch)', () => {
  it('regenerates Basic Insights AND Nexus, and does not read claims', async () => {
    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(generateBasicInsights).toHaveBeenCalledTimes(1);
    expect(generateInsights).toHaveBeenCalledTimes(1);
    expect(generateInsights).toHaveBeenCalledWith(UID);
    expect(listActiveClaims).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
    expect(result.engines.basic.ok).toBe(true);
    expect(result.engines.nexus.ok).toBe(true);
    expect(result.engines.claims).toBeUndefined();
    expect(result.verifiedClaimCount).toBe(0);
    expect(result.insightCount).toBe(3); // 1 basic + 2 nexus
  });

  it('reports per-engine failure without hiding it behind an overall success', async () => {
    generateInsights.mockResolvedValue({ success: false, errors: ['nexus boom'] });

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(result.ok).toBe(false);
    expect(result.engines.basic.ok).toBe(true);
    expect(result.engines.nexus.ok).toBe(false);
    expect(result.engines.nexus.error).toBe('nexus boom');
  });

  it('classifies a thrown exception by error class/name, never logging entry content', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateBasicInsights.mockRejectedValue(new TypeError('bad shape'));

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(result.engines.basic.ok).toBe(false);
    expect(result.engines.basic.error).toBe('TypeError');
    for (const call of consoleWarnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/entry text/);
    }
    consoleWarnSpy.mockRestore();
  });
});

describe('rebuildInsights — insightClaims ON (claims branch)', () => {
  beforeEach(() => {
    insightClaimsFlag = true;
  });

  it('runs Basic Insights (which contains the claims-pipeline hook) then re-reads listActiveClaims — never calls Nexus', async () => {
    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(generateBasicInsights).toHaveBeenCalledTimes(1);
    expect(generateInsights).not.toHaveBeenCalled();
    expect(listActiveClaims).toHaveBeenCalledWith(DB, UID);

    expect(result.ok).toBe(true);
    expect(result.engines.nexus).toBeUndefined();
    expect(result.engines.claims.ok).toBe(true);
    // Only status === 'verified' counts (mirrors useClaims' own filter).
    expect(result.verifiedClaimCount).toBe(1);
    expect(result.insightCount).toBe(1);
  });

  it('does not double-run the claims pipeline: generateBasicInsights is called exactly once', async () => {
    await rebuildInsights(DB, UID, ENTRIES);
    expect(generateBasicInsights).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a claims read when the basic engine itself failed (would only reflect stale data)', async () => {
    generateBasicInsights.mockResolvedValue({ success: false, error: 'boom' });

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(listActiveClaims).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.engines.claims.ok).toBe(false);
    expect(result.engines.claims.error).toBe('basic_engine_failed');
  });

  it('reports a claims-read failure as partial (basic succeeded, claims did not) rather than a full success', async () => {
    listActiveClaims.mockRejectedValue(new Error('read failed'));

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(result.engines.basic.ok).toBe(true);
    expect(result.engines.claims.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('treats insufficientData from the basic engine as a soft (non-error) success with zero counts', async () => {
    generateBasicInsights.mockResolvedValue({ success: false, insufficientData: true });
    listActiveClaims.mockResolvedValue([]);

    const result = await rebuildInsights(DB, UID, ENTRIES);

    expect(result.engines.basic.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.verifiedClaimCount).toBe(0);
  });

  it('RED: threads claims.ok === false from basicResult into claims engine result', async () => {
    insightClaimsFlag = true;
    generateBasicInsights.mockResolvedValue({
      success: true,
      insights: [{ id: 'b1' }],
      claims: { ok: false, error: 'Error' } // Claims failed during generation
    });

    const result = await rebuildInsights(DB, UID, ENTRIES);

    // Basic succeeded but claims failed during it
    expect(result.engines.basic.ok).toBe(true);
    expect(result.engines.claims.ok).toBe(false);
    expect(result.engines.claims.error).toBe('Error');
    expect(result.ok).toBe(false); // Partial failure
    expect(listActiveClaims).not.toHaveBeenCalled(); // Do not attempt read if basic's claims failed
  });

  it('RED: threads claims.ok === true from basicResult into claims engine result', async () => {
    insightClaimsFlag = true;
    generateBasicInsights.mockResolvedValue({
      success: true,
      insights: [{ id: 'b1' }],
      claims: { ok: true, written: 3, eligible: 5 } // Claims succeeded during generation
    });

    const result = await rebuildInsights(DB, UID, ENTRIES);

    // Basic succeeded and claims succeeded
    expect(result.engines.basic.ok).toBe(true);
    expect(result.engines.claims.ok).toBe(true);
    expect(listActiveClaims).toHaveBeenCalledWith(DB, UID);
  });
});

describe('rebuildInsights — dayCount', () => {
  it('counts distinct recorded days in the (exclusion-filtered) pool', async () => {
    const result = await rebuildInsights(DB, UID, ENTRIES);
    expect(result.dayCount).toBe(3);
  });

  it('excludes a source-excluded entry from the day count too', async () => {
    getExcludedEntryIds.mockResolvedValue(new Set(['e1', 'e2']));
    const result = await rebuildInsights(DB, UID, ENTRIES);
    expect(result.dayCount).toBe(1);
  });
});

describe('rebuildInsights — concurrency ("two rapid taps -> one run")', () => {
  it('returns the SAME in-flight promise for a second call with the same uid before the first resolves', async () => {
    let resolveBasic;
    generateBasicInsights.mockReturnValue(new Promise((resolve) => { resolveBasic = resolve; }));

    const first = rebuildInsights(DB, UID, ENTRIES);
    const second = rebuildInsights(DB, UID, ENTRIES);

    expect(second).toBe(first);

    resolveBasic({ success: true, insights: [] });
    await first;

    expect(generateBasicInsights).toHaveBeenCalledTimes(1);
    expect(generateInsights).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh run once the prior one has resolved', async () => {
    await rebuildInsights(DB, UID, ENTRIES);
    await rebuildInsights(DB, UID, ENTRIES);
    expect(generateBasicInsights).toHaveBeenCalledTimes(2);
  });

  it('does not share in-flight runs across different uids', async () => {
    let resolveBasic;
    generateBasicInsights.mockReturnValue(new Promise((resolve) => { resolveBasic = resolve; }));

    const first = rebuildInsights(DB, 'user-a', ENTRIES);
    const second = rebuildInsights(DB, 'user-b', ENTRIES);

    expect(second).not.toBe(first);
    resolveBasic({ success: true, insights: [] });
    await Promise.all([first, second]);
  });

  it('resolves immediately without touching any engine when uid is missing', async () => {
    const result = await rebuildInsights(DB, null, ENTRIES);
    expect(result.ok).toBe(false);
    expect(generateBasicInsights).not.toHaveBeenCalled();
  });
});

describe('describeRebuildResult', () => {
  it('renders the success-with-claims copy verbatim (brief template)', () => {
    const { tone, message } = describeRebuildResult({
      ok: true,
      engines: { basic: { ok: true }, claims: { ok: true, count: 3 } },
      dayCount: 12,
      verifiedClaimCount: 3,
      insightCount: 3,
    });
    expect(tone).toBe('success');
    expect(message).toBe('Insights rebuilt from 12 recorded days. 3 verified insights are available.');
  });

  it('renders the nothing-qualifies copy verbatim when the count is zero', () => {
    const { tone, message } = describeRebuildResult({
      ok: true,
      engines: { basic: { ok: true }, claims: { ok: true, count: 0 } },
      dayCount: 2,
      verifiedClaimCount: 0,
      insightCount: 0,
    });
    expect(tone).toBe('empty');
    expect(message).toBe('Rebuild complete. Nothing currently clears the evidence threshold.');
  });

  it('renders a partial-failure copy that names the failed engine without claiming full success', () => {
    const { tone, message } = describeRebuildResult({
      ok: false,
      engines: { basic: { ok: true }, nexus: { ok: false, error: 'boom' } },
      dayCount: 5,
      verifiedClaimCount: 0,
      insightCount: 2,
    });
    expect(tone).toBe('partial');
    // Uses display name instead of internal engine name
    expect(message).toMatch(/pattern insights/);
    expect(message).not.toMatch(/^Insights rebuilt from/);
  });

  it('renders the failure copy verbatim when every engine failed', () => {
    const { tone, message } = describeRebuildResult({
      ok: false,
      engines: { basic: { ok: false, error: 'boom' }, nexus: { ok: false, error: 'boom' } },
      dayCount: 0,
      verifiedClaimCount: 0,
      insightCount: 0,
    });
    expect(tone).toBe('failure');
    expect(message).toBe("We couldn't rebuild your insights. Your previous insights are still available.");
  });

  it('renders the failure copy for a null/undefined result (e.g. rebuildInsights itself threw)', () => {
    expect(describeRebuildResult(null).message).toBe(
      "We couldn't rebuild your insights. Your previous insights are still available."
    );
  });

  it('uses non-claims phrasing ("insights", not "verified insights") in the legacy branch', () => {
    const { message } = describeRebuildResult({
      ok: true,
      engines: { basic: { ok: true }, nexus: { ok: true } },
      dayCount: 4,
      verifiedClaimCount: 0,
      insightCount: 5,
    });
    expect(message).toBe('Insights rebuilt from 4 recorded days. 5 insights are available.');
  });

  it('RED: partial-failure message maps engine names to display names (claims → "verified insights", etc)', () => {
    const { message } = describeRebuildResult({
      ok: false,
      engines: { basic: { ok: true }, claims: { ok: false, error: 'boom' } },
      dayCount: 5,
      verifiedClaimCount: 0,
      insightCount: 0,
    });
    // Should use display names, not internal ones
    expect(message).toMatch(/verified insights/);
    expect(message).not.toMatch(/claims/);
  });

  it('RED: partial-failure message maps nexus and basic to display names in legacy branch', () => {
    const { message } = describeRebuildResult({
      ok: false,
      engines: { basic: { ok: false, error: 'boom' }, nexus: { ok: true } },
      dayCount: 5,
      verifiedClaimCount: 0,
      insightCount: 2,
    });
    // Should use display names
    expect(message).toMatch(/quick insights/);
    expect(message).not.toMatch(/basic/);
  });
});
