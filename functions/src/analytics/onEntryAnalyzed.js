/**
 * onEntryAnalyzed Cloud Function
 *
 * Firestore trigger that fires when an entry's analysisStatus changes to 'complete'.
 * Updates analytics documents: entry_stats, topic_coverage, entity_activity.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';

const HALF_LIFE_DAYS = 14;
const MAX_PROCESSED_IDS = 100;

const LIFE_DOMAINS = [
  'work', 'relationships', 'health', 'creativity',
  'spirituality', 'personal-growth', 'family', 'finances',
];

// Keyword sets for activity/goal domain classification
const HEALTH_KEYWORDS = ['exercise', 'running', 'gym', 'yoga', 'doctor', 'medical', 'therapy', 'sleep', 'workout', 'walk', 'swim', 'hike', 'meditation', 'fitness', 'diet', 'nutrition'];
const CREATIVITY_KEYWORDS = ['painting', 'drawing', 'writing', 'music', 'art', 'photography', 'design', 'craft', 'dance', 'poetry', 'singing', 'guitar', 'piano', 'sculpt', 'compose'];
const WORK_KEYWORDS = ['meeting', 'presentation', 'project', 'deadline', 'office', 'client', 'interview', 'report', 'email', 'conference', 'promotion', 'career', 'salary', 'manager', 'boss', 'colleague'];
const PERSONAL_GROWTH_KEYWORDS = ['learn', 'study', 'read', 'course', 'self-improvement', 'growth', 'habit', 'mindset', 'skill', 'goal', 'reflection', 'journal'];
const FINANCE_KEYWORDS = ['budget', 'invest', 'save', 'money', 'finance', 'debt', 'expense', 'income', 'tax', 'retirement'];
const SPIRITUALITY_KEYWORDS = ['pray', 'worship', 'church', 'temple', 'spiritual', 'faith', 'mindfulness', 'gratitude', 'soul', 'divine'];

function matchesKeywords(content, keywords) {
  if (!content) return false;
  const lower = content.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/**
 * Maps a tag to a life domain. Duplicated from frontend topicCoverage.js
 * because Cloud Functions cannot import from src/services/.
 */
export function mapTagToDomain(tag) {
  if (!tag || !tag.type) return null;

  switch (tag.type) {
    case 'person':
      return tag.category === 'family' ? 'family' : 'relationships';

    case 'activity': {
      const content = tag.content || '';
      if (matchesKeywords(content, HEALTH_KEYWORDS)) return 'health';
      if (matchesKeywords(content, CREATIVITY_KEYWORDS)) return 'creativity';
      if (matchesKeywords(content, WORK_KEYWORDS)) return 'work';
      return null;
    }

    case 'goal': {
      const content = tag.content || '';
      if (matchesKeywords(content, WORK_KEYWORDS)) return 'work';
      if (matchesKeywords(content, PERSONAL_GROWTH_KEYWORDS)) return 'personal-growth';
      return 'personal-growth';
    }

    default:
      return null;
  }
}

export function computeRecencyWeight(daysAgo) {
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

/**
 * Computes period keys for a given date across all cadences.
 * Returns { weekly, monthly, quarterly, annual } keys.
 */
export function getPeriodKeys(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + mondayOffset));
  const weekKey = `weekly-${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;

  const monthKey = `monthly-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

  const quarter = Math.floor(d.getUTCMonth() / 3);
  const quarterMonth = String(quarter * 3 + 1).padStart(2, '0');
  const quarterKey = `quarterly-${d.getUTCFullYear()}-${quarterMonth}-01`;

  const annualKey = `annual-${d.getUTCFullYear()}-01-01`;

  return { weekly: weekKey, monthly: monthKey, quarterly: quarterKey, annual: annualKey };
}

/**
 * Main handler for the onEntryAnalyzed trigger.
 * Called when an entry document is updated in Firestore.
 */
export async function handleEntryAnalyzed(event) {
  const { userId, appId, entryId } = event.params;

  if (appId !== APP_COLLECTION_ID) return null;

  const before = event.data.before.data();
  const after = event.data.after.data();

  // Guard: only fire when analysisStatus changes to 'complete'
  if (before.analysisStatus === 'complete' || after.analysisStatus !== 'complete') {
    return null;
  }

  const db = getFirestore();
  const analyticsPath = `artifacts/${APP_COLLECTION_ID}/users/${userId}/analytics`;
  const coverageRef = db.doc(`${analyticsPath}/topic_coverage`);

  // Extract data from analyzed entry
  const moodScore = after.analysis?.mood_score ?? after.localAnalysis?.mood_score ?? null;
  const category = after.localAnalysis?.category || after.category || 'personal';
  const entryType = after.localAnalysis?.entry_type || 'mixed';
  const entities = after.analysis?.entities || [];
  const tags = after.analysis?.tags || [];
  const createdAt = after.createdAt?.toDate?.() || new Date();

  const now = new Date();
  const daysAgo = Math.max(0, (now - createdAt) / (1000 * 60 * 60 * 24));
  const periodKeys = getPeriodKeys(createdAt);

  // Compute domains from tags before the transaction
  const weight = computeRecencyWeight(daysAgo);
  const entryDomains = new Set();
  for (const tag of tags) {
    const domain = mapTagToDomain(tag);
    if (domain) entryDomains.add(domain);
  }

  // Idempotency check + topic_coverage update in a single transaction
  const wasProcessed = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(coverageRef);
    const current = snap.exists ? snap.data() : {};
    const processedIds = current.processedEntryIds || [];

    // Idempotency: check inside transaction to prevent race conditions
    if (processedIds.includes(entryId)) {
      return true; // Already processed
    }

    const rawScores = current.rawScores || {};

    if (entryDomains.size > 0) {
      for (const domain of entryDomains) {
        if (!rawScores[domain]) {
          rawScores[domain] = { weightedCount: 0, entryIds: [] };
        }
        rawScores[domain].weightedCount += weight;
        rawScores[domain].entryIds.push(entryId);
        if (rawScores[domain].entryIds.length > MAX_PROCESSED_IDS) {
          rawScores[domain].entryIds = rawScores[domain].entryIds.slice(-MAX_PROCESSED_IDS);
        }
      }
    }

    // Normalize to domain scores
    let totalWeight = 0;
    for (const d of LIFE_DOMAINS) {
      totalWeight += rawScores[d]?.weightedCount || 0;
    }
    const domains = {};
    for (const d of LIFE_DOMAINS) {
      domains[d] = totalWeight > 0 ? (rawScores[d]?.weightedCount || 0) / totalWeight : 0;
    }

    // Maintain bounded processed entry ID set
    const updatedProcessedIds = [...processedIds, entryId];
    const trimmedIds = updatedProcessedIds.length > MAX_PROCESSED_IDS
      ? updatedProcessedIds.slice(-MAX_PROCESSED_IDS)
      : updatedProcessedIds;

    transaction.set(coverageRef, {
      domains,
      rawScores,
      processedEntryIds: trimmedIds,
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });

    return false; // Not previously processed
  });

  if (wasProcessed) {
    console.log(`Entry ${entryId} already processed, skipping`);
    return null;
  }

  console.log(`Processing analytics for entry ${entryId} (user ${userId})`);

  // 1. Update entry_stats with atomic increments
  const statsRef = db.doc(`${analyticsPath}/entry_stats`);
  const statsUpdates = {
    lastUpdated: FieldValue.serverTimestamp(),
  };

  for (const [, periodKey] of Object.entries(periodKeys)) {
    statsUpdates[`periods.${periodKey}.entryCount`] = FieldValue.increment(1);
    if (moodScore != null && !isNaN(moodScore)) {
      statsUpdates[`periods.${periodKey}.moodSum`] = FieldValue.increment(moodScore);
      statsUpdates[`periods.${periodKey}.moodCount`] = FieldValue.increment(1);
    }
    statsUpdates[`periods.${periodKey}.categoryBreakdown.${category}`] = FieldValue.increment(1);
    statsUpdates[`periods.${periodKey}.entryTypeDistribution.${entryType}`] = FieldValue.increment(1);
  }

  await statsRef.set(statsUpdates, { merge: true });

  // 3. Update entity_activity
  if (entities.length > 0) {
    const entityRef = db.doc(`${analyticsPath}/entity_activity`);
    const entityUpdates = {
      lastUpdated: FieldValue.serverTimestamp(),
    };

    for (const entity of entities) {
      const rawId = entity.id || entity.name?.toLowerCase().replace(/\s+/g, '-');
      if (!rawId) continue;
      // Sanitize entity ID: replace dots, slashes, brackets with hyphens
      const entityId = rawId.replace(/[.\/\[\]#$]/g, '-');

      entityUpdates[`entities.${entityId}.name`] = entity.name;
      entityUpdates[`entities.${entityId}.category`] = entity.category || entity.entityType || 'unknown';
      entityUpdates[`entities.${entityId}.mentionCount`] = FieldValue.increment(1);
      entityUpdates[`entities.${entityId}.lastMentionDate`] = FieldValue.serverTimestamp();
      entityUpdates[`entities.${entityId}.recencyScore`] = computeRecencyWeight(daysAgo);
    }

    await entityRef.set(entityUpdates, { merge: true });
  }

  console.log(`Analytics updated for entry ${entryId}: ${entryDomains.size} domains, ${entities.length} entities`);
  return { success: true, domains: [...entryDomains], entityCount: entities.length };
}
