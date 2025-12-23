/**
 * Signal Extractor Service
 *
 * Extracts temporal signals from journal entry text.
 * Replaces the old temporal detection that returned a single effectiveDate.
 *
 * Key concept: Each entry can produce MULTIPLE signals:
 * - Feelings (live on the day they're felt, usually today)
 * - Events (live on the day they happened/happen)
 * - Plans (live on the day they're scheduled)
 */

import { callGemini } from '../ai/gemini';
import { hasTemporalIndicators } from '../temporal';

// Emotional content patterns (for detecting signals even without temporal references)
const EMOTIONAL_PATTERNS = [
  /\b(feel|feeling|felt)\s+(so\s+)?(good|bad|anxious|stressed|happy|sad|tired|overwhelmed|excited|nervous|worried)\b/i,
  /\b(i'?m|i am)\s+(so\s+)?(anxious|stressed|excited|nervous|worried|happy|sad|overwhelmed)\b/i,
  /\b(nervous|anxious|stressed|worried|excited|dreading)\s+about\b/i,
  /\b(looking forward|can't wait|dreading)\b/i,
];

/**
 * Quick check if text has emotional content worth extracting
 */
const hasEmotionalContent = (text) => {
  return EMOTIONAL_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Calculate target date from a temporal reference
 * @param {string} reference - e.g., 'yesterday', 'tomorrow', 'next_monday'
 * @param {Date} currentDate - The current date for calculations
 * @returns {Date|null} The calculated target date
 */
const calculateTargetDate = (reference, currentDate = new Date()) => {
  const today = new Date(currentDate);
  today.setHours(12, 0, 0, 0); // Normalize to noon to avoid timezone issues

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = today.getDay();
  const ref = reference.toLowerCase().replace(/\s+/g, '_');

  // Today
  if (ref === 'today' || ref === 'now' || ref === 'this_morning' || ref === 'tonight' || ref === 'earlier_today') {
    return new Date(today);
  }

  // Yesterday
  if (ref === 'yesterday' || ref === 'last_night') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d;
  }

  // Days ago
  const daysAgoMatch = ref.match(/^(\w+)_days?_ago$/);
  if (daysAgoMatch) {
    const numWords = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, a_few: 3, couple: 2 };
    const num = numWords[daysAgoMatch[1]] || parseInt(daysAgoMatch[1], 10) || 1;
    const d = new Date(today);
    d.setDate(d.getDate() - num);
    return d;
  }

  // Last week
  if (ref === 'last_week') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return d;
  }

  // Tomorrow
  if (ref === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Day after tomorrow
  if (ref === 'day_after_tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return d;
  }

  // Next week
  if (ref === 'next_week') {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return d;
  }

  // This weekend (next Saturday)
  if (ref === 'this_weekend') {
    const daysUntilSaturday = (6 - currentDay + 7) % 7 || 7;
    const d = new Date(today);
    d.setDate(d.getDate() + daysUntilSaturday);
    return d;
  }

  // In a few days
  if (ref === 'in_a_few_days' || ref === 'in_couple_days') {
    const d = new Date(today);
    d.setDate(d.getDate() + 3);
    return d;
  }

  // Later this week
  if (ref === 'later_this_week') {
    const daysToAdd = Math.min(3, 6 - currentDay);
    const d = new Date(today);
    d.setDate(d.getDate() + Math.max(1, daysToAdd));
    return d;
  }

  // Day names with prefix: last_monday, next_monday, this_monday, or just monday
  const dayMatch = ref.match(/(?:(last|next|this)_)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const prefix = dayMatch[1];
    const targetDayName = dayMatch[2];
    const targetDay = dayNames.indexOf(targetDayName);

    if (targetDay !== -1) {
      const d = new Date(today);

      if (prefix === 'last') {
        // Previous week's occurrence
        let daysBack = currentDay - targetDay;
        if (daysBack <= 0) daysBack += 7;
        daysBack += 7;
        d.setDate(d.getDate() - daysBack);
        return d;
      } else if (prefix === 'next') {
        // Next week's occurrence
        let daysForward = targetDay - currentDay;
        if (daysForward <= 0) daysForward += 7;
        daysForward += 7;
        d.setDate(d.getDate() + daysForward);
        return d;
      } else if (prefix === 'this') {
        // This week's occurrence
        const daysDiff = targetDay - currentDay;
        d.setDate(d.getDate() + daysDiff);
        return d;
      } else {
        // No prefix - default to most recent past occurrence
        let daysBack = currentDay - targetDay;
        if (daysBack <= 0) daysBack += 7;
        d.setDate(d.getDate() - daysBack);
        return d;
      }
    }
  }

  // Specific date formats (e.g., "january_15", "dec_25")
  const dateMatch = ref.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[_\s]?(\d{1,2})$/);
  if (dateMatch) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[dateMatch[1]];
    const day = parseInt(dateMatch[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(today);
      d.setMonth(month, day);
      // If the date is in the past this year, assume next year for future plans
      if (d < today) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return d;
    }
  }

  return null; // Unknown reference
};

/**
 * Build the extraction prompt for Gemini
 */
const buildExtractionPrompt = (text, currentDate) => {
  const dateStr = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const currentHour = currentDate.getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

  return `Analyze this journal entry and extract temporal signals.
The user recorded this entry NOW on ${dateStr} (${timeOfDay}).

ENTRY:
"${text}"

Extract ALL signals - these are facts, feelings, or plans tied to specific days.

Return JSON:
{
  "signals": [
    {
      "type": "feeling" | "event" | "plan",
      "content": "brief description (3-5 words max)",
      "target_day": "today" | "yesterday" | "tomorrow" | "two_days_ago" | "next_monday" | "this_weekend" | etc.,
      "sentiment": "positive" | "negative" | "neutral" | "anxious" | "excited" | "hopeful" | "dreading",
      "original_phrase": "exact quote from entry (10-20 words max)",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning": "brief explanation (1 sentence)"
}

RULES:
1. FEELINGS live on the day they are FELT (usually today)
   - "I'm nervous about tomorrow" → feeling:nervous on TODAY (felt now)
   - "Yesterday I felt overwhelmed" → feeling:overwhelmed on YESTERDAY (explicitly past)

2. EVENTS/FACTS live on the day they HAPPENED/HAPPEN
   - "Yesterday I went to the hairdresser" → event:hairdresser on YESTERDAY
   - "I have a doctor appointment tomorrow" → plan:doctor_appointment on TOMORROW

3. When ambiguous, FEELINGS default to TODAY, EVENTS to the mentioned day

4. SUMMARY STATEMENTS about past days are EVENTS on that day
   - "Yesterday was great" → event:great_day on YESTERDAY (summary, not current feeling)
   - "Last week was exhausting" → event:exhausting_week on LAST_WEEK

5. Extract MULTIPLE signals if the entry mentions multiple days or emotions
   - "Yesterday was rough but I'm excited about tomorrow" →
     event:rough_day on YESTERDAY + feeling:excited on TODAY + plan:[event] on TOMORROW

6. For recurring events (every Monday, weekly, etc.), extract as a single signal with the pattern noted

EXAMPLES:
Entry: "I'm so stressed about my presentation tomorrow"
→ feeling:stressed on TODAY, plan:presentation on TOMORROW

Entry: "Had a great workout yesterday, feeling energized"
→ event:great_workout on YESTERDAY, feeling:energized on TODAY

Entry: "The meeting on Monday went well"
→ event:meeting_success on MONDAY (most recent past Monday)

Entry: "Every Monday I dread the standup"
→ Note as recurring pattern: every_monday, standup, dreading`;
};

/**
 * Extract signals from journal entry text
 *
 * @param {string} text - The journal entry text
 * @param {Date} currentDate - The current date (for calculating relative dates)
 * @returns {Promise<{signals: Array, hasTemporalContent: boolean, reasoning: string}>}
 */
export const extractSignals = async (text, currentDate = new Date()) => {
  // Quick pre-screen - if no temporal or emotional indicators, return minimal signal
  if (!hasTemporalIndicators(text) && !hasEmotionalContent(text)) {
    return {
      signals: [],
      hasTemporalContent: false,
      reasoning: 'No temporal or emotional indicators detected'
    };
  }

  const prompt = buildExtractionPrompt(text, currentDate);

  try {
    const raw = await callGemini(prompt, '');

    if (!raw) {
      console.warn('Signal extraction: No response from AI');
      return {
        signals: [],
        hasTemporalContent: false,
        reasoning: 'AI extraction failed'
      };
    }

    // Parse JSON response
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Signal extraction: Failed to parse JSON:', parseError, jsonStr);
      return {
        signals: [],
        hasTemporalContent: false,
        reasoning: 'Failed to parse AI response'
      };
    }

    // Process and validate signals
    const processedSignals = (result.signals || [])
      .map(sig => {
        const targetDate = calculateTargetDate(sig.target_day, currentDate);

        // Skip signals with invalid dates or low confidence
        if (!targetDate || sig.confidence < 0.4) {
          return null;
        }

        // Check for recurring pattern
        const isRecurring = /^every_|^weekly|^daily/.test(sig.target_day);

        return {
          type: sig.type,
          content: sig.content,
          targetDay: sig.target_day,
          targetDate,
          sentiment: sig.sentiment || 'neutral',
          originalPhrase: sig.original_phrase,
          confidence: sig.confidence,
          isRecurringInstance: false,
          recurringPattern: isRecurring ? sig.target_day : null,
          occurrenceIndex: null
        };
      })
      .filter(Boolean);

    // Determine if there's meaningful temporal content (not just "today")
    const hasTemporalContent = processedSignals.some(s =>
      s.targetDay !== 'today' && s.targetDay !== 'now'
    );

    return {
      signals: processedSignals,
      hasTemporalContent,
      reasoning: result.reasoning || 'Signals extracted successfully'
    };

  } catch (error) {
    console.error('Signal extraction error:', error);
    return {
      signals: [],
      hasTemporalContent: false,
      reasoning: `Extraction error: ${error.message}`
    };
  }
};

export default { extractSignals };
