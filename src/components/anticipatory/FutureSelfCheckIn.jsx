/**
 * Future Self Check-In Component
 *
 * A guided morning check-in for users facing a stressful event.
 * Walks through acknowledgment, body scan, grounding, reframe,
 * values anchor, and micro-commitment.
 *
 * Designed to be calming and supportive, not clinical.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sun,
  Heart,
  Wind,
  Sparkles,
  Target,
  ChevronRight,
  X,
  Check
} from 'lucide-react';

import { saveMorningCheckIn } from '../../services/anticipatory/eventFollowUp';
import GroundingExercise from './GroundingExercise';

const STEPS = [
  { id: 'acknowledge', title: 'Acknowledge', icon: Sun },
  { id: 'body_scan', title: 'Body Scan', icon: Heart },
  { id: 'grounding', title: 'Grounding', icon: Wind },
  { id: 'reframe', title: 'Reframe', icon: Sparkles },
  { id: 'commit', title: 'Commit', icon: Target }
];

const BODY_LOCATIONS = [
  { id: 'chest', label: 'Chest / Heart' },
  { id: 'stomach', label: 'Stomach' },
  { id: 'throat', label: 'Throat' },
  { id: 'head', label: 'Head' },
  { id: 'shoulders', label: 'Shoulders / Neck' },
  { id: 'nowhere', label: "I don't feel it physically" }
];

const MICRO_COMMITMENTS = [
  'Take 3 deep breaths before it starts',
  'Arrive 5 minutes early to settle in',
  'Have water nearby',
  'Remind myself this will end',
  'Focus on one moment at a time'
];

const FutureSelfCheckIn = ({ event, userId, onComplete, onSkip }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [anxietyLevel, setAnxietyLevel] = useState(5);
  const [worstCaseThought, setWorstCaseThought] = useState('');
  const [bodyLocation, setBodyLocation] = useState(null);
  const [groundingCompleted, setGroundingCompleted] = useState(false);
  const [reframedThought, setReframedThought] = useState('');
  const [selectedCommitment, setSelectedCommitment] = useState('');
  const [customCommitment, setCustomCommitment] = useState('');
  const [saving, setSaving] = useState(false);

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;

  const handleNext = async () => {
    if (isLastStep) {
      await handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      await saveMorningCheckIn(userId, {
        eventId: event.id,
        eventContent: event.content || event.eventDescription,
        eventTime: event.targetDate,
        anxietyLevel,
        worstCaseThought,
        bodyLocation,
        groundingToolUsed: event.recommendedTool?.name || 'grounding',
        groundingToolCompleted: groundingCompleted,
        microCommitment: selectedCommitment || customCommitment,
        reframeAttempted: reframedThought.length > 0
      });

      onComplete?.();
    } catch (error) {
      console.error('Failed to save check-in:', error);
    }
    setSaving(false);
  };

  const canProceed = () => {
    switch (step.id) {
      case 'acknowledge':
        return true; // Always can proceed from acknowledgment
      case 'body_scan':
        return bodyLocation !== null;
      case 'grounding':
        return true; // Can skip grounding
      case 'reframe':
        return true; // Reframe is optional
      case 'commit':
        return selectedCommitment || customCommitment;
      default:
        return true;
    }
  };

  const renderStep = () => {
    switch (step.id) {
      case 'acknowledge':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-honey-100 dark:bg-honey-900/30 flex items-center justify-center mb-4">
                <Sun className="w-8 h-8 text-honey-500 dark:text-honey-400" />
              </div>
              <h2 className="text-xl font-hand font-semibold text-warm-900 dark:text-warm-100 mb-2">
                Good morning
              </h2>
              <p className="text-warm-600 dark:text-warm-300">
                You have <span className="font-medium text-warm-800 dark:text-warm-200">{event.content || event.eventDescription}</span> today.
              </p>
              <p className="text-warm-500 dark:text-warm-400 text-sm mt-2">
                It's completely normal to feel some anxiety about this.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm text-warm-600 dark:text-warm-300">
                On a scale of 1-10, how anxious do you feel right now?
              </label>
              <div className="flex items-center gap-4">
                <span className="text-sm text-warm-400 dark:text-warm-500">Calm</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={anxietyLevel}
                  onChange={(e) => setAnxietyLevel(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-warm-400 dark:text-warm-500">Very anxious</span>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold text-warm-800 dark:text-warm-200">{anxietyLevel}</span>
                <span className="text-warm-500 dark:text-warm-400">/10</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-warm-600 dark:text-warm-300">
                What's the worst-case scenario playing in your mind? (optional)
              </label>
              <textarea
                value={worstCaseThought}
                onChange={(e) => setWorstCaseThought(e.target.value)}
                placeholder="I'm worried that..."
                className="w-full p-3 rounded-xl border border-warm-200 dark:border-hearth-700 text-warm-800 dark:text-warm-200 placeholder-warm-400 dark:placeholder-warm-500 focus:ring-2 focus:ring-warm-300 dark:focus:ring-warm-600 focus:border-transparent dark:bg-hearth-850"
                rows={3}
              />
            </div>
          </div>
        );

      case 'body_scan':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-terra-100 dark:bg-terra-900/30 flex items-center justify-center mb-4">
                <Heart className="w-8 h-8 text-terra-500 dark:text-terra-400" />
              </div>
              <h2 className="text-xl font-semibold text-warm-900 dark:text-warm-100 mb-2">
                Body Check
              </h2>
              <p className="text-warm-600 dark:text-warm-300">
                Where do you feel the anxiety in your body?
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {BODY_LOCATIONS.map(location => (
                <button
                  key={location.id}
                  onClick={() => setBodyLocation(location.id)}
                  className={`p-4 rounded-xl text-left transition-all ${
                    bodyLocation === location.id
                      ? 'bg-terra-500 dark:bg-terra-600 text-white'
                      : 'bg-warm-100 dark:bg-hearth-850 text-warm-700 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-hearth-700'
                  }`}
                >
                  {location.label}
                </button>
              ))}
            </div>

            {bodyLocation && bodyLocation !== 'nowhere' && (
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-warm-500 dark:text-warm-400 text-center"
              >
                Acknowledging where you feel it helps your body start to release it.
              </motion.p>
            )}
          </div>
        );

      case 'grounding':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-lavender-100 dark:bg-lavender-900/30 flex items-center justify-center mb-4">
                <Wind className="w-8 h-8 text-lavender-500 dark:text-lavender-400" />
              </div>
              <h2 className="text-xl font-semibold text-warm-900 dark:text-warm-100 mb-2">
                Grounding Exercise
              </h2>
              <p className="text-warm-600 dark:text-warm-300">
                Take a moment to calm your nervous system.
              </p>
            </div>

            {!groundingCompleted ? (
              <GroundingExercise
                type={event.recommendedTool?.id || 'box_breathing'}
                onComplete={() => setGroundingCompleted(true)}
                onSkip={() => setGroundingCompleted(false)}
              />
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-sage-50 dark:bg-sage-900/20 rounded-2xl p-6 text-center"
              >
                <Check className="w-12 h-12 mx-auto text-sage-500 dark:text-sage-400 mb-3" />
                <p className="text-sage-800 dark:text-sage-200 font-medium">Great job!</p>
                <p className="text-sage-600 dark:text-sage-400 text-sm">
                  You've given your nervous system a reset.
                </p>
              </motion.div>
            )}
          </div>
        );

      case 'reframe':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-lavender-100 dark:bg-lavender-900/30 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-lavender-500 dark:text-lavender-400" />
              </div>
              <h2 className="text-xl font-semibold text-warm-900 dark:text-warm-100 mb-2">
                Reframe
              </h2>
              <p className="text-warm-600 dark:text-warm-300">
                Let's look at this from a different angle.
              </p>
            </div>

            {worstCaseThought && (
              <div className="bg-warm-100 dark:bg-hearth-850 rounded-xl p-4">
                <p className="text-xs text-warm-500 dark:text-warm-400 mb-1">Your worry:</p>
                <p className="text-warm-700 dark:text-warm-300 italic">"{worstCaseThought}"</p>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-sm text-warm-600 dark:text-warm-300">
                What's a more balanced way to think about this?
              </p>
              <div className="bg-lavender-50 dark:bg-lavender-900/20 rounded-xl p-4 space-y-2">
                <p className="text-sm text-lavender-700 dark:text-lavender-300">Try completing one of these:</p>
                <ul className="text-sm text-lavender-600 dark:text-lavender-400 space-y-1">
                  <li>• "Even if it's hard, I can handle it because..."</li>
                  <li>• "The most likely outcome is..."</li>
                  <li>• "I've faced similar challenges before and..."</li>
                </ul>
              </div>
              <textarea
                value={reframedThought}
                onChange={(e) => setReframedThought(e.target.value)}
                placeholder="A more balanced thought..."
                className="w-full p-3 rounded-xl border border-warm-200 dark:border-hearth-700 text-warm-800 dark:text-warm-200 placeholder-warm-400 dark:placeholder-warm-500 focus:ring-2 focus:ring-lavender-300 dark:focus:ring-lavender-700 focus:border-transparent dark:bg-hearth-850"
                rows={3}
              />
            </div>
          </div>
        );

      case 'commit':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-sage-100 dark:bg-sage-900/30 flex items-center justify-center mb-4">
                <Target className="w-8 h-8 text-sage-500 dark:text-sage-400" />
              </div>
              <h2 className="text-xl font-semibold text-warm-900 dark:text-warm-100 mb-2">
                One Small Thing
              </h2>
              <p className="text-warm-600 dark:text-warm-300">
                What's one small thing you can do to support yourself?
              </p>
            </div>

            <div className="space-y-2">
              {MICRO_COMMITMENTS.map(commitment => (
                <button
                  key={commitment}
                  onClick={() => {
                    setSelectedCommitment(commitment);
                    setCustomCommitment('');
                  }}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    selectedCommitment === commitment
                      ? 'bg-sage-500 dark:bg-sage-600 text-white'
                      : 'bg-warm-100 dark:bg-hearth-850 text-warm-700 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-hearth-700'
                  }`}
                >
                  {commitment}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-warm-500 dark:text-warm-400 text-center">Or write your own:</p>
              <input
                type="text"
                value={customCommitment}
                onChange={(e) => {
                  setCustomCommitment(e.target.value);
                  setSelectedCommitment('');
                }}
                placeholder="I will..."
                className="w-full p-3 rounded-xl border border-warm-200 dark:border-hearth-700 text-warm-800 dark:text-warm-200 placeholder-warm-400 dark:placeholder-warm-500 focus:ring-2 focus:ring-sage-300 dark:focus:ring-sage-700 focus:border-transparent dark:bg-hearth-850"
              />
            </div>

            {(selectedCommitment || customCommitment) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-sage-50 dark:bg-sage-900/20 rounded-xl p-4 text-center"
              >
                <p className="text-sage-700 dark:text-sage-300">
                  You've got this. 💪
                </p>
              </motion.div>
            )}
          </div>
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
      className="fixed inset-0 bg-gradient-to-b from-warm-50 to-white dark:from-hearth-950 dark:to-hearth-900 z-50 overflow-y-auto"
    >
      <div className="min-h-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onSkip}
            className="p-2 text-warm-400 hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300"
          >
            <X size={24} />
          </button>

          {/* Progress */}
          <div className="flex gap-1">
            {STEPS.map((s, idx) => (
              <div
                key={s.id}
                className={`w-8 h-1 rounded-full transition-colors ${
                  idx <= currentStep ? 'bg-warm-500 dark:bg-warm-400' : 'bg-warm-200 dark:bg-hearth-700'
                }`}
              />
            ))}
          </div>

          <div className="w-10" /> {/* Spacer */}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mb-8"
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={() => setCurrentStep(prev => prev - 1)}
              className="flex-1 py-4 rounded-xl bg-warm-100 dark:bg-hearth-850 text-warm-700 dark:text-warm-300 font-medium"
            >
              Back
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={!canProceed() || saving}
            className={`flex-1 py-4 rounded-xl font-medium flex items-center justify-center gap-2 ${
              canProceed()
                ? 'bg-warm-500 dark:bg-warm-600 text-white hover:bg-warm-600 dark:hover:bg-warm-700'
                : 'bg-warm-200 dark:bg-hearth-700 text-warm-400 dark:text-warm-500 cursor-not-allowed'
            }`}
          >
            {saving ? (
              'Saving...'
            ) : isLastStep ? (
              'Complete'
            ) : (
              <>
                Continue
                <ChevronRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default FutureSelfCheckIn;
