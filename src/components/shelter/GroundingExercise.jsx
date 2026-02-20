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

  const getColorClasses = (color) => {
    const colors = {
      blue: { bg: 'bg-blue-500', text: 'text-blue-400', ring: 'ring-blue-500', focusBorder: 'focus:border-blue-500' },
      green: { bg: 'bg-green-500', text: 'text-green-400', ring: 'ring-green-500', focusBorder: 'focus:border-green-500' },
      purple: { bg: 'bg-purple-500', text: 'text-purple-400', ring: 'ring-purple-500', focusBorder: 'focus:border-purple-500' },
      amber: { bg: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500', focusBorder: 'focus:border-amber-500' },
      rose: { bg: 'bg-rose-500', text: 'text-rose-400', ring: 'ring-rose-500', focusBorder: 'focus:border-rose-500' }
    };
    return colors[color] || colors.blue;
  };

  const colorClasses = getColorClasses(currentStep.color);
  const IconComponent = currentStep.icon;

  if (completed) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center p-6 text-center"
      >
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-4">
          <Check size={40} className="text-white" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          You're Grounded
        </h3>
        <p className="text-white/70 mb-6 max-w-xs">
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
                <span className="text-white/60">{step.count} {step.sense}:</span>
                <span className="text-white/80 truncate">
                  {items.join(', ')}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 rounded-full text-gray-900 font-medium transition-colors"
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
                ? 'bg-green-500 text-white'
                : idx === currentStepIndex
                ? `${getColorClasses(step.color).bg} text-white ring-2 ${getColorClasses(step.color).ring} ring-offset-2 ring-offset-gray-900`
                : 'bg-white/10 text-white/40'
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
            <IconComponent size={32} className="text-white" />
          </div>

          {/* Prompt */}
          <h3 className="text-xl font-semibold text-white text-center mb-2">
            {currentStep.prompt}
          </h3>
          <p className="text-white/60 text-sm text-center mb-6 max-w-xs">
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
                  className={`px-3 py-1 ${colorClasses.bg}/20 ${colorClasses.text} rounded-full text-sm`}
                >
                  {item}
                </motion.span>
              ))}
            </div>
          )}

          {/* Progress within step */}
          <div className="text-white/40 text-sm mb-4">
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
                    flex-1 px-4 py-3 bg-white/10 border-2 border-white/20
                    rounded-xl text-white placeholder-white/40
                    focus:outline-none ${getColorClasses(currentStep.color).focusBorder || 'focus:border-blue-500'}
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
                      ? `${colorClasses.bg} text-white hover:opacity-90`
                      : 'bg-white/10 text-white/30'
                    }
                  `}
                >
                  <ChevronRight size={20} />
                </button>
              </div>

              {/* Examples hint */}
              <p className="text-white/30 text-xs mt-2 text-center">
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
            className="px-4 py-2 text-white/50 hover:text-white/70 text-sm transition-colors"
          >
            Skip Exercise
          </button>
        )}
        <button
          onClick={handleSkipItem}
          className="px-4 py-2 text-white/50 hover:text-white/70 text-sm transition-colors"
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
    className="flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 rounded-xl w-full text-left transition-colors"
  >
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center flex-shrink-0">
      <Hand size={24} className="text-white" />
    </div>
    <div>
      <div className="text-white font-medium">5-4-3-2-1 Grounding</div>
      <div className="text-white/60 text-sm">Anchor to present moment using your senses</div>
    </div>
    <ChevronRight className="text-white/40 ml-auto" size={20} />
  </button>
);

export default GroundingExercise;
