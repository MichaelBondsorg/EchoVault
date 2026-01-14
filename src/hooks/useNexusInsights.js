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

  const [insights, setInsights] = useState([]);
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

        if (cached && cached.insights.length > 0) {
          setInsights(cached.insights);
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
        setInsights(result.insights);
        setDataStatus(result.dataStatus);
        setLastGenerated(result.generatedAt);
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

  // Get primary insight
  const primaryInsight = insights.find(i => i.priority === 1) || insights[0];

  // Get insights by type
  const getInsightsByType = useCallback((type) => {
    return insights.filter(i => i.type === type);
  }, [insights]);

  // Get calibration status
  const calibrationInsight = insights.find(i => i.type === 'calibration');
  const isCalibrating = !!calibrationInsight;

  return {
    // State
    insights,
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
    hasInsights: insights.length > 0,
    insightCount: insights.length
  };
};

// Helper to check if timestamp is expired
const isExpired = (expiresAt) => {
  if (!expiresAt) return true;
  const expiry = expiresAt.toMillis ? expiresAt.toMillis() : expiresAt;
  return Date.now() > expiry;
};

export default useNexusInsights;
