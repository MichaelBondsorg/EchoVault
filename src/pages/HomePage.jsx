import { useState } from 'react';
import { motion } from 'framer-motion';
import { DayDashboard } from '../components';
import { ReflectionPrompts } from '../components/dashboard/shared';

/**
 * HomePage - Main dashboard with Bento grid layout
 *
 * This is the minimal default view showing only:
 * - HeroWidget (greeting/status)
 * - PromptWidget (reflection prompts)
 *
 * Additional widgets can be added via the Customize feature.
 */
const HomePage = ({
  entries,
  category,
  userId,
  user,
  onPromptClick,
  onToggleTask,
  onShowInsights,
  onStartRecording,
  onStartTextEntry,
  setEntryPreferredMode,
  setReplyContext,
}) => {
  return (
    <motion.div
      className="px-4 pb-8 space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Reflection Prompts - Core widget for new users */}
      {entries.length >= 2 && (
        <ReflectionPrompts
          entries={entries}
          category={category}
          onWritePrompt={(prompt) => {
            setEntryPreferredMode?.('text');
            setReplyContext?.(prompt);
          }}
          onVoicePrompt={(prompt) => {
            setEntryPreferredMode?.('voice');
            setReplyContext?.(prompt);
          }}
        />
      )}

      {/* Day Dashboard - Adapts to time of day */}
      <DayDashboard
        entries={entries}
        category={category}
        userId={userId}
        user={user}
        onPromptClick={onPromptClick}
        onToggleTask={onToggleTask}
        onShowInsights={onShowInsights}
        onStartRecording={onStartRecording}
        onStartTextEntry={onStartTextEntry}
      />

      {/* Customize button - Entry point to edit mode */}
      <motion.button
        className="
          w-full py-3 px-4
          bg-white/30 backdrop-blur-sm
          border border-white/20
          rounded-2xl
          text-warm-500 font-medium text-sm
          flex items-center justify-center gap-2
          hover:bg-white/40 transition-colors
        "
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        Customize your dashboard
      </motion.button>
    </motion.div>
  );
};

export default HomePage;
