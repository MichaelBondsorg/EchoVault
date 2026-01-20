import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Cloud, Heart, Activity, Pause, Play, Loader2, Trash2
} from 'lucide-react';
import {
  runFullBackfill,
  getBackfillSummary,
  getResumableBackfill,
  resetBackfillState,
  BACKFILL_STAGES
} from '../../services/backfill/unifiedBackfill';
import { clearBackfilledHealthData } from '../../utils/diagnosticExport';
import { db, auth } from '../../config/firebase';

/**
 * BackfillPanel Component
 *
 * Provides UI for retroactive data enrichment:
 * - Shows count of entries needing backfill
 * - Progress indicators during backfill
 * - Resume capability after interruption
 * - Results summary when complete
 */
const BackfillPanel = ({ entries = [] }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [clearResults, setClearResults] = useState(null);

  const abortControllerRef = useRef(null);

  // Count backfilled entries for the clear button
  const backfilledCount = entries.filter(e => e.healthContext?.backfilled === true).length;

  // Load summary on mount
  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getBackfillSummary();
      setSummary(data);
    } catch (err) {
      console.error('[BackfillPanel] Failed to load summary:', err);
      setError('Failed to load backfill status');
    } finally {
      setLoading(false);
    }
  };

  const startBackfill = async () => {
    try {
      setRunning(true);
      setError(null);
      setResults(null);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      const result = await runFullBackfill(
        (p) => setProgress(p),
        abortControllerRef.current.signal
      );

      setResults(result);
      setProgress(null);

      // Refresh summary
      await loadSummary();
    } catch (err) {
      console.error('[BackfillPanel] Backfill failed:', err);
      setError(err.message || 'Backfill failed');
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  };

  const cancelBackfill = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleReset = async () => {
    try {
      await resetBackfillState();
      await loadSummary();
      setResults(null);
    } catch (err) {
      console.error('[BackfillPanel] Reset failed:', err);
    }
  };

  const handleClearBackfilled = async () => {
    if (!auth.currentUser || !entries.length) return;

    const confirmClear = window.confirm(
      `This will clear health data from ${backfilledCount} backfilled entries.\n\n` +
      `Use this if the backfill used incorrect data (e.g., same day's data for all entries).\n\n` +
      `After clearing, you can re-run the backfill with the fixed plugin.\n\n` +
      `Continue?`
    );

    if (!confirmClear) return;

    try {
      setClearing(true);
      setError(null);
      setClearResults(null);

      const result = await clearBackfilledHealthData(
        entries,
        auth.currentUser.uid,
        db,
        (current, total) => {
          setProgress({ processed: current, total, stage: 'clearing' });
        }
      );

      setClearResults(result);
      setProgress(null);

      // Refresh summary to show updated counts
      await loadSummary();
    } catch (err) {
      console.error('[BackfillPanel] Clear failed:', err);
      setError(err.message || 'Failed to clear backfilled data');
    } finally {
      setClearing(false);
    }
  };

  const getStageLabel = (stage) => {
    switch (stage) {
      case BACKFILL_STAGES.HEALTH:
        return 'Enriching with health data...';
      case BACKFILL_STAGES.ENVIRONMENT:
        return 'Adding weather context...';
      case BACKFILL_STAGES.REASSESSMENT:
        return 'Regenerating insights...';
      case BACKFILL_STAGES.COMPLETE:
        return 'Complete!';
      case BACKFILL_STAGES.ERROR:
        return 'Error occurred';
      default:
        return 'Processing...';
    }
  };

  const getStageIcon = (stage) => {
    switch (stage) {
      case BACKFILL_STAGES.HEALTH:
        return <Heart size={16} className="text-red-500" />;
      case BACKFILL_STAGES.ENVIRONMENT:
        return <Cloud size={16} className="text-blue-500" />;
      case BACKFILL_STAGES.REASSESSMENT:
        return <Activity size={16} className="text-purple-500" />;
      case BACKFILL_STAGES.COMPLETE:
        return <CheckCircle2 size={16} className="text-green-500" />;
      case BACKFILL_STAGES.ERROR:
        return <XCircle size={16} className="text-red-500" />;
      default:
        return <Loader2 size={16} className="animate-spin text-warm-500" />;
    }
  };

  if (loading) {
    return (
      <div className="bg-warm-50 rounded-xl p-4 border border-warm-100">
        <div className="flex items-center gap-2 text-warm-500">
          <Loader2 size={16} className="animate-spin" />
          <span>Checking backfill status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-warm-50 rounded-xl p-4 border border-warm-100 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={20} className="text-primary-600" />
          <h3 className="font-semibold text-warm-800">Data Enrichment</h3>
        </div>
        {!running && summary && (
          <button
            onClick={loadSummary}
            className="text-warm-500 hover:text-warm-700 p-1"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Summary when not running */}
      {!running && summary && !results && (
        <div className="space-y-3">
          <p className="text-sm text-warm-600">
            Retroactively add health and weather data to your journal entries
            for better insights.
          </p>

          {summary.totalEntriesNeedingBackfill > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white p-3 rounded-lg border border-warm-100">
                  <div className="flex items-center gap-2 text-red-600 mb-1">
                    <Heart size={14} />
                    <span className="font-medium">Health Data</span>
                  </div>
                  <div className="text-warm-800 font-semibold">
                    {summary.entriesNeedingHealth} entries
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-warm-100">
                  <div className="flex items-center gap-2 text-blue-600 mb-1">
                    <Cloud size={14} />
                    <span className="font-medium">Weather</span>
                  </div>
                  <div className="text-warm-800 font-semibold">
                    {summary.entriesNeedingEnvironment} entries
                  </div>
                </div>
              </div>

              {summary.estimatedTimeMinutes > 0 && (
                <p className="text-xs text-warm-500">
                  Estimated time: ~{summary.estimatedTimeMinutes} min
                </p>
              )}

              {summary.canResume && (
                <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-2 rounded-lg text-sm">
                  <AlertCircle size={14} />
                  <span>Previous backfill was interrupted. You can resume where you left off.</span>
                </div>
              )}

              <button
                onClick={startBackfill}
                className="w-full bg-primary-600 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
              >
                <Play size={16} />
                {summary.canResume ? 'Resume Backfill' : 'Start Backfill'}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg">
              <CheckCircle2 size={16} />
              <span className="text-sm">All entries are up to date!</span>
            </div>
          )}

          {/* Clear backfilled data option */}
          {backfilledCount > 0 && !clearing && (
            <div className="pt-3 border-t border-warm-200">
              <p className="text-xs text-warm-500 mb-2">
                {backfilledCount} entries have backfilled health data.
                If the data is incorrect, you can clear it and re-run the backfill.
              </p>
              <button
                onClick={handleClearBackfilled}
                className="text-sm text-amber-600 hover:text-amber-700 flex items-center gap-1"
              >
                <Trash2 size={14} />
                Clear backfilled data to re-sync
              </button>
            </div>
          )}
        </div>
      )}

      {/* Clearing progress */}
      {clearing && progress && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin text-amber-500" />
            <span className="text-sm font-medium text-warm-700">
              Clearing backfilled data...
            </span>
          </div>
          <div className="h-2 bg-warm-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-amber-500 rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${Math.round((progress.processed / progress.total) * 100)}%`
              }}
            />
          </div>
          <div className="text-xs text-warm-500">
            {progress.processed} / {progress.total} entries
          </div>
        </motion.div>
      )}

      {/* Clear results */}
      {clearResults && !clearing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 text-amber-600">
            <CheckCircle2 size={18} />
            <span className="font-medium">Health Data Cleared</span>
          </div>
          <p className="text-sm text-warm-600">{clearResults.message}</p>
          <button
            onClick={() => setClearResults(null)}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            Done
          </button>
        </motion.div>
      )}

      {/* Progress display */}
      <AnimatePresence>
        {running && progress && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            {/* Stage indicator */}
            <div className="flex items-center gap-2">
              {getStageIcon(progress.stage)}
              <span className="text-sm font-medium text-warm-700">
                {getStageLabel(progress.stage)}
              </span>
            </div>

            {/* Progress bar */}
            {progress.total > 0 && (
              <div className="space-y-1">
                <div className="h-2 bg-warm-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.round((progress.processed / progress.total) * 100)}%`
                    }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex justify-between text-xs text-warm-500">
                  <span>
                    {progress.processed} / {progress.total} entries
                  </span>
                  <span>
                    {progress.updated || 0} updated
                  </span>
                </div>
              </div>
            )}

            {/* Phase indicator */}
            {progress.phase && (
              <p className="text-xs text-warm-500">
                {progress.phase === 'collecting' ? 'Fetching data...' : 'Writing to database...'}
              </p>
            )}

            {/* Cancel button */}
            <button
              onClick={cancelBackfill}
              className="w-full bg-warm-200 text-warm-700 py-2 px-4 rounded-lg font-medium hover:bg-warm-300 transition-colors flex items-center justify-center gap-2"
            >
              <Pause size={16} />
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results display */}
      {results && !running && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 size={18} />
            <span className="font-medium">Backfill Complete</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-white p-2 rounded border border-warm-100">
              <div className="text-warm-500 text-xs">Health Updated</div>
              <div className="font-semibold text-warm-800">
                {results.health?.updated || 0}
              </div>
            </div>
            <div className="bg-white p-2 rounded border border-warm-100">
              <div className="text-warm-500 text-xs">Weather Added</div>
              <div className="font-semibold text-warm-800">
                {results.environment?.updated || 0}
              </div>
            </div>
          </div>

          {results.environment?.skippedNoLocation > 0 && (
            <p className="text-xs text-warm-500">
              {results.environment.skippedNoLocation} entries skipped (no location data)
            </p>
          )}

          {results.reassessment?.insights?.generated > 0 && (
            <div className="text-sm text-purple-600 bg-purple-50 p-2 rounded-lg">
              {results.reassessment.insights.generated} new insights generated!
            </div>
          )}

          <button
            onClick={() => setResults(null)}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            Done
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default BackfillPanel;
