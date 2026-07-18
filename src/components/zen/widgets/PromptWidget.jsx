import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, PenLine, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Card, SectionLabel } from '../../cloud';
import { getQuickContextInsights } from '../../../services/nexus/insightIntegration';

/**
 * PromptWidget - "Reflect" card for the Home screen (CLOUD-DESIGN-SPEC.md
 * §7 Home: "Reflect card (prompt + Write/Speak)").
 *
 * Uses follow-up questions from entries' contextualInsight (personalized,
 * based on journal history) plus context-aware prompts from health/
 * environment data. Restyle only — the question sourcing/dismissal/paging
 * logic below is unchanged from the pre-Cloud widget.
 */
const PromptWidget = ({
  entries = [],
  category,
  onWritePrompt,
  onVoicePrompt,
  isEditing = false,
  onDelete,
  todayHealth = null,
  todayEnvironment = null,
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

  // Get context-aware prompts based on health/environment
  const contextInsights = useMemo(() => {
    if (!todayHealth && !todayEnvironment) return null;
    try {
      return getQuickContextInsights(todayHealth, todayEnvironment, entries.slice(-7));
    } catch (e) {
      console.warn('Failed to get context insights:', e);
      return null;
    }
  }, [todayHealth, todayEnvironment, entries]);

  // Extract follow-up questions from recent entries (last 14 days)
  const questions = useMemo(() => {
    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const categoryEntries = entries.filter(e => e.category === category);
    const allQuestions = [];

    // Add context-aware prompt first if high priority
    if (contextInsights?.topPrompt && contextInsights.hasHighPriority) {
      const prompt = contextInsights.topPrompt;
      allQuestions.push({
        question: prompt.prompt,
        entryId: null,
        entryDate: null,
        isContext: true,
        contextType: prompt.type,
        priority: prompt.priority,
        trigger: prompt.trigger
      });
    }

    // Add follow-up questions from entries
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
              entryDate: date,
              isContext: false
            });
          }
        });
      }
    });

    // Add non-high-priority context prompt if we have space
    if (contextInsights?.topPrompt && !contextInsights.hasHighPriority && allQuestions.length < 5) {
      const prompt = contextInsights.topPrompt;
      allQuestions.push({
        question: prompt.prompt,
        entryId: null,
        entryDate: null,
        isContext: true,
        contextType: prompt.type,
        priority: prompt.priority,
        trigger: prompt.trigger
      });
    }

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
      return fallbacks.map((q) => ({ question: q, entryId: null, entryDate: null, isContext: false }));
    }

    return filtered;
  }, [entries, category, dismissedQuestions, contextInsights]);

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
  const isContextPrompt = currentQuestion?.isContext === true;

  return (
    <Card className={`w-full p-4 ${isEditing ? 'animate-shake' : ''}`}>
      {/* Header: REFLECT section label + pager */}
      <div className="mb-2.5 flex items-center justify-between">
        <SectionLabel>Reflect</SectionLabel>
        <div className="flex items-center gap-1">
          {questions.length > 1 && (
            <span className="text-xs text-faint">
              {currentIndex + 1} of {questions.length}
            </span>
          )}
          {(isPersonalized || isContextPrompt) && !isEditing && (
            <button
              type="button"
              onClick={() => dismissQuestion(currentQuestion.question)}
              aria-label="Dismiss this prompt"
              className="cloud-icon-button"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Question - serif per §4 "reflective copy" */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="min-h-[48px]"
        >
          <p className="font-display text-[16px] leading-[1.5] text-secondary-foreground">
            {currentQuestion?.question}
          </p>
          {isPersonalized && currentQuestion?.entryDate && (
            <p className="mt-1 text-xs text-faint">
              From {currentQuestion.entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}
          {isContextPrompt && (
            <p className="mt-1 text-xs text-faint">
              Based on today's {currentQuestion?.contextType?.includes('sleep') || currentQuestion?.contextType?.includes('recovery')
                ? 'health data'
                : currentQuestion?.contextType?.includes('sun') || currentQuestion?.contextType?.includes('light')
                  ? 'weather'
                  : 'context'}
            </p>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation + Write/Speak actions */}
      <div className="mt-3.5 flex items-center gap-2">
        {questions.length > 1 && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={goPrev}
              disabled={isEditing}
              aria-label="Previous prompt"
              className="cloud-icon-button disabled:opacity-50"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={isEditing}
              aria-label="Next prompt"
              className="cloud-icon-button disabled:opacity-50"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="flex flex-1 gap-2">
          <motion.button
            type="button"
            onClick={() => onWritePrompt?.(currentQuestion?.question)}
            disabled={isEditing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-accent-deep py-2.5 text-[13px] font-medium text-background disabled:opacity-50"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <PenLine size={13} />
            Write
          </motion.button>
          <motion.button
            type="button"
            onClick={() => onVoicePrompt?.(currentQuestion?.question)}
            disabled={isEditing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card py-2.5 text-[13px] font-medium text-accent-deep disabled:opacity-50"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Mic size={13} />
            Speak
          </motion.button>
        </div>
      </div>
    </Card>
  );
};

export default PromptWidget;
