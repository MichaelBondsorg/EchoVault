/**
 * DecompressionTimer Component
 *
 * Suggests a break duration based on burnout severity and tracks
 * time spent in decompression mode. Encourages users to take
 * adequate breaks before returning to work.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Clock, Play, Pause, SkipForward, CheckCircle, AlertCircle } from 'lucide-react';

// Suggested break durations based on burnout risk level
const SUGGESTED_DURATIONS = {
  critical: { minutes: 30, label: '30 min', description: 'A longer break is recommended for your burnout level.' },
  high: { minutes: 15, label: '15 min', description: 'Take time to properly decompress.' },
  moderate: { minutes: 10, label: '10 min', description: 'A short break to reset.' },
  low: { minutes: 5, label: '5 min', description: 'Quick mental reset.' }
};

// Quick preset options
const PRESET_OPTIONS = [
  { minutes: 5, label: '5 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' }
];

const DecompressionTimer = ({
  riskLevel = 'moderate',
  onComplete,
  onEarlyExit,
  minTimeRequired = 0 // Minimum time before exit allowed
}) => {
  const suggested = SUGGESTED_DURATIONS[riskLevel] || SUGGESTED_DURATIONS.moderate;

  const [selectedDuration, setSelectedDuration] = useState(suggested.minutes);
  const [remainingSeconds, setRemainingSeconds] = useState(suggested.minutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const totalSeconds = selectedDuration * 60;
  const progress = hasStarted ? (totalSeconds - remainingSeconds) / totalSeconds : 0;
  const canExit = elapsedSeconds >= minTimeRequired * 60;

  // Timer logic
  useEffect(() => {
    if (!isRunning || isComplete) return;

    const timer = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev <= 1) {
          setIsComplete(true);
          setIsRunning(false);
          if (onComplete) {
            onComplete({
              duration: selectedDuration,
              actualTime: elapsedSeconds + 1
            });
          }
          return 0;
        }
        return prev - 1;
      });

      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, isComplete, selectedDuration, elapsedSeconds, onComplete]);

  const handleStart = () => {
    setIsRunning(true);
    setHasStarted(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleResume = () => {
    setIsRunning(true);
  };

  const handleSelectDuration = (minutes) => {
    if (hasStarted) return; // Can't change once started
    setSelectedDuration(minutes);
    setRemainingSeconds(minutes * 60);
  };

  const handleEarlyExit = () => {
    if (!canExit) return;
    setIsRunning(false);
    if (onEarlyExit) {
      onEarlyExit({
        plannedDuration: selectedDuration,
        actualTime: elapsedSeconds
      });
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isComplete) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center p-6 text-center"
      >
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-4">
          <CheckCircle size={40} className="text-white" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          Break Complete
        </h3>
        <p className="text-white/70 mb-4">
          You took {selectedDuration} minutes to decompress.
        </p>
        <p className="text-white/60 text-sm mb-6 max-w-xs">
          Remember: regular breaks prevent burnout. You can always come back
          to Shelter Mode when you need it.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col items-center p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-white flex items-center justify-center gap-2">
          <Clock size={20} className="text-blue-400" />
          Decompression Timer
        </h3>
        <p className="text-white/60 text-sm mt-1">{suggested.description}</p>
      </div>

      {/* Timer Circle */}
      <div className="relative w-48 h-48 flex items-center justify-center mb-6">
        {/* Background circle */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-white/10"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="282.74"
            strokeDashoffset={282.74 * (1 - progress)}
            className="text-blue-500"
            initial={{ strokeDashoffset: 282.74 }}
            animate={{ strokeDashoffset: 282.74 * (1 - progress) }}
            transition={{ duration: 0.5 }}
          />
        </svg>

        {/* Time display */}
        <div className="text-center z-10">
          <div className="text-4xl font-mono font-bold text-white">
            {formatTime(remainingSeconds)}
          </div>
          <div className="text-white/50 text-sm mt-1">
            {hasStarted ? 'remaining' : 'selected'}
          </div>
        </div>
      </div>

      {/* Duration presets (only before starting) */}
      {!hasStarted && (
        <div className="flex gap-2 mb-6">
          {PRESET_OPTIONS.map(option => (
            <button
              key={option.minutes}
              onClick={() => handleSelectDuration(option.minutes)}
              className={`
                px-4 py-2 rounded-full text-sm font-medium transition-all
                ${selectedDuration === option.minutes
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
                }
                ${option.minutes === suggested.minutes ? 'ring-2 ring-blue-500/50' : ''}
              `}
            >
              {option.label}
              {option.minutes === suggested.minutes && (
                <span className="ml-1 text-xs opacity-70">rec</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        {!hasStarted ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-8 py-3 bg-blue-500 hover:bg-blue-600 rounded-full text-white font-medium transition-colors"
          >
            <Play size={20} />
            Start Break
          </button>
        ) : (
          <>
            <button
              onClick={isRunning ? handlePause : handleResume}
              className="flex items-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
            >
              {isRunning ? <Pause size={20} /> : <Play size={20} />}
              {isRunning ? 'Pause' : 'Resume'}
            </button>

            <button
              onClick={handleEarlyExit}
              disabled={!canExit}
              className={`
                flex items-center gap-2 px-4 py-3 rounded-full transition-colors
                ${canExit
                  ? 'bg-white/10 text-white/70 hover:bg-white/20'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
                }
              `}
            >
              <SkipForward size={18} />
              Exit Early
            </button>
          </>
        )}
      </div>

      {/* Minimum time warning */}
      {hasStarted && !canExit && minTimeRequired > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 mt-4 text-amber-400/80 text-sm"
        >
          <AlertCircle size={16} />
          <span>
            Please rest for at least {minTimeRequired} min before exiting
          </span>
        </motion.div>
      )}

      {/* Elapsed time (when paused) */}
      {hasStarted && !isRunning && (
        <p className="text-white/40 text-sm mt-4">
          Time elapsed: {formatTime(elapsedSeconds)}
        </p>
      )}
    </div>
  );
};

// Compact version for dashboard
export const DecompressionTimerCompact = ({ riskLevel, onStart }) => {
  const suggested = SUGGESTED_DURATIONS[riskLevel] || SUGGESTED_DURATIONS.moderate;

  return (
    <button
      onClick={onStart}
      className="flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-xl w-full text-left transition-colors"
    >
      <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
        <Clock size={24} className="text-blue-400" />
      </div>
      <div className="flex-1">
        <div className="text-white font-medium">Take a {suggested.label} Break</div>
        <div className="text-white/60 text-sm">{suggested.description}</div>
      </div>
    </button>
  );
};

export default DecompressionTimer;
