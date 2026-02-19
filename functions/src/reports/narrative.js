/**
 * Report Narrative Generation
 *
 * Two distinct generation paths:
 * - Weekly: template-based (no LLM, free tier)
 * - Monthly/Quarterly/Annual: Gemini-powered (premium)
 */

import { callGemini } from '../shared/gemini.js';

/**
 * Generate a weekly digest using templates (no LLM).
 * @param {object} analyticsData - Pre-computed analytics
 * @param {object} nexusData - Nexus insights
 * @returns {Array<object>} sections
 */
export function generateWeeklyTemplate(analyticsData, nexusData) {
  const { entryCount = 0, moodAvg, moodTrend, topTheme } = analyticsData;

  // Summary bullets
  const bullets = [];
  bullets.push(`You wrote ${entryCount} journal ${entryCount === 1 ? 'entry' : 'entries'} this week.`);
  if (moodAvg != null) {
    const moodLabel = moodAvg >= 7 ? 'positive' : moodAvg >= 4 ? 'mixed' : 'challenging';
    bullets.push(`Your overall mood was ${moodLabel} (avg ${moodAvg.toFixed(1)}/10).`);
  }
  if (topTheme) {
    bullets.push(`Your most common theme was "${topTheme}".`);
  }

  // Pick one insight
  const insight = nexusData?.insights?.[0] || null;
  const insightText = insight
    ? insight.content || insight.description || 'No additional insights this week.'
    : 'Keep journaling to unlock insights about your patterns.';

  return [
    {
      id: 'summary',
      title: 'This Week',
      narrative: bullets.join(' '),
      chartData: null,
      entities: [],
      entryRefs: [],
    },
    {
      id: 'insight',
      title: 'Something You Might Not Have Noticed',
      narrative: insightText,
      chartData: null,
      entities: [],
      entryRefs: [],
    },
    {
      id: 'mood_trend',
      title: 'Mood Trend',
      narrative: '',
      chartData: { type: 'sparkline', data: moodTrend || [] },
      entities: [],
      entryRefs: [],
    },
  ];
}

const SECTION_CONFIGS = {
  monthly: [
    { id: 'narrative_arc', title: 'Month in Review' },
    { id: 'patterns', title: 'Top Patterns' },
    { id: 'goals', title: 'Goal Progress' },
    { id: 'health', title: 'Health & Wellness' },
    { id: 'entities', title: 'Key People & Places' },
    { id: 'notable', title: 'Notable Entries' },
  ],
  quarterly: [
    { id: 'trajectory', title: 'Life Trajectory' },
    { id: 'growth', title: 'Who You Were vs. Who You\'re Becoming' },
    { id: 'pattern_evolution', title: 'Pattern Evolution' },
    { id: 'goals_long_term', title: 'Long-term Goal Tracking' },
    { id: 'beliefs', title: 'Belief Evolution' },
  ],
  annual: [
    { id: 'year_narrative', title: 'Your Year in Review' },
    { id: 'milestones', title: 'Growth Milestones' },
    { id: 'quotes', title: 'Notable Quotes' },
    { id: 'yoy_comparison', title: 'Year-over-Year Changes' },
    { id: 'health_year', title: 'Health Year in Review' },
    { id: 'relationships', title: 'Relationship Evolution' },
  ],
};

/**
 * Generate narrative sections via Gemini synthesis.
 * @param {'monthly'|'quarterly'|'annual'} cadence
 * @param {object} contextData - All gathered data
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Array<object>>} sections
 */
export async function generatePremiumNarrative(cadence, contextData, apiKey) {
  const sectionConfigs = SECTION_CONFIGS[cadence];
  if (!sectionConfigs) throw new Error(`Unknown cadence: ${cadence}`);

  // For quarterly/annual, pre-summarize by month first
  let synthesisContext = contextData;
  if (cadence === 'quarterly' || cadence === 'annual') {
    synthesisContext = await preSummarizeByMonth(contextData, apiKey);
  }

  const sections = [];
  for (const config of sectionConfigs) {
    try {
      const narrative = await generateSectionNarrative(
        config, cadence, synthesisContext, apiKey
      );
      sections.push({
        id: config.id,
        title: config.title,
        narrative,
        chartData: null,
        entities: [],
        entryRefs: [],
      });
    } catch (e) {
      console.error(`[narrative] Failed to generate section ${config.id}:`, e.message);
      sections.push({
        id: config.id,
        title: config.title,
        narrative: 'This section could not be generated. Please try again later.',
        chartData: null,
        entities: [],
        entryRefs: [],
      });
    }
  }

  return sections;
}

const SYSTEM_PROMPT = `You are a compassionate life reflection assistant helping someone understand their journal data.
Write in second person ("you"). Be warm, non-judgmental, and growth-oriented.
Focus on patterns, progress, and gentle observations. Never diagnose or prescribe.
Output ONLY the narrative text for the requested section. No JSON, no markdown headers.
Keep each section to 150-300 words.`;

async function generateSectionNarrative(config, cadence, contextData, apiKey) {
  const userPrompt = buildSectionPrompt(config, cadence, contextData);
  const result = await callGeminiWithRetry(apiKey, SYSTEM_PROMPT, userPrompt);
  if (!result) throw new Error('Gemini returned null');
  return result.trim();
}

// Rough token budget: ~28K tokens for prompt (4 chars per token), leaving room for response
const MAX_PROMPT_CHARS = 28000 * 4;

function buildSectionPrompt(config, cadence, contextData) {
  const { entries, analytics, signals, nexus, health } = contextData;
  const context = [];

  context.push(`Generate the "${config.title}" section for a ${cadence} life report.`);

  if (analytics?.entryCount) context.push(`Entries this period: ${analytics.entryCount}`);
  if (analytics?.moodAvg) context.push(`Average mood: ${analytics.moodAvg.toFixed(1)}/10`);
  if (analytics?.topThemes?.length) context.push(`Top themes: ${analytics.topThemes.join(', ')}`);
  if (signals?.activeGoals?.length) context.push(`Active goals: ${signals.activeGoals.map(g => g.title || g.description).join(', ')}`);
  if (signals?.achievedGoals?.length) context.push(`Achieved goals: ${signals.achievedGoals.map(g => g.title || g.description).join(', ')}`);
  if (nexus?.patterns?.length) context.push(`Detected patterns: ${nexus.patterns.map(p => p.description).join('; ')}`);
  if (health?.summary) context.push(`Health summary: ${health.summary}`);

  // Include entry excerpts (truncated)
  if (entries?.length) {
    const excerpts = entries.slice(0, 8).map(e =>
      `[${e.date}] ${(e.text || '').slice(0, 200)}`
    );
    context.push(`Entry excerpts:\n${excerpts.join('\n')}`);
  }

  // For pre-summarized data (quarterly/annual)
  if (contextData.monthSummaries) {
    context.push(`Monthly summaries:\n${contextData.monthSummaries}`);
  }

  // Enforce token budget by truncating if needed
  let prompt = context.join('\n\n');
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n[Context truncated for token budget]';
  }
  return prompt;
}

async function preSummarizeByMonth(contextData, apiKey) {
  const { entries = [] } = contextData;

  // Group entries by month
  const byMonth = {};
  for (const entry of entries) {
    const month = entry.date?.slice(0, 7) || 'unknown';
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(entry);
  }

  const summaries = [];
  for (const [month, monthEntries] of Object.entries(byMonth).sort()) {
    const excerpts = monthEntries.slice(0, 10).map(e =>
      `[${e.date}] ${(e.text || '').slice(0, 150)}`
    ).join('\n');

    const summary = await callGeminiWithRetry(
      apiKey,
      'Summarize these journal entries for one month in 2-3 sentences. Focus on themes, mood, and notable events.',
      `Month: ${month}\n\nEntries:\n${excerpts}`
    );
    summaries.push(`${month}: ${summary || 'No summary available.'}`);
  }

  return {
    ...contextData,
    monthSummaries: summaries.join('\n'),
  };
}

/**
 * Call Gemini with exponential backoff retry.
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} maxRetries
 * @returns {Promise<string|null>}
 */
async function callGeminiWithRetry(apiKey, systemPrompt, userPrompt, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callGemini(apiKey, systemPrompt, userPrompt);
    if (result) return result;

    if (attempt < maxRetries - 1) {
      const delay = Math.pow(4, attempt) * 1000; // 1s, 4s, 16s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export { callGeminiWithRetry };
