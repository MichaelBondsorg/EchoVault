/**
 * Absence Pattern Detection Service
 *
 * Detects when positive entities stop appearing before mood drops.
 * Provides pre-emptive warnings to help users break negative cycles.
 *
 * Example insight: "You typically stop mentioning yoga 3 days before
 * a mood dip. Consider a session today?"
 */

/**
 * Compute absence patterns
 * Identifies when positive entities disappear before mood drops
 *
 * @param {Object[]} entries - All entries sorted by date
 * @param {Object[]} activityPatterns - Activity sentiment patterns from computeActivitySentiment
 * @param {string} category - Category filter
 * @param {Date} referenceDate - Reference date for "now" (defaults to current time, allows testing)
 * @returns {Object[]} Array of absence patterns
 */
export const computeAbsencePatterns = (entries, activityPatterns, category = null, referenceDate = new Date()) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;

  if (filtered.length < 10) {
    // Need sufficient history for meaningful patterns
    return [];
  }

  // Sort entries by date and pre-compute timestamps for O(1) access
  const sorted = [...filtered]
    .map(e => ({
      ...e,
      _timestamp: getEntryTimestamp(e)
    }))
    .sort((a, b) => a._timestamp - b._timestamp);

  // Get baseline mood
  const allMoods = sorted
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);

  if (allMoods.length < 5) return [];

  const baselineMood = allMoods.reduce((a, b) => a + b, 0) / allMoods.length;
  const moodDropThreshold = baselineMood - 0.15; // Significant drop below baseline

  // Find positive entities (things that boost mood)
  const positiveEntities = activityPatterns
    .filter(p => p.sentiment === 'positive' && p.entryCount >= 3 && p.moodDeltaPercent > 10);

  if (positiveEntities.length === 0) return [];

  // Find mood drop events with their indices for O(1) lookback
  const moodDropsWithIndex = sorted
    .map((e, index) => ({ entry: e, index }))
    .filter(({ entry }) => {
      const mood = entry.analysis?.mood_score;
      return mood !== null && mood !== undefined && mood < moodDropThreshold;
    });

  if (moodDropsWithIndex.length < 2) return [];

  const WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours in ms

  // For each positive entity, analyze absence before drops
  const absencePatterns = [];

  positiveEntities.forEach(entity => {
    const entityTag = entity.entity;
    let absenceBeforeDropCount = 0;
    let presenceBeforeDropCount = 0;

    moodDropsWithIndex.forEach(({ entry: dropEntry, index: dropIndex }) => {
      const dropTimestamp = dropEntry._timestamp;
      const windowStart = dropTimestamp - WINDOW_MS;

      // Optimized: Walk backwards from dropIndex instead of filtering entire array
      let mentionedInWindow = false;
      let hasEntriesInWindow = false;

      for (let i = dropIndex - 1; i >= 0; i--) {
        const entryTimestamp = sorted[i]._timestamp;

        // Stop if we've gone past the window start
        if (entryTimestamp < windowStart) break;

        hasEntriesInWindow = true;

        // Check if entity was mentioned
        if (sorted[i].tags?.includes(entityTag)) {
          mentionedInWindow = true;
          break; // Found mention, no need to continue
        }
      }

      if (!hasEntriesInWindow) return; // Skip if no entries in window

      if (mentionedInWindow) {
        presenceBeforeDropCount++;
      } else {
        absenceBeforeDropCount++;
      }
    });

    // Calculate correlation strength
    const totalDrops = absenceBeforeDropCount + presenceBeforeDropCount;
    if (totalDrops < 2) return;

    const absenceCorrelation = absenceBeforeDropCount / totalDrops;

    // Only report if absence correlates with drops > 50% of the time
    if (absenceCorrelation < 0.5) return;

    // Calculate hours since last mention (using referenceDate for testability)
    const lastMention = findLastMention(sorted, entityTag);
    const hoursSinceLastMention = lastMention
      ? (referenceDate.getTime() - lastMention._timestamp) / (1000 * 60 * 60)
      : null;

    // Generate insight
    const entityName = entityTag.split(':')[1]?.replace(/_/g, ' ');
    const correlationPercent = Math.round(absenceCorrelation * 100);

    let insight = null;
    let isActiveWarning = false;

    // If currently in a warning window (48-120 hours since last mention)
    if (hoursSinceLastMention !== null && hoursSinceLastMention > 48 && hoursSinceLastMention < 120) {
      insight = `It's been ${Math.round(hoursSinceLastMention / 24)} days since ${entityName}. Based on your patterns, this sometimes precedes a dip.`;
      isActiveWarning = true;
    } else {
      insight = `When ${entityName} goes quiet for 2-3 days, a mood dip follows ${correlationPercent}% of the time`;
    }

    absencePatterns.push({
      type: 'absence_warning',
      entity: entityTag,
      entityName,
      entityType: entityTag.split(':')[0].replace('@', ''),
      absenceCorrelation: Number(absenceCorrelation.toFixed(2)),
      correlationPercent,
      absenceBeforeDropCount,
      presenceBeforeDropCount,
      totalDropsAnalyzed: totalDrops,
      hoursSinceLastMention: hoursSinceLastMention ? Math.round(hoursSinceLastMention) : null,
      daysSinceLastMention: hoursSinceLastMention ? Number((hoursSinceLastMention / 24).toFixed(1)) : null,
      isActiveWarning,
      insight,
      message: insight,
      sentiment: isActiveWarning ? 'warning' : 'informational'
    });
  });

  // Sort by active warnings first, then by correlation strength
  return absencePatterns.sort((a, b) => {
    if (a.isActiveWarning && !b.isActiveWarning) return -1;
    if (!a.isActiveWarning && b.isActiveWarning) return 1;
    return b.absenceCorrelation - a.absenceCorrelation;
  });
};

/**
 * Get timestamp from entry (handles Firestore timestamps)
 * Returns milliseconds since epoch for efficient comparison
 */
const getEntryTimestamp = (entry) => {
  const dateField = entry.effectiveDate || entry.createdAt;
  if (dateField instanceof Date) return dateField.getTime();
  if (dateField?.toDate) return dateField.toDate().getTime();
  return 0;
};

/**
 * Find last mention of an entity in entries (with pre-computed timestamps)
 */
const findLastMention = (sortedEntries, entityTag) => {
  // Entries should be sorted ascending, so reverse to find most recent
  for (let i = sortedEntries.length - 1; i >= 0; i--) {
    if (sortedEntries[i].tags?.includes(entityTag)) {
      return sortedEntries[i];
    }
  }
  return null;
};

/**
 * Generate proactive absence warnings for dashboard display
 * Returns only currently-active warnings
 *
 * @param {Object[]} entries - All entries
 * @param {Object[]} activityPatterns - Activity sentiment patterns
 * @param {string} category - Category filter
 * @returns {Object[]} Active warnings only
 */
export const getActiveAbsenceWarnings = (entries, activityPatterns, category = null) => {
  const allPatterns = computeAbsencePatterns(entries, activityPatterns, category);
  return allPatterns.filter(p => p.isActiveWarning);
};

export default {
  computeAbsencePatterns,
  getActiveAbsenceWarnings
};
