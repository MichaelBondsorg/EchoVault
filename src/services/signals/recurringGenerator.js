/**
 * Recurring Signal Generator
 *
 * When the extractor detects a recurring pattern (e.g., "every Monday"),
 * this module generates N discrete signal documents for upcoming occurrences.
 *
 * This approach makes querying simple:
 * - To find what's happening on a specific day, just query signals where targetDate = that day
 * - No complex recurrence expansion logic needed on the frontend
 * - Each occurrence can be individually dismissed/verified
 */

// Maximum number of recurring instances to generate
const MAX_RECURRING_OCCURRENCES = 4;

/**
 * Calculate the next N occurrence dates for a recurring pattern
 *
 * @param {string} pattern - The recurring pattern (e.g., "every_monday", "weekly", "daily")
 * @param {Date} currentDate - The current date
 * @param {number} count - Number of occurrences to generate
 * @returns {Date[]} Array of occurrence dates
 */
const calculateOccurrences = (pattern, currentDate, count = MAX_RECURRING_OCCURRENCES) => {
  const occurrences = [];
  const today = new Date(currentDate);
  today.setHours(12, 0, 0, 0); // Normalize to noon

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = today.getDay();

  // Pattern: every_monday, every_tuesday, etc.
  const dayMatch = pattern.match(/every_(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const targetDay = dayNames.indexOf(dayMatch[1]);
    if (targetDay !== -1) {
      // Find next occurrence
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // If today is the day, start from next week

      // Generate N occurrences
      for (let i = 0; i < count; i++) {
        const occDate = new Date(today);
        occDate.setDate(today.getDate() + daysUntil + (i * 7));
        occurrences.push(occDate);
      }
      return occurrences;
    }
  }

  // Pattern: weekly (same day next week)
  if (pattern === 'weekly') {
    for (let i = 1; i <= count; i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + (i * 7));
      occurrences.push(occDate);
    }
    return occurrences;
  }

  // Pattern: daily or every_day
  if (pattern === 'daily' || pattern === 'every_day') {
    for (let i = 1; i <= count; i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + i);
      occurrences.push(occDate);
    }
    return occurrences;
  }

  // Pattern: every_morning (same as daily, but could be tagged differently)
  if (pattern === 'every_morning') {
    for (let i = 1; i <= count; i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + i);
      occDate.setHours(9, 0, 0, 0); // Set to morning
      occurrences.push(occDate);
    }
    return occurrences;
  }

  // Pattern: every_evening or every_night
  if (pattern === 'every_evening' || pattern === 'every_night') {
    for (let i = 1; i <= count; i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + i);
      occDate.setHours(19, 0, 0, 0); // Set to evening
      occurrences.push(occDate);
    }
    return occurrences;
  }

  // Pattern: weekdays (Monday-Friday)
  if (pattern === 'weekdays' || pattern === 'every_weekday') {
    let daysGenerated = 0;
    let dayOffset = 1;

    while (daysGenerated < count) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + dayOffset);
      const dow = occDate.getDay();

      // Only include Monday (1) through Friday (5)
      if (dow >= 1 && dow <= 5) {
        occurrences.push(occDate);
        daysGenerated++;
      }
      dayOffset++;

      // Safety limit
      if (dayOffset > 30) break;
    }
    return occurrences;
  }

  // Pattern: weekends (Saturday-Sunday)
  if (pattern === 'weekends' || pattern === 'every_weekend') {
    let daysGenerated = 0;
    let dayOffset = 1;

    while (daysGenerated < count) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + dayOffset);
      const dow = occDate.getDay();

      // Only include Saturday (6) and Sunday (0)
      if (dow === 0 || dow === 6) {
        occurrences.push(occDate);
        daysGenerated++;
      }
      dayOffset++;

      // Safety limit
      if (dayOffset > 30) break;
    }
    return occurrences;
  }

  // Unknown pattern - return empty
  console.warn(`Unknown recurring pattern: ${pattern}`);
  return occurrences;
};

/**
 * Generate recurring signal instances from a base signal
 *
 * @param {string} pattern - The recurring pattern (e.g., "every_monday")
 * @param {Object} baseSignal - The base signal to replicate
 * @param {Date} currentDate - The current date
 * @returns {Array} Array of signal objects with different targetDates
 *
 * @example
 * // User says: "I have gym every Monday"
 * generateRecurringSignals('every_monday', { content: 'Gym', sentiment: 'neutral' }, new Date('2024-12-23'))
 * // Returns 4 signals:
 * // { targetDate: Dec 30, content: "Gym", isRecurringInstance: true, occurrenceIndex: 1 }
 * // { targetDate: Jan 6,  content: "Gym", isRecurringInstance: true, occurrenceIndex: 2 }
 * // { targetDate: Jan 13, content: "Gym", isRecurringInstance: true, occurrenceIndex: 3 }
 * // { targetDate: Jan 20, content: "Gym", isRecurringInstance: true, occurrenceIndex: 4 }
 */
export const generateRecurringSignals = (pattern, baseSignal, currentDate = new Date()) => {
  const signals = [];
  const occurrenceDates = calculateOccurrences(pattern, currentDate, MAX_RECURRING_OCCURRENCES);

  occurrenceDates.forEach((targetDate, index) => {
    signals.push({
      ...baseSignal,
      targetDate,
      isRecurringInstance: true,
      recurringPattern: pattern,
      occurrenceIndex: index + 1,
      // Slightly reduce confidence for generated occurrences
      confidence: Math.max(0.5, (baseSignal.confidence || 0.7) * 0.95)
    });
  });

  return signals;
};

/**
 * Check if a temporal reference is a recurring pattern
 */
export const isRecurringPattern = (reference) => {
  if (!reference) return false;
  const normalized = reference.toLowerCase().replace(/\s+/g, '_');
  return /^every_|^weekly|^daily|^weekdays|^weekends/.test(normalized);
};

/**
 * Parse a recurring pattern from text
 */
export const parseRecurringPattern = (text) => {
  const patterns = [
    { regex: /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, format: (m) => `every_${m[1].toLowerCase()}` },
    { regex: /every\s+(morning|evening|night|day)/i, format: (m) => `every_${m[1].toLowerCase()}` },
    { regex: /\b(weekly)\b/i, format: () => 'weekly' },
    { regex: /\b(daily)\b/i, format: () => 'daily' },
    { regex: /\b(weekdays)\b/i, format: () => 'weekdays' },
    { regex: /\b(weekends)\b/i, format: () => 'weekends' },
  ];

  for (const { regex, format } of patterns) {
    const match = text.match(regex);
    if (match) {
      return format(match);
    }
  }

  return null;
};

export default {
  generateRecurringSignals,
  isRecurringPattern,
  parseRecurringPattern,
  MAX_RECURRING_OCCURRENCES
};
