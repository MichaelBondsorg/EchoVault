/**
 * Belief-Data Dissonance Detector
 *
 * Identifies contradictions between user's stated beliefs about themselves
 * and their actual behavioral/biometric data.
 *
 * This is a powerful but sensitive feature that must be handled with care.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { callGemini } from '../../ai/gemini';

// ============================================================
// MOOD01 CONVENTION (R4 T3)
// ============================================================
// Runtime `mood`/`analysis.mood_score` is stored 0-1 (see
// docs/superpowers/plans/2026-07-22-r4-insight-integrity.md). Every
// threshold below was previously written against a 0-100 assumption
// (e.g. `moodRange > 50`) and, against real 0-1 data, never fired.
// `displayMood100`/`displayMoodPoints` are the ONLY places a raw
// value/delta becomes a "N points"/"N%" interpretation string; they mirror
// `src/services/experiments/computeResult.js`'s `normalizeMoodTo100`
// domain semantics (reject out-of-domain, never clamp) without importing
// across the nexus/experiments boundary. `displayMood100` is for a single
// Mood01 value (domain [0,1]); `displayMoodPoints` is for a DIFFERENCE of
// two Mood01 values (domain [-1,1]).
const displayMood100 = (raw) => {
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return null;
  return Math.round(raw * 100);
};
const displayMoodPoints = (delta) => {
  if (!Number.isFinite(delta) || delta < -1 || delta > 1) return null;
  return Math.round(delta * 100);
};

// Note: per ratified decision 4, belief-dissonance insights are suppressed
// at the orchestrator seam (RISKY_CLAIMS_ENABLED) regardless of the scale
// fixes below — corrected thresholds only matter once Phase 1-2 evidence
// rails let that gate flip back on.
const MOOD_GATE_THRESHOLD = 0.50;

// ============================================================
// BELIEF EXTRACTION
// ============================================================

/**
 * Patterns that indicate self-descriptive statements
 */
const BELIEF_PATTERNS = [
  // "I am" statements
  { pattern: /i(?:'m| am) (?:a |an |the |very |pretty |quite |not |really )?(\w+(?:\s+\w+)?)/gi, type: 'identity' },

  // "I don't" / "I never" statements
  { pattern: /i (?:don't|never|rarely|seldom) (\w+(?:\s+\w+){0,3})/gi, type: 'behavior_denial' },

  // "I always" / "I usually" statements
  { pattern: /i (?:always|usually|often|typically) (\w+(?:\s+\w+){0,3})/gi, type: 'behavior_claim' },

  // "I feel like I" statements
  { pattern: /i feel (?:like |that )?i(?:'m| am) (\w+(?:\s+\w+){0,3})/gi, type: 'self_perception' },

  // "I think I'm" statements
  { pattern: /i think i(?:'m| am) (\w+(?:\s+\w+){0,3})/gi, type: 'self_assessment' },

  // "I'm okay with" / "I'm fine with" statements
  { pattern: /i(?:'m| am) (?:okay|fine|good|comfortable) with (\w+(?:\s+\w+){0,5})/gi, type: 'acceptance' },

  // "I should" / "I need to" statements (reveal implicit beliefs)
  { pattern: /i (?:should|need to|have to|must) (\w+(?:\s+\w+){0,4})/gi, type: 'should_statement' }
];

/**
 * Extract beliefs from entry text
 */
export const extractBeliefsFromEntry = (entryText, entryId) => {
  if (!entryText) return [];

  const beliefs = [];

  for (const { pattern, type } of BELIEF_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    const matches = entryText.matchAll(pattern);

    for (const match of matches) {
      const statement = match[0];
      const content = match[1];

      // Filter out common false positives
      if (!content || content.length < 3) continue;
      if (/^(going|doing|trying|getting|having|being)$/i.test(content)) continue;

      beliefs.push({
        id: `belief_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        statement: statement.trim(),
        content: content.trim(),
        type,
        extractedFrom: entryId,
        extractedAt: new Date().toISOString(),
        confidence: 0.7  // Base confidence, refined by LLM
      });
    }
  }

  return beliefs;
};

/**
 * Refine and categorize beliefs using LLM
 */
export const refineBeliefsWithLLM = async (rawBeliefs, fullEntryText) => {
  if (!rawBeliefs || rawBeliefs.length === 0) return [];

  try {
    const prompt = `Analyze these self-descriptive statements extracted from a journal entry:

RAW STATEMENTS:
${rawBeliefs.map((b, i) => `${i + 1}. "${b.statement}" (type: ${b.type})`).join('\n')}

FULL CONTEXT:
"${(fullEntryText || '').slice(0, 1000)}"

For each statement, determine:
1. Is this a genuine self-belief or just casual language?
2. What category does it fall into? (self_worth, productivity, relationships, health, emotional_regulation, identity)
3. What is the testable claim? (something we could validate against behavioral data)
4. Confidence that this represents a real self-belief (0-1)

Response format (JSON array):
[
  {
    "original": "I'm okay with being reliant on external success",
    "isGenuineBelief": true,
    "category": "self_worth",
    "testableClaim": "Mood is not significantly affected by career outcomes",
    "confidence": 0.85,
    "notes": "Direct statement about self-perception"
  }
]

Only include statements that represent genuine self-beliefs. Skip casual language.`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return rawBeliefs;
    }

    const refined = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return refined
      .filter(b => b.isGenuineBelief && b.confidence > 0.6)
      .map((b, i) => ({
        ...rawBeliefs[i],
        category: b.category,
        testableClaim: b.testableClaim,
        confidence: b.confidence,
        llmNotes: b.notes
      }));
  } catch (error) {
    console.error('[BeliefDissonance] LLM refinement failed:', error);
    return rawBeliefs;  // Return raw if LLM fails
  }
};

// ============================================================
// DISSONANCE DETECTION
// ============================================================

/**
 * Validate beliefs against behavioral data
 */
export const validateBeliefAgainstData = async (belief, userData) => {
  const { entries, baselines, threads } = userData;

  const validation = {
    supportingData: [],
    contradictingData: [],
    dissonanceScore: 0
  };

  if (!entries || entries.length === 0) {
    return validation;
  }

  // Category-specific validation logic
  switch (belief.category) {
    case 'self_worth': {
      // Check mood correlation with career events
      const careerEntries = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/job|career|interview|offer|rejected|work/);
      });

      if (careerEntries.length >= 5) {
        const careerMoods = careerEntries.map(e => e.mood ?? e.analysis?.mood_score).filter(m => m != null);
        const otherEntries = entries.filter(e => !careerEntries.includes(e));
        const otherMoods = otherEntries.map(e => e.mood ?? e.analysis?.mood_score).filter(m => m != null);

        const careerMoodVariance = calculateVariance(careerMoods);
        const otherMoodVariance = calculateVariance(otherMoods);

        // High variance on career days suggests high sensitivity. This is a
        // ratio of two same-unit variances, so it's scale-invariant — no
        // Mood01 conversion needed for the comparison itself.
        if (careerMoodVariance > otherMoodVariance * 1.5) {
          validation.contradictingData.push({
            metric: 'mood_variance_career_vs_other',
            value: careerMoodVariance / otherMoodVariance,
            interpretation: `Mood variance is ${Math.round(careerMoodVariance / otherMoodVariance * 100)}% higher on career-related days`
          });
        }

        // Check for extreme mood swings around career events (Mood01: a
        // >50-POINT range is a >0.5 range on the native 0-1 scale).
        const moodRange = Math.max(...careerMoods) - Math.min(...careerMoods);
        if (moodRange > 0.50) {
          validation.contradictingData.push({
            metric: 'career_mood_range',
            value: moodRange,
            interpretation: `Career events caused mood swings of ${displayMood100(moodRange)} points`
          });
        }
      }
      break;
    }

    case 'productivity': {
      // Check if rest days actually correlate with negative mood
      const restDays = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/rest|lazy|didn't work out|skipped|took it easy/);
      });

      const workoutDays = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/workout|gym|yoga|exercise|run/);
      });

      if (restDays.length >= 3 && workoutDays.length >= 5) {
        const restMoodAvg = average(restDays.map(e => e.mood).filter(m => m != null));
        const workoutMoodAvg = average(workoutDays.map(e => e.mood).filter(m => m != null));

        const moodDiff = workoutMoodAvg - restMoodAvg;

        // Mood01: a <5-POINT difference is <0.05 on the native 0-1 scale.
        if (Math.abs(moodDiff) < 0.05) {
          validation.contradictingData.push({
            metric: 'rest_vs_workout_mood',
            value: moodDiff,
            interpretation: `Only ${Math.abs(displayMoodPoints(moodDiff))}-point mood difference between rest and workout days`
          });
        }
      }
      break;
    }

    case 'emotional_regulation': {
      // Check mood volatility (Mood01: a >20% volatility reading is >0.20
      // on the native 0-1 scale)
      const moods = entries.map(e => e.mood).filter(m => m != null);
      const volatility = calculateVolatility(moods);

      if (belief.statement.toLowerCase().includes('stable') && volatility > 0.20) {
        validation.contradictingData.push({
          metric: 'mood_volatility',
          value: volatility,
          interpretation: `Mood volatility of ${displayMood100(volatility)}% suggests emotional variability`
        });
      }
      break;
    }

    case 'relationships': {
      // Check mood correlation with social entries
      const socialEntries = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/friend|family|partner|date|social|together/);
      });

      const aloneEntries = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/alone|solo|by myself|quiet day/);
      });

      if (socialEntries.length >= 3 && aloneEntries.length >= 3) {
        const socialMoodAvg = average(socialEntries.map(e => e.mood).filter(m => m != null));
        const aloneMoodAvg = average(aloneEntries.map(e => e.mood).filter(m => m != null));

        // Mood01: a >15-POINT difference is >0.15 on the native 0-1 scale.
        if (Math.abs(socialMoodAvg - aloneMoodAvg) > 0.15) {
          validation.contradictingData.push({
            metric: 'social_vs_alone_mood',
            value: socialMoodAvg - aloneMoodAvg,
            interpretation: `Social days average ${displayMoodPoints(socialMoodAvg - aloneMoodAvg)} points ${socialMoodAvg > aloneMoodAvg ? 'higher' : 'lower'} than alone days`
          });
        }
      }
      break;
    }
  }

  // Calculate dissonance score
  const supportWeight = validation.supportingData.length * 0.3;
  const contradictWeight = validation.contradictingData.length * 0.4;

  validation.dissonanceScore = Math.min(
    contradictWeight / (supportWeight + contradictWeight + 0.1),
    1
  );

  return validation;
};

/**
 * Generate gentle dissonance insight
 */
export const generateDissonanceInsight = async (belief, validation, recentMood) => {
  // Check mood gate - use most recent entry's mood (Mood01: was `|| 50` /
  // `= 50`, comparing a native 0-1 value against a 0-100-scale threshold —
  // `currentMood < 50` was ALWAYS true, so this gate always queued the
  // insight and it never actually surfaced).
  const currentMood = recentMood ?? 0.5;
  const moodThreshold = MOOD_GATE_THRESHOLD;

  if (currentMood < moodThreshold) {
    console.log('[BeliefDissonance] Mood gate triggered, queuing insight for later');
    return { queued: true, reason: 'mood_gate', currentMood };
  }

  // Only surface high-confidence dissonances
  if (validation.dissonanceScore < 0.5) {
    return null;
  }

  try {
    const prompt = `Generate a gentle, therapeutic insight about a potential belief-data dissonance.

USER'S STATED BELIEF:
"${belief.statement}"

CONTRADICTING DATA:
${validation.contradictingData.map(d => `- ${d.interpretation}`).join('\n')}

REQUIREMENTS:
1. Frame this as curiosity, not criticism
2. Use "I notice" or "Your data shows" language
3. End with an open question, not a conclusion
4. Normalize the gap between belief and behavior
5. Make it feel like an invitation to explore, not a judgment

FRAMING OPTIONS (choose one):
- "A Pattern Worth Noticing"
- "An Interesting Tension"
- "Something Your Data Reveals"

Response format (JSON):
{
  "title": "A Pattern Worth Noticing",
  "opening": "On [date], you reflected: '[belief]'",
  "observation": "Your data shows [specific finding]",
  "normalization": "This isn't a contradiction to resolve...",
  "invitation": "What do you make of this? Is this something you want to explore?",
  "journalPrompt": "A specific prompt for journaling about this"
}`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return null;
    }

    const insight = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return {
      type: 'belief_dissonance',
      beliefId: belief.id,
      ...insight,
      confidence: validation.dissonanceScore,
      originalBelief: belief.statement,
      evidence: validation.contradictingData,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[BeliefDissonance] Insight generation failed:', error);
    return null;
  }
};

// ============================================================
// BELIEF STORAGE
// ============================================================

/**
 * Save extracted beliefs to Firestore
 */
export const saveBeliefs = async (userId, beliefs) => {
  if (!beliefs || beliefs.length === 0) return;

  try {
    const beliefRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'beliefs'
    );

    const existing = await getDoc(beliefRef);
    const existingBeliefs = existing.exists() ? existing.data().extractedBeliefs || [] : [];

    // Deduplicate by content similarity
    const newBeliefs = beliefs.filter(newB =>
      !existingBeliefs.some(existB =>
        similarity(newB.content, existB.content) > 0.8
      )
    );

    if (newBeliefs.length === 0) return;

    await setDoc(beliefRef, {
      extractedBeliefs: [...existingBeliefs, ...newBeliefs].slice(-50),  // Keep last 50
      lastUpdated: Timestamp.now()
    }, { merge: true });

    console.log(`[BeliefDissonance] Saved ${newBeliefs.length} new beliefs`);
  } catch (error) {
    console.error('[BeliefDissonance] Failed to save beliefs:', error);
  }
};

/**
 * Get beliefs for validation
 */
export const getBeliefs = async (userId) => {
  if (!userId) return [];

  try {
    const beliefRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'beliefs'
    );

    const beliefDoc = await getDoc(beliefRef);
    if (!beliefDoc.exists()) return [];

    return beliefDoc.data().extractedBeliefs || [];
  } catch (error) {
    console.error('[BeliefDissonance] Failed to get beliefs:', error);
    return [];
  }
};

// ============================================================
// UTILITIES
// ============================================================

const calculateVariance = (arr) => {
  if (!arr || arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
};

const calculateVolatility = (arr) => {
  if (!arr || arr.length < 2) return 0;
  let totalChange = 0;
  for (let i = 1; i < arr.length; i++) {
    totalChange += Math.abs(arr[i] - arr[i - 1]);
  }
  return totalChange / (arr.length - 1);
};

const average = (arr) => arr && arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const similarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;

  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
};
