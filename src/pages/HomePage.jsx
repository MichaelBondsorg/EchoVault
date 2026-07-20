import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useDashboardLayout } from '../hooks';
import { BentoGrid, WidgetDrawer } from '../components/zen';

/**
 * HomePage - Customizable Bento dashboard (CLOUD-DESIGN-SPEC.md §7 Home)
 *
 * Default state: serif greeting -> Reflect card -> 3 stat cells -> mood-
 * trend bar card -> Recent list. Users can still add more widgets (Goals,
 * Tasks, Ongoing Stories, AI Insights) via the Customize feature.
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
  onPromptResponse, // Opens entry modal with prompt context
  onDayClick, // Opens day summary modal from 30-day journey / Recent list
  onAnswerLoop, // Opens entry modal with an open-loop's quiet context chip (OpenLoopsWidget)
}) => {
  const [showWidgetDrawer, setShowWidgetDrawer] = useState(false);

  // Dashboard layout state management
  const {
    layout,
    availableWidgets,
    isLoading,
    isEditMode,
    addWidget,
    removeWidget,
    reorderWidgets,
    toggleEditMode,
    exitEditMode,
  } = useDashboardLayout(userId);

  // Props to pass to all widgets
  const widgetProps = {
    user,
    entries,
    category,
    // Reflection prompts - open entry modal with reply context
    onWritePrompt: (prompt) => onPromptResponse?.(prompt, 'text'),
    onVoicePrompt: (prompt) => onPromptResponse?.(prompt, 'voice'),
    onToggleTask,
    // 30-day journey / Recent list - open day summary modal
    onDayClick,
    // Open Loops "Answer" - open entry modal with a quiet follow-up chip
    onAnswerLoop,
  };

  // Handle add widget button in edit mode
  const handleAddClick = () => {
    setShowWidgetDrawer(true);
  };

  if (isLoading) {
    return (
      <motion.div
        className="flex items-center justify-center px-4 py-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="text-sm text-muted-foreground">Loading your dashboard...</div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="px-4 pb-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Bento Grid with customizable widgets */}
      <BentoGrid
        layout={layout}
        isEditing={isEditMode}
        onReorder={reorderWidgets}
        onRemove={removeWidget}
        onToggleEdit={toggleEditMode}
        widgetProps={widgetProps}
      />

      {/* Add Widget Button (visible in edit mode) */}
      {isEditMode && availableWidgets.length > 0 && (
        <motion.button
          onClick={handleAddClick}
          className="
            mt-3 flex w-full items-center justify-center gap-2
            rounded-2xl border-2 border-dashed border-border
            bg-card py-3 px-4
            text-sm font-medium text-accent-deep
            transition-colors
          "
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Plus size={18} />
          Add Widget
        </motion.button>
      )}

      {/* Widget Drawer for adding widgets */}
      <WidgetDrawer
        isOpen={showWidgetDrawer}
        onClose={() => setShowWidgetDrawer(false)}
        availableWidgets={availableWidgets}
        onAddWidget={addWidget}
      />

      {/* Install Prompt for new users (no entries) */}
      {entries.length === 0 && !isEditMode && (
        <motion.div
          className="mt-6 rounded-2xl border border-border bg-card p-4 text-center text-sm text-secondary-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <p className="mb-1 font-display font-medium text-foreground">Welcome to your sanctuary</p>
          <p className="text-xs text-muted-foreground">
            Tap the + button below to add your first entry
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default HomePage;
