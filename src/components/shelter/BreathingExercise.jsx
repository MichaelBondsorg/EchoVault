/**
 * BreathingExercise Component
 *
 * Guided breathing exercises with visual animations:
 * - Box Breathing (4-4-4-4)
 * - 4-7-8 Technique
 * - Simple Deep Breathing
 *
 * Features animated circle that expands/contracts with breath phases.
 *
 * Restyle only (Task D4b, CLOUD-DESIGN-SPEC.md §7 "Breathing"/mockup 7i:
 * "circle grows & shrinks with the breath"). The phase/cycle state machine
 * (BREATHING_EXERCISES config, the countdown interval effect, handleStart/
 * handlePause/handleReset, and the onComplete/onSkip callbacks) is
 * byte-identical to the pre-Cloud version — only className/style output
 * changed.
 *
 * Functional-breathing-animation decision: the mockup's growing/shrinking
 * circle is the visual pacing cue, but this component's actual functional
 * pacing signal is the numeric `{countdown}` + phase-name text rendered
 * inside it — those stay static text, always visible, animation or not.
 * Per spec §1 ("Motion is ... always optional (prefers-reduced-motion)"),
 * the scale animation itself is gated off via framer-motion's
 * `useReducedMotion()` (already used elsewhere in the app, e.g.
 * DarkModeToggle.jsx) rather than left unconditional — with the countdown
 * number already providing an exact, fully static fallback, there's no
 * ambiguity here to escalate.
 *
 * The three exercises' distinct lavender/purple/sage colors collapsed onto
 * the single Cloud accent scale (accent-3 -> accent gradient, matching
 * Pebble's own blob recipe), consistent with the "ONE user-selectable
 * accent" precedent already applied to InsightsPage (C5) and
 * UnifiedConversation (D1). The `color` field on each exercise config is
 * left in place (unused by rendering now, but part of the untouched data
 * shape) rather than deleted, to keep the config object byte-identical.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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

// Cloud blob recipe (matches Pebble.jsx §6.3) — every exercise shares the
// single accent scale rather than a per-exercise hue.
const CIRCLE_GRADIENT_STYLE = { background: 'linear-gradient(160deg, var(--accent-3), var(--accent))' };

const BreathingExercise = ({
  exerciseType = 'box',
  onComplete,
  onSkip,
  compact = false
}) => {
  const exercise = BREATHING_EXERCISES[exerciseType] || BREATHING_EXERCISES.box;
  const prefersReducedMotion = useReducedMotion();

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
    if (prefersReducedMotion) return 1;
    if (!isRunning) return 1;
    if (currentPhase.action === 'expand') return 1.4;
    if (currentPhase.action === 'contract') return 0.7;
    return 1; // hold
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
      />
    );
  }

  return (
    <div className="flex flex-col items-center p-6">
      {/* Exercise Info */}
      <div className="text-center mb-6">
        <h3 className="text-xl font-display font-medium text-foreground">{exercise.name}</h3>
        <p className="text-muted-foreground text-sm mt-1 max-w-xs">{exercise.description}</p>
      </div>

      {/* Breathing Circle */}
      <div className="relative w-64 h-64 flex items-center justify-center mb-8">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-2 border-border" />

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
            className="text-border"
          />
        </svg>

        {/* Animated breathing circle */}
        <motion.div
          animate={{
            scale: getCircleScale(),
            transition: { duration: currentPhase?.duration || 4, ease: 'easeInOut' }
          }}
          className="w-40 h-40 rounded-full flex items-center justify-center shadow-soft-lg"
          style={CIRCLE_GRADIENT_STYLE}
        >
          {completed ? (
            <Check size={48} className="text-foreground dark:text-background" />
          ) : (
            <div className="text-center">
              <div className="text-4xl font-semibold text-foreground dark:text-background">{countdown}</div>
              <div className="text-foreground dark:text-background text-sm mt-1">
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
              idx < currentCycle ? 'bg-accent' : 'bg-divider'
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
                className="flex items-center gap-2 px-6 py-3 bg-card border border-border hover:bg-divider rounded-full text-foreground transition-colors"
              >
                <Pause size={20} />
                Pause
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="flex items-center gap-2 px-6 py-3 bg-primary hover:opacity-90 rounded-full text-primary-foreground font-medium transition-colors"
              >
                <Play size={20} />
                {currentPhaseIndex === 0 && currentCycle === 1 ? 'Start' : 'Resume'}
              </button>
            )}

            <button
              onClick={handleReset}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 px-4 py-3 bg-card border border-border hover:bg-divider rounded-full text-muted-foreground transition-colors"
            >
              <RotateCcw size={18} />
            </button>
          </>
        )}

        {completed && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 bg-primary hover:opacity-90 rounded-full text-primary-foreground font-medium transition-colors"
          >
            <RotateCcw size={20} />
            Do Another Round
          </button>
        )}

        {onSkip && !completed && (
          <button
            onClick={onSkip}
            className="px-4 py-3 text-muted-foreground hover:text-foreground text-sm transition-colors"
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
          className="text-muted-foreground text-center mt-6"
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
  getCircleScale
}) => (
  <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl">
    <motion.div
      animate={{
        scale: isRunning ? getCircleScale() : 1,
        transition: { duration: currentPhase?.duration || 4, ease: 'easeInOut' }
      }}
      className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0"
      style={CIRCLE_GRADIENT_STYLE}
    >
      {completed ? (
        <Check size={24} className="text-foreground dark:text-background" />
      ) : (
        <span className="text-xl font-semibold text-foreground dark:text-background">{countdown}</span>
      )}
    </motion.div>

    <div className="flex-1">
      <div className="text-foreground font-medium">{exercise.name}</div>
      <div className="text-muted-foreground text-sm">
        {completed ? 'Complete!' : `${currentPhase?.name} - Cycle ${currentCycle}/${exercise.cycles}`}
      </div>
    </div>

    <div className="flex gap-2">
      {!completed && (
        <button
          onClick={isRunning ? onPause : onStart}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-card border border-border hover:bg-divider text-foreground transition-colors"
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} />}
        </button>
      )}
      <button
        onClick={onReset}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-card border border-border hover:bg-divider text-muted-foreground transition-colors"
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
            ? 'bg-accent-wash border-2 border-accent'
            : 'bg-card border-2 border-border hover:bg-divider'
          }
        `}
      >
        <Wind className="text-accent-deep" size={24} />
        <div>
          <div className="text-foreground font-medium">{exercise.name}</div>
          <div className="text-muted-foreground text-sm">{exercise.description}</div>
        </div>
      </button>
    ))}
  </div>
);

export default BreathingExercise;
