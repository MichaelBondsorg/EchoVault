import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, ChevronRight, Clock, MessageSquare, X, Check } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

/**
 * SituationTimeline - Visualizes connected entries via continues_situation
 *
 * Shows ongoing situations as threads linking multiple entries,
 * helping users see the narrative continuity of multi-day events.
 *
 * Features:
 * - Deduplication: Consolidates "@Situation:Job Search" and "job_search"
 * - Clear/resolve: Users can mark situations as resolved
 */

/**
 * Normalize a situation name for deduplication
 * Handles: "@situation:job_search", "@Situation:Job Search", "job_search", "Job Search"
 */
const normalizeSituationKey = (name) => {
  return name
    .toLowerCase()
    .replace(/^@situation:/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Get display name from normalized key
 */
const getDisplayName = (normalizedKey) => {
  return normalizedKey
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const SituationTimeline = ({ entries, category, onEntryClick, userId, onResolveSituation }) => {
  const [expandedSituation, setExpandedSituation] = useState(null);
  const [resolvingStory, setResolvingStory] = useState(null);
  const [resolvedStories, setResolvedStories] = useState(() => {
    // Load resolved stories from localStorage
    try {
      const key = `resolvedStories_${userId || 'default'}`;
      const stored = localStorage.getItem(key);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const situations = useMemo(() => {
    const categoryEntries = entries.filter(e => e.category === category);

    // Group entries by NORMALIZED situation key (for deduplication)
    const situationMap = new Map();

    categoryEntries.forEach(entry => {
      // Check for @situation: tags
      const situationTags = entry.tags?.filter(t =>
        t.toLowerCase().startsWith('@situation:')
      ) || [];

      situationTags.forEach(tag => {
        const rawName = tag.replace(/^@situation:/i, '');
        const normalizedKey = normalizeSituationKey(rawName);

        if (!situationMap.has(normalizedKey)) {
          situationMap.set(normalizedKey, {
            normalizedKey,
            displayName: getDisplayName(normalizedKey),
            originalTags: new Set([tag]),
            entries: []
          });
        } else {
          // Track all original tags for this normalized key
          situationMap.get(normalizedKey).originalTags.add(tag);
        }

        const entryDate = entry.effectiveDate || entry.createdAt;
        const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

        const existing = situationMap.get(normalizedKey);
        // Dedupe entries by ID
        if (!existing.entries.some(e => e.id === entry.id)) {
          existing.entries.push({
            id: entry.id,
            title: entry.title,
            text: entry.text?.substring(0, 100) + (entry.text?.length > 100 ? '...' : ''),
            date: date,
            mood: entry.analysis?.mood_score
          });
        }
      });

      // Also check continues_situation field
      if (entry.continues_situation) {
        const normalizedKey = normalizeSituationKey(entry.continues_situation);

        if (!situationMap.has(normalizedKey)) {
          situationMap.set(normalizedKey, {
            normalizedKey,
            displayName: getDisplayName(normalizedKey),
            originalTags: new Set([`@situation:${entry.continues_situation}`]),
            entries: []
          });
        }

        const entryDate = entry.effectiveDate || entry.createdAt;
        const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

        const existing = situationMap.get(normalizedKey);
        if (!existing.entries.some(e => e.id === entry.id)) {
          existing.entries.push({
            id: entry.id,
            title: entry.title,
            text: entry.text?.substring(0, 100) + (entry.text?.length > 100 ? '...' : ''),
            date: date,
            mood: entry.analysis?.mood_score
          });
        }
      }
    });

    // Filter to situations with 1+ entries (changed from 2+ to show all)
    // Filter out resolved stories
    return Array.from(situationMap.values())
      .filter(s => s.entries.length >= 1 && !resolvedStories.has(s.normalizedKey))
      .map(s => {
        // Sort entries by date
        s.entries.sort((a, b) => a.date - b.date);

        // Calculate date range
        const firstDate = s.entries[0].date;
        const lastDate = s.entries[s.entries.length - 1].date;
        const durationDays = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24));

        // Calculate average mood
        const moodEntries = s.entries.filter(e => e.mood !== null && e.mood !== undefined);
        const avgMood = moodEntries.length > 0
          ? moodEntries.reduce((sum, e) => sum + e.mood, 0) / moodEntries.length
          : null;

        return {
          ...s,
          firstDate,
          lastDate,
          durationDays,
          avgMood
        };
      })
      .sort((a, b) => b.lastDate - a.lastDate)
      .slice(0, 10); // Top 10 situations
  }, [entries, category, resolvedStories]);

  // Handle resolving a story
  const handleResolve = (normalizedKey, permanent = false) => {
    const newResolved = new Set(resolvedStories);
    newResolved.add(normalizedKey);
    setResolvedStories(newResolved);
    setResolvingStory(null);

    // Persist to localStorage
    try {
      const key = `resolvedStories_${userId || 'default'}`;
      localStorage.setItem(key, JSON.stringify([...newResolved]));
    } catch (e) {
      console.warn('Failed to persist resolved stories:', e);
    }

    // Callback for external handling (e.g., Firestore persistence)
    if (onResolveSituation) {
      onResolveSituation(normalizedKey, permanent);
    }
  };

  // Handle clearing all resolved stories (restore them)
  const handleClearAllResolved = () => {
    setResolvedStories(new Set());
    try {
      const key = `resolvedStories_${userId || 'default'}`;
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Failed to clear resolved stories:', e);
    }
  };

  // Don't render if no situations
  if (situations.length === 0) return null;

  const formatDate = (date) => {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getMoodColor = (mood) => {
    if (mood === null || mood === undefined) return 'bg-warm-200';
    if (mood >= 0.65) return 'bg-mood-great';
    if (mood >= 0.45) return 'bg-mood-neutral';
    if (mood >= 0.25) return 'bg-mood-low';
    return 'bg-mood-struggling';
  };

  return (
    <CollapsibleSection
      title="Ongoing Stories"
      icon={GitBranch}
      subtitle={`${situations.length} situation${situations.length !== 1 ? 's' : ''} across multiple entries`}
      colorScheme="indigo"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {situations.map((situation, index) => (
          <motion.div
            key={situation.normalizedKey}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-white/60 rounded-xl border border-indigo-100 overflow-hidden"
          >
            {/* Situation Header */}
            <div className="flex items-center">
              <button
                onClick={() => setExpandedSituation(
                  expandedSituation === situation.normalizedKey ? null : situation.normalizedKey
                )}
                className="flex-1 flex items-center justify-between p-3 hover:bg-white/50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`w-2 h-2 rounded-full ${getMoodColor(situation.avgMood)}`} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-medium text-indigo-800 truncate">
                      {situation.displayName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-indigo-600">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={10} />
                        {situation.entries.length} entr{situation.entries.length === 1 ? 'y' : 'ies'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {situation.durationDays > 0 ? `${situation.durationDays}d` : 'today'}
                      </span>
                    </div>
                  </div>
                </div>
                <motion.div
                  animate={{ rotate: expandedSituation === situation.normalizedKey ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={16} className="text-indigo-400" />
                </motion.div>
              </button>

              {/* Resolve button */}
              <button
                onClick={() => setResolvingStory(
                  resolvingStory === situation.normalizedKey ? null : situation.normalizedKey
                )}
                className="p-2 mr-2 rounded-lg hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 transition-colors"
                title="Mark as resolved"
              >
                <Check size={14} />
              </button>
            </div>

            {/* Resolve confirmation */}
            <AnimatePresence>
              {resolvingStory === situation.normalizedKey && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-1 border-t border-indigo-100 bg-indigo-50/50">
                    <p className="text-xs text-indigo-700 mb-2">Mark "{situation.displayName}" as resolved?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolve(situation.normalizedKey, false)}
                        className="px-3 py-1.5 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg transition-colors"
                      >
                        Hide for now
                      </button>
                      <button
                        onClick={() => handleResolve(situation.normalizedKey, true)}
                        className="px-3 py-1.5 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors"
                      >
                        Resolved
                      </button>
                      <button
                        onClick={() => setResolvingStory(null)}
                        className="px-3 py-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Entry Timeline */}
            <AnimatePresence>
              {expandedSituation === situation.normalizedKey && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3">
                    <div className="relative pl-4 border-l-2 border-indigo-200 space-y-2">
                      {situation.entries.map((entry, i) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => onEntryClick?.(entry.id)}
                          className="relative cursor-pointer hover:bg-indigo-50 rounded-lg p-2 -ml-4 pl-4 transition-colors"
                        >
                          {/* Timeline dot */}
                          <div className={`absolute left-[-5px] top-3 w-2 h-2 rounded-full ${getMoodColor(entry.mood)} border-2 border-white`} />

                          <p className="text-xs text-indigo-500 mb-0.5">
                            {formatDate(entry.date)}
                          </p>
                          <p className="text-sm text-indigo-800 font-medium line-clamp-1">
                            {entry.title}
                          </p>
                          <p className="text-xs text-indigo-600 line-clamp-2 mt-0.5">
                            {entry.text}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}

        {/* Show hidden count if any */}
        {resolvedStories.size > 0 && (
          <button
            onClick={handleClearAllResolved}
            className="w-full text-xs text-indigo-500 hover:text-indigo-700 py-2 text-center transition-colors"
          >
            {resolvedStories.size} resolved stor{resolvedStories.size === 1 ? 'y' : 'ies'} hidden · Click to restore
          </button>
        )}
      </div>
    </CollapsibleSection>
  );
};

export default SituationTimeline;
