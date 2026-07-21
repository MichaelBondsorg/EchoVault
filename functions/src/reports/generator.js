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
    // (registry, workload 'insight') regardless of cadence — weekly's
    // template path doesn't call an LLM, but the metadata schema stays
    // consistent across all cadences (mirrors the analysis orchestrator's
    // "resolve once, stamp regardless of which branch used it" convention).
    const [analyticsData, nexusData, signalData, entriesData, healthData, model] = await Promise.all([
      readAnalytics(db, userBase),
      readNexusData(db, userBase, periodStart, periodEnd),
      readSignalData(db, userBase, periodStart, periodEnd),
      readEntries(db, userBase, periodStart, periodEnd, cadence),
      readHealthData(db, userBase),
      getModel(db, 'insight'),
    ]);

    // Prepare chart data
    const moodTrend = prepareMoodTrend(
      entriesData.map(e => ({ date: e.date, moodScore: e.moodScore })).filter(e => e.moodScore != null),
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
      model,
      promptVersion: 1,
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

async function readNexusData(db, userBase, periodStart, periodEnd) {
  try {
    let query = db.collection(`${userBase}/nexus`);
    // Period-scope if timestamps available
    if (periodStart && periodEnd) {
      query = query.where('createdAt', '>=', periodStart)
                   .where('createdAt', '<=', periodEnd);
    }
    const snap = await query.limit(30).get();
    const insights = [];
    const patterns = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.type === 'insight') insights.push({ id: doc.id, ...d });
      else if (d.type === 'pattern') patterns.push({ id: doc.id, ...d });
    });
    return { insights, patterns };
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

// Exported for direct unit testing of the source_exclusions filter and
// entry shape; also used by generateReport above.
export async function readEntries(db, userBase, periodStart, periodEnd, cadence) {
  try {
    const limit = cadence === 'annual' ? 500 : cadence === 'quarterly' ? 200 : 100;
    // One extra collection read per report run for source_exclusions
    // (Task 8/10 client concept, server-consumed here). Only
    // appliesTo === 'all' exclusions drop an entry from reports entirely —
    // pattern-scoped exclusions (a specific signal/pattern type) don't
    // change what feeds a report, only what feeds pattern detection.
    const [snap, exclusionsSnap] = await Promise.all([
      db.collection(`${userBase}/entries`)
        .where('createdAt', '>=', periodStart)
        .where('createdAt', '<=', periodEnd)
        .orderBy('createdAt', 'asc')
        .limit(limit)
        .get(),
      db.collection(`${userBase}/source_exclusions`).get(),
    ]);

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
        moodScore: d.analysis?.moodScore ?? d.moodScore ?? null,
        category: d.classification?.category || d.category || 'uncategorized',
        safety_flagged: d.safety_flagged || false,
        has_warning_indicators: d.has_warning_indicators || false,
      });
    });
    return entries;
  } catch (e) {
    console.warn('[report] Failed to read entries:', e.message);
    return [];
  }
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
