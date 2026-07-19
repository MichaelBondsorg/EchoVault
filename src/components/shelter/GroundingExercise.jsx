/**
 * GroundingExercise Component
 *
 * 5-4-3-2-1 Sensory Grounding Technique
 * Guides users through acknowledging:
 * - 5 things they can SEE
 * - 4 things they can TOUCH
 * - 3 things they can HEAR
 * - 2 things they can SMELL
 * - 1 thing they can TASTE
 *
 * Helps anchor to the present moment and reduce anxiety.
 *
 * Restyle only (Task D4b, CLOUD-DESIGN-SPEC.md §7 "Grounding"/mockup 7j).
 * The 5-step state machine (currentStepIndex, completedItems, handleAddItem/
 * handleSkipItem/handleReset, the auto-advance-on-step-complete timeout, and
 * the onComplete/onSkip callbacks) is byte-identical to the pre-Cloud
 * version — only className output changed.
 *
 * The five senses' distinct blue/green/purple/amber/rose colors collapsed
 * onto the single Cloud accent scale (each sense is still visually
 * distinguished by its own lucide icon), matching the same "ONE
 * user-selectable accent" precedent used for BreathingExercise (this task)
 * and InsightsPage/UnifiedConversation (C5/D1). `getColorClasses`'s `color`
 * parameter is kept (each step config still carries its `color` field
 * unchanged) even though every branch now resolves to the same accent
 * classes, to keep the per-step config data shape byte-identical.
 *
 * Note: this component has no live consumer as of this task — the
 * Mindfulness mode inside UnifiedConversation.jsx (already Cloud-migrated
 * in D1) uses its own local `GroundingExerciseUI`, a separate
 * implementation, for the grounding flow. `shelter/GroundingExercise.jsx`
 * is exported from `shelter/index.js` but nothing imports it, the same
 * "wired to nothing" status as the dead `celebrate()` helper referenced in
 * this task's brief. It's restyled anyway per the brief's explicit file
 * list and the migration ratchet, flagged here for visibility.
 *
 * No Pebble mascot was added: unlike Breathing (mockup 7i) and
 * Decompression (§6.3 resting), the Grounding mockup (7j) doesn't feature
 * Pebble at all — just a back arrow, serif headline, and step cards — so
 * none was invented here.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Hand, Ear, Wind, Cookie, Check, ChevronRight, RotateCcw } from 'lucide-react';

const GROUNDING_STEPS = [
  {
    sense: 'see',
    count: 5,
    icon: Eye,
    color: 'blue',
    prompt: 'Name 5 things you can SEE',
    description: 'Look around you. Notice colors, shapes, movement.',
    examples: ['the ceiling light', 'my phone', 'a plant', 'the window', 'my hands']
  },
  {
    sense: 'touch',
    count: 4,
    icon: Hand,
    color: 'green',
    prompt: 'Name 4 things you can TOUCH',
    description: 'Feel the textures around you. What are you sitting on?',
    examples: ['my chair', 'the desk', 'my clothes', 'my phone screen']
  },
  {
    sense: 'hear',
    count: 3,
    icon: Ear,
    color: 'purple',
    prompt: 'Name 3 things you can HEAR',
    description: 'Listen carefully. Near and far sounds.',
    examples: ['the AC humming', 'birds outside', 'my breathing']
  },
  {
    sense: 'smell',
    count: 2,
    icon: Wind,
    color: 'amber',
    prompt: 'Name 2 things you can SMELL',
    description: 'Take a breath. What scents are present?',
    examples: ['coffee', 'fresh air']
  },
  {
    sense: 'taste',
    count: 1,
    icon: Cookie,
    color: 'rose',
    prompt: 'Name 1 thing you can TASTE',
    description: 'Notice your mouth. Any lingering taste?',
    examples: ['mint from toothpaste']
  }
];

const GroundingExercise = ({
  onComplete,
  onSkip,
  compact = false
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedItems, setCompletedItems] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [completed, setCompleted] = useState(false);

  const currentStep = GROUNDING_STEPS[currentStepIndex];
  const stepItems = completedItems[currentStep.sense] || [];
  const isStepComplete = stepItems.length >= currentStep.count;
  const progress = currentStepIndex / GROUNDING_STEPS.length;

  const handleAddItem = () => {
    if (!inputValue.trim()) return;

    const newItems = [...stepItems, inputValue.trim()];
    setCompletedItems(prev => ({
      ...prev,
      [currentStep.sense]: newItems
    }));
    setInputValue('');

    // Auto-advance if step complete
    if (newItems.length >= currentStep.count) {
      setTimeout(() => {
        if (currentStepIndex < GROUNDING_STEPS.length - 1) {
          setCurrentStepIndex(prev => prev + 1);
        } else {
          setCompleted(true);
          if (onComplete) {
            onComplete({
              type: '5-4-3-2-1',
              responses: completedItems
            });
          }
        }
      }, 500);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleAddItem();
    }
  };

  const handleSkipItem = () => {
    // Add placeholder and continue
    const placeholders = currentStep.examples.slice(0, currentStep.count - stepItems.length);
    setCompletedItems(prev => ({
      ...prev,
      [currentStep.sense]: [...stepItems, ...placeholders]
    }));

    if (currentStepIndex < GROUNDING_STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      setCompleted(true);
      if (onComplete) onComplete({ type: '5-4-3-2-1', responses: completedItems });
    }
  };

  const handleReset = () => {
    setCurrentStepIndex(0);
    setCompletedItems({});
    setInputValue('');
    setCompleted(false);
  };

  // Every sense now resolves to the same Cloud accent scale (§ file header)
  // — `color` is accepted (and each step config still carries one) purely
  // to keep the per-step data shape unchanged.
  const getColorClasses = () => ({
    bg: 'bg-accent',
    text: 'text-accent-deep',
    ring: 'ring-accent',
    focusBorder: 'focus:border-accent'
  });

  const colorClasses = getColorClasses(currentStep.color);
  const IconComponent = currentStep.icon;

  if (completed) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center p-6 text-center"
      >
        <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center mb-4">
          <Check size={40} className="text-foreground dark:text-background" />
        </div>
        <h3 className="text-xl font-display font-medium text-foreground mb-2">
          You're Grounded
        </h3>
        <p className="text-muted-foreground mb-6 max-w-xs">
          Great job anchoring yourself to the present moment.
          Your nervous system is more regulated now.
        </p>

        {/* Summary */}
        <div className="w-full max-w-sm space-y-2 mb-6">
          {GROUNDING_STEPS.map(step => {
            const items = completedItems[step.sense] || [];
            return (
              <div key={step.sense} className="flex items-center gap-2 text-sm">
                <step.icon size={16} className={getColorClasses(step.color).text} />
                <span className="text-muted-foreground">{step.count} {step.sense}:</span>
                <span className="text-foreground truncate">
                  {items.join(', ')}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 bg-primary hover:opacity-90 rounded-full text-primary-foreground font-medium transition-colors"
          >
            <RotateCcw size={18} />
            Do Again
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col p-6">
      {/* Progress indicator */}
      <div className="flex justify-center gap-2 mb-6">
        {GROUNDING_STEPS.map((step, idx) => (
          <div
            key={step.sense}
            className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
              transition-all duration-300
              ${idx < currentStepIndex
                ? 'bg-accent text-foreground dark:text-background'
                : idx === currentStepIndex
                ? `${getColorClasses(step.color).bg} text-foreground dark:text-background ring-2 ${getColorClasses(step.color).ring} ring-offset-2 ring-offset-background`
                : 'bg-divider text-muted-foreground'
              }
            `}
          >
            {idx < currentStepIndex ? <Check size={16} /> : step.count}
          </div>
        ))}
      </div>

      {/* Current step */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStepIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex flex-col items-center"
        >
          {/* Icon */}
          <div className={`w-16 h-16 rounded-full ${colorClasses.bg} flex items-center justify-center mb-4`}>
            <IconComponent size={32} className="text-foreground dark:text-background" />
          </div>

          {/* Prompt */}
          <h3 className="text-xl font-display font-medium text-foreground text-center mb-2">
            {currentStep.prompt}
          </h3>
          <p className="text-muted-foreground text-sm text-center mb-6 max-w-xs">
            {currentStep.description}
          </p>

          {/* Completed items */}
          {stepItems.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center mb-4">
              {stepItems.map((item, idx) => (
                <motion.span
                  key={idx}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`px-3 py-1 bg-accent-wash ${colorClasses.text} rounded-full text-sm`}
                >
                  {item}
                </motion.span>
              ))}
            </div>
          )}

          {/* Progress within step */}
          <div className="text-faint text-sm mb-4">
            {stepItems.length} of {currentStep.count}
          </div>

          {/* Input */}
          {!isStepComplete && (
            <div className="w-full max-w-sm">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={`I can ${currentStep.sense}...`}
                  className={`
                    flex-1 px-4 py-3 bg-card border-2 border-border
                    rounded-xl text-foreground placeholder-faint
                    focus:outline-none ${colorClasses.focusBorder}
                    transition-colors
                  `}
                  autoFocus
                />
                <button
                  onClick={handleAddItem}
                  disabled={!inputValue.trim()}
                  className={`
                    p-3 rounded-xl transition-colors
                    ${inputValue.trim()
                      ? `${colorClasses.bg} text-foreground dark:text-background hover:opacity-90`
                      : 'bg-divider text-faint'
                    }
                  `}
                >
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Examples hint */}
              <p className="text-faint text-xs mt-2 text-center">
                Examples: {currentStep.examples.slice(0, 2).join(', ')}...
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Actions */}
      <div className="flex justify-center gap-4 mt-6">
        {onSkip && (
          <button
            onClick={onSkip}
            className="flex min-h-[44px] items-center px-4 text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Skip Exercise
          </button>
        )}
        <button
          onClick={handleSkipItem}
          className="flex min-h-[44px] items-center px-4 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          Skip to Next Sense
        </button>
      </div>
    </div>
  );
};

// Compact inline version
export const GroundingExerciseCompact = ({ onStart }) => (
  <button
    onClick={onStart}
    className="flex items-center gap-4 p-4 bg-card border border-border hover:bg-divider rounded-xl w-full text-left transition-colors"
  >
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: 'linear-gradient(160deg, var(--accent-3), var(--accent))' }}
    >
      <Hand size={24} className="text-foreground dark:text-background" />
    </div>
    <div>
      <div className="text-foreground font-medium">5-4-3-2-1 Grounding</div>
      <div className="text-muted-foreground text-sm">Anchor to present moment using your senses</div>
    </div>
    <ChevronRight className="text-faint ml-auto" size={20} />
  </button>
);

export default GroundingExercise;
