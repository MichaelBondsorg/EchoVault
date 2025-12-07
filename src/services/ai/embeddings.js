import { GEMINI_API_KEY } from '../../config';

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
 * Generate an embedding vector for text using Google's text-embedding-004
 */
export const generateEmbedding = async (text, retryCount = 0) => {
  try {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
      console.error('Gemini API key not configured - embeddings will not be generated');
      return null;
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('generateEmbedding: Invalid or empty text provided');
      return null;
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: text }] } })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Embedding API error:', res.status, errorData);

      if (retryCount < 1 && res.status >= 500) {
        console.log('Retrying embedding generation after server error...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return generateEmbedding(text, retryCount + 1);
      }

      return null;
    }

    const data = await res.json();
    const embedding = data.embedding?.values || null;

    if (!embedding) {
      console.error('Embedding API returned no embedding values:', data);
    }

    return embedding;
  } catch (e) {
    console.error('generateEmbedding exception:', e);

    if (retryCount < 1) {
      console.log('Retrying embedding generation after exception...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return generateEmbedding(text, retryCount + 1);
    }

    return null;
  }
};
