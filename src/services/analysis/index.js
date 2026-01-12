import { analyzeJournalEntryCloud } from '../ai/gemini';
import { cosineSimilarity } from '../ai/embeddings';
import { askJournalAIFn } from '../../config/firebase';

/**
 * Classify entry into type: task, mixed, reflection, or vent
 * Now uses Cloud Function (which handles recurrence detection)
 */
export const classifyEntry = async (text) => {
  try {
    const result = await analyzeJournalEntryCloud(text, {
      operations: ['classify']
    });

    if (!result?.classification) {
      return { entry_type: 'reflection', confidence: 0.5, extracted_tasks: [] };
    }

    return result.classification;
  } catch (e) {
    console.error('classifyEntry error:', e);
    return { entry_type: 'reflection', confidence: 0.5, extracted_tasks: [] };
  }
};

/**
 * Analyze entry and route to appropriate therapeutic framework
 * Now uses Cloud Function
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

  try {
    // First classify to get entry type if not provided
    const classifyResult = await analyzeJournalEntryCloud(text, {
      operations: ['classify', 'analyze']
    });

    if (!classifyResult?.analysis) {
      return {
        title: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: [],
        mood_score: 0.5,
        framework: 'general',
        entry_type: entryType
      };
    }

    return classifyResult.analysis;
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
 * Now uses Cloud Function
 *
 * @param {string} current - Current entry text
 * @param {Array} relevantHistory - Semantically relevant past entries
 * @param {Array} recentHistory - Recent entries
 * @param {Array} allEntries - All entries for pattern detection
 * @param {Array} pendingPrompts - Optional: pending reflection prompts to check if addressed
 */
export const generateInsight = async (current, relevantHistory, recentHistory, allEntries = [], pendingPrompts = []) => {
  const historyMap = new Map();
  [...recentHistory, ...relevantHistory].forEach(e => historyMap.set(e.id, e));
  const uniqueHistory = Array.from(historyMap.values());

  if (uniqueHistory.length === 0) return null;

  const today = new Date();

  // Build history context string
  const historyContext = uniqueHistory.map(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt.toDate();
    const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    const moodInfo = e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined
      ? ` [mood: ${e.analysis.mood_score.toFixed(1)}]` : '';
    return `[${entryDate.toLocaleDateString()} - ${daysAgo} days ago]${moodInfo}${tags ? ` {${tags}}` : ''} ${e.text}`;
  }).join('\n');

  const moodTrajectory = computeMoodTrajectory(recentHistory);
  const cyclicalPatterns = allEntries.length >= 14 ? detectCyclicalPatterns(allEntries) : null;

  try {
    const result = await analyzeJournalEntryCloud(current, {
      historyContext,
      moodTrajectory,
      cyclicalPatterns,
      pendingPrompts: pendingPrompts.length > 0 ? pendingPrompts : undefined,
      operations: ['generateInsight']
    });

    return result?.insight || null;
  } catch (e) {
    console.error('generateInsight error:', e);
    return null;
  }
};

/**
 * Extract enhanced context (entities, goals, situations) from entry
 * Now uses Cloud Function
 *
 * Entity Types supported:
 * - @person:name - People mentioned (sarah, mom, dr_smith)
 * - @place:name - Locations (office, gym, home)
 * - @activity:name - Activities/hobbies (yoga, hiking, cooking)
 * - @media:name - Shows/movies/books (succession, oppenheimer)
 * - @event:name - Specific events (job_interview, dinner_party)
 * - @food:name - Restaurants/food (sushi_place, pizza_joint)
 * - @topic:name - Discussion topics (work_stress, relationship)
 * - @goal:description - Goals/intentions (exercise_more, speak_up_at_work)
 * - @situation:description - Multi-day events (job_interview_process)
 * - @self:statement - Self-descriptions (always_late, never_asks_for_help)
 */
export const extractEnhancedContext = async (text, recentEntries = []) => {
  const recentContext = recentEntries.slice(0, 10).map(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
    const tags = e.tags || [];
    return `[${entryDate.toLocaleDateString()}] Tags: ${tags.join(', ') || 'none'} | ${e.text?.substring(0, 200) || ''}`;
  }).join('\n');

  try {
    const result = await analyzeJournalEntryCloud(text, {
      recentEntriesContext: recentContext,
      operations: ['extractContext']
    });

    return result?.enhancedContext || { structured_tags: [], topic_tags: [], continues_situation: null, goal_update: null, sentiment_by_entity: {} };
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
 * Generate a summary of entries for a specific day
 * Used by the 30-Day Journey modal
 *
 * @param {Array} dayEntries - All entries for the day
 * @returns {Object} - { summary, moodDrivers, themes }
 */
export const generateDaySummary = async (dayEntries) => {
  if (!dayEntries || dayEntries.length === 0) {
    return null;
  }

  // Build context from day's entries
  const entriesContext = dayEntries.map(e => {
    const time = e.effectiveDate || e.createdAt;
    const d = time?.toDate?.() || new Date(time);
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const moodStr = e.analysis?.mood_score !== undefined
      ? ` [mood: ${(e.analysis.mood_score * 100).toFixed(0)}%]`
      : '';
    const themes = e.analysis?.themes?.join(', ') || '';
    return `[${timeStr}]${moodStr}${themes ? ` {${themes}}` : ''}\n${e.text || e.contextualInsight?.briefSummary || 'Voice entry'}`;
  }).join('\n\n---\n\n');

  // Calculate average mood
  const moodScores = dayEntries
    .filter(e => e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const avgMood = moodScores.length > 0
    ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length
    : null;

  try {
    const result = await askJournalAIFn({
      question: `Summarize this day's journal entries in plain text. What were the main themes? What contributed positively or negatively to the mood? Keep it concise (2-3 sentences).

IMPORTANT: Do NOT use any markdown formatting (no #, *, -, or other special characters). Write in plain conversational prose only.

Average mood score: ${avgMood !== null ? (avgMood * 100).toFixed(0) + '%' : 'unknown'}

Entries:
${entriesContext}`,
      entriesContext: '' // Context is in the question
    });

    if (!result?.data?.response) {
      return {
        summary: 'Unable to generate summary.',
        moodDrivers: { positive: [], negative: [] },
        themes: []
      };
    }

    // Strip any remaining markdown formatting
    let summary = result.data.response
      .replace(/^#{1,6}\s*/gm, '') // Remove heading markers
      .replace(/\*\*/g, '')        // Remove bold markers
      .replace(/\*/g, '')          // Remove italic/bullet markers
      .replace(/^-\s*/gm, '')      // Remove list markers
      .replace(/`/g, '')           // Remove code markers
      .trim();

    return {
      summary,
      avgMood,
      entryCount: dayEntries.length
    };
  } catch (e) {
    console.error('generateDaySummary error:', e);
    return {
      summary: 'Unable to generate summary at this time.',
      avgMood,
      entryCount: dayEntries.length
    };
  }
};

/**
 * Ask the journal AI a question
 * Now uses Cloud Function
 */
export const askJournalAI = async (entries, question, questionEmbedding = null) => {
  const relevantEntries = await getSmartChatContext(entries, question, questionEmbedding);

  const context = relevantEntries.map(e => {
    const date = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    return `[${date.toLocaleDateString()}] [${e.title}] ${tags ? `{${tags}} ` : ''}${e.text}`;
  }).join('\n');

  try {
    const result = await askJournalAIFn({
      question,
      entriesContext: context
    });
    return result.data.response;
  } catch (e) {
    console.error('askJournalAI error:', e);
    return null;
  }
};
