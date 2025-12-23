import { useState, useEffect, useCallback } from 'react';
import { getMorningCheckins, getEveningReflections, getTodaySignalSummary } from '../services/followup';
import { getTimePhase } from '../services/temporal/time';

/**
 * useTodaySignals Hook
 *
 * Provides today's signal data for dashboard integration:
 * - Morning check-ins (plans for today)
 * - Evening reflections (how did things go)
 * - Summary counts
 *
 * @param {string} userId - User ID
 * @returns {Object} Today's signal data and loading state
 */
export const useTodaySignals = (userId) => {
  const [loading, setLoading] = useState(true);
  const [checkins, setCheckins] = useState([]);
  const [reflections, setReflections] = useState([]);
  const [summary, setSummary] = useState(null);
  const [timePhase, setTimePhase] = useState(() => getTimePhase());

  // Load signals on mount and when userId changes
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const loadSignals = async () => {
      setLoading(true);
      try {
        const [checkinsData, reflectionsData, summaryData] = await Promise.all([
          getMorningCheckins(userId),
          getEveningReflections(userId),
          getTodaySignalSummary(userId)
        ]);

        setCheckins(checkinsData);
        setReflections(reflectionsData);
        setSummary(summaryData);
      } catch (error) {
        console.error('Failed to load today signals:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSignals();
  }, [userId]);

  // Update time phase every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTimePhase(getTimePhase());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Refresh signals (call after new entry saved)
  const refresh = useCallback(async () => {
    if (!userId) return;

    try {
      const [checkinsData, reflectionsData, summaryData] = await Promise.all([
        getMorningCheckins(userId),
        getEveningReflections(userId),
        getTodaySignalSummary(userId)
      ]);

      setCheckins(checkinsData);
      setReflections(reflectionsData);
      setSummary(summaryData);
    } catch (error) {
      console.error('Failed to refresh signals:', error);
    }
  }, [userId]);

  // Get the relevant prompts based on time of day
  const activePrompts = timePhase === 'evening' ? reflections : checkins;

  return {
    loading,
    checkins,
    reflections,
    summary,
    activePrompts,
    timePhase,
    refresh,

    // Convenience accessors
    hasCheckins: checkins.length > 0,
    hasReflections: reflections.length > 0,
    hasPlansToday: summary?.hasUpcoming || false,
    planCount: summary?.plans || 0
  };
};

export default useTodaySignals;
