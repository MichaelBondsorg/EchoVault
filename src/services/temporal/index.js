/**
 * Temporal Context Detection Service
 *
 * Detects when users are talking about past or future days:
 * - Past references -> backdate effectiveDate
 * - Future references -> populate futureMentions[] for proactive follow-up
 *
 * Examples:
 * - "Yesterday was rough" -> effectiveDate = today - 1
 * - "I'm nervous about my interview tomorrow" -> futureMention for tomorrow
 * - "The Monday meeting went well" -> effectiveDate = most recent Monday
 * - "Every Monday I have standup" -> recurring futureMention
 */

import { callGemini } from '../ai/gemini';

// Maximum days in the future to track mentions (prevents stale follow-ups)
const FUTURE_HORIZON_DAYS = 7;

/**
 * Temporal expression patterns for quick pre-screening
 */
const TEMPORAL_PATTERNS = [
  // === PAST REFERENCES ===
  /\byesterday\b/i,
  /\blast night\b/i,
  /\bthe night before\b/i,
  /\btwo days ago\b/i,
  /\bthree days ago\b/i,
  /\ba few days ago\b/i,
  /\bthe other day\b/i,
  /\bearlier today\b/i,
  /\bthis morning\b/i,
  /\btonight\b/i,
  /\blast week\b/i,

  // Day names (past context)
  /\bon (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday) (night|morning|afternoon|evening)\b/i,

  // Time expressions (past)
  /\blast (morning|afternoon|evening)\b/i,
  /\bthe past (few|couple) days\b/i,

  // Retrospective language
  /\bwas feeling\b/i,
  /\bfelt (so |really |very )?(good|bad|anxious|stressed|happy|sad|tired)\b/i,
  /\bhad a (good|bad|rough|tough|great|terrible)\b/i,
  /\bwent (well|badly|great|terrible)\b/i,

  // === FUTURE REFERENCES ===
  /\btomorrow\b/i,
  /\bthe day after tomorrow\b/i,
  /\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bthis (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bnext week\b/i,
  /\bin (a |the )?(few|couple) days\b/i,
  /\bcoming up\b/i,
  /\bupcoming\b/i,
  /\blater this week\b/i,
  /\bthis weekend\b/i,
  /\bnext weekend\b/i,

  // Anticipatory language
  /\bnervous about\b/i,
  /\bworried about\b/i,
  /\bexcited (about|for)\b/i,
  /\blooking forward to\b/i,
  /\bdreading\b/i,
  /\bcan't wait for\b/i,
  /\bpreparing for\b/i,
  /\bgetting ready for\b/i,

  // Recurring patterns
  /\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bevery week\b/i,
  /\bweekly\b/i,
  /\bevery morning\b/i,
  /\bevery (day|night)\b/i,
];

/**
 * Quick check if text likely contains temporal references
 * Used to avoid unnecessary AI calls
 */
export const hasTemporalIndicators = (text) => {
  return TEMPORAL_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Calculate the target date from a temporal reference
 * @param {string} reference - The temporal reference (e.g., 'yesterday', 'tomorrow', 'next_monday')
 * @param {Date} currentDate - The current date for calculations
 * @param {string} direction - 'past', 'future', or 'auto' (inferred from reference)
 * @returns {{ date: Date, direction: 'past' | 'future' | 'today' } | null}
 */
const calculateTargetDate = (reference, currentDate = new Date(), direction = 'auto') => {
  const today = new Date(currentDate);
  today.setHours(12, 0, 0, 0); // Normalize to noon

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = today.getDay();
  const currentHour = currentDate.getHours();
  const ref = reference.toLowerCase();

  // === PAST REFERENCES ===
  if (ref === 'yesterday') {
    return { date: new Date(today.setDate(today.getDate() - 1)), direction: 'past' };
  }

  if (ref === 'last_night') {
    if (currentHour < 6) {
      return { date: new Date(today), direction: 'today' };
    }
    return { date: new Date(today.setDate(today.getDate() - 1)), direction: 'past' };
  }

  if (ref === 'two_days_ago') {
    return { date: new Date(today.setDate(today.getDate() - 2)), direction: 'past' };
  }

  if (ref === 'three_days_ago') {
    return { date: new Date(today.setDate(today.getDate() - 3)), direction: 'past' };
  }

  if (ref === 'this_morning' || ref === 'earlier_today') {
    return { date: new Date(today), direction: 'today' };
  }

  if (ref === 'last_week') {
    return { date: new Date(today.setDate(today.getDate() - 7)), direction: 'past' };
  }

  // === FUTURE REFERENCES ===
  if (ref === 'tomorrow') {
    return { date: new Date(today.setDate(today.getDate() + 1)), direction: 'future' };
  }

  if (ref === 'day_after_tomorrow') {
    return { date: new Date(today.setDate(today.getDate() + 2)), direction: 'future' };
  }

  if (ref === 'next_week') {
    return { date: new Date(today.setDate(today.getDate() + 7)), direction: 'future' };
  }

  if (ref === 'this_weekend') {
    // Find next Saturday
    const daysUntilSaturday = (6 - currentDay + 7) % 7 || 7;
    return { date: new Date(today.setDate(today.getDate() + daysUntilSaturday)), direction: 'future' };
  }

  if (ref === 'next_weekend') {
    // Find Saturday of next week
    const daysUntilSaturday = (6 - currentDay + 7) % 7 || 7;
    return { date: new Date(today.setDate(today.getDate() + daysUntilSaturday + 7)), direction: 'future' };
  }

  if (ref === 'in_a_few_days' || ref === 'in_couple_days') {
    return { date: new Date(today.setDate(today.getDate() + 3)), direction: 'future' };
  }

  if (ref === 'later_this_week') {
    // Assume 2-3 days from now, capped at end of week
    const daysToAdd = Math.min(3, 6 - currentDay);
    return { date: new Date(today.setDate(today.getDate() + Math.max(1, daysToAdd))), direction: 'future' };
  }

  // === DAY NAME REFERENCES ===
  // Check for day names: "monday", "last_monday", "next_monday", "this_monday"
  const dayMatch = ref.match(/(?:(last|next|this)_)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const prefix = dayMatch[1]; // 'last', 'next', 'this', or undefined
    const targetDayName = dayMatch[2];
    const targetDay = dayNames.indexOf(targetDayName);

    if (targetDay !== -1) {
      if (prefix === 'last') {
        // Go back to previous occurrence
        let daysBack = currentDay - targetDay;
        if (daysBack <= 0) daysBack += 7;
        daysBack += 7; // "last" means previous week
        return { date: new Date(today.setDate(today.getDate() - daysBack)), direction: 'past' };
      } else if (prefix === 'next') {
        // Go forward to next week's occurrence
        let daysForward = targetDay - currentDay;
        if (daysForward <= 0) daysForward += 7;
        daysForward += 7; // "next" means next week explicitly
        return { date: new Date(today.setDate(today.getDate() + daysForward)), direction: 'future' };
      } else if (prefix === 'this') {
        // This week's occurrence (could be past or future)
        let daysDiff = targetDay - currentDay;
        if (daysDiff === 0) {
          return { date: new Date(today), direction: 'today' };
        } else if (daysDiff > 0) {
          return { date: new Date(today.setDate(today.getDate() + daysDiff)), direction: 'future' };
        } else {
          return { date: new Date(today.setDate(today.getDate() + daysDiff)), direction: 'past' };
        }
      } else {
        // No prefix - infer based on direction hint or default to past (most recent)
        if (direction === 'future') {
          let daysForward = targetDay - currentDay;
          if (daysForward <= 0) daysForward += 7;
          return { date: new Date(today.setDate(today.getDate() + daysForward)), direction: 'future' };
        } else {
          // Default: past (most recent occurrence)
          let daysBack = currentDay - targetDay;
          if (daysBack <= 0) daysBack += 7;
          return { date: new Date(today.setDate(today.getDate() - daysBack)), direction: 'past' };
        }
      }
    }
  }

  return null; // Unknown reference
};

/**
 * Use AI to detect temporal context in entry text
 * Now handles both past references (backdate) and future references (follow-up)
 */
export const detectTemporalContext = async (text, currentDate = new Date()) => {
  // Quick pre-screen - if no temporal indicators, skip AI call
  if (!hasTemporalIndicators(text)) {
    return {
      detected: false,
      effectiveDate: currentDate,
      futureMentions: [],
      confidence: 0,
      reference: null,
      originalPhrase: null
    };
  }

  const currentDateStr = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const currentHour = currentDate.getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 17 ? 'afternoon' : 'evening';

  const prompt = `Analyze this journal entry for temporal references. The user is writing NOW on ${currentDateStr} (${timeOfDay}).

ENTRY:
"${text}"

Detect TWO types of temporal references:
1. PAST: Is the user describing events/feelings from a past day? (for backdating the entry)
2. FUTURE: Is the user mentioning upcoming events with emotions? (for follow-up reminders)
3. RECURRING: Is the user mentioning recurring events? (weekly patterns)

Return JSON:
{
  "past_reference": {
    "detected": boolean,
    "temporal_reference": "yesterday" | "last_night" | "two_days_ago" | "three_days_ago" | "this_morning" | "earlier_today" | "last_week" | "monday" | "last_monday" | etc. | null,
    "original_phrase": "exact phrase" | null,
    "confidence": 0.0-1.0
  },
  "future_mentions": [
    {
      "temporal_reference": "tomorrow" | "day_after_tomorrow" | "next_week" | "this_weekend" | "next_weekend" | "later_this_week" | "in_a_few_days" | "next_monday" | "this_friday" | etc.,
      "event": "short description of what's happening (e.g., 'interview', 'dentist appointment', 'team meeting')",
      "sentiment": "nervous" | "excited" | "anxious" | "dreading" | "hopeful" | "worried" | "looking_forward" | "neutral",
      "original_phrase": "exact phrase mentioning this",
      "confidence": 0.0-1.0
    }
  ],
  "recurring_mentions": [
    {
      "pattern": "every_monday" | "every_tuesday" | "weekly" | "every_morning" | "every_day" | etc.,
      "event": "short description (e.g., 'standup meeting', 'therapy')",
      "sentiment": "positive" | "negative" | "neutral",
      "original_phrase": "exact phrase",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning": "brief explanation"
}

Rules for PAST:
- "yesterday" = the calendar day before today
- "last night" = yesterday evening (unless it's before 6am)
- Day names without "last" = most recent occurrence
- Day names with "last" = previous week's occurrence
- Present tense alone = today, not past
- Generic ("lately", "recently") = NOT a specific past day

Rules for FUTURE:
- Must have emotional component to be worth tracking (nervous, excited, worried, etc.)
- Pure scheduling without emotion = skip (e.g., "I have a meeting tomorrow" with no feeling)
- "tomorrow", "next week", "this Friday" = future references
- Capture the EVENT and SENTIMENT for follow-up prompts

Rules for RECURRING:
- "every Monday I have...", "weekly therapy", "daily standup"
- These generate follow-up prompts each occurrence

Examples:
- "Yesterday I had a great workout" -> past_reference: yesterday
- "I'm nervous about my interview tomorrow" -> future_mention: tomorrow, interview, nervous
- "The Monday meeting went well" -> past_reference: monday (most recent)
- "Every Monday I dread the standup" -> recurring: every_monday, standup, negative
- "Looking forward to the concert this weekend!" -> future_mention: this_weekend, concert, excited
- "I've been feeling tired lately" -> no specific references`;

  try {
    const raw = await callGemini(prompt, '', 'gemini-2.0-flash');
    if (!raw) {
      return {
        detected: false,
        effectiveDate: currentDate,
        futureMentions: [],
        confidence: 0,
        reference: null,
        originalPhrase: null
      };
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(jsonStr);

    // Process past reference (for backdating)
    let effectiveDate = currentDate;
    let pastDetected = false;
    let pastConfidence = 0;
    let pastReference = null;
    let pastPhrase = null;

    if (result.past_reference?.detected && result.past_reference?.temporal_reference) {
      const targetResult = calculateTargetDate(result.past_reference.temporal_reference, currentDate, 'past');
      if (targetResult && targetResult.direction === 'past') {
        effectiveDate = targetResult.date;
        pastDetected = true;
        pastConfidence = result.past_reference.confidence || 0.7;
        pastReference = result.past_reference.temporal_reference;
        pastPhrase = result.past_reference.original_phrase;
      }
    }

    // Process future mentions (for follow-up)
    const futureMentions = [];
    const seenEvents = new Set(); // For deduplication

    // Process explicit future mentions
    if (Array.isArray(result.future_mentions)) {
      for (const mention of result.future_mentions) {
        if (!mention.temporal_reference || !mention.event) continue;
        if (mention.confidence < 0.4) continue; // Skip low confidence

        const targetResult = calculateTargetDate(mention.temporal_reference, currentDate, 'future');
        if (!targetResult || targetResult.direction !== 'future') continue;

        // Check 7-day horizon
        const daysUntil = Math.ceil((targetResult.date - currentDate) / (1000 * 60 * 60 * 24));
        if (daysUntil > FUTURE_HORIZON_DAYS) continue;

        // Deduplication key
        const dedupeKey = `${mention.event.toLowerCase()}_${targetResult.date.toDateString()}`;
        if (seenEvents.has(dedupeKey)) continue;
        seenEvents.add(dedupeKey);

        futureMentions.push({
          targetDate: targetResult.date,
          event: mention.event,
          sentiment: mention.sentiment || 'neutral',
          phrase: mention.original_phrase,
          confidence: mention.confidence,
          isRecurring: false
        });
      }
    }

    // Process recurring mentions (generate next occurrence within horizon)
    if (Array.isArray(result.recurring_mentions)) {
      for (const recurring of result.recurring_mentions) {
        if (!recurring.pattern || !recurring.event) continue;
        if (recurring.confidence < 0.5) continue;

        // Generate next occurrences for recurring events
        const occurrences = generateRecurringOccurrences(
          recurring.pattern,
          currentDate,
          FUTURE_HORIZON_DAYS
        );

        for (const occDate of occurrences) {
          const dedupeKey = `${recurring.event.toLowerCase()}_${occDate.toDateString()}`;
          if (seenEvents.has(dedupeKey)) continue;
          seenEvents.add(dedupeKey);

          futureMentions.push({
            targetDate: occDate,
            event: recurring.event,
            sentiment: recurring.sentiment === 'negative' ? 'dreading' :
                       recurring.sentiment === 'positive' ? 'looking_forward' : 'neutral',
            phrase: recurring.original_phrase,
            confidence: recurring.confidence,
            isRecurring: true,
            recurringPattern: recurring.pattern
          });
        }
      }
    }

    return {
      detected: pastDetected || futureMentions.length > 0,
      effectiveDate,
      futureMentions,
      confidence: pastDetected ? pastConfidence : (futureMentions.length > 0 ? 0.7 : 0),
      reference: pastReference,
      originalPhrase: pastPhrase,
      reasoning: result.reasoning
    };

  } catch (e) {
    console.error('detectTemporalContext error:', e);
    return {
      detected: false,
      effectiveDate: currentDate,
      futureMentions: [],
      confidence: 0,
      reference: null,
      originalPhrase: null,
      error: e.message
    };
  }
};

/**
 * Generate future occurrence dates for recurring patterns within horizon
 */
const generateRecurringOccurrences = (pattern, currentDate, horizonDays) => {
  const occurrences = [];
  const today = new Date(currentDate);
  today.setHours(12, 0, 0, 0);

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDay = today.getDay();

  // Match "every_monday", "every_tuesday", etc.
  const dayMatch = pattern.match(/every_(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const targetDay = dayNames.indexOf(dayMatch[1]);
    if (targetDay !== -1) {
      // Find next occurrence
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;

      // Generate occurrences within horizon
      while (daysUntil <= horizonDays) {
        const occDate = new Date(today);
        occDate.setDate(today.getDate() + daysUntil);
        occurrences.push(occDate);
        daysUntil += 7;
      }
    }
    return occurrences;
  }

  // "weekly" - assume same day next week
  if (pattern === 'weekly') {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    if (7 <= horizonDays) {
      occurrences.push(nextWeek);
    }
    return occurrences;
  }

  // "every_day" or "daily"
  if (pattern === 'every_day' || pattern === 'daily') {
    for (let i = 1; i <= Math.min(horizonDays, 7); i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + i);
      occurrences.push(occDate);
    }
    return occurrences;
  }

  // "every_morning" - same as every_day
  if (pattern === 'every_morning') {
    for (let i = 1; i <= Math.min(horizonDays, 7); i++) {
      const occDate = new Date(today);
      occDate.setDate(today.getDate() + i);
      occurrences.push(occDate);
    }
    return occurrences;
  }

  return occurrences;
};

/**
 * Format a date for display in confirmation UI
 */
export const formatEffectiveDate = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((today - targetDate) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === 2) return '2 days ago';
  if (diffDays < 7) return `${diffDays} days ago`;

  return targetDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Determine if user confirmation is needed based on confidence
 */
export const needsConfirmation = (temporalResult) => {
  if (!temporalResult.detected) return false;

  // High confidence (>0.8) - auto-apply
  if (temporalResult.confidence > 0.8) return false;

  // Medium confidence (0.5-0.8) - ask user
  if (temporalResult.confidence >= 0.5) return true;

  // Low confidence (<0.5) - don't apply, don't ask
  return false;
};

export default {
  detectTemporalContext,
  hasTemporalIndicators,
  formatEffectiveDate,
  needsConfirmation
};
