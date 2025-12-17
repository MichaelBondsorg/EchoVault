/**
 * Firebase Vector Search Service
 *
 * This service provides server-side vector search using Firebase's
 * Vector Search extension. This replaces client-side cosine similarity
 * calculations for better scalability.
 *
 * SETUP REQUIRED:
 * 1. Enable Firebase Blaze plan (required for extensions)
 * 2. Install the Vector Search extension in Firebase Console
 * 3. Create a vector index on your entries collection:
 *
 *    In firestore.indexes.json or Firebase Console:
 *    {
 *      "collectionGroup": "entries",
 *      "queryScope": "COLLECTION",
 *      "fields": [
 *        { "fieldPath": "embedding", "vectorConfig": { "dimension": 768, "flat": {} } }
 *      ]
 *    }
 *
 * 4. Set VITE_USE_FIREBASE_VECTOR_SEARCH=true in your .env file
 *
 * The embedding dimension (768) matches Google's text-embedding-004 model.
 */

import { db, collection, query, where, getDocs, limit as firestoreLimit } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// Feature flag - set via environment variable
export const VECTOR_SEARCH_ENABLED = import.meta.env.VITE_USE_FIREBASE_VECTOR_SEARCH === 'true';

/**
 * Check if Firebase Vector Search is available and configured
 */
export const isVectorSearchAvailable = () => {
  return VECTOR_SEARCH_ENABLED;
};

/**
 * Perform server-side vector search using Firebase
 *
 * @param {string} userId - User ID
 * @param {number[]} queryVector - Query embedding vector (768 dimensions)
 * @param {Object} options - Search options
 * @param {string} options.category - Filter by category
 * @param {number} options.limit - Max results (default: 10)
 * @param {number} options.distanceThreshold - Max distance (lower = more similar)
 * @returns {Promise<Object[]>} Matching entries with distance scores
 */
export const firebaseVectorSearch = async (userId, queryVector, options = {}) => {
  const {
    category = null,
    limit = 10,
    distanceThreshold = 0.8 // Cosine distance threshold
  } = options;

  if (!VECTOR_SEARCH_ENABLED) {
    console.warn('Firebase Vector Search is not enabled. Set VITE_USE_FIREBASE_VECTOR_SEARCH=true');
    return [];
  }

  if (!queryVector || queryVector.length !== 768) {
    console.error('Invalid query vector - must be 768 dimensions');
    return [];
  }

  try {
    const entriesRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries');

    // Build the vector query
    // Note: This uses the Firestore findNearest API
    // Syntax may vary based on Firebase SDK version
    let vectorQuery;

    if (category) {
      // With category filter
      vectorQuery = query(
        entriesRef,
        where('category', '==', category)
      );
    } else {
      vectorQuery = query(entriesRef);
    }

    // Execute vector similarity search
    // The findNearest method is available with the Vector Search extension
    const results = await vectorQuery
      .findNearest('embedding', queryVector, {
        limit,
        distanceMeasure: 'COSINE',
        distanceThreshold
      })
      .get();

    return results.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _vectorDistance: doc.distance, // Lower = more similar
      _vectorScore: 1 - doc.distance // Convert to similarity score (0-1)
    }));

  } catch (e) {
    // Check if error is due to missing index or extension
    if (e.code === 'failed-precondition' || e.message?.includes('index')) {
      console.error(
        'Firebase Vector Search index not configured. ' +
        'Please create a vector index on the "embedding" field. ' +
        'See: https://firebase.google.com/docs/firestore/vector-search'
      );
    } else if (e.message?.includes('findNearest')) {
      console.error(
        'findNearest not available. Make sure you have: ' +
        '1. Firebase SDK v10.5.0+ ' +
        '2. Vector Search extension enabled ' +
        '3. Vector index created on embedding field'
      );
    } else {
      console.error('Firebase Vector Search error:', e);
    }
    return [];
  }
};

/**
 * Alternative implementation using Firebase callable function
 * Use this if direct Firestore vector search isn't available
 *
 * Requires a Cloud Function like:
 *
 * exports.vectorSearch = functions.https.onCall(async (data, context) => {
 *   const { vector, category, limit } = data;
 *   const userId = context.auth.uid;
 *   // Perform vector search using Admin SDK
 *   // Return results
 * });
 */
export const firebaseVectorSearchViaFunction = async (queryVector, options = {}) => {
  // Placeholder for callable function implementation
  // This would call a Cloud Function that performs the vector search
  console.warn('firebaseVectorSearchViaFunction not implemented yet');
  return [];
};

/**
 * Hybrid search that combines Firebase Vector Search with client-side scoring
 *
 * Strategy:
 * 1. Use Firebase for initial vector similarity (fast, scalable)
 * 2. Apply client-side recency/entity/mood scoring to results
 *
 * @param {string} userId - User ID
 * @param {number[]} queryVector - Query embedding
 * @param {Object[]} localEntries - Local entries for fallback/scoring
 * @param {Object} options - Search options
 */
export const hybridFirebaseSearch = async (userId, queryVector, localEntries, options = {}) => {
  const {
    category = null,
    queryEntities = [],
    queryMood = null,
    limit = 20,
    weights = { vector: 0.4, recency: 0.3, entity: 0.2, mood: 0.1 }
  } = options;

  // If Firebase Vector Search is available, use it
  if (VECTOR_SEARCH_ENABLED && queryVector) {
    try {
      const firebaseResults = await firebaseVectorSearch(userId, queryVector, {
        category,
        limit: limit * 2, // Get more results for re-ranking
        distanceThreshold: 0.7
      });

      if (firebaseResults.length > 0) {
        // Apply client-side scoring for recency, entities, mood
        const { calculateRecencyScore, calculateEntityMatchScore, calculateMoodSimilarity } = await import('../rag');

        const scored = firebaseResults.map(entry => {
          const recencyScore = calculateRecencyScore(entry.effectiveDate || entry.createdAt);
          const entityScore = calculateEntityMatchScore(queryEntities, entry.tags);
          const moodScore = calculateMoodSimilarity(queryMood, entry.analysis?.mood_score);

          const totalScore =
            (entry._vectorScore * weights.vector) +
            (recencyScore * weights.recency) +
            (entityScore * weights.entity) +
            (moodScore * weights.mood);

          return {
            ...entry,
            _scores: {
              vector: entry._vectorScore,
              recency: recencyScore,
              entity: entityScore,
              mood: moodScore,
              total: totalScore
            }
          };
        });

        return scored
          .sort((a, b) => b._scores.total - a._scores.total)
          .slice(0, limit);
      }
    } catch (e) {
      console.warn('Firebase Vector Search failed, falling back to client-side:', e.message);
    }
  }

  // Fallback to client-side search
  const { hybridRetrieve } = await import('../rag');
  return hybridRetrieve({
    queryEmbedding: queryVector,
    queryEntities,
    queryMood,
    entries: localEntries,
    category,
    weights,
    topK: limit
  });
};

export default {
  isVectorSearchAvailable,
  firebaseVectorSearch,
  firebaseVectorSearchViaFunction,
  hybridFirebaseSearch,
  VECTOR_SEARCH_ENABLED
};
