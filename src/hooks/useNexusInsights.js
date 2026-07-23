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
import { useFreshnessTick } from './useFreshnessTick';

/**
 * Derive a pattern-learning key from a Nexus insight's text (title/body/
 * summary), for use as the lookup key into feedback-learning data
 * (`insightLearning/{patternType}`) and, per R2 Task 11, as the default
 * `appliesTo` value for a per-insight-family "Wrong source" exclusion
 * (see `ReceiptSheet.jsx`). Pure, keyword-based, no hook state — safe to
 * call outside a component/hook.
 *
 * @param {Object} insight
 * @returns {string|null} a `pattern` key from the mapping below, or `null`
 *   if no keyword matched (callers decide their own fallback).
 */
export const extractPatternTypeFromInsight = (insight) => {
  // `insight.insight` (Task 11 re-review): basic insights
  // (`src/services/basicInsights/...`) carry their prose in an `insight`
  // field, not title/body/summary — omitting it here was why a
  // keyword-bearing basic insight's text never matched anything.
  const text = (insight.title || '') + ' ' + (insight.body || '') + ' ' + (insight.summary || '') + ' ' + (insight.insight || '');
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

/**
 * Hook for accessing Nexus insights
 * @param {Object} user - Firebase user object
 * @param {Object} options - Configuration options
 * @returns {Object} Insights state and controls
 */
export const useNexusInsights = (user, options = {}) => {
  const {
    autoRefresh = true,
    refreshInterval = 30 * 60 * 1000,  // 30 minutes
    // R4 Phase 2 Task 6: the unified ClaimFeed replaces this hook's output
    // when `insightClaims` is ON — callers pass `enabled: false` rather
    // than skipping the hook call (rules of hooks forbid conditional
    // hook calls). Every effect below early-returns when disabled: no
    // Firestore reads (cached insights, learning data, insight-budget
    // mode/log), no `generateInsights` calls, no shown-insight recording.
    // State stays at its initial (empty/idle) shape, so a disabled mount
    // is a true no-op, not a paused one.
    enabled = true,
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
    if (!enabled || !user?.uid) return;

    const loadLearning = async () => {
      try {
        const learning = await getAllPatternLearning(user.uid);
        setLearningData(learning);
      } catch (err) {
        console.warn('[useNexusInsights] Failed to load learning data:', err);
      }
    };

    loadLearning();
  }, [enabled, user?.uid]);

  // Load Insight Budget mode + shownLog once per mount (Task 12). Flag off
  // -> this never runs, and the hook's output is the untouched, pre-budget
  // path (see budgetedInsights below).
  useEffect(() => {
    if (!enabled || !user?.uid || !getFlag('insightBudget')) return;

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
  }, [enabled, user?.uid]);

  // Load cached insights on mount
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
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
  }, [enabled, user?.uid]);

  // Auto-refresh timer
  useEffect(() => {
    if (!enabled || !autoRefresh || !user?.uid) return;

    const timer = setInterval(() => {
      regenerateInsights();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [enabled, autoRefresh, refreshInterval, user?.uid]);

  // Regenerate insights
  const regenerateInsights = useCallback(async () => {
    if (!enabled || !user?.uid || refreshing) return;

    setRefreshing(true);
    setError(null);

    try {
      const result = await generateInsights(user.uid);

      if (result.success) {
        setDataStatus(result.dataStatus);
        setLastGenerated(result.generatedAt);

        // Re-fetch cached (R4 Task 5: this is the dismissal read-time
        // filter seam, `getCachedInsights` in orchestrator.js) to get both
        // updated history AND the dismissal-filtered active set — using
        // `result.insights` directly here would bypass that filter and let
        // a just-dismissed insight resurface on regeneration.
        const cached = await getCachedInsights(user.uid);
        if (cached) {
          setActiveInsights(cached.insights || []);
          if (cached.history) {
            setHistoryInsights(cached.history);
          }
        } else {
          // Cache read failed but generation itself succeeded — fall back
          // to the ungenerated-filtered result rather than showing nothing.
          setActiveInsights(result.insights);
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
  }, [enabled, user?.uid, refreshing]);

  // Fix B (INS-1, 2026-07-24 brief): the proactive feed reads `active`
  // ONLY. `historyInsights` (loaded above for `historyCount`/diagnostic use
  // only) is a separate audit/lineage record and is never blended back into
  // the live feed — that's the exact defect the brief documents ("the
  // 50-item audit history becomes a second, stale proactive feed"). If a
  // labeled "Previous insights" surface is ever built, it reads
  // `historyInsights` directly and separately; it does not get folded into
  // `allInsights`.
  //
  // Memoized (Task 12 follow-up) so the array reference is stable across
  // re-renders that don't touch activeInsights/learningData — this is what
  // makes the Insight Budget's flag-off path a genuine, reference-identical
  // passthrough rather than one that merely happens to contain equal
  // values.
  const allInsights = useMemo(() => {
    const seenIds = new Set();
    const combined = [];

    for (const insight of activeInsights) {
      if (insight.id && !seenIds.has(insight.id)) {
        seenIds.add(insight.id);
        combined.push({ ...insight, isActive: true });
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
  }, [activeInsights, learningData]);

  // Freshness tick (R2 Task 2): a day/week allowance derived from `shownLog`
  // needs to re-evaluate at a day boundary even when nothing else causes a
  // re-render — an app left open overnight would otherwise keep applying
  // yesterday's dayCount/weekCount (computed against a `now` baked in at the
  // last incidental render) until something unrelated happened to re-render
  // it. `useFreshnessTick` bumps on visibility foregrounding and every 5
  // minutes while visible; including it in `budgetedInsights`' memo deps
  // forces a fresh `Date.now()` read on each such tick.
  const nowTick = useFreshnessTick();

  // Insight Budget gate (Task 12). Order: feedback suppression (above,
  // insightLearning) -> 90-day near-dup vs shownLog -> day/week cap, all
  // inside applyInsightBudget. Flag off -> untouched, byte-identical
  // passthrough of allInsights (never reimplements or partially applies the
  // gate when the flag is off). Memoized so the flag-off branch stays a
  // genuine reference-identical passthrough of `allInsights` (its own memo)
  // across re-renders that don't touch any dep here, matching the
  // reference-identity contract `allInsights` already provides.
  const budgetedInsights = useMemo(() => {
    // R4 Phase 3 backlog (P3-D7): an explicit `enabled` gate, not just a
    // consequence of allInsights already being empty when disabled — makes
    // the disabled contract a direct, one-line invariant of this memo
    // itself rather than something that merely happens to fall out of every
    // upstream effect early-returning.
    if (!enabled) return [];
    if (!getFlag('insightBudget')) return allInsights;
    return applyInsightBudget(allInsights, { mode: budgetMode, shownLog, now: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, allInsights, budgetMode, shownLog, nowTick]);

  // Record what's actually displayed. Guarded two ways: the ref dedupes
  // within this mount (budgetedInsights is a new array every render), and
  // checking against the freshly-read `shownLog` dedupes across mounts —
  // otherwise a remount (fresh ref, empty Set) would re-record ids already
  // persisted from a previous session/mount.
  useEffect(() => {
    if (!enabled || !user?.uid || !getFlag('insightBudget')) return;

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
  }, [enabled, budgetedInsights, shownLog, user?.uid]);

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
    // State - budgetedInsights is allInsights (active only, confidence
    // ≥50%, Fix B INS-1: history is never blended in) further gated by the
    // Insight Budget when insightBudget is on; flag off -> identical to
    // allInsights.
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
