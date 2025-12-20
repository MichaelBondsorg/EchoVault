import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Mic, MessageCircle, Leaf, X, Anchor, ArrowLeft, Check } from 'lucide-react';

/**
 * ShelterView - Minimalist, soothing view for low mood states
 *
 * Trigger: mood_score < 0.35
 *
 * Design Philosophy:
 * - Remove Stats / Streaks / Tasks (reduce pressure)
 * - Warmer, softer colors
 * - Validation-first messaging
 * - Primary actions: "Vent" (voice recorder), "Drop Anchor" (grounding exercise)
 *
 * Content:
 * - Hero: "It's okay to have a hard day." (Validation)
 * - Action: "Vent" button (voice recorder auto-start)
 * - Action: "Drop Anchor" button (ACT grounding exercise)
 * - Resource: CBT reframe if available
 * - Exit: Option to return to normal view
 *
 * Props:
 * - cbtReframe: string | null - Perspective from challenges
 * - onVent: () => void - Start voice recording
 * - onTextEntry: () => void - Alternative text entry
 * - onExit: () => void - Return to normal view
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-100 mb-2">
              <Anchor size={32} className="text-teal-600" />
            </div>
            <h3 className="text-xl font-display font-bold text-teal-800">
              Drop Anchor
            </h3>
            <p className="text-sm font-body text-teal-600 leading-relaxed max-w-xs mx-auto">
              A quick grounding exercise to help you stay present when emotions feel overwhelming.
            </p>
            <p className="text-xs text-teal-500 italic">Takes about 1-2 minutes</p>
            <motion.button
              onClick={() => setStep(1)}
              className="mt-4 bg-teal-500 hover:bg-teal-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
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
              <span className="text-xs font-bold text-teal-600 uppercase tracking-wider">Step 1 of 3</span>
              <h3 className="text-lg font-display font-bold text-teal-800 mt-1">
                Acknowledge
              </h3>
            </div>
            <p className="text-sm font-body text-teal-700 text-center">
              What's the hardest feeling showing up right now? Just name it - no need to fix it.
            </p>
            <input
              type="text"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g., anxiety, sadness, frustration..."
              className="w-full p-3 rounded-xl border border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none text-sm font-body"
              autoFocus
            />
            <motion.button
              onClick={() => setStep(2)}
              disabled={!feeling.trim()}
              className={`w-full py-3 rounded-xl font-semibold transition-all ${
                feeling.trim()
                  ? 'bg-teal-500 hover:bg-teal-600 text-white'
                  : 'bg-teal-100 text-teal-400 cursor-not-allowed'
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
              <span className="text-xs font-bold text-teal-600 uppercase tracking-wider">Step 2 of 3</span>
              <h3 className="text-lg font-display font-bold text-teal-800 mt-1">
                Connect
              </h3>
            </div>
            <p className="text-sm font-body text-teal-700">
              Press your feet firmly into the floor. Feel the ground beneath you.
            </p>

            {/* Breathing animation */}
            <div className="flex justify-center py-6">
              <motion.div
                className="w-24 h-24 rounded-full bg-gradient-to-br from-teal-200 to-teal-400 flex items-center justify-center"
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

            <p className="text-xs text-teal-500">
              {breathCount < 3
                ? `Breath ${breathCount + 1} of 3...`
                : 'Great job staying present.'}
            </p>

            {showNextButton && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setStep(3)}
                className="bg-teal-500 hover:bg-teal-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
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
              <span className="text-xs font-bold text-teal-600 uppercase tracking-wider">Step 3 of 3</span>
              <h3 className="text-lg font-display font-bold text-teal-800 mt-1">
                Engage
              </h3>
            </div>
            <p className="text-sm font-body text-teal-700">
              Look around the room. Name 3 things you can see right now.
            </p>

            <div className="bg-teal-50 rounded-xl p-4 text-left space-y-2">
              <p className="text-xs text-teal-600 font-semibold uppercase">Look for:</p>
              <ul className="text-sm text-teal-700 space-y-1 font-body">
                <li>• Something with an interesting texture</li>
                <li>• Something that has a color you like</li>
                <li>• Something that's been there a while</li>
              </ul>
            </div>

            <p className="text-xs text-teal-500 italic">
              Take your time. There's no rush.
            </p>

            <motion.button
              onClick={onComplete}
              className="bg-teal-500 hover:bg-teal-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2 w-full"
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
        className="flex items-center gap-1.5 text-xs text-teal-500 hover:text-teal-700 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>Back to menu</span>
      </button>

      {/* Exercise container */}
      <div className="bg-gradient-to-br from-teal-50 via-cyan-50 to-teal-50 rounded-3xl p-6 border border-teal-100 shadow-soft">
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
                s <= step ? 'bg-teal-500' : 'bg-teal-200'
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
  onVent,
  onTextEntry,
  onExit
}) => {
  const [mode, setMode] = useState('menu'); // 'menu' | 'anchor'

  const handleAnchorComplete = () => {
    setMode('menu');
  };

  if (mode === 'anchor') {
    return (
      <DropAnchorExercise
        onComplete={handleAnchorComplete}
        onBack={() => setMode('menu')}
      />
    );
  }

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Exit button - subtle, top right */}
      <div className="flex justify-end">
        <motion.button
          onClick={onExit}
          className="flex items-center gap-1.5 text-xs text-warm-400 hover:text-warm-600 transition-colors px-2 py-1 rounded-full hover:bg-warm-100"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <X size={12} />
          <span>Return to normal view</span>
        </motion.button>
      </div>

      {/* Hero - Validation first */}
      <motion.div
        className="bg-gradient-to-br from-rose-50 via-pink-50 to-warm-50 rounded-3xl p-6 border border-rose-100 shadow-soft text-center"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 mb-4">
          <Heart size={24} className="text-rose-400" />
        </div>

        <h2 className="text-xl font-display font-bold text-rose-800 mb-2">
          It's okay to have a hard day.
        </h2>

        <p className="text-sm font-body text-rose-600 leading-relaxed max-w-xs mx-auto">
          Sometimes we just need to let it out. No judgment here.
        </p>
      </motion.div>

      {/* Primary Action - Vent (Voice) */}
      <motion.button
        onClick={onVent}
        className="w-full bg-rose-500 hover:bg-rose-600 text-white rounded-2xl p-5 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl transition-all"
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
          <span className="text-rose-100 text-sm font-body">Let it all out</span>
        </div>
      </motion.button>

      {/* Secondary Actions Row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Text Entry */}
        <motion.button
          onClick={onTextEntry}
          className="bg-warm-100 hover:bg-warm-200 text-warm-700 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <MessageCircle size={20} />
          <span className="font-medium text-sm">Write it down</span>
        </motion.button>

        {/* Drop Anchor - ACT Grounding */}
        <motion.button
          onClick={() => setMode('anchor')}
          className="bg-teal-100 hover:bg-teal-200 text-teal-700 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 transition-all"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Anchor size={20} />
          <span className="font-medium text-sm">Drop Anchor</span>
        </motion.button>
      </div>

      {/* CBT Reframe - If available */}
      {cbtReframe && (
        <motion.div
          className="bg-white rounded-2xl p-5 border border-warm-100 shadow-sm"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Leaf size={16} className="text-green-500" />
            <span className="text-xs font-semibold text-warm-600 uppercase tracking-wide">
              A different perspective
            </span>
          </div>
          <p className="text-sm font-body text-warm-700 leading-relaxed italic">
            "{cbtReframe}"
          </p>
        </motion.div>
      )}

      {/* Gentle reminder */}
      <motion.p
        className="text-center text-xs text-warm-400 font-body px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        This view appears when you might need extra support. You can always return to the regular dashboard.
      </motion.p>
    </motion.div>
  );
};

export default ShelterView;
