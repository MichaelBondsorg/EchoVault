import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, TrendingUp, Check, AlertTriangle, Pause, X } from 'lucide-react';
import { db, doc, setDoc, Timestamp } from '../../../config/firebase';
import { getDoc } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../../config/constants';
import CollapsibleSection from './CollapsibleSection';

/**
 * GoalsProgress - Collapsible section showing active goals with status tracking
 *
 * Extracts @goal: tags from entries and tracks their status via goal_update field:
 * - progress: Making headway
 * - achieved: Goal completed
 * - struggling: Having difficulty
 * - abandoned: No longer pursuing
 *
 * Goals can be dismissed (hidden) by the user - stored in Firestore.
 */

const GoalsProgress = ({ entries, category, userId }) => {
  const [dismissedGoals, setDismissedGoals] = useState(new Set());
  const [loadingDismissed, setLoadingDismissed] = useState(true);

  // Load dismissed goals from Firestore
  useEffect(() => {
    if (!userId) {
      setLoadingDismissed(false);
      return;
    }

    const loadDismissed = async () => {
      try {
        const dismissedRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'preferences', 'dismissedGoals');
        const snap = await getDoc(dismissedRef);

        if (snap.exists()) {
          const data = snap.data();
          // Filter to only include goals for this category
          const categoryDismissed = data[category] || [];
          setDismissedGoals(new Set(categoryDismissed));
        }
      } catch (e) {
        console.error('Failed to load dismissed goals:', e);
      } finally {
        setLoadingDismissed(false);
      }
    };

    loadDismissed();
  }, [userId, category]);

  // Dismiss a goal
  const dismissGoal = useCallback(async (goalTag) => {
    if (!userId) return;

    // Optimistic update
    setDismissedGoals(prev => new Set([...prev, goalTag]));

    try {
      const dismissedRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'preferences', 'dismissedGoals');
      const snap = await getDoc(dismissedRef);

      const existingData = snap.exists() ? snap.data() : {};
      const categoryDismissed = existingData[category] || [];

      if (!categoryDismissed.includes(goalTag)) {
        categoryDismissed.push(goalTag);
      }

      await setDoc(dismissedRef, {
        ...existingData,
        [category]: categoryDismissed,
        updatedAt: Timestamp.now()
      }, { merge: true });

      console.log('Goal dismissed:', goalTag);
    } catch (e) {
      console.error('Failed to dismiss goal:', e);
      // Revert optimistic update
      setDismissedGoals(prev => {
        const next = new Set(prev);
        next.delete(goalTag);
        return next;
      });
    }
  }, [userId, category]);

  const goals = useMemo(() => {
    // Filter to category
    const categoryEntries = entries.filter(e => e.category === category);

    // Extract all goals from entries
    const goalMap = new Map();

    // Get all entries with goal tags
    // Check both entry.tags and entry.analysis.enhancedContext.structured_tags
    categoryEntries.forEach(entry => {
      const topLevelTags = entry.tags || [];
      const structuredTags = entry.analysis?.enhancedContext?.structured_tags || [];
      const allTags = [...new Set([...topLevelTags, ...structuredTags])];
      const goalTags = allTags.filter(t => t.startsWith('@goal:'));

      goalTags.forEach(tag => {
        const goalName = tag.replace('@goal:', '').replace(/_/g, ' ');

        if (!goalMap.has(goalName)) {
          const entryDate = entry.effectiveDate || entry.createdAt;
          const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

          goalMap.set(goalName, {
            name: goalName,
            tag: tag,
            firstMentioned: date,
            lastMentioned: date,
            status: 'active',
            mentionCount: 1,
            entries: [entry]
          });
        } else {
          const existing = goalMap.get(goalName);
          const entryDate = entry.effectiveDate || entry.createdAt;
          const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

          existing.mentionCount++;
          existing.entries.push(entry);

          if (date > existing.lastMentioned) {
            existing.lastMentioned = date;
          }
          if (date < existing.firstMentioned) {
            existing.firstMentioned = date;
          }
        }
      });

      // Check for goal updates
      if (entry.goal_update?.tag) {
        const goalName = entry.goal_update.tag.replace('@goal:', '').replace(/_/g, ' ');
        if (goalMap.has(goalName)) {
          goalMap.get(goalName).status = entry.goal_update.status;
        }
      }
    });

    // Convert to array, filter dismissed, sort by last mentioned
    return Array.from(goalMap.values())
      .filter(g => !dismissedGoals.has(g.tag))
      .sort((a, b) => b.lastMentioned - a.lastMentioned)
      .slice(0, 5); // Show top 5 goals
  }, [entries, category, dismissedGoals]);

  // Don't render if loading or no goals
  if (loadingDismissed) return null;
  if (goals.length === 0) return null;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'achieved': return <Check size={12} className="text-mood-great" />;
      case 'progress': return <TrendingUp size={12} className="text-honey-500" />;
      case 'struggling': return <AlertTriangle size={12} className="text-honey-500 dark:text-honey-400" />;
      case 'abandoned': return <Pause size={12} className="text-warm-400" />;
      default: return <Target size={12} className="text-honey-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'achieved': return 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800 text-sage-700 dark:text-sage-300';
      case 'progress': return 'bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800 text-honey-700 dark:text-honey-300';
      case 'struggling': return 'bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800 text-honey-700 dark:text-honey-300';
      case 'abandoned': return 'bg-warm-100 dark:bg-warm-800 border-warm-200 dark:border-warm-700 text-warm-500 dark:text-warm-400';
      default: return 'bg-white dark:bg-hearth-900 border-warm-200 dark:border-warm-700 text-warm-700 dark:text-warm-300';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'achieved': return 'Achieved';
      case 'progress': return 'In Progress';
      case 'struggling': return 'Challenging';
      case 'abandoned': return 'Paused';
      default: return 'Active';
    }
  };

  const formatDate = (date) => {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  const activeGoals = goals.filter(g => g.status !== 'achieved' && g.status !== 'abandoned');
  const completedGoals = goals.filter(g => g.status === 'achieved');

  return (
    <CollapsibleSection
      title="Goals"
      icon={Target}
      colorScheme="blue"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {goals.map((goal, index) => (
          <motion.div
            key={goal.tag}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10, height: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`p-3 rounded-xl border ${getStatusColor(goal.status)} group relative`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="mt-0.5">
                  {getStatusIcon(goal.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate capitalize">
                    {goal.name}
                  </p>
                  <p className="text-xs opacity-70 mt-0.5">
                    {goal.mentionCount} mention{goal.mentionCount !== 1 ? 's' : ''} · last {formatDate(goal.lastMentioned)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/50`}>
                  {getStatusLabel(goal.status)}
                </span>
                {/* Dismiss button - visible on hover */}
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissGoal(goal.tag);
                  }}
                  className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/50 transition-all"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Dismiss goal"
                >
                  <X size={12} className="text-warm-400 hover:text-warm-600" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Summary footer */}
        <div className="text-xs text-lavender-600 dark:text-lavender-400 pt-2 border-t border-lavender-100 dark:border-lavender-800">
          {activeGoals.length} active{completedGoals.length > 0 ? ` · ${completedGoals.length} achieved` : ''}
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default GoalsProgress;
