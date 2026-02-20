/**
 * BreathingExercise Component
 *
 * Guided breathing exercises with visual animations:
 * - Box Breathing (4-4-4-4)
 * - 4-7-8 Technique
 * - Simple Deep Breathing
 *
 * Features animated circle that expands/contracts with breath phases.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, RotateCcw, Wind, Check } from 'lucide-react';

// Breathing exercise configurations
const BREATHING_EXERCISES = {
  box: {
    name: 'Box Breathing',
    description: 'Equal inhale, hold, exhale, hold. Used by Navy SEALs for calm under pressure.',
    phases: [
      { name: 'Inhale', duration: 4, action: 'expand' },
      { name: 'Hold', duration: 4, action: 'hold' },
      { name: 'Exhale', duration: 4, action: 'contract' },
      { name: 'Hold', duration: 4, action: 'hold' }
    ],
    cycles: 4,
    color: 'blue'
  },
  relaxing: {
    name: '4-7-8 Relaxing',
    description: 'Calming technique that activates the parasympathetic nervous system.',
    phases: [
      { name: 'Inhale', duration: 4, action: 'expand' },
      { name: 'Hold', duration: 7, action: 'hold' },
      { name: 'Exhale', duration: 8, action: 'contract' }
    ],
    cycles: 4,
    color: 'purple'
  },
  simple: {
    name: 'Simple Deep Breathing',
    description: 'Gentle deep breaths to reset your nervous system.',
    phases: [
      { name: 'Breathe In', duration: 4, action: 'expand' },
      { name: 'Breathe Out', duration: 6, action: 'contract' }
    ],
    cycles: 6,
    color: 'teal'
  }
};

const BreathingExercise = ({
  exerciseType = 'box',
  onComplete,
  onSkip,
  compact = false
}) => {
  const exercise = BREATHING_EXERCISES[exerciseType] || BREATHING_EXERCISES.box;

  const [isRunning, setIsRunning] = useState(false);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [countdown, setCountdown] = useState(exercise.phases[0].duration);
  const [completed, setCompleted] = useState(false);

  const currentPhase = exercise.phases[currentPhaseIndex];
  const totalPhases = exercise.phases.length;
  const progress = ((currentCycle - 1) / exercise.cycles) +
                   ((currentPhaseIndex + 1) / totalPhases / exercise.cycles);

  // Timer logic
  useEffect(() => {
    if (!isRunning || completed) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Move to next phase
          const nextPhaseIndex = (currentPhaseIndex + 1) % totalPhases;
          const isNewCycle = nextPhaseIndex === 0;

          if (isNewCycle) {
            if (currentCycle >= exercise.cycles) {
              // Exercise complete
              setCompleted(true);
              setIsRunning(false);
              if (onComplete) onComplete({ exerciseType, cycles: exercise.cycles });
              return 0;
            }
            setCurrentCycle(c => c + 1);
          }

          setCurrentPhaseIndex(nextPhaseIndex);
          return exercise.phases[nextPhaseIndex].duration;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning, currentPhaseIndex, currentCycle, completed, exercise, onComplete, exerciseType, totalPhases]);

  const handleStart = () => setIsRunning(true);
  const handlePause = () => setIsRunning(false);

  const handleReset = () => {
    setIsRunning(false);
    setCurrentPhaseIndex(0);
    setCurrentCycle(1);
    setCountdown(exercise.phases[0].duration);
    setCompleted(false);
  };

  const getCircleScale = () => {
    if (!isRunning) return 1;
    if (currentPhase.action === 'expand') return 1.4;
    if (currentPhase.action === 'contract') return 0.7;
    return 1; // hold
  };

  const getCircleColor = () => {
    const colors = {
      blue: 'from-blue-500 to-blue-700',
      purple: 'from-purple-500 to-purple-700',
      teal: 'from-teal-500 to-teal-700'
    };
    return colors[exercise.color] || colors.blue;
  };

  if (compact) {
    return (
      <CompactBreathingExercise
        exercise={exercise}
        isRunning={isRunning}
        currentPhase={currentPhase}
        countdown={countdown}
        currentCycle={currentCycle}
        completed={completed}
        onStart={handleStart}
        onPause={handlePause}
        onReset={handleReset}
        onSkip={onSkip}
        getCircleScale={getCircleScale}
        getCircleColor={getCircleColor}
      />
    );
  }

  return (
    <div className="flex flex-col items-center p-6">
      {/* Exercise Info */}
      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-white">{exercise.name}</h3>
        <p className="text-white/60 text-sm mt-1 max-w-xs">{exercise.description}</p>
      </div>

      {/* Breathing Circle */}
      <div className="relative w-64 h-64 flex items-center justify-center mb-8">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />

        {/* Progress ring */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${progress * 301.59} 301.59`}
            className="text-white/30"
          />
        </svg>

        {/* Animated breathing circle */}
        <motion.div
          animate={{
            scale: getCircleScale(),
            transition: { duration: currentPhase?.duration || 4, ease: 'easeInOut' }
          }}
          className={`
            w-40 h-40 rounded-full bg-gradient-to-br ${getCircleColor()}
            flex items-center justify-center shadow-lg
          `}
        >
          {completed ? (
            <Check size={48} className="text-white" />
          ) : (
            <div className="text-center">
              <div className="text-4xl font-bold text-white">{countdown}</div>
              <div className="text-white/80 text-sm mt-1">
                {currentPhase?.name}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Cycle indicator */}
      <div className="flex gap-2 mb-6">
        {Array.from({ length: exercise.cycles }).map((_, idx) => (
          <div
            key={idx}
            className={`w-2 h-2 rounded-full transition-colors ${
              idx < currentCycle ? 'bg-white' : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!completed && (
          <>
            {isRunning ? (
              <button
                onClick={handlePause}
                className="flex items-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
              >
                <Pause size={20} />
                Pause
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 rounded-full text-gray-900 font-medium transition-colors"
              >
                <Play size={20} />
                {currentPhaseIndex === 0 && currentCycle === 1 ? 'Start' : 'Resume'}
              </button>
            )}

            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
            >
              <RotateCcw size={18} />
            </button>
          </>
        )}

        {completed && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 rounded-full text-gray-900 font-medium transition-colors"
          >
            <RotateCcw size={20} />
            Do Another Round
          </button>
        )}

        {onSkip && !completed && (
          <button
            onClick={onSkip}
            className="px-4 py-3 text-white/50 hover:text-white/70 text-sm transition-colors"
          >
            Skip
          </button>
        )}
      </div>

      {/* Completion message */}
      {completed && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-white/80 text-center mt-6"
        >
          Great job! You completed {exercise.cycles} cycles of {exercise.name}.
        </motion.p>
      )}
    </div>
  );
};

// Compact version for inline use
const CompactBreathingExercise = ({
  exercise,
  isRunning,
  currentPhase,
  countdown,
  currentCycle,
  completed,
  onStart,
  onPause,
  onReset,
  onSkip,
  getCircleScale,
  getCircleColor
}) => (
  <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
    <motion.div
      animate={{
        scale: isRunning ? getCircleScale() : 1,
        transition: { duration: currentPhase?.duration || 4, ease: 'easeInOut' }
      }}
      className={`
        w-16 h-16 rounded-full bg-gradient-to-br ${getCircleColor()}
        flex items-center justify-center flex-shrink-0
      `}
    >
      {completed ? (
        <Check size={24} className="text-white" />
      ) : (
        <span className="text-xl font-bold text-white">{countdown}</span>
      )}
    </motion.div>

    <div className="flex-1">
      <div className="text-white font-medium">{exercise.name}</div>
      <div className="text-white/60 text-sm">
        {completed ? 'Complete!' : `${currentPhase?.name} - Cycle ${currentCycle}/${exercise.cycles}`}
      </div>
    </div>

    <div className="flex gap-2">
      {!completed && (
        <button
          onClick={isRunning ? onPause : onStart}
          className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} />}
        </button>
      )}
      <button
        onClick={onReset}
        className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white/70 transition-colors"
      >
        <RotateCcw size={18} />
      </button>
    </div>
  </div>
);

// Exercise selector component
export const BreathingExerciseSelector = ({ onSelect, selected }) => (
  <div className="grid gap-3">
    {Object.entries(BREATHING_EXERCISES).map(([key, exercise]) => (
      <button
        key={key}
        onClick={() => onSelect(key)}
        className={`
          flex items-center gap-3 p-4 rounded-xl text-left transition-all
          ${selected === key
            ? 'bg-white/20 border-2 border-white/40'
            : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
          }
        `}
      >
        <Wind className={exercise.color === 'blue' ? 'text-blue-400' : exercise.color === 'purple' ? 'text-purple-400' : 'text-teal-400'} size={24} />
        <div>
          <div className="text-white font-medium">{exercise.name}</div>
          <div className="text-white/60 text-sm">{exercise.description}</div>
        </div>
      </button>
    ))}
  </div>
);

export default BreathingExercise;
