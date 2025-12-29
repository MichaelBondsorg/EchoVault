/**
 * Event Reflection Prompt Component
 *
 * Evening follow-up to close the CBT loop.
 * Asks how the event went and compares to morning anxiety.
 * Generates insights about catastrophizing patterns.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  Sparkles,
  ChevronRight,
  X
} from 'lucide-react';

import { recordEventReflection } from '../../services/anticipatory/eventFollowUp';

const EventReflectionPrompt = ({ event, userId, onComplete, onSkip }) => {
  const [step, setStep] = useState(0); // 0: intro, 1: anxiety, 2: what happened, 3: insight
  const [actualAnxiety, setActualAnxiety] = useState(5);
  const [whatHappened, setWhatHappened] = useState('');
  const [surprises, setSurprises] = useState('');
  const [copingWorked, setCopingWorked] = useState(null);
  const [cbtInsight, setCbtInsight] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleComplete = async () => {
    setSaving(true);
    try {
      const insight = await recordEventReflection(userId, event.checkInId, {
        actualAnxiety,
        whatHappened,
        surprises,
        copingWorked
      });

      setCbtInsight(insight);
      setStep(3); // Show insight
    } catch (error) {
      console.error('Failed to save reflection:', error);
    }
    setSaving(false);
  };

  const anxietyChange = event.anticipatedAnxiety - actualAnxiety;

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
              <MessageCircle className="w-8 h-8 text-amber-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-warm-900 mb-2">
                How did it go?
              </h2>
              <p className="text-warm-600">
                This morning you had <span className="font-medium">"{event.eventDescription}"</span>.
              </p>
              <p className="text-warm-500 text-sm mt-2">
                Let's reflect on how it actually went vs. how you expected.
              </p>
            </div>
            <button
              onClick={() => setStep(1)}
              className="w-full py-3 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 flex items-center justify-center gap-2"
            >
              Reflect
              <ChevronRight size={18} />
            </button>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-warm-900 mb-2">
                Anxiety Check
              </h2>
              <p className="text-warm-600 text-sm">
                How anxious did you actually feel during or after the event?
              </p>
            </div>

            {/* Before/After comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-warm-100 rounded-xl p-4 text-center">
                <p className="text-xs text-warm-500 mb-1">Before (this morning)</p>
                <p className="text-3xl font-bold text-warm-700">{event.anticipatedAnxiety}</p>
                <p className="text-xs text-warm-400">/10</p>
              </div>
              <div className="bg-amber-100 rounded-xl p-4 text-center">
                <p className="text-xs text-amber-600 mb-1">After (now)</p>
                <p className="text-3xl font-bold text-amber-700">{actualAnxiety}</p>
                <p className="text-xs text-amber-500">/10</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-warm-500">
                <span>Calm</span>
                <span>Very anxious</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={actualAnxiety}
                onChange={(e) => setActualAnxiety(parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Trend indicator */}
            {actualAnxiety !== event.anticipatedAnxiety && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl ${
                  anxietyChange > 0
                    ? 'bg-green-100 text-green-700'
                    : 'bg-rose-100 text-rose-700'
                }`}
              >
                {anxietyChange > 0 ? (
                  <>
                    <TrendingDown size={20} />
                    <span>Less anxious than expected ({anxietyChange} points lower)</span>
                  </>
                ) : (
                  <>
                    <TrendingUp size={20} />
                    <span>More anxious than expected ({Math.abs(anxietyChange)} points higher)</span>
                  </>
                )}
              </motion.div>
            )}

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600"
            >
              Continue
            </button>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-warm-900 mb-2">
                What Happened?
              </h2>
              <p className="text-warm-600 text-sm">
                A few quick questions to close the loop.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-warm-600 block mb-2">
                  How did it actually go?
                </label>
                <textarea
                  value={whatHappened}
                  onChange={(e) => setWhatHappened(e.target.value)}
                  placeholder="It went..."
                  className="w-full p-3 rounded-xl border border-warm-200 text-warm-800 placeholder-warm-400"
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm text-warm-600 block mb-2">
                  Any surprises (good or bad)?
                </label>
                <textarea
                  value={surprises}
                  onChange={(e) => setSurprises(e.target.value)}
                  placeholder="I didn't expect..."
                  className="w-full p-3 rounded-xl border border-warm-200 text-warm-800 placeholder-warm-400"
                  rows={2}
                />
              </div>

              {event.groundingToolCompleted && (
                <div>
                  <label className="text-sm text-warm-600 block mb-2">
                    Did the grounding exercise help?
                  </label>
                  <div className="flex gap-2">
                    {['Yes, a lot', 'A little', 'Not really'].map(option => (
                      <button
                        key={option}
                        onClick={() => setCopingWorked(option)}
                        className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                          copingWorked === option
                            ? 'bg-amber-500 text-white'
                            : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleComplete}
              disabled={saving || !whatHappened}
              className={`w-full py-3 rounded-xl font-medium ${
                whatHappened
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-warm-200 text-warm-400 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving...' : 'See Insights'}
            </button>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-purple-100 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-purple-500" />
              </div>
              <h2 className="text-xl font-semibold text-warm-900 mb-2">
                Your Insight
              </h2>
            </div>

            {cbtInsight && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Main insight */}
                <div className="bg-purple-50 rounded-2xl p-4">
                  <p className="text-purple-800">{cbtInsight.message}</p>
                </div>

                {/* Anxiety comparison visual */}
                <div className="bg-white rounded-xl border border-warm-200 p-4">
                  <p className="text-xs text-warm-500 mb-3 text-center">Anxiety: Expected vs Reality</p>
                  <div className="flex items-end justify-center gap-8">
                    <div className="text-center">
                      <div
                        className="w-12 bg-warm-300 rounded-t-lg mx-auto mb-2"
                        style={{ height: `${cbtInsight.beforeAnxiety * 10}px` }}
                      />
                      <p className="text-2xl font-bold text-warm-600">{cbtInsight.beforeAnxiety}</p>
                      <p className="text-xs text-warm-400">Before</p>
                    </div>
                    <div className="text-center">
                      <div
                        className={`w-12 rounded-t-lg mx-auto mb-2 ${
                          cbtInsight.afterAnxiety < cbtInsight.beforeAnxiety
                            ? 'bg-green-400'
                            : 'bg-rose-400'
                        }`}
                        style={{ height: `${cbtInsight.afterAnxiety * 10}px` }}
                      />
                      <p className="text-2xl font-bold text-warm-600">{cbtInsight.afterAnxiety}</p>
                      <p className="text-xs text-warm-400">After</p>
                    </div>
                  </div>
                </div>

                {/* Future reframe */}
                {cbtInsight.futureReframe && (
                  <div className="bg-green-50 rounded-2xl p-4">
                    <p className="text-xs text-green-600 font-medium mb-1">For next time:</p>
                    <p className="text-green-800 text-sm">{cbtInsight.futureReframe}</p>
                  </div>
                )}

                {/* Grounding insight */}
                {cbtInsight.groundingInsight && (
                  <div className="bg-blue-50 rounded-xl p-3">
                    <p className="text-blue-700 text-sm">{cbtInsight.groundingInsight.message}</p>
                  </div>
                )}
              </motion.div>
            )}

            <button
              onClick={() => onComplete?.(cbtInsight)}
              className="w-full py-3 rounded-xl bg-purple-500 text-white font-medium hover:bg-purple-600"
            >
              Done
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-warm-100">
        <span className="text-sm text-warm-500">Evening Reflection</span>
        {step < 3 && (
          <button
            onClick={onSkip}
            className="text-warm-400 hover:text-warm-600"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default EventReflectionPrompt;
