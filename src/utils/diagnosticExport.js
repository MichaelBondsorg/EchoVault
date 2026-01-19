/**
 * Diagnostic Export Utility
 *
 * Exports full entry data as JSON for troubleshooting.
 * Includes all fields: analysis, healthContext, environmentContext, etc.
 */

/**
 * Export entries as a diagnostic JSON file
 * @param {Array} entries - Journal entries from Firestore
 * @param {Object} options - Export options
 * @param {string} options.userId - User ID for reference
 * @returns {void} Downloads a JSON file
 */
export const exportDiagnosticJSON = (entries, options = {}) => {
  const { userId = 'unknown' } = options;

  // Calculate summary statistics
  const summary = {
    exportedAt: new Date().toISOString(),
    userId,
    totalEntries: entries.length,
    entriesWithAnalysis: entries.filter(e => e.analysis).length,
    entriesWithMoodScore: entries.filter(e => e.analysis?.mood_score != null).length,
    entriesWithHealthContext: entries.filter(e => e.healthContext).length,
    entriesWithEnvironmentContext: entries.filter(e => e.environmentContext).length,
    entriesWithTags: entries.filter(e => e.analysis?.tags?.length > 0).length,
    entriesWithThemes: entries.filter(e => e.analysis?.themes?.length > 0).length,
    entriesWithEmotions: entries.filter(e => e.analysis?.emotions?.length > 0).length,
  };

  // Analyze mood score distribution
  const moodScores = entries
    .filter(e => e.analysis?.mood_score != null)
    .map(e => e.analysis.mood_score);

  if (moodScores.length > 0) {
    const uniqueMoods = [...new Set(moodScores)];
    summary.moodScoreStats = {
      min: Math.min(...moodScores),
      max: Math.max(...moodScores),
      average: (moodScores.reduce((a, b) => a + b, 0) / moodScores.length).toFixed(3),
      uniqueValues: uniqueMoods.length,
      distribution: uniqueMoods.reduce((acc, mood) => {
        acc[mood.toFixed(2)] = moodScores.filter(m => m === mood).length;
        return acc;
      }, {}),
    };

    // Flag if all mood scores are the same (the problem we're diagnosing)
    if (uniqueMoods.length === 1) {
      summary.warning = `All ${moodScores.length} entries have identical mood_score: ${uniqueMoods[0]}. This indicates analysis is not calculating unique mood scores.`;
    }
  }

  // Process entries for export (convert dates, etc.)
  const processedEntries = entries.map(entry => ({
    id: entry.id,
    text: entry.text?.substring(0, 200) + (entry.text?.length > 200 ? '...' : ''), // Truncate for privacy
    textLength: entry.text?.length || 0,
    category: entry.category,
    createdAt: entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : entry.createdAt?.toDate?.()?.toISOString() || entry.createdAt,
    effectiveDate: entry.effectiveDate instanceof Date
      ? entry.effectiveDate.toISOString()
      : entry.effectiveDate?.toDate?.()?.toISOString() || entry.effectiveDate,
    analysisStatus: entry.analysisStatus,
    analysis: entry.analysis || null,
    healthContext: entry.healthContext || null,
    environmentContext: entry.environmentContext || null,
    embedding: entry.embedding ? `[${entry.embedding.length} dimensions]` : null,
    entry_type: entry.entry_type,
    context_version: entry.context_version,
    tags: entry.tags,
    title: entry.title,
  }));

  const exportData = {
    summary,
    entries: processedEntries,
  };

  // Create and download file
  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `echovault-diagnostic-${timestamp}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  console.log('[DiagnosticExport] Exported', entries.length, 'entries');
  console.log('[DiagnosticExport] Summary:', summary);

  return summary;
};

/**
 * Export full entries without truncation (for detailed analysis)
 * @param {Array} entries - Journal entries
 * @param {Object} options - Export options
 */
export const exportFullDiagnosticJSON = (entries, options = {}) => {
  const { userId = 'unknown' } = options;

  const summary = {
    exportedAt: new Date().toISOString(),
    userId,
    totalEntries: entries.length,
    note: 'Full export - includes complete entry text',
  };

  const processedEntries = entries.map(entry => ({
    ...entry,
    createdAt: entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : entry.createdAt?.toDate?.()?.toISOString() || entry.createdAt,
    effectiveDate: entry.effectiveDate instanceof Date
      ? entry.effectiveDate.toISOString()
      : entry.effectiveDate?.toDate?.()?.toISOString() || entry.effectiveDate,
    embedding: entry.embedding ? `[${entry.embedding.length} dimensions]` : null,
  }));

  const exportData = { summary, entries: processedEntries };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().split('T')[0];
  const link = document.createElement('a');
  link.href = url;
  link.download = `echovault-full-export-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return summary;
};

export default { exportDiagnosticJSON, exportFullDiagnosticJSON };
