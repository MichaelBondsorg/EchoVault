/**
 * Session Buffer Service
 *
 * Solves the "sync gap" problem: when a user journals and then immediately
 * opens chat, the Cloud Function hasn't yet extracted memories from that entry.
 *
 * The session buffer stores volatile context about the most recent entry in
 * sessionStorage (survives page refresh) or fast-expiring localStorage.
 *
 * This context is passed directly to the chat component as "volatile memory"
 * until the Cloud Function commits the permanent memory update.
 */

const SESSION_BUFFER_KEY = 'engram_session_buffer';
const BUFFER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes - enough for Cloud Function to process

/**
 * Store a recent entry in the session buffer
 * Called immediately after saving an entry
 *
 * @param {Object} entry - The entry that was just saved
 * @param {Object} analysis - The analysis results from the entry
 */
export const setSessionBuffer = (entry, analysis) => {
  const buffer = {
    recentEntry: {
      id: entry.id,
      text: entry.text,
      analysis: {
        mood_score: analysis?.mood_score,
        entry_type: analysis?.entry_type,
        tags: analysis?.tags || [],
        entities: analysis?.entities || [],
        therapeutic_response: analysis?.therapeutic_response
      },
      timestamp: new Date().toISOString()
    },
    expiresAt: new Date(Date.now() + BUFFER_EXPIRY_MS).toISOString(),
    createdAt: new Date().toISOString()
  };

  try {
    // Prefer sessionStorage (cleared on tab close, survives refresh)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(buffer));
    } else if (typeof localStorage !== 'undefined') {
      // Fallback to localStorage with explicit expiry check
      localStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(buffer));
    }
  } catch (e) {
    console.warn('Failed to set session buffer:', e);
  }

  return buffer;
};

/**
 * Get the session buffer if it hasn't expired
 *
 * @returns {Object|null} The session buffer or null if expired/not found
 */
export const getSessionBuffer = () => {
  try {
    let bufferStr = null;

    if (typeof sessionStorage !== 'undefined') {
      bufferStr = sessionStorage.getItem(SESSION_BUFFER_KEY);
    }

    if (!bufferStr && typeof localStorage !== 'undefined') {
      bufferStr = localStorage.getItem(SESSION_BUFFER_KEY);
    }

    if (!bufferStr) return null;

    const buffer = JSON.parse(bufferStr);

    // Check expiry
    if (isExpired(buffer.expiresAt)) {
      clearSessionBuffer();
      return null;
    }

    return buffer;
  } catch (e) {
    console.warn('Failed to get session buffer:', e);
    return null;
  }
};

/**
 * Check if a timestamp has expired
 *
 * @param {string|Date} expiresAt - The expiry timestamp
 * @returns {boolean} True if expired
 */
export const isExpired = (expiresAt) => {
  if (!expiresAt) return true;

  const expiryDate = new Date(expiresAt);
  return expiryDate < new Date();
};

/**
 * Clear the session buffer
 * Called when memory extraction Cloud Function confirms completion
 */
export const clearSessionBuffer = () => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_BUFFER_KEY);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_BUFFER_KEY);
    }
  } catch (e) {
    console.warn('Failed to clear session buffer:', e);
  }
};

/**
 * Check if the session buffer contains a specific entry
 *
 * @param {string} entryId - The entry ID to check
 * @returns {boolean} True if the entry is in the buffer
 */
export const hasEntryInBuffer = (entryId) => {
  const buffer = getSessionBuffer();
  return buffer?.recentEntry?.id === entryId;
};

/**
 * Update the session buffer expiry
 * Useful if the user is actively chatting
 */
export const extendBufferExpiry = () => {
  const buffer = getSessionBuffer();
  if (buffer) {
    buffer.expiresAt = new Date(Date.now() + BUFFER_EXPIRY_MS).toISOString();

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(buffer));
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(buffer));
      }
    } catch (e) {
      console.warn('Failed to extend session buffer:', e);
    }
  }
};

/**
 * Format session buffer for chat context
 * Returns a context-friendly representation of the volatile memory
 */
export const formatBufferForContext = (buffer) => {
  if (!buffer?.recentEntry) return null;

  const entry = buffer.recentEntry;
  const parts = [];

  parts.push(`[JUST JOURNALED - ${getTimeSince(entry.timestamp)}]`);

  if (entry.analysis?.mood_score !== undefined) {
    const moodPercent = Math.round(entry.analysis.mood_score * 100);
    parts.push(`Mood: ${moodPercent}%`);
  }

  if (entry.analysis?.entry_type) {
    parts.push(`Type: ${entry.analysis.entry_type}`);
  }

  // Include a snippet of the entry text for context
  if (entry.text) {
    const snippet = entry.text.length > 200
      ? entry.text.substring(0, 200) + '...'
      : entry.text;
    parts.push(`Entry: "${snippet}"`);
  }

  // Include key tags/entities
  if (entry.analysis?.tags?.length > 0) {
    const keyTags = entry.analysis.tags.filter(t => t.startsWith('@')).slice(0, 5);
    if (keyTags.length > 0) {
      parts.push(`Mentions: ${keyTags.join(', ')}`);
    }
  }

  return parts.join('\n');
};

/**
 * Get human-readable time since timestamp
 */
const getTimeSince = (timestamp) => {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  return `${diffHours} hours ago`;
};

export default {
  setSessionBuffer,
  getSessionBuffer,
  clearSessionBuffer,
  hasEntryInBuffer,
  extendBufferExpiry,
  formatBufferForContext,
  isExpired
};
