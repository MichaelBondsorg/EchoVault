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
    const [analyticsData, nexusData, signalData, entriesData, healthData, model] = await Promise.all([
      readAnalytics(db, userBase),
      readNexusData(db, userBase),
      readSignalData(db, userBase, periodStart, periodEnd),
      readEntries(db, userBase, periodStart, periodEnd, cadence),
      readHealthData(db, userBase),
      isWeekly ? Promise.resolve(null) : getModel(db, 'insight'),
    ]);

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
    const categoryBreakdown = prepareCategoryBreakdown(analyticsData.categoryStats || {});
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
        ...analyticsData,
        moodTrend: moodTrend.map(p => p.value),
        entryCount: entriesData.length,
        filteredEntryCount,
      },
      signals: signalData,
      nexus: nexusData,
      health: healthData,
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
      sections = generateWeeklyTemplate(contextData.analytics, nexusData, entriesData);
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
      moodAvg: analyticsData.moodAvg || null,
      topInsights: (nexusData.insights || []).slice(0, 5).map(i => i.id || ''),
      topEntities: (analyticsData.topEntities || []).slice(0, 5),
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

// Note: Analytics are single-document aggregates (current snapshots), not period-scoped.
// The analytics layer (section-01) computes these from entries which are period-scoped.
async function readAnalytics(db, userBase) {
  try {
    const refs = ['topic_coverage', 'entry_stats', 'entity_activity'];
    const snaps = await Promise.all(
      refs.map(ref => db.doc(`${userBase}/analytics/${ref}`).get())
    );
    const data = {};
    for (let i = 0; i < refs.length; i++) {
      if (snaps[i].exists) Object.assign(data, snaps[i].data());
    }
    return data;
  } catch (e) {
    console.warn('[report] Failed to read analytics:', e.message);
    return {};
  }
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
 * No additional type-based filtering happens here beyond what the report
 * templates already do (generateWeeklyTemplate picks `insights[0]`;
 * buildSectionPrompt in narrative.js reads `.patterns`) — a PARALLEL R4
 * task is adding a risky-claims suppression gate at the orchestrator seam
 * (counterfactual / beliefDissonance / intervention-outcome /
 * personalized-recommendation claims), so by the time this doc is read,
 * `active` already reflects that gate. This function consumes `active`
 * exactly as written, with no hardcoded risky-type list of its own.
 *
 * `patterns` is the same array as `insights`: the real active-item shape
 * doesn't distinguish "pattern" vs "insight" docs (that split was an
 * artifact of the phantom by-type collection query this replaces).
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

    return { insights: active, patterns: active };
  } catch (e) {
    console.warn('[report] Failed to read nexus data:', e.message);
    return { insights: [], patterns: [] };
  }
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
      moodScore: typeof d.analysis?.mood_score === 'number' ? d.analysis.mood_score : null,
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
