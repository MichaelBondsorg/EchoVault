/**
 * Health Insights Widget Component
 *
 * Dashboard widget showing health-mood correlations.
 * Adapts to data availability:
 * - Full data: Shows correlations and insights
 * - Cached data: Shows last known data with freshness indicator
 * - No data: Shows manual input option or permission request
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Moon,
  Activity,
  Heart,
  Footprints,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Smartphone,
  Clock
} from 'lucide-react';

import { getHealthDataStatus, getHealthSummary, requestHealthPermissions, saveManualHealthInput } from '../../services/health/healthDataService';

const ICON_MAP = {
  Moon: Moon,
  Activity: Activity,
  Heart: Heart,
  Footprints: Footprints
};

const HealthInsightsWidget = ({ correlations, onRequestPermission, onManualInput }) => {
  const [status, setStatus] = useState(null);
  const [todayHealth, setTodayHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    loadHealthData();
  }, []);

  const loadHealthData = async () => {
    setLoading(true);
    const dataStatus = await getHealthDataStatus();
    setStatus(dataStatus);

    if (dataStatus.isAvailable) {
      const summary = await getHealthSummary();
      setTodayHealth(summary);
    }
    setLoading(false);
  };

  // Permission required state
  if (!loading && status && !status.isAvailable && status.canRequestPermission) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-lavender-50 to-lavender-100 dark:from-lavender-900/20 dark:to-lavender-800/20 rounded-2xl border border-lavender-200 dark:border-lavender-800 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-lavender-100 dark:bg-lavender-900/30 flex items-center justify-center flex-shrink-0">
            <Heart className="w-5 h-5 text-lavender-600 dark:text-lavender-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-lavender-800 dark:text-lavender-300">Connect Health Data</h3>
            <p className="text-sm text-lavender-600 dark:text-lavender-400 mt-1">
              See how sleep, exercise, and stress affect your mood.
            </p>
            <button
              onClick={async () => {
                await requestHealthPermissions();
                loadHealthData();
              }}
              className="mt-3 px-4 py-2 bg-lavender-500 dark:bg-lavender-600 text-white text-sm font-medium rounded-lg hover:bg-lavender-600 dark:hover:bg-lavender-700 transition-colors"
            >
              Connect {status.platform === 'ios' ? 'Apple Health' : 'Google Fit'}
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Web platform - show manual input or cached data message
  if (!loading && status && status.strategy === 'manual') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-warm-50 to-terra-50 dark:from-warm-900/30 dark:to-terra-900/30 rounded-2xl border border-warm-200 dark:border-warm-700 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-warm-100 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5 text-warm-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-warm-800">Health Insights</h3>
            <p className="text-sm text-warm-600 mt-1">
              Use the mobile app to connect health data, or add manually.
            </p>
            <button
              onClick={() => setShowManualInput(true)}
              className="mt-3 text-sm text-warm-500 hover:text-warm-700 flex items-center gap-1"
            >
              Add manually <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Manual input modal */}
        <ManualHealthInput
          show={showManualInput}
          onClose={() => setShowManualInput(false)}
          onSave={async (data) => {
            await saveManualHealthInput(data);
            setShowManualInput(false);
            loadHealthData();
          }}
        />
      </motion.div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-warm-200 p-4 flex items-center justify-center h-32">
        <RefreshCw className="w-5 h-5 animate-spin text-warm-400" />
      </div>
    );
  }

  // No data available
  if (!todayHealth?.available && !correlations?.available) {
    return null;
  }

  // Has data - show insights
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
    >
      {/* Header with today's summary */}
      <div className="p-4 border-b border-warm-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-warm-800">Health & Mood</h3>
          {status?.hasCachedData && (
            <span className="text-xs text-warm-400 flex items-center gap-1">
              <Clock size={12} />
              {status.cacheAge}
            </span>
          )}
        </div>

        {todayHealth?.available && (
          <div className="grid grid-cols-4 gap-2">
            {/* Sleep */}
            <div className="text-center">
              <Moon className="w-4 h-4 mx-auto text-lavender-500 dark:text-lavender-400 mb-1" />
              <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                {todayHealth.sleep?.totalHours || '—'}
              </p>
              <p className="text-xs text-warm-500">hrs sleep</p>
            </div>

            {/* Steps */}
            <div className="text-center">
              <Footprints className="w-4 h-4 mx-auto text-sage-500 dark:text-sage-400 mb-1" />
              <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                {todayHealth.steps ? (todayHealth.steps / 1000).toFixed(1) + 'k' : '—'}
              </p>
              <p className="text-xs text-warm-500">steps</p>
            </div>

            {/* Workout */}
            <div className="text-center">
              <Activity className="w-4 h-4 mx-auto text-honey-500 dark:text-honey-400 mb-1" />
              <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                {todayHealth.hasWorkout ? '✓' : '—'}
              </p>
              <p className="text-xs text-warm-500">workout</p>
            </div>

            {/* Stress */}
            <div className="text-center">
              <Heart className="w-4 h-4 mx-auto text-red-400 mb-1" /> {/* @color-safe - health/heart context */}
              <p className="text-lg font-semibold text-warm-800 dark:text-warm-200 capitalize">
                {todayHealth.hrv?.stressIndicator || '—'}
              </p>
              <p className="text-xs text-warm-500">stress</p>
            </div>
          </div>
        )}
      </div>

      {/* Correlation insights */}
      {correlations?.available && correlations.insights?.length > 0 && (
        <div className="p-4">
          <p className="text-xs text-warm-500 mb-3">Based on your patterns:</p>
          <div className="space-y-3">
            {correlations.insights.slice(0, 2).map((insight, idx) => {
              const IconComponent = ICON_MAP[insight.icon] || Heart;
              return (
                <div key={idx} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    insight.priority === 'high' ? 'bg-sage-100 dark:bg-sage-900/30' : 'bg-warm-100'
                  }`}>
                    <IconComponent size={16} className={
                      insight.priority === 'high' ? 'text-sage-600 dark:text-sage-400' : 'text-warm-600'
                    } />
                  </div>
                  <p className="text-sm text-warm-700 dark:text-warm-300">{insight.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {correlations?.available && correlations.recommendations?.length > 0 && (
        <div className="p-4 bg-sage-50 dark:bg-sage-900/30 border-t border-sage-100 dark:border-sage-800">
          <p className="text-xs text-sage-600 dark:text-sage-400 font-medium mb-2">Try this:</p>
          <p className="text-sm text-sage-800 dark:text-sage-300">
            {correlations.recommendations[0].action}
          </p>
        </div>
      )}
    </motion.div>
  );
};

/**
 * Manual Health Input Modal
 */
const ManualHealthInput = ({ show, onClose, onSave }) => {
  const [sleepHours, setSleepHours] = useState(7);
  const [hadWorkout, setHadWorkout] = useState(false);
  const [stressLevel, setStressLevel] = useState('moderate');

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          className="bg-white rounded-t-3xl w-full p-6"
          onClick={e => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-warm-900 mb-4">
            Today's Health
          </h3>

          {/* Sleep */}
          <div className="mb-4">
            <label className="text-sm text-warm-600 mb-2 block">
              Hours of sleep last night
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="12"
                step="0.5"
                value={sleepHours}
                onChange={(e) => setSleepHours(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-lg font-medium text-warm-800 w-12 text-center">
                {sleepHours}h
              </span>
            </div>
          </div>

          {/* Workout */}
          <div className="mb-4">
            <label className="text-sm text-warm-600 mb-2 block">
              Did you work out today?
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setHadWorkout(true)}
                className={`flex-1 py-2 rounded-lg transition-colors ${
                  hadWorkout
                    ? 'bg-sage-500 dark:bg-sage-600 text-white'
                    : 'bg-warm-100 text-warm-600'
                }`}
              >
                Yes
              </button>
              <button
                onClick={() => setHadWorkout(false)}
                className={`flex-1 py-2 rounded-lg transition-colors ${
                  !hadWorkout
                    ? 'bg-warm-500 dark:bg-warm-600 text-white'
                    : 'bg-warm-100 text-warm-600'
                }`}
              >
                No
              </button>
            </div>
          </div>

          {/* Stress */}
          <div className="mb-6">
            <label className="text-sm text-warm-600 mb-2 block">
              How stressed do you feel?
            </label>
            <div className="flex gap-2">
              {['low', 'moderate', 'high'].map(level => (
                <button
                  key={level}
                  onClick={() => setStressLevel(level)}
                  className={`flex-1 py-2 rounded-lg capitalize transition-colors ${
                    stressLevel === level
                      ? level === 'low'
                        ? 'bg-sage-500 dark:bg-sage-600 text-white'
                        : level === 'moderate'
                          ? 'bg-honey-500 dark:bg-honey-600 text-white'
                          : 'bg-red-500 text-white' /* @color-safe - health/stress context */
                      : 'bg-warm-100 text-warm-600'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-warm-100 text-warm-700 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave({ sleepHours, hadWorkout, stressLevel })}
              className="flex-1 py-3 rounded-xl bg-warm-500 text-white font-medium"
            >
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default HealthInsightsWidget;
