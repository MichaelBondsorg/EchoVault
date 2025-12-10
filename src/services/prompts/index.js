import { callGemini } from '../ai';
import { computeMoodTrajectory, detectCyclicalPatterns } from '../analysis';

/**
 * Prompt Priority Hierarchy:
 * 1. Open situations - "How did that meeting go?" (highest value - continuity)
 * 2. Goal check-ins - "Still planning to hit the gym?" (accountability)
 * 3. Pattern-based - "You usually feel anxious on Mondays. How are you feeling?"
 * 4. Mood trajectory - "You've been in a low stretch. What's one small win today?"
 * 5. Generic journaling - "What's on your mind?" (fallback)
 */

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
 * Main function to generate dashboard prompts
 * Returns 1-3 prompts based on priority hierarchy
 */
export const generateDashboardPrompts = async (entries, category = 'personal') => {
  const categoryEntries = entries.filter(e => e.category === category);
  const allPrompts = [];

  // Priority 1: Open situations
  const situations = extractOpenSituations(categoryEntries);
  if (situations.length > 0) {
    const situationPrompts = await generateSituationPrompts(situations);
    allPrompts.push(...situationPrompts.map(p => ({ type: 'situation', prompt: p })));
  }

  // Priority 2: Goal check-ins
  const goals = extractActiveGoals(categoryEntries);
  if (goals.length > 0 && allPrompts.length < 2) {
    const goalPrompts = await generateGoalPrompts(goals, categoryEntries);
    allPrompts.push(...goalPrompts.map(p => ({ type: 'goal', prompt: p })));
  }

  // Priority 3: Pattern-based
  if (allPrompts.length < 2) {
    const patternPrompts = generatePatternPrompts(categoryEntries);
    allPrompts.push(...patternPrompts.map(p => ({ type: 'pattern', prompt: p })));
  }

  // Priority 4: Mood trajectory
  if (allPrompts.length < 2) {
    const moodPrompts = generateMoodPrompts(categoryEntries);
    allPrompts.push(...moodPrompts.map(p => ({ type: 'mood', prompt: p })));
  }

  // Priority 5: Generic fallback
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
