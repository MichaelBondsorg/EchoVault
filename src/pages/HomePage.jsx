import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useDashboardLayout } from '../hooks';
import { BentoGrid, WidgetDrawer } from '../components/zen';

/**
 * HomePage - Customizable Bento dashboard
 *
 * Default state: Hero + Prompt widgets only (minimalist Zen approach)
 * Users can add more widgets via the Customize feature.
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
    onWritePrompt: (prompt) => {
      setEntryPreferredMode?.('text');
      setReplyContext?.(prompt);
    },
    onVoicePrompt: (prompt) => {
      setEntryPreferredMode?.('voice');
      setReplyContext?.(prompt);
    },
    onToggleTask,
  };

  // Handle add widget button in edit mode
  const handleAddClick = () => {
    setShowWidgetDrawer(true);
  };

  if (isLoading) {
    return (
      <motion.div
        className="px-4 py-8 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="text-warm-500 text-sm">Loading your dashboard...</div>
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
            w-full mt-3 py-3 px-4
            bg-primary-100 hover:bg-primary-200
            border-2 border-dashed border-primary-300
            rounded-2xl
            text-primary-600 font-medium text-sm
            flex items-center justify-center gap-2
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
          className="mt-6 p-4 bg-primary-50/50 backdrop-blur-sm rounded-2xl text-sm text-primary-800 text-center border border-primary-100"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <p className="font-medium mb-1">Welcome to your sanctuary</p>
          <p className="text-primary-600 text-xs">
            Tap the + button below to add your first entry
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default HomePage;
