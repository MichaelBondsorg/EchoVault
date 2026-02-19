/**
 * Report Cleanup
 *
 * Scheduled function that runs every 15 minutes to detect and handle
 * reports stuck in "generating" status.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Find and handle stuck reports.
 * Uses collection group query on 'reports' where status === 'generating'.
 */
export async function cleanupStuckReports() {
  const db = getFirestore();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const snap = await db.collectionGroup('reports')
    .where('status', '==', 'generating')
    .where('generatedAt', '<', cutoff)
    .get();

  if (snap.empty) {
    console.log('[cleanup] No stuck reports found');
    return { cleaned: 0, retried: 0 };
  }

  let cleaned = 0;
  let retried = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const retryCount = data.retryCount || 0;

    if (retryCount >= 1) {
      // Give up - mark as permanently failed
      await doc.ref.update({ status: 'failed' });
      cleaned++;
    } else {
      // First failure - reset to allow retry by next scheduler run.
      // The scheduler's generateReport() skips only 'ready' or 'generating' reports,
      // so setting status to 'failed' with retryCount=1 allows the next matching
      // scheduler invocation to re-attempt generation for this period.
      await doc.ref.update({
        status: 'failed',
        retryCount: 1,
      });
      retried++;
    }
  }

  console.log(`[cleanup] Processed ${snap.size} stuck reports: cleaned=${cleaned}, retried=${retried}`);
  return { cleaned, retried };
}

export const reportCleanup = onSchedule(
  { schedule: '*/15 * * * *', timeoutSeconds: 60, memory: '256MiB' },
  async () => cleanupStuckReports()
);
