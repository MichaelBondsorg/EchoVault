import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Mic, PenLine, RefreshCw } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * PromptWidget - Reflection prompts for Bento dashboard
 *
 * Shows rotating prompts that adapt based on user's entries
 */

// Default prompts for cycling
const DEFAULT_PROMPTS = [
  "What's on your mind right now?",
  "What made you smile today?",
  "What's one thing you're grateful for?",
  "How are you really feeling?",
  "What would make today better?",
  "What's something you're looking forward to?",
  "What challenged you today?",
  "What did you learn recently?",
];

const PromptWidget = ({
  entries = [],
  category,
  onWritePrompt,
  onVoicePrompt,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Select a contextual prompt based on time and entries
  const prompts = useMemo(() => {
    const hour = new Date().getHours();
    let contextPrompts = [...DEFAULT_PROMPTS];

    // Morning prompts
    if (hour >= 5 && hour < 12) {
      contextPrompts.unshift(
        "What are you hoping to accomplish today?",
        "How did you sleep last night?"
      );
    }
    // Evening prompts
    else if (hour >= 17) {
      contextPrompts.unshift(
        "What was the highlight of your day?",
        "What are you letting go of today?"
      );
    }

    // If few entries, add encouragement prompts
    if (entries.length < 5) {
      contextPrompts.push(
        "What brought you here today?",
        "What's something you want to remember?"
      );
    }

    return contextPrompts.slice(0, 8); // Limit to 8 prompts
  }, [entries.length]);

  const currentPrompt = prompts[currentIndex];

  // Auto-cycle prompts every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % prompts.length);
        setIsTransitioning(false);
      }, 300);
    }, 30000);

    return () => clearInterval(interval);
  }, [prompts.length]);

  const handleNextPrompt = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % prompts.length);
      setIsTransitioning(false);
    }, 300);
  };

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-warm-500">
            <MessageCircle size={16} />
            <span className="text-xs font-medium">Reflection</span>
          </div>
          <motion.button
            onClick={handleNextPrompt}
            className="p-1.5 rounded-lg hover:bg-white/30 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            disabled={isEditing}
          >
            <RefreshCw size={14} className="text-warm-400" />
          </motion.button>
        </div>

        {/* Prompt */}
        <AnimatePresence mode="wait">
          <motion.p
            key={currentIndex}
            className="text-warm-700 font-medium text-sm flex-1"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: isTransitioning ? 0.5 : 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            "{currentPrompt}"
          </motion.p>
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-3">
          <motion.button
            onClick={() => onWritePrompt?.(currentPrompt)}
            className="
              flex-1 py-2 px-3
              bg-primary-100 hover:bg-primary-200
              text-primary-700 text-xs font-medium
              rounded-xl
              flex items-center justify-center gap-1.5
              transition-colors
            "
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isEditing}
          >
            <PenLine size={14} />
            Write
          </motion.button>
          <motion.button
            onClick={() => onVoicePrompt?.(currentPrompt)}
            className="
              flex-1 py-2 px-3
              bg-secondary-100 hover:bg-secondary-200
              text-secondary-700 text-xs font-medium
              rounded-xl
              flex items-center justify-center gap-1.5
              transition-colors
            "
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={isEditing}
          >
            <Mic size={14} />
            Speak
          </motion.button>
        </div>
      </div>
    </GlassCard>
  );
};

export default PromptWidget;
