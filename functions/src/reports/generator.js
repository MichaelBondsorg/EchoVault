/**
 * Report Generator Worker
 *
 * Core report generation logic. Called by the scheduler for each qualifying user.
 * Reads analytics, Nexus, signals, and entries data, then generates narrative
 * content and writes the completed report to Firestore.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';
import { generateWeeklyTemplate, generatePremiumNarrative } from './narrative.js';
import { prepareMoodTrend, prepareCategoryBreakdown, prepareEntryFrequency } from './charts.js';
import { filterForShareableContent } from './privacy.js';
import { getModel } from '../models/registry.js';
import { dismissalKeyFor } from './dismissalKey.js';

/**
 * Generate a report for a single user and period.
 * @param {string} userId
 * @param {'weekly'|'monthly'|'quarterly'|'annual'} cadence
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {string|null} geminiApiKeyValue - Gemini API key (null for weekly)
 * @returns {Promise<void>}
 */
export async function generateReport(userId, cadence, periodStart, periodEnd, geminiApiKeyValue) {
  const db = getFirestore();
  const userBase = `artifacts/${APP_COLLECTION_ID}/users/${userId}`;
  const reportId = `${cadence}-${periodStart.toISOString().slice(0, 10)}`;
  const reportRef = db.doc(`${userBase}/reports/${reportId}`);

  // Deduplication + initial status via transaction to prevent race conditions
  const existingRetryCount = await db.runTransaction(async (txn) => {
    const snap = await txn.get(reportRef);
    if (snap.exists && snap.data()?.status === 'ready') {
      return -1; // Already completed
    }
    if (snap.exists && snap.data()?.status === 'generating') {
      return -1; // Another process is generating
    }
    const retryCount = snap.exists ? (snap.data()?.retryCount || 0) : 0;
    txn.set(reportRef, {
      cadence,
      periodStart,
      periodEnd,
      generatedAt: FieldValue.serverTimestamp(),
      status: 'generating',
      retryCount,
      sections: [],
      metadata: {},
      notificationSent: false,
    }, { merge: true });
    return retryCount;
  });

  if (existingRetryCount === -1) {
    console.log(`[report] Skipping ${reportId} for ${userId}: already ready or generating`);
    return;
  }

  try {
    // Read all data in parallel. `model` is resolved once per report run
    // (registry, workload 'insight') for cadences that actually invoke the
    // narrative LLM. Weekly is template-only (zero LLM calls) — skip the
    // registry read entirely rather than resolving a model id that's never
    // invoked and would otherwise get stamped into metadata.model,
    // overstating what generated the report.
    const isWeekly = cadence === 'weekly';
    const [nexusData, signalData, entriesData, healthData, model, rankedVerifiedClaims] = await Promise.all([
      readNexusData(db, userBase),
      readSignalData(db, userBase, periodStart, periodEnd),
      readEntries(db, userBase, periodStart, periodEnd, cadence),
      readHealthData(db, userBase),
      isWeekly ? Promise.resolve(null) : getModel(db, 'insight'),
      readVerifiedClaims(db, userBase),
    ]);

    // REP-01 fix #1: period statistics derived deterministically from the
    // period-scoped entry set just read above — no global analytics
    // snapshot is read for report content at all (see derivePeriodStats's
    // doc comment for what this replaces and why).
    const periodStats = derivePeriodStats(entriesData);

    // REP-01 fix #2: split ranked verified claims by whether their evidence
    // window overlaps THIS report's period. `periodClaims` feeds "What held
    // up this period"; `currentClaims` feeds the separately-labeled
    // "Current verified insights (not period-specific)" section (see
    // splitClaimsByPeriodOverlap's doc comment for the overlap rule).
    const { periodClaims, currentClaims } = splitClaimsByPeriodOverlap(
      rankedVerifiedClaims, periodStart, periodEnd
    );

    // Prepare chart data. Entry-level mood (`e.moodScore` from readEntries,
    // below) is the 0-1 INTERNAL scale (analysis.mood_score — see
    // src/types/entries.d.ts). Sparkline/report display uses the 0-100
    // DISPLAY convention (mirrors src/services/experiments/computeResult.js's
    // normalizeMoodTo100 precedent) — that conversion happens explicitly
    // right here, the single boundary between "internal value" and
    // "displayed value" for this chart, never inferred from magnitude.
    // Nulls are filtered out BEFORE multiplying so a missing score can
    // never silently become a displayed 0.
    const moodTrend = prepareMoodTrend(
      entriesData
        .filter(e => e.moodScore != null)
        .map(e => ({ date: e.date, moodScore: e.moodScore * 100 })),
      cadence
    );
    const categoryBreakdown = prepareCategoryBreakdown(periodStats.categoryStats || {});
    const entryFrequency = prepareEntryFrequency(
      entriesData.map(e => ({ date: e.date })),
      cadence
    );

    // Safety filter: exclude crisis-flagged entries from AI narrative synthesis
    const safeEntries = filterForShareableContent(entriesData);
    const filteredEntryCount = safeEntries.length;

    // Build context for narrative generation (uses safe entries for AI input)
    const contextData = {
      entries: safeEntries,
      analytics: {
        ...periodStats,
        moodTrend: moodTrend.map(p => p.value),
        entryCount: entriesData.length,
        filteredEntryCount,
      },
      signals: signalData,
      nexus: nexusData,
      health: healthData,
      // Verified claims (P2-D6, split per REP-01 fix #2): `claims` is the
      // PERIOD-OVERLAPPING half — the ONLY source for the "What held up
      // this period" section and for the premium narrative's LLM prompt
      // context. `currentClaims` is the non-overlapping half, rendered only
      // via the separately-labeled "Current verified insights" section
      // (narrative.js's buildCurrentContextSection) — it never reaches the
      // LLM prompt. nexus prose (`nexus` above) feeds neither.
      claims: periodClaims,
      currentClaims,
    };

    // Generate sections
    let sections;
    if (cadence === 'weekly') {
      // Pass entriesData (unfiltered by crisis-safety, but already
      // exclusion-filtered by readEntries) so entryRefs receipts mirror
      // exactly what fed entryCount/moodTrend above. Crisis-flagged ids can
      // legitimately end up in entryRefs here — that's intentional: the
      // owner's personal in-app view shows their own flagged entries
      // (see privacy.js filterForPersonalView), and export/share paths
      // (pdfExport.applyRedactions) strip crisis-flagged entryRefs before
      // anything leaves the app.
      sections = generateWeeklyTemplate(contextData.analytics, nexusData, entriesData, periodClaims, currentClaims);
      // Attach mood chart data to the mood_trend section
      const moodSection = sections.find(s => s.id === 'mood_trend');
      if (moodSection) moodSection.chartData = { type: 'sparkline', data: moodTrend };
    } else {
      sections = await generatePremiumNarrative(cadence, contextData, geminiApiKeyValue, db);
    }

    // Attach chart data to first section if not already present
    if (sections.length > 0 && !sections[0].chartData) {
      sections[0].chartData = { moodTrend, categoryBreakdown, entryFrequency };
    }

    // Build metadata
    const sourceEntryIds = new Set(sections.flatMap(s => s.entryRefs || []));
    const metadata = {
      entryCount: entriesData.length,
      filteredEntryCount,
      // REP-01 fix #1: period-derived, not a global analytics snapshot —
      // see derivePeriodStats's doc comment.
      moodAvg: periodStats.moodAvg,
      // REP-01 fix #3: claim ids (claims-mode), never legacy Nexus insight
      // ids — this report pipeline has been claims-first since P2-D6 (the
      // "What held up this period" / premium-narrative pattern context both
      // already came exclusively from verified claims), but this metadata
      // field was never updated to match and kept stamping
      // `nexusData.insights` ids, an unrelated/legacy id space. Union of
      // both halves of the REP-01 overlap split (periodClaims +
      // currentClaims) — i.e. every claim this report actually surfaced
      // somewhere, whether in "held up" or "current context" — capped at 5
      // (both halves already partition a <=5 ranked list, so this slice is
      // a no-op safety net, not a real truncation). `[]` when there are no
      // verified claims at all.
      topInsights: [...periodClaims, ...currentClaims].slice(0, 5).map(c => c.id || ''),
      // No per-entry entity data is read for reports (readEntries doesn't
      // select it), and the global analytics/entity_activity current
      // snapshot is deliberately excluded from period report content per
      // REP-01 — see derivePeriodStats's doc comment. Honestly empty rather
      // than silently global.
      topEntities: [],
      // Scheduled reports are always all-spaces (ratified product decision
      // #3) — labeled explicitly so a future space-scoped report type can
      // never be silently confused with this one.
      scope: 'all_spaces',
      // Only cadences that actually invoke the narrative LLM stamp a model
      // id / prompt version — weekly's narrative has no prompt (template
      // output), so both are null rather than overstating provenance.
      model,
      promptVersion: isWeekly ? null : 1,
      // Distinct entries actually traceable via this report's receipts
      // (union of every section's entryRefs). Deliberately NOT the same as
      // entryCount: premium cadences only cite a small excerpt sample per
      // section, so this is usually smaller than entryCount/filteredEntryCount.
      sourceEntryCount: sourceEntryIds.size,
    };

    // Update report to ready
    await reportRef.update({
      status: 'ready',
      sections,
      metadata,
    });

    // Send notification
    try {
      const { sendNotification } = await import('../notifications/sender.js');
      await sendNotification(
        userId,
        { title: `Your ${cadence} report is ready`, body: `Check out your ${cadence} life report` },
        { type: 'report', reportId },
        { respectDeliveryWindow: true }
      );
      await reportRef.update({ notificationSent: true });
    } catch (notifError) {
      console.warn('[report] Notification failed (non-fatal):', notifError.message);
    }

    console.log(`[report] Generated ${reportId} for ${userId}`);
  } catch (error) {
    console.error(`[report] Failed to generate ${reportId} for ${userId}:`, error);
    await reportRef.update({ status: 'failed' }).catch(() => {});
  }
}

/**
 * REP-01 fix #1 — period statistics (moodAvg/categoryStats/topTheme/
 * topThemes) derived DETERMINISTICALLY from the period-scoped entry set
 * (the same rows `readEntries` returns, post source-exclusion filtering),
 * never from a global current-snapshot analytics doc.
 *
 * This REPLACES the previous `readAnalytics()`, which read the
 * `analytics/topic_coverage`, `analytics/entry_stats`, and
 * `analytics/entity_activity` docs and spread their raw fields into the
 * report context. Those documents are current, cross-period AGGREGATES —
 * `entry_stats` even nests its real per-period breakdown under
 * `periods.<periodKey>.*` (see `functions/src/analytics/onEntryAnalyzed.js`)
 * rather than exposing it at the top level `readAnalytics` read from — so
 * spreading them flat could never have been period-scoped even in
 * principle. In practice the report's own field names (`moodAvg`,
 * `categoryStats`, `topTheme`) did not exist at the top level of ANY of
 * those three docs, so the spread was always a silent no-op (every
 * consumer read `undefined`) — masking, rather than avoiding, the review's
 * finding. Re-generating a HISTORICAL report must reconcile to that
 * period's own entries, not to whatever the global docs say today; deriving
 * from `entries` (already period-scoped by `readEntries`'s Firestore query)
 * makes that true by construction. The `analytics/*` docs are no longer
 * read by the report pipeline at all.
 *
 * `moodAvg` here is on the 0-10 DISPLAY scale this report's narrative and
 * `metadata.moodAvg` use (`generateWeeklyTemplate`'s "avg X/10" bullet,
 * `src/components/reports/ReportViewer.jsx`'s `moodAvg.toFixed(1)}/10`) —
 * NOT the 0-100 scale `moodTrend`'s sparkline chartData uses (see this
 * function's `generateReport` caller for that separate, explicit
 * conversion). `entry.moodScore` is the 0-1 internal scale
 * (`analysis.mood_score`); this multiplies by 10, not 100.
 *
 * `topTheme`/`topThemes` are derived from entries' `category` field (the
 * only per-entry topic-like dimension `readEntries` currently selects —
 * entries do not carry per-entry `tags`/entities through this report's read
 * path) — the single most-frequent category in the period, and up to 5
 * categories ordered by frequency, respectively. `null`/`[]` when the
 * period has no entries.
 *
 * `topEntities` is intentionally NOT derived here (and metadata.topEntities
 * stays `[]` at the call site below): `readEntries` does not select
 * per-entry entity data, and the global `analytics/entity_activity` doc is
 * exactly the kind of current-snapshot source this fix removes from period
 * claims. Silently empty is more honest than silently global.
 *
 * @param {Array<{category: string, moodScore: number|null}>} entries
 * @returns {{moodAvg: number|null, categoryStats: Object<string, number>, topTheme: string|null, topThemes: string[]}}
 */
export function derivePeriodStats(entries) {
  const list = Array.isArray(entries) ? entries : [];

  const moodScores = list
    .map((e) => e.moodScore)
    .filter((m) => m != null);
  const moodAvg = moodScores.length > 0
    ? (moodScores.reduce((sum, m) => sum + m, 0) / moodScores.length) * 10
    : null;

  const categoryStats = {};
  for (const e of list) {
    const category = e.category || 'uncategorized';
    categoryStats[category] = (categoryStats[category] || 0) + 1;
  }

  const rankedCategories = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]);
  const topTheme = rankedCategories.length > 0 ? rankedCategories[0][0] : null;
  const topThemes = rankedCategories.slice(0, 5).map(([category]) => category);

  return { moodAvg, categoryStats, topTheme, topThemes };
}

/**
 * Read the user's Nexus insights singleton doc.
 *
 * Nexus persists exactly one document per user — `nexus/insights` —
 * shaped `{active: [...], history: [...], generatedAt, expiresAt, stale}`
 * (see src/services/nexus/orchestrator.js's `saveInsights`). The previous
 * implementation queried `${userBase}/nexus` as a BY-TYPE COLLECTION
 * (docs with `d.type === 'insight'|'pattern'`) — nothing is ever written
 * there, so that collection is phantom and this report's nexus inputs
 * were silently empty at HEAD (DR finding 8 / R4 Task 4). This reads the
 * real doc instead.
 *
 * Every item in `active` is guaranteed a `.receipt` by the orchestrator
 * (`applyReceiptDefaults`'s 100%-receipts invariant, R2 Task 8) before it
 * ever reaches `active`. This function does NOT re-filter on that — if the
 * invariant is ever violated upstream, that's a bug to surface loudly (see
 * the console.error below), not paper over by silently dropping insights
 * the report would otherwise show.
 *
 * No additional type-based filtering happens here. As of R4 Phase 2 (P2-D6)
 * this `active` data no longer feeds the narrative LLM prompt or the weekly
 * template's featured-insight pick — those seams now consume
 * `readVerifiedClaims` (below) instead — but this function and its
 * dismissal filtering stay for `metadata.topInsights` and any other
 * remaining non-prompt Nexus usage. A PARALLEL R4 task is adding a
 * risky-claims suppression gate at the orchestrator seam
 * (counterfactual / beliefDissonance / intervention-outcome /
 * personalized-recommendation claims), so by the time this doc is read,
 * `active` already reflects that gate. This function consumes `active`
 * exactly as written, with no hardcoded risky-type list of its own.
 *
 * `patterns` is the same array as `insights`: the real active-item shape
 * doesn't distinguish "pattern" vs "insight" docs (that split was an
 * artifact of the phantom by-type collection query this replaces).
 *
 * ## Dismissal filtering (R4 P0-closure Important 3)
 *
 * Before R4 P0-closure, this function read `active` straight off the doc —
 * a user's "Dismiss" action (`src/services/nexus/insightDismissal.js`,
 * `recordInsightDismissal`) durably filters that insight out of the
 * in-app view (`orchestrator.js`'s `getCachedInsights`), but this report
 * consumer never checked it, so a dismissed insight could recur in every
 * weekly report forever. This now reads the same
 * `nexus/insights/insight_engagement` subcollection T5 writes and filters
 * `active` by the SAME stable content-derived key
 * (`functions/src/reports/dismissalKey.js`'s `dismissalKeyFor`, a mirror of
 * the client's — see that module's doc comment for the sync-pair
 * rationale) rather than raw `.id`, so a churned-id resurfacing insight
 * with the SAME underlying content still filters correctly.
 *
 * Judgment call: a failure reading the dismissal subcollection does NOT
 * fail this function closed the way `readEntries`'s `source_exclusions`
 * read does. A dismissed insight resurfacing in one report is a UX wart
 * (mildly annoying, not a privacy leak — it's still the user's own data,
 * already shown to them once) whereas failing the whole report closed here
 * would silently blank every Nexus-derived section for that run. So this
 * degrades to UNFILTERED with a loud `console.warn` instead.
 */
export async function readNexusData(db, userBase) {
  try {
    const snap = await db.doc(`${userBase}/nexus/insights`).get();
    if (!snap.exists) return { insights: [], patterns: [] };
    const data = snap.data() || {};
    const active = Array.isArray(data.active) ? data.active : [];

    const missingReceipt = active.filter(i => !i?.receipt);
    if (missingReceipt.length > 0) {
      console.error(
        `[report] ${missingReceipt.length}/${active.length} active nexus insights are missing a receipt ` +
        `(the 100%-receipts invariant should guarantee every active insight has one) — including them unfiltered.`
      );
    }

    let dismissedKeys = new Set();
    try {
      const engagementSnap = await db.collection(`${userBase}/nexus/insights/insight_engagement`).get();
      engagementSnap.forEach((doc) => {
        const d = doc.data() || {};
        if (d.dismissed) dismissedKeys.add(d.dismissalKey || doc.id);
      });
    } catch (dismissalError) {
      console.warn(
        '[report] Failed to read insight dismissals — proceeding UNFILTERED ' +
        '(a dismissed insight resurfacing in a report is a UX wart, not a ' +
        'privacy breach; see readNexusData\'s doc comment):',
        dismissalError.message
      );
    }

    const filteredActive = dismissedKeys.size === 0
      ? active
      : active.filter((i) => !dismissedKeys.has(dismissalKeyFor(i)));

    return { insights: filteredActive, patterns: filteredActive };
  } catch (e) {
    console.warn('[report] Failed to read nexus data:', e.message);
    return { insights: [], patterns: [] };
  }
}

// Mirrors the Shared-contracts rankScore's ORDERING (the client-side
// `src/services/insights/claims/rankClaims.js` computes the same ordering
// for the in-app feed). Deliberately duplicated here rather
// than imported: this is a server package, ranking is presentational (not
// an integrity surface), and parity between the two is NOT required (see
// the R4 Phase 2 plan's self-review note under "Type consistency"). Ties
// broken by |effectMoodPoints| then createdAt (recency) descending.
const REPORT_CLAIM_TYPE_WEIGHT = { experiment_result: 3, pattern_to_watch: 2, observation: 1 };

function rankClaimsForReport(claims) {
  const createdAtMillis = (c) => {
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...claims].sort((a, b) => {
    const weightDiff = (REPORT_CLAIM_TYPE_WEIGHT[b.claimType] || 0) - (REPORT_CLAIM_TYPE_WEIGHT[a.claimType] || 0);
    if (weightDiff !== 0) return weightDiff;
    const effectDiff = Math.abs(b.evidence?.effectMoodPoints ?? 0) - Math.abs(a.evidence?.effectMoodPoints ?? 0);
    if (effectDiff !== 0) return effectDiff;
    return createdAtMillis(b) - createdAtMillis(a);
  });
}

/**
 * Read this user's verified, non-superseded insight claims for the report's
 * "What held up this period" section and the premium narrative's pattern
 * context (P2-D6). Claims live at `${userBase}/insight_claims` (Admin SDK —
 * no firestore.rules concern server-side).
 *
 * Only `status === 'verified'` AND not superseded
 * (`supersededByClaimId == null`, loose comparison mirroring the client's
 * `claimsService.js`/`claimsPipeline.js` precedent) claims are eligible — a
 * claim's own status is its complete suppression mechanism; unlike Nexus
 * insights, claims need no separate dismissal-key filter (see this file's
 * `readNexusData` doc comment for that contrast).
 *
 * Ranked by `rankClaimsForReport` (claimType weight, then |effectMoodPoints|,
 * then recency) and capped at 5, matching the Shared-contracts ranked-feed
 * cap.
 *
 * Read failure -> `[]` + `console.warn`, same posture as `readNexusData`:
 * the report must still generate. A missing/failed claims read degrades to
 * the explicit "no verified patterns this period" copy downstream (never a
 * silent nexus-prose fallback — see narrative.js).
 *
 * @param {object} db
 * @param {string} userBase
 * @returns {Promise<Array<object>>}
 */
export async function readVerifiedClaims(db, userBase) {
  try {
    const snap = await db.collection(`${userBase}/insight_claims`).get();
    const claims = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (d.status === 'verified' && d.supersededByClaimId == null) {
        claims.push({ id: doc.id, ...d });
      }
    });
    return rankClaimsForReport(claims).slice(0, 5);
  } catch (e) {
    console.warn('[report] Failed to read verified claims:', e.message);
    return [];
  }
}

/**
 * REP-01 fix #2 — the claim/report overlap rule (controller-ratified,
 * Michael veto): a verified claim is eligible for "What held up this
 * period" ONLY when its `receipt.timeWindow` overlaps the requested report
 * period. Documented threshold: ANY overlap qualifies — an inclusive-
 * endpoints interval-overlap test (`claimStart <= periodEnd && claimEnd >=
 * periodStart`). A claim whose window only touches a period boundary
 * (e.g. `claimEnd === periodStart`) still counts; there is no minimum-
 * duration/proportion requirement. (Also documented in
 * `docs/quality/trustworthy-capture-runbook.md`'s REP-01 line.)
 *
 * Source of truth: `claim.receipt.timeWindow` (`{start, end}` ISO strings —
 * `src/services/insights/receipts.js`'s `buildReceipt` shape, binding per
 * the R2 plan). `evidence.observedSpanDays` (claimSchema.js) was considered
 * as a secondary source (per the review's "(or evidence observedSpan)")
 * but is a bare DAY COUNT with no anchor date — it cannot itself answer
 * "does this window overlap THIS period" without also trusting some other
 * field for an end date, so it is not used here. A claim with a missing or
 * unparsable `receipt.timeWindow` fails CLOSED toward "does not overlap"
 * (never toward "overlaps") — it lands in the separately-labeled current-
 * context bucket (`splitClaimsByPeriodOverlap` below), never silently
 * attributed to a period it cannot be proven to cover.
 *
 * @param {object} claim
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {boolean}
 */
export function claimOverlapsPeriod(claim, periodStart, periodEnd) {
  const timeWindow = claim?.receipt?.timeWindow;
  const claimStartMs = timeWindow?.start ? Date.parse(timeWindow.start) : NaN;
  const claimEndMs = timeWindow?.end ? Date.parse(timeWindow.end) : NaN;
  if (!Number.isFinite(claimStartMs) || !Number.isFinite(claimEndMs)) return false;

  const periodStartMs = periodStart instanceof Date ? periodStart.getTime() : Date.parse(periodStart);
  const periodEndMs = periodEnd instanceof Date ? periodEnd.getTime() : Date.parse(periodEnd);
  if (!Number.isFinite(periodStartMs) || !Number.isFinite(periodEndMs)) return false;

  return claimStartMs <= periodEndMs && claimEndMs >= periodStartMs;
}

/**
 * REP-01 fix #2 — partitions ranked/capped verified claims (readVerifiedClaims's
 * output) into `periodClaims` (feed "What held up this period",
 * narrative.js's `buildHeldUpSection`) and `currentClaims` (feed the
 * separately-labeled "Current verified insights (not period-specific)"
 * section, narrative.js's `buildCurrentContextSection` — the review's
 * option 3, used here as the fallback that keeps a report from going
 * completely empty when nothing verified happens to overlap the period).
 * Both output arrays preserve `claims`' original (pre-ranked) relative
 * order — this only filters, it never re-sorts.
 * @param {Array<object>} claims - pre-ranked, capped verified claims
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {{periodClaims: Array<object>, currentClaims: Array<object>}}
 */
export function splitClaimsByPeriodOverlap(claims, periodStart, periodEnd) {
  const periodClaims = [];
  const currentClaims = [];
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (claimOverlapsPeriod(claim, periodStart, periodEnd)) periodClaims.push(claim);
    else currentClaims.push(claim);
  }
  return { periodClaims, currentClaims };
}

async function readSignalData(db, userBase, periodStart, periodEnd) {
  try {
    const snap = await db.collection(`${userBase}/signal_states`).get();
    const activeGoals = [];
    const achievedGoals = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.type !== 'goal') return;
      // Filter to signals active during the period
      const created = d.createdAt?.toDate?.() || d.createdAt;
      const updated = d.updatedAt?.toDate?.() || d.stateHistory?.[d.stateHistory.length - 1]?.timestamp?.toDate?.();
      if (periodStart && periodEnd && created) {
        // Include if created during period or state changed during period
        const inPeriod = created <= periodEnd && (!updated || updated >= periodStart);
        if (!inPeriod) return;
      }
      if (d.state === 'active') activeGoals.push({ id: doc.id, ...d });
      else if (d.state === 'achieved') achievedGoals.push({ id: doc.id, ...d });
    });
    return { activeGoals, achievedGoals };
  } catch (e) {
    console.warn('[report] Failed to read signal data:', e.message);
    return { activeGoals: [], achievedGoals: [] };
  }
}

/**
 * Thrown when the source_exclusions read fails inside readEntries(). Kept
 * distinct from a plain Error so it can be identified by name — see the
 * fail-closed handling below.
 */
export class ExclusionsReadError extends Error {
  constructor(cause) {
    super(`source_exclusions read failed: ${cause?.message || cause}`);
    this.name = 'ExclusionsReadError';
    this.cause = cause;
  }
}

// Exported for direct unit testing of the source_exclusions filter and
// entry shape; also used by generateReport above.
export async function readEntries(db, userBase, periodStart, periodEnd, cadence) {
  const limit = cadence === 'annual' ? 500 : cadence === 'quarterly' ? 200 : 100;

  // The entries read and the source_exclusions read (Task 8/10 client
  // concept, server-consumed here) are run in parallel but handled with
  // INDEPENDENT failure semantics:
  //   - an entries-read failure degrades to an empty period (unchanged
  //     behavior — a report with no entries is honest and harmless).
  //   - an exclusions-read failure must NOT silently produce a report as if
  //     no exclusions existed — that would leak entries the user asked to
  //     exclude, violating the "exclusions honored on regeneration" PRD
  //     acceptance criterion. So it's re-thrown as a distinct error
  //     (ExclusionsReadError) that propagates out of this function, through
  //     generateReport's `Promise.all(...)`, into its existing try/catch
  //     (below), which marks the report doc `status: 'failed'`. That doc is
  //     then picked up by the existing retryCount machinery: the
  //     top-of-function dedup transaction only skips docs whose status is
  //     'ready' or 'generating', so a 'failed' doc is retried on the next
  //     matching scheduler invocation; reportCleanup.js's
  //     cleanupStuckReports() separately escalates via retryCount if a
  //     report gets stuck. (If both reads fail, the exclusions failure
  //     takes precedence and throws — fail-closed wins over degrade-open.)
  //
  // Only appliesTo === 'all' exclusions drop an entry from reports
  // entirely — pattern-scoped exclusions (a specific signal/pattern type)
  // don't change what feeds a report, only what feeds pattern detection.
  const [entriesResult, exclusionsResult] = await Promise.allSettled([
    db.collection(`${userBase}/entries`)
      .where('createdAt', '>=', periodStart)
      .where('createdAt', '<=', periodEnd)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .get(),
    db.collection(`${userBase}/source_exclusions`).get(),
  ]);

  if (exclusionsResult.status === 'rejected') {
    console.error('[report] Failed to read source_exclusions — failing closed:', exclusionsResult.reason?.message);
    throw new ExclusionsReadError(exclusionsResult.reason);
  }

  if (entriesResult.status === 'rejected') {
    console.warn('[report] Failed to read entries:', entriesResult.reason?.message);
    return [];
  }

  const snap = entriesResult.value;
  const exclusionsSnap = exclusionsResult.value;

  const excludedIds = new Set();
  exclusionsSnap.forEach(doc => {
    const d = doc.data();
    if (d.appliesTo === 'all' && d.entryId) excludedIds.add(d.entryId);
  });

  const entries = [];
  snap.forEach(doc => {
    if (excludedIds.has(doc.id)) return;
    const d = doc.data();
    entries.push({
      id: doc.id,
      date: d.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || '',
      text: d.text || d.rawText || '',
      // mood_score lives at analysis.mood_score, 0-1 internal scale (see
      // src/types/entries.d.ts). This previously read camelCase
      // `moodScore` (analysis.moodScore / top-level moodScore) — a field
      // the app never writes — so report mood data was silently null at
      // HEAD (DR finding 8 / R4 Task 4). A doc that only has the legacy
      // camelCase field (no mood_score) is therefore treated as missing
      // here, not misread as a value: there is no camelCase fallback by
      // design. Kept as `moodScore` on this internal object (0-1 scale,
      // NOT a display value) for compatibility with existing consumers;
      // conversion to the 0-100 display convention happens explicitly at
      // each display site (see generateReport's moodTrend prep above).
      // Range-validated per the normalizeMoodTo100 precedent this file cites:
      // out-of-range / non-finite values are INVALID → null (missing), never
      // clamped or passed through to display (T4 review, Important).
      moodScore:
        typeof d.analysis?.mood_score === 'number' &&
        Number.isFinite(d.analysis.mood_score) &&
        d.analysis.mood_score >= 0 &&
        d.analysis.mood_score <= 1
          ? d.analysis.mood_score
          : null,
      category: d.classification?.category || d.category || 'uncategorized',
      safety_flagged: d.safety_flagged || false,
      has_warning_indicators: d.has_warning_indicators || false,
    });
  });
  return entries;
}

async function readHealthData(db, userBase) {
  try {
    const snap = await db.doc(`${userBase}/analytics/health_trends`).get();
    if (!snap.exists) return {};
    return snap.data();
  } catch (e) {
    console.warn('[report] Failed to read health data:', e.message);
    return {};
  }
}
