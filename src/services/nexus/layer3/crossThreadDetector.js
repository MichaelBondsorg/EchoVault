/**
 * Cross-Thread Pattern Detector
 *
 * Identifies meta-patterns that span multiple threads.
 * Example: Career stress and friend health concerns share the same
 * underlying pattern of "helplessness about people you care for"
 */

import { getActiveThreads, getThread } from '../layer1/threadManager';
import { callGemini } from '../../ai/gemini';

// ============================================================
// META-PATTERN DEFINITIONS
// ============================================================

export const META_PATTERNS = {
  CONTROL_ANXIETY: {
    id: 'control_anxiety',
    displayName: 'Control Anxiety Pattern',
    description: 'Anxiety triggered by situations outside your control',
    threadCategories: ['career', 'relationship', 'health'],
    narrativeSignals: ['can\'t control', 'helpless', 'waiting', 'nothing I can do', 'out of my hands'],
    somaticSignature: ['tension', 'sleep_disturbance', 'digestive'],
    biometricSignature: { rhr: 'elevated', hrv: 'depressed' }
  },

  CARETAKER_BURDEN: {
    id: 'caretaker_burden',
    displayName: 'Caretaker Burden',
    description: 'Stress from caring for others at expense of self',
    threadCategories: ['relationship', 'health'],
    narrativeSignals: ['worried about', 'taking care of', 'helping', 'supporting', 'checking on'],
    somaticSignature: ['fatigue', 'tension'],
    biometricSignature: { strain: 'elevated', recovery: 'low' }
  },

  IDENTITY_THREAT: {
    id: 'identity_threat',
    displayName: 'Identity Threat Response',
    description: 'Perceived threats to self-concept or worth',
    threadCategories: ['career', 'relationship', 'growth'],
    narrativeSignals: ['what does this say about me', 'failure', 'incompetent', 'not good enough', 'inadequate'],
    somaticSignature: ['cardiovascular', 'sleep_disturbance'],
    biometricSignature: { rhr: 'elevated', mood: 'volatile' }
  },

  BELONGING_UNCERTAINTY: {
    id: 'belonging_uncertainty',
    displayName: 'Belonging Uncertainty',
    description: 'Anxiety about place in relationships or communities',
    threadCategories: ['relationship', 'social', 'career'],
    narrativeSignals: ['do they like me', 'fitting in', 'belong', 'outsider', 'alone'],
    somaticSignature: ['tension', 'cognitive'],
    biometricSignature: { hrv: 'depressed' }
  },

  MOMENTUM_SEEKING: {
    id: 'momentum_seeking',
    displayName: 'Momentum Seeking',
    description: 'Need for progress and forward motion',
    threadCategories: ['career', 'growth', 'creative'],
    narrativeSignals: ['stuck', 'stagnant', 'making progress', 'moving forward', 'accomplishing'],
    somaticSignature: [],
    biometricSignature: { mood: 'correlated_with_progress' }
  }
};

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * Analyze threads for meta-patterns
 */
export const detectMetaPatterns = async (userId, threads, entries) => {
  console.log('[CrossThread] Detecting meta-patterns...');

  const detectedPatterns = [];

  // Combine all thread and entry text
  const allText = [
    ...(threads || []).map(t => t.displayName),
    ...(entries || []).slice(-20).map(e => e.content || e.text || '')
  ].join(' ').toLowerCase();

  // Collect somatic signals across threads
  const allSomatics = new Set();
  for (const thread of (threads || [])) {
    (thread.somaticSignals || []).forEach(s => allSomatics.add(s));
  }

  // Check each meta-pattern
  for (const [key, pattern] of Object.entries(META_PATTERNS)) {
    let score = 0;
    const evidence = [];

    // Check narrative signals
    const matchingSignals = pattern.narrativeSignals.filter(signal =>
      allText.includes(signal)
    );
    if (matchingSignals.length > 0) {
      score += matchingSignals.length * 15;
      evidence.push({ type: 'narrative', signals: matchingSignals });
    }

    // Check thread categories
    const threadCategories = (threads || []).map(t => t.category);
    const matchingCategories = pattern.threadCategories.filter(cat =>
      threadCategories.includes(cat)
    );
    if (matchingCategories.length >= 2) {
      score += 20;
      evidence.push({ type: 'threads', categories: matchingCategories });
    }

    // Check somatic signature
    const matchingSomatics = pattern.somaticSignature.filter(s =>
      allSomatics.has(s)
    );
    if (matchingSomatics.length > 0) {
      score += matchingSomatics.length * 10;
      evidence.push({ type: 'somatic', signals: matchingSomatics });
    }

    // Threshold check
    if (score >= 35) {
      detectedPatterns.push({
        patternId: pattern.id,
        displayName: pattern.displayName,
        description: pattern.description,
        confidence: Math.min(score / 100, 0.95),
        evidence,
        affectedThreads: (threads || [])
          .filter(t => matchingCategories.includes(t.category))
          .map(t => t.id)
      });
    }
  }

  console.log(`[CrossThread] Detected ${detectedPatterns.length} meta-patterns`);
  return detectedPatterns.sort((a, b) => b.confidence - a.confidence);
};

/**
 * Generate insight from meta-pattern
 */
export const generateMetaPatternInsight = async (userId, metaPattern, context) => {
  console.log('[CrossThread] Generating meta-pattern insight...');

  const { threads, entries, baselines } = context;

  try {
    const affectedThreads = (threads || []).filter(t =>
      metaPattern.affectedThreads.includes(t.id)
    );

    if (affectedThreads.length === 0) {
      return null;
    }

    const prompt = `A user is exhibiting the "${metaPattern.displayName}" meta-pattern across multiple areas of their life.

META-PATTERN: ${metaPattern.description}

AFFECTED LIFE AREAS:
${affectedThreads.map(t => `- ${t.displayName} (${t.category}): sentiment ${Math.round((t.sentimentBaseline || 0.5) * 100)}%`).join('\n')}

EVIDENCE:
${metaPattern.evidence.map(e => `- ${e.type}: ${JSON.stringify(e.signals || e.categories)}`).join('\n')}

Generate an insight that:
1. Helps the user see the COMMON THREAD connecting these seemingly separate concerns
2. Names the underlying psychological pattern in accessible language
3. Explains why their body/mood responds similarly across these different areas
4. Provides ONE unified intervention that could help across all areas

Response format (JSON):
{
  "title": "The Connection Between [X] and [Y]",
  "realization": "The 'aha' moment in one sentence",
  "explanation": "2 paragraphs connecting the dots",
  "unified_intervention": {
    "action": "One thing that helps across all areas",
    "why": "Why this works for the underlying pattern"
  }
}`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return null;
    }

    const parsed = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return {
      type: 'meta_pattern',
      patternId: metaPattern.patternId,
      ...parsed,
      confidence: metaPattern.confidence,
      affectedThreads: metaPattern.affectedThreads,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[CrossThread] Meta-pattern insight failed:', error);
    return null;
  }
};

/**
 * Find threads that share common patterns
 */
export const findRelatedThreads = async (userId, threadId) => {
  console.log('[CrossThread] Finding related threads...');

  try {
    const threads = await getActiveThreads(userId);
    const sourceThread = threads.find(t => t.id === threadId);

    if (!sourceThread) {
      return [];
    }

    // Find threads with overlapping categories or similar sentiment patterns
    const related = threads.filter(t => {
      if (t.id === threadId) return false;

      // Same category = related
      if (t.category === sourceThread.category) return true;

      // Similar sentiment trajectory = potentially related
      if (t.sentimentTrajectory === sourceThread.sentimentTrajectory) return true;

      // Check for shared somatic signals
      const sharedSomatics = (t.somaticSignals || []).filter(s =>
        (sourceThread.somaticSignals || []).includes(s)
      );
      if (sharedSomatics.length > 0) return true;

      return false;
    });

    return related.map(t => ({
      id: t.id,
      displayName: t.displayName,
      category: t.category,
      relationshipType: t.category === sourceThread.category ? 'same_category' :
        t.sentimentTrajectory === sourceThread.sentimentTrajectory ? 'similar_trajectory' :
        'shared_somatics'
    }));
  } catch (error) {
    console.error('[CrossThread] Failed to find related threads:', error);
    return [];
  }
};
