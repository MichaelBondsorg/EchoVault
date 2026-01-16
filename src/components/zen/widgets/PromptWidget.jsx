import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Mic, PenLine, ChevronLeft, ChevronRight, X, Sparkles, AlertCircle, Sun, Moon, Zap } from 'lucide-react';
import GlassCard from '../GlassCard';
import { getQuickContextInsights } from '../../../services/nexus/insightIntegration';

/**
 * PromptWidget - Reflection prompts for Bento dashboard
 *
 * RESTORED: Uses follow-up questions from entries' contextualInsight
 * These are the insightful, personalized questions based on journal history.
 *
 * ENHANCED: Also shows context-aware prompts based on health/environment data.
 */
const PromptWidget = ({
  entries = [],
  category,
  onWritePrompt,
  onVoicePrompt,
  isEditing = false,
  onDelete,
  size = '2x1',
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
      return fallbacks.map((q, i) => ({ question: q, entryId: null, entryDate: null, isContext: false }));
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
  const isHighPriority = currentQuestion?.priority === 'high';

  // Get icon and label based on prompt type
  const getPromptDisplay = () => {
    if (isContextPrompt) {
      const type = currentQuestion?.contextType || '';
      if (type.includes('sleep') || type.includes('recovery')) {
        return {
          icon: Moon,
          label: isHighPriority ? 'Check In' : 'Context',
          colorClass: 'text-indigo-600',
          bgClass: isHighPriority ? 'bg-gradient-to-br from-indigo-50/70 to-purple-50/70' : undefined
        };
      }
      if (type.includes('sun') || type.includes('light') || type.includes('environment')) {
        return {
          icon: Sun,
          label: isHighPriority ? 'Today' : 'Context',
          colorClass: 'text-amber-600',
          bgClass: isHighPriority ? 'bg-gradient-to-br from-amber-50/70 to-orange-50/70' : undefined
        };
      }
      if (type.includes('energy') || type.includes('strain')) {
        return {
          icon: Zap,
          label: 'Energy',
          colorClass: 'text-green-600',
          bgClass: isHighPriority ? 'bg-gradient-to-br from-green-50/70 to-emerald-50/70' : undefined
        };
      }
      return {
        icon: AlertCircle,
        label: isHighPriority ? 'Check In' : 'Context',
        colorClass: 'text-blue-600',
        bgClass: isHighPriority ? 'bg-gradient-to-br from-blue-50/70 to-cyan-50/70' : undefined
      };
    }
    if (isPersonalized) {
      return { icon: Sparkles, label: 'Reflect', colorClass: 'text-secondary-600' };
    }
    return { icon: MessageCircle, label: 'Prompt', colorClass: 'text-secondary-600' };
  };

  const promptDisplay = getPromptDisplay();
  const PromptIcon = promptDisplay.icon;

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
      className={promptDisplay.bgClass || "bg-gradient-to-br from-secondary-50/50 to-primary-50/50"}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className={`flex items-center gap-2 ${promptDisplay.colorClass}`}>
            <PromptIcon size={14} />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {promptDisplay.label}
            </span>
            {isHighPriority && (
              <span className="text-[10px] px-1.5 py-0.5 bg-white/60 rounded-full font-medium">
                {currentQuestion?.trigger || 'today'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {questions.length > 1 && (
              <span className="text-xs text-warm-400 mr-1">
                {currentIndex + 1}/{questions.length}
              </span>
            )}
            {(isPersonalized || isContextPrompt) && !isEditing && (
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
            {isContextPrompt && (
              <p className="text-xs text-warm-400 mt-1">
                Based on today's {currentQuestion?.contextType?.includes('sleep') || currentQuestion?.contextType?.includes('recovery')
                  ? 'health data'
                  : currentQuestion?.contextType?.includes('sun') || currentQuestion?.contextType?.includes('light')
                    ? 'weather'
                    : 'context'}
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
