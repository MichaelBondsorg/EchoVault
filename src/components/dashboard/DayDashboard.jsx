import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// Hooks
import { useDashboardMode } from '../../hooks/useDashboardMode';

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
import { getPatternSummary, getContradictions } from '../../services/patterns/cached';

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
  const midnightTimeoutRef = useRef(null);
  const lastEntryCountRef = useRef(0);

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

  // Load carry-forward items
  useEffect(() => {
    if (!userId) return;
    loadYesterdayCarryForward(userId, category).then(setCarryForwardItems);
  }, [userId, category]);

  // Load pattern insights
  useEffect(() => {
    if (!userId) return;
    const loadInsights = async () => {
      const contradictions = await getContradictions(userId);
      if (contradictions?.data?.[0]) {
        setCurrentInsight(contradictions.data[0]);
      } else {
        const patterns = await getPatternSummary(userId);
        if (patterns?.data?.[0]) setCurrentInsight(patterns.data[0]);
      }
    };
    loadInsights();
  }, [userId]);

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
          onDismissInsight={() => setCurrentInsight(null)}
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
          onDismissInsight={() => setCurrentInsight(null)}
        />
      )}
    </AnimatePresence>
  );
};

export default DayDashboard;
