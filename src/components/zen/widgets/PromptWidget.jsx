import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Mic, PenLine, ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * PromptWidget - Reflection prompts for Bento dashboard
 *
 * RESTORED: Uses follow-up questions from entries' contextualInsight
 * These are the insightful, personalized questions based on journal history.
 */
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
  const [dismissedQuestions, setDismissedQuestions] = useState(new Set());

  // Load dismissed questions from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`reflections_dismissed_${category}`);
    if (stored) {
      try {
        setDismissedQuestions(new Set(JSON.parse(stored)));
      } catch (e) {
        console.error('Failed to parse dismissed questions:', e);
      }
    }
  }, [category]);

  // Extract follow-up questions from recent entries (last 14 days)
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
              entryDate: date
            });
          }
        });
      }
    });

    // Filter out dismissed and dedupe
    const seen = new Set();
    const filtered = allQuestions.filter(q => {
      const key = q.question.toLowerCase();
      if (seen.has(key) || dismissedQuestions.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);

    // Fallback prompts if no personalized ones
    if (filtered.length === 0) {
      const hour = new Date().getHours();
      const fallbacks = [
        "What's on your mind right now?",
        "How are you really feeling?",
        hour < 12 ? "What are you hoping to accomplish today?" : "What was the highlight of your day?",
        "What's one thing you're grateful for?",
      ];
      return fallbacks.map((q, i) => ({ question: q, entryId: null, entryDate: null }));
    }

    return filtered;
  }, [entries, category, dismissedQuestions]);

  // Reset index if out of bounds
  useEffect(() => {
    if (currentIndex >= questions.length && questions.length > 0) {
      setCurrentIndex(0);
    }
  }, [questions.length, currentIndex]);

  // Auto-cycle every 30 seconds
  useEffect(() => {
    if (questions.length <= 1 || isEditing) return;
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % questions.length);
    }, 30000);
    return () => clearInterval(interval);
  }, [questions.length, isEditing]);

  const dismissQuestion = useCallback((question) => {
    const key = question.toLowerCase();
    setDismissedQuestions(prev => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem(`reflections_dismissed_${category}`, JSON.stringify([...next]));
      return next;
    });
    // Move to next question
    if (questions.length > 1) {
      setCurrentIndex(prev => prev % (questions.length - 1));
    }
  }, [category, questions.length]);

  const goNext = () => setCurrentIndex(prev => (prev + 1) % questions.length);
  const goPrev = () => setCurrentIndex(prev => (prev - 1 + questions.length) % questions.length);

  const currentQuestion = questions[currentIndex];
  const isPersonalized = currentQuestion?.entryId !== null;

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
      className="bg-gradient-to-br from-secondary-50/50 to-primary-50/50"
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-secondary-600">
            {isPersonalized ? <Sparkles size={14} /> : <MessageCircle size={14} />}
            <span className="text-xs font-semibold uppercase tracking-wide">
              {isPersonalized ? 'Reflect' : 'Prompt'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {questions.length > 1 && (
              <span className="text-xs text-warm-400 mr-1">
                {currentIndex + 1}/{questions.length}
              </span>
            )}
            {isPersonalized && !isEditing && (
              <button
                onClick={() => dismissQuestion(currentQuestion.question)}
                className="p-1 rounded-full hover:bg-white/50 text-warm-400 hover:text-warm-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Question */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 min-h-[48px]"
          >
            <p className="text-warm-800 font-medium text-sm leading-relaxed">
              {currentQuestion?.question}
            </p>
            {isPersonalized && currentQuestion?.entryDate && (
              <p className="text-xs text-warm-400 mt-1">
                From {currentQuestion.entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation + Actions */}
        <div className="flex items-center justify-between mt-2">
          {/* Navigation arrows */}
          {questions.length > 1 ? (
            <div className="flex items-center gap-0.5">
              <button
                onClick={goPrev}
                disabled={isEditing}
                className="p-1 rounded-full hover:bg-white/50 text-warm-400 hover:text-warm-600 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={goNext}
                disabled={isEditing}
                className="p-1 rounded-full hover:bg-white/50 text-warm-400 hover:text-warm-600 disabled:opacity-50"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : <div />}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <motion.button
              onClick={() => onWritePrompt?.(currentQuestion?.question)}
              disabled={isEditing}
              className="py-1.5 px-3 bg-white/50 hover:bg-white/70 text-warm-600 text-xs font-medium rounded-xl flex items-center gap-1 disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <PenLine size={12} />
              Write
            </motion.button>
            <motion.button
              onClick={() => onVoicePrompt?.(currentQuestion?.question)}
              disabled={isEditing}
              className="py-1.5 px-3 bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium rounded-xl flex items-center gap-1 shadow-sm disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Mic size={12} />
              Speak
            </motion.button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default PromptWidget;
