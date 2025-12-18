import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, RefreshCw, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';

/**
 * FeedbackLoop - Task completion with visual reward animation
 *
 * Features:
 * - Checkbox animation on complete
 * - Strikethrough animation
 * - Confetti burst
 * - Toast notification
 * - Callback to persist task as win
 *
 * Props:
 * - task: { text, recurrence?, completed? }
 * - onComplete: (task, source, index) => void - Called when task is completed
 * - source: 'today' | 'carried_forward' - Which list this task is from
 * - index: number - Position in the source array
 * - isCarriedForward: boolean - Show "from yesterday" badge
 * - disabled: boolean
 */

const FeedbackLoop = ({
  task,
  onComplete,
  source = 'today',
  index = 0,
  isCarriedForward = false,
  disabled = false
}) => {
  const [isCompleting, setIsCompleting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const buttonRef = useRef(null);

  const taskText = typeof task === 'string' ? task : task.text;
  const recurrence = typeof task === 'object' ? task.recurrence : null;

  // Trigger confetti burst from the checkbox position
  const triggerConfetti = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;

    confetti({
      particleCount: 30,
      spread: 60,
      origin: { x, y },
      colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      ticks: 100,
      gravity: 1.2,
      scalar: 0.8,
      shapes: ['circle', 'square']
    });
  }, []);

  const handleComplete = useCallback(() => {
    if (isCompleting || disabled) return;

    setIsCompleting(true);
    triggerConfetti();

    // Show toast after a brief delay
    setTimeout(() => {
      setShowToast(true);
    }, 300);

    // Call completion handler after animation with source and index
    setTimeout(() => {
      onComplete?.(task, source, index);
      setShowToast(false);
    }, 1500);
  }, [task, source, index, onComplete, triggerConfetti, isCompleting, disabled]);

  return (
    <div className="relative">
      <motion.div
        className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
          isCompleting
            ? 'bg-green-50 border border-green-100'
            : 'bg-white border border-gray-100 hover:border-blue-200 hover:shadow-sm'
        }`}
        animate={isCompleting ? { opacity: 0.7 } : { opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Checkbox */}
        <button
          ref={buttonRef}
          onClick={handleComplete}
          disabled={isCompleting || disabled}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            isCompleting
              ? 'bg-green-500 border-green-500'
              : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50'
          }`}
        >
          <AnimatePresence>
            {isCompleting && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
              >
                <CheckCircle2 size={14} className="text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>

        {/* Task content */}
        <div className="flex-1 min-w-0 relative">
          <span className={`text-sm font-body block ${
            isCompleting ? 'text-gray-400' : 'text-gray-700'
          }`}>
            {taskText}
          </span>

          {/* Strikethrough animation */}
          <AnimatePresence>
            {isCompleting && (
              <motion.div
                className="absolute left-0 top-1/2 h-0.5 bg-green-400 rounded"
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            )}
          </AnimatePresence>

          {/* Badges */}
          <div className="flex items-center gap-2 mt-1">
            {isCarriedForward && (
              <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                from yesterday
              </span>
            )}
            {recurrence && (
              <span className="text-xs text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <RefreshCw size={10} />
                {recurrence.description || recurrence.pattern || recurrence}
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Toast notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-green-600 text-white text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 whitespace-nowrap z-10"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
          >
            <Sparkles size={14} />
            Added to your Wins!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * TaskList - Wrapper for multiple tasks with FeedbackLoop
 *
 * Properly tracks source (carried_forward vs today) and original index
 * for each task to ensure correct persistence when completing.
 */
export const TaskList = ({
  tasks = [],
  carriedForward = [],
  onComplete,
  maxDisplay = 5
}) => {
  // Build task list with source and original index preserved
  const allTasks = [
    ...carriedForward.map((t, i) => ({
      task: t,
      source: 'carried_forward',
      originalIndex: i,
      isCarriedForward: true
    })),
    ...tasks.map((t, i) => ({
      task: t,
      source: 'today',
      originalIndex: i,
      isCarriedForward: false
    }))
  ].slice(0, maxDisplay);

  if (allTasks.length === 0) return null;

  return (
    <div className="space-y-2">
      {allTasks.map(({ task, source, originalIndex, isCarriedForward }, displayIndex) => (
        <FeedbackLoop
          key={`${source}-${originalIndex}`}
          task={task}
          source={source}
          index={originalIndex}
          isCarriedForward={isCarriedForward}
          onComplete={onComplete}
        />
      ))}
    </div>
  );
};

export default FeedbackLoop;
