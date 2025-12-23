/**
 * Signal Extractor Service
 *
 * Extracts temporal signals from journal entry text.
 * Replaces the old temporal detection that returned a single effectiveDate.
 *
 * Key concepts:
 * - Each entry can produce MULTIPLE signals
 * - 4 signal types with different scoring weights:
 *   - Feelings: emotions felt NOW (high weight, default to TODAY)
 *   - Events: specific things that happened (medium weight)
 *   - Plans: future scheduled items (ZERO weight - neutral facts)
 *   - Reflections: general retrospective evaluations (high weight)
 *
 * Critical rule: "I'm excited about tomorrow" produces TWO signals:
 *   - feeling:excited → TODAY (the emotion is felt now)
 *   - plan:event → TOMORROW (the fact is scheduled then)
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
 *
 * Key design decisions:
 * - 4 signal types: feeling, event, plan, reflection
 * - Plans are NEUTRAL (weight 0 in scoring) - they're just scheduled things
 * - Feelings about plans go to TODAY, the plan itself goes to the target day
 * - Reflections are general evaluations ("yesterday was great") - high weight but different from events
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

Extract temporal signals. Return JSON:
{
  "signals": [
    {
      "type": "feeling" | "event" | "plan" | "reflection",
      "content": "brief description (3-5 words max)",
      "target_day": "today" | "yesterday" | "tomorrow" | "two_days_ago" | "next_monday" | etc.,
      "sentiment": "positive" | "negative" | "neutral" | "anxious" | "excited" | "hopeful" | "dreading",
      "original_phrase": "exact quote from entry (10-20 words max)",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning": "brief explanation (1 sentence)"
}

SIGNAL TYPES:
1. "feeling": Emotions felt NOW. Default target: TODAY. SCORE WEIGHT: High.
   - "I am so stressed" → feeling on TODAY
   - "I'm excited about the trip tomorrow" → feeling:excited on TODAY (NOT tomorrow)

2. "event": Specific things that happened. Target: the day they occurred.
   - "Went to the gym yesterday" → event on YESTERDAY
   - "Had a great meeting" → event on TODAY (if no other day mentioned)

3. "plan": Future scheduled items. Target: the future day. SCORE WEIGHT: 0 (neutral facts).
   - "Doctor appointment tomorrow" → plan on TOMORROW
   - Plans do NOT affect the target day's mood score until reflected on

4. "reflection": General retrospective evaluation of a time period WITHOUT a specific anchor event.
   - "Yesterday was a good day" → reflection on YESTERDAY
   - "Last week was exhausting" → reflection on LAST_WEEK
   - Reflections ARE different from events: "Yesterday was great" is NOT an event

CRITICAL RULES:
- If a user says "I am excited about the trip tomorrow":
  - Create a "feeling" (excited) targeting TODAY
  - Create a "plan" (trip) targeting TOMORROW
  - Do NOT combine them. Plans are neutral facts; feelings are today's reality.

- Feelings ALWAYS live on TODAY unless explicitly stated otherwise
  - "I'm nervous about my interview" → feeling on TODAY (even though interview is future)
  - "Yesterday I felt overwhelmed" → feeling on YESTERDAY (explicitly past)

- When in doubt about event vs reflection:
  - Specific activity → event ("went to gym", "had meeting")
  - General evaluation → reflection ("was a good day", "felt long")

EXAMPLES:
Entry: "I'm so stressed about my presentation tomorrow"
→ feeling:stressed on TODAY (current emotion), plan:presentation on TOMORROW (neutral scheduled item)

Entry: "Yesterday was amazing, had a great workout"
→ reflection:amazing_day on YESTERDAY (general evaluation), event:great_workout on YESTERDAY (specific activity)

Entry: "Looking forward to the concert this weekend!"
→ feeling:excited on TODAY, plan:concert on THIS_WEEKEND

Entry: "The Monday meeting went well"
→ event:meeting_success on MONDAY (most recent past Monday)`;
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
