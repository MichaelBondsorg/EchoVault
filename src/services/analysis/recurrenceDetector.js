/**
 * Recurrence Detector
 *
 * Detects recurring patterns in task text.
 * Designed for on-device processing without server dependency.
 *
 * Pattern Types:
 * - daily: "every day", "daily", "each morning"
 * - weekday: "every weekday", "Monday through Friday"
 * - weekend: "weekends", "every Saturday and Sunday"
 * - weekly: "every week", "weekly", "every Monday"
 * - biweekly: "every other week", "biweekly"
 * - monthly: "every month", "monthly", "first of the month"
 * - yearly: "every year", "annually", "birthday"
 */

/**
 * Recurrence pattern definitions
 */
const RECURRENCE_PATTERNS = [
  // Daily patterns
  {
    regex: /\b(?:every\s*day|daily|each\s*day|every\s*single\s*day)\b/i,
    type: 'daily',
    frequency: 1,
    unit: 'day',
    label: 'Daily'
  },
  {
    regex: /\b(?:every\s*morning|each\s*morning)\b/i,
    type: 'daily',
    frequency: 1,
    unit: 'day',
    label: 'Every morning',
    timeOfDay: 'morning'
  },
  {
    regex: /\b(?:every\s*evening|each\s*evening|every\s*night|nightly)\b/i,
    type: 'daily',
    frequency: 1,
    unit: 'day',
    label: 'Every evening',
    timeOfDay: 'evening'
  },

  // Weekday patterns
  {
    regex: /\b(?:every\s*weekday|weekdays|monday\s*(?:through|to|thru|-)\s*friday|mon\s*(?:through|to|thru|-)\s*fri)\b/i,
    type: 'weekday',
    frequency: 1,
    unit: 'weekday',
    label: 'Weekdays',
    daysOfWeek: [1, 2, 3, 4, 5]
  },

  // Weekend patterns
  {
    regex: /\b(?:every\s*weekend|weekends|saturday\s*(?:and|&)\s*sunday)\b/i,
    type: 'weekend',
    frequency: 1,
    unit: 'weekend',
    label: 'Weekends',
    daysOfWeek: [0, 6]
  },

  // Specific day weekly patterns
  {
    regex: /\b(?:every|each)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    type: 'weekly',
    frequency: 1,
    unit: 'week',
    parse: (match) => {
      const dayNames = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
      };
      const day = match[1].toLowerCase();
      return {
        label: `Every ${match[1]}`,
        daysOfWeek: [dayNames[day]]
      };
    }
  },

  // Multiple days per week
  {
    regex: /\b(?:every|each)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*(?:,|and|&)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday))+\b/gi,
    type: 'weekly_multi',
    frequency: 1,
    unit: 'week',
    parse: (match) => {
      const dayNames = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6
      };
      const fullMatch = match[0].toLowerCase();
      const days = fullMatch.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/gi) || [];
      const dayIndices = [...new Set(days.map(d => dayNames[d.toLowerCase()]))].sort();
      return {
        label: `Every ${days.join(' and ')}`,
        daysOfWeek: dayIndices
      };
    }
  },

  // General weekly
  {
    regex: /\b(?:every\s*week|weekly|once\s*a\s*week)\b/i,
    type: 'weekly',
    frequency: 1,
    unit: 'week',
    label: 'Weekly'
  },

  // Biweekly / Every other week
  {
    regex: /\b(?:every\s*other\s*week|biweekly|bi-weekly|fortnightly)\b/i,
    type: 'biweekly',
    frequency: 2,
    unit: 'week',
    label: 'Every other week'
  },

  // Multiple times per week
  {
    regex: /\b(twice|two\s*times|2x?|three\s*times|3x?|four\s*times|4x?)\s*(?:a|per)\s*week\b/i,
    type: 'weekly_multi',
    unit: 'week',
    parse: (match) => {
      const freq = match[1].toLowerCase();
      let times = 2;
      if (/^(three|3)/.test(freq)) times = 3;
      if (/^(four|4)/.test(freq)) times = 4;
      return {
        frequency: times,
        label: `${times}x per week`
      };
    }
  },

  // Monthly patterns
  {
    regex: /\b(?:every\s*month|monthly|once\s*a\s*month)\b/i,
    type: 'monthly',
    frequency: 1,
    unit: 'month',
    label: 'Monthly'
  },
  {
    regex: /\b(?:(?:the\s*)?(?:first|1st)\s*(?:of\s*(?:the|each|every)\s*month|day\s*of\s*(?:the|each|every)\s*month))\b/i,
    type: 'monthly',
    frequency: 1,
    unit: 'month',
    label: 'First of the month',
    dayOfMonth: 1
  },
  {
    regex: /\b(?:(?:the\s*)?(?:15th|fifteenth)\s*(?:of\s*(?:the|each|every)\s*month)?)\b/i,
    type: 'monthly',
    frequency: 1,
    unit: 'month',
    label: '15th of the month',
    dayOfMonth: 15
  },
  {
    regex: /\b(?:(?:the\s*)?(?:last|end\s*of\s*(?:the|each|every))\s*month)\b/i,
    type: 'monthly',
    frequency: 1,
    unit: 'month',
    label: 'End of month',
    dayOfMonth: -1 // Last day
  },

  // Every other month
  {
    regex: /\b(?:every\s*other\s*month|bimonthly|bi-monthly)\b/i,
    type: 'bimonthly',
    frequency: 2,
    unit: 'month',
    label: 'Every other month'
  },

  // Quarterly
  {
    regex: /\b(?:every\s*(?:three|3)\s*months|quarterly|each\s*quarter)\b/i,
    type: 'quarterly',
    frequency: 3,
    unit: 'month',
    label: 'Quarterly'
  },

  // Yearly patterns
  {
    regex: /\b(?:every\s*year|yearly|annual(?:ly)?|once\s*a\s*year)\b/i,
    type: 'yearly',
    frequency: 1,
    unit: 'year',
    label: 'Yearly'
  },

  // Birthday/Anniversary indicators
  {
    regex: /\b(?:birthday|anniversary)\b/i,
    type: 'yearly',
    frequency: 1,
    unit: 'year',
    label: 'Yearly',
    occasion: true
  }
];

/**
 * Detect recurrence pattern in text
 *
 * @param {string} text - Text to analyze
 * @returns {Object|null} Recurrence pattern or null
 */
export const detectRecurrence = (text) => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  for (const pattern of RECURRENCE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(text);

    if (match) {
      let result = {
        type: pattern.type,
        frequency: pattern.frequency,
        unit: pattern.unit,
        label: pattern.label,
        matchedText: match[0],
        confidence: 0.85
      };

      // Apply custom parsing if available
      if (pattern.parse) {
        const parsed = pattern.parse(match);
        result = { ...result, ...parsed };
      }

      // Add optional fields
      if (pattern.timeOfDay) result.timeOfDay = pattern.timeOfDay;
      if (pattern.daysOfWeek) result.daysOfWeek = pattern.daysOfWeek;
      if (pattern.dayOfMonth) result.dayOfMonth = pattern.dayOfMonth;
      if (pattern.occasion) result.occasion = pattern.occasion;

      return result;
    }
  }

  return null;
};

/**
 * Check if text contains recurrence indicators
 *
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export const hasRecurrenceIndicators = (text) => {
  if (!text) return false;

  const quickPatterns = [
    /\bevery\s*(day|week|month|year|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(daily|weekly|monthly|yearly|annually|nightly)\b/i,
    /\b(twice|three\s*times)\s*(a|per)\s*(day|week|month)\b/i,
    /\b(weekdays|weekends)\b/i,
    /\bevery\s*other\s*(day|week|month)\b/i
  ];

  return quickPatterns.some(p => p.test(text));
};

/**
 * Calculate next occurrence based on recurrence pattern
 *
 * @param {Object} pattern - Recurrence pattern
 * @param {Date} from - Starting date
 * @returns {Date} Next occurrence date
 */
export const getNextOccurrence = (pattern, from = new Date()) => {
  const next = new Date(from);
  next.setHours(0, 0, 0, 0);

  switch (pattern.unit) {
    case 'day':
      next.setDate(next.getDate() + pattern.frequency);
      break;

    case 'week':
      if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
        // Find next matching day of week
        let found = false;
        for (let i = 1; i <= 7 && !found; i++) {
          const testDate = new Date(next);
          testDate.setDate(testDate.getDate() + i);
          if (pattern.daysOfWeek.includes(testDate.getDay())) {
            next.setTime(testDate.getTime());
            found = true;
          }
        }
      } else {
        next.setDate(next.getDate() + 7 * pattern.frequency);
      }
      break;

    case 'weekday':
      // Skip to next weekday
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() === 0 || next.getDay() === 6);
      break;

    case 'weekend':
      // Skip to next Saturday or Sunday
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() !== 0 && next.getDay() !== 6);
      break;

    case 'month':
      next.setMonth(next.getMonth() + pattern.frequency);
      if (pattern.dayOfMonth) {
        if (pattern.dayOfMonth === -1) {
          // Last day of month
          next.setMonth(next.getMonth() + 1, 0);
        } else {
          next.setDate(pattern.dayOfMonth);
        }
      }
      break;

    case 'year':
      next.setFullYear(next.getFullYear() + pattern.frequency);
      break;
  }

  // Apply time of day
  if (pattern.timeOfDay) {
    switch (pattern.timeOfDay) {
      case 'morning':
        next.setHours(9, 0, 0, 0);
        break;
      case 'evening':
        next.setHours(18, 0, 0, 0);
        break;
    }
  }

  return next;
};

/**
 * Get human-readable description of recurrence
 *
 * @param {Object} pattern - Recurrence pattern
 * @returns {string} Human-readable description
 */
export const getRecurrenceDescription = (pattern) => {
  if (!pattern) return '';

  if (pattern.label) return pattern.label;

  const { frequency, unit } = pattern;

  if (frequency === 1) {
    return unit.charAt(0).toUpperCase() + unit.slice(1) + 'ly';
  }

  if (frequency === 2) {
    return `Every other ${unit}`;
  }

  return `Every ${frequency} ${unit}s`;
};

export default {
  detectRecurrence,
  hasRecurrenceIndicators,
  getNextOccurrence,
  getRecurrenceDescription
};
