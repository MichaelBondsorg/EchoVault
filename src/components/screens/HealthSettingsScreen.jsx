/**
 * Health Settings Screen
 *
 * Simple UI to connect/disconnect Apple Health or Google Fit.
 * Shows what data is collected and current connection status.
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  ChevronRight,
  Shield
} from 'lucide-react';

import {
  getHealthDataStatus,
  requestHealthPermissions,
  getHealthSummary,
  refreshHealthCache
} from '../../services/health';

const HealthSettingsScreen = ({ onClose }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [todayData, setTodayData] = useState(null);

  // Load current status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const healthStatus = await getHealthDataStatus();
      setStatus(healthStatus);

      // If connected, also load today's data to show it's working
      if (healthStatus.isAvailable) {
        const summary = await getHealthSummary();
        if (summary.available) {
          setTodayData(summary);
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
        // Refresh status after connecting
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

  // What platform-specific name to show
  const platformName = status?.platform === 'ios'
    ? 'Apple Health'
    : status?.platform === 'android'
      ? 'Google Fit'
      : 'Health App';

  // Data types we collect with simple explanations
  const dataTypes = [
    {
      icon: Moon,
      name: 'Sleep',
      description: 'Hours slept and sleep quality',
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-50'
    },
    {
      icon: Footprints,
      name: 'Steps',
      description: 'Daily step count',
      color: 'text-green-500',
      bgColor: 'bg-green-50'
    },
    {
      icon: Activity,
      name: 'Workouts',
      description: 'Exercise sessions you log',
      color: 'text-orange-500',
      bgColor: 'bg-orange-50'
    },
    {
      icon: Heart,
      name: 'Heart Rate',
      description: 'Resting and average heart rate',
      color: 'text-red-400',
      bgColor: 'bg-red-50'
    },
    {
      icon: Zap,
      name: 'HRV (Stress)',
      description: 'Heart rate variability for stress detection',
      color: 'text-purple-500',
      bgColor: 'bg-purple-50'
    }
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-warm-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-warm-100 px-4 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-400 to-pink-500 flex items-center justify-center">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-warm-800">Health Settings</h1>
            <p className="text-xs text-warm-500">Connect your health data</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-warm-100 text-warm-500"
        >
          <X size={20} />
        </button>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-6 pb-20">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-warm-400" />
          </div>
        )}

        {/* Connection Status Card */}
        {!loading && (
          <motion.div
            className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-warm-800">Connection Status</h2>
                {status?.isAvailable && (
                  <button
                    onClick={handleRefresh}
                    className="text-sm text-primary-500 flex items-center gap-1"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                )}
              </div>

              {/* Status Badge */}
              <div className={`flex items-center gap-3 p-3 rounded-xl ${
                status?.isAvailable
                  ? 'bg-green-50 border border-green-200'
                  : status?.platform === 'web'
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-warm-50 border border-warm-200'
              }`}>
                {status?.isAvailable ? (
                  <>
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <div>
                      <p className="font-medium text-green-800">Connected to {platformName}</p>
                      <p className="text-sm text-green-600">{status.message}</p>
                    </div>
                  </>
                ) : status?.platform === 'web' ? (
                  <>
                    <Smartphone className="w-6 h-6 text-amber-500" />
                    <div>
                      <p className="font-medium text-amber-800">Use the Mobile App</p>
                      <p className="text-sm text-amber-600">
                        Health data requires the iPhone or Android app
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-6 h-6 text-warm-400" />
                    <div>
                      <p className="font-medium text-warm-700">Not Connected</p>
                      <p className="text-sm text-warm-500">{status?.message || 'Tap below to connect'}</p>
                    </div>
                  </>
                )}
              </div>

              {/* Connect Button (only on native platforms) */}
              {status?.canRequestPermission && (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="w-full mt-4 py-3 px-4 bg-gradient-to-r from-red-400 to-pink-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {connecting ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Heart className="w-5 h-5" />
                      Connect {platformName}
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Today's Data Preview (if connected) */}
            {todayData?.available && (
              <div className="border-t border-warm-100 p-4 bg-warm-50">
                <p className="text-xs text-warm-500 mb-3">Today's Data</p>
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center">
                    <Moon className="w-4 h-4 mx-auto text-indigo-500 mb-1" />
                    <p className="text-sm font-semibold text-warm-800">
                      {todayData.sleep?.totalHours ?? '—'}h
                    </p>
                    <p className="text-[10px] text-warm-500">Sleep</p>
                  </div>
                  <div className="text-center">
                    <Footprints className="w-4 h-4 mx-auto text-green-500 mb-1" />
                    <p className="text-sm font-semibold text-warm-800">
                      {todayData.steps ? `${(todayData.steps / 1000).toFixed(1)}k` : '—'}
                    </p>
                    <p className="text-[10px] text-warm-500">Steps</p>
                  </div>
                  <div className="text-center">
                    <Activity className="w-4 h-4 mx-auto text-orange-500 mb-1" />
                    <p className="text-sm font-semibold text-warm-800">
                      {todayData.hasWorkout ? '✓' : '—'}
                    </p>
                    <p className="text-[10px] text-warm-500">Workout</p>
                  </div>
                  <div className="text-center">
                    <Heart className="w-4 h-4 mx-auto text-red-400 mb-1" />
                    <p className="text-sm font-semibold text-warm-800">
                      {todayData.heartRate?.resting ?? '—'}
                    </p>
                    <p className="text-[10px] text-warm-500">BPM</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* What We Collect */}
        {!loading && (
          <motion.div
            className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <div className="p-4 border-b border-warm-100">
              <h2 className="font-semibold text-warm-800">What We Read</h2>
              <p className="text-sm text-warm-500 mt-1">
                EchoVault only reads data — we never write to your health app
              </p>
            </div>
            <div className="divide-y divide-warm-100">
              {dataTypes.map((type, idx) => (
                <div key={idx} className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${type.bgColor} flex items-center justify-center`}>
                    <type.icon className={`w-5 h-5 ${type.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-warm-800">{type.name}</p>
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
            className="bg-gradient-to-br from-primary-50 to-blue-50 rounded-2xl border border-primary-100 p-4"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold text-primary-800">Why connect?</h3>
                <p className="text-sm text-primary-700 mt-1">
                  EchoVault can show you patterns like "You tend to feel better on days you sleep 7+ hours"
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
  );
};

export default HealthSettingsScreen;
