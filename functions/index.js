/**
 * EchoVault Cloud Functions
 *
 * Combines:
 * - AI Processing Functions (analyzeJournalEntry, generateEmbedding, transcribeAudio, askJournalAI)
 * - Pattern Index Functions (onEntryCreate, onEntryUpdate, dailyPatternRefresh, refreshPatterns)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();

// Define secrets (set these with: firebase functions:secrets:set SECRET_NAME)
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const openaiApiKey = defineSecret('OPENAI_API_KEY');

// Constants
const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
const PATTERN_VERSION = 1;

// AI Model Configuration
const AI_CONFIG = {
  classification: { primary: 'gemini-1.5-flash', fallback: 'gpt-4o-mini' },
  analysis: { primary: 'gemini-2.0-flash', fallback: 'gpt-4o' },
  chat: { primary: 'gpt-4o-mini', fallback: 'gemini-1.5-flash' },
  embedding: { primary: 'text-embedding-004', fallback: null },
  transcription: { primary: 'whisper-1', fallback: null }
};

// ============================================
// AI HELPER FUNCTIONS
// ============================================

/**
 * Call the Gemini API
 */
async function callGemini(apiKey, systemPrompt, userPrompt, model = AI_CONFIG.analysis.primary) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Gemini API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('Gemini API exception:', e);
    return null;
  }
}

/**
 * Call the OpenAI GPT API
 */
async function callOpenAI(apiKey, systemPrompt, userPrompt) {
  try {
    if (!apiKey) {
      console.error('OpenAI API key not configured');
      return null;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('OpenAI API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('OpenAI API exception:', e);
    return null;
  }
}

/**
 * Classify entry into type: task, mixed, reflection, or vent
 */
async function classifyEntry(apiKey, text) {
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
    const raw = await callGemini(apiKey, prompt, text, AI_CONFIG.classification.primary);
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
}

/**
 * Analyze entry and route to appropriate therapeutic framework
 */
async function analyzeEntry(apiKey, text, entryType = 'reflection') {
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
      const raw = await callGemini(apiKey, ventPrompt, text);
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
    1. "cbt" (Cognitive Behavioral): Use when user has specific "glitchy" logic, cognitive distortions (all-or-nothing thinking, catastrophizing, mind-reading), or requires fact-checking their thoughts.
    2. "act" (Acceptance & Commitment): Use when user is struggling with difficult *feelings* (grief, shame, anxiety, loss) where "fighting" the feeling makes it worse. Focus on unhooking from thoughts and connecting to values. Signs: rumination, self-fusion ("I AM a failure" vs "I made a mistake"), avoidance of emotions.
    3. "celebration" - IF text describes wins, accomplishments, gratitude, joy, or positive experiences.
    4. "general" - For neutral observations, casual updates, or mixed content without strong emotion.

    RESPONSE DEPTH (based on emotional intensity):
    - mood_score 0.6+ (positive/neutral): Light response - validation or affirmation only
    - mood_score 0.4-0.6 (mixed): Medium response - add perspective if helpful
    - mood_score 0.2-0.4 (struggling): Full response - include behavioral suggestions or committed action
    - mood_score <0.2 (distressed): Full response + always include behavioral_activation or committed_action

    TIME-AWARE SUGGESTIONS:
    - late_night: Favor sleep hygiene, gentle grounding, avoid "go for a walk" type suggestions
    - morning: Can suggest movement, planning, fresh starts
    - afternoon/evening: Standard suggestions appropriate

    Return JSON:
    {
      "title": "Short creative title (max 6 words)",
      "tags": ["Tag1", "Tag2"],
      "mood_score": 0.5 (0.0=bad, 1.0=good),
      "framework": "cbt" | "act" | "celebration" | "general",

      // INCLUDE IF FRAMEWORK == 'cbt'
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

      // INCLUDE IF FRAMEWORK == 'act'
      "act_analysis": {
        "fusion_thought": "The thought the user is 'fused' with - taking as absolute truth about themselves or reality",
        "defusion_technique": "labeling" | "visualization" | "thanking_mind",
        "defusion_phrase": "A phrase to create psychological distance. For labeling: 'I notice I'm having the thought that...'. For visualization: 'Imagine placing this thought on a leaf floating down a stream...'. For thanking_mind: 'Thanks, mind, for that thought...'",
        "values_context": "The core value at stake (e.g., Connection, Growth, Creativity, Health, Family)",
        "committed_action": "A tiny, concrete step (under 5 min) aligned with their values - NOT controlled by whether they feel like it"
      },

      // INCLUDE IF FRAMEWORK == 'celebration'
      "celebration": {
        "affirmation": "Warm acknowledgment of their positive moment (1-2 sentences)",
        "amplify": "Optional prompt to savor or deepen the positive feeling (or null if not needed)"
      },

      "task_acknowledgment": "Brief empathetic note about their to-do list load (or null)"
    }

    IMPORTANT: Return null for any field that isn't genuinely useful. Less is more. Only include the analysis object for the chosen framework.
  `;

  try {
    const raw = await callGemini(apiKey, prompt, text);

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

    if (parsed.act_analysis && typeof parsed.act_analysis === 'object' && Object.keys(parsed.act_analysis).length > 0) {
      result.act_analysis = parsed.act_analysis;
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
}

/**
 * Extract enhanced context from entry
 */
async function extractEnhancedContext(apiKey, text, recentEntriesContext = '') {
  const prompt = `
    Extract structured context from this journal entry.

    EXISTING CONTEXT FROM RECENT ENTRIES:
    ${recentEntriesContext || 'No recent entries'}

    EXTRACTION RULES (use lowercase, underscore-separated names):

    1. PEOPLE (@person:name)
       - Real people with names or clear identifiers (mom, dad, boss, therapist)
       - Skip generic references ("someone", "people", "they")
       - Examples: @person:sarah, @person:mom, @person:dr_smith

    2. PLACES (@place:name)
       - Specific locations that might recur
       - Examples: @place:office, @place:gym, @place:coffee_shop

    3. ACTIVITIES (@activity:name)
       - Hobbies, exercises, regular activities
       - Examples: @activity:yoga, @activity:hiking, @activity:cooking, @activity:gaming

    4. MEDIA (@media:name)
       - Shows, movies, books, podcasts, games being consumed
       - Examples: @media:succession, @media:oppenheimer, @media:atomic_habits

    5. EVENTS (@event:name)
       - Specific one-time or recurring events
       - Examples: @event:job_interview, @event:dinner_party, @event:doctors_appointment

    6. FOOD/RESTAURANTS (@food:name)
       - Specific restaurants, cuisines, or food experiences
       - Examples: @food:sushi_place, @food:italian_restaurant, @food:new_thai_spot

    7. TOPICS (@topic:name)
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
    const raw = await callGemini(apiKey, prompt, text, AI_CONFIG.classification.primary);
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
}

/**
 * Generate contextual insight
 */
async function generateInsight(apiKey, currentText, historyContext, moodTrajectory = null, cyclicalPatterns = null) {
  const today = new Date();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()];

  const moodContext = moodTrajectory
    ? `\nMOOD TRAJECTORY: ${moodTrajectory.description} (avg: ${moodTrajectory.average}, trend: ${moodTrajectory.trend})`
    : '';

  const cyclicalContext = cyclicalPatterns?.pattern
    ? `\nCYCLICAL PATTERN DETECTED: ${cyclicalPatterns.pattern}`
    : '';

  const prompt = `
    You are a proactive memory assistant analyzing journal entries.
    Today's date: ${today.toLocaleDateString()} (${dayOfWeek})
    ${moodContext}${cyclicalContext}

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
    const raw = await callGemini(apiKey, prompt, `HISTORY:\n${historyContext}\n\nCURRENT ENTRY [${today.toLocaleDateString()} - written just now]:\n${currentText}`);

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
}

// ============================================
// AI CLOUD FUNCTIONS
// ============================================

/**
 * Main Cloud Function: Analyze a journal entry
 * Handles classification, analysis, context extraction, and insight generation
 */
export const analyzeJournalEntry = onCall(
  {
    secrets: [geminiApiKey],
    cors: true,
    maxInstances: 10
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { text, recentEntriesContext, historyContext, moodTrajectory, cyclicalPatterns, operations } = request.data;

    if (!text || typeof text !== 'string') {
      throw new HttpsError('invalid-argument', 'Text is required');
    }

    const apiKey = geminiApiKey.value();
    const results = {};

    try {
      // Run requested operations
      const ops = operations || ['classify', 'analyze', 'extractContext', 'generateInsight'];

      if (ops.includes('classify')) {
        results.classification = await classifyEntry(apiKey, text);
      }

      if (ops.includes('analyze')) {
        const entryType = results.classification?.entry_type || 'reflection';
        results.analysis = await analyzeEntry(apiKey, text, entryType);
      }

      if (ops.includes('extractContext')) {
        results.enhancedContext = await extractEnhancedContext(apiKey, text, recentEntriesContext);
      }

      if (ops.includes('generateInsight') && historyContext) {
        results.insight = await generateInsight(apiKey, text, historyContext, moodTrajectory, cyclicalPatterns);
      }

      return results;
    } catch (error) {
      console.error('analyzeJournalEntry error:', error);
      throw new HttpsError('internal', 'Analysis failed');
    }
  }
);

/**
 * Cloud Function: Generate text embedding
 */
export const generateEmbedding = onCall(
  {
    secrets: [geminiApiKey],
    cors: true,
    maxInstances: 10
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { text } = request.data;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'Valid text is required');
    }

    const apiKey = geminiApiKey.value();

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text: text }] } })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Embedding API error:', res.status, errorData);
        throw new HttpsError('internal', 'Embedding generation failed');
      }

      const data = await res.json();
      const embedding = data.embedding?.values || null;

      if (!embedding) {
        throw new HttpsError('internal', 'No embedding returned');
      }

      return { embedding };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('generateEmbedding error:', error);
      throw new HttpsError('internal', 'Embedding generation failed');
    }
  }
);

/**
 * Cloud Function: Transcribe audio using Whisper
 * Supports recordings up to ~10 minutes (Whisper API limit is 25MB)
 */
export const transcribeAudio = onCall(
  {
    secrets: [openaiApiKey],
    cors: true,
    maxInstances: 5,
    timeoutSeconds: 540,  // 9 minutes (max allowed) for very long recordings
    memory: '1GiB'        // More memory for large audio processing
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { base64, mimeType } = request.data;

    if (!base64 || !mimeType) {
      throw new HttpsError('invalid-argument', 'Audio data and mimeType are required');
    }

    const apiKey = openaiApiKey.value();

    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OpenAI API key not configured');
    }

    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(base64, 'base64');

      // Determine file extension
      const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';

      // Create form data
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const formDataParts = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="audio.${fileExt}"\r\n`,
        `Content-Type: ${mimeType}\r\n\r\n`,
        buffer,
        `\r\n--${boundary}\r\n`,
        `Content-Disposition: form-data; name="model"\r\n\r\n`,
        `whisper-1\r\n`,
        `--${boundary}--\r\n`
      ];

      const formBody = Buffer.concat(
        formDataParts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part))
      );

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formBody
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Whisper API error:', res.status, errorData);

        if (res.status === 429) return { error: 'API_RATE_LIMIT' };
        if (res.status === 401) return { error: 'API_AUTH_ERROR' };
        if (res.status === 400) return { error: 'API_BAD_REQUEST' };
        return { error: 'API_ERROR' };
      }

      const data = await res.json();
      let transcript = data.text || null;

      if (!transcript) {
        return { error: 'API_NO_CONTENT' };
      }

      // Remove filler words
      const fillerWords = /\b(um|uh|uhm|like|you know|so|well|actually|basically|literally)\b/gi;
      transcript = transcript.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();

      return { transcript };
    } catch (error) {
      console.error('transcribeAudio error:', error);
      return { error: 'API_EXCEPTION' };
    }
  }
);

/**
 * Cloud Function: Execute a raw prompt (for day summaries, etc.)
 * This function takes a prompt and returns the AI response directly
 */
export const executePrompt = onCall(
  {
    secrets: [geminiApiKey],
    cors: true,
    maxInstances: 10
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { prompt, systemPrompt } = request.data;

    if (!prompt || typeof prompt !== 'string') {
      throw new HttpsError('invalid-argument', 'Prompt is required');
    }

    const apiKey = geminiApiKey.value();

    try {
      const response = await callGemini(apiKey, systemPrompt || '', prompt);
      return { response };
    } catch (error) {
      console.error('executePrompt error:', error);
      throw new HttpsError('internal', 'Prompt execution failed');
    }
  }
);

/**
 * Cloud Function: Ask the journal AI a question
 */
export const askJournalAI = onCall(
  {
    secrets: [geminiApiKey],
    cors: true,
    maxInstances: 5
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { question, entriesContext } = request.data;

    if (!question || typeof question !== 'string') {
      throw new HttpsError('invalid-argument', 'Question is required');
    }

    const apiKey = geminiApiKey.value();

    const systemPrompt = `You are a helpful journal assistant with access to the user's personal entries.

CONTEXT FROM JOURNAL ENTRIES:
${entriesContext || 'No entries available'}

INSTRUCTIONS:
- Answer based ONLY on the journal entries provided
- Reference specific dates when relevant
- Notice patterns across entries (recurring people, places, goals, situations)
- Tags starting with @ indicate: @person:name, @place:location, @goal:intention, @situation:ongoing_context, @self:self_statement
- Use ### headers and * bullets for formatting
- Be warm and personal - this is someone's private journal`;

    try {
      const response = await callGemini(apiKey, systemPrompt, question);
      return { response };
    } catch (error) {
      console.error('askJournalAI error:', error);
      throw new HttpsError('internal', 'Chat failed');
    }
  }
);

/**
 * Cloud Function: Transcribe audio with voice tone analysis
 * Combines Whisper transcription with Gemini voice tone analysis
 */
export const transcribeWithTone = onCall(
  {
    secrets: [openaiApiKey, geminiApiKey],
    cors: true,
    maxInstances: 5,
    timeoutSeconds: 540,  // 9 minutes (max allowed)
    memory: '1GiB'
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { base64, mimeType } = request.data;

    if (!base64 || !mimeType) {
      throw new HttpsError('invalid-argument', 'Audio data and mimeType are required');
    }

    const oaiKey = openaiApiKey.value();
    const gemKey = geminiApiKey.value();

    if (!oaiKey) {
      throw new HttpsError('failed-precondition', 'OpenAI API key not configured');
    }

    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(base64, 'base64');

      // Determine file extension
      const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';

      // 1. Transcribe with Whisper
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const formDataParts = [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="audio.${fileExt}"\r\n`,
        `Content-Type: ${mimeType}\r\n\r\n`,
        buffer,
        `\r\n--${boundary}\r\n`,
        `Content-Disposition: form-data; name="model"\r\n\r\n`,
        `whisper-1\r\n`,
        `--${boundary}--\r\n`
      ];

      const formBody = Buffer.concat(
        formDataParts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part))
      );

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${oaiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formBody
      });

      if (!whisperRes.ok) {
        const errorData = await whisperRes.json().catch(() => ({}));
        console.error('Whisper API error:', whisperRes.status, errorData);

        if (whisperRes.status === 429) return { error: 'API_RATE_LIMIT' };
        if (whisperRes.status === 401) return { error: 'API_AUTH_ERROR' };
        if (whisperRes.status === 400) return { error: 'API_BAD_REQUEST' };
        return { error: 'API_ERROR' };
      }

      const whisperData = await whisperRes.json();
      let transcript = whisperData.text || null;

      if (!transcript) {
        return { error: 'API_NO_CONTENT' };
      }

      // Remove filler words
      const fillerWords = /\b(um|uh|uhm|like|you know|so|well|actually|basically|literally)\b/gi;
      transcript = transcript.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();

      // 2. Analyze voice tone with Gemini (if API key is available and audio is long enough)
      let toneAnalysis = null;

      // Only analyze if audio is at least 2 seconds (rough estimate based on buffer size)
      // webm/mp4 compressed audio is ~16kbps, so 2 seconds ≈ 4KB
      const minAudioSize = 4000;

      if (gemKey && buffer.length >= minAudioSize) {
        try {
          const tonePrompt = `Analyze the emotional tone and mood from this voice recording. Focus on:
1. The speaker's emotional state based on voice characteristics (tone, pace, pitch variations, pauses)
2. Energy level (low/medium/high)
3. Specific emotions you can detect

The transcript of what they said: "${transcript}"

Respond in this exact JSON format only, no other text:
{
  "moodScore": <number 0-1, where 0 is very negative/distressed and 1 is very positive/joyful>,
  "energy": "<low|medium|high>",
  "emotions": ["<emotion1>", "<emotion2>"],
  "confidence": <number 0-1 indicating analysis confidence>,
  "summary": "<brief 1-sentence description of their emotional state>"
}`;

          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${gemKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mimeType, data: base64 } },
                  { text: tonePrompt }
                ]
              }]
            })
          });

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

            // Parse JSON from response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              toneAnalysis = {
                moodScore: Math.max(0, Math.min(1, parsed.moodScore)),
                energy: ['low', 'medium', 'high'].includes(parsed.energy) ? parsed.energy : 'medium',
                emotions: Array.isArray(parsed.emotions) ? parsed.emotions.slice(0, 5) : [],
                confidence: Math.max(0, Math.min(1, parsed.confidence)),
                summary: parsed.summary || 'Unable to determine emotional state'
              };
              console.log('Voice tone analysis completed:', toneAnalysis.summary);
            }
          } else {
            console.warn('Gemini API error for tone analysis:', geminiRes.status);
          }
        } catch (toneError) {
          console.warn('Voice tone analysis failed (non-critical):', toneError.message);
          // Continue without tone analysis - transcription is the critical part
        }
      }

      return {
        transcript,
        toneAnalysis  // Will be null if Gemini unavailable or audio too short
      };
    } catch (error) {
      console.error('transcribeWithTone error:', error);
      return { error: 'API_EXCEPTION' };
    }
  }
);

// ============================================
// PATTERN COMPUTATION FUNCTIONS
// ============================================

/**
 * Compute activity sentiment patterns
 * Which entities correlate with mood changes?
 */
function computeActivitySentiment(entries) {
  const entityMoods = new Map();

  entries.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const tags = (entry.tags || []).filter(t =>
      t.startsWith('@activity:') ||
      t.startsWith('@place:') ||
      t.startsWith('@person:') ||
      t.startsWith('@event:') ||
      t.startsWith('@media:') ||
      t.startsWith('@food:')
    );

    tags.forEach(tag => {
      if (!entityMoods.has(tag)) {
        entityMoods.set(tag, { moods: [], dates: [] });
      }
      entityMoods.get(tag).moods.push(mood);
      entityMoods.get(tag).dates.push(entry.effectiveDate || entry.createdAt);
    });
  });

  // Calculate baseline
  const allMoods = entries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const baselineMood = allMoods.length > 0
    ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
    : 0.5;

  // Build patterns
  const patterns = [];
  entityMoods.forEach((data, tag) => {
    if (data.moods.length < 2) return;

    const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
    const moodDelta = avgMood - baselineMood;
    const moodDeltaPercent = Math.round(moodDelta * 100);

    let sentiment = 'neutral';
    if (moodDelta > 0.1) sentiment = 'positive';
    else if (moodDelta < -0.1) sentiment = 'negative';

    const entityName = tag.split(':')[1]?.replace(/_/g, ' ') || tag;
    const entityType = tag.split(':')[0].replace('@', '');

    let insight = null;
    if (sentiment === 'positive' && moodDeltaPercent > 10) {
      insight = `${entityName} boosts your mood by ${moodDeltaPercent}%`;
    } else if (sentiment === 'negative' && moodDeltaPercent < -10) {
      insight = `Your mood dips ${Math.abs(moodDeltaPercent)}% around ${entityName}`;
    }

    patterns.push({
      entity: tag,
      entityName,
      entityType,
      avgMood: Number(avgMood.toFixed(2)),
      baselineMood: Number(baselineMood.toFixed(2)),
      moodDelta: Number(moodDelta.toFixed(2)),
      moodDeltaPercent,
      entryCount: data.moods.length,
      sentiment,
      insight,
      lastMentioned: data.dates[data.dates.length - 1]
    });
  });

  return patterns.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));
}

/**
 * Compute temporal patterns (day-of-week, time-of-day)
 */
function computeTemporalPatterns(entries) {
  const dayOfWeekMoods = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const timeOfDayMoods = { morning: [], afternoon: [], evening: [], night: [] };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  entries.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const dateField = entry.effectiveDate || entry.createdAt;
    const date = dateField?.toDate ? dateField.toDate() : new Date(dateField);

    dayOfWeekMoods[date.getDay()].push(mood);

    const hour = date.getHours();
    const timeBlock = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    timeOfDayMoods[timeBlock].push(mood);
  });

  // Calculate day patterns
  const dayPatterns = [];
  for (let day = 0; day < 7; day++) {
    const moods = dayOfWeekMoods[day];
    if (moods.length < 2) continue;

    const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
    dayPatterns.push({
      day,
      dayName: dayNames[day],
      avgMood: Number(avg.toFixed(2)),
      entryCount: moods.length
    });
  }

  // Find extremes
  const sortedDays = [...dayPatterns].sort((a, b) => a.avgMood - b.avgMood);
  const worstDay = sortedDays[0];
  const bestDay = sortedDays[sortedDays.length - 1];

  // Calculate time patterns
  const timePatterns = Object.entries(timeOfDayMoods)
    .filter(([_, moods]) => moods.length >= 2)
    .map(([time, moods]) => ({
      time,
      avgMood: Number((moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(2)),
      entryCount: moods.length
    }));

  return {
    dayOfWeek: dayPatterns,
    timeOfDay: timePatterns,
    insights: {
      worstDay: worstDay && worstDay.avgMood < 0.45 ? {
        day: worstDay.dayName,
        mood: worstDay.avgMood,
        insight: `${worstDay.dayName}s tend to be tougher (${Math.round(worstDay.avgMood * 100)}% avg mood)`
      } : null,
      bestDay: bestDay && bestDay.avgMood > 0.6 ? {
        day: bestDay.dayName,
        mood: bestDay.avgMood,
        insight: `${bestDay.dayName}s are your best days (${Math.round(bestDay.avgMood * 100)}% avg mood)`
      } : null
    }
  };
}

/**
 * Detect contradictions between stated intentions and actual behavior
 */
function detectContradictions(entries, activityPatterns) {
  const contradictions = [];
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Find goal-related entries
  const goalEntries = entries.filter(e =>
    e.tags?.some(t => t.startsWith('@goal:')) ||
    e.text?.toLowerCase().match(/\b(want to|going to|need to|should|plan to|trying to)\b.*\b(more|less|start|stop|better)\b/)
  );

  // Type 1: Goal abandonment detection
  goalEntries.forEach(entry => {
    const goalTags = (entry.tags || []).filter(t => t.startsWith('@goal:'));

    goalTags.forEach(goalTag => {
      const goalName = goalTag.replace('@goal:', '').replace(/_/g, ' ');

      // Find related activity mentions
      const relatedActivity = `@activity:${goalTag.replace('@goal:', '')}`;
      const recentMentions = entries.filter(e => {
        const entryDate = e.effectiveDate?.toDate?.() || e.createdAt?.toDate?.() || new Date(e.effectiveDate || e.createdAt);
        return entryDate >= twoWeeksAgo && e.tags?.includes(relatedActivity);
      });

      if (recentMentions.length === 0) {
        const entryDate = entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.() || new Date(entry.effectiveDate || entry.createdAt);
        const daysSince = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));

        if (daysSince > 7) {
          contradictions.push({
            type: 'goal_abandonment',
            goalTag,
            goalName,
            message: `You mentioned wanting to "${goalName}" ${daysSince} days ago but haven't mentioned it since`,
            severity: daysSince > 21 ? 'high' : 'medium',
            originalEntry: {
              date: entryDate,
              snippet: entry.text?.substring(0, 100)
            }
          });
        }
      }
    });
  });

  // Type 2: Sentiment contradiction
  const negativeStatements = entries.filter(e =>
    e.text?.toLowerCase().match(/\b(hate|dread|can't stand|annoying|terrible|worst)\b/)
  );

  negativeStatements.forEach(entry => {
    const entities = (entry.tags || []).filter(t => t.startsWith('@'));

    entities.forEach(entity => {
      const pattern = activityPatterns.find(p => p.entity === entity);

      if (pattern && pattern.sentiment === 'positive' && pattern.entryCount >= 3) {
        contradictions.push({
          type: 'sentiment_contradiction',
          entity,
          entityName: pattern.entityName,
          message: `You've said negative things about ${pattern.entityName}, but your mood is actually ${pattern.moodDeltaPercent}% higher when you mention it`,
          severity: 'low',
          pattern: {
            avgMood: pattern.avgMood,
            moodDeltaPercent: pattern.moodDeltaPercent,
            entryCount: pattern.entryCount
          }
        });
      }
    });
  });

  // Type 3: Avoidance contradiction
  const avoidanceStatements = entries.filter(e =>
    e.text?.toLowerCase().match(/\b(avoid|cut back|quit|stop|less)\b/)
  );

  avoidanceStatements.forEach(entry => {
    const entryDate = entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.() || new Date(entry.effectiveDate || entry.createdAt);

    const entities = (entry.tags || []).filter(t =>
      t.startsWith('@food:') || t.startsWith('@activity:') || t.startsWith('@media:')
    );

    entities.forEach(entity => {
      const laterPositiveMentions = entries.filter(e => {
        const eDate = e.effectiveDate?.toDate?.() || e.createdAt?.toDate?.() || new Date(e.effectiveDate || e.createdAt);
        return eDate > entryDate &&
               e.tags?.includes(entity) &&
               e.analysis?.mood_score > 0.6;
      });

      if (laterPositiveMentions.length >= 2) {
        const entityName = entity.split(':')[1]?.replace(/_/g, ' ');
        contradictions.push({
          type: 'avoidance_contradiction',
          entity,
          entityName,
          message: `You said you'd cut back on ${entityName}, but you've mentioned it positively ${laterPositiveMentions.length} times since`,
          severity: 'medium',
          mentionCount: laterPositiveMentions.length
        });
      }
    });
  });

  return contradictions;
}

/**
 * Generate top insights summary for quick display
 */
function generateInsightsSummary(activityPatterns, temporalPatterns, contradictions) {
  const insights = [];

  // Top positive activity
  const topPositive = activityPatterns.find(p => p.sentiment === 'positive' && p.insight);
  if (topPositive) {
    insights.push({
      type: 'positive_activity',
      icon: 'trending-up',
      message: topPositive.insight,
      entity: topPositive.entity
    });
  }

  // Top negative activity
  const topNegative = activityPatterns.find(p => p.sentiment === 'negative' && p.insight);
  if (topNegative) {
    insights.push({
      type: 'negative_activity',
      icon: 'trending-down',
      message: topNegative.insight,
      entity: topNegative.entity
    });
  }

  // Best/worst day
  if (temporalPatterns.insights.bestDay) {
    insights.push({
      type: 'best_day',
      icon: 'sun',
      message: temporalPatterns.insights.bestDay.insight
    });
  }
  if (temporalPatterns.insights.worstDay) {
    insights.push({
      type: 'worst_day',
      icon: 'cloud',
      message: temporalPatterns.insights.worstDay.insight
    });
  }

  // Top contradiction
  const topContradiction = contradictions[0];
  if (topContradiction) {
    insights.push({
      type: 'contradiction',
      icon: 'alert-circle',
      message: topContradiction.message,
      contradictionType: topContradiction.type
    });
  }

  return insights.slice(0, 5);
}

/**
 * Main pattern computation function
 */
async function computeAllPatterns(userId, category = null) {
  // Fetch all entries
  const entriesRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  let query = entriesRef.orderBy('createdAt', 'desc').limit(200);
  if (category) {
    query = entriesRef.where('category', '==', category).orderBy('createdAt', 'desc').limit(200);
  }

  const snapshot = await query.get();
  const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (entries.length < 5) {
    console.log(`Not enough entries for user ${userId} (${entries.length})`);
    return null;
  }

  // Compute patterns
  const activitySentiment = computeActivitySentiment(entries);
  const temporalPatterns = computeTemporalPatterns(entries);
  const contradictions = detectContradictions(entries, activitySentiment);
  const summary = generateInsightsSummary(activitySentiment, temporalPatterns, contradictions);

  const timestamp = FieldValue.serverTimestamp();
  const patternBase = {
    updatedAt: timestamp,
    entryCount: entries.length,
    version: PATTERN_VERSION
  };

  // Store patterns
  const patternsRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('patterns');

  const batch = db.batch();

  batch.set(patternsRef.doc('activity_sentiment'), {
    ...patternBase,
    data: activitySentiment.slice(0, 50) // Top 50 entities
  });

  batch.set(patternsRef.doc('temporal'), {
    ...patternBase,
    data: temporalPatterns
  });

  batch.set(patternsRef.doc('contradictions'), {
    ...patternBase,
    data: contradictions
  });

  batch.set(patternsRef.doc('summary'), {
    ...patternBase,
    data: summary,
    topPositive: activitySentiment.find(p => p.sentiment === 'positive')?.insight || null,
    topNegative: activitySentiment.find(p => p.sentiment === 'negative')?.insight || null,
    bestDay: temporalPatterns.insights.bestDay?.insight || null,
    worstDay: temporalPatterns.insights.worstDay?.insight || null,
    hasContradictions: contradictions.length > 0
  });

  await batch.commit();

  console.log(`Computed patterns for user ${userId}: ${activitySentiment.length} activities, ${contradictions.length} contradictions`);
  return { activitySentiment, temporalPatterns, contradictions, summary };
}

// ============================================
// PATTERN TRIGGER FUNCTIONS
// ============================================

/**
 * Trigger: On new entry creation
 * Incrementally update patterns when a new entry is created
 */
export const onEntryCreate = onDocumentCreated(
  'artifacts/{appId}/users/{userId}/entries/{entryId}',
  async (event) => {
    const { userId, appId } = event.params;

    if (appId !== APP_COLLECTION_ID) {
      console.log(`Skipping pattern update for app ${appId}`);
      return null;
    }

    console.log(`New entry created for user ${userId}, recomputing patterns...`);

    try {
      await computeAllPatterns(userId);
      return { success: true };
    } catch (error) {
      console.error(`Error computing patterns for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * Trigger: On entry update (mood analysis complete)
 * Recompute when entry gets mood score
 */
export const onEntryUpdate = onDocumentUpdated(
  'artifacts/{appId}/users/{userId}/entries/{entryId}',
  async (event) => {
    const { userId, appId } = event.params;

    if (appId !== APP_COLLECTION_ID) return null;

    const before = event.data.before.data();
    const after = event.data.after.data();

    // Only recompute if mood score was just added
    const hadMood = before.analysis?.mood_score !== undefined;
    const hasMood = after.analysis?.mood_score !== undefined;

    if (!hadMood && hasMood) {
      console.log(`Mood score added for user ${userId}, recomputing patterns...`);
      try {
        await computeAllPatterns(userId);
      } catch (error) {
        console.error(`Error computing patterns for user ${userId}:`, error);
      }
    }

    return null;
  }
);

/**
 * Scheduled: Daily pattern refresh
 * Full recomputation for all active users
 */
export const dailyPatternRefresh = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'America/Los_Angeles'
  },
  async (event) => {
    console.log('Starting daily pattern refresh...');

    try {
      // Get all users with entries
      const usersRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users');

      const usersSnapshot = await usersRef.listDocuments();

      let successCount = 0;
      let errorCount = 0;

      for (const userDoc of usersSnapshot) {
        try {
          await computeAllPatterns(userDoc.id);
          successCount++;
        } catch (error) {
          console.error(`Error refreshing patterns for user ${userDoc.id}:`, error);
          errorCount++;
        }

        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`Daily refresh complete: ${successCount} success, ${errorCount} errors`);
      return { success: true, successCount, errorCount };
    } catch (error) {
      console.error('Daily pattern refresh failed:', error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * HTTP Callable: Manual pattern refresh
 * Allow users to trigger a refresh from the app
 */
export const refreshPatterns = onCall(
  {
    cors: true,
    maxInstances: 5
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const userId = request.auth.uid;
    const { category } = request.data || {};

    console.log(`Manual pattern refresh requested for user ${userId}`);

    try {
      const result = await computeAllPatterns(userId, category);
      return { success: true, insightCount: result?.summary?.length || 0 };
    } catch (error) {
      console.error(`Error refreshing patterns for user ${userId}:`, error);
      throw new HttpsError('internal', 'Failed to refresh patterns');
    }
  }
);

// ============================================
// SIGNAL AGGREGATION FUNCTIONS
// ============================================

/**
 * Helper: Format a Date to YYYY-MM-DD string for day_summaries key
 */
function formatDateKey(date) {
  const d = date instanceof Date ? date : date.toDate();
  return d.toISOString().split('T')[0];
}

/**
 * Helper: Get start of day for a date key
 */
function startOfDay(dateKey) {
  const d = new Date(dateKey + 'T00:00:00.000Z');
  return d;
}

/**
 * Helper: Get end of day for a date key
 */
function endOfDay(dateKey) {
  const d = new Date(dateKey + 'T23:59:59.999Z');
  return d;
}

/**
 * Helper: Calculate average sentiment from signals (returns 0-1 scale to match entry mood_score)
 */
function calculateAvgSentiment(signals) {
  if (signals.length === 0) return null;

  // Map sentiment to -1 to 1 scale first
  const sentimentValues = {
    positive: 1,
    excited: 0.8,
    hopeful: 0.6,
    neutral: 0,
    anxious: -0.3,
    negative: -0.5,
    dreading: -0.7
  };

  const total = signals.reduce((sum, s) => {
    return sum + (sentimentValues[s.sentiment] || 0);
  }, 0);

  const rawAvg = total / signals.length;  // -1 to 1 scale

  // Convert to 0-1 scale to match entry mood_score
  return (rawAvg + 1) / 2;
}

/**
 * Helper: Calculate average entry mood (0-1 scale)
 */
function calculateAvgEntryMood(entries) {
  const validMoods = entries
    .map(e => e.analysis?.mood_score)
    .filter(score => typeof score === 'number' && !isNaN(score));

  if (validMoods.length === 0) return null;
  return validMoods.reduce((a, b) => a + b, 0) / validMoods.length;
}

/**
 * Recalculate day summary for a specific date
 * Called by onSignalWrite trigger
 *
 * Dynamic day scoring:
 * - If entries exist: Entry mood 60% + Signal sentiment 40%
 * - If no entries (only forward-referenced signals): Signal sentiment 100%
 * - Plans have weight 0 (excluded from avgSentiment)
 */
async function recalculateDaySummary(userId, dateKey) {
  console.log(`Recalculating day summary for user ${userId}, date ${dateKey}`);

  const userRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId);

  // Query active/verified signals using 'in' (Firestore-friendly with ranges)
  const signalsSnap = await userRef
    .collection('signals')
    .where('targetDate', '>=', startOfDay(dateKey))
    .where('targetDate', '<=', endOfDay(dateKey))
    .where('status', 'in', ['active', 'verified'])
    .get();

  const signals = signalsSnap.docs.map(d => d.data());

  // Separate scoring signals (exclude plans - they have weight 0)
  const scoringSignals = signals.filter(s => s.type !== 'plan');
  const signalSentiment = calculateAvgSentiment(scoringSignals);

  // Query entries recorded on this date
  const entriesSnap = await userRef
    .collection('entries')
    .where('createdAt', '>=', startOfDay(dateKey))
    .where('createdAt', '<=', endOfDay(dateKey))
    .get();

  const entries = entriesSnap.docs.map(d => d.data());
  const entryMood = calculateAvgEntryMood(entries);

  // Dynamic weighting for combined day score (0-1 scale)
  // If entries exist: Entry 60% + Signal 40%
  // If no entries: Signal 100%
  let dayScore = null;
  let scoreSource = 'none';

  if (entryMood !== null && signalSentiment !== null) {
    // Both sources available - weighted blend
    dayScore = (entryMood * 0.6) + (signalSentiment * 0.4);
    scoreSource = 'blended';
  } else if (entryMood !== null) {
    // Only entries
    dayScore = entryMood;
    scoreSource = 'entries_only';
  } else if (signalSentiment !== null) {
    // Only signals (forward-referenced day)
    dayScore = signalSentiment;
    scoreSource = 'signals_only';
  }

  // Calculate aggregates
  const summary = {
    date: dateKey,
    signalCount: signals.length,
    scoringSignalCount: scoringSignals.length,
    signalSentiment,      // Raw signal sentiment (0-1 scale)
    entryMood,            // Raw entry mood (0-1 scale)
    dayScore,             // Combined dynamic score (0-1 scale)
    scoreSource,          // How the score was calculated
    entryCount: entries.length,
    hasEvents: signals.some(s => s.type === 'event'),
    hasPlans: signals.some(s => s.type === 'plan'),
    hasFeelings: signals.some(s => s.type === 'feeling'),
    hasReflections: signals.some(s => s.type === 'reflection'),
    breakdown: {
      positive: signals.filter(s => ['positive', 'excited', 'hopeful'].includes(s.sentiment)).length,
      negative: signals.filter(s => ['negative', 'anxious', 'dreading'].includes(s.sentiment)).length,
      neutral: signals.filter(s => s.sentiment === 'neutral').length
    },
    updatedAt: FieldValue.serverTimestamp()
  };

  // Write summary (upsert)
  await userRef.collection('day_summaries').doc(dateKey).set(summary, { merge: true });

  console.log(`Day summary updated for ${dateKey}: dayScore=${dayScore?.toFixed(2)} (${scoreSource}), ${signals.length} signals, ${entries.length} entries`);
}

/**
 * Trigger: Fires whenever a signal is created, updated, or deleted
 * Action: Recalculates day_summary for the affected targetDate(s)
 *
 * This ensures data integrity - even if the client crashes after saving signals,
 * the day_summaries will be correctly updated.
 */
export const onSignalWrite = onDocumentWritten(
  'artifacts/{appId}/users/{userId}/signals/{signalId}',
  async (event) => {
    const { userId, appId } = event.params;

    if (appId !== APP_COLLECTION_ID) {
      console.log(`Skipping signal aggregation for app ${appId}`);
      return null;
    }

    // Get the targetDate from before/after (handle deletes and updates that change date)
    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    const affectedDates = new Set();

    if (beforeData?.targetDate) {
      affectedDates.add(formatDateKey(beforeData.targetDate));
    }
    if (afterData?.targetDate) {
      affectedDates.add(formatDateKey(afterData.targetDate));
    }

    if (affectedDates.size === 0) {
      console.log('No targetDate found in signal, skipping aggregation');
      return null;
    }

    // Recalculate summary for each affected date
    for (const dateKey of affectedDates) {
      try {
        await recalculateDaySummary(userId, dateKey);
      } catch (error) {
        console.error(`Error recalculating day summary for ${dateKey}:`, error);
      }
    }

    return { success: true, datesUpdated: Array.from(affectedDates) };
  }
);
