import { callGemini } from '../ai';
import { computeMoodTrajectory, detectCyclicalPatterns } from '../analysis';
import { generateProactiveContext, computeActivitySentiment } from '../nexus/compat';

/**
 * Prompt Priority Hierarchy:
 * 1. Future follow-ups - "You mentioned being nervous about your interview. How did it go?" (HIGHEST)
 * 2. Proactive context - Entity history, pattern triggers
 * 3. Open situations - "How did that meeting go?" (continuity)
 * 4. Goal check-ins - "Still planning to hit the gym?" (accountability)
 * 5. Pattern-based - "You usually feel anxious on Mondays. How are you feeling?"
 * 6. Mood trajectory - "You've been in a low stretch. What's one small win today?"
 * 7. Generic journaling - "What's on your mind?" (fallback)
 */

/**
 * Get future mentions that target today (for follow-up prompts)
 * These are events the user mentioned being nervous/excited about
 */
const extractTodayFollowUps = (entries) => {
  const followUps = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const seenEvents = new Set(); // Dedupe across entries

  entries.forEach(entry => {
    if (!entry.futureMentions || !Array.isArray(entry.futureMentions)) return;

    entry.futureMentions.forEach(mention => {
      // Get target date
      const targetDate = mention.targetDate instanceof Date
        ? mention.targetDate
        : mention.targetDate?.toDate?.();

      if (!targetDate) return;

      // Check if target date is today
      if (targetDate >= today && targetDate <= todayEnd) {
        // Get entry date for context
        const entryDate = entry.effectiveDate instanceof Date
          ? entry.effectiveDate
          : entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.();

        // Dedupe by event name
        const dedupeKey = mention.event.toLowerCase();
        if (seenEvents.has(dedupeKey)) return;
        seenEvents.add(dedupeKey);

        followUps.push({
          event: mention.event,
          sentiment: mention.sentiment,
          phrase: mention.phrase,
          entryDate,
          isRecurring: mention.isRecurring || false,
          confidence: mention.confidence || 0.7
        });
      }
    });
  });

  // Sort by confidence, take top 3
  return followUps
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 3);
};

/**
 * Generate follow-up prompts for events the user mentioned
 */
const generateFollowUpPrompts = async (followUps) => {
  if (followUps.length === 0) return [];

  const prompt = `Generate personalized follow-up questions for events the user previously mentioned.
The user mentioned these upcoming events with emotions - today is the day they happen.

EVENTS:
${followUps.map((f, i) => `${i + 1}. Event: "${f.event}", Feeling: ${f.sentiment}, Original: "${f.phrase || 'N/A'}"`).join('\n')}

Return JSON array of follow-up questions (1 per event):
["Question 1?", "Question 2?"]

Rules:
- Reference how they were feeling: "You mentioned feeling nervous about..."
- Ask how it went or how they're feeling now
- Be warm and curious, not pushy
- Keep under 20 words
- For recurring events, acknowledge the pattern: "Monday standup day - how'd it go this week?"

Examples:
- Nervous about interview → "You mentioned being nervous about your interview. How did it go?"
- Excited about concert → "Did you enjoy the concert you were looking forward to?"
- Dreading meeting → "That meeting you were dreading - was it as bad as you expected?"`;

  try {
    const raw = await callGemini(prompt, '', 'gemini-2.0-flash');
    if (!raw) return [];
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateFollowUpPrompts error:', e);
    return [];
  }
};

const GENERIC_PROMPTS = [
  "What's on your mind today?",
  "How are you feeling right now?",
  "What's one thing you're grateful for?",
  "What's been on your mind lately?",
  "How would you describe your mood today?",
  "What's something you're looking forward to?",
  "What happened today that you want to remember?",
  "What's one small win from today?",
  "How are you taking care of yourself today?",
  "What would make today a good day?"
];

const WORK_GENERIC_PROMPTS = [
  "How's work going today?",
  "What's your top priority right now?",
  "Any wins to celebrate from work?",
  "What's challenging you at work?",
  "How's your energy level today?",
  "What would make today productive?"
];

/**
 * Extract open situations from recent entries
 */
const extractOpenSituations = (entries) => {
  const situations = [];
  const recentEntries = entries.slice(0, 20);

  recentEntries.forEach(entry => {
    // Look for @situation: tags
    const situationTags = entry.tags?.filter(t => t.startsWith('@situation:')) || [];
    situationTags.forEach(tag => {
      const situation = tag.replace('@situation:', '').replace(/_/g, ' ');
      if (!situations.some(s => s.tag === tag)) {
        situations.push({
          tag,
          situation,
          entryDate: entry.createdAt,
          entryText: entry.text?.substring(0, 200)
        });
      }
    });

    // Look for mentions of future events (yesterday's "tomorrow")
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const entryDate = entry.createdAt instanceof Date ? entry.createdAt : entry.createdAt?.toDate?.();

    if (entryDate && entryDate.toDateString() === yesterday.toDateString()) {
      const futureMentions = entry.text?.match(/tomorrow|tonight|later today|this evening/gi);
      if (futureMentions && entry.text) {
        situations.push({
          tag: null,
          situation: 'follow_up',
          entryDate: entry.createdAt,
          entryText: entry.text.substring(0, 200)
        });
      }
    }
  });

  return situations.slice(0, 3);
};

/**
 * Extract active goals from entries
 */
const extractActiveGoals = (entries) => {
  const goals = [];
  const goalMap = new Map();

  entries.slice(0, 50).forEach(entry => {
    const goalTags = entry.tags?.filter(t => t.startsWith('@goal:')) || [];
    goalTags.forEach(tag => {
      const goal = tag.replace('@goal:', '').replace(/_/g, ' ');
      if (!goalMap.has(tag)) {
        goalMap.set(tag, {
          tag,
          goal,
          mentions: 1,
          lastMentioned: entry.createdAt,
          status: entry.goal_update?.status || null
        });
      } else {
        goalMap.get(tag).mentions++;
      }
    });

    // Track goal updates
    if (entry.goal_update?.tag) {
      const existing = goalMap.get(entry.goal_update.tag);
      if (existing) {
        existing.status = entry.goal_update.status;
      }
    }
  });

  // Filter out achieved/abandoned goals
  goalMap.forEach((value, key) => {
    if (value.status !== 'achieved' && value.status !== 'abandoned') {
      goals.push(value);
    }
  });

  return goals.slice(0, 3);
};

/**
 * Generate situation follow-up prompts using AI
 */
const generateSituationPrompts = async (situations) => {
  if (situations.length === 0) return [];

  const prompt = `Generate brief, warm follow-up questions for these situations from a user's journal.
Each question should feel natural and caring, not clinical.

SITUATIONS:
${situations.map((s, i) => `${i + 1}. ${s.situation}: "${s.entryText}"`).join('\n')}

Return JSON array of questions only (1 per situation):
["Question 1?", "Question 2?"]

Rules:
- Keep questions short (under 15 words)
- Be warm and curious, not pushy
- Reference the specific situation naturally
- Examples: "How did that meeting go?", "Any updates on the apartment search?"`;

  try {
    const raw = await callGemini(prompt, '', 'gemini-2.0-flash');
    if (!raw) return [];
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateSituationPrompts error:', e);
    return [];
  }
};

/**
 * Generate goal check-in prompts
 */
const generateGoalPrompts = async (goals, entries) => {
  if (goals.length === 0) return [];

  // Check if any positive patterns exist for these goals
  const goalContext = goals.map(g => {
    const relatedEntries = entries.filter(e =>
      e.tags?.includes(g.tag) && e.analysis?.mood_score
    );
    const avgMood = relatedEntries.length > 0
      ? relatedEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / relatedEntries.length
      : null;
    return { ...g, avgMood, entryCount: relatedEntries.length };
  });

  const prompt = `Generate gentle goal check-in prompts based on the user's goals.
If they have positive mood data when doing the activity, encourage it.

GOALS:
${goalContext.map((g, i) => `${i + 1}. ${g.goal}${g.avgMood ? ` (mood when doing this: ${(g.avgMood * 100).toFixed(0)}%)` : ''}`).join('\n')}

Return JSON array of prompts (1 per goal):
["Prompt 1", "Prompt 2"]

Rules:
- Be encouraging, not guilt-inducing
- If high mood correlation, mention it: "Yoga usually lifts your mood - thinking about going today?"
- Keep under 20 words
- Examples: "Still planning on that morning run?", "Any progress on speaking up at meetings?"`;

  try {
    const raw = await callGemini(prompt, '', 'gemini-2.0-flash');
    if (!raw) return [];
    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateGoalPrompts error:', e);
    return [];
  }
};

/**
 * Generate pattern-based prompts (day of week, etc.)
 */
const generatePatternPrompts = (entries) => {
  const prompts = [];

  const cyclicalPatterns = detectCyclicalPatterns(entries);
  if (cyclicalPatterns?.pattern) {
    const today = new Date().getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[today];

    if (cyclicalPatterns.lowestDay === todayName && cyclicalPatterns.lowestAvg < 0.45) {
      prompts.push(`${todayName}s can be tough - how are you feeling today?`);
    } else if (cyclicalPatterns.highestDay === todayName && cyclicalPatterns.highestAvg > 0.65) {
      prompts.push(`${todayName}s are usually good for you - what's the plan today?`);
    }
  }

  return prompts;
};

/**
 * Generate mood trajectory prompts
 */
const generateMoodPrompts = (entries) => {
  const prompts = [];
  const moodTrajectory = computeMoodTrajectory(entries.slice(0, 10));

  if (!moodTrajectory) return prompts;

  if (moodTrajectory.lowStreak >= 3) {
    prompts.push("It's been a tough stretch. What's one small thing that might help today?");
  } else if (moodTrajectory.highStreak >= 3) {
    prompts.push("You've been doing well lately! What's contributing to that?");
  } else if (moodTrajectory.trend === 'declining') {
    prompts.push("How are you holding up? Anything weighing on you?");
  } else if (moodTrajectory.trend === 'improving') {
    prompts.push("Things seem to be looking up. What's been helping?");
  }

  return prompts;
};

/**
 * Generate proactive prompts from pattern analysis
 */
const generateProactivePrompts = (entries, category) => {
  const prompts = [];

  try {
    // Get proactive context from pattern analysis
    const proactiveInsights = generateProactiveContext(entries, category, null, []);

    // Convert insights to prompts
    proactiveInsights.slice(0, 2).forEach(insight => {
      let prompt = null;

      switch (insight.type) {
        case 'temporal_warning':
          prompt = insight.message.replace(/tend to be/g, 'can be') + ' How are you doing?';
          break;
        case 'temporal_positive':
          prompt = insight.message + ' What are you up to today?';
          break;
        case 'mood_suggestion':
          prompt = insight.message + '. Would that help today?';
          break;
        default:
          if (insight.message) {
            prompt = insight.message;
          }
      }

      if (prompt) {
        prompts.push({
          type: 'proactive',
          prompt,
          priority: insight.priority,
          entity: insight.entity
        });
      }
    });

    // Also add activity-based prompts from patterns with strong sentiment
    const activityPatterns = computeActivitySentiment(entries, category);
    const recentPositive = activityPatterns
      .filter(p => p.sentiment === 'positive' && p.entryCount >= 3 && p.moodDeltaPercent > 15)
      .slice(0, 1);

    recentPositive.forEach(pattern => {
      const daysSinceLastMention = pattern.lastMentioned
        ? Math.floor((new Date() - new Date(pattern.lastMentioned instanceof Date ? pattern.lastMentioned : pattern.lastMentioned?.toDate?.())) / (1000 * 60 * 60 * 24))
        : null;

      if (daysSinceLastMention && daysSinceLastMention > 5) {
        prompts.push({
          type: 'proactive',
          prompt: `It's been a while since ${pattern.entityName}. That usually lifts your mood - thinking about it today?`,
          priority: 'suggestion',
          entity: pattern.entity
        });
      }
    });

  } catch (e) {
    console.error('generateProactivePrompts error:', e);
  }

  return prompts;
};

/**
 * Main function to generate dashboard prompts
 * Returns 1-3 prompts based on priority hierarchy
 */
export const generateDashboardPrompts = async (entries, category = 'personal') => {
  const categoryEntries = entries.filter(e => e.category === category);
  const allPrompts = [];

  // Priority 1: Future follow-ups (HIGHEST - user mentioned being nervous/excited about today's events)
  const todayFollowUps = extractTodayFollowUps(categoryEntries);
  if (todayFollowUps.length > 0) {
    const followUpPrompts = await generateFollowUpPrompts(todayFollowUps);
    allPrompts.push(...followUpPrompts.map((p, i) => ({
      type: 'followup',
      prompt: p,
      event: todayFollowUps[i]?.event,
      sentiment: todayFollowUps[i]?.sentiment
    })));
  }

  // Priority 2: Proactive context (pattern-based, entity history)
  if (allPrompts.length < 2) {
    const proactivePrompts = generateProactivePrompts(categoryEntries, category);
    if (proactivePrompts.length > 0) {
      allPrompts.push(...proactivePrompts);
    }
  }

  // Priority 3: Open situations
  if (allPrompts.length < 2) {
    const situations = extractOpenSituations(categoryEntries);
    if (situations.length > 0) {
      const situationPrompts = await generateSituationPrompts(situations);
      allPrompts.push(...situationPrompts.map(p => ({ type: 'situation', prompt: p })));
    }
  }

  // Priority 4: Goal check-ins
  if (allPrompts.length < 2) {
    const goals = extractActiveGoals(categoryEntries);
    if (goals.length > 0) {
      const goalPrompts = await generateGoalPrompts(goals, categoryEntries);
      allPrompts.push(...goalPrompts.map(p => ({ type: 'goal', prompt: p })));
    }
  }

  // Priority 5: Pattern-based (day of week)
  if (allPrompts.length < 2) {
    const patternPrompts = generatePatternPrompts(categoryEntries);
    allPrompts.push(...patternPrompts.map(p => ({ type: 'pattern', prompt: p })));
  }

  // Priority 6: Mood trajectory
  if (allPrompts.length < 2) {
    const moodPrompts = generateMoodPrompts(categoryEntries);
    allPrompts.push(...moodPrompts.map(p => ({ type: 'mood', prompt: p })));
  }

  // Priority 7: Generic fallback
  if (allPrompts.length === 0) {
    const genericPool = category === 'work' ? WORK_GENERIC_PROMPTS : GENERIC_PROMPTS;
    const shuffled = [...genericPool].sort(() => Math.random() - 0.5);
    allPrompts.push(...shuffled.slice(0, 3).map(p => ({ type: 'generic', prompt: p })));
  }

  // Ensure we don't return more than 3
  return allPrompts.slice(0, 3);
};

/**
 * Generate the day summary with sections for the dashboard
 */
export const generateDaySummary = async (todayEntries, allEntries, category) => {
  if (todayEntries.length === 0) return null;

  const categoryEntries = allEntries.filter(e => e.category === category);
  const recentEntries = categoryEntries.slice(0, 20);

  const entriesContext = todayEntries.map((e, i) => {
    const time = e.createdAt instanceof Date
      ? e.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : e.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
    return `[${time}] ${e.text}`;
  }).join('\n\n');

  // Get action items from yesterday that might carry forward
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0));
  const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999));

  const yesterdayEntries = categoryEntries.filter(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.();
    return entryDate >= yesterdayStart && entryDate <= yesterdayEnd;
  });

  const yesterdayTasks = yesterdayEntries
    .flatMap(e => e.extracted_tasks || [])
    .filter(t => !t.completed);

  const todayTasks = todayEntries
    .flatMap(e => e.extracted_tasks || []);

  const prompt = `Analyze today's journal entries and create a dashboard summary.

TODAY'S ENTRIES:
${entriesContext}

${yesterdayTasks.length > 0 ? `INCOMPLETE TASKS FROM YESTERDAY:\n${yesterdayTasks.map(t => `- ${t.text}`).join('\n')}` : ''}

${todayTasks.length > 0 ? `TASKS MENTIONED TODAY:\n${todayTasks.map(t => `- ${t.text} ${t.completed ? '(done)' : ''}`).join('\n')}` : ''}

Create a summary with these sections. Return JSON:
{
  "wins": {
    "items": ["Brief win or positive thing 1", "Brief win 2"],
    "tone": "encouraging" | "celebrating" | "acknowledging"
  },
  "challenges": {
    "items": ["Challenge or concern 1", "Challenge 2"],
    "cbt_reframe": "A gentle perspective shift if appropriate, or null",
    "tone": "supportive" | "validating" | "problem-solving"
  },
  "action_items": {
    "today": ["Task from today's entries"],
    "carried_forward": ["Incomplete task from yesterday"],
    "suggested": ["Optional suggested action based on entries, or empty"]
  },
  "patterns": {
    "observations": ["Pattern or insight if any"],
    "mood_note": "Brief mood observation or null"
  },
  "overall_mood": 0.0-1.0,
  "one_liner": "A single sentence capturing the day's essence"
}

Rules:
- Be concise - each item should be 1 short sentence max
- Empty arrays are fine if nothing fits that category
- For challenges, provide supportive reframes, not advice
- Don't manufacture patterns - only note real observations
- Keep the one_liner warm and human`;

  try {
    const raw = await callGemini(prompt, '');
    if (!raw) return null;

    let jsonStr = raw;
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    } else {
      jsonStr = raw.replace(/```json|```/g, '').trim();
    }

    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateDaySummary error:', e);
    return null;
  }
};

/**
 * Infer category from entry text using AI
 */
export const inferCategory = async (text) => {
  const prompt = `Classify this journal entry as either "personal" or "work".

Entry: "${text}"

Consider:
- Work: job tasks, colleagues, meetings, deadlines, career, professional development
- Personal: family, friends, health, hobbies, emotions, relationships, self-care

Return JSON only:
{ "category": "personal" | "work", "confidence": 0.0-1.0 }

If truly ambiguous, default to "personal".`;

  try {
    const raw = await callGemini(prompt, '', 'gemini-2.0-flash');
    if (!raw) return { category: 'personal', confidence: 0.5 };

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(jsonStr);
    return {
      category: result.category || 'personal',
      confidence: result.confidence || 0.5
    };
  } catch (e) {
    console.error('inferCategory error:', e);
    return { category: 'personal', confidence: 0.5 };
  }
};

export default {
  generateDashboardPrompts,
  generateDaySummary,
  inferCategory
};
