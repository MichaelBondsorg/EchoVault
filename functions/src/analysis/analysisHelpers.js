/**
 * Post-save AI analysis helpers (classification, therapeutic analysis, context
 * extraction, contextual insight) + the shared Gemini caller they use.
 *
 * Extracted verbatim from functions/index.js so BOTH the analyzeJournalEntry
 * callable and the server-owned single-pass orchestrator
 * (src/analysis/orchestrator.js) call the exact same prompts/logic - never a
 * fork. The callable and watchdog import these back into index.js unchanged.
 */
import { AI_CONFIG } from '../shared/constants.js';

const LLM_TIMEOUT_MS = 15000;

export async function callGemini(apiKey, systemPrompt, userPrompt, model = AI_CONFIG.analysis.primary) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      // Structured: log status + API error message only, never the prompt text.
      console.error('[callGemini] API error', { model, status: res.status, err: errorData?.error?.message });
      return null;
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('[callGemini] exception', { model, err: e?.message });
    return null;
  }
}


/**
 * Classify entry into type: task, mixed, reflection, or vent
 */
export async function classifyEntry(apiKey, text) {
  const prompt = `
    Classify this journal entry into ONE of these types:
    - "task": Pure task/todo list with specific one-time actions (e.g., "Need to buy groceries, call mom, submit report by Friday")
    - "mixed": Contains both specific tasks AND emotional reflection (e.g., "Feeling stressed about the deadline, need to finish report")
    - "reflection": Emotional processing, self-reflection, goal-setting, or intentions - no concrete one-time tasks (e.g., "I've been thinking about my relationship...", "My goals are to exercise more...")
    - "vent": Emotional release, dysregulated state, needs validation not advice (e.g., "I can't take this anymore, everything is falling apart")

    NOTE: Entries about goals, intentions, resolutions, or habits should be classified as "reflection" NOT "task".
    Goals like "work out every day" or "eat healthier" are ongoing intentions, not one-time tasks.

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
    - Extract ONLY explicit, concrete, one-time tasks/to-dos
    - Keep text concise (verb + object)
    - SKIP vague intentions ("I should exercise more" → NOT a task)
    - SKIP emotional statements ("I need to feel better" → NOT a task)
    - SKIP ongoing goals or habits ("work out every day", "eat healthier" → NOT tasks, these are GOALS)
    - SKIP aspirational statements ("My goals are to..." → NOT tasks, these are GOALS)
    - Tasks are specific actions: "Buy groceries", "Call doctor", "Submit report"
    - Goals are ongoing intentions: "Exercise more", "Work out daily", "Save money"
    - If entry starts with "My goal(s)" or discusses intentions/resolutions, return empty array
    - If no clear one-time tasks, return empty array

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
export async function analyzeEntry(apiKey, text, entryType = 'reflection', userLocalHour = null) {
  // Use user's local hour if provided, otherwise fall back to server time
  const currentHour = userLocalHour !== null ? userLocalHour : new Date().getHours();
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
          mood_score: null,
          analysisStatus: 'failed',
          framework: 'support',
          entry_type: 'vent'
        };
      }

      const jsonStr = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        title: parsed.title || text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : null,
        analysisStatus: typeof parsed.mood_score === 'number' ? 'available' : 'partial',
        moodModelVersion: 'gemini-analysis-v2',
        moodPromptVersion: 'mood-anchored-v2',
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
        mood_score: null,
        analysisStatus: 'failed',
        framework: 'support',
        entry_type: 'vent'
      };
    }
  }

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

    MOOD SCORING GUIDELINES (CRITICAL):
    Score based on the EMOTIONAL STATE being expressed, NOT keyword presence.
    - 0.0-0.2: Genuine distress - active suffering, crisis, overwhelming negative emotions
    - 0.2-0.4: Struggling - clearly frustrated, anxious, sad, but not in crisis
    - 0.4-0.6: Mixed/Neutral - everyday ups and downs, processing, mild concerns
    - 0.6-0.8: Generally positive - content, hopeful, minor wins
    - 0.8-1.0: Thriving - joy, excitement, celebration, gratitude

    IMPORTANT: Simply *mentioning* words like "anxiety", "stress", or "depression" does NOT mean low score.
    Someone can discuss anxiety topics calmly (0.5-0.6) or mention stress while feeling okay (0.5+).
    Score based on HOW they're expressing themselves, not WHAT topics they mention.
    Look for emotional language, tone, and context clues about their actual state.

    ANCHORED EXAMPLES:
    - Around 0.2: actively panicked, despairing, or unable to cope in the entry.
    - Around 0.5: calmly processing mixed feelings without clear positive or negative dominance.
    - Around 0.8: clearly joyful, energized, proud, hopeful, or savoring a meaningful win.
    Use the full range when the language supports it. Do not default uncertain results to 0.5;
    return null when the emotional state cannot be inferred reliably.

    Return JSON:
    {
      "title": "Short creative title (max 6 words)",
      "tags": ["Tag1", "Tag2"],
      "mood_score": null,
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
        "acknowledgment": "Warm, empathetic validation of the difficult feeling (1-2 sentences). Acknowledge the struggle is real and valid BEFORE offering any technique. E.g., 'Body image pressure in certain spaces is real and can feel overwhelming. It makes sense you'd feel uncomfortable in that environment.'",
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
        mood_score: null,
        analysisStatus: 'failed',
        framework: 'general',
        entry_type: entryType
      };
    }

    const jsonStr = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const result = {
      title: parsed.title || text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : null,
      analysisStatus: typeof parsed.mood_score === 'number' ? 'available' : 'partial',
      moodModelVersion: 'gemini-analysis-v2',
      moodPromptVersion: 'mood-anchored-v2',
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
      mood_score: null,
      analysisStatus: 'failed',
      framework: 'general',
      entry_type: entryType
    };
  }
}

/**
 * Extract enhanced context from entry
 */
export async function extractEnhancedContext(apiKey, text, recentEntriesContext = '') {
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

    8. GOALS/INTENTIONS (@goal:description) - BE SELECTIVE!
       - ONLY extract TRUE GOALS: Ongoing aspirations requiring sustained effort over time
       - A goal is something you work toward over weeks/months, not a one-off task

       TRUE GOALS (extract these):
         * Career/life direction: "find a new job", "get promoted", "start a business"
         * Health/fitness patterns: "exercise regularly", "lose weight", "eat healthier", "work out daily"
         * Personal development: "learn Spanish", "read more books", "meditate daily"
         * Financial: "save money", "pay off debt", "build emergency fund"
         * Relationship: "spend more quality time with family", "be a better listener"

       NOT GOALS - DO NOT EXTRACT (these are tasks/events):
         * One-off actions: "walk the dog", "check job listings", "prepare for interview"
         * Specific event prep: "prepare Anthropic interview", "do Pilates on Thursday"
         * Daily tasks: "walk Luna", "call mom", "check Databricks roles"
         * Single occurrences: "go to Barry's class", "see a movie", "hang out with friend"

       KEY DISTINCTION:
         * "Do Pilates on Thursday" = TASK (specific one-time action) → DO NOT tag as goal
         * "Do more Pilates" or "Add Pilates to my routine" = GOAL (ongoing intention) → Tag as @goal:do_more_pilates
         * "Prepare for Anthropic interview" = TASK → DO NOT tag
         * "Find a new job" or "Land a role in AI" = GOAL → Tag as @goal:find_new_job

       Examples of what TO extract: @goal:find_new_job, @goal:exercise_regularly, @goal:eat_healthier, @goal:save_money

       If unsure, ERR ON THE SIDE OF NOT extracting. Tasks should go in extracted_tasks, not goals.

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
export async function generateInsight(apiKey, currentText, historyContext, moodTrajectory = null, cyclicalPatterns = null, pendingPrompts = []) {
  const today = new Date();
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][today.getDay()];

  const moodContext = moodTrajectory
    ? `\nMOOD TRAJECTORY: ${moodTrajectory.description} (avg: ${moodTrajectory.average}, trend: ${moodTrajectory.trend})`
    : '';

  const cyclicalContext = cyclicalPatterns?.pattern
    ? `\nCYCLICAL PATTERN DETECTED: ${cyclicalPatterns.pattern}`
    : '';

  // Add pending prompts detection section if there are any
  const pendingPromptsSection = pendingPrompts && pendingPrompts.length > 0
    ? `\n\n    PENDING REFLECTION PROMPTS DETECTION:
    The user has these pending reflection prompts that were shown to them:
    ${pendingPrompts.map((p, i) => `${i + 1}. "${p}"`).join('\n    ')}

    If this entry MEANINGFULLY RESPONDS to any of these prompts (not just mentions keywords, but actually answers the question), include them in your response as "addressedPrompts".
    Only include prompts that are clearly addressed by this entry.`
    : '';

  const prompt = `
    You are a proactive memory assistant analyzing journal entries.
    Today's date: ${today.toLocaleDateString()} (${dayOfWeek})
    ${moodContext}${cyclicalContext}

    INSIGHT TYPES (choose the most appropriate):
    - "encouragement": User showing resilience or growth compared to past (PREFERRED)
    - "progress": Positive trend or improvement over time
    - "streak": Consistent positive behavior (3+ occurrences)
    - "pattern": Neutral observation of recurring theme
    - "reminder": Direct callback to something user mentioned before
    - "absence": Something negative that used to appear frequently but hasn't lately
    - "goal_check": Follow-up on a previously stated goal
    - "cyclical": Day-of-week or time-based pattern observation
    - "contradiction": User's current behavior contradicts their self-statement (use gently!)
    - "warning": ONLY for clear, actionable patterns where intervention could help

    CRITICAL - RELEVANCE RULE:
    The insight MUST be directly relevant to what the user wrote in their CURRENT entry.
    Do NOT surface warnings about topics unrelated to the current entry.
    If the current entry is about fitness goals, don't show warnings about relationships.

    CRITICAL - BALANCED PERSPECTIVE:
    Be pragmatic and non-judgmental about lifestyle choices.
    Acknowledge complexity - anxiety about a topic doesn't make the topic bad.
    Focus on the user's emotional experience, not the topic itself.
    If the user is processing feelings about something, support that processing.

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
    - "Warning" patterns should be within 7 days AND be directly relevant to current entry
    - "Progress/streak" should compare against 30 days ago
    - Don't flag patterns from entries older than 60 days unless truly significant

    If the connection feels forced, weak, unrelated to the current entry, or the entries are too old, return { "found": false }.
    ${pendingPromptsSection}

    Output JSON:
    {
      "found": true,
      "type": "warning" | "encouragement" | "pattern" | "reminder" | "progress" | "streak" | "absence" | "contradiction" | "goal_check" | "cyclical",
      "message": "Concise, insightful observation (1-2 sentences max)",
      "followUpQuestions": ["Relevant question 1?", "Relevant question 2?"],
      "addressedPrompts": ["Exact prompt text that was answered"] // optional, only if pending prompts were addressed
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
