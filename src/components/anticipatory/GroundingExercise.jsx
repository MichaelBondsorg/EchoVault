/**
 * Grounding Exercise Component
 *
 * Interactive grounding exercises for anxiety reduction.
 * Supports multiple techniques:
 * - Box Breathing (4-4-4-4)
 * - 5-4-3-2-1 Sensory Grounding
 * - Quick Body Scan
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wind, Eye, Ear, Hand, Heart, Volume2 } from 'lucide-react';

const GroundingExercise = ({ type = 'box_breathing', onComplete, onSkip }) => {
  switch (type) {
    case 'box_breathing':
      return <BoxBreathing onComplete={onComplete} onSkip={onSkip} />;
    case 'five_senses':
      return <FiveSenses onComplete={onComplete} onSkip={onSkip} />;
    case 'body_scan':
      return <QuickBodyScan onComplete={onComplete} onSkip={onSkip} />;
    default:
      return <BoxBreathing onComplete={onComplete} onSkip={onSkip} />;
  }
};

/**
 * Box Breathing (4-4-4-4)
 */
const BoxBreathing = ({ onComplete, onSkip }) => {
  const [phase, setPhase] = useState('ready'); // ready, inhale, hold1, exhale, hold2, complete
  const [cycleCount, setCycleCount] = useState(0);
  const [countdown, setCountdown] = useState(4);
  const totalCycles = 3;

  const phaseLabels = {
    ready: 'Ready?',
    inhale: 'Breathe in',
    hold1: 'Hold',
    exhale: 'Breathe out',
    hold2: 'Hold',
    complete: 'Well done'
  };

  const phaseColors = {
    ready: 'bg-warm-100',
    inhale: 'bg-blue-100',
    hold1: 'bg-purple-100',
    exhale: 'bg-green-100',
    hold2: 'bg-amber-100',
    complete: 'bg-green-100'
  };

  useEffect(() => {
    if (phase === 'ready' || phase === 'complete') return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Move to next phase
          const phases = ['inhale', 'hold1', 'exhale', 'hold2'];
          const currentIndex = phases.indexOf(phase);
          const nextIndex = (currentIndex + 1) % phases.length;

          if (nextIndex === 0) {
            // Completed a cycle
            if (cycleCount + 1 >= totalCycles) {
              setPhase('complete');
              setTimeout(() => onComplete?.(), 1500);
            } else {
              setCycleCount(c => c + 1);
              setPhase(phases[0]);
            }
          } else {
            setPhase(phases[nextIndex]);
          }
          return 4;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, cycleCount, onComplete]);

  const startExercise = () => {
    setPhase('inhale');
    setCountdown(4);
  };

  const getCircleScale = () => {
    if (phase === 'inhale') return 1.3;
    if (phase === 'exhale') return 0.8;
    return 1;
  };

  return (
    <div className="text-center space-y-6">
      {/* Visual circle */}
      <div className="relative h-48 flex items-center justify-center">
        <motion.div
          animate={{ scale: getCircleScale() }}
          transition={{ duration: 4, ease: 'easeInOut' }}
          className={`w-32 h-32 rounded-full ${phaseColors[phase]} flex items-center justify-center`}
        >
          {phase === 'ready' ? (
            <Wind className="w-12 h-12 text-warm-400" />
          ) : phase === 'complete' ? (
            <span className="text-4xl">✨</span>
          ) : (
            <span className="text-4xl font-bold text-warm-700">{countdown}</span>
          )}
        </motion.div>
      </div>

      {/* Phase label */}
      <AnimatePresence mode="wait">
        <motion.p
          key={phase}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="text-xl font-medium text-warm-800"
        >
          {phaseLabels[phase]}
        </motion.p>
      </AnimatePresence>

      {/* Progress */}
      {phase !== 'ready' && phase !== 'complete' && (
        <p className="text-sm text-warm-500">
          Cycle {cycleCount + 1} of {totalCycles}
        </p>
      )}

      {/* Actions */}
      {phase === 'ready' && (
        <div className="space-y-3">
          <button
            onClick={startExercise}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600"
          >
            Start Breathing
          </button>
          <button
            onClick={onSkip}
            className="text-sm text-warm-400 hover:text-warm-600"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * 5-4-3-2-1 Sensory Grounding
 */
const FiveSenses = ({ onComplete, onSkip }) => {
  const [currentSense, setCurrentSense] = useState(0);
  const [inputs, setInputs] = useState({});

  const senses = [
    { id: 'see', count: 5, label: 'SEE', prompt: 'Name 5 things you can see', icon: Eye, color: 'blue' },
    { id: 'touch', count: 4, label: 'TOUCH', prompt: 'Name 4 things you can touch', icon: Hand, color: 'green' },
    { id: 'hear', count: 3, label: 'HEAR', prompt: 'Name 3 things you can hear', icon: Ear, color: 'purple' },
    { id: 'smell', count: 2, label: 'SMELL', prompt: 'Name 2 things you can smell', icon: Volume2, color: 'amber' },
    { id: 'taste', count: 1, label: 'TASTE', prompt: 'Name 1 thing you can taste', icon: Heart, color: 'rose' }
  ];

  const sense = senses[currentSense];
  const isComplete = currentSense >= senses.length;

  const handleNext = () => {
    if (currentSense < senses.length - 1) {
      setCurrentSense(prev => prev + 1);
    } else {
      onComplete?.();
    }
  };

  if (isComplete) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center p-6 bg-green-50 rounded-2xl"
      >
        <span className="text-4xl mb-4 block">🌟</span>
        <p className="text-green-800 font-medium">You're grounded!</p>
        <p className="text-green-600 text-sm mt-1">
          You've connected to the present moment.
        </p>
      </motion.div>
    );
  }

  const IconComponent = sense.icon;
  const colorClasses = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600', button: 'bg-blue-500 hover:bg-blue-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600', button: 'bg-green-500 hover:bg-green-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600', button: 'bg-purple-500 hover:bg-purple-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600', button: 'bg-amber-500 hover:bg-amber-600' },
    rose: { bg: 'bg-rose-100', text: 'text-rose-600', button: 'bg-rose-500 hover:bg-rose-600' }
  };
  const colors = colorClasses[sense.color];

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex justify-center gap-2">
        {senses.map((s, idx) => (
          <div
            key={s.id}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              idx < currentSense
                ? 'bg-green-500 text-white'
                : idx === currentSense
                  ? `${colors.bg} ${colors.text}`
                  : 'bg-warm-100 text-warm-400'
            }`}
          >
            {s.count}
          </div>
        ))}
      </div>

      {/* Current sense */}
      <AnimatePresence mode="wait">
        <motion.div
          key={sense.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="text-center"
        >
          <div className={`w-16 h-16 mx-auto rounded-full ${colors.bg} flex items-center justify-center mb-4`}>
            <IconComponent className={`w-8 h-8 ${colors.text}`} />
          </div>
          <h3 className="text-lg font-medium text-warm-800 mb-2">
            {sense.prompt}
          </h3>
          <p className="text-sm text-warm-500 mb-4">
            Take your time. Look around you.
          </p>

          {/* Input area */}
          <textarea
            value={inputs[sense.id] || ''}
            onChange={(e) => setInputs(prev => ({ ...prev, [sense.id]: e.target.value }))}
            placeholder={`1. ...\n2. ...\n3. ...`}
            className="w-full p-3 rounded-xl border border-warm-200 text-warm-800 placeholder-warm-400 focus:ring-2 focus:ring-warm-300"
            rows={sense.count <= 2 ? 2 : 4}
          />
        </motion.div>
      </AnimatePresence>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 py-3 rounded-xl bg-warm-100 text-warm-600 font-medium"
        >
          Skip
        </button>
        <button
          onClick={handleNext}
          className={`flex-1 py-3 rounded-xl text-white font-medium ${colors.button}`}
        >
          {currentSense === senses.length - 1 ? 'Complete' : 'Next'}
        </button>
      </div>
    </div>
  );
};

/**
 * Quick Body Scan
 */
const QuickBodyScan = ({ onComplete, onSkip }) => {
  const [currentArea, setCurrentArea] = useState(0);
  const [isScanning, setIsScanning] = useState(false);

  const bodyAreas = [
    { id: 'head', label: 'Head & Face', instruction: 'Notice any tension in your forehead, jaw, or eyes. Let it soften.' },
    { id: 'shoulders', label: 'Shoulders & Neck', instruction: 'Drop your shoulders away from your ears. Relax your neck.' },
    { id: 'chest', label: 'Chest & Heart', instruction: 'Notice your heartbeat. Take a slow breath into your chest.' },
    { id: 'stomach', label: 'Stomach & Core', instruction: 'Soften your belly. Let go of any holding.' },
    { id: 'hands', label: 'Hands & Arms', instruction: 'Unclench your fists. Let your arms rest heavy.' }
  ];

  const area = bodyAreas[currentArea];
  const progress = ((currentArea + 1) / bodyAreas.length) * 100;

  useEffect(() => {
    if (!isScanning) return;

    const timer = setInterval(() => {
      if (currentArea < bodyAreas.length - 1) {
        setCurrentArea(prev => prev + 1);
      } else {
        setIsScanning(false);
        setTimeout(() => onComplete?.(), 1000);
      }
    }, 5000); // 5 seconds per area

    return () => clearInterval(timer);
  }, [isScanning, currentArea, onComplete]);

  if (!isScanning && currentArea === 0) {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-100 flex items-center justify-center">
          <Heart className="w-8 h-8 text-purple-500" />
        </div>
        <div>
          <h3 className="text-lg font-medium text-warm-800 mb-2">
            Quick Body Scan
          </h3>
          <p className="text-sm text-warm-600">
            We'll move through 5 body areas, spending a few seconds on each.
            Just notice and release.
          </p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => setIsScanning(true)}
            className="w-full py-3 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600"
          >
            Start Scan
          </button>
          <button
            onClick={onSkip}
            className="text-sm text-warm-400 hover:text-warm-600"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="h-2 bg-warm-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-purple-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Current area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={area.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="text-center py-8"
        >
          <h3 className="text-xl font-medium text-purple-800 mb-4">
            {area.label}
          </h3>
          <p className="text-warm-600">
            {area.instruction}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Breathing indicator */}
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity }}
        className="w-20 h-20 mx-auto rounded-full bg-purple-100 flex items-center justify-center"
      >
        <span className="text-2xl">🫁</span>
      </motion.div>

      <p className="text-center text-sm text-warm-400">
        {currentArea + 1} of {bodyAreas.length}
      </p>
    </div>
  );
};

export default GroundingExercise;
