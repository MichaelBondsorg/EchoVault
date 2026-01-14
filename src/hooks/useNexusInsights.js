/**
 * useNexusInsights Hook
 *
 * React hook for accessing Nexus 2.0 insights with automatic
 * caching, refresh, and loading states.
 */

import { useState, useEffect, useCallback } from 'react';
import { getCachedInsights, generateInsights } from '../services/nexus/orchestrator';

/**
 * Hook for accessing Nexus insights
 * @param {Object} user - Firebase user object
 * @param {Object} options - Configuration options
 * @returns {Object} Insights state and controls
 */
export const useNexusInsights = (user, options = {}) => {
  const {
    autoRefresh = true,
    refreshInterval = 30 * 60 * 1000  // 30 minutes
  } = options;

  const [activeInsights, setActiveInsights] = useState([]);
  const [historyInsights, setHistoryInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [lastGenerated, setLastGenerated] = useState(null);

  // Load cached insights on mount
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const loadCached = async () => {
      try {
        const cached = await getCachedInsights(user.uid);

        if (cached) {
          setActiveInsights(cached.insights || []);
          setHistoryInsights(cached.history || []);
          setLastGenerated(cached.generatedAt);

          // Check if we need to regenerate
          if (cached.stale || isExpired(cached.expiresAt)) {
            regenerateInsights();
          }
        } else {
          // No cache, generate fresh
          await regenerateInsights();
        }
      } catch (err) {
        console.error('[useNexusInsights] Load failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadCached();
  }, [user?.uid]);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh || !user?.uid) return;

    const timer = setInterval(() => {
      regenerateInsights();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, user?.uid]);

  // Regenerate insights
  const regenerateInsights = useCallback(async () => {
    if (!user?.uid || refreshing) return;

    setRefreshing(true);
    setError(null);

    try {
      const result = await generateInsights(user.uid);

      if (result.success) {
        setActiveInsights(result.insights);
        setDataStatus(result.dataStatus);
        setLastGenerated(result.generatedAt);

        // Re-fetch cached to get updated history
        const cached = await getCachedInsights(user.uid);
        if (cached?.history) {
          setHistoryInsights(cached.history);
        }
      } else {
        setError(result.errors?.[0] || 'Failed to generate insights');
      }
    } catch (err) {
      console.error('[useNexusInsights] Regeneration failed:', err);
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [user?.uid, refreshing]);

  // Combine active + history, dedupe, and filter by confidence
  const allInsights = (() => {
    const seenIds = new Set();
    const combined = [];

    // Add active first (they're most current)
    for (const insight of activeInsights) {
      if (insight.id && !seenIds.has(insight.id)) {
        seenIds.add(insight.id);
        combined.push({ ...insight, isActive: true });
      }
    }

    // Add history (non-duplicates)
    for (const insight of historyInsights) {
      if (insight.id && !seenIds.has(insight.id)) {
        seenIds.add(insight.id);
        combined.push({ ...insight, isActive: false });
      }
    }

    // Filter by confidence ≥50% (if confidence exists)
    return combined.filter(i => {
      // Calibration insights always show
      if (i.type === 'calibration') return true;
      // If no confidence specified, include it
      const confidence = i.confidence || i.evidence?.statistical?.confidence;
      if (confidence === undefined) return true;
      return confidence >= 0.5;
    });
  })();

  // Get primary insight
  const primaryInsight = activeInsights.find(i => i.priority === 1) || activeInsights[0];

  // Get insights by type
  const getInsightsByType = useCallback((type) => {
    return allInsights.filter(i => i.type === type);
  }, [allInsights]);

  // Get calibration status
  const calibrationInsight = activeInsights.find(i => i.type === 'calibration');
  const isCalibrating = !!calibrationInsight;

  return {
    // State - allInsights includes active + history with confidence ≥50%
    insights: allInsights,
    activeInsights,
    historyInsights,
    primaryInsight,
    loading,
    refreshing,
    error,
    dataStatus,
    lastGenerated,
    isCalibrating,
    calibrationProgress: calibrationInsight?.progress || 0,

    // Actions
    refresh: regenerateInsights,
    getInsightsByType,

    // Helpers
    hasInsights: allInsights.length > 0,
    insightCount: allInsights.length,
    activeCount: activeInsights.length,
    historyCount: historyInsights.length
  };
};

// Helper to check if timestamp is expired
const isExpired = (expiresAt) => {
  if (!expiresAt) return true;
  const expiry = expiresAt.toMillis ? expiresAt.toMillis() : expiresAt;
  return Date.now() > expiry;
};

export default useNexusInsights;
