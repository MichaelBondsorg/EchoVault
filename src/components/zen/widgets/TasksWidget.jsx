import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckSquare, Square, Check, X } from 'lucide-react';
import GlassCard from '../GlassCard';
import { getFlag } from '../../../config/flags';
import { db } from '../../../config/firebase';
import { useUser } from '../../../stores';
import {
  subscribeActiveTaskIntents,
  completeIntent,
  dismissIntent,
} from '../../../services/intents/intentClient';

/**
 * TasksWidget - Pending tasks for Bento dashboard
 *
 * Two sources, chosen by the `intentExtraction` flag:
 *  - flag OFF (legacy): pending tasks parsed from `entry.extracted_tasks`
 *    (byte-identical to the pre-intent behaviour; entries/onToggleTask used).
 *  - flag ON: policy-qualified ACTIVE task intents streamed via
 *    subscribeActiveTaskIntents. Row toggle completes the intent; a small
 *    "Not a task" affordance dismisses it (undo-friendly — it just disappears,
 *    no confirm dialog). entries/onToggleTask are accepted but unused.
 */
const TasksWidget = ({
  entries = [],
  category,
  onToggleTask,
  isEditing = false,
  onDelete,
  size = '1x1',
}) => {
  const useIntents = getFlag('intentExtraction');
  const user = useUser();
  const uid = user?.uid;

  const [activeIntents, setActiveIntents] = useState([]);

  useEffect(() => {
    if (!useIntents || !uid) return undefined;
    const unsubscribe = subscribeActiveTaskIntents(
      db,
      uid,
      setActiveIntents,
      () => setActiveIntents([]),
    );
    return unsubscribe;
  }, [useIntents, uid]);

  // Legacy source: pending tasks from recent entries.
  const legacyTasks = useMemo(() => {
    const allTasks = [];

    entries.slice(0, 20).forEach(entry => {
      if (entry.extracted_tasks && Array.isArray(entry.extracted_tasks)) {
        entry.extracted_tasks.forEach((task, index) => {
          if (!task.completed) {
            allTasks.push({
              id: `${entry.id}-${index}`,
              text: typeof task === 'string' ? task : task.text,
              entryId: entry.id,
              index,
              completed: false,
            });
          }
        });
      }
    });

    return allTasks.slice(0, 4); // Show max 4 tasks
  }, [entries]);

  // Intent source: policy-qualified active task intents.
  const intentTasks = useMemo(() => (
    activeIntents.slice(0, 4).map((intent, index) => ({
      id: intent.id,
      intentId: intent.id,
      text: intent.sourceSpan?.text || '',
      index,
      completed: false,
    }))
  ), [activeIntents]);

  const tasks = useIntents ? intentTasks : legacyTasks;

  const handleToggle = (task) => {
    if (isEditing) return;
    if (useIntents) {
      if (uid) completeIntent(db, uid, task.intentId);
      return;
    }
    onToggleTask?.(task.text, task.entryId, task.index);
  };

  const handleDismiss = (task) => {
    if (isEditing || !uid) return;
    dismissIntent(db, uid, task.intentId);
  };

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 text-warm-500 mb-2">
          <CheckSquare size={16} />
          <span className="text-xs font-medium">Tasks</span>
        </div>

        {/* Tasks list */}
        <div className="flex-1 overflow-hidden">
          {tasks.length > 0 ? (
            <ul className="space-y-1.5">
              {tasks.map((task, index) => (
                <motion.li
                  key={task.id}
                  className="flex items-start gap-2 group"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(task)}
                    disabled={isEditing}
                    aria-label={`Complete: ${task.text}`}
                    className="
                      relative mt-0.5 w-4 h-4 rounded shrink-0
                      border border-hearth-300
                      flex items-center justify-center
                      hover:border-honey-400 hover:bg-honey-50
                      transition-colors
                      before:absolute before:-inset-3.5 before:content-['']
                    "
                  >
                    {task.completed && <Check size={10} className="text-sage-600" />}
                  </button>
                  <span className="text-xs text-warm-600 line-clamp-2 flex-1">
                    {task.text}
                  </span>
                  {useIntents && !isEditing && (
                    <button
                      type="button"
                      onClick={() => handleDismiss(task)}
                      title="Not a task"
                      aria-label="Not a task"
                      className="
                        relative mt-0.5 w-4 h-4 rounded shrink-0
                        text-warm-300 hover:text-warm-500
                        opacity-0 group-hover:opacity-100
                        pointer-coarse:opacity-100 focus-visible:opacity-100
                        flex items-center justify-center
                        transition-opacity
                        before:absolute before:-inset-3.5 before:content-['']
                      "
                    >
                      <X size={10} />
                    </button>
                  )}
                </motion.li>
              ))}
            </ul>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-warm-400 text-center">
                No pending tasks
              </p>
            </div>
          )}
        </div>

        {/* More indicator */}
        {tasks.length === 4 && (
          <p className="text-xs text-warm-400 text-center mt-1">
            + more in journal
          </p>
        )}
      </div>
    </GlassCard>
  );
};

export default TasksWidget;
