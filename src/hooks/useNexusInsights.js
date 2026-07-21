/**
 * useNexusInsights Hook
 *
 * React hook for accessing Nexus 2.0 insights with automatic
 * caching, refresh, and loading states.
 *
 * Integrates with feedback learning to suppress/adjust insights
 * based on user feedback history.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCachedInsights, generateInsights } from '../services/nexus/orchestrator';
import { getAllPatternLearning } from '../services/basicInsights/feedbackLearning';
import { getFlag } from '../config/flags';
import { db } from '../config/firebase';
import {
  readBudgetMode,
  readShownLog,
  applyInsightBudget,
  recordShownInsights,
} from '../services/insights/insightBudget';

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
  const [learningData, setLearningData] = useState(new Map());
  const [budgetMode, setBudgetModeState] = useState('balanced');
  const [shownLog, setShownLogState] = useState([]);
  const recordedShownIdsRef = useRef(new Set());

  // Load feedback learning data
  useEffect(() => {
    if (!user?.uid) return;

    const loadLearning = async () => {
      try {
        const learning = await getAllPatternLearning(user.uid);
        setLearningData(learning);
      } catch (err) {
        console.warn('[useNexusInsights] Failed to load learning data:', err);
      }
    };

    loadLearning();
  }, [user?.uid]);

  // Load Insight Budget mode + shownLog once per mount (Task 12). Flag off
  // -> this never runs, and the hook's output is the untouched, pre-budget
  // path (see budgetedInsights below).
  useEffect(() => {
    if (!user?.uid || !getFlag('insightBudget')) return;

    let cancelled = false;

    const loadBudget = async () => {
      try {
        const [mode, log] = await Promise.all([
          readBudgetMode(db, user.uid),
          readShownLog(db, user.uid),
        ]);
        if (!cancelled) {
          setBudgetModeState(mode);
          setShownLogState(log);
        }
      } catch (err) {
        console.warn('[useNexusInsights] Failed to load insight budget:', err);
      }
    };

    loadBudget();
    return () => { cancelled = true; };
  }, [user?.uid]);

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

  // Helper to extract pattern type from Nexus insight for learning lookup
  const extractPatternTypeFromInsight = (insight) => {
    const text = (insight.title || '') + ' ' + (insight.body || '') + ' ' + (insight.summary || '');
    const textLower = text.toLowerCase();

    // Map common patterns to learning keys
    const patternMappings = [
      { keywords: ['journal', 'writing', 'entry'], pattern: 'activity_journaling' },
      { keywords: ['reading', 'book'], pattern: 'activity_reading' },
      { keywords: ['exercise', 'workout', 'gym'], pattern: 'activity_exercise' },
      { keywords: ['yoga', 'stretch'], pattern: 'activity_yoga' },
      { keywords: ['meditation', 'mindful'], pattern: 'activity_meditation' },
      { keywords: ['family', 'mom', 'dad', 'parent'], pattern: 'people_family' },
      { keywords: ['friend'], pattern: 'people_friends' },
      { keywords: ['partner', 'spouse', 'boyfriend', 'girlfriend'], pattern: 'people_partner' },
      { keywords: ['gratitude', 'grateful', 'thankful'], pattern: 'theme_gratitude' },
      { keywords: ['anxiety', 'anxious', 'stress'], pattern: 'theme_anxiety' },
      { keywords: ['sleep', 'rest'], pattern: 'health_sleep' },
      { keywords: ['weekend'], pattern: 'time_weekend' },
      { keywords: ['morning'], pattern: 'time_morning' }
    ];

    for (const mapping of patternMappings) {
      if (mapping.keywords.some(kw => textLower.includes(kw))) {
        return mapping.pattern;
      }
    }

    return null;
  };

  // Combine active + history, dedupe, filter by confidence and learning.
  // Memoized (Task 12 follow-up) so the array reference is stable across
  // re-renders that don't touch activeInsights/historyInsights/learningData
  // — this is what makes the Insight Budget's flag-off path a genuine,
  // reference-identical passthrough rather than one that merely happens to
  // contain equal values.
  const allInsights = useMemo(() => {
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

    // Filter by confidence ≥50% (if confidence exists) and apply learning
    return combined.filter(i => {
      // Calibration insights always show
      if (i.type === 'calibration') return true;

      // Check learning-based suppression
      const patternType = extractPatternTypeFromInsight(i);
      if (patternType && learningData.has(patternType)) {
        const learning = learningData.get(patternType);
        if (learning.suppressed) {
          // Check if suppression expired
          const suppressedAt = learning.suppressedAt?.toMillis?.() || learning.suppressedAt;
          const expiryMs = 30 * 24 * 60 * 60 * 1000; // 30 days
          const isExpiredSuppression = Date.now() - suppressedAt > expiryMs;

          if (!isExpiredSuppression) {
            console.log(`[useNexusInsights] Suppressing insight (pattern: ${patternType})`);
            return false;
          }
        }
      }

      // If no confidence specified, include it
      const confidence = i.confidence || i.evidence?.statistical?.confidence;
      if (confidence === undefined) return true;

      // Apply learning confidence adjustment if available
      if (patternType && learningData.has(patternType)) {
        const learning = learningData.get(patternType);
        const adjustedConfidence = confidence * (learning.confidenceMultiplier || 1.0);
        return adjustedConfidence >= 0.5;
      }

      return confidence >= 0.5;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInsights, historyInsights, learningData]);

  // Insight Budget gate (Task 12). Order: feedback suppression (above,
  // insightLearning) -> 90-day near-dup vs shownLog -> day/week cap, all
  // inside applyInsightBudget. Flag off -> untouched, byte-identical
  // passthrough of allInsights (never reimplements or partially applies the
  // gate when the flag is off).
  const budgetedInsights = getFlag('insightBudget')
    ? applyInsightBudget(allInsights, { mode: budgetMode, shownLog, now: Date.now() })
    : allInsights;

  // Record what's actually displayed. Guarded two ways: the ref dedupes
  // within this mount (budgetedInsights is a new array every render), and
  // checking against the freshly-read `shownLog` dedupes across mounts —
  // otherwise a remount (fresh ref, empty Set) would re-record ids already
  // persisted from a previous session/mount.
  useEffect(() => {
    if (!user?.uid || !getFlag('insightBudget')) return;

    const alreadyPersisted = new Set(
      (shownLog || []).map((entry) => entry?.id).filter(Boolean)
    );

    const toRecord = budgetedInsights.filter(
      (insight) => insight?.id
        && !recordedShownIdsRef.current.has(insight.id)
        && !alreadyPersisted.has(insight.id)
    );
    if (toRecord.length === 0) return;

    toRecord.forEach((insight) => recordedShownIdsRef.current.add(insight.id));
    recordShownInsights(db, user.uid, toRecord).catch((err) => {
      console.warn('[useNexusInsights] Failed to record shown insights:', err);
    });
  }, [budgetedInsights, shownLog, user?.uid]);

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
    // State - budgetedInsights is allInsights (active + history, confidence
    // ≥50%) further gated by the Insight Budget when insightBudget is on;
    // flag off -> identical to allInsights.
    insights: budgetedInsights,
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
    hasInsights: budgetedInsights.length > 0,
    insightCount: budgetedInsights.length,
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
