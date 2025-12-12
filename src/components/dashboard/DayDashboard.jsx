import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun, Cloud, CloudRain, Sparkles, Target, AlertCircle,
  CheckCircle2, Circle, TrendingUp, Loader2, RefreshCw,
  ChevronRight, Lightbulb, AlertOctagon, BarChart3
} from 'lucide-react';
import { generateDashboardPrompts, generateDaySummary } from '../../services/prompts';
import {
  loadDashboardCache,
  saveDashboardCache,
  loadYesterdayCarryForward,
  getTodayStart,
  getMillisecondsUntilMidnight
} from '../../services/dashboard';
import { getPatternSummary, getContradictions } from '../../services/patterns/cached';

/**
 * DayDashboard - The main dashboard view showing today's summary
 *
 * States:
 * - Empty: No entries today - shows contextual prompts
 * - Active: Has entries - shows summary sections
 */

const PromptCard = ({ prompt, type, onClick }) => {
  const typeIcons = {
    situation: <ChevronRight size={16} className="text-primary-500" />,
    goal: <Target size={16} className="text-green-500" />,
    pattern: <TrendingUp size={16} className="text-blue-500" />,
    mood: <Cloud size={16} className="text-amber-500" />,
    generic: <Lightbulb size={16} className="text-warm-400" />
  };

  return (
    <motion.button
      onClick={onClick}
      className="w-full text-left p-4 bg-white rounded-2xl border border-warm-100 shadow-soft hover:shadow-soft-lg hover:border-primary-200 transition-all group"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
          {typeIcons[type] || typeIcons.generic}
        </div>
        <p className="text-warm-700 font-body text-sm leading-relaxed">{typeof prompt === 'string' ? prompt : prompt.text || JSON.stringify(prompt)}</p>
      </div>
    </motion.button>
  );
};

const SectionHeader = ({ icon: Icon, title, iconColor = 'text-warm-500' }) => (
  <div className="flex items-center gap-2 mb-2">
    <Icon size={16} className={iconColor} />
    <h3 className="text-sm font-display font-semibold text-warm-700">{title}</h3>
  </div>
);

const WinsSection = ({ wins }) => {
  if (!wins?.items || wins.items.length === 0) return null;

  return (
    <motion.div
      className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-100"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <SectionHeader icon={Sparkles} title="What's Going Well" iconColor="text-green-500" />
      <ul className="space-y-2">
        {wins.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-green-800">
            <CheckCircle2 size={14} className="mt-0.5 text-green-500 flex-shrink-0" />
            <span className="font-body">{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
};

const ChallengesSection = ({ challenges }) => {
  if (!challenges?.items || challenges.items.length === 0) return null;

  return (
    <motion.div
      className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <SectionHeader icon={Cloud} title="What's on Your Mind" iconColor="text-amber-500" />
      <ul className="space-y-2 mb-3">
        {challenges.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
            <AlertCircle size={14} className="mt-0.5 text-amber-500 flex-shrink-0" />
            <span className="font-body">{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
          </li>
        ))}
      </ul>
      {challenges.cbt_reframe && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <p className="text-xs text-amber-700 italic font-body">
            <span className="font-semibold not-italic">Perspective:</span> {challenges.cbt_reframe}
          </p>
        </div>
      )}
    </motion.div>
  );
};

const ActionItemsSection = ({ actionItems, onToggleTask }) => {
  const [completingTasks, setCompletingTasks] = useState(new Set());

  const hasItems = actionItems?.today?.length > 0 ||
    actionItems?.carried_forward?.length > 0 ||
    actionItems?.suggested?.length > 0;

  if (!hasItems) return null;

  const handleComplete = (item, source, index) => {
    const taskKey = `${source}-${index}`;
    setCompletingTasks(prev => new Set(prev).add(taskKey));

    // After animation completes, trigger the actual completion
    setTimeout(() => {
      onToggleTask?.(item, source, index);
      setCompletingTasks(prev => {
        const next = new Set(prev);
        next.delete(taskKey);
        return next;
      });
    }, 1000);
  };

  const renderTaskItem = (item, source, index, isCarriedForward = false) => {
    const taskKey = `${source}-${index}`;
    const isCompleting = completingTasks.has(taskKey);
    // Handle both string items and object items with recurrence
    const taskText = typeof item === 'string' ? item : item.text;
    const recurrence = typeof item === 'object' ? item.recurrence : null;

    return (
      <li
        key={taskKey}
        className={`flex items-start gap-2 text-sm text-blue-800 relative overflow-hidden ${isCompleting ? 'action-item-completing' : ''}`}
      >
        <button
          onClick={() => !isCompleting && handleComplete(item, source, index)}
          className={`action-checkbox mt-0.5 flex-shrink-0 ${isCompleting ? 'checked' : ''}`}
          disabled={isCompleting}
        >
          {isCompleting && <CheckCircle2 size={12} className="text-white" />}
        </button>
        <div className="flex-1 relative">
          <span className={`font-body ${isCompleting ? 'text-blue-400' : ''}`}>
            {taskText}
            {isCarriedForward && (
              <span className="text-xs text-blue-500 ml-1">(from yesterday)</span>
            )}
          </span>
          {recurrence && (
            <span className="badge-recurring ml-2">
              <RefreshCw size={10} className="inline mr-1" />
              {recurrence.description || recurrence.pattern}
            </span>
          )}
          {isCompleting && <div className="strikethrough-line" />}
        </div>
      </li>
    );
  };

  return (
    <motion.div
      className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <SectionHeader icon={Target} title="Action Items" iconColor="text-blue-500" />
      <ul className="space-y-2">
        {actionItems.carried_forward?.map((item, i) =>
          renderTaskItem(item, 'carried_forward', i, true)
        )}
        {actionItems.today?.map((item, i) =>
          renderTaskItem(item, 'today', i, false)
        )}
        {actionItems.suggested?.map((item, i) => (
          <li key={`sug-${i}`} className="flex items-start gap-2 text-sm text-blue-600 opacity-75">
            <Lightbulb size={14} className="mt-0.5 text-blue-400 flex-shrink-0" />
            <span className="font-body italic">{typeof item === 'string' ? item : item.text}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
};

const PatternsSection = ({ patterns }) => {
  if (!patterns?.observations || patterns.observations.length === 0) return null;

  return (
    <motion.div
      className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl p-4 border border-purple-100"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <SectionHeader icon={TrendingUp} title="Patterns & Insights" iconColor="text-purple-500" />
      <ul className="space-y-2">
        {patterns.observations.map((item, i) => (
          <li key={i} className="text-sm text-purple-800 font-body">{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</li>
        ))}
      </ul>
      {patterns.mood_note && (
        <p className="mt-2 text-xs text-purple-600 font-body">{patterns.mood_note}</p>
      )}
    </motion.div>
  );
};

// Inline pattern hints from cached patterns (contradictions, key insights)
const PatternHintsSection = ({ hints, onShowMore }) => {
  if (!hints || hints.length === 0) return null;

  return (
    <motion.div
      className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-4 border border-orange-100"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
    >
      <SectionHeader icon={AlertOctagon} title="Worth Reflecting On" iconColor="text-orange-500" />
      <ul className="space-y-2">
        {hints.slice(0, 2).map((hint, i) => (
          <li key={i} className="text-sm text-orange-800 font-body">{hint.message}</li>
        ))}
      </ul>
      {onShowMore && hints.length > 0 && (
        <button
          onClick={onShowMore}
          className="mt-3 flex items-center gap-1 text-xs text-orange-600 font-medium hover:text-orange-800 transition-colors"
        >
          <BarChart3 size={12} />
          View all patterns
        </button>
      )}
    </motion.div>
  );
};

const MoodIndicator = ({ mood }) => {
  if (mood === null || mood === undefined) return null;

  const getMoodEmoji = (score) => {
    if (score >= 0.7) return { icon: Sun, color: 'text-amber-500', bg: 'bg-amber-100' };
    if (score >= 0.4) return { icon: Cloud, color: 'text-blue-500', bg: 'bg-blue-100' };
    return { icon: CloudRain, color: 'text-gray-500', bg: 'bg-gray-100' };
  };

  const { icon: Icon, color, bg } = getMoodEmoji(mood);

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${bg}`}>
      <Icon size={14} className={color} />
      <span className={`text-xs font-medium ${color}`}>
        {mood >= 0.7 ? 'Good' : mood >= 0.4 ? 'Mixed' : 'Tough'}
      </span>
    </div>
  );
};

const DayDashboard = ({
  entries,
  category,
  userId,
  onPromptClick,
  onToggleTask,
  onShowInsights
}) => {
  const [prompts, setPrompts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [carryForwardItems, setCarryForwardItems] = useState([]);
  const [patternHints, setPatternHints] = useState([]);
  const midnightTimeoutRef = useRef(null);
  const lastEntryCountRef = useRef(0);

  // Filter today's entries - use effectiveDate if available (Phase 2 backdating)
  const todayEntries = useMemo(() => {
    const today = getTodayStart();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return entries.filter(e => {
      // Use effectiveDate if available (for backdated entries), otherwise createdAt
      const dateField = e.effectiveDate || e.createdAt;
      const entryDate = dateField instanceof Date
        ? dateField
        : dateField?.toDate?.() || new Date();
      return entryDate >= today && entryDate < tomorrow && e.category === category;
    });
  }, [entries, category]);

  const hasEntriesToday = todayEntries.length > 0;

  // Midnight reset - schedule a refresh when midnight arrives
  useEffect(() => {
    const scheduleMidnightReset = () => {
      const msUntilMidnight = getMillisecondsUntilMidnight();
      console.log(`Scheduling midnight reset in ${Math.round(msUntilMidnight / 60000)} minutes`);

      midnightTimeoutRef.current = setTimeout(() => {
        console.log('Midnight reached - resetting dashboard');
        // Reset state to trigger reload
        setLoading(true);
        setSummary(null);
        setPrompts([]);
        lastEntryCountRef.current = 0;
        // Schedule the next midnight
        scheduleMidnightReset();
      }, msUntilMidnight);
    };

    scheduleMidnightReset();

    return () => {
      if (midnightTimeoutRef.current) {
        clearTimeout(midnightTimeoutRef.current);
      }
    };
  }, []);

  // Load carry-forward items from yesterday
  useEffect(() => {
    if (!userId) return;

    const loadCarryForward = async () => {
      const items = await loadYesterdayCarryForward(userId, category);
      setCarryForwardItems(items);
    };

    loadCarryForward();
  }, [userId, category]);

  // Load cached pattern hints (contradictions & key insights)
  useEffect(() => {
    if (!userId) return;

    const loadPatternHints = async () => {
      try {
        // Load contradictions as the primary hints
        const contradictions = await getContradictions(userId);
        if (contradictions?.data?.length > 0) {
          setPatternHints(contradictions.data);
        } else {
          // Fallback to summary insights if no contradictions
          const summary = await getPatternSummary(userId);
          if (summary?.data?.length > 0) {
            setPatternHints(summary.data.slice(0, 2));
          }
        }
      } catch (error) {
        console.log('Pattern hints not available:', error.message);
      }
    };

    loadPatternHints();
  }, [userId]);

  // Generate content with caching
  const generateAndCacheContent = useCallback(async (useCache = true) => {
    if (!userId) {
      console.warn('No userId provided - skipping cache');
      useCache = false;
    }

    // Try to load from cache first
    if (useCache && userId) {
      const cached = await loadDashboardCache(userId, category, todayEntries.length);
      if (cached) {
        if (cached.summary) {
          // Merge carry-forward items if any
          if (carryForwardItems.length > 0 && cached.summary.action_items) {
            cached.summary.action_items.carried_forward = [
              ...(cached.summary.action_items.carried_forward || []),
              ...carryForwardItems.filter(
                item => !cached.summary.action_items.carried_forward?.includes(item)
              )
            ];
          }
          setSummary(cached.summary);
          setPrompts([]);
        } else if (cached.prompts?.length > 0) {
          setPrompts(cached.prompts);
          setSummary(null);
        }
        return { cached: true };
      }
    }

    // Generate fresh content
    let newSummary = null;
    let newPrompts = [];

    if (hasEntriesToday) {
      newSummary = await generateDaySummary(todayEntries, entries, category);
      // Add carry-forward items
      if (carryForwardItems.length > 0 && newSummary) {
        newSummary.action_items = newSummary.action_items || {};
        newSummary.action_items.carried_forward = [
          ...(newSummary.action_items.carried_forward || []),
          ...carryForwardItems
        ];
      }
      setSummary(newSummary);
      setPrompts([]);
    } else {
      newPrompts = await generateDashboardPrompts(entries, category);
      setPrompts(newPrompts);
      setSummary(null);
    }

    // Save to cache
    if (userId) {
      await saveDashboardCache(userId, category, {
        summary: newSummary,
        prompts: newPrompts,
        entryCount: todayEntries.length
      });
    }

    return { cached: false };
  }, [userId, category, todayEntries, entries, hasEntriesToday, carryForwardItems]);

  // Load prompts or summary based on state
  useEffect(() => {
    const loadDashboardContent = async () => {
      // Skip if entry count hasn't changed (avoid duplicate loads)
      if (lastEntryCountRef.current === todayEntries.length && (summary || prompts.length > 0)) {
        return;
      }

      setLoading(true);
      try {
        await generateAndCacheContent(true);
        lastEntryCountRef.current = todayEntries.length;
      } catch (e) {
        console.error('Failed to load dashboard content:', e);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardContent();
  }, [hasEntriesToday, todayEntries.length, category, generateAndCacheContent]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Force regeneration by skipping cache
      await generateAndCacheContent(false);
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-warm-400">
        <Loader2 className="animate-spin mb-2" size={24} />
        <span className="text-sm font-body">Loading your day...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold text-warm-800">
            {hasEntriesToday ? "Today's Summary" : "Start Your Day"}
          </h2>
          <p className="text-xs text-warm-500 font-body">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary && <MoodIndicator mood={summary.overall_mood} />}
          <motion.button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-full transition-colors disabled:opacity-50"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </motion.button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!hasEntriesToday ? (
          /* Empty State - Show Prompts */
          <motion.div
            key="empty"
            className="space-y-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="text-sm text-warm-500 font-body">
              What would you like to reflect on?
            </p>
            {prompts.map((p, i) => (
              <PromptCard
                key={i}
                prompt={p.prompt}
                type={p.type}
                onClick={() => onPromptClick?.(p.prompt)}
              />
            ))}
          </motion.div>
        ) : (
          /* Active State - Show Summary Sections */
          <motion.div
            key="active"
            className="space-y-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* One-liner summary */}
            {summary?.one_liner && (
              <motion.div
                className="bg-white rounded-2xl p-4 border border-warm-100 shadow-soft"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="text-warm-700 font-body text-sm italic">
                  "{summary.one_liner}"
                </p>
              </motion.div>
            )}

            {/* Sections */}
            <WinsSection wins={summary?.wins} />
            <ChallengesSection challenges={summary?.challenges} />
            <ActionItemsSection
              actionItems={summary?.action_items}
              onToggleTask={(task, source, index) => {
                // Update local state immediately for responsive UI
                setSummary(prev => {
                  if (!prev?.action_items?.[source]) return prev;
                  const updatedItems = [...prev.action_items[source]];
                  updatedItems.splice(index, 1);
                  return {
                    ...prev,
                    action_items: {
                      ...prev.action_items,
                      [source]: updatedItems
                    }
                  };
                });
                // Also call the external handler to persist to cache
                onToggleTask?.(task, source, index);
              }}
            />
            <PatternsSection patterns={summary?.patterns} />
            <PatternHintsSection
              hints={patternHints}
              onShowMore={onShowInsights}
            />

            {/* Entry count */}
            <p className="text-xs text-warm-400 text-center font-body pt-2">
              {todayEntries.length} {todayEntries.length === 1 ? 'entry' : 'entries'} today
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DayDashboard;
