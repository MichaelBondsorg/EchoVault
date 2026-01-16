import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// Hooks
import { useDashboardMode } from '../../hooks/useDashboardMode';
import { useNexusInsights } from '../../hooks/useNexusInsights';

// Views
import { MorningCompass, MidDayCheckIn, EveningMirror, ShelterView } from './views';

// Services
import { generateDashboardPrompts, generateDaySummary } from '../../services/prompts';
import {
  loadDashboardCache,
  saveDashboardCache,
  loadYesterdayCarryForward,
  getTodayStart,
  getMillisecondsUntilMidnight,
  completeTaskAsWin
} from '../../services/dashboard';
import { getPatternSummary, getContradictions, getNextInsight, markInsightShown } from '../../services/nexus/compat';
import { addToExclusionList, getActiveExclusions } from '../../services/signals/signalLifecycle';

/**
 * DayDashboard - Controller Component
 *
 * Responsibilities:
 * 1. Data fetching and caching
 * 2. Mode determination via useDashboardMode
 * 3. View delegation based on timePhase and moodState
 *
 * Target: <150 lines
 */

const DayDashboard = ({
  entries,
  category,
  userId,
  user,
  onPromptClick,
  onToggleTask,
  onShowInsights,
  onStartRecording,
  onStartTextEntry
}) => {
  // State
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [carryForwardItems, setCarryForwardItems] = useState([]);
  const [currentInsight, setCurrentInsight] = useState(null);
  const [shelterOverride, setShelterOverride] = useState(false);
  const [exclusions, setExclusions] = useState([]);
  const midnightTimeoutRef = useRef(null);
  const lastEntryCountRef = useRef(0);

  // Nexus 2.0 insights (4-layer deep insights)
  const {
    insights: nexusInsights,
    primaryInsight: nexusPrimaryInsight,
    isCalibrating,
    calibrationProgress
  } = useNexusInsights(user, { autoRefresh: false });

  // Filter today's entries
  const todayEntries = useMemo(() => {
    const today = getTodayStart();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return entries.filter(e => {
      const dateField = e.effectiveDate || e.createdAt;
      const entryDate = dateField instanceof Date ? dateField : dateField?.toDate?.() || new Date();
      return entryDate >= today && entryDate < tomorrow && e.category === category;
    });
  }, [entries, category]);

  // Calculate the latest modification timestamp for cache invalidation
  // This catches edits to existing entries (not just new entries)
  const latestEntryTimestamp = useMemo(() => {
    if (todayEntries.length === 0) return null;

    let maxTimestamp = 0;
    for (const entry of todayEntries) {
      // Check updatedAt first (for edits), then createdAt
      const updatedAt = entry.updatedAt;
      const createdAt = entry.createdAt;

      const updateTime = updatedAt instanceof Date
        ? updatedAt.getTime()
        : updatedAt?.toDate?.()?.getTime() || 0;

      const createTime = createdAt instanceof Date
        ? createdAt.getTime()
        : createdAt?.toDate?.()?.getTime() || 0;

      const entryTime = Math.max(updateTime, createTime);
      if (entryTime > maxTimestamp) {
        maxTimestamp = entryTime;
      }
    }

    return maxTimestamp > 0 ? maxTimestamp : null;
  }, [todayEntries]);

  // Dashboard mode from hook
  const { timePhase, moodState, isLowMood } = useDashboardMode({
    entries,
    todayEntries,
    summary,
    user,
    carryForwardItems,
    shelterOverride
  });

  // Midnight reset
  useEffect(() => {
    const scheduleMidnightReset = () => {
      midnightTimeoutRef.current = setTimeout(() => {
        setLoading(true);
        setSummary(null);
        lastEntryCountRef.current = 0;
        scheduleMidnightReset();
      }, getMillisecondsUntilMidnight());
    };
    scheduleMidnightReset();
    return () => clearTimeout(midnightTimeoutRef.current);
  }, []);

  // Load carry-forward items and exclusions
  useEffect(() => {
    if (!userId) return;
    loadYesterdayCarryForward(userId, category).then(setCarryForwardItems);
    // Load insight exclusions so we can filter them out
    getActiveExclusions(userId).then(setExclusions).catch(console.error);
  }, [userId, category]);

  // Helper to check if an insight is excluded
  const isInsightExcluded = useCallback((insight) => {
    if (exclusions.length === 0) return false;

    const insightType = insight.type || insight.patternType || 'insight';
    const insightMessage = (insight.message || insight.observation || '').slice(0, 100);
    const insightEntity = insight.entity || insight.entityName || null;

    return exclusions.some(exc => {
      // Match by pattern type
      if (exc.patternType !== insightType) return false;

      // If exclusion has context, check for partial match
      if (exc.context && Object.keys(exc.context).length > 0) {
        const msgMatch = !exc.context.message || insightMessage.includes(exc.context.message.slice(0, 50));
        const entityMatch = !exc.context.entity || exc.context.entity === insightEntity;
        return msgMatch && entityMatch;
      }

      // Blanket exclusion for this type
      return true;
    });
  }, [exclusions]);

  // Load insights - prioritize Nexus 2.0 insights, fallback to pattern insights
  useEffect(() => {
    if (!userId) return;

    // If we have a Nexus primary insight, check if excluded
    if (nexusPrimaryInsight) {
      if (!isInsightExcluded(nexusPrimaryInsight)) {
        setCurrentInsight({
          ...nexusPrimaryInsight,
          source: 'nexus',
          priority: nexusPrimaryInsight.priority === 1 ? 'high' : 'normal'
        });
      }
      return;
    }

    // Fallback to pattern-based insights
    const loadInsights = async () => {
      const allInsights = [];

      // Contradictions are high-priority
      const contradictions = await getContradictions(userId);
      if (contradictions?.data?.length > 0) {
        contradictions.data.forEach(c => allInsights.push({
          ...c,
          type: c.type || 'contradiction',
          priority: 'high'
        }));
      }

      // Pattern summaries
      const patterns = await getPatternSummary(userId);
      if (patterns?.data?.length > 0) {
        patterns.data.forEach(p => allInsights.push({
          ...p,
          priority: 'normal'
        }));
      }

      // Filter out excluded insights
      const filteredInsights = allInsights.filter(insight => !isInsightExcluded(insight));

      if (filteredInsights.length > 0) {
        const selected = getNextInsight(userId, category, filteredInsights);
        if (selected) {
          setCurrentInsight(selected);
          markInsightShown(userId, category, selected);
        }
      }
    };
    loadInsights();
  }, [userId, category, nexusPrimaryInsight, isInsightExcluded]);

  // Generate content with caching
  const generateAndCacheContent = useCallback(async (useCache = true) => {
    if (useCache && userId) {
      // Pass latestEntryTimestamp to detect edits to existing entries
      const cached = await loadDashboardCache(userId, category, todayEntries.length, latestEntryTimestamp);
      if (cached?.summary) {
        setSummary(cached.summary);
        return;
      }
    }

    if (todayEntries.length > 0) {
      const newSummary = await generateDaySummary(todayEntries, entries, category);
      setSummary(newSummary);
      if (userId && newSummary) {
        await saveDashboardCache(userId, category, { summary: newSummary, entryCount: todayEntries.length });
      }
    } else {
      setSummary(null);
    }
  }, [userId, category, todayEntries, entries, latestEntryTimestamp]);

  // Track last processed timestamp to detect edits
  const lastTimestampRef = useRef(0);

  // Load content - triggers on entry count change OR entry modification
  useEffect(() => {
    const countChanged = lastEntryCountRef.current !== todayEntries.length;
    const entryModified = latestEntryTimestamp && latestEntryTimestamp > lastTimestampRef.current;

    // Skip if nothing changed and we have a summary
    if (!countChanged && !entryModified && summary) return;

    setLoading(true);
    generateAndCacheContent(true).finally(() => {
      setLoading(false);
      lastEntryCountRef.current = todayEntries.length;
      lastTimestampRef.current = latestEntryTimestamp || 0;
    });
  }, [todayEntries.length, latestEntryTimestamp, generateAndCacheContent, summary]);

  // Handlers

  // Dismiss insight permanently
  const handleDismissInsight = useCallback(async () => {
    if (!currentInsight || !userId) {
      setCurrentInsight(null);
      return;
    }

    // Generate a pattern key for exclusion
    const patternType = currentInsight.type || currentInsight.patternType || 'insight';
    const context = {
      message: (currentInsight.message || currentInsight.observation || '').slice(0, 100),
      entity: currentInsight.entity || currentInsight.entityName || null,
      source: currentInsight.source || 'dashboard'
    };

    try {
      // Add to exclusion list permanently
      await addToExclusionList(userId, {
        patternType,
        context,
        reason: 'user_dismissed',
        permanent: true // Always permanent from dashboard dismiss
      });

      // Update local exclusions
      setExclusions(prev => [...prev, { patternType, context, permanent: true }]);

      console.log('[DayDashboard] Insight permanently dismissed:', patternType);
    } catch (error) {
      console.error('[DayDashboard] Failed to persist insight dismissal:', error);
    }

    // Always clear from UI
    setCurrentInsight(null);
  }, [currentInsight, userId]);

  const handleTaskComplete = useCallback(async (task, source, index) => {
    const taskText = typeof task === 'string' ? task : task.text;

    // Optimistic UI update - remove from tasks, add to wins
    setSummary(prev => {
      if (!prev) return prev;

      // Remove from action items
      const updatedActionItems = { ...prev.action_items };
      if (updatedActionItems[source]) {
        const items = [...updatedActionItems[source]];
        items.splice(index, 1);
        updatedActionItems[source] = items;
      }

      // Add to wins
      const currentWins = prev.wins || { items: [], tone: 'acknowledging' };
      const updatedWins = {
        ...currentWins,
        items: [...(currentWins.items || []), taskText]
      };

      return { ...prev, action_items: updatedActionItems, wins: updatedWins };
    });

    // Persist to cache
    if (userId) {
      await completeTaskAsWin(userId, category, task, source, index);
    }

    // External handler
    onToggleTask?.(task, source, index);
  }, [userId, category, onToggleTask]);

  const userName = user?.displayName?.split(' ')[0] || null;

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-warm-400">
        <Loader2 className="animate-spin mb-2" size={24} />
        <span className="text-sm font-body">Loading your day...</span>
      </div>
    );
  }

  // View delegation based on mode
  return (
    <AnimatePresence mode="wait">
      {isLowMood && !shelterOverride ? (
        <ShelterView
          key="shelter"
          cbtReframe={summary?.challenges?.cbt_reframe}
          onVent={onStartRecording}
          onTextEntry={onStartTextEntry}
          onExit={() => setShelterOverride(true)}
        />
      ) : timePhase === 'morning' ? (
        <MorningCompass
          key="morning"
          summary={summary}
          userName={userName}
          carryForwardItems={carryForwardItems}
          onSetIntention={onStartTextEntry}
          onTaskComplete={handleTaskComplete}
          onPromptClick={onPromptClick}
        />
      ) : timePhase === 'evening' ? (
        <EveningMirror
          key="evening"
          summary={summary}
          userName={userName}
          insight={currentInsight}
          entryCount={todayEntries.length}
          onWrapUp={() => generateAndCacheContent(false)}
          onPromptClick={onPromptClick}
          onShowInsights={onShowInsights}
          onDismissInsight={handleDismissInsight}
        />
      ) : (
        <MidDayCheckIn
          key="midday"
          summary={summary}
          userName={userName}
          insight={currentInsight}
          onTaskComplete={handleTaskComplete}
          onEnergyCheck={onStartTextEntry}
          onPromptClick={onPromptClick}
          onShowInsights={onShowInsights}
          onDismissInsight={handleDismissInsight}
        />
      )}
    </AnimatePresence>
  );
};

export default DayDashboard;
