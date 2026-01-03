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
import { getAuth } from 'firebase-admin/auth';

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
 * Helper: Generate embedding (internal use)
 * Used by both onCall function and Firestore trigger
 */
async function generateEmbeddingInternal(text, apiKey) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Valid text is required');
  }

  // Check cache first
  const cached = await getCachedEmbedding(text);
  if (cached) {
    console.log('Embedding cache HIT');
    return cached;
  }

  // Generate new embedding
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: text }] } })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('Embedding API error:', res.status, errorData);
    throw new Error('Embedding generation failed');
  }

  const data = await res.json();
  const embedding = data.embedding?.values || null;

  if (!embedding) {
    throw new Error('No embedding returned');
  }

  // Cache for future use
  await setCachedEmbedding(text, embedding);

  return embedding;
}

/**
 * Helper: Get cached embedding by text content hash
 */
async function getCachedEmbedding(text) {
  try {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
    const cacheRef = db.collection('embedding_cache').doc(hash);
    const cached = await cacheRef.get();

    if (cached.exists) {
      return cached.data().embedding;
    }
    return null;
  } catch (e) {
    console.warn('Cache read failed:', e);
    return null;
  }
}

/**
 * Helper: Cache embedding for future use
 */
async function setCachedEmbedding(text, embedding) {
  try {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
    await db.collection('embedding_cache').doc(hash).set({
      embedding,
      created: FieldValue.serverTimestamp(),
      preview: text.slice(0, 100)  // For debugging
    });
  } catch (e) {
    console.warn('Cache write failed:', e);
    // Non-critical, continue
  }
}

/**
 * Cloud Function: Generate text embedding (callable)
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
      const embedding = await generateEmbeddingInternal(text, apiKey);
      return { embedding, cached: false };  // Caching handled internally
    } catch (error) {
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
 * Detect termination language in text
 * Used to identify when a user has abandoned or completed a goal
 */
function detectsTerminationLanguage(text) {
  if (!text) return false;
  const terminationPatterns = [
    /I('m| am) (no longer|not) (interested in|pursuing|going after)/i,
    /decided (against|not to)/i,
    /giving up on/i,
    /moving on from/i,
    /that('s| is) (not|no longer) (a priority|important)/i,
    /changed my mind about/i,
    /I don't want to anymore/i,
    /not going to happen/i,
    /abandoning/i,
    /letting go of/i
  ];
  return terminationPatterns.some(p => p.test(text));
}

/**
 * Detect achievement language in text
 */
function detectsAchievementLanguage(text) {
  if (!text) return false;
  const achievementPatterns = [
    /I (did it|made it|got it|achieved|accomplished)/i,
    /finally\s+(.+)ed/i,
    /succeeded in/i,
    /completed/i,
    /finished/i,
    /reached my goal/i,
    /mission accomplished/i,
    /got the (job|offer|promotion)/i
  ];
  return achievementPatterns.some(p => p.test(text));
}

/**
 * Detect contradictions between stated intentions and actual behavior
 *
 * V3: Uses signal_states collection as the SOLE Source of Truth for goal states.
 * Legacy entry-scanning fallback has been removed to prevent "Ghost Goal" problem.
 *
 * The Ghost Goal Problem: If we scan entries for goals, terminated goals can
 * "reappear" after they fall out of the 200-entry window. By using signal_states
 * exclusively, terminated goals stay terminated forever.
 *
 * @param {Array} entries - Recent journal entries (used for sentiment/avoidance contradictions only)
 * @param {Array} activityPatterns - Computed activity patterns
 * @param {Map} signalStatesMap - Pre-fetched signal_states (goals) keyed by topic - REQUIRED
 */
function detectContradictions(entries, activityPatterns, signalStatesMap) {
  const contradictions = [];
  const now = new Date();

  // Type 1: Goal abandonment - ONLY from signal_states (Source of Truth)
  // If no signal_states exist yet, skip goal-based contradiction detection
  // Goals will be added to signal_states via processEntryForGoals on new entries
  if (signalStatesMap && signalStatesMap.size > 0) {
    signalStatesMap.forEach((goalState, goalTopic) => {
      // Skip non-active states (achieved, abandoned, paused-for-too-long)
      if (!['active', 'proposed'].includes(goalState.state)) return;

      const goalName = goalTopic.replace(/_/g, ' ');
      const lastUpdated = goalState.lastUpdated?.toDate?.() || goalState.lastUpdated;
      const daysSinceUpdate = lastUpdated
        ? Math.floor((now - new Date(lastUpdated)) / (1000 * 60 * 60 * 24))
        : 999;

      // Only flag if lastUpdated is older than 14 days
      if (daysSinceUpdate > 14) {
        contradictions.push({
          type: 'goal_abandonment',
          goalTag: `@goal:${goalTopic}`,
          goalName,
          signalId: goalState.id, // Include signal ID for UI to update
          message: `You set "${goalName}" as a goal ${daysSinceUpdate} days ago but haven't made progress since`,
          severity: daysSinceUpdate > 30 ? 'high' : 'medium',
          requiresUserInput: true,
          suggestion: 'Is this still a goal you\'re working toward?',
          actions: [
            { label: 'Still working on it', action: 'reactivate' },
            { label: 'Completed!', action: 'achieve' },
            { label: 'No longer a priority', action: 'abandon' }
          ],
          originalEntry: {
            date: lastUpdated,
            snippet: null
          }
        });
      }
    });
  }
  // Note: If signalStatesMap is empty, we simply don't generate goal contradictions.
  // New goals will be added to signal_states via processEntryForGoals.

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
 * Fetch active goal states from signal_states collection
 * Returns a Map keyed by topic for O(1) lookup
 */
async function fetchActiveGoalStates(userId) {
  const signalStatesRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('signal_states');

  // Query for goal-type signals that are active or proposed
  const snapshot = await signalStatesRef
    .where('type', '==', 'goal')
    .where('state', 'in', ['active', 'proposed', 'paused'])
    .get();

  const goalStatesMap = new Map();
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    goalStatesMap.set(data.topic, { id: doc.id, ...data });
  });

  return goalStatesMap;
}

/**
 * Fetch active exclusions from insight_exclusions collection
 * Returns patterns that should be filtered out
 */
async function fetchActiveExclusions(userId) {
  const exclusionsRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('insight_exclusions');

  const snapshot = await exclusionsRef.get();
  const now = new Date();

  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(exclusion => {
      // Keep if permanent or not expired
      if (exclusion.permanent) return true;
      if (exclusion.expiresAt) {
        const expiryDate = exclusion.expiresAt.toDate?.() || new Date(exclusion.expiresAt);
        return expiryDate > now;
      }
      return false;
    });
}

/**
 * Check if a pattern matches an exclusion
 */
function isPatternExcluded(pattern, exclusions) {
  for (const exclusion of exclusions) {
    // Check pattern type match
    const patternType = pattern.type ||
      (pattern.sentiment === 'positive' ? 'positive_activity' :
       pattern.sentiment === 'negative' ? 'negative_activity' : null);

    if (exclusion.patternType !== patternType) continue;

    // Check context match
    const exclusionContext = exclusion.context || {};
    const contextKeys = Object.keys(exclusionContext);

    if (contextKeys.length === 0) {
      // Blanket exclusion for this pattern type
      return true;
    }

    // Check each context key
    let allMatch = true;
    for (const key of contextKeys) {
      const patternValue = key === 'entity' ? pattern.entity :
                          key === 'message' ? (pattern.message || pattern.insight || '').slice(0, 100) :
                          pattern[key];

      if (exclusionContext[key] !== patternValue) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) return true;
  }

  return false;
}

/**
 * Filter out excluded patterns from an array
 */
function filterExcludedPatterns(patterns, exclusions) {
  if (!exclusions || exclusions.length === 0) return patterns;
  return patterns.filter(p => !isPatternExcluded(p, exclusions));
}

/**
 * Main pattern computation function
 * Now filters out excluded patterns before storing
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

  // Fetch active goals from signal_states (Source of Truth)
  const signalStatesMap = await fetchActiveGoalStates(userId);
  console.log(`Fetched ${signalStatesMap.size} active goals from signal_states for user ${userId}`);

  // Fetch active exclusions to filter dismissed patterns
  let exclusions = [];
  try {
    exclusions = await fetchActiveExclusions(userId);
    console.log(`Fetched ${exclusions.length} active exclusions for user ${userId}`);
  } catch (error) {
    console.warn(`Could not fetch exclusions for user ${userId}:`, error);
  }

  // Compute patterns
  let activitySentiment = computeActivitySentiment(entries);
  const temporalPatterns = computeTemporalPatterns(entries);
  // Pass signalStatesMap to detectContradictions - uses DB as source of truth
  let contradictions = detectContradictions(entries, activitySentiment, signalStatesMap);

  // Filter out excluded patterns before storing
  const originalActivityCount = activitySentiment.length;
  const originalContradictionCount = contradictions.length;

  activitySentiment = filterExcludedPatterns(activitySentiment, exclusions);
  contradictions = filterExcludedPatterns(contradictions, exclusions);

  if (exclusions.length > 0) {
    console.log(`Filtered patterns: activities ${originalActivityCount} -> ${activitySentiment.length}, contradictions ${originalContradictionCount} -> ${contradictions.length}`);
  }

  // Generate summary from filtered patterns
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
 * 1. Process entry for goal signals (update signal_states)
 * 2. Recompute patterns (using updated signal_states as Source of Truth)
 *
 * IMPORTANT: processEntryForGoals MUST run before computeAllPatterns
 * to ensure signal_states is updated before the Pattern Engine runs.
 */
export const onEntryCreate = onDocumentCreated(
  {
    document: 'artifacts/{appId}/users/{userId}/entries/{entryId}',
    secrets: [geminiApiKey]
  },
  async (event) => {
    const { userId, appId, entryId } = event.params;

    if (appId !== APP_COLLECTION_ID) {
      console.log(`Skipping processing for app ${appId}`);
      return null;
    }

    const entryData = event.data.data();
    const entry = { id: entryId, ...entryData };

    console.log(`New entry created for user ${userId}, processing embedding, goals and patterns...`);

    try {
      // Step 0: Generate embedding if not present (OPTIMIZED: Background processing)
      if (!entry.embedding && entry.text) {
        console.time(`[Entry ${entryId}] Generate embedding`);
        try {
          const apiKey = geminiApiKey.value();
          const embedding = await generateEmbeddingInternal(entry.text, apiKey);
          await event.data.ref.update({ embedding });
          console.timeEnd(`[Entry ${entryId}] Generate embedding`);
          console.log(`✅ Entry ${entryId} enriched with embedding`);
        } catch (embError) {
          console.timeEnd(`[Entry ${entryId}] Generate embedding`);
          console.error(`Failed to generate embedding for entry ${entryId}:`, embError);
          // Non-critical - continue with other processing
        }
      }

      // Step 1: Process entry for goal signals FIRST
      // This updates signal_states with any detected goals, progress, or terminations
      const goalResult = await processEntryForGoals(userId, entry);
      if (goalResult) {
        console.log(`Goal processing result: ${goalResult.isNew ? 'created new goal' : goalResult.skipped ? 'skipped (terminated)' : 'updated existing goal'}`);
      }

      // Step 2: Recompute patterns (now using updated signal_states)
      await computeAllPatterns(userId);

      return { success: true, goalProcessed: !!goalResult };
    } catch (error) {
      console.error(`Error processing entry for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }
);

/**
 * Trigger: On entry update (mood analysis complete)
 * 1. Process goals when analysis is added (goal_update from extractEnhancedContext)
 * 2. Recompute patterns when entry gets mood score
 */
export const onEntryUpdate = onDocumentUpdated(
  'artifacts/{appId}/users/{userId}/entries/{entryId}',
  async (event) => {
    const { userId, appId, entryId } = event.params;

    if (appId !== APP_COLLECTION_ID) return null;

    const before = event.data.before.data();
    const after = event.data.after.data();

    // Check if analysis was just added (contains goal_update info)
    const hadGoalUpdate = before.analysis?.goal_update ||
                          before.analysis?.extractEnhancedContext?.goal_update;
    const hasGoalUpdate = after.analysis?.goal_update ||
                          after.analysis?.extractEnhancedContext?.goal_update;

    // Process goals if goal_update was just added
    if (!hadGoalUpdate && hasGoalUpdate) {
      console.log(`Goal update detected for user ${userId}, processing goals...`);
      try {
        const entry = { id: entryId, ...after };
        await processEntryForGoals(userId, entry);
      } catch (error) {
        console.error(`Error processing goals for user ${userId}:`, error);
      }
    }

    // Recompute patterns if mood score was just added
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
// BURNOUT DETECTION FUNCTIONS
// ============================================

// Burnout indicator keywords (server-side mirror of client burnoutIndicators.js)
const BURNOUT_KEYWORDS = {
  fatigue: [
    'tired', 'exhausted', 'drained', 'burned out', 'burnout', 'burnt out',
    "can't keep up", 'running on empty', 'no energy', 'depleted',
    'wiped out', 'worn out', 'fatigued', 'spent', 'tapped out'
  ],
  overwork: [
    'overtime', 'working late', 'late night', 'weekend work', 'no break',
    'back-to-back', 'non-stop', 'nonstop', 'slammed', 'swamped',
    'drowning in work', 'too many meetings', 'endless meetings',
    'never-ending', 'piling up', 'behind on everything'
  ],
  physicalSymptoms: [
    'eyes hurt', 'eye strain', 'headache', 'migraine', "can't sleep",
    'insomnia', 'stress eating', 'not eating', 'skipping meals',
    'neck pain', 'back pain', 'tense', 'tension', 'grinding teeth',
    'jaw clenching', 'stomach issues', 'nauseous', 'heart racing'
  ],
  emotionalExhaustion: [
    'overwhelmed', 'drowning', 'nothing left', 'running on empty',
    "can't take it", 'at my limit', 'breaking point', 'losing it',
    'falling apart', 'shutting down', 'checked out', 'going through motions',
    "don't care anymore", "what's the point", 'empty inside'
  ],
  recovery: [
    'took a break', 'rested', 'day off', 'vacation', 'relaxed',
    'recharged', 'feeling better', 'recovered', 'self-care',
    'walked away', 'logged off', 'unplugged', 'disconnected'
  ]
};

const BURNOUT_FACTOR_WEIGHTS = {
  moodTrajectory: 0.25,
  fatigueKeywords: 0.20,
  overworkIndicators: 0.20,
  physicalSymptoms: 0.15,
  workTagDensity: 0.10,
  lowMoodStreak: 0.10
};

const BURNOUT_RISK_LEVELS = {
  LOW: { min: 0, max: 0.3, label: 'low' },
  MODERATE: { min: 0.3, max: 0.5, label: 'moderate' },
  HIGH: { min: 0.5, max: 0.7, label: 'high' },
  CRITICAL: { min: 0.7, max: 1.0, label: 'critical' }
};

/**
 * Find keyword matches in text
 */
function findBurnoutKeywordMatches(text, keywords) {
  if (!text) return { found: false, matches: [], count: 0 };
  const lowerText = text.toLowerCase();
  const matches = keywords.filter(kw => lowerText.includes(kw.toLowerCase()));
  return { found: matches.length > 0, matches, count: matches.length };
}

/**
 * Check if entry was created during high-risk time
 */
function checkBurnoutTimeRisk(entryDate) {
  const date = entryDate instanceof Date ? entryDate : new Date(entryDate);
  const hour = date.getHours();
  const day = date.getDay();
  const risks = [];

  // Late night (10 PM - 5 AM)
  if (hour >= 22 || hour < 5) risks.push('late_night_entry');
  // Weekend
  if (day === 0 || day === 6) risks.push('weekend_entry');

  return { isRiskTime: risks.length > 0, risks, hour, dayOfWeek: day };
}

/**
 * Compute burnout risk score from entries
 * Server-side implementation mirroring client burnoutRiskScore.js
 */
function computeBurnoutRiskFromEntries(entries) {
  if (!entries || entries.length < 3) {
    return {
      riskScore: 0,
      riskLevel: 'low',
      signals: [],
      factors: {},
      triggerShelterMode: false,
      insufficientData: true
    };
  }

  const recentEntries = entries.slice(0, 14);
  const signals = [];
  const factors = {};

  // Factor 1: Mood Trajectory (25%)
  const moodScores = recentEntries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);

  let moodFactor = { score: 0, signal: null };
  if (moodScores.length >= 2) {
    const latest = moodScores.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, moodScores.length);
    const oldest = moodScores.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, moodScores.length);
    const trend = latest - oldest;
    const avgMood = moodScores.reduce((a, b) => a + b, 0) / moodScores.length;

    let score = 0;
    if (trend < -0.2) score += 0.5;
    else if (trend < -0.1) score += 0.3;
    else if (trend < 0) score += 0.1;

    if (avgMood < 0.3) score += 0.5;
    else if (avgMood < 0.4) score += 0.3;
    else if (avgMood < 0.5) score += 0.1;

    moodFactor = {
      score: Math.min(1, score),
      signal: score > 0.3 ? 'declining_mood' : null
    };
  }
  factors.moodTrajectory = moodFactor;
  if (moodFactor.signal) signals.push(moodFactor.signal);

  // Factor 2: Fatigue Keywords (20%)
  const fatigueKeywords = [...BURNOUT_KEYWORDS.fatigue, ...BURNOUT_KEYWORDS.emotionalExhaustion];
  let fatigueMatchCount = 0;
  recentEntries.forEach(entry => {
    const result = findBurnoutKeywordMatches(entry.text, fatigueKeywords);
    if (result.found) fatigueMatchCount++;
  });
  const fatigueFreq = recentEntries.length > 0 ? fatigueMatchCount / recentEntries.length : 0;
  const fatigueScore = Math.min(1, fatigueFreq * 1.5);
  factors.fatigueKeywords = {
    score: fatigueScore,
    signal: fatigueScore > 0.3 ? 'fatigue' : null
  };
  if (fatigueScore > 0.3) signals.push('fatigue');

  // Factor 3: Overwork Indicators (20%)
  let lateNightCount = 0;
  let weekendCount = 0;
  let overworkKeywordCount = 0;
  recentEntries.forEach(entry => {
    const entryDate = entry.createdAt?.toDate?.() || entry.createdAt;
    const timeRisk = checkBurnoutTimeRisk(entryDate);
    if (timeRisk.risks.includes('late_night_entry')) lateNightCount++;
    if (timeRisk.risks.includes('weekend_entry')) weekendCount++;
    const kwResult = findBurnoutKeywordMatches(entry.text, BURNOUT_KEYWORDS.overwork);
    if (kwResult.found) overworkKeywordCount++;
  });
  const lateNightRatio = recentEntries.length > 0 ? lateNightCount / recentEntries.length : 0;
  const weekendRatio = recentEntries.length > 0 ? weekendCount / recentEntries.length : 0;
  const overworkRatio = recentEntries.length > 0 ? overworkKeywordCount / recentEntries.length : 0;
  const overworkScore = Math.min(1, (lateNightRatio * 0.4) + (weekendRatio * 0.3) + (overworkRatio * 0.3));
  factors.overworkIndicators = {
    score: overworkScore,
    signal: overworkScore > 0.3 ? 'overwork_pattern' : null
  };
  if (overworkScore > 0.3) signals.push('overwork_pattern');

  // Factor 4: Physical Symptoms (15%)
  let physicalMatchCount = 0;
  recentEntries.forEach(entry => {
    const result = findBurnoutKeywordMatches(entry.text, BURNOUT_KEYWORDS.physicalSymptoms);
    if (result.found) physicalMatchCount++;
  });
  const physicalFreq = recentEntries.length > 0 ? physicalMatchCount / recentEntries.length : 0;
  const physicalScore = Math.min(1, physicalFreq * 1.5);
  factors.physicalSymptoms = {
    score: physicalScore,
    signal: physicalScore > 0.3 ? 'physical_symptoms' : null
  };
  if (physicalScore > 0.3) signals.push('physical_symptoms');

  // Factor 5: Work Tag Density (10%)
  let totalTags = 0;
  let workTags = 0;
  const workTagPatterns = ['@project:', '@deadline:', '@meeting:', '@work:', '@client:', '@boss:'];
  recentEntries.forEach(entry => {
    const tags = entry.tags || [];
    totalTags += tags.length;
    tags.forEach(tag => {
      if (workTagPatterns.some(p => tag.startsWith(p.replace(':', '')))) workTags++;
    });
  });
  const workDensity = totalTags > 0 ? workTags / totalTags : 0;
  const workDensityScore = Math.min(1, workDensity * 1.5);
  factors.workTagDensity = {
    score: workDensityScore,
    signal: workDensityScore > 0.4 ? 'work_dominated_entries' : null
  };
  if (workDensityScore > 0.4) signals.push('work_dominated_entries');

  // Factor 6: Low Mood Streak (10%)
  let currentStreak = 0;
  for (const entry of recentEntries) {
    const mood = entry.analysis?.mood_score;
    if (mood !== null && mood !== undefined && mood < 0.4) {
      currentStreak++;
    } else {
      break;
    }
  }
  let streakScore = 0;
  if (currentStreak >= 5) streakScore = 1.0;
  else if (currentStreak >= 4) streakScore = 0.8;
  else if (currentStreak >= 3) streakScore = 0.5;
  else if (currentStreak >= 2) streakScore = 0.2;
  factors.lowMoodStreak = {
    score: streakScore,
    signal: currentStreak >= 3 ? `${currentStreak}_day_low_streak` : null
  };
  if (currentStreak >= 3) signals.push(`${currentStreak}_day_low_streak`);

  // Calculate weighted score
  let rawScore =
    (factors.moodTrajectory.score * BURNOUT_FACTOR_WEIGHTS.moodTrajectory) +
    (factors.fatigueKeywords.score * BURNOUT_FACTOR_WEIGHTS.fatigueKeywords) +
    (factors.overworkIndicators.score * BURNOUT_FACTOR_WEIGHTS.overworkIndicators) +
    (factors.physicalSymptoms.score * BURNOUT_FACTOR_WEIGHTS.physicalSymptoms) +
    (factors.workTagDensity.score * BURNOUT_FACTOR_WEIGHTS.workTagDensity) +
    (factors.lowMoodStreak.score * BURNOUT_FACTOR_WEIGHTS.lowMoodStreak);

  // Apply recovery discount
  let recoverySignals = 0;
  recentEntries.slice(0, 5).forEach(entry => {
    const result = findBurnoutKeywordMatches(entry.text, BURNOUT_KEYWORDS.recovery);
    if (result.found) recoverySignals++;
  });
  const recoveryDiscount = Math.min(0.15, recoverySignals * 0.05);
  const adjustedScore = Math.max(0, rawScore - recoveryDiscount);
  const riskScore = Math.min(1, Math.max(0, adjustedScore));

  // Determine risk level
  let riskLevel = 'low';
  if (riskScore >= BURNOUT_RISK_LEVELS.CRITICAL.min) riskLevel = 'critical';
  else if (riskScore >= BURNOUT_RISK_LEVELS.HIGH.min) riskLevel = 'high';
  else if (riskScore >= BURNOUT_RISK_LEVELS.MODERATE.min) riskLevel = 'moderate';

  // Determine if shelter mode should trigger
  let triggerShelterMode = false;
  if (riskLevel === 'critical') triggerShelterMode = true;
  else if (riskLevel === 'high') {
    const severeFactors = Object.values(factors).filter(f => f.score > 0.6);
    triggerShelterMode = severeFactors.length >= 2;
  }

  return {
    riskScore: Number(riskScore.toFixed(3)),
    riskLevel,
    signals,
    factors,
    triggerShelterMode,
    recoveryDiscount: recoveryDiscount > 0 ? recoveryDiscount : undefined,
    entryCount: recentEntries.length,
    assessedAt: new Date().toISOString()
  };
}

/**
 * Cloud Function: Compute burnout risk on-demand
 */
export const computeBurnoutRisk = onCall(
  {
    cors: true,
    maxInstances: 5
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const userId = request.auth.uid;

    try {
      // Fetch recent entries
      const entriesRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId)
        .collection('entries');

      const snapshot = await entriesRef
        .orderBy('createdAt', 'desc')
        .limit(14)
        .get();

      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Compute risk
      const assessment = computeBurnoutRiskFromEntries(entries);

      // Store assessment in burnout_assessments collection
      const assessmentRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId)
        .collection('burnout_assessments');

      await assessmentRef.add({
        ...assessment,
        createdAt: FieldValue.serverTimestamp(),
        source: 'on_demand'
      });

      return assessment;
    } catch (error) {
      console.error(`Error computing burnout risk for user ${userId}:`, error);
      throw new HttpsError('internal', 'Failed to compute burnout risk');
    }
  }
);

/**
 * Cloud Function: Log burnout-related events for analytics
 * Tracks: nudge_shown, nudge_dismissed, shelter_entered, shelter_exited, activity_completed
 */
export const logBurnoutEvent = onCall(
  {
    cors: true,
    maxInstances: 10
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const userId = request.auth.uid;
    const { eventType, riskLevel, riskScore, dismissCount, activityType, duration, metadata } = request.data;

    if (!eventType) {
      throw new HttpsError('invalid-argument', 'eventType is required');
    }

    const validEventTypes = [
      'nudge_shown',
      'nudge_dismissed',
      'nudge_acknowledged',
      'shelter_entered',
      'shelter_exited',
      'activity_completed',
      'breathing_completed',
      'grounding_completed',
      'timer_completed'
    ];

    if (!validEventTypes.includes(eventType)) {
      throw new HttpsError('invalid-argument', `Invalid eventType: ${eventType}`);
    }

    try {
      const eventsRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId)
        .collection('burnout_events');

      await eventsRef.add({
        eventType,
        riskLevel: riskLevel || null,
        riskScore: riskScore || null,
        dismissCount: dismissCount || null,
        activityType: activityType || null,
        duration: duration || null,
        metadata: metadata || null,
        createdAt: FieldValue.serverTimestamp()
      });

      console.log(`Logged burnout event for user ${userId}: ${eventType}`);
      return { success: true };
    } catch (error) {
      console.error(`Error logging burnout event for user ${userId}:`, error);
      throw new HttpsError('internal', 'Failed to log event');
    }
  }
);

/**
 * Trigger: Compute burnout risk when a new entry is created
 * Stores the latest assessment for quick access
 */
export const onEntryCreateBurnoutCheck = onDocumentCreated(
  'artifacts/{appId}/users/{userId}/entries/{entryId}',
  async (event) => {
    const { userId, appId } = event.params;

    if (appId !== APP_COLLECTION_ID) {
      return null;
    }

    console.log(`Checking burnout risk for user ${userId} after new entry...`);

    try {
      // Fetch recent entries (including the new one)
      const entriesRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId)
        .collection('entries');

      const snapshot = await entriesRef
        .orderBy('createdAt', 'desc')
        .limit(14)
        .get();

      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (entries.length < 3) {
        console.log(`Not enough entries for burnout check (${entries.length})`);
        return null;
      }

      // Compute risk
      const assessment = computeBurnoutRiskFromEntries(entries);

      // Store latest assessment (overwrite previous)
      const userRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId);

      await userRef.set({
        latestBurnoutAssessment: {
          ...assessment,
          updatedAt: FieldValue.serverTimestamp()
        }
      }, { merge: true });

      // If risk is high/critical, also store in history
      if (['high', 'critical'].includes(assessment.riskLevel)) {
        await userRef.collection('burnout_assessments').add({
          ...assessment,
          createdAt: FieldValue.serverTimestamp(),
          source: 'entry_trigger',
          triggeringEntryId: event.params.entryId
        });

        console.log(`High burnout risk detected for user ${userId}: ${assessment.riskLevel} (${assessment.riskScore})`);
      }

      return { success: true, riskLevel: assessment.riskLevel };
    } catch (error) {
      console.error(`Error checking burnout for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }
);

// ============================================
// GOAL LIFECYCLE PROCESSING (Server-Side)
// ============================================

// Goal detection patterns (mirror of client-side goalLifecycle.js)
const GOAL_PATTERNS = [
  /I want to\s+(.+)/i,
  /I('m| am) going to\s+(.+)/i,
  /planning to\s+(.+)/i,
  /my goal is to\s+(.+)/i,
  /I('m| am) working on\s+(.+)/i,
  /trying to\s+(.+)/i,
  /hoping to\s+(.+)/i
];

const TERMINATION_PATTERNS = [
  /I('m| am) (no longer|not) (interested in|pursuing|going after)/i,
  /decided (against|not to)/i,
  /giving up on/i,
  /moving on from/i,
  /that('s| is) (not|no longer) (a priority|important)/i,
  /changed my mind about/i,
  /I don't want to anymore/i,
  /not going to happen/i,
  /abandoning/i,
  /letting go of/i
];

const ACHIEVEMENT_PATTERNS = [
  /I (did it|made it|got it|achieved|accomplished)/i,
  /finally\s+(.+)ed/i,
  /succeeded in/i,
  /completed/i,
  /finished/i,
  /reached my goal/i,
  /mission accomplished/i,
  /got the (job|offer|promotion)/i
];

const PROGRESS_PATTERNS = [
  /making progress on/i,
  /step closer to/i,
  /working towards/i,
  /getting better at/i,
  /improving/i,
  /on track/i
];

/**
 * Extract goal topic from text
 */
function extractGoalTopic(text) {
  // Try @goal: tags first
  const goalTagMatch = text.match(/@goal:([a-z_]+)/i);
  if (goalTagMatch) {
    return goalTagMatch[1].replace(/_/g, ' ');
  }

  // Try pattern matching
  for (const pattern of GOAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const goalText = match[1] || match[2] || match[0];
      return goalText
        .replace(/[.!?,;:].*$/, '')
        .trim()
        .slice(0, 100);
    }
  }

  return null;
}

/**
 * Check for progress language
 */
function detectsProgressLanguage(text) {
  if (!text) return false;
  return PROGRESS_PATTERNS.some(p => p.test(text));
}

/**
 * Normalize topic to underscore format for consistency
 */
function normalizeTopicKey(topic) {
  return topic.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Create or update a goal in signal_states collection
 */
async function upsertGoalState(userId, topic, entryId, updateType, context = {}) {
  const signalStatesRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('signal_states');

  const topicKey = normalizeTopicKey(topic);

  // Check if goal already exists
  const existingSnapshot = await signalStatesRef
    .where('type', '==', 'goal')
    .where('topic', '==', topicKey)
    .limit(1)
    .get();

  const now = FieldValue.serverTimestamp();

  if (existingSnapshot.empty) {
    // Create new goal (proposed state)
    if (updateType === 'termination' || updateType === 'achievement') {
      // Don't create a new goal just to terminate it
      console.log(`Skipping goal creation for ${topicKey} - termination without existing goal`);
      return null;
    }

    const newGoal = {
      type: 'goal',
      topic: topicKey,
      displayName: topic,
      state: 'proposed',
      stateHistory: [{
        from: null,
        to: 'proposed',
        at: now,
        context: { detectedFrom: entryId }
      }],
      sourceEntries: [entryId],
      metadata: {
        detectedAt: new Date().toISOString(),
        originalText: context.originalText?.slice(0, 500)
      },
      createdAt: now,
      lastUpdated: now
    };

    const docRef = await signalStatesRef.add(newGoal);
    console.log(`Created new goal: ${topicKey} (${docRef.id})`);
    return { id: docRef.id, ...newGoal, isNew: true };
  } else {
    // Update existing goal
    const existingDoc = existingSnapshot.docs[0];
    const existingData = existingDoc.data();
    const existingState = existingData.state;

    // Skip if already in terminal state
    if (['achieved', 'abandoned'].includes(existingState)) {
      console.log(`Skipping update for terminated goal: ${topicKey} (${existingState})`);
      return { id: existingDoc.id, ...existingData, skipped: true };
    }

    let newState = existingState;
    let historyEntry = null;

    switch (updateType) {
      case 'termination':
        newState = 'abandoned';
        historyEntry = { from: existingState, to: 'abandoned', at: now, context: { terminationEntry: entryId, reason: 'termination_language' } };
        break;
      case 'achievement':
        newState = 'achieved';
        historyEntry = { from: existingState, to: 'achieved', at: now, context: { achievementEntry: entryId } };
        break;
      case 'progress':
        // Auto-confirm proposed goals on progress
        if (existingState === 'proposed') {
          newState = 'active';
          historyEntry = { from: 'proposed', to: 'active', at: now, context: { autoConfirmed: true, progressEntry: entryId } };
        }
        // For active goals, just update lastUpdated
        break;
      case 'mention':
        // Just update lastUpdated to prevent false abandonment detection
        break;
    }

    const updateData = {
      lastUpdated: now,
      sourceEntries: FieldValue.arrayUnion(entryId)
    };

    if (newState !== existingState && historyEntry) {
      // Limit stateHistory to prevent document bloat
      let newHistory = [...(existingData.stateHistory || []), historyEntry];
      if (newHistory.length > 20) {
        const firstEntry = newHistory[0];
        const recentEntries = newHistory.slice(-19);
        newHistory = [firstEntry, ...recentEntries];
      }

      updateData.state = newState;
      updateData.stateHistory = newHistory;
    }

    await existingDoc.ref.update(updateData);
    console.log(`Updated goal ${topicKey}: ${existingState} → ${newState}`);

    return { id: existingDoc.id, state: newState, previousState: existingState };
  }
}

/**
 * Process an entry for goal signals
 * Called after entry is created to update signal_states
 */
async function processEntryForGoals(userId, entry) {
  const entryText = entry.text || '';
  const entryId = entry.id;

  // Method 1: Check if entry analysis already extracted goal_update
  const goalUpdate = entry.analysis?.goal_update ||
                     entry.analysis?.extractEnhancedContext?.goal_update;

  if (goalUpdate && goalUpdate.tag) {
    const topic = goalUpdate.tag.replace('@goal:', '').replace(/_/g, ' ');
    const status = goalUpdate.status;

    let updateType = 'mention';
    if (status === 'achieved') updateType = 'achievement';
    else if (status === 'abandoned') updateType = 'termination';
    else if (status === 'progress' || status === 'struggling') updateType = 'progress';

    return await upsertGoalState(userId, topic, entryId, updateType, { originalText: entryText });
  }

  // Method 2: Check for explicit @goal: tag in entry tags
  const goalTag = (entry.tags || []).find(t => t.startsWith('@goal:'));
  if (goalTag) {
    const topic = goalTag.replace('@goal:', '').replace(/_/g, ' ');

    // Determine update type from entry text
    let updateType = 'mention';
    if (detectsTerminationLanguage(entryText)) updateType = 'termination';
    else if (detectsAchievementLanguage(entryText)) updateType = 'achievement';
    else if (detectsProgressLanguage(entryText)) updateType = 'progress';

    return await upsertGoalState(userId, topic, entryId, updateType, { originalText: entryText });
  }

  // Method 3: Pattern-based goal extraction
  const extractedTopic = extractGoalTopic(entryText);
  if (extractedTopic) {
    // Check for termination first
    if (detectsTerminationLanguage(entryText)) {
      return await upsertGoalState(userId, extractedTopic, entryId, 'termination', { originalText: entryText });
    }

    if (detectsAchievementLanguage(entryText)) {
      return await upsertGoalState(userId, extractedTopic, entryId, 'achievement', { originalText: entryText });
    }

    if (detectsProgressLanguage(entryText)) {
      return await upsertGoalState(userId, extractedTopic, entryId, 'progress', { originalText: entryText });
    }

    // New goal detected
    return await upsertGoalState(userId, extractedTopic, entryId, 'new', { originalText: entryText });
  }

  // Method 4: Check if entry text terminates any existing active goals
  if (detectsTerminationLanguage(entryText) || detectsAchievementLanguage(entryText)) {
    // Fetch active goals and check if any are mentioned
    const activeGoals = await fetchActiveGoalStates(userId);

    for (const [topic, goalState] of activeGoals) {
      const topicWords = topic.split('_');
      const textLower = entryText.toLowerCase();

      // Check if entry mentions this goal's topic
      const isMentioned = topicWords.some(word =>
        word.length > 3 && textLower.includes(word)
      );

      if (isMentioned) {
        const updateType = detectsAchievementLanguage(entryText) ? 'achievement' : 'termination';
        return await upsertGoalState(userId, topic, entryId, updateType, { originalText: entryText });
      }
    }
  }

  return null;
}

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

/**
 * Cloud Function: Exchange Google ID Token for Firebase Custom Token
 *
 * This is used for native iOS/Android sign-in where the Firebase SDK's
 * signInWithCredential hangs in Capacitor's WKWebView.
 *
 * Flow:
 * 1. Native app gets Google ID token via Capacitor Social Login
 * 2. Native app calls this function with the ID token
 * 3. This function verifies the token with Google
 * 4. Creates a Firebase custom token
 * 5. Returns the custom token to the native app
 * 6. Native app uses signInWithCustomToken (which works in WKWebView)
 */
export const exchangeGoogleToken = onCall(
  {
    cors: true,
    maxInstances: 20,
    // No auth required - this IS the sign-in endpoint
  },
  async (request) => {
    const { idToken } = request.data;

    if (!idToken) {
      throw new HttpsError('invalid-argument', 'idToken is required');
    }

    console.log('Received Google ID token exchange request');

    try {
      // Verify the Google ID token
      // Use Google's tokeninfo endpoint for verification
      const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
      const verifyResponse = await fetch(verifyUrl);

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        console.error('Google token verification failed:', verifyResponse.status, errorText);
        throw new HttpsError('unauthenticated', 'Invalid Google ID token');
      }

      const tokenInfo = await verifyResponse.json();
      console.log('Token verified for:', tokenInfo.email);

      // Verify the token is for our app (check audience)
      const validAudiences = [
        '581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com', // Web client
        '581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com', // iOS client
      ];

      if (!validAudiences.includes(tokenInfo.aud)) {
        console.error('Invalid audience:', tokenInfo.aud);
        throw new HttpsError('unauthenticated', 'Token has invalid audience');
      }

      // Check if email is verified
      if (tokenInfo.email_verified !== 'true') {
        console.warn('Email not verified for:', tokenInfo.email);
        // Still allow sign-in, but log it
      }

      // Get user info from Google token
      const email = tokenInfo.email;
      const name = tokenInfo.name;
      const picture = tokenInfo.picture;

      // Look up existing Firebase user by email to preserve their data
      // If they signed in via web before, they have a different UID than tokenInfo.sub
      let uid;
      try {
        const existingUser = await getAuth().getUserByEmail(email);
        uid = existingUser.uid;
        console.log('Found existing Firebase user:', uid, 'for email:', email);
      } catch (userError) {
        if (userError.code === 'auth/user-not-found') {
          // No existing user - use Google sub as new UID
          uid = tokenInfo.sub;
          console.log('No existing user, creating with Google sub:', uid);
        } else {
          throw userError;
        }
      }

      console.log('Creating custom token for uid:', uid);

      // Create a Firebase custom token
      const customToken = await getAuth().createCustomToken(uid, {
        // Additional claims (accessible via auth.token in security rules)
        email: email,
        name: name,
        picture: picture,
        provider: 'google'
      });

      console.log('Custom token created successfully for:', email);

      return {
        customToken,
        user: {
          uid,
          email,
          name,
          picture
        }
      };

    } catch (error) {
      console.error('Error in exchangeGoogleToken:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', 'Failed to exchange Google token: ' + error.message);
    }
  }
);
