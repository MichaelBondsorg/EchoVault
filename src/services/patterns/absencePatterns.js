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
 * @returns {Object[]} Array of absence patterns
 */
export const computeAbsencePatterns = (entries, activityPatterns, category = null) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;

  if (filtered.length < 10) {
    // Need sufficient history for meaningful patterns
    return [];
  }

  // Sort entries by date
  const sorted = [...filtered].sort((a, b) => {
    const dateA = a.effectiveDate || a.createdAt;
    const dateB = b.effectiveDate || b.createdAt;
    const timeA = dateA instanceof Date ? dateA.getTime() : dateA?.toDate?.()?.getTime() || 0;
    const timeB = dateB instanceof Date ? dateB.getTime() : dateB?.toDate?.()?.getTime() || 0;
    return timeA - timeB;
  });

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

  // Find mood drop events
  const moodDrops = sorted.filter(e => {
    const mood = e.analysis?.mood_score;
    return mood !== null && mood !== undefined && mood < moodDropThreshold;
  });

  if (moodDrops.length < 2) return [];

  // For each positive entity, analyze absence before drops
  const absencePatterns = [];

  positiveEntities.forEach(entity => {
    const entityTag = entity.entity;
    let absenceBeforeDropCount = 0;
    let presenceBeforeDropCount = 0;
    const absenceWindows = [];

    moodDrops.forEach(dropEntry => {
      const dropDate = getEntryDate(dropEntry);
      const windowStart = subtractHours(dropDate, 72); // 72 hours before drop

      // Get entries in the 72-hour window before the drop
      const windowEntries = sorted.filter(e => {
        const entryDate = getEntryDate(e);
        return entryDate >= windowStart && entryDate < dropDate;
      });

      if (windowEntries.length === 0) return; // Skip if no entries in window

      // Check if entity was mentioned in window
      const mentionedInWindow = windowEntries.some(e =>
        e.tags?.includes(entityTag)
      );

      if (mentionedInWindow) {
        presenceBeforeDropCount++;
      } else {
        absenceBeforeDropCount++;
        absenceWindows.push({
          dropDate,
          windowStart,
          entriesInWindow: windowEntries.length
        });
      }
    });

    // Calculate correlation strength
    const totalDrops = absenceBeforeDropCount + presenceBeforeDropCount;
    if (totalDrops < 2) return;

    const absenceCorrelation = absenceBeforeDropCount / totalDrops;

    // Only report if absence correlates with drops > 50% of the time
    if (absenceCorrelation < 0.5) return;

    // Calculate hours since last mention
    const lastMention = findLastMention(sorted, entityTag);
    const hoursSinceLastMention = lastMention
      ? (Date.now() - getEntryDate(lastMention).getTime()) / (1000 * 60 * 60)
      : null;

    // Generate insight
    const entityName = entityTag.split(':')[1]?.replace(/_/g, ' ');
    const correlationPercent = Math.round(absenceCorrelation * 100);

    let insight = null;
    let isActiveWarning = false;

    // If currently in a warning window (48-96 hours since last mention)
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
 * Get date from entry (handles Firestore timestamps)
 */
const getEntryDate = (entry) => {
  const dateField = entry.effectiveDate || entry.createdAt;
  return dateField instanceof Date ? dateField : dateField?.toDate?.() || new Date();
};

/**
 * Subtract hours from a date
 */
const subtractHours = (date, hours) => {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
};

/**
 * Find last mention of an entity in entries
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
