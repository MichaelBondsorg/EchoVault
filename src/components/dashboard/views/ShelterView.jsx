import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Mic, MessageCircle, Leaf, X, Anchor, ArrowLeft, Check, Wind, Clock, AlertTriangle, Shield } from 'lucide-react';
import BreathingExercise, { BreathingExerciseSelector } from '../../shelter/BreathingExercise';
import GroundingExercise from '../../shelter/GroundingExercise';
import DecompressionTimer from '../../shelter/DecompressionTimer';

/**
 * ShelterView - Minimalist, soothing view for low mood and burnout states
 *
 * Triggers:
 * - mood_score < 0.35 (original reactive trigger)
 * - burnoutRisk.riskLevel === 'critical' (burnout-specific)
 * - Declining mood + high burnout + fatigue tags
 *
 * Design Philosophy:
 * - Remove Stats / Streaks / Tasks (reduce pressure)
 * - Warmer, softer colors
 * - Validation-first messaging
 * - Primary actions: "Vent" (voice recorder), "Drop Anchor" (grounding exercise)
 * - NEW: Burnout-specific decompression tools
 *
 * Content:
 * - Hero: Contextual validation based on trigger type
 * - Burnout Context: Show detected signals if burnout-triggered
 * - Action: "Vent" button (voice recorder auto-start)
 * - Action: "Drop Anchor" / Grounding exercises
 * - Action: Breathing exercises
 * - Action: Decompression timer
 * - Resource: CBT reframe if available
 * - Exit: Option to return to normal view (with exit criteria)
 *
 * Props:
 * - cbtReframe: string | null - Perspective from challenges
 * - burnoutRisk: object | null - Burnout risk assessment
 * - triggerType: 'low_mood' | 'burnout' | 'manual' - What triggered shelter mode
 * - onVent: () => void - Start voice recording
 * - onTextEntry: () => void - Alternative text entry
 * - onExit: () => void - Return to normal view
 * - onActivityComplete: (activity) => void - Track completed activities
 */

// Drop Anchor Exercise Component
const DropAnchorExercise = ({ onComplete, onBack }) => {
  const [step, setStep] = useState(0); // 0: intro, 1: acknowledge, 2: connect, 3: engage
  const [feeling, setFeeling] = useState('');
  const [breathCount, setBreathCount] = useState(0);
  const [showNextButton, setShowNextButton] = useState(false);

  // Auto-advance timer for breathing step
  useEffect(() => {
    if (step === 2) {
      setShowNextButton(false);
      const breathInterval = setInterval(() => {
        setBreathCount(prev => {
          if (prev >= 3) {
            clearInterval(breathInterval);
            setShowNextButton(true);
            return prev;
          }
          return prev + 1;
        });
      }, 4000); // 4 seconds per breath cycle

      return () => clearInterval(breathInterval);
    }
  }, [step]);

  const renderStep = () => {
    switch (step) {
      case 0: // Intro
        return (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-center space-y-4"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sage-100 dark:bg-sage-900/30 mb-2">
              <Anchor size={32} className="text-sage-600 dark:text-sage-400" />
            </div>
            <h3 className="text-xl font-display font-bold text-sage-800 dark:text-sage-200">
              Drop Anchor
            </h3>
            <p className="text-sm font-body text-sage-600 dark:text-sage-400 leading-relaxed max-w-xs mx-auto">
              A quick grounding exercise to help you stay present when emotions feel overwhelming.
            </p>
            <p className="text-xs text-sage-500 dark:text-sage-400 italic">Takes about 1-2 minutes</p>
            <motion.button
              onClick={() => setStep(1)}
              className="mt-4 bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Let's Begin
            </motion.button>
          </motion.div>
        );

      case 1: // Acknowledge
        return (
          <motion.div
            key="acknowledge"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="text-center">
              <span className="text-xs font-bold text-sage-600 dark:text-sage-400 uppercase tracking-wider">Step 1 of 3</span>
              <h3 className="text-lg font-display font-bold text-sage-800 dark:text-sage-200 mt-1">
                Acknowledge
              </h3>
            </div>
            <p className="text-sm font-body text-sage-700 dark:text-sage-300 text-center">
              What's the hardest feeling showing up right now? Just name it - no need to fix it.
            </p>
            <input
              type="text"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g., anxiety, sadness, frustration..."
              className="w-full p-3 rounded-xl border border-sage-200 dark:border-sage-700 focus:border-sage-400 dark:focus:border-sage-600 focus:ring-2 focus:ring-sage-100 dark:focus:ring-sage-900/30 outline-none text-sm font-body dark:bg-hearth-800 dark:text-warm-200 dark:placeholder-warm-500"
              autoFocus
            />
            <motion.button
              onClick={() => setStep(2)}
              disabled={!feeling.trim()}
              className={`w-full py-3 rounded-xl font-semibold transition-all ${
                feeling.trim()
                  ? 'bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700 text-white'
                  : 'bg-sage-100 dark:bg-sage-800 text-sage-400 dark:text-sage-500 cursor-not-allowed'
              }`}
              whileHover={feeling.trim() ? { scale: 1.01 } : {}}
              whileTap={feeling.trim() ? { scale: 0.99 } : {}}
            >
              I've named it
            </motion.button>
          </motion.div>
        );

      case 2: // Connect
        return (
          <motion.div
            key="connect"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4 text-center"
          >
            <div>
              <span className="text-xs font-bold text-sage-600 dark:text-sage-400 uppercase tracking-wider">Step 2 of 3</span>
              <h3 className="text-lg font-display font-bold text-sage-800 dark:text-sage-200 mt-1">
                Connect
              </h3>
            </div>
            <p className="text-sm font-body text-sage-700 dark:text-sage-300">
              Press your feet firmly into the floor. Feel the ground beneath you.
            </p>

            {/* Breathing animation */}
            <div className="flex justify-center py-6">
              <motion.div
                className="w-24 h-24 rounded-full bg-gradient-to-br from-sage-200 to-sage-400 dark:from-sage-700 dark:to-sage-500 flex items-center justify-center"
                animate={{
                  scale: [1, 1.3, 1],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                <span className="text-white font-display font-bold text-sm">
                  {breathCount < 3 ? 'Breathe' : 'Done'}
                </span>
              </motion.div>
            </div>

            <p className="text-xs text-sage-500 dark:text-sage-400">
              {breathCount < 3
                ? `Breath ${breathCount + 1} of 3...`
                : 'Great job staying present.'}
            </p>

            {showNextButton && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setStep(3)}
                className="bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Next
              </motion.button>
            )}
          </motion.div>
        );

      case 3: // Engage
        return (
          <motion.div
            key="engage"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4 text-center"
          >
            <div>
              <span className="text-xs font-bold text-sage-600 dark:text-sage-400 uppercase tracking-wider">Step 3 of 3</span>
              <h3 className="text-lg font-display font-bold text-sage-800 dark:text-sage-200 mt-1">
                Engage
              </h3>
            </div>
            <p className="text-sm font-body text-sage-700 dark:text-sage-300">
              Look around the room. Name 3 things you can see right now.
            </p>

            <div className="bg-sage-50 dark:bg-sage-950/20 rounded-xl p-4 text-left space-y-2">
              <p className="text-xs text-sage-600 dark:text-sage-400 font-semibold uppercase">Look for:</p>
              <ul className="text-sm text-sage-700 dark:text-sage-300 space-y-1 font-body">
                <li>• Something with an interesting texture</li>
                <li>• Something that has a color you like</li>
                <li>• Something that's been there a while</li>
              </ul>
            </div>

            <p className="text-xs text-sage-500 dark:text-sage-400 italic">
              Take your time. There's no rush.
            </p>

            <motion.button
              onClick={onComplete}
              className="bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2 w-full"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <Check size={18} />
              Done
            </motion.button>
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-sage-500 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>Back to menu</span>
      </button>

      {/* Exercise container */}
      <div className="bg-gradient-to-br from-sage-50 via-sage-100 to-sage-50 dark:from-sage-950/20 dark:via-sage-900/20 dark:to-sage-950/20 rounded-3xl p-6 border border-sage-100 dark:border-sage-800 shadow-soft">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </div>

      {/* Progress indicator */}
      {step > 0 && (
        <div className="flex justify-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s <= step ? 'bg-sage-500 dark:bg-sage-400' : 'bg-sage-200 dark:bg-sage-700'
              }`}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
};

const ShelterView = ({
  cbtReframe,
  burnoutRisk = null,
  triggerType = 'low_mood',
  onVent,
  onTextEntry,
  onExit,
  onActivityComplete
}) => {
  const [mode, setMode] = useState('menu'); // 'menu' | 'anchor' | 'breathing' | 'grounding' | 'timer'
  const [selectedBreathingType, setSelectedBreathingType] = useState('box');
  const [completedActivities, setCompletedActivities] = useState([]);

  const isBurnoutTrigger = triggerType === 'burnout' || burnoutRisk?.riskLevel === 'critical';
  const riskLevel = burnoutRisk?.riskLevel || 'moderate';

  const handleActivityComplete = (activity) => {
    setCompletedActivities(prev => [...prev, activity]);
    if (onActivityComplete) onActivityComplete(activity);
    setMode('menu');
  };

  const handleAnchorComplete = () => {
    handleActivityComplete({ type: 'anchor', completedAt: new Date() });
  };

  const handleBreathingComplete = (result) => {
    handleActivityComplete({ type: 'breathing', ...result, completedAt: new Date() });
  };

  const handleGroundingComplete = (result) => {
    handleActivityComplete({ type: 'grounding', ...result, completedAt: new Date() });
  };

  const handleTimerComplete = (result) => {
    handleActivityComplete({ type: 'timer', ...result, completedAt: new Date() });
  };

  // Exit criteria: must complete at least 1 activity for burnout triggers
  const canExit = !isBurnoutTrigger || completedActivities.length >= 1;

  // Render specific modes
  if (mode === 'anchor') {
    return (
      <DropAnchorExercise
        onComplete={handleAnchorComplete}
        onBack={() => setMode('menu')}
      />
    );
  }

  if (mode === 'breathing') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        <button
          onClick={() => setMode('menu')}
          className="flex items-center gap-1.5 text-xs text-lavender-500 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to menu</span>
        </button>
        <div className="bg-gradient-to-br from-lavender-900/50 to-lavender-950/50 dark:from-lavender-950/50 dark:to-hearth-950/50 rounded-3xl border border-lavender-500/30 dark:border-lavender-600/30">
          <BreathingExercise
            exerciseType={selectedBreathingType}
            onComplete={handleBreathingComplete}
            onSkip={() => setMode('menu')}
          />
        </div>
      </motion.div>
    );
  }

  if (mode === 'grounding') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        <button
          onClick={() => setMode('menu')}
          className="flex items-center gap-1.5 text-xs text-lavender-600 hover:text-lavender-800 dark:text-lavender-400 dark:hover:text-lavender-300 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to menu</span>
        </button>
        <div className="bg-gradient-to-br from-lavender-800/50 to-lavender-950/50 dark:from-lavender-900/50 dark:to-hearth-950/50 rounded-3xl border border-lavender-500/30 dark:border-lavender-600/30">
          <GroundingExercise
            onComplete={handleGroundingComplete}
            onSkip={() => setMode('menu')}
          />
        </div>
      </motion.div>
    );
  }

  if (mode === 'timer') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        <button
          onClick={() => setMode('menu')}
          className="flex items-center gap-1.5 text-xs text-lavender-500 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to menu</span>
        </button>
        <div className="bg-gradient-to-br from-hearth-800/80 to-hearth-900/80 dark:from-hearth-900/80 dark:to-hearth-950/80 rounded-3xl border border-white/10">
          <DecompressionTimer
            riskLevel={riskLevel}
            onComplete={handleTimerComplete}
            onEarlyExit={(result) => {
              handleActivityComplete({ type: 'timer_early', ...result, completedAt: new Date() });
            }}
            minTimeRequired={isBurnoutTrigger ? 5 : 0}
          />
        </div>
      </motion.div>
    );
  }

  if (mode === 'breathing-select') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        <button
          onClick={() => setMode('menu')}
          className="flex items-center gap-1.5 text-xs text-lavender-500 hover:text-lavender-700 dark:text-lavender-400 dark:hover:text-lavender-300 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to menu</span>
        </button>
        <div className="bg-gradient-to-br from-lavender-900/30 to-lavender-950/30 dark:from-lavender-950/30 dark:to-hearth-950/30 rounded-3xl p-6 border border-lavender-500/20 dark:border-lavender-600/20">
          <h3 className="text-lg font-semibold text-white mb-4">Choose a Breathing Exercise</h3>
          <BreathingExerciseSelector
            selected={selectedBreathingType}
            onSelect={(type) => {
              setSelectedBreathingType(type);
              setMode('breathing');
            }}
          />
        </div>
      </motion.div>
    );
  }

  // Main menu
  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Exit button - subtle, top right */}
      <div className="flex justify-between items-center">
        {/* Activity progress */}
        {isBurnoutTrigger && completedActivities.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-sage-400 dark:text-sage-300">
            <Check size={12} />
            <span>{completedActivities.length} activity completed</span>
          </div>
        )}
        <div className="flex-1" />
        <motion.button
          onClick={onExit}
          disabled={!canExit}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            canExit
              ? 'text-warm-400 hover:text-warm-600 hover:bg-warm-100 dark:text-warm-500 dark:hover:text-warm-300 dark:hover:bg-hearth-800'
              : 'text-warm-300 dark:text-warm-600 cursor-not-allowed'
          }`}
          whileHover={canExit ? { scale: 1.02 } : {}}
          whileTap={canExit ? { scale: 0.98 } : {}}
        >
          <X size={12} />
          <span>Return to normal view</span>
        </motion.button>
      </div>

      {/* Burnout Context - Show if burnout-triggered */}
      {isBurnoutTrigger && burnoutRisk && (
        <motion.div
          className="bg-gradient-to-br from-honey-900/30 to-red-900/30 rounded-2xl p-4 border border-honey-500/30"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-honey-400" />
            <span className="text-sm font-semibold text-honey-200">Burnout Signals Detected</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {burnoutRisk.signals?.slice(0, 4).map((signal, idx) => (
              <span
                key={idx}
                className="px-2 py-1 bg-black/30 rounded-full text-xs text-honey-100"
              >
                {signal.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {!canExit && (
            <p className="text-xs text-honey-200/70 mt-3">
              Please complete at least one decompression activity before exiting.
            </p>
          )}
        </motion.div>
      )}

      {/* Hero - Contextual validation */}
      <motion.div
        className={`rounded-3xl p-6 border shadow-soft text-center ${
          isBurnoutTrigger
            ? 'bg-gradient-to-br from-honey-50 via-honey-100 to-warm-50 dark:from-honey-900/20 dark:via-honey-950/20 dark:to-hearth-900 border-honey-200 dark:border-honey-700'
            : 'bg-gradient-to-br from-terra-50 via-terra-100 to-warm-50 dark:from-terra-900/20 dark:via-terra-950/20 dark:to-hearth-900 border-terra-100 dark:border-terra-800'
        }`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-4 ${
          isBurnoutTrigger ? 'bg-honey-100 dark:bg-honey-900/30' : 'bg-terra-100 dark:bg-terra-900/30'
        }`}>
          {isBurnoutTrigger ? (
            <Shield size={24} className="text-honey-500 dark:text-honey-400" />
          ) : (
            <Heart size={24} className="text-terra-400 dark:text-terra-500" />
          )}
        </div>

        <h2 className={`text-xl font-display font-bold mb-2 ${
          isBurnoutTrigger ? 'text-honey-800 dark:text-honey-200' : 'text-terra-800 dark:text-terra-200'
        }`}>
          {isBurnoutTrigger
            ? "Time to decompress."
            : "It's okay to have a hard day."
          }
        </h2>

        <p className={`text-sm font-body leading-relaxed max-w-xs mx-auto ${
          isBurnoutTrigger ? 'text-honey-700 dark:text-honey-300' : 'text-terra-600 dark:text-terra-400'
        }`}>
          {isBurnoutTrigger
            ? "Your mind and body are sending signals. Let's take a moment to reset."
            : "Sometimes we just need to let it out. No judgment here."
          }
        </p>
      </motion.div>

      {/* Primary Action - Vent (Voice) */}
      <motion.button
        onClick={onVent}
        className="w-full bg-terra-500 hover:bg-terra-600 dark:bg-terra-600 dark:hover:bg-terra-700 text-white rounded-2xl p-5 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transition-all"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <Mic size={20} />
        </div>
        <div className="text-left">
          <span className="font-display font-semibold text-lg block">Vent</span>
          <span className="text-terra-100 dark:text-terra-200 text-sm font-body">Let it all out</span>
        </div>
      </motion.button>

      {/* Decompression Tools Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Text Entry */}
        <motion.button
          onClick={onTextEntry}
          className="bg-warm-100 hover:bg-warm-200 dark:bg-hearth-800 dark:hover:bg-hearth-700 text-warm-700 dark:text-warm-300 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <MessageCircle size={20} />
          <span className="font-medium text-sm">Write it down</span>
        </motion.button>

        {/* Breathing Exercise */}
        <motion.button
          onClick={() => setMode('breathing-select')}
          className="bg-lavender-100 hover:bg-lavender-200 text-lavender-700 dark:bg-lavender-900/30 dark:hover:bg-lavender-800/40 dark:text-lavender-300 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Wind size={20} />
          <span className="font-medium text-sm">Breathing</span>
        </motion.button>

        {/* 5-4-3-2-1 Grounding */}
        <motion.button
          onClick={() => setMode('grounding')}
          className="bg-lavender-200 hover:bg-lavender-300 text-lavender-800 dark:bg-lavender-800/30 dark:hover:bg-lavender-700/40 dark:text-lavender-300 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Anchor size={20} />
          <span className="font-medium text-sm">5-4-3-2-1</span>
        </motion.button>

        {/* Decompression Timer */}
        <motion.button
          onClick={() => setMode('timer')}
          className="bg-sage-100 hover:bg-sage-200 text-sage-700 dark:bg-sage-900/30 dark:hover:bg-sage-800/40 dark:text-sage-300 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Clock size={20} />
          <span className="font-medium text-sm">Take a Break</span>
        </motion.button>
      </div>

      {/* Drop Anchor - Classic ACT */}
      <motion.button
        onClick={() => setMode('anchor')}
        className="w-full bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-700 text-white rounded-2xl p-4 flex items-center justify-center gap-3 transition-all"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <Anchor size={20} />
        <span className="font-medium">Drop Anchor (ACT Grounding)</span>
      </motion.button>

      {/* CBT Reframe - If available */}
      {cbtReframe && (
        <motion.div
          className="bg-white dark:bg-hearth-850 rounded-2xl p-5 border border-warm-100 dark:border-hearth-700 shadow-sm"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Leaf size={16} className="text-sage-500 dark:text-sage-400" />
            <span className="text-xs font-semibold text-warm-600 dark:text-warm-400 uppercase tracking-wide">
              A different perspective
            </span>
          </div>
          <p className="text-sm font-body text-warm-700 dark:text-warm-300 leading-relaxed italic">
            "{cbtReframe}"
          </p>
        </motion.div>
      )}

      {/* Gentle reminder */}
      <motion.p
        className="text-center text-xs text-warm-400 dark:text-warm-500 font-body px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      >
        {isBurnoutTrigger
          ? "Take your time. Your wellbeing matters more than productivity right now."
          : "This view appears when you might need extra support. You can always return to the regular dashboard."
        }
      </motion.p>
    </motion.div>
  );
};

export default ShelterView;
