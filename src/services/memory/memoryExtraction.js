/**
 * Memory Extraction Service
 *
 * Extracts memory-worthy information from journal entries to build
 * the persistent memory graph. This runs as part of the entry analysis
 * pipeline (Cloud Function) and client-side for immediate feedback.
 *
 * Extracts:
 * - People mentioned (name, relationship, sentiment, topics)
 * - Significant events (milestones, challenges, achievements)
 * - Values and themes
 * - Follow-up questions for the companion to ask later
 *
 * Safety:
 * - Does NOT store crisis keywords or graphic descriptions
 * - Triggers soft block for crisis content instead of memorizing
 */

import { executePromptFn } from '../../config';
import {
  upsertPerson,
  addEvent,
  upsertValue,
  updateCoreMemory,
  addFollowUp,
  recordValueGap
} from './memoryGraph';

// Keywords that should NOT be stored in memory
const CRISIS_KEYWORDS = [
  'suicide', 'kill myself', 'end my life', 'self-harm', 'cutting',
  'overdose', 'want to die', 'better off dead', 'no reason to live'
];

/**
 * Check if text contains crisis content
 * @param {string} text - Text to check
 * @returns {boolean} True if crisis content detected
 */
export const containsCrisisContent = (text) => {
  const lowerText = text.toLowerCase();
  return CRISIS_KEYWORDS.some(keyword => lowerText.includes(keyword));
};

/**
 * Sanitize text to remove crisis-related content before storing
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export const sanitizeForMemory = (text) => {
  if (!text) return text;

  let sanitized = text;
  CRISIS_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(keyword, 'gi');
    sanitized = sanitized.replace(regex, '[content removed for safety]');
  });

  return sanitized;
};

/**
 * Extract memory-worthy information from a journal entry
 * Uses AI to identify people, events, values, and follow-ups
 *
 * @param {Object} entry - The journal entry
 * @param {Object} existingMemory - Current memory graph for context
 * @returns {Object} Extracted memory data
 */
export const extractMemoryFromEntry = async (entry, existingMemory = {}) => {
  // Safety check - don't process crisis content for memory
  if (containsCrisisContent(entry.text)) {
    return {
      skipped: true,
      reason: 'crisis_content',
      message: 'Entry contains crisis content - not storing in long-term memory'
    };
  }

  const existingPeopleNames = existingMemory.people?.map(p => p.name) || [];
  const existingThemes = existingMemory.core?.themes?.map(t => t.theme) || [];
  const existingValues = existingMemory.values?.map(v => v.value) || [];

  const prompt = `
Analyze this journal entry and extract memory-worthy information.

ENTRY TEXT:
${entry.text}

ENTRY DATE: ${entry.effectiveDate || new Date().toISOString()}
ENTRY MOOD: ${entry.analysis?.mood_score ?? 'unknown'}
ENTRY TYPE: ${entry.analysis?.entry_type || 'reflection'}

EXISTING PEOPLE IN MEMORY: ${existingPeopleNames.length > 0 ? existingPeopleNames.join(', ') : 'None yet'}
EXISTING THEMES: ${existingThemes.length > 0 ? existingThemes.join(', ') : 'None yet'}
EXISTING VALUES: ${existingValues.length > 0 ? existingValues.join(', ') : 'None yet'}

Extract the following (return JSON only):

{
  "newPeople": [
    {
      "name": "string - the person's name or identifier",
      "relationship": "string - friend, family, coworker, partner, therapist, etc.",
      "sentiment": "number -1 to 1 - how the user feels about this person in this entry",
      "topics": [
        { "topic": "string", "sentiment": "number -1 to 1" }
      ],
      "significantMoment": "string or null - if this entry describes something notable about this person"
    }
  ],
  "peopleUpdates": [
    {
      "name": "string - name of existing person",
      "sentiment": "number - sentiment in this entry",
      "topics": [{ "topic": "string", "sentiment": "number" }],
      "significantMoment": "string or null"
    }
  ],
  "events": [
    {
      "description": "string - brief description of the event",
      "type": "milestone | challenge | loss | achievement | change",
      "emotionalImpact": "number 1-10",
      "resolved": "boolean",
      "relatedPeople": ["string - names"],
      "followUpQuestions": ["string - questions to ask later about this event"]
    }
  ],
  "valuesMentioned": [
    {
      "value": "string - family, creativity, health, career, etc.",
      "importance": "number 1-10",
      "aligned": "boolean - is the user acting in alignment with this value?",
      "gapDescription": "string or null - if not aligned, describe the gap"
    }
  ],
  "themeUpdates": [
    {
      "theme": "string - career_transition, relationship_issues, self_improvement, etc.",
      "sentiment": "struggling | growing | resolved",
      "isNew": "boolean"
    }
  ],
  "followUps": [
    {
      "question": "string - a thoughtful question the companion should ask later",
      "context": "string - why this question is relevant"
    }
  ],
  "communicationInsights": {
    "preferredStyle": "warm | direct | analytical | null - if detectable from this entry",
    "respondsWellTo": ["string - validation, practical_advice, questions, etc."]
  }
}

RULES:
1. Only extract what's clearly present in the entry
2. Be conservative with events - only significant moments
3. Don't infer relationships if not clearly stated
4. Follow-up questions should be genuinely helpful, not intrusive
5. For values, focus on core life values (family, health, career, creativity, etc.)
6. Don't store any graphic or crisis-related content
7. If someone is mentioned but relationship unclear, use "acquaintance"

Return valid JSON only.`;

  try {
    const result = await executePromptFn({
      prompt,
      systemPrompt: 'You are a memory extraction system for a mental health journal app. Extract structured information for the AI companion to remember. Be thoughtful and conservative.'
    });

    const jsonStr = result.data?.response?.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(jsonStr);

    return {
      success: true,
      extraction: extracted,
      entryId: entry.id,
      timestamp: new Date()
    };
  } catch (e) {
    console.error('Memory extraction failed:', e);
    return {
      success: false,
      error: e.message,
      entryId: entry.id
    };
  }
};

/**
 * Apply extracted memory to the memory graph
 * Called after extraction to persist the memories
 *
 * @param {string} userId - User ID
 * @param {Object} extraction - The extracted memory data
 * @param {string} entryId - The source entry ID
 */
export const applyMemoryExtraction = async (userId, extraction, entryId) => {
  if (!extraction || extraction.skipped) {
    return { applied: false, reason: extraction?.reason || 'no_extraction' };
  }

  const results = {
    peopleCreated: 0,
    peopleUpdated: 0,
    eventsCreated: 0,
    valuesUpdated: 0,
    followUpsAdded: 0,
    themesUpdated: 0
  };

  try {
    // Process new people
    if (extraction.newPeople?.length > 0) {
      for (const person of extraction.newPeople) {
        const result = await upsertPerson(userId, {
          name: sanitizeForMemory(person.name),
          relationship: person.relationship,
          sentiment: person.sentiment,
          topics: person.topics?.map(t => ({
            topic: sanitizeForMemory(t.topic),
            sentiment: t.sentiment
          })),
          entryId,
          significantMoment: sanitizeForMemory(person.significantMoment)
        });
        if (result.created) results.peopleCreated++;
        if (result.updated) results.peopleUpdated++;
      }
    }

    // Process people updates
    if (extraction.peopleUpdates?.length > 0) {
      for (const update of extraction.peopleUpdates) {
        await upsertPerson(userId, {
          name: update.name,
          sentiment: update.sentiment,
          topics: update.topics?.map(t => ({
            topic: sanitizeForMemory(t.topic),
            sentiment: t.sentiment
          })),
          entryId,
          significantMoment: sanitizeForMemory(update.significantMoment)
        });
        results.peopleUpdated++;
      }
    }

    // Process events
    if (extraction.events?.length > 0) {
      for (const event of extraction.events) {
        await addEvent(userId, {
          description: sanitizeForMemory(event.description),
          type: event.type,
          emotionalImpact: event.emotionalImpact,
          resolved: event.resolved,
          relatedPeople: event.relatedPeople,
          followUpQuestions: event.followUpQuestions?.map(q => sanitizeForMemory(q)),
          entryId
        });
        results.eventsCreated++;
      }
    }

    // Process values
    if (extraction.valuesMentioned?.length > 0) {
      for (const value of extraction.valuesMentioned) {
        await upsertValue(userId, {
          value: value.value,
          importance: value.importance,
          source: 'ai_inferred'
        });

        // Record value-behavior gap if detected
        if (value.aligned === false && value.gapDescription) {
          // Find the value ID first
          const { findValueByName } = await import('./memoryGraph');
          const existingValue = await findValueByName(userId, value.value);
          if (existingValue) {
            await recordValueGap(userId, existingValue.id, {
              description: sanitizeForMemory(value.gapDescription),
              entryId
            });
          }
        }
        results.valuesUpdated++;
      }
    }

    // Process theme updates
    if (extraction.themeUpdates?.length > 0) {
      // Theme updates go to core memory
      const { getCoreMemory } = await import('./memoryGraph');
      const core = await getCoreMemory(userId);
      const existingThemes = core.themes || [];

      for (const themeUpdate of extraction.themeUpdates) {
        const existingIndex = existingThemes.findIndex(
          t => t.theme === themeUpdate.theme
        );

        if (existingIndex >= 0) {
          existingThemes[existingIndex].sentiment = themeUpdate.sentiment;
          existingThemes[existingIndex].mentions =
            (existingThemes[existingIndex].mentions || 0) + 1;
          existingThemes[existingIndex].relatedEntries =
            [...(existingThemes[existingIndex].relatedEntries || []), entryId].slice(-10);
        } else if (themeUpdate.isNew) {
          existingThemes.push({
            id: `theme_${Date.now()}`,
            theme: themeUpdate.theme,
            firstDetected: new Date(),
            mentions: 1,
            sentiment: themeUpdate.sentiment,
            relatedEntries: [entryId]
          });
        }
        results.themesUpdated++;
      }

      await updateCoreMemory(userId, { themes: existingThemes });
    }

    // Process follow-ups
    if (extraction.followUps?.length > 0) {
      for (const followUp of extraction.followUps) {
        await addFollowUp(userId, {
          question: sanitizeForMemory(followUp.question),
          context: sanitizeForMemory(followUp.context)
        });
        results.followUpsAdded++;
      }
    }

    // Process communication insights
    if (extraction.communicationInsights) {
      const updates = {};

      if (extraction.communicationInsights.preferredStyle) {
        updates['preferences.communicationStyle'] =
          extraction.communicationInsights.preferredStyle;
      }

      if (extraction.communicationInsights.respondsWellTo?.length > 0) {
        // Merge with existing
        const { getCoreMemory } = await import('./memoryGraph');
        const core = await getCoreMemory(userId);
        const existing = core.preferences?.respondWellTo || [];
        const merged = [...new Set([...existing, ...extraction.communicationInsights.respondsWellTo])];
        updates['preferences.respondWellTo'] = merged;
      }

      if (Object.keys(updates).length > 0) {
        await updateCoreMemory(userId, updates);
      }
    }

    return { applied: true, results };
  } catch (e) {
    console.error('Failed to apply memory extraction:', e);
    return { applied: false, error: e.message };
  }
};

/**
 * Quick extraction for entities/tags from entry
 * Lighter weight than full extraction, used for immediate tagging
 *
 * @param {string} text - Entry text
 * @param {Object} analysis - Existing analysis from entry
 * @returns {Object} Quick extraction results
 */
export const quickExtractEntities = (text, analysis) => {
  const entities = {
    people: [],
    activities: [],
    places: [],
    topics: []
  };

  // Extract from existing tags if available
  if (analysis?.tags) {
    for (const tag of analysis.tags) {
      if (tag.startsWith('@person:')) {
        entities.people.push(tag.replace('@person:', '').replace(/_/g, ' '));
      } else if (tag.startsWith('@activity:')) {
        entities.activities.push(tag.replace('@activity:', '').replace(/_/g, ' '));
      } else if (tag.startsWith('@place:')) {
        entities.places.push(tag.replace('@place:', '').replace(/_/g, ' '));
      } else if (tag.startsWith('@topic:')) {
        entities.topics.push(tag.replace('@topic:', '').replace(/_/g, ' '));
      }
    }
  }

  return entities;
};

/**
 * Batch extraction for multiple entries
 * Used for users who journal multiple times per day
 *
 * @param {Object[]} entries - Array of entries to process
 * @param {Object} existingMemory - Current memory graph
 * @returns {Object} Combined extraction results
 */
export const batchExtractMemory = async (entries, existingMemory) => {
  // Sort by date
  const sorted = [...entries].sort((a, b) =>
    new Date(a.effectiveDate) - new Date(b.effectiveDate)
  );

  const allExtractions = [];
  let currentMemory = existingMemory;

  for (const entry of sorted) {
    const extraction = await extractMemoryFromEntry(entry, currentMemory);
    allExtractions.push({ entryId: entry.id, extraction });

    // Update currentMemory with extracted info for context in next extraction
    // (Simplified - in practice would merge properly)
    if (extraction.success && extraction.extraction?.newPeople) {
      currentMemory = {
        ...currentMemory,
        people: [
          ...(currentMemory.people || []),
          ...extraction.extraction.newPeople.map(p => ({ name: p.name }))
        ]
      };
    }
  }

  return {
    totalEntries: entries.length,
    extractions: allExtractions,
    timestamp: new Date()
  };
};

export default {
  extractMemoryFromEntry,
  applyMemoryExtraction,
  quickExtractEntities,
  batchExtractMemory,
  containsCrisisContent,
  sanitizeForMemory
};
