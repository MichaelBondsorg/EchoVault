import { callGemini } from '../ai';
import { cosineSimilarity } from '../ai/embeddings';
import { AI_CONFIG } from '../../config';

/**
 * Classify entry into type: task, mixed, reflection, or vent
 */
export const classifyEntry = async (text) => {
  const prompt = `
    Classify this journal entry into ONE of these types:
    - "task": Pure task/todo list, no emotional content (e.g., "Need to buy groceries, call mom")
    - "mixed": Contains both tasks AND emotional reflection (e.g., "Feeling stressed about the deadline, need to finish report")
    - "reflection": Emotional processing, self-reflection, no tasks (e.g., "I've been thinking about my relationship...")
    - "vent": Emotional release, dysregulated state, needs validation not advice (e.g., "I can't take this anymore, everything is falling apart")

    Return JSON only:
    {
      "entry_type": "task" | "mixed" | "reflection" | "vent",
      "confidence": 0.0-1.0,
      "extracted_tasks": [{
        "text": "Buy milk",
        "completed": false,
        "recurrence": null | {
          "pattern": "daily" | "weekly" | "biweekly" | "monthly" | "custom",
          "interval": 1,
          "unit": "days" | "weeks" | "months",
          "description": "every two weeks"
        }
      }]
    }

    TASK EXTRACTION RULES (only for task/mixed types):
    - Extract ONLY explicit tasks/to-dos
    - Keep text concise (verb + object)
    - SKIP vague intentions ("I should exercise more" → NOT a task)
    - SKIP emotional statements ("I need to feel better" → NOT a task)
    - If no clear tasks, return empty array

    RECURRENCE DETECTION:
    - Look for patterns like "every day", "weekly", "every two weeks", "biweekly", "monthly", "every X days/weeks/months"
    - Examples:
      - "Water plants every two weeks" → pattern: "biweekly", interval: 2, unit: "weeks"
      - "Take medication daily" → pattern: "daily", interval: 1, unit: "days"
      - "Weekly team meeting" → pattern: "weekly", interval: 1, unit: "weeks"
    - If no recurrence pattern is found, set recurrence to null
  `;

  try {
    const raw = await callGemini(prompt, text, AI_CONFIG.classification.primary);
    if (!raw) {
      return { entry_type: 'reflection', confidence: 0.5, extracted_tasks: [] };
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // Normalize tasks to ensure they have all required fields
    const normalizedTasks = Array.isArray(parsed.extracted_tasks)
      ? parsed.extracted_tasks.map(task => ({
          text: task.text || '',
          completed: task.completed || false,
          recurrence: task.recurrence || null,
          completedAt: null,
          nextDueDate: task.recurrence ? new Date().toISOString() : null
        }))
      : [];

    return {
      entry_type: parsed.entry_type || 'reflection',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      extracted_tasks: normalizedTasks
    };
  } catch (e) {
    console.error('classifyEntry error:', e);
    return { entry_type: 'reflection', confidence: 0.5, extracted_tasks: [] };
  }
};

/**
 * Analyze entry and route to appropriate therapeutic framework
 */
export const analyzeEntry = async (text, entryType = 'reflection') => {
  if (entryType === 'task') {
    return {
      title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: ['task'],
      mood_score: null,
      framework: 'general',
      entry_type: 'task'
    };
  }

  if (entryType === 'vent') {
    const currentHour = new Date().getHours();
    const isLateNight = currentHour >= 22 || currentHour < 5;

    const ventPrompt = `
      This person is venting and needs validation, NOT advice.
      ${isLateNight ? 'CONTEXT: It is late night/early morning. Favor gentle, sleep-compatible techniques.' : ''}

      CRITICAL RULES:
      - DO NOT challenge their thoughts
      - DO NOT offer solutions or advice
      - DO NOT minimize ("at least...", "it could be worse...")
      - DO NOT use "have you considered..."

      Goal: Lower physiological arousal through validation and grounding.

      COOLDOWN TECHNIQUES (choose the most appropriate):
      - "grounding": 5-4-3-2-1 senses, name objects in room, feel feet on floor
      - "breathing": Box breathing, 4-7-8 technique, slow exhales
      - "sensory": Cold water on wrists, hold ice, splash face
      - "movement": Shake hands vigorously, walk to another room, stretch
      - "temperature": Hold something cold, step outside briefly, cool washcloth
      - "bilateral": Tap alternating knees, cross-body movements, butterfly hug
      - "vocalization": Hum, sigh loudly, low "voo" sound, humming exhale
      ${isLateNight ? '(Prefer: breathing, grounding, bilateral, vocalization - avoid movement/temperature at night)' : ''}

      Return JSON:
      {
        "title": "Short empathetic title (max 6 words)",
        "tags": ["Tag1", "Tag2"],
        "mood_score": 0.0-1.0 (0.0=very distressed, 1.0=calm),
        "validation": "A warm, empathetic validation of their feelings (2-3 sentences)",
        "cooldown": {
          "technique": "grounding" | "breathing" | "sensory" | "movement" | "temperature" | "bilateral" | "vocalization",
          "instruction": "Simple 1-2 sentence instruction appropriate for ${isLateNight ? 'late night' : 'this time of day'}"
        }
      }
    `;

    try {
      const raw = await callGemini(ventPrompt, text);
      if (!raw) {
        return {
          title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
          tags: [],
          mood_score: 0.3,
          framework: 'support',
          entry_type: 'vent'
        };
      }

      const jsonStr = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title || text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : 0.3,
        framework: 'support',
        entry_type: 'vent',
        vent_support: {
          validation: parsed.validation || "It's okay to feel this way. Your feelings are valid.",
          cooldown: parsed.cooldown || { technique: 'breathing', instruction: 'Take a slow, deep breath.' }
        }
      };
    } catch (e) {
      console.error('analyzeEntry (vent) error:', e);
      return {
        title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: [],
        mood_score: 0.3,
        framework: 'support',
        entry_type: 'vent'
      };
    }
  }

  const currentHour = new Date().getHours();
  const timeContext = currentHour >= 22 || currentHour < 5 ? 'late_night'
    : currentHour < 12 ? 'morning'
    : currentHour < 17 ? 'afternoon'
    : 'evening';

  const prompt = `
    Analyze this journal entry and route to the appropriate therapeutic framework.

    CONTEXT: Entry submitted during ${timeContext} (${currentHour}:00)
    ${entryType === 'mixed' ? 'NOTE: This entry contains both tasks AND emotional content. Acknowledge the emotional weight of their to-do list.' : ''}

    ROUTING LOGIC (choose ONE framework):
    1. "cbt" - IF text shows anxiety, negative self-talk, or cognitive distortion
    2. "celebration" - IF text describes wins, accomplishments, gratitude, joy, or positive experiences
    3. "general" - For neutral observations, casual updates, or mixed content without strong emotion

    RESPONSE DEPTH (based on emotional intensity):
    - mood_score 0.6+ (positive/neutral): Light response - validation or affirmation only
    - mood_score 0.4-0.6 (mixed): Medium response - add perspective if helpful
    - mood_score 0.2-0.4 (struggling): Full response - include behavioral suggestions
    - mood_score <0.2 (distressed): Full response + always include behavioral_activation

    TIME-AWARE SUGGESTIONS:
    - late_night: Favor sleep hygiene, gentle grounding, avoid "go for a walk" type suggestions
    - morning: Can suggest movement, planning, fresh starts
    - afternoon/evening: Standard suggestions appropriate

    Return JSON:
    {
      "title": "Short creative title (max 6 words)",
      "tags": ["Tag1", "Tag2"],
      "mood_score": 0.5 (0.0=bad, 1.0=good),
      "framework": "cbt" | "celebration" | "general",

      "cbt_breakdown": {
        "automatic_thought": "The negative thought pattern identified (or null if not clear)",
        "distortion": "Cognitive distortion label (or null if minor/not worth highlighting)",
        "validation": "Empathetic acknowledgment (1-2 sentences) - ALWAYS include for cbt",
        "perspective": "Question to consider: [question] — Alternative view: [reframe] (or null if mood > 0.5)",
        "behavioral_activation": {
          "activity": "A simple activity under 5 minutes, appropriate for ${timeContext}",
          "rationale": "Why this helps (1 sentence)"
        }
      },

      "celebration": {
        "affirmation": "Warm acknowledgment of their positive moment (1-2 sentences)",
        "amplify": "Optional prompt to savor or deepen the positive feeling (or null if not needed)"
      },

      "task_acknowledgment": "Brief empathetic note about their to-do list load (or null)"
    }

    IMPORTANT: Return null for any field that isn't genuinely useful. Less is more.
  `;

  try {
    const raw = await callGemini(prompt, text);

    if (!raw) {
      console.error('analyzeEntry: No response from Gemini API');
      return {
        title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: [],
        mood_score: 0.5,
        framework: 'general',
        entry_type: entryType
      };
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const result = {
      title: parsed.title || text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : 0.5,
      framework: parsed.framework || 'general',
      entry_type: entryType
    };

    if (parsed.cbt_breakdown && typeof parsed.cbt_breakdown === 'object' && Object.keys(parsed.cbt_breakdown).length > 0) {
      result.cbt_breakdown = parsed.cbt_breakdown;
    }

    if (parsed.celebration && typeof parsed.celebration === 'object') {
      result.celebration = parsed.celebration;
    }

    if (parsed.task_acknowledgment) {
      result.task_acknowledgment = parsed.task_acknowledgment;
    }

    return result;
  } catch (e) {
    console.error('analyzeEntry error:', e);
    return {
      title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: [],
      mood_score: 0.5,
      framework: 'general',
      entry_type: entryType
    };
  }
};

/**
 * Compute mood trajectory from recent entries
 */
export const computeMoodTrajectory = (recentEntries) => {
  const validEntries = recentEntries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .slice(0, 7);

  if (validEntries.length < 2) return null;

  const scores = validEntries.map(e => e.analysis.mood_score);
  const avgMood = scores.reduce((a, b) => a + b, 0) / scores.length;
  const latestMood = scores[0];
  const oldestMood = scores[scores.length - 1];
  const trend = latestMood - oldestMood;

  let lowStreak = 0;
  let highStreak = 0;
  for (const score of scores) {
    if (score < 0.4) lowStreak++;
    else break;
  }
  for (const score of scores) {
    if (score > 0.6) highStreak++;
    else break;
  }

  return {
    average: avgMood.toFixed(2),
    trend: trend > 0.1 ? 'improving' : trend < -0.1 ? 'declining' : 'stable',
    lowStreak: lowStreak >= 2 ? lowStreak : 0,
    highStreak: highStreak >= 2 ? highStreak : 0,
    description: lowStreak >= 3 ? `User has been struggling for ${lowStreak} entries` :
                 highStreak >= 3 ? `User has been doing well for ${highStreak} entries` :
                 trend > 0.15 ? 'Mood is improving recently' :
                 trend < -0.15 ? 'Mood has been declining recently' :
                 'Mood is relatively stable'
  };
};

/**
 * Detect cyclical day-of-week patterns
 */
export const detectCyclicalPatterns = (entries) => {
  if (entries.length < 14) return null;

  const dayOfWeekMoods = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  entries.forEach(e => {
    if (e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined) {
      const date = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
      const dayOfWeek = date.getDay();
      dayOfWeekMoods[dayOfWeek].push(e.analysis.mood_score);
    }
  });

  let lowestDay = null;
  let lowestAvg = 1;
  let highestDay = null;
  let highestAvg = 0;

  for (let day = 0; day < 7; day++) {
    const scores = dayOfWeekMoods[day];
    if (scores.length >= 2) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (avg < lowestAvg) {
        lowestAvg = avg;
        lowestDay = dayNames[day];
      }
      if (avg > highestAvg) {
        highestAvg = avg;
        highestDay = dayNames[day];
      }
    }
  }

  if (highestAvg - lowestAvg < 0.15) return null;

  return {
    lowestDay,
    lowestAvg: lowestAvg.toFixed(2),
    highestDay,
    highestAvg: highestAvg.toFixed(2),
    pattern: lowestAvg < 0.4 ? `${lowestDay}s tend to be harder for you` :
             highestAvg > 0.7 ? `${highestDay}s are usually your best days` : null
  };
};

/**
 * Generate contextual insight by analyzing patterns in history
 */
export const generateInsight = async (current, relevantHistory, recentHistory, allEntries = []) => {
  const historyMap = new Map();
  [...recentHistory, ...relevantHistory].forEach(e => historyMap.set(e.id, e));
  const uniqueHistory = Array.from(historyMap.values());

  if (uniqueHistory.length === 0) return null;

  const today = new Date();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()];

  const context = uniqueHistory.map(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt.toDate();
    const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    const moodInfo = e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined
      ? ` [mood: ${e.analysis.mood_score.toFixed(1)}]` : '';
    return `[${entryDate.toLocaleDateString()} - ${daysAgo} days ago]${moodInfo}${tags ? ` {${tags}}` : ''} ${e.text}`;
  }).join('\n');

  const moodTrajectory = computeMoodTrajectory(recentHistory);
  const moodContext = moodTrajectory
    ? `\nMOOD TRAJECTORY: ${moodTrajectory.description} (avg: ${moodTrajectory.average}, trend: ${moodTrajectory.trend})`
    : '';

  const cyclicalPatterns = allEntries.length >= 14 ? detectCyclicalPatterns(allEntries) : null;
  const cyclicalContext = cyclicalPatterns?.pattern
    ? `\nCYCLICAL PATTERN DETECTED: ${cyclicalPatterns.pattern}`
    : '';

  const selfStatements = uniqueHistory
    .flatMap(e => e.tags?.filter(t => t.startsWith('@self:')) || [])
    .filter((t, i, arr) => arr.indexOf(t) === i);
  const selfContext = selfStatements.length > 0
    ? `\nSELF-STATEMENTS FROM HISTORY: ${selfStatements.join(', ')}`
    : '';

  const activeGoals = uniqueHistory
    .flatMap(e => e.tags?.filter(t => t.startsWith('@goal:')) || [])
    .filter((t, i, arr) => arr.indexOf(t) === i);
  const goalContext = activeGoals.length > 0
    ? `\nACTIVE GOALS: ${activeGoals.join(', ')}`
    : '';

  const prompt = `
    You are a proactive memory assistant analyzing journal entries.
    Today's date: ${today.toLocaleDateString()} (${dayOfWeek})
    ${moodContext}${cyclicalContext}${selfContext}${goalContext}

    INSIGHT TYPES (choose the most appropriate):
    - "warning": Negative pattern recurring (same trigger → same negative outcome)
    - "encouragement": User showing resilience or growth compared to past
    - "pattern": Neutral observation of recurring theme
    - "reminder": Direct callback to something user mentioned before
    - "progress": Positive trend or improvement over time
    - "streak": Consistent positive behavior (3+ occurrences)
    - "absence": Something negative that used to appear frequently but hasn't lately
    - "contradiction": User's current behavior contradicts their self-statement (use gently!)
    - "goal_check": Follow-up on a previously stated goal
    - "cyclical": Day-of-week or time-based pattern observation

    TEMPORAL REFERENCE RESOLUTION (CRITICAL):
    Entries use relative time references like "yesterday", "last night", "tomorrow", "tonight", etc.
    You MUST resolve these relative to EACH ENTRY'S DATE (shown in brackets), not today's date.

    Example: If an entry from [12/5/2024] says "going to an event tomorrow" and the current entry
    from [12/6/2024] says "went to the event last night" - these refer to the SAME EVENT.
    Do NOT count this as two separate occurrences or a "pattern" of attending events.

    STRUCTURED TAG AWARENESS:
    - @person:name = recurring person in user's life
    - @place:location = recurring location
    - @goal:intention = something user wants to achieve
    - @situation:context = ongoing multi-day situation
    - @self:statement = how user describes themselves

    TIME-BOXING RULES (CRITICAL):
    - "Recurring theme" requires 3+ mentions within 14 days
    - "Warning" patterns should be within 7 days
    - "Progress/streak" should compare against 30 days ago
    - Don't flag patterns from entries older than 60 days unless truly significant

    If the connection feels forced, weak, or the entries are too old, return { "found": false }.

    Output JSON:
    {
      "found": true,
      "type": "warning" | "encouragement" | "pattern" | "reminder" | "progress" | "streak" | "absence" | "contradiction" | "goal_check" | "cyclical",
      "message": "Concise, insightful observation (1-2 sentences max)",
      "followUpQuestions": ["Relevant question 1?", "Relevant question 2?"]
    }
  `;

  try {
    const raw = await callGemini(prompt, `HISTORY:\n${context}\n\nCURRENT ENTRY [${today.toLocaleDateString()} - written just now]:\n${current}`);

    if (!raw) {
      console.error('generateInsight: No response from Gemini API');
      return null;
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('generateInsight error:', e);
    return null;
  }
};

/**
 * Extract enhanced context (entities, goals, situations) from entry
 *
 * Entity Types:
 * - @person:name - People mentioned (sarah, mom, dr_smith)
 * - @place:name - Locations (office, gym, home)
 * - @goal:description - Goals/intentions (exercise_more, speak_up_at_work)
 * - @situation:description - Multi-day events (job_interview_process)
 * - @self:statement - Self-descriptions (always_late, never_asks_for_help)
 * - @activity:name - Activities/hobbies (yoga, hiking, cooking)
 * - @media:name - Shows/movies/books (succession, oppenheimer)
 * - @event:name - Specific events (job_interview, dinner_party)
 * - @food:name - Restaurants/food (sushi_place, pizza_joint)
 * - @topic:name - Discussion topics (work_stress, relationship)
 */
export const extractEnhancedContext = async (text, recentEntries = []) => {
  const recentContext = recentEntries.slice(0, 10).map(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
    const tags = e.tags || [];
    return `[${entryDate.toLocaleDateString()}] Tags: ${tags.join(', ') || 'none'} | ${e.text?.substring(0, 200) || ''}`;
  }).join('\n');

  const prompt = `
    Extract structured context from this journal entry.

    EXISTING CONTEXT FROM RECENT ENTRIES:
    ${recentContext || 'No recent entries'}

    EXTRACTION RULES (use lowercase, underscore-separated names):

    1. PEOPLE (@person:name)
       - Real people with names or clear identifiers (mom, dad, boss, therapist)
       - Skip generic references ("someone", "people", "they")
       - Examples: @person:sarah, @person:mom, @person:dr_smith

    2. PLACES (@place:name)
       - Specific locations that might recur
       - Examples: @place:office, @place:gym, @place:coffee_shop

    3. ACTIVITIES (@activity:name) - NEW
       - Hobbies, exercises, regular activities
       - Examples: @activity:yoga, @activity:hiking, @activity:cooking, @activity:gaming

    4. MEDIA (@media:name) - NEW
       - Shows, movies, books, podcasts, games being consumed
       - Examples: @media:succession, @media:oppenheimer, @media:atomic_habits

    5. EVENTS (@event:name) - NEW
       - Specific one-time or recurring events
       - Examples: @event:job_interview, @event:dinner_party, @event:doctors_appointment

    6. FOOD/RESTAURANTS (@food:name) - NEW
       - Specific restaurants, cuisines, or food experiences
       - Examples: @food:sushi_place, @food:italian_restaurant, @food:new_thai_spot

    7. TOPICS (@topic:name) - NEW
       - Main discussion themes/concerns
       - Examples: @topic:work_stress, @topic:relationship, @topic:health, @topic:finances

    8. GOALS/INTENTIONS (@goal:description)
       - Explicit goals: "I want to...", "I need to...", "I'm going to..."
       - Examples: @goal:exercise_more, @goal:speak_up_at_work

    9. ONGOING SITUATIONS (@situation:description)
       - Multi-day events or circumstances
       - Examples: @situation:job_search, @situation:apartment_hunting

    10. SELF-STATEMENTS (@self:statement)
        - "I always...", "I never...", "I'm the kind of person who..."
        - Examples: @self:always_late, @self:overthinks

    Return JSON:
    {
      "structured_tags": ["@type:name", ...],
      "topic_tags": ["general", "topic", "tags"],
      "continues_situation": "@situation:tag_from_recent_entries_if_this_continues_it" or null,
      "goal_update": {
        "tag": "@goal:tag_if_this_updates_a_previous_goal",
        "status": "progress" | "achieved" | "abandoned" | "struggling" | null
      } or null,
      "sentiment_by_entity": {
        "@entity:name": "positive" | "negative" | "neutral" | "mixed"
      }
    }

    Be conservative - only extract what's clearly present. Empty arrays/objects are fine.
  `;

  try {
    const raw = await callGemini(prompt, text, AI_CONFIG.classification.primary);
    if (!raw) return { structured_tags: [], topic_tags: [], continues_situation: null, goal_update: null, sentiment_by_entity: {} };

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      structured_tags: parsed.structured_tags || [],
      topic_tags: parsed.topic_tags || [],
      continues_situation: parsed.continues_situation || null,
      goal_update: parsed.goal_update || null,
      sentiment_by_entity: parsed.sentiment_by_entity || {}
    };
  } catch (e) {
    console.error('extractEnhancedContext error:', e);
    return { structured_tags: [], topic_tags: [], continues_situation: null, goal_update: null, sentiment_by_entity: {} };
  }
};

/**
 * Find entries by tag prefix
 */
export const findEntriesByTag = (entries, tagPrefix) => {
  return entries.filter(e =>
    e.tags?.some(t => t.startsWith(tagPrefix))
  );
};

/**
 * Get smart chat context using semantic + tag-based matching
 */
export const getSmartChatContext = async (entries, question, questionEmbedding) => {
  let semanticMatches = [];
  if (questionEmbedding) {
    semanticMatches = entries
      .filter(e => e.embedding)
      .map(e => ({
        ...e,
        similarity: cosineSimilarity(questionEmbedding, e.embedding)
      }))
      .filter(e => e.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
  }

  const questionLower = question.toLowerCase();
  const tagMatches = [];

  const personMatches = entries.filter(e =>
    e.tags?.some(t => t.startsWith('@person:') && questionLower.includes(t.replace('@person:', '').replace('_', ' ')))
  );
  tagMatches.push(...personMatches);

  const situationMatches = entries.filter(e =>
    e.tags?.some(t => t.startsWith('@situation:') &&
      questionLower.split(' ').some(word => t.toLowerCase().includes(word) && word.length > 3))
  );
  tagMatches.push(...situationMatches);

  const goalMatches = entries.filter(e =>
    e.tags?.some(t => t.startsWith('@goal:') &&
      questionLower.split(' ').some(word => t.toLowerCase().includes(word) && word.length > 3))
  );
  tagMatches.push(...goalMatches);

  const recentEntries = entries.slice(0, 5);

  const allMatches = new Map();
  [...semanticMatches, ...tagMatches, ...recentEntries].forEach(e => {
    if (!allMatches.has(e.id)) {
      allMatches.set(e.id, e);
    }
  });

  return Array.from(allMatches.values()).slice(0, 20);
};

/**
 * Ask the journal AI a question
 */
export const askJournalAI = async (entries, question, questionEmbedding = null) => {
  const relevantEntries = await getSmartChatContext(entries, question, questionEmbedding);

  const context = relevantEntries.map(e => {
    const date = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    return `[${date.toLocaleDateString()}] [${e.title}] ${tags ? `{${tags}} ` : ''}${e.text}`;
  }).join('\n');

  const systemPrompt = `You are a helpful journal assistant with access to the user's personal entries.

CONTEXT FROM JOURNAL ENTRIES:
${context}

INSTRUCTIONS:
- Answer based ONLY on the journal entries provided
- Reference specific dates when relevant
- Notice patterns across entries (recurring people, places, goals, situations)
- Tags starting with @ indicate: @person:name, @place:location, @goal:intention, @situation:ongoing_context, @self:self_statement
- Use ### headers and * bullets for formatting
- Be warm and personal - this is someone's private journal`;

  return await callGemini(systemPrompt, question);
};
