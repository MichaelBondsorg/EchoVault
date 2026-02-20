/**
 * PostMortem Component
 *
 * A guided reflection flow for after difficult leadership conversations.
 * Uses CBT to identify distortions, ACT for values alignment.
 *
 * Sections:
 * 1. What Happened - Factual summary (auto-extracted)
 * 2. How I Felt - Emotional acknowledgment
 * 3. Distortions Check - CBT analysis
 * 4. Values Alignment - ACT framework
 * 5. What I'd Do Differently - Learning extraction
 * 6. Self-Compassion - Closing affirmation
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  FileText,
  Heart,
  Brain,
  Compass,
  Lightbulb,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { LEADERSHIP_VALUES, detectLeadershipDistortions } from '../../services/leadership';

const STEP_COLORS = {
  lavender: { border: 'border-lavender-100 dark:border-lavender-800', gradient: 'bg-gradient-to-r from-lavender-500 to-lavender-600 dark:from-lavender-700 dark:to-lavender-800' },
  terra: { border: 'border-terra-100 dark:border-terra-800', gradient: 'bg-gradient-to-r from-terra-400 to-terra-500 dark:from-terra-600 dark:to-terra-700' },
  lavenderDeep: { border: 'border-lavender-200 dark:border-lavender-800', gradient: 'bg-gradient-to-r from-lavender-600 to-lavender-700 dark:from-lavender-700 dark:to-lavender-800' },
  honey: { border: 'border-honey-100 dark:border-honey-800', gradient: 'bg-gradient-to-r from-honey-500 to-honey-600 dark:from-honey-600 dark:to-honey-700' },
  sage: { border: 'border-sage-100 dark:border-sage-800', gradient: 'bg-gradient-to-r from-sage-500 to-sage-600 dark:from-sage-600 dark:to-sage-700' },
  sageLight: { border: 'border-sage-200 dark:border-sage-800', gradient: 'bg-gradient-to-r from-sage-400 to-sage-500 dark:from-sage-500 dark:to-sage-600' },
};

const STEPS = [
  { id: 'summary', title: 'What Happened', icon: FileText, color: 'lavender' },
  { id: 'feelings', title: 'How I Felt', icon: Heart, color: 'terra' },
  { id: 'distortions', title: 'Thinking Patterns', icon: Brain, color: 'lavenderDeep' },
  { id: 'values', title: 'Values Check', icon: Compass, color: 'honey' },
  { id: 'learnings', title: 'Takeaways', icon: Lightbulb, color: 'sage' },
  { id: 'compassion', title: 'Self-Compassion', icon: Sparkles, color: 'sageLight' }
];

const FEELING_OPTIONS = [
  { value: 'anxious', label: 'Anxious', emoji: '' },
  { value: 'frustrated', label: 'Frustrated', emoji: '' },
  { value: 'sad', label: 'Sad', emoji: '' },
  { value: 'guilty', label: 'Guilty', emoji: '' },
  { value: 'relieved', label: 'Relieved', emoji: '' },
  { value: 'proud', label: 'Proud', emoji: '' },
  { value: 'drained', label: 'Drained', emoji: '' },
  { value: 'uncertain', label: 'Uncertain', emoji: '' },
  { value: 'hopeful', label: 'Hopeful', emoji: '' }
];

const DISTORTION_QUESTIONS = [
  {
    id: 'responsibility',
    question: 'Did I take too much responsibility for things outside my control?',
    distortion: 'personalization',
    reframe: "I can only control my actions, not others' reactions."
  },
  {
    id: 'catastrophize',
    question: 'Did I expect the worst possible outcome?',
    distortion: 'catastrophizing',
    reframe: "Let's consider what's realistically likely to happen."
  },
  {
    id: 'preparation',
    question: 'Did I discount my preparation or experience?',
    distortion: 'imposter_syndrome',
    reframe: 'Your experience and perspective matter.'
  },
  {
    id: 'mindreading',
    question: "Did I assume I knew what they were thinking?",
    distortion: 'mind_reading',
    reframe: "I can check in rather than assume."
  },
  {
    id: 'pleasing',
    question: 'Did I avoid being honest to keep the peace?',
    distortion: 'people_pleasing',
    reframe: 'Kindness and honesty can coexist.'
  }
];

const VALUE_OPTIONS = Object.keys(LEADERSHIP_VALUES).map(v => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1)
}));

const PostMortem = ({
  entry,
  leadershipContext,
  leadershipInsight,
  onComplete,
  onClose
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState({
    summary: leadershipInsight?.situationSummary || '',
    feelings: [],
    distortionsChecked: [],
    valuesSelected: leadershipInsight?.valuesDisplayed || [],
    whatIdDoDifferently: '',
    selfCompassionNote: ''
  });

  // Pre-detect distortions from entry text
  const detectedDistortions = useMemo(() => {
    return detectLeadershipDistortions(entry?.text || '');
  }, [entry?.text]);

  const step = STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onComplete?.(responses);
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const updateResponse = (key, value) => {
    setResponses(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayItem = (key, item) => {
    setResponses(prev => {
      const arr = prev[key] || [];
      if (arr.includes(item)) {
        return { ...prev, [key]: arr.filter(i => i !== item) };
      }
      return { ...prev, [key]: [...arr, item] };
    });
  };

  const renderStepContent = () => {
    switch (step.id) {
      case 'summary':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              Let's start with what happened. Edit or add to this summary if needed.
            </p>
            <textarea
              value={responses.summary}
              onChange={(e) => updateResponse('summary', e.target.value)}
              placeholder="Describe the situation briefly..."
              className="w-full h-32 p-4 rounded-xl border border-warm-200 focus:border-lavender-400 focus:ring-2 focus:ring-lavender-100 dark:bg-hearth-850 dark:border-hearth-700 dark:text-warm-200 dark:focus:border-lavender-500 dark:focus:ring-lavender-900/40 outline-none resize-none text-sm font-body"
            />
            {leadershipContext?.mentionedPeople?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-warm-500">People involved:</span>
                {leadershipContext.mentionedPeople.map((person, i) => (
                  <span key={i} className="px-2 py-1 bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300 rounded-full text-xs">
                    {person.replace('@person:', '')}
                  </span>
                ))}
              </div>
            )}
          </div>
        );

      case 'feelings':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              How did this situation make you feel? Select all that apply.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {FEELING_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleArrayItem('feelings', value)}
                  className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    responses.feelings.includes(value)
                      ? 'border-terra-400 bg-terra-50 text-terra-700 dark:border-terra-500 dark:bg-terra-900/30 dark:text-terra-300'
                      : 'border-warm-200 hover:border-warm-300 text-warm-600 dark:border-hearth-700 dark:hover:border-hearth-600 dark:text-warm-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {responses.feelings.length > 0 && (
              <p className="text-xs text-warm-500 italic">
                It's normal to feel {responses.feelings.join(' and ')} after a difficult leadership moment.
              </p>
            )}
          </div>
        );

      case 'distortions':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              Let's check if any common thinking patterns showed up. Be honest - this is just for awareness.
            </p>
            <div className="space-y-3">
              {DISTORTION_QUESTIONS.map(({ id, question, distortion, reframe }) => {
                const isChecked = responses.distortionsChecked.includes(id);
                const wasDetected = detectedDistortions.some(d => d.type === distortion);

                return (
                  <div
                    key={id}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      isChecked
                        ? 'border-lavender-400 bg-lavender-50 dark:border-lavender-500 dark:bg-lavender-900/30'
                        : wasDetected
                          ? 'border-lavender-200 bg-lavender-50/50 dark:border-lavender-700 dark:bg-lavender-900/20'
                          : 'border-warm-200 dark:border-hearth-700'
                    }`}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleArrayItem('distortionsChecked', id)}
                        className="mt-1 w-4 h-4 rounded border-warm-300 text-lavender-600 focus:ring-lavender-500 dark:border-hearth-600 dark:text-lavender-400"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-warm-800">{question}</p>
                        {isChecked && (
                          <motion.p
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="text-xs text-lavender-600 dark:text-lavender-400 mt-2 italic"
                          >
                            Reframe: {reframe}
                          </motion.p>
                        )}
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'values':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              What values were you trying to honor in this situation?
            </p>
            <div className="flex flex-wrap gap-2">
              {VALUE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleArrayItem('valuesSelected', value)}
                  className={`px-4 py-2 rounded-full border-2 text-sm font-medium transition-all ${
                    responses.valuesSelected.includes(value)
                      ? 'border-honey-400 bg-honey-50 text-honey-700 dark:border-honey-500 dark:bg-honey-900/30 dark:text-honey-300'
                      : 'border-warm-200 hover:border-warm-300 text-warm-600 dark:border-hearth-700 dark:hover:border-hearth-600 dark:text-warm-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {responses.valuesSelected.length > 0 && (
              <div className="p-4 bg-honey-50 dark:bg-honey-900/30 rounded-xl">
                <p className="text-sm text-honey-800 dark:text-honey-200">
                  You were acting from {responses.valuesSelected.join(', ')}. Even when outcomes are uncertain, acting from values is meaningful.
                </p>
              </div>
            )}
          </div>
        );

      case 'learnings':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              Looking back, is there anything you might do differently next time? (No judgment - this is growth.)
            </p>
            <textarea
              value={responses.whatIdDoDifferently}
              onChange={(e) => updateResponse('whatIdDoDifferently', e.target.value)}
              placeholder="Optional: What would you try differently..."
              className="w-full h-24 p-4 rounded-xl border border-warm-200 focus:border-sage-400 focus:ring-2 focus:ring-sage-100 dark:bg-hearth-850 dark:border-hearth-700 dark:text-warm-200 dark:focus:border-sage-500 dark:focus:ring-sage-900/40 outline-none resize-none text-sm font-body"
            />
            <p className="text-xs text-warm-500">
              Tip: Focus on what's in your control. Small adjustments compound over time.
            </p>
          </div>
        );

      case 'compassion':
        return (
          <div className="space-y-4">
            <p className="text-sm text-warm-600 font-body">
              Leadership is hard. Before we wrap up, what's something kind you can tell yourself about how you handled this?
            </p>
            <textarea
              value={responses.selfCompassionNote}
              onChange={(e) => updateResponse('selfCompassionNote', e.target.value)}
              placeholder="I did my best because..."
              className="w-full h-24 p-4 rounded-xl border border-warm-200 focus:border-sage-400 focus:ring-2 focus:ring-sage-100 dark:bg-hearth-850 dark:border-hearth-700 dark:text-warm-200 dark:focus:border-sage-500 dark:focus:ring-sage-900/40 outline-none resize-none text-sm font-body"
            />
            <div className="p-4 bg-sage-50 dark:bg-sage-900/30 rounded-xl">
              <p className="text-sm text-sage-800 dark:text-sage-200 font-medium">
                {leadershipInsight?.strengthAcknowledgment || 'Taking time to reflect on this shows self-awareness and growth mindset.'}
              </p>
            </div>
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-hearth-900 rounded-3xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-lg"
      >
        {/* Header */}
        <div className={`p-6 border-b ${STEP_COLORS[step.color].border} ${STEP_COLORS[step.color].gradient} text-white`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <step.icon size={24} />
              <div>
                <h2 className="text-lg font-display font-bold">{step.title}</h2>
                <p className="text-sm opacity-80">Step {currentStep + 1} of {STEPS.length}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white p-1"
            >
              <X size={24} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-white rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {renderStepContent()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="p-4 border-t border-warm-100 dark:border-hearth-800 bg-warm-50 dark:bg-hearth-850 flex justify-between">
          <button
            onClick={handleBack}
            disabled={isFirstStep}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
              isFirstStep
                ? 'text-warm-300 cursor-not-allowed'
                : 'text-warm-600 hover:bg-warm-100 dark:text-warm-400 dark:hover:bg-hearth-800'
            }`}
          >
            <ArrowLeft size={18} />
            Back
          </button>

          <button
            onClick={handleNext}
            className={`flex items-center gap-2 px-6 py-2 rounded-xl font-medium text-white transition-all ${
              isLastStep
                ? 'bg-sage-500 hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-500'
                : 'bg-honey-500 hover:bg-honey-600 dark:bg-honey-600 dark:hover:bg-honey-500'
            }`}
          >
            {isLastStep ? (
              <>
                <Check size={18} />
                Complete
              </>
            ) : (
              <>
                Next
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PostMortem;
