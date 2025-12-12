import { generateEmbeddingFn } from '../../config';

/**
 * Calculate cosine similarity between two vectors
 */
export const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
};

/**
 * Find semantically relevant entries using vector similarity
 */
export const findRelevantMemories = (targetVector, allEntries, category, topK = 5) => {
  if (!targetVector) return [];
  const contextEntries = allEntries.filter(e => e.category === category);
  const scored = contextEntries.map(e => ({
    ...e,
    score: e.embedding ? cosineSimilarity(targetVector, e.embedding) : -1
  }));
  return scored.filter(e => e.score > 0.35).sort((a, b) => b.score - a.score).slice(0, topK);
};

/**
 * Generate an embedding vector for text using Cloud Function
 * @param {string} text - The text to generate an embedding for
 * @param {number} retryCount - Internal retry counter
 * @returns {Promise<number[]|null>} The embedding vector or null on failure
 */
export const generateEmbedding = async (text, retryCount = 0) => {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('generateEmbedding: Invalid or empty text provided');
      return null;
    }

    const result = await generateEmbeddingFn({ text });
    const embedding = result.data?.embedding || null;

    if (!embedding) {
      console.error('Embedding Cloud Function returned no embedding values');
    }

    return embedding;
  } catch (e) {
    console.error('generateEmbedding exception:', e);

    // Retry once on failure
    if (retryCount < 1) {
      console.log('Retrying embedding generation after exception...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return generateEmbedding(text, retryCount + 1);
    }

    return null;
  }
};
