/**
 * Report Schedulers
 *
 * Four onSchedule Gen2 functions, one per cadence.
 * Each queries eligible users, checks thresholds, and fans out to the generator.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';
import { isPremium } from '../premium/index.js';
import { generateReport } from './generator.js';
import { computePeriod, THRESHOLDS } from './periodUtils.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const BATCH_SIZE = 5;

/**
 * Check if a user has sufficient data for report generation.
 */
export async function meetsDataThreshold(userId, cadence, periodStart, periodEnd) {
  const db = getFirestore();
  const userBase = `artifacts/${APP_COLLECTION_ID}/users/${userId}`;
  const threshold = THRESHOLDS[cadence];

  const snap = await db.collection(`${userBase}/entries`)
    .where('createdAt', '>=', periodStart)
    .where('createdAt', '<=', periodEnd)
    .select('createdAt')
    .get();

  if (snap.size < threshold.minEntries) return false;

  const uniqueDays = new Set();
  snap.forEach(doc => {
    const date = doc.data().createdAt?.toDate?.();
    if (date) uniqueDays.add(date.toISOString().slice(0, 10));
  });

  return uniqueDays.size >= threshold.minDays;
}

async function getAllUserIds(db) {
  const snap = await db.collection(`artifacts/${APP_COLLECTION_ID}/users`).select().get();
  return snap.docs.map(doc => doc.id);
}

async function runScheduler(cadence, requirePremium, apiKeyValue) {
  const db = getFirestore();
  const userIds = await getAllUserIds(db);
  const { periodStart, periodEnd } = computePeriod(cadence);

  console.log(`[scheduler] ${cadence}: checking ${userIds.length} users for period ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`);

  let generated = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (userId) => {
        // Premium check for non-weekly cadences
        if (requirePremium) {
          const premium = await isPremium(userId);
          if (!premium) { skipped++; return; }
        }

        // Threshold check
        const meets = await meetsDataThreshold(userId, cadence, periodStart, periodEnd);
        if (!meets) { skipped++; return; }

        await generateReport(userId, cadence, periodStart, periodEnd, apiKeyValue);
        generated++;
      })
    );

    // Log any failures
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        console.error(`[scheduler] ${cadence} failed for user ${batch[idx]}:`, r.reason?.message);
      }
    });
  }

  console.log(`[scheduler] ${cadence}: generated=${generated}, skipped=${skipped}`);
}

export const weeklyReportScheduler = onSchedule(
  { schedule: '0 9 * * 1', timeoutSeconds: 300, memory: '512MiB' },
  async () => runScheduler('weekly', false, null)
);

export const monthlyReportScheduler = onSchedule(
  { schedule: '0 6 1 * *', timeoutSeconds: 300, memory: '512MiB', secrets: [geminiApiKey] },
  async () => runScheduler('monthly', true, geminiApiKey.value())
);

export const quarterlyReportScheduler = onSchedule(
  { schedule: '0 6 1 1,4,7,10 *', timeoutSeconds: 300, memory: '512MiB', secrets: [geminiApiKey] },
  async () => runScheduler('quarterly', true, geminiApiKey.value())
);

export const annualReportScheduler = onSchedule(
  { schedule: '0 0 2 1 *', timeoutSeconds: 300, memory: '512MiB', secrets: [geminiApiKey] },
  async () => runScheduler('annual', true, geminiApiKey.value())
);
