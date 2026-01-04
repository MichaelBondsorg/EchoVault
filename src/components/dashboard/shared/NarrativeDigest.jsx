import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, ChevronDown, Sparkles, RefreshCw, X } from 'lucide-react';
import { db, doc, getDoc } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

/**
 * NarrativeDigest - Weekly "State of the Vault" narrative summary
 *
 * Displays an AI-synthesized narrative of the user's week instead of
 * individual insight cards. Aims for a more cohesive, story-like experience.
 *
 * Props:
 * - userId: User ID
 * - category: Current category (personal/work)
 * - onDismiss: Optional dismiss handler
 */

const NarrativeDigest = ({ userId, category, onDismiss }) => {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [error, setError] = useState(null);

  // Load digest from Firestore
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const loadDigest = async () => {
      try {
        const digestRef = doc(
          db,
          'artifacts',
          APP_COLLECTION_ID,
          'users',
          userId,
          'digests',
          'weekly'
        );

        const snapshot = await getDoc(digestRef);

        if (snapshot.exists()) {
          const data = snapshot.data();

          // Check if digest is from current week
          const weekStart = getWeekStart();
          const digestWeek = data.weekOf?.toDate?.() || new Date(data.weekOf);

          if (digestWeek >= weekStart) {
            setDigest(data);
          } else {
            // Digest is stale
            setDigest(null);
          }
        } else {
          setDigest(null);
        }
      } catch (err) {
        console.error('Failed to load narrative digest:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadDigest();
  }, [userId]);

  // Get start of current week (Monday)
  const getWeekStart = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  };

  // Format relative time
  const formatRelativeTime = (date) => {
    if (!date) return '';

    const d = date instanceof Date ? date : date?.toDate?.() || new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  };

  // Don't render if loading or no digest
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-gradient-to-br from-primary-50 to-secondary-50 rounded-2xl p-6 border border-primary-100"
      >
        <div className="flex items-center gap-2 text-primary-400">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm font-body">Loading your weekly narrative...</span>
        </div>
      </motion.div>
    );
  }

  if (!digest || error) {
    return null; // Silent fail - don't show anything if no digest
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-gradient-to-br from-primary-50 via-white to-secondary-50 rounded-2xl border border-primary-100 overflow-hidden mb-4 shadow-soft"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-primary-100/50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-3 flex-1"
        >
          <div className="p-2 rounded-xl bg-gradient-to-br from-primary-100 to-secondary-100">
            <BookOpen size={18} className="text-primary-600" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-display font-semibold text-warm-800">
              Your Week
            </h3>
            <p className="text-xs text-warm-500">
              {digest.mood?.arc || 'Weekly narrative'}
              {digest.generatedAt && ` · ${formatRelativeTime(digest.generatedAt)}`}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="p-1.5 hover:bg-white/60 rounded-lg transition-colors"
          >
            <ChevronDown size={18} className="text-warm-400" />
          </motion.button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1.5 hover:bg-white/60 rounded-lg transition-colors"
            >
              <X size={16} className="text-warm-400" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-5">
              {/* Main narrative */}
              <div className="prose prose-warm prose-sm max-w-none">
                {digest.narrative?.split('\n\n').map((paragraph, i) => (
                  <p key={i} className="text-warm-700 font-body leading-relaxed mb-3 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </div>

              {/* Key patterns mentioned (optional) */}
              {digest.highlightedPatterns?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-primary-100/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={12} className="text-secondary-500" />
                    <span className="text-xs font-medium text-warm-500">Key patterns this week</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {digest.highlightedPatterns.slice(0, 4).map((pattern, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 text-xs bg-white/70 rounded-full text-warm-600 border border-warm-100"
                      >
                        {pattern}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Forward-looking note (optional) */}
              {digest.lookAhead && (
                <div className="mt-4 p-3 bg-gradient-to-r from-secondary-50 to-primary-50 rounded-xl">
                  <p className="text-sm text-warm-600 font-body italic">
                    {digest.lookAhead}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-warm-50/50 border-t border-warm-100/50">
              <p className="text-xs text-warm-400 text-center font-body">
                {digest.entryCount} entries analyzed · Week of {formatWeekOf(digest.weekOf)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Format week of date
 */
const formatWeekOf = (date) => {
  if (!date) return 'this week';

  const d = date instanceof Date ? date : date?.toDate?.() || new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default NarrativeDigest;
