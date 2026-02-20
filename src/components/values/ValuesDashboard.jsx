/**
 * Values Dashboard Component
 *
 * Main dashboard for viewing value alignment over time.
 * Shows radar chart, gap alerts, and compassionate reframes.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  Settings,
  ChevronRight,
  Sparkles,
  RefreshCw
} from 'lucide-react';

import ValuesRadarChart from './ValuesRadarChart';
import ValueGapCard from './ValueGapCard';
import { CORE_VALUES, computeValueAlignment, analyzeValueTrends, getValueProfile, savePrioritizedValues } from '../../services/values/valuesTracker';
import { generateCompassionateReport } from '../../services/values/compassionateReframe';

const ValuesDashboard = ({ entries, userId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [alignment, setAlignment] = useState(null);
  const [trends, setTrends] = useState(null);
  const [report, setReport] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showPrioritization, setShowPrioritization] = useState(false);
  const [selectedPriorities, setSelectedPriorities] = useState([]);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, [entries, userId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load user's value profile
      const userProfile = await getValueProfile(userId);
      setProfile(userProfile);
      setSelectedPriorities(userProfile.prioritizedValues || []);

      // Compute alignment
      const alignmentResult = computeValueAlignment(entries, {
        prioritizedValues: userProfile.prioritizedValues
      });
      setAlignment(alignmentResult);

      // Analyze trends
      const trendResult = analyzeValueTrends(entries, 4);
      setTrends(trendResult);

      // Generate compassionate report
      if (alignmentResult.available) {
        const compassionateReport = generateCompassionateReport(alignmentResult, entries.slice(0, 10));
        setReport(compassionateReport);
      }
    } catch (error) {
      console.error('Failed to load values data:', error);
    }
    setLoading(false);
  };

  // Toggle priority for a value
  const togglePriority = (valueKey) => {
    setSelectedPriorities(prev => {
      if (prev.includes(valueKey)) {
        return prev.filter(v => v !== valueKey);
      }
      if (prev.length >= 5) {
        return prev; // Max 5 priorities
      }
      return [...prev, valueKey];
    });
  };

  // Save priorities
  const savePriorities = async () => {
    await savePrioritizedValues(userId, selectedPriorities);
    setShowPrioritization(false);
    loadData(); // Reload with new priorities
  };

  // Get overall status color
  const getStatusColor = (score) => {
    if (score >= 0.7) return 'text-sage-600 dark:text-sage-400';
    if (score >= 0.5) return 'text-honey-600 dark:text-honey-400';
    return 'text-red-500 dark:text-red-400';
  };

  const getStatusBg = (score) => {
    if (score >= 0.7) return 'bg-sage-100 dark:bg-sage-900/30';
    if (score >= 0.5) return 'bg-honey-100 dark:bg-honey-900/30';
    return 'bg-red-50 dark:bg-red-900/30';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-warm-500" />
      </div>
    );
  }

  if (!alignment?.available) {
    return (
      <div className="p-6 text-center">
        <Heart className="w-12 h-12 mx-auto text-warm-300 mb-4" />
        <h3 className="text-lg font-medium text-warm-800 mb-2">
          Not Enough Data Yet
        </h3>
        <p className="text-warm-600 text-sm">
          Keep journaling! We need at least 3 entries to start tracking your value alignment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with overall score */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-warm-900 dark:text-warm-100">Value Alignment</h2>
          <p className="text-sm text-warm-600">
            Based on {alignment.entriesAnalyzed} entries
          </p>
        </div>

        <div className={`px-4 py-2 rounded-xl ${getStatusBg(alignment.overallAlignment)}`}>
          <span className={`text-2xl font-bold ${getStatusColor(alignment.overallAlignment)}`}>
            {Math.round(alignment.overallAlignment * 100)}%
          </span>
        </div>
      </div>

      {/* Overall message */}
      {report?.overallMessage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-gradient-to-r from-warm-50 to-terra-50 dark:from-hearth-850 dark:to-terra-900/20 rounded-xl border border-warm-200 dark:border-hearth-700"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-warm-500 flex-shrink-0 mt-0.5" />
            <p className="text-warm-700 text-sm">{report.overallMessage.message}</p>
          </div>
        </motion.div>
      )}

      {/* Radar Chart */}
      <div className="bg-white dark:bg-hearth-850 rounded-2xl border border-warm-200 dark:border-hearth-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-warm-800 dark:text-warm-200">Values Overview</h3>
          <button
            onClick={() => setShowPrioritization(true)}
            className="text-xs text-warm-500 hover:text-warm-700 flex items-center gap-1"
          >
            <Settings size={14} />
            Set Priorities
          </button>
        </div>
        <ValuesRadarChart
          alignment={alignment}
          prioritizedValues={selectedPriorities}
        />
      </div>

      {/* Trends */}
      {trends?.available && (
        <div className="bg-white dark:bg-hearth-850 rounded-2xl border border-warm-200 dark:border-hearth-700 p-4">
          <h3 className="font-medium text-warm-800 dark:text-warm-200 mb-3">Recent Trends</h3>
          <div className="grid grid-cols-3 gap-3">
            {/* Improving */}
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-sage-100 dark:bg-sage-900/30 flex items-center justify-center mb-2">
                <TrendingUp className="w-5 h-5 text-sage-600 dark:text-sage-400" />
              </div>
              <p className="text-xs text-warm-600 mb-1">Improving</p>
              <div className="space-y-1">
                {trends.improving.slice(0, 2).map(v => (
                  <span key={v} className="block text-xs font-medium text-sage-700 dark:text-sage-300">
                    {CORE_VALUES[v]?.label.split(' ')[0]}
                  </span>
                ))}
                {trends.improving.length === 0 && (
                  <span className="text-xs text-warm-400">—</span>
                )}
              </div>
            </div>

            {/* Stable */}
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-warm-100 dark:bg-hearth-800 flex items-center justify-center mb-2">
                <Minus className="w-5 h-5 text-warm-600" />
              </div>
              <p className="text-xs text-warm-600 mb-1">Stable</p>
              <div className="space-y-1">
                {trends.stable.slice(0, 2).map(v => (
                  <span key={v} className="block text-xs font-medium text-warm-700">
                    {CORE_VALUES[v]?.label.split(' ')[0]}
                  </span>
                ))}
                {trends.stable.length === 0 && (
                  <span className="text-xs text-warm-400">—</span>
                )}
              </div>
            </div>

            {/* Declining */}
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center mb-2">
                <TrendingDown className="w-5 h-5 text-red-500 dark:text-red-400" />
              </div>
              <p className="text-xs text-warm-600 mb-1">Needs Attention</p>
              <div className="space-y-1">
                {trends.declining.slice(0, 2).map(v => (
                  <span key={v} className="block text-xs font-medium text-red-600 dark:text-red-300">
                    {CORE_VALUES[v]?.label.split(' ')[0]}
                  </span>
                ))}
                {trends.declining.length === 0 && (
                  <span className="text-xs text-warm-400">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Value Gap Cards */}
      {report?.gaps?.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-warm-800 dark:text-warm-200">Compassionate Insights</h3>
          {report.gaps.map((gap, idx) => (
            <ValueGapCard key={gap.value} gap={gap} index={idx} />
          ))}
        </div>
      )}

      {/* Strengths */}
      {report?.strengths?.length > 0 && (
        <div className="bg-gradient-to-r from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20 rounded-2xl border border-sage-200 dark:border-sage-800 p-4">
          <h3 className="font-medium text-sage-800 dark:text-sage-200 mb-3 flex items-center gap-2">
            <Heart className="w-4 h-4" />
            Your Strengths
          </h3>
          <div className="space-y-2">
            {report.strengths.map(strength => (
              <div key={strength.value} className="flex items-center justify-between">
                <span className="text-sm text-sage-700 dark:text-sage-300">{strength.label}</span>
                <span className="text-sm font-medium text-sage-600 dark:text-sage-400">
                  {Math.round(strength.alignmentScore * 100)}% aligned
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Priority Selection Modal */}
      <AnimatePresence>
        {showPrioritization && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-end"
            onClick={() => setShowPrioritization(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white dark:bg-hearth-900 rounded-t-3xl w-full max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-semibold text-warm-900 dark:text-warm-100 mb-2">
                  Your Top Values
                </h3>
                <p className="text-sm text-warm-600 mb-4">
                  Select up to 5 values that matter most to you. These will be weighted more heavily.
                </p>

                <div className="grid grid-cols-2 gap-2 mb-6">
                  {Object.entries(CORE_VALUES).map(([key, value]) => (
                    <button
                      key={key}
                      onClick={() => togglePriority(key)}
                      className={`p-3 rounded-xl text-left transition-all ${
                        selectedPriorities.includes(key)
                          ? 'bg-warm-500 text-white dark:bg-warm-600'
                          : 'bg-warm-100 text-warm-700 hover:bg-warm-200 dark:bg-hearth-800 dark:text-warm-300 dark:hover:bg-hearth-700'
                      } ${
                        !selectedPriorities.includes(key) && selectedPriorities.length >= 5
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                      disabled={!selectedPriorities.includes(key) && selectedPriorities.length >= 5}
                    >
                      <span className="text-sm font-medium">{value.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowPrioritization(false)}
                    className="flex-1 py-3 rounded-xl bg-warm-100 text-warm-700 dark:bg-hearth-800 dark:text-warm-300 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePriorities}
                    className="flex-1 py-3 rounded-xl bg-warm-500 text-white font-medium"
                  >
                    Save ({selectedPriorities.length}/5)
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ValuesDashboard;
