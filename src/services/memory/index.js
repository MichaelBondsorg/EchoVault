/**
 * Memory Services
 *
 * Persistent memory system for the AI Companion.
 * Enables the chat to truly know the user over time.
 *
 * Components:
 * - memoryGraph: CRUD operations for memory entities (people, events, values)
 * - memoryExtraction: AI-powered extraction of memories from entries
 * - sessionBuffer: Volatile memory for sync gap (recent unsaved entries)
 */

// Memory Graph (CRUD operations)
export {
  // Core memory
  getCoreMemory,
  updateCoreMemory,
  addFollowUp,
  markFollowUpAsked,

  // People
  getPeople,
  getPerson,
  findPersonByName,
  upsertPerson,
  archivePerson,

  // Events
  getEvents,
  addEvent,
  updateEvent,

  // Values (ACT Framework)
  getValues,
  findValueByName,
  upsertValue,
  recordValueGap,
  confirmValue,

  // Conversations
  saveConversation,
  getRecentConversations,

  // Full memory graph
  getMemoryGraph,
  formatMemoryForContext,
  getMemoryPath,

  // Maintenance
  cascadeDeleteEntry,
  runRelevanceDecay
} from './memoryGraph';

// Memory Extraction (AI-powered)
export {
  extractMemoryFromEntry,
  applyMemoryExtraction,
  quickExtractEntities,
  batchExtractMemory,
  containsCrisisContent,
  sanitizeForMemory
} from './memoryExtraction';

// Session Buffer (Volatile memory for sync gap)
export {
  setSessionBuffer,
  getSessionBuffer,
  clearSessionBuffer,
  hasEntryInBuffer,
  extendBufferExpiry,
  formatBufferForContext,
  isExpired
} from './sessionBuffer';

// Default export with all services
import memoryGraph from './memoryGraph';
import memoryExtraction from './memoryExtraction';
import sessionBuffer from './sessionBuffer';

export default {
  ...memoryGraph,
  ...memoryExtraction,
  ...sessionBuffer
};
