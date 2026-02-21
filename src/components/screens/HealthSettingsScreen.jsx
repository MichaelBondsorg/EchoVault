/**
 * Health Settings Screen
 *
 * UI to connect health data sources:
 * - Whoop (cloud-to-cloud, works everywhere)
 * - Apple Health (iOS native)
 * - Google Fit (Android native)
 * - Future: Oura, Fitbit, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Heart,
  Moon,
  Footprints,
  Activity,
  Zap,
  CheckCircle,
  AlertCircle,
  Smartphone,
  RefreshCw,
  Shield,
  Link2,
  Unlink,
  ExternalLink,
  TrendingUp,
  Plus,
  Apple,
  Watch,
  History,
  XCircle
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';

import {
  getHealthDataStatus,
  requestHealthPermissions,
  getHealthSummary,
  refreshHealthCache,
  isWhoopLinked,
  initiateWhoopOAuth,
  disconnectWhoop,
  getWhoopRecoveryInsight,
  getBackfillCount,
  backfillHealthData
} from '../../services/health';

import {
  getEnvironmentBackfillCount,
  backfillEnvironmentData
} from '../../services/environment/environmentBackfill';

// Source badge component - shows which source data came from
const SourceBadge = ({ source }) => {
  if (!source) return null;

  const config = {
    whoop: { label: 'Whoop', bg: 'bg-sage-100 dark:bg-sage-900/30', text: 'text-sage-700 dark:text-sage-300' },
    healthkit: { label: 'Apple', bg: 'bg-warm-100 dark:bg-warm-800', text: 'text-warm-700 dark:text-warm-300' },
    googlefit: { label: 'Fit', bg: 'bg-lavender-100 dark:bg-lavender-900/30', text: 'text-lavender-700 dark:text-lavender-300' },
    merged: { label: 'Both', bg: 'bg-lavender-200 dark:bg-lavender-900/40', text: 'text-lavender-700 dark:text-lavender-300' },
  };

  const { label, bg, text } = config[source] || config.healthkit;

  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${bg} ${text} font-medium`}>
      {label}
    </span>
  );
};

const HealthSettingsScreen = ({ onClose }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [todayData, setTodayData] = useState(null);

  // Whoop-specific state
  const [whoopLinked, setWhoopLinked] = useState(false);
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  const [whoopDisconnecting, setWhoopDisconnecting] = useState(false);

  // Health Backfill state
  const [backfillCount, setBackfillCount] = useState(0);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(null);
  const [backfillComplete, setBackfillComplete] = useState(false);
  const [backfillResults, setBackfillResults] = useState(null);
  const [backfillAbort, setBackfillAbort] = useState(null);

  // Environment Backfill state
  const [envBackfillCount, setEnvBackfillCount] = useState(0);
  const [envBackfillRunning, setEnvBackfillRunning] = useState(false);
  const [envBackfillProgress, setEnvBackfillProgress] = useState(null);
  const [envBackfillComplete, setEnvBackfillComplete] = useState(false);
  const [envBackfillResults, setEnvBackfillResults] = useState(null);
  const [envBackfillAbort, setEnvBackfillAbort] = useState(null);

  // Load current status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  // Handle Escape key to close modal (MOD-002)
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // A11Y-002: Focus trapping within modal
  useEffect(() => {
    const modalElement = document.querySelector('[data-modal="health-settings"]');
    if (!modalElement) return;

    const focusableElements = modalElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    // Focus the first element when modal opens
    firstFocusable?.focus();

    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => document.removeEventListener('keydown', handleTabKey);
  }, [loading]); // Re-run when loading changes to update focusable elements

  const loadStatus = async () => {
    setLoading(true);
    try {
      // Check Whoop status
      const whoopStatus = await isWhoopLinked();
      setWhoopLinked(whoopStatus);

      const healthStatus = await getHealthDataStatus();
      setStatus(healthStatus);

      // If any source connected, load today's data and check backfill
      if (healthStatus.isAvailable || whoopStatus) {
        const summary = await getHealthSummary();
        if (summary.available) {
          setTodayData(summary);
        }

        // Check how many entries need health backfill
        const count = await getBackfillCount();
        setBackfillCount(count);

        // Check how many entries need environment backfill
        try {
          const envCount = await getEnvironmentBackfillCount();
          setEnvBackfillCount(envCount);
        } catch (e) {
          console.warn('Environment backfill count unavailable:', e);
        }
      }
    } catch (error) {
      console.error('Failed to load health status:', error);
    }
    setLoading(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await requestHealthPermissions();
      if (result.authorized) {
        await loadStatus();
      } else if (result.error) {
        alert(`Could not connect: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      alert('Something went wrong. Please try again.');
    }
    setConnecting(false);
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshHealthCache();
      await loadStatus();
    } catch (error) {
      console.error('Failed to refresh:', error);
    }
    setLoading(false);
  };

  // Whoop OAuth flow
  const handleConnectWhoop = async () => {
    setWhoopConnecting(true);
    try {
      const authUrl = await initiateWhoopOAuth();

      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: authUrl });
      } else {
        window.location.href = authUrl;
      }
    } catch (error) {
      console.error('Failed to initiate Whoop OAuth:', error);
      alert('Failed to connect to Whoop. Please try again.');
    }
    setWhoopConnecting(false);
  };

  const handleDisconnectWhoop = async () => {
    if (!confirm('Are you sure you want to disconnect Whoop?')) return;

    setWhoopDisconnecting(true);
    try {
      await disconnectWhoop();
      setWhoopLinked(false);
      setTodayData(null);
      await loadStatus();
    } catch (error) {
      console.error('Failed to disconnect Whoop:', error);
      alert('Failed to disconnect. Please try again.');
    }
    setWhoopDisconnecting(false);
  };

  // Backfill handlers
  const handleStartBackfill = async () => {
    setBackfillRunning(true);
    setBackfillComplete(false);
    setBackfillResults(null);
    setBackfillProgress({ total: backfillCount, processed: 0, updated: 0, skipped: 0 });

    // Create abort controller
    const abortController = new AbortController();
    setBackfillAbort(abortController);

    try {
      const results = await backfillHealthData(
        (progress) => setBackfillProgress(progress),
        abortController.signal
      );
      setBackfillResults(results);
      setBackfillComplete(true);
      setBackfillCount(0); // Reset count after successful backfill
    } catch (error) {
      console.error('Backfill failed:', error);
      alert('Backfill failed. Please try again.');
    }

    setBackfillRunning(false);
    setBackfillAbort(null);
  };

  const handleCancelBackfill = () => {
    if (backfillAbort) {
      backfillAbort.abort();
      setBackfillRunning(false);
      setBackfillAbort(null);
    }
  };

  const handleDismissBackfillResults = () => {
    setBackfillComplete(false);
    setBackfillResults(null);
    setBackfillProgress(null);
  };

  // Environment backfill handlers
  const handleStartEnvBackfill = async () => {
    setEnvBackfillRunning(true);
    setEnvBackfillComplete(false);
    setEnvBackfillResults(null);
    setEnvBackfillProgress({ total: envBackfillCount, processed: 0, updated: 0, skipped: 0 });

    // Create abort controller
    const abortController = new AbortController();
    setEnvBackfillAbort(abortController);

    try {
      const results = await backfillEnvironmentData(
        (progress) => setEnvBackfillProgress(progress),
        abortController.signal
      );
      setEnvBackfillResults(results);
      setEnvBackfillComplete(true);
      setEnvBackfillCount(0);
    } catch (error) {
      console.error('Environment backfill failed:', error);
      if (!abortController.signal.aborted) {
        alert('Environment backfill failed. Please try again.');
      }
    }

    setEnvBackfillRunning(false);
    setEnvBackfillAbort(null);
  };

  const handleCancelEnvBackfill = () => {
    if (envBackfillAbort) {
      envBackfillAbort.abort();
      setEnvBackfillRunning(false);
      setEnvBackfillAbort(null);
    }
  };

  const handleDismissEnvBackfillResults = () => {
    setEnvBackfillComplete(false);
    setEnvBackfillResults(null);
    setEnvBackfillProgress(null);
  };

  // Platform name for native health
  const platformName = status?.platform === 'ios'
    ? 'Apple Health'
    : status?.platform === 'android'
      ? 'Google Fit'
      : 'Health App';

  // Check if native health is connected (now independent of Whoop status)
  const nativeConnected = status?.isNativeConnected;
  const isWeb = status?.platform === 'web';
  const anySourceConnected = whoopLinked || nativeConnected;

  // Determine source for each metric in merged data
  const getMetricSource = (metric) => {
    if (!todayData) return null;
    if (todayData.source === 'merged') {
      // In merged mode, use knowledge of what each source provides
      if (metric === 'steps') return 'healthkit';
      if (['sleep', 'hrv', 'recovery', 'strain'].includes(metric)) return 'whoop';
      return 'merged';
    }
    return todayData.source;
  };

  // Data types we collect
  const dataTypes = [
    { icon: Moon, name: 'Sleep', description: 'Hours slept and sleep quality', color: 'text-lavender-500 dark:text-lavender-400', bgColor: 'bg-lavender-50 dark:bg-lavender-900/30' },
    { icon: Footprints, name: 'Steps', description: 'Daily step count', color: 'text-sage-500 dark:text-sage-400', bgColor: 'bg-sage-50 dark:bg-sage-900/30' },
    { icon: Activity, name: 'Workouts', description: 'Exercise sessions you log', color: 'text-terra-500 dark:text-terra-400', bgColor: 'bg-terra-50 dark:bg-terra-900/30' },
    { icon: Heart, name: 'Heart Rate', description: 'Resting and average heart rate', color: 'text-red-400 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/30' },
    { icon: Zap, name: 'HRV (Stress)', description: 'Heart rate variability for stress detection', color: 'text-lavender-600 dark:text-lavender-400', bgColor: 'bg-lavender-50 dark:bg-lavender-900/30' }
  ];

  // Handle backdrop click to close modal (MOD-001)
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-modal="health-settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="health-settings-title"
    >
      {/* Backdrop - click to close (MOD-001) */}
      {/* MOD-004: Increased backdrop opacity and added transition for cleaner appearance */}
      <motion.div
        className="absolute inset-0 bg-warm-900/40 backdrop-blur-md"
        onClick={handleBackdropClick}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />

      {/* Modal content - full width on mobile, centered with max-width on larger screens */}
      {/* MOD-004: Smoother animation with opacity for cleaner transitions */}
      <motion.div
        className="absolute inset-y-0 inset-x-0 mx-auto w-full max-w-2xl bg-warm-50 dark:bg-hearth-950 shadow-2xl"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-hearth-900 border-b border-warm-100 dark:border-hearth-800 px-4 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {/* Fixed header icon color (CLR-001) - changed from pink to teal to match app palette */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-honey-400 to-sage-500 flex items-center justify-center">
              <Heart className="w-5 h-5 text-white" />
            </div>
          <div>
            <h1 id="health-settings-title" className="font-display font-bold text-warm-800 dark:text-warm-200">Health Settings</h1>
            <p className="text-xs text-warm-500">Connect your health data</p>
          </div>
        </div>
        {/* MOD-003: Improved close button visibility with background and larger tap target */}
        <button
          onClick={onClose}
          className="p-2.5 rounded-xl bg-warm-100 hover:bg-warm-200 text-warm-600 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close health settings"
        >
          <X size={22} />
        </button>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-4 pb-20 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-warm-400" />
          </div>
        )}

        {/* Health Sources Card */}
        {!loading && (
          <motion.div
            className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-200 dark:border-hearth-800 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-warm-800 dark:text-warm-200">Health Sources</h2>
                {anySourceConnected && (
                  <button
                    onClick={handleRefresh}
                    className="text-sm text-honey-500 flex items-center gap-1"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                )}
              </div>

              {/* Source Chips */}
              <div className="flex flex-wrap gap-2">
                {/* Apple Health / Google Fit Chip */}
                {!isWeb && (
                  <button
                    onClick={nativeConnected ? undefined : handleConnect}
                    disabled={connecting}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      nativeConnected
                        ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
                        : 'bg-warm-50 dark:bg-hearth-850 border-warm-200 dark:border-hearth-700 hover:border-warm-300'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      nativeConnected ? 'bg-sage-100 dark:bg-sage-900/40' : 'bg-warm-100 dark:bg-hearth-700'
                    }`}>
                      {status?.platform === 'ios' ? (
                        <Heart className={`w-4 h-4 ${nativeConnected ? 'text-sage-600 dark:text-sage-400' : 'text-warm-500'}`} />
                      ) : (
                        <Activity className={`w-4 h-4 ${nativeConnected ? 'text-sage-600 dark:text-sage-400' : 'text-warm-500'}`} />
                      )}
                    </div>
                    <div className="text-left">
                      <p className={`text-sm font-medium ${nativeConnected ? 'text-sage-800 dark:text-sage-200' : 'text-warm-700 dark:text-warm-300'}`}>
                        {platformName}
                      </p>
                      <p className={`text-xs ${nativeConnected ? 'text-sage-600 dark:text-sage-400' : 'text-warm-500'}`}>
                        {nativeConnected ? 'Connected' : connecting ? 'Connecting...' : 'Tap to connect'}
                      </p>
                    </div>
                    {nativeConnected && <CheckCircle className="w-4 h-4 text-sage-500 dark:text-sage-400 ml-1" />}
                  </button>
                )}

                {/* Whoop Chip */}
                <button
                  onClick={whoopLinked ? undefined : handleConnectWhoop}
                  disabled={whoopConnecting}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                    whoopLinked
                      ? 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800'
                      : 'bg-warm-50 dark:bg-hearth-850 border-warm-200 dark:border-hearth-700 hover:border-warm-300'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    whoopLinked ? 'bg-sage-100 dark:bg-sage-900/40' : 'bg-warm-100 dark:bg-hearth-700'
                  }`}>
                    <Watch className={`w-4 h-4 ${whoopLinked ? 'text-sage-600 dark:text-sage-400' : 'text-warm-500'}`} />
                  </div>
                  <div className="text-left">
                    <p className={`text-sm font-medium ${whoopLinked ? 'text-sage-800 dark:text-sage-200' : 'text-warm-700 dark:text-warm-300'}`}>
                      Whoop
                    </p>
                    <p className={`text-xs ${whoopLinked ? 'text-sage-600 dark:text-sage-400' : 'text-warm-500'}`}>
                      {whoopLinked ? 'Connected' : whoopConnecting ? 'Connecting...' : 'Tap to connect'}
                    </p>
                  </div>
                  {whoopLinked && <CheckCircle className="w-4 h-4 text-sage-500 dark:text-sage-400 ml-1" />}
                </button>

                {/* Add More (Future sources placeholder) */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-warm-200 text-warm-400">
                  <Plus className="w-4 h-4" />
                  <span className="text-xs">More coming soon</span>
                </div>
              </div>

              {/* Web platform notice */}
              {isWeb && !whoopLinked && (
                <div className="mt-3 p-3 rounded-xl bg-honey-50 dark:bg-honey-900/30 border border-honey-200 dark:border-honey-800 flex items-start gap-2">
                  <Smartphone className="w-5 h-5 text-honey-500 dark:text-honey-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-honey-800 dark:text-honey-200">Use the Mobile App</p>
                    <p className="text-xs text-honey-600 dark:text-honey-400">
                      Apple Health requires the iOS app. Or connect Whoop to sync from anywhere.
                    </p>
                  </div>
                </div>
              )}

              {/* Disconnect option for Whoop */}
              {whoopLinked && (
                <button
                  onClick={handleDisconnectWhoop}
                  disabled={whoopDisconnecting}
                  className="mt-3 text-xs text-warm-500 hover:text-warm-700 flex items-center gap-1"
                >
                  <Unlink className="w-3 h-3" />
                  {whoopDisconnecting ? 'Disconnecting...' : 'Disconnect Whoop'}
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Today's Health Card */}
        {!loading && todayData?.available && (
          <motion.div
            className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-200 dark:border-hearth-800 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-warm-800 dark:text-warm-200">Today's Health</h2>
                {todayData.source === 'merged' && (
                  <span className="text-xs text-lavender-600 dark:text-lavender-400 bg-lavender-50 dark:bg-lavender-900/30 px-2 py-1 rounded-full">
                    Smart merged
                  </span>
                )}
              </div>

              {/* Health Metrics */}
              <div className="space-y-3">
                {/* Sleep */}
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-lavender-50 dark:bg-lavender-900/30 flex items-center justify-center">
                      <Moon className="w-5 h-5 text-lavender-500 dark:text-lavender-400" />
                    </div>
                    <div>
                      <p className="text-sm text-warm-600">Sleep</p>
                      <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                        {todayData.sleep?.totalHours?.toFixed(1)
                          ? `${todayData.sleep.totalHours.toFixed(1)} hrs`
                          : <span className="text-warm-400 text-sm">No data</span>}
                      </p>
                    </div>
                  </div>
                  <SourceBadge source={getMetricSource('sleep')} />
                </div>

                {/* Steps */}
                <div className="flex items-center justify-between py-2 border-t border-warm-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sage-50 dark:bg-sage-900/30 flex items-center justify-center">
                      <Footprints className="w-5 h-5 text-sage-500 dark:text-sage-400" />
                    </div>
                    <div>
                      <p className="text-sm text-warm-600">Steps</p>
                      <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                        {todayData.activity?.stepsToday
                          ? todayData.activity.stepsToday.toLocaleString()
                          : <span className="text-warm-400 text-sm">No data</span>}
                      </p>
                    </div>
                  </div>
                  <SourceBadge source={getMetricSource('steps')} />
                </div>

                {/* Workout */}
                <div className="flex items-center justify-between py-2 border-t border-warm-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-terra-50 dark:bg-terra-900/30 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-terra-500 dark:text-terra-400" />
                    </div>
                    <div>
                      <p className="text-sm text-warm-600">Workout</p>
                      <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                        {todayData.activity?.hasWorkout
                          ? `${todayData.activity.totalExerciseMinutes || ''} min`.trim() || '✓'
                          : <span className="text-warm-400 text-sm">None</span>}
                      </p>
                    </div>
                  </div>
                  <SourceBadge source={getMetricSource('workout')} />
                </div>

                {/* Resting Heart Rate */}
                <div className="flex items-center justify-between py-2 border-t border-warm-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
                      <Heart className="w-5 h-5 text-red-400 dark:text-red-400" />
                    </div>
                    <div>
                      <p className="text-sm text-warm-600">Resting HR</p>
                      <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                        {todayData.heart?.restingRate
                          ? `${todayData.heart.restingRate} bpm`
                          : <span className="text-warm-400 text-sm">No data</span>}
                      </p>
                    </div>
                  </div>
                  <SourceBadge source={getMetricSource('hr')} />
                </div>

                {/* HRV */}
                {todayData.heart?.hrv && (
                  <div className="flex items-center justify-between py-2 border-t border-warm-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-lavender-50 dark:bg-lavender-900/30 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-lavender-600 dark:text-lavender-400" />
                      </div>
                      <div>
                        <p className="text-sm text-warm-600">HRV</p>
                        <p className="text-lg font-semibold text-warm-800 dark:text-warm-200">
                          {todayData.heart.hrv} ms
                        </p>
                      </div>
                    </div>
                    <SourceBadge source={getMetricSource('hrv')} />
                  </div>
                )}
              </div>

              {/* Whoop Recovery Score */}
              {todayData.recovery && (
                <div className={`mt-4 p-4 rounded-xl flex items-center gap-3 ${
                  todayData.recovery.status === 'green' ? 'bg-sage-50 dark:bg-sage-900/30 border border-sage-200 dark:border-sage-800' :
                  todayData.recovery.status === 'yellow' ? 'bg-honey-50 dark:bg-honey-900/30 border border-honey-200 dark:border-honey-800' :
                  'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800'
                }`}>
                  <TrendingUp className={`w-6 h-6 ${
                    todayData.recovery.status === 'green' ? 'text-sage-600 dark:text-sage-400' :
                    todayData.recovery.status === 'yellow' ? 'text-honey-600 dark:text-honey-400' : 'text-red-500 dark:text-red-400'
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-warm-800 dark:text-warm-200">
                        Recovery: {todayData.recovery.score}%
                      </p>
                      <SourceBadge source="whoop" />
                    </div>
                    <p className="text-sm text-warm-600 dark:text-warm-400">
                      {getWhoopRecoveryInsight(todayData.recovery)?.message}
                    </p>
                  </div>
                </div>
              )}

              {/* Strain Score */}
              {todayData.strain && (
                <div className="mt-3 p-3 rounded-xl bg-warm-50 border border-warm-200 flex items-center gap-3">
                  <Activity className="w-5 h-5 text-warm-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-warm-700">
                        Strain: {todayData.strain.score?.toFixed(1)}
                      </p>
                      <SourceBadge source="whoop" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Sync Past Entries (Backfill) */}
        {!loading && anySourceConnected && (backfillCount > 0 || backfillRunning || backfillComplete) && (
          <motion.div
            className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-200 dark:border-hearth-800 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.08 }}
          >
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-honey-50 dark:bg-honey-900/30 flex items-center justify-center">
                  <History className="w-5 h-5 text-honey-600 dark:text-honey-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-warm-800 dark:text-warm-200">Sync Past Entries</h2>
                  <p className="text-sm text-warm-500">
                    Add health data to older journal entries
                  </p>
                </div>
              </div>

              {/* Not running, not complete - show start button */}
              {!backfillRunning && !backfillComplete && backfillCount > 0 && (
                <>
                  <p className="text-sm text-warm-600 mb-3">
                    Found <span className="font-semibold">{backfillCount}</span> entries without health data.
                    We can add sleep, steps, and heart rate from your health history.
                  </p>
                  <button
                    onClick={handleStartBackfill}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-honey-500 to-terra-500 dark:from-honey-600 dark:to-terra-600 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                  >
                    <History className="w-4 h-4" />
                    Sync {backfillCount} Entries
                  </button>
                </>
              )}

              {/* Running - show progress */}
              {backfillRunning && backfillProgress && (
                <div className="space-y-3">
                  {/* Progress bar */}
                  <div className="w-full bg-warm-100 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-honey-500 to-terra-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(backfillProgress.processed / backfillProgress.total) * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warm-600">
                      Processing {backfillProgress.processed} of {backfillProgress.total}...
                    </span>
                    <span className="text-sage-600 dark:text-sage-400 font-medium">
                      {backfillProgress.updated} updated
                    </span>
                  </div>

                  {/* Current entry being processed */}
                  {backfillProgress.currentEntry && (
                    <p className="text-xs text-warm-500 truncate">
                      {backfillProgress.currentEntry.createdAt?.toLocaleDateString()} - {backfillProgress.currentEntry.content}
                    </p>
                  )}

                  <button
                    onClick={handleCancelBackfill}
                    className="w-full py-2 px-4 border border-warm-200 text-warm-600 font-medium rounded-xl flex items-center justify-center gap-2 hover:bg-warm-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              )}

              {/* Complete - show results */}
              {backfillComplete && backfillResults && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-sage-50 dark:bg-sage-900/30 border border-sage-200 dark:border-sage-800">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-sage-600 dark:text-sage-400" />
                      <p className="font-semibold text-sage-800 dark:text-sage-200">Sync Complete!</p>
                    </div>
                    <div className="text-sm text-sage-700 dark:text-sage-300 space-y-1">
                      <p>✓ Added health data to <span className="font-semibold">{backfillResults.updated}</span> entries</p>
                      {backfillResults.skipped > 0 && (
                        <p className="text-warm-600">• {backfillResults.skipped} entries had no matching health data</p>
                      )}
                      {backfillResults.failed > 0 && (
                        <p className="text-red-600">• {backfillResults.failed} entries failed to update</p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleDismissBackfillResults}
                    className="w-full py-2 px-4 border border-warm-200 text-warm-600 font-medium rounded-xl hover:bg-warm-50"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Environment Backfill Section */}
        {!loading && (envBackfillCount > 0 || envBackfillRunning || envBackfillComplete) && (
          <motion.div
            className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-200 dark:border-hearth-800 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <div className="p-4 border-b border-warm-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lavender-400 to-lavender-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="font-semibold text-warm-800 dark:text-warm-200">Sync Weather Data</h2>
                  <p className="text-sm text-warm-500">
                    Add weather &amp; light data to past entries
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Ready to start */}
              {!envBackfillRunning && !envBackfillComplete && envBackfillCount > 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-warm-600">
                    <span className="font-semibold">{envBackfillCount}</span> recent {envBackfillCount === 1 ? 'entry' : 'entries'} from
                    the last 7 days can be enriched with weather data (temperature, sunshine, conditions).
                  </p>
                  <button
                    onClick={handleStartEnvBackfill}
                    className="w-full py-3 px-4 bg-gradient-to-r from-lavender-500 to-lavender-600 dark:from-lavender-600 dark:to-lavender-700 text-white font-medium rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-transform"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                    </svg>
                    Sync Weather Data
                  </button>
                  <p className="text-xs text-warm-400 text-center">
                    Uses Open-Meteo weather history (free, no account needed)
                  </p>
                </div>
              )}

              {/* Running */}
              {envBackfillRunning && envBackfillProgress && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warm-600">
                      Processing entry {envBackfillProgress.processed} of {envBackfillProgress.total}...
                    </span>
                    <button
                      onClick={handleCancelEnvBackfill}
                      className="text-red-500 dark:text-red-400 text-xs hover:underline"
                    >
                      Cancel
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-warm-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-lavender-500 to-lavender-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${(envBackfillProgress.processed / envBackfillProgress.total) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-warm-500">
                    <span>Updated: {envBackfillProgress.updated}</span>
                    <span>Skipped: {envBackfillProgress.skipped}</span>
                  </div>
                </div>
              )}

              {/* Complete - show results */}
              {envBackfillComplete && envBackfillResults && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-lavender-50 dark:bg-lavender-900/30 border border-lavender-200 dark:border-lavender-800">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-lavender-600 dark:text-lavender-400" />
                      <p className="font-semibold text-lavender-800 dark:text-lavender-200">Weather Sync Complete!</p>
                    </div>
                    <div className="text-sm text-lavender-700 dark:text-lavender-300 space-y-1">
                      <p>✓ Added weather data to <span className="font-semibold">{envBackfillResults.updated}</span> entries</p>
                      {envBackfillResults.skipped > 0 && (
                        <p className="text-warm-600">• {envBackfillResults.skipped} entries skipped (already had data or too old)</p>
                      )}
                      {envBackfillResults.failed > 0 && (
                        <p className="text-red-600">• {envBackfillResults.failed} entries failed to update</p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleDismissEnvBackfillResults}
                    className="w-full py-2 px-4 border border-warm-200 text-warm-600 font-medium rounded-xl hover:bg-warm-50"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* What We Collect */}
        {!loading && (
          <motion.div
            className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-200 dark:border-hearth-800 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <div className="p-4 border-b border-warm-100 dark:border-hearth-800">
              <h2 className="font-semibold text-warm-800 dark:text-warm-200">What We Read</h2>
              <p className="text-sm text-warm-500 mt-1">
                Engram only reads data — we never write to your health app
              </p>
            </div>
            <div className="divide-y divide-warm-100">
              {dataTypes.map((type, idx) => (
                <div key={idx} className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${type.bgColor} flex items-center justify-center`}>
                    <type.icon className={`w-5 h-5 ${type.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-warm-800 dark:text-warm-200">{type.name}</p>
                    <p className="text-sm text-warm-500">{type.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Why We Use Health Data */}
        {!loading && (
          <motion.div
            className="bg-gradient-to-br from-honey-50 to-lavender-50 dark:from-honey-900/30 dark:to-lavender-900/30 rounded-2xl border border-honey-100 dark:border-honey-800 p-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-honey-100 dark:bg-honey-900/40 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-honey-600 dark:text-honey-400" />
              </div>
              <div>
                <h3 className="font-semibold text-honey-800 dark:text-honey-200">Why connect?</h3>
                <p className="text-sm text-honey-700 dark:text-honey-300 mt-1">
                  Engram can show you patterns like "You tend to feel better on days you sleep 7+ hours"
                  or "Exercise days often lead to more positive entries."
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Privacy Note */}
        {!loading && (
          <motion.div
            className="flex items-start gap-3 text-sm text-warm-500 px-2"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              Your health data stays on your device and is only used to show you personal insights.
              We don't share it with anyone.
            </p>
          </motion.div>
        )}
      </div>
      </motion.div>
    </motion.div>
  );
};

export default HealthSettingsScreen;
