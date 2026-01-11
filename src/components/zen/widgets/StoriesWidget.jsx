import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, ChevronRight, Clock } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * Normalize situation name for deduplication
 */
const normalizeSituationKey = (name) => {
  return name
    .toLowerCase()
    .replace(/^@situation:/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getDisplayName = (key) => {
  return key
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * StoriesWidget - Ongoing stories/situations for Bento dashboard
 *
 * Shows connected multi-entry stories (situations) in a compact format
 */
const StoriesWidget = ({
  entries = [],
  category,
  onEntryClick,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  const [expandedStory, setExpandedStory] = useState(null);

  // Extract ongoing situations
  const situations = useMemo(() => {
    const categoryEntries = entries.filter(e => e.category === category);
    const situationMap = new Map();

    categoryEntries.forEach(entry => {
      // Check @situation: tags
      const situationTags = entry.tags?.filter(t =>
        t.toLowerCase().startsWith('@situation:')
      ) || [];

      situationTags.forEach(tag => {
        const rawName = tag.replace(/^@situation:/i, '');
        const normalizedKey = normalizeSituationKey(rawName);

        if (!situationMap.has(normalizedKey)) {
          situationMap.set(normalizedKey, {
            key: normalizedKey,
            name: getDisplayName(normalizedKey),
            entries: [],
          });
        }

        const entryDate = entry.effectiveDate || entry.createdAt;
        const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

        const existing = situationMap.get(normalizedKey);
        if (!existing.entries.some(e => e.id === entry.id)) {
          existing.entries.push({
            id: entry.id,
            date,
            mood: entry.analysis?.mood_score,
          });
        }
      });

      // Also check continues_situation field
      if (entry.continues_situation) {
        const normalizedKey = normalizeSituationKey(entry.continues_situation);
        if (!situationMap.has(normalizedKey)) {
          situationMap.set(normalizedKey, {
            key: normalizedKey,
            name: getDisplayName(normalizedKey),
            entries: [],
          });
        }

        const entryDate = entry.effectiveDate || entry.createdAt;
        const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

        const existing = situationMap.get(normalizedKey);
        if (!existing.entries.some(e => e.id === entry.id)) {
          existing.entries.push({
            id: entry.id,
            date,
            mood: entry.analysis?.mood_score,
          });
        }
      }
    });

    // Convert to array, sort by entry count, filter to ongoing (2+ entries)
    return Array.from(situationMap.values())
      .filter(s => s.entries.length >= 2)
      .map(s => ({
        ...s,
        entries: s.entries.sort((a, b) => b.date - a.date),
        latestDate: Math.max(...s.entries.map(e => e.date.getTime())),
      }))
      .sort((a, b) => b.latestDate - a.latestDate)
      .slice(0, 5);
  }, [entries, category]);

  // Get mood trend for a story
  const getMoodTrend = (entries) => {
    const moods = entries.filter(e => e.mood !== undefined).map(e => e.mood);
    if (moods.length < 2) return null;
    const recent = moods.slice(0, Math.ceil(moods.length / 2));
    const older = moods.slice(Math.ceil(moods.length / 2));
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    if (recentAvg - olderAvg > 0.1) return 'up';
    if (olderAvg - recentAvg > 0.1) return 'down';
    return 'stable';
  };

  if (situations.length === 0) {
    return (
      <GlassCard size={size} isEditing={isEditing} onDelete={onDelete}>
        <div className="h-full flex flex-col items-center justify-center text-center">
          <GitBranch size={24} className="text-warm-300 mb-2" />
          <p className="text-warm-500 text-sm font-medium">No ongoing stories</p>
          <p className="text-warm-400 text-xs mt-1">
            Tag entries with @situation:name to track
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard size={size} isEditing={isEditing} onDelete={onDelete}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 text-warm-500 mb-2">
          <GitBranch size={14} />
          <span className="text-xs font-medium">Ongoing Stories</span>
          <span className="text-xs text-warm-400 ml-auto">{situations.length}</span>
        </div>

        {/* Stories List */}
        <div className="flex-1 space-y-1.5 overflow-hidden">
          {situations.slice(0, 3).map((story) => {
            const trend = getMoodTrend(story.entries);
            const isExpanded = expandedStory === story.key;

            return (
              <motion.div
                key={story.key}
                className="bg-white/30 rounded-xl p-2 cursor-pointer hover:bg-white/50 transition-colors"
                onClick={() => !isEditing && setExpandedStory(isExpanded ? null : story.key)}
                whileHover={{ scale: isEditing ? 1 : 1.01 }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${
                      trend === 'up' ? 'bg-mood-good' :
                      trend === 'down' ? 'bg-mood-low' : 'bg-warm-300'
                    }`} />
                    <span className="text-sm font-medium text-warm-700 truncate">
                      {story.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-warm-400">
                    <span className="text-xs">{story.entries.length}</span>
                    <ChevronRight size={14} className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Expanded view */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mt-2 pt-2 border-t border-white/20"
                    >
                      <div className="flex items-center gap-1 text-xs text-warm-400">
                        <Clock size={10} />
                        <span>
                          {story.entries[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -
                          {story.entries[story.entries.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {situations.length > 3 && (
            <p className="text-xs text-warm-400 text-center pt-1">
              +{situations.length - 3} more stories
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default StoriesWidget;
