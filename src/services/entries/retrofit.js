import { doc, updateDoc } from '../../config/firebase';
import { APP_COLLECTION_ID, CURRENT_CONTEXT_VERSION } from '../../config/constants';
import { extractEnhancedContext } from '../analysis';

/**
 * Process older entries in background to extract structured tags
 */
export const retrofitEntriesInBackground = async (entries, userId, db, onProgress) => {
  // Find entries that need retrofitting (context_version < CURRENT_CONTEXT_VERSION)
  const needsRetrofit = entries.filter(e =>
    (e.context_version || 0) < CURRENT_CONTEXT_VERSION &&
    e.entry_type !== 'task' &&
    e.text?.length > 10
  );

  if (needsRetrofit.length === 0) {
    console.log('Retrofit: All entries are up to date');
    return;
  }

  console.log(`Retrofit: ${needsRetrofit.length} entries need processing`);

  // Process in small batches with delays to avoid API rate limits
  const BATCH_SIZE = 3;
  const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches
  const DELAY_BETWEEN_ENTRIES = 1000; // 1 second between entries in a batch

  let processed = 0;

  for (let i = 0; i < needsRetrofit.length; i += BATCH_SIZE) {
    const batch = needsRetrofit.slice(i, i + BATCH_SIZE);

    for (const entry of batch) {
      try {
        // Get recent entries for context (entries created before this one)
        const recentForContext = entries
          .filter(e => e.createdAt < entry.createdAt && e.id !== entry.id)
          .slice(0, 5);

        // Extract enhanced context
        const enhancedContext = await extractEnhancedContext(entry.text, recentForContext);

        if (enhancedContext) {
          // Merge new structured tags with existing tags
          const existingTags = entry.tags || [];
          const structuredTags = enhancedContext.structured_tags || [];
          const contextTopicTags = enhancedContext.topic_tags || [];

          // Filter out duplicates and empty values
          const allTags = [...new Set([...existingTags, ...structuredTags, ...contextTopicTags])]
            .filter(t => t && t.trim());

          // Prepare update
          const updateData = {
            tags: allTags,
            context_version: CURRENT_CONTEXT_VERSION
          };

          if (enhancedContext.continues_situation) {
            updateData.continues_situation = enhancedContext.continues_situation;
          }
          if (enhancedContext.goal_update?.tag) {
            updateData.goal_update = enhancedContext.goal_update;
          }

          // Update Firestore
          const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries', entry.id);
          await updateDoc(entryRef, updateData);

          processed++;
          console.log(`Retrofit: Processed ${processed}/${needsRetrofit.length} - "${entry.title?.substring(0, 30)}..."`);

          if (onProgress) {
            onProgress(processed, needsRetrofit.length);
          }
        }
      } catch (error) {
        console.error(`Retrofit: Failed to process entry ${entry.id}:`, error);
        // Continue with next entry even if one fails
      }

      // Delay between entries
      if (batch.indexOf(entry) < batch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ENTRIES));
      }
    }

    // Delay between batches (unless this is the last batch)
    if (i + BATCH_SIZE < needsRetrofit.length) {
      console.log(`Retrofit: Waiting before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`Retrofit: Complete! Processed ${processed} entries`);
};
