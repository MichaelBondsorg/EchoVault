/**
 * useBasicInsights Hook
 *
 * React hook for accessing Basic Insights with automatic
 * caching, refresh, and loading states.
 *
 * Simpler than useNexusInsights - no LLM calls, just statistical correlations.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getCachedBasicInsights,
  generateBasicInsights,
  checkDataSufficiency
} from '../services/basicInsights/basicInsightsOrchestrator';
import { getExcludedEntryIds } from '../services/insights/sourceExclusions';
import { db } from '../config/firebase';

/**
 * Hook for accessing basic insights
 * @param {Object} user - Firebase user object
 * @param {Array} entries - Journal entries
 * @param {Object} options - Configuration options
 * @returns {Object} Insights state and controls
 */
export const useBasicInsights = (user, entries, options = {}) => {
  const {
    autoRefresh = true,
    refreshOnMount = true
  } = options;

  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [lastGenerated, setLastGenerated] = useState(null);
  const [dataSufficiency, setDataSufficiency] = useState(null);
  const [categoryCounts, setCategoryCounts] = useState(null);

  // Load cached insights on mount
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const loadCached = async () => {
      try {
        // Check data sufficiency first
        const sufficiency = checkDataSufficiency(entries);
        setDataSufficiency(sufficiency);

        if (!sufficiency.hasEnoughData) {
          setLoading(false);
          return;
        }

        // Try to load cached insights (pass entries count for staleness check)
        const cached = await getCachedBasicInsights(user.uid, entries?.length || 0);

        if (cached && !cached.stale) {
          setInsights(cached.insights || []);
          setLastGenerated(cached.generatedAt);
          setCategoryCounts(cached.categoryCounts);
          setLoading(false);
        } else if (refreshOnMount) {
          // No valid cache, generate fresh
          await regenerateInsights();
        } else {
          // Use stale cache if available
          if (cached) {
            setInsights(cached.insights || []);
            setLastGenerated(cached.generatedAt);
            setCategoryCounts(cached.categoryCounts);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('[useBasicInsights] Load failed:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    loadCached();
  }, [user?.uid, entries?.length]);

  // Regenerate insights
  const regenerateInsights = useCallback(async () => {
    if (!user?.uid || generating) {
      return;
    }

    // Check data sufficiency
    const sufficiency = checkDataSufficiency(entries);
    setDataSufficiency(sufficiency);

    if (!sufficiency.hasEnoughData) {
      setError(null);
      setInsights([]);
      setLoading(false);
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // R2 final review, Important 2(a): drop source-excluded entries
      // (appliesTo:'all', `src/services/insights/sourceExclusions.js`) from
      // the pool BEFORE generateBasicInsights ever sees them. Exclusions are
      // read unconditionally here, same as the Nexus orchestrator's
      // `generateInsights` and the report `readEntries` consumer — NOT
      // gated behind `insightReceipts` (source exclusions already created
      // stay in effect regardless of that flag; see the runbook's
      // `insightReceipts` row).
      //
      // Deliberately NOT wrapped in its own try/catch: mirrors the Nexus
      // orchestrator's fail-closed precedent (`src/services/nexus/
      // orchestrator.js`'s `generateInsights` — "a failed exclusions read
      // must never silently produce insights as if no exclusions existed").
      // A thrown read here falls straight into this function's own
      // pre-existing catch block below, which already does `setError` and
      // skips generation — the same failure shape this hook has always
      // used, so a read failure can never silently fall through to
      // generating over the unfiltered pool.
      const excludedIds = await getExcludedEntryIds(db, user.uid);
      const poolEntries = excludedIds.size > 0
        ? entries.filter((e) => !excludedIds.has(e.id || e.entryId))
        : entries;

      const result = await generateBasicInsights(user.uid, poolEntries);

      if (result.success) {
        setInsights(result.insights);
        setLastGenerated(result.generatedAt);
        setCategoryCounts(result.categoryCounts);
        setError(null);
      } else if (result.insufficientData) {
        setInsights([]);
        setDataSufficiency({
          hasEnoughData: false,
          dataPoints: result.entriesAnalyzed,
          needed: result.entriesNeeded,
          message: result.message
        });
      } else {
        setError(result.error || 'Failed to generate insights');
      }
    } catch (err) {
      console.error('[useBasicInsights] Regeneration failed:', err);
      setError(err.message);
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, [user?.uid, entries, generating]);

  // Get insights by category
  const getInsightsByCategory = useCallback((category) => {
    return insights.filter(i => i.category === category);
  }, [insights]);

  // Get top insight
  const topInsight = insights.length > 0 ? insights[0] : null;

  // Format last generated time
  const formatLastGenerated = () => {
    if (!lastGenerated) return null;
    const date = lastGenerated.toDate ? lastGenerated.toDate() : new Date(lastGenerated);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return {
    // State
    insights,
    topInsight,
    loading,
    generating,
    error,
    lastGenerated,
    lastGeneratedFormatted: formatLastGenerated(),
    dataSufficiency,
    categoryCounts,

    // Actions
    regenerate: regenerateInsights,
    getInsightsByCategory,

    // Helpers
    hasInsights: insights.length > 0,
    insightCount: insights.length,
    hasEnoughData: dataSufficiency?.hasEnoughData ?? false,
    entriesNeeded: dataSufficiency?.needed || 0,
    entriesAnalyzed: dataSufficiency?.dataPoints || 0
  };
};

export default useBasicInsights;
