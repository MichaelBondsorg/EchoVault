import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, ChevronLeft, ChevronRight, PenLine, X } from 'lucide-react';

/**
 * ReflectionPrompts - Persistent dashboard widget showing follow-up questions
 *
 * Cycles through reflection questions from recent entries to encourage
 * continuous reflection and additional journal entries.
 *
 * Features:
 * - Pulls followUpQuestions from recent entries' contextualInsight
 * - Cycles through questions automatically or manually
 * - "Write about this" button triggers new entry with question as prompt
 * - Persists dismissed questions in localStorage
 */

const ReflectionPrompts = ({ entries, category, onWritePrompt }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissedQuestions, setDismissedQuestions] = useState(new Set());
  const [isVisible, setIsVisible] = useState(true);

  // Load dismissed questions from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`reflections_dismissed_${category}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setDismissedQuestions(new Set(parsed));
      } catch (e) {
        console.error('Failed to parse dismissed questions:', e);
      }
    }
  }, [category]);

  // Extract all follow-up questions from recent entries (last 14 days)
  const questions = useMemo(() => {
    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const categoryEntries = entries.filter(e => e.category === category);

    const allQuestions = [];
    categoryEntries.forEach(entry => {
      const entryDate = entry.effectiveDate || entry.createdAt;
      const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

      // Only from last 2 weeks
      if (date < twoWeeksAgo) return;

      const followUps = entry.contextualInsight?.followUpQuestions;
      if (Array.isArray(followUps) && followUps.length > 0) {
        followUps.forEach(q => {
          if (q && typeof q === 'string' && q.trim()) {
            allQuestions.push({
              question: q.trim(),
              entryId: entry.id,
              entryTitle: entry.title || 'Entry',
              entryDate: date
            });
          }
        });
      }
    });

    // Filter out dismissed questions and dedupe
    const seen = new Set();
    return allQuestions
      .filter(q => {
        const key = q.question.toLowerCase();
        if (seen.has(key) || dismissedQuestions.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10); // Limit to 10 most recent questions
  }, [entries, category, dismissedQuestions]);

  // Reset index if it's out of bounds
  useEffect(() => {
    if (currentIndex >= questions.length && questions.length > 0) {
      setCurrentIndex(0);
    }
  }, [questions.length, currentIndex]);

  // Auto-cycle through questions every 30 seconds
  useEffect(() => {
    if (questions.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % questions.length);
    }, 30000);

    return () => clearInterval(interval);
  }, [questions.length]);

  // Dismiss a question
  const dismissQuestion = useCallback((question) => {
    const key = question.toLowerCase();
    setDismissedQuestions(prev => {
      const next = new Set(prev);
      next.add(key);
      // Save to localStorage
      localStorage.setItem(
        `reflections_dismissed_${category}`,
        JSON.stringify([...next])
      );
      return next;
    });
  }, [category]);

  // Navigate between questions
  const goNext = () => setCurrentIndex(prev => (prev + 1) % questions.length);
  const goPrev = () => setCurrentIndex(prev => (prev - 1 + questions.length) % questions.length);

  // Handle write button click
  const handleWrite = () => {
    if (onWritePrompt && questions[currentIndex]) {
      onWritePrompt(questions[currentIndex].question);
    }
  };

  // Don't render if no questions or hidden
  if (!isVisible || questions.length === 0) return null;

  const currentQuestion = questions[currentIndex];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-secondary-50 to-primary-50 rounded-2xl border border-secondary-100 p-4 mb-4 relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-secondary-600">
          <MessageCircle size={16} />
          <span className="text-xs font-semibold uppercase tracking-wide">Reflect</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Question counter */}
          {questions.length > 1 && (
            <span className="text-xs text-warm-400 mr-2">
              {currentIndex + 1} / {questions.length}
            </span>
          )}

          {/* Dismiss button */}
          <button
            onClick={() => dismissQuestion(currentQuestion.question)}
            className="p-1.5 rounded-full hover:bg-white/50 transition-colors text-warm-400 hover:text-warm-600"
            title="Dismiss this question"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentQuestion.question}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="min-h-[60px]"
        >
          <p className="text-base text-warm-800 font-body leading-relaxed mb-3">
            {currentQuestion.question}
          </p>

          {/* Source context */}
          <p className="text-xs text-warm-400 mb-3">
            From your entry on {currentQuestion.entryDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Actions */}
      <div className="flex items-center justify-between">
        {/* Navigation */}
        {questions.length > 1 ? (
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="p-1.5 rounded-full hover:bg-white/50 transition-colors text-warm-400 hover:text-warm-600"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={goNext}
              className="p-1.5 rounded-full hover:bg-white/50 transition-colors text-warm-400 hover:text-warm-600"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ) : (
          <div />
        )}

        {/* Write button */}
        <motion.button
          onClick={handleWrite}
          className="flex items-center gap-2 px-3 py-2 bg-white/70 hover:bg-white rounded-xl text-sm font-medium text-secondary-700 transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <PenLine size={14} />
          Write about this
        </motion.button>
      </div>
    </motion.div>
  );
};

export default ReflectionPrompts;
