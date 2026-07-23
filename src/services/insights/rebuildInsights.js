/**
 * rebuildInsights — Fix C (2026-07-24 brief): one safe, non-destructive
 * "Rebuild insights" orchestration.
 *
 * Before this module, four surfaces each rebuilt a different subset of the
 * insight engines (InsightsPage's top refresh: Nexus only via
 * useNexusInsights.refresh; Quick Insights: useBasicInsights.regenerate;
 * ClaimFeed: a re-read of insight_claims that never reran the pipeline;
 * Insight Control Center's "Recompute now": generateInsights -> Nexus
 * only). This module is the single orchestration contract every one of
 * those call sites now routes through.
 *
 * ---------------------------------------------------------------------
 * Active-engine behavior (brief, "Fix C")
 * ---------------------------------------------------------------------
 *   insightClaims === true:
 *     1. Run Basic Insights regeneration over the current,
 *        source-exclusion-filtered entry pool. `generateBasicInsights`
 *        already runs the claims-pipeline hook internally when the flag is
 *        on (see basicInsightsOrchestrator.js) — this module does NOT call
 *        `generateClaims` a second time; doing so would double-register
 *        candidates in `testing_ledger` (registerCandidates is
 *        count-before-analyze) and corrupt the multiple-testing
 *        correction. One basicInsights call == exactly one claims-pipeline
 *        run.
 *     2. Re-read `listActiveClaims` and filter to `status === 'verified'`
 *        for the reported count (same contract `useClaims` uses).
 *   insightClaims === false:
 *     1. Regenerate Basic Insights over the source-exclusion-filtered pool.
 *     2. Regenerate Nexus (`generateInsights` — it reads/filters its own
 *        entries and exclusions internally; no entries are threaded in).
 *
 * ---------------------------------------------------------------------
 * Source exclusions (brief: "excluded from every engine")
 * ---------------------------------------------------------------------
 * Traced per engine before writing this module:
 *   - `generateBasicInsights` (basicInsightsOrchestrator.js) does NOT
 *     filter source_exclusions itself — its existing callers
 *     (`useBasicInsights.regenerateInsights`) filter before calling it.
 *     This module follows that same convention: reads
 *     `getExcludedEntryIds` once and filters the pool BEFORE calling
 *     `generateBasicInsights`.
 *   - `generateClaims` (claimsPipeline.js) filters source_exclusions (plus
 *     family-scoped 'wrong_source' exclusions) itself, independently, from
 *     whatever `entries` it's handed — a second, idempotent filter over an
 *     already-filtered pool. Harmless; not this module's seam to own.
 *   - Nexus's `generateInsights` reads and filters exclusions itself
 *     (fail-closed, no entries param taken at all) — nothing to thread
 *     through from here.
 *
 * ---------------------------------------------------------------------
 * Never blank caches first
 * ---------------------------------------------------------------------
 * Every generator this module calls already writes-after-compute
 * (`saveBasicInsights`, Nexus's `saveInsights`) and this module calls no
 * invalidate/delete path of its own — a thrown error here leaves whatever
 * cache doc already existed untouched, satisfying "a failed rebuild leaves
 * the prior usable feed in place" without any bespoke rollback logic.
 *
 * ---------------------------------------------------------------------
 * Concurrency (brief: "two rapid taps -> one run")
 * ---------------------------------------------------------------------
 * One in-flight promise per uid, held at MODULE scope (not inside a hook
 * closure) so every call site — page header, ClaimFeed, Quick Insights,
 * Insight Control Center — shares the same in-flight run for that uid,
 * regardless of which component triggered it first.
 *
 * ---------------------------------------------------------------------
 * Logging
 * ---------------------------------------------------------------------
 * Metadata only: engine name, duration, result counts, error class. Never
 * entry text, claim wording, or health values.
 */
import { getFlag } from '../../config/flags';
import { generateBasicInsights } from '../basicInsights/basicInsightsOrchestrator';
import { generateInsights as generateNexusInsights } from '../nexus/orchestrator';
import { listActiveClaims } from './claims/claimsService';
import { getExcludedEntryIds } from './sourceExclusions';
import { buildDailyObservations } from './observations';

// Module-level in-flight promise per uid — see "Concurrency" above.
const inFlightByUid = new Map();

const FAILURE_MESSAGE = "We couldn't rebuild your insights. Your previous insights are still available.";
const EMPTY_MESSAGE = 'Rebuild complete. Nothing currently clears the evidence threshold.';

// Map internal engine names to user-facing display names (used in partial-failure messages)
const ENGINE_DISPLAY_NAMES = {
  claims: 'verified insights',
  basic: 'quick insights',
  nexus: 'pattern insights'
};

function errorClassOf(error) {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}

async function runBasicEngine(uid, poolEntries) {
  const startedAt = Date.now();
  try {
    const result = await generateBasicInsights(uid, poolEntries);
    const durationMs = Date.now() - startedAt;
    if (result?.success) {
      return {
        ok: true,
        insightCount: result.insights?.length ?? 0,
        durationMs,
        ...(result.claims && { claims: result.claims })
      };
    }
    if (result?.insufficientData) {
      // Not an error — the pool genuinely doesn't clear the minimum-entries
      // bar yet. Brief's "nothing qualifies" state, not "failure".
      return { ok: true, insightCount: 0, insufficientData: true, durationMs };
    }
    return { ok: false, error: result?.error || 'basic_insights_failed', durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn('[rebuildInsights] basic engine failed', { errorClass: errorClassOf(error), durationMs });
    return { ok: false, error: errorClassOf(error), durationMs };
  }
}

async function runNexusEngine(uid) {
  const startedAt = Date.now();
  try {
    const result = await generateNexusInsights(uid);
    const durationMs = Date.now() - startedAt;
    if (result?.success) {
      return { ok: true, insightCount: result.insights?.length ?? 0, durationMs };
    }
    return { ok: false, error: result?.errors?.[0] || 'nexus_failed', durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn('[rebuildInsights] nexus engine failed', { errorClass: errorClassOf(error), durationMs });
    return { ok: false, error: errorClassOf(error), durationMs };
  }
}

async function runClaimsRead(db, uid) {
  try {
    const active = await listActiveClaims(db, uid);
    const count = active.filter((c) => c.status === 'verified').length;
    return { ok: true, count };
  } catch (error) {
    console.warn('[rebuildInsights] claims read failed', { errorClass: errorClassOf(error) });
    return { ok: false, error: errorClassOf(error), count: 0 };
  }
}

async function doRebuild(db, uid, entries, options = {}) {
  const startedAt = options.now || Date.now();
  const insightClaims = getFlag('insightClaims');
  console.log('[rebuildInsights] start', {
    engine: insightClaims ? 'claims' : 'legacy',
    entryCount: entries?.length ?? 0,
  });

  // Source exclusions: read ONCE here for the basicInsights pool (see
  // module doc comment for why this is the correct seam). Fail-closed —
  // mirrors the Nexus orchestrator / claims-pipeline precedent: a failed
  // exclusions read must never silently generate over the unfiltered pool.
  let poolEntries = entries || [];
  try {
    const excludedIds = await getExcludedEntryIds(db, uid);
    if (excludedIds.size > 0) {
      poolEntries = poolEntries.filter((e) => !excludedIds.has(e?.id || e?.entryId));
    }
  } catch (error) {
    console.warn('[rebuildInsights] exclusions read failed; aborting rebuild', { errorClass: errorClassOf(error) });
    return {
      ok: false,
      engines: { basic: { ok: false, error: 'exclusions_read_failed' } },
      dayCount: 0,
      verifiedClaimCount: 0,
      insightCount: 0,
    };
  }

  const dayCount = buildDailyObservations(poolEntries).length;
  const engines = {};

  const basicResult = await runBasicEngine(uid, poolEntries);
  engines.basic = { ok: basicResult.ok, error: basicResult.error, insightCount: basicResult.insightCount };

  let result;
  if (insightClaims) {
    // The claims-pipeline hook lives INSIDE generateBasicInsights and only
    // runs after a successful compute. Check the basicResult.claims outcome
    // (captured by the hook) to determine if the hook succeeded or failed.
    let claimsOutcome;
    if (!basicResult.ok) {
      // Basic engine failed, so hook never ran
      claimsOutcome = { ok: false, error: 'basic_engine_failed', count: 0 };
    } else if (basicResult.claims?.ok === false) {
      // Hook ran but failed — report that failure directly
      claimsOutcome = basicResult.claims;
    } else {
      // Hook succeeded (or isn't tracked), run standard post-generation claims read
      claimsOutcome = await runClaimsRead(db, uid);
    }

    engines.claims = {
      ok: claimsOutcome.ok,
      error: claimsOutcome.error,
      count: claimsOutcome.count
    };
    const verifiedClaimCount = claimsOutcome.count || 0;
    result = {
      ok: basicResult.ok && claimsOutcome.ok,
      engines,
      dayCount,
      verifiedClaimCount,
      insightCount: verifiedClaimCount,
    };
  } else {
    const nexusResult = await runNexusEngine(uid);
    engines.nexus = { ok: nexusResult.ok, error: nexusResult.error, insightCount: nexusResult.insightCount };
    const insightCount = (basicResult.insightCount || 0) + (nexusResult.insightCount || 0);
    result = {
      ok: basicResult.ok && nexusResult.ok,
      engines,
      dayCount,
      verifiedClaimCount: 0,
      insightCount,
    };
  }

  console.log('[rebuildInsights] complete', {
    ok: result.ok,
    engine: insightClaims ? 'claims' : 'legacy',
    durationMs: Date.now() - startedAt,
    dayCount: result.dayCount,
    resultCount: result.insightCount,
  });

  return result;
}

/**
 * Rebuild the currently-active insight engine(s) for `uid`. See module doc
 * comment for the full flag-branch contract.
 *
 * Concurrency: one in-flight run per uid. A second call for the SAME uid
 * while a run is already in progress returns the SAME promise — it does
 * not start a second run (brief: "two rapid taps -> one run").
 *
 * @param {object} db
 * @param {string} uid
 * @param {Array} entries
 * @param {{now?: number}} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   engines: {
 *     basic: {ok: boolean, error?: string, insightCount?: number},
 *     nexus?: {ok: boolean, error?: string, insightCount?: number},
 *     claims?: {ok: boolean, error?: string, count?: number},
 *   },
 *   dayCount: number,
 *   verifiedClaimCount: number,
 *   insightCount: number,
 * }>}
 */
export function rebuildInsights(db, uid, entries, options = {}) {
  if (!uid) {
    return Promise.resolve({
      ok: false,
      engines: { basic: { ok: false, error: 'no_uid' } },
      dayCount: 0,
      verifiedClaimCount: 0,
      insightCount: 0,
    });
  }

  const existing = inFlightByUid.get(uid);
  if (existing) return existing;

  const run = doRebuild(db, uid, entries, options).finally(() => {
    inFlightByUid.delete(uid);
  });
  inFlightByUid.set(uid, run);
  return run;
}

/**
 * Turn a `rebuildInsights` result into the brief's four result-state
 * copies. Exported so every call site (InsightsPage, Insight Control
 * Center) renders the SAME copy from the SAME contract rather than each
 * inventing its own phrasing.
 *
 * `insightClaims` mode is detected from `result.engines.claims` being
 * present (rather than re-reading the flag here) — this function is a pure
 * formatter over whatever `rebuildInsights` actually reported.
 *
 * @param {Awaited<ReturnType<typeof rebuildInsights>>|null} result
 * @returns {{tone: 'success'|'empty'|'partial'|'failure', message: string}}
 */
export function describeRebuildResult(result) {
  if (!result) {
    return { tone: 'failure', message: FAILURE_MESSAGE };
  }

  const engines = result.engines || {};
  const engineNames = Object.keys(engines);
  const failedEngines = engineNames.filter((name) => engines[name]?.ok === false);

  if (engineNames.length > 0 && failedEngines.length === engineNames.length) {
    return { tone: 'failure', message: FAILURE_MESSAGE };
  }

  if (failedEngines.length > 0) {
    const displayNames = failedEngines.map(name => ENGINE_DISPLAY_NAMES[name] || name);
    return {
      tone: 'partial',
      message: `Rebuild partially completed — ${displayNames.join(' and ')} couldn't finish. Your previous insights for that engine are still current.`,
    };
  }

  const isClaimsMode = 'claims' in engines;
  const count = isClaimsMode ? (result.verifiedClaimCount || 0) : (result.insightCount || 0);

  if (count === 0) {
    return { tone: 'empty', message: EMPTY_MESSAGE };
  }

  const dayCount = result.dayCount || 0;
  const dayNoun = `${dayCount} recorded day${dayCount === 1 ? '' : 's'}`;
  const insightNoun = isClaimsMode
    ? `${count} verified insight${count === 1 ? '' : 's'}`
    : `${count} insight${count === 1 ? '' : 's'}`;
  const verb = count === 1 ? 'is' : 'are';

  return {
    tone: 'success',
    message: `Insights rebuilt from ${dayNoun}. ${insightNoun} ${verb} available.`,
  };
}

export default rebuildInsights;
