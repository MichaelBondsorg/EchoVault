/**
 * Local Temporal Parser
 *
 * Parses date and time expressions from natural language text.
 * Designed for on-device processing without server dependency.
 *
 * Supports:
 * - Relative dates: "tomorrow", "next week", "in 3 days"
 * - Day names: "Monday", "next Friday"
 * - Time expressions: "at 3pm", "in the morning"
 * - Ranges: "this week", "next month"
 */

/**
 * Day name mappings
 */
const DAY_NAMES = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

/**
 * Month name mappings
 */
const MONTH_NAMES = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11
};

/**
 * Number word mappings
 */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1
};

/**
 * Parse a number from text (digit or word)
 */
const parseNumber = (str) => {
  if (!str) return null;
  const lower = str.toLowerCase().trim();
  if (NUMBER_WORDS[lower]) return NUMBER_WORDS[lower];
  const num = parseInt(lower, 10);
  return isNaN(num) ? null : num;
};

/**
 * Get the next occurrence of a specific day of week
 */
const getNextDayOfWeek = (dayIndex, fromDate = new Date()) => {
  const result = new Date(fromDate);
  result.setHours(0, 0, 0, 0);

  const currentDay = result.getDay();
  let daysToAdd = dayIndex - currentDay;

  // If it's today or in the past this week, go to next week
  if (daysToAdd <= 0) {
    daysToAdd += 7;
  }

  result.setDate(result.getDate() + daysToAdd);
  return result;
};

/**
 * Temporal expression patterns
 */
const TEMPORAL_PATTERNS = [
  // Today/Tonight
  {
    regex: /\b(today|tonight)\b/i,
    parse: (match) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return {
        type: 'specific',
        date,
        label: match[1].toLowerCase() === 'tonight' ? 'Tonight' : 'Today'
      };
    }
  },

  // Tomorrow
  {
    regex: /\b(tomorrow)\b/i,
    parse: () => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      return { type: 'specific', date, label: 'Tomorrow' };
    }
  },

  // Yesterday
  {
    regex: /\b(yesterday)\b/i,
    parse: () => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      date.setHours(0, 0, 0, 0);
      return { type: 'specific', date, label: 'Yesterday', isPast: true };
    }
  },

  // Next [day name]
  {
    regex: /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
    parse: (match) => {
      const dayName = match[1].toLowerCase();
      const dayIndex = DAY_NAMES[dayName];
      if (dayIndex === undefined) return null;

      const date = getNextDayOfWeek(dayIndex);
      // "Next" implies at least 7 days away
      if ((date - new Date()) / (1000 * 60 * 60 * 24) < 6) {
        date.setDate(date.getDate() + 7);
      }

      return {
        type: 'specific',
        date,
        label: `Next ${match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()}`
      };
    }
  },

  // This [day name]
  {
    regex: /\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
    parse: (match) => {
      const dayName = match[1].toLowerCase();
      const dayIndex = DAY_NAMES[dayName];
      if (dayIndex === undefined) return null;

      const date = getNextDayOfWeek(dayIndex);
      return {
        type: 'specific',
        date,
        label: `This ${match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()}`
      };
    }
  },

  // On [day name]
  {
    regex: /\bon\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    parse: (match) => {
      const dayName = match[1].toLowerCase();
      const dayIndex = DAY_NAMES[dayName];
      if (dayIndex === undefined) return null;

      return {
        type: 'specific',
        date: getNextDayOfWeek(dayIndex),
        label: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()
      };
    }
  },

  // In X days/weeks/months
  {
    regex: /\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(day|week|month)s?\b/i,
    parse: (match) => {
      const num = parseNumber(match[1]);
      if (!num) return null;

      const unit = match[2].toLowerCase();
      const date = new Date();
      date.setHours(0, 0, 0, 0);

      if (unit === 'day') {
        date.setDate(date.getDate() + num);
      } else if (unit === 'week') {
        date.setDate(date.getDate() + num * 7);
      } else if (unit === 'month') {
        date.setMonth(date.getMonth() + num);
      }

      return {
        type: 'specific',
        date,
        label: `In ${num} ${unit}${num > 1 ? 's' : ''}`
      };
    }
  },

  // Next week/month/year
  {
    regex: /\bnext\s+(week|month|year)\b/i,
    parse: (match) => {
      const unit = match[1].toLowerCase();
      const start = new Date();
      const end = new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      if (unit === 'week') {
        // Next week starts on next Monday
        const daysToMonday = (8 - start.getDay()) % 7 || 7;
        start.setDate(start.getDate() + daysToMonday);
        end.setDate(start.getDate() + 6);
      } else if (unit === 'month') {
        start.setMonth(start.getMonth() + 1, 1);
        end.setMonth(start.getMonth() + 1, 0);
      } else if (unit === 'year') {
        start.setFullYear(start.getFullYear() + 1, 0, 1);
        end.setFullYear(start.getFullYear(), 11, 31);
      }

      return {
        type: 'range',
        start,
        end,
        label: `Next ${unit}`
      };
    }
  },

  // This week/month/year
  {
    regex: /\bthis\s+(week|month|year)\b/i,
    parse: (match) => {
      const unit = match[1].toLowerCase();
      const start = new Date();
      const end = new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      if (unit === 'week') {
        // This week starts on last Sunday (or today if Sunday)
        start.setDate(start.getDate() - start.getDay());
        end.setDate(start.getDate() + 6);
      } else if (unit === 'month') {
        start.setDate(1);
        end.setMonth(end.getMonth() + 1, 0);
      } else if (unit === 'year') {
        start.setMonth(0, 1);
        end.setMonth(11, 31);
      }

      return {
        type: 'range',
        start,
        end,
        label: `This ${unit}`
      };
    }
  },

  // Time expressions: at X am/pm
  {
    regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
    parse: (match) => {
      let hour = parseInt(match[1], 10);
      const minute = match[2] ? parseInt(match[2], 10) : 0;
      const meridiem = match[3]?.toLowerCase().replace('.', '');

      if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

      if (meridiem === 'pm' && hour !== 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      // If no meridiem and hour <= 6, assume PM
      if (!meridiem && hour >= 1 && hour <= 6) hour += 12;

      const date = new Date();
      date.setHours(hour, minute, 0, 0);

      // If time has passed today, assume tomorrow
      if (date < new Date()) {
        date.setDate(date.getDate() + 1);
      }

      const label = `${match[1]}${match[2] ? ':' + match[2] : ''}${meridiem ? ' ' + meridiem.toUpperCase() : ''}`;

      return {
        type: 'time',
        date,
        hour,
        minute,
        label
      };
    }
  },

  // In the morning/afternoon/evening
  {
    regex: /\bin\s+the\s+(morning|afternoon|evening|night)\b/i,
    parse: (match) => {
      const period = match[1].toLowerCase();
      const date = new Date();
      date.setMinutes(0, 0, 0);

      switch (period) {
        case 'morning':
          date.setHours(9);
          break;
        case 'afternoon':
          date.setHours(14);
          break;
        case 'evening':
          date.setHours(18);
          break;
        case 'night':
          date.setHours(21);
          break;
      }

      // If time has passed today, assume tomorrow
      if (date < new Date()) {
        date.setDate(date.getDate() + 1);
      }

      return {
        type: 'time_period',
        date,
        period,
        label: `In the ${period}`
      };
    }
  },

  // Month day (e.g., "January 15", "Jan 15th")
  {
    regex: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
    parse: (match) => {
      const monthName = match[1].toLowerCase();
      const month = MONTH_NAMES[monthName];
      const day = parseInt(match[2], 10);

      if (month === undefined || day < 1 || day > 31) return null;

      const date = new Date();
      date.setMonth(month, day);
      date.setHours(0, 0, 0, 0);

      // If date has passed this year, assume next year
      if (date < new Date()) {
        date.setFullYear(date.getFullYear() + 1);
      }

      return {
        type: 'specific',
        date,
        label: `${match[1]} ${day}`
      };
    }
  }
];

/**
 * Parse temporal expressions from text
 *
 * @param {string} text - Text to parse
 * @returns {Object} Parsing result with all found temporal expressions
 */
export const parseTemporalExpressions = (text) => {
  if (!text || typeof text !== 'string') {
    return { expressions: [], hasTemporalRef: false };
  }

  const expressions = [];
  const seenLabels = new Set();

  for (const pattern of TEMPORAL_PATTERNS) {
    pattern.regex.lastIndex = 0;

    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const result = pattern.parse(match);
      if (result && !seenLabels.has(result.label)) {
        seenLabels.add(result.label);
        expressions.push({
          ...result,
          matchedText: match[0],
          position: match.index
        });
      }
    }
  }

  // Sort by position in text
  expressions.sort((a, b) => a.position - b.position);

  return {
    expressions,
    hasTemporalRef: expressions.length > 0,
    count: expressions.length
  };
};

/**
 * Quick check if text has temporal references
 *
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export const hasTemporalIndicators = (text) => {
  if (!text) return false;

  const quickPatterns = [
    /\b(today|tomorrow|yesterday|tonight)\b/i,
    /\b(next|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\bin\s+\d+\s+(day|week|month)s?\b/i,
    /\bat\s+\d{1,2}\s*(am|pm)?\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i
  ];

  return quickPatterns.some(p => p.test(text));
};

/**
 * Get the primary temporal reference (most specific one)
 *
 * @param {string} text - Text to parse
 * @returns {Object|null} Primary temporal reference or null
 */
export const getPrimaryTemporal = (text) => {
  const { expressions } = parseTemporalExpressions(text);

  if (expressions.length === 0) return null;

  // Prefer specific dates over ranges, and dates over time-only
  const specific = expressions.find(e => e.type === 'specific');
  if (specific) return specific;

  const range = expressions.find(e => e.type === 'range');
  if (range) return range;

  return expressions[0];
};

export default {
  parseTemporalExpressions,
  hasTemporalIndicators,
  getPrimaryTemporal
};
