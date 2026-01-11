import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckSquare, Square, Check } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * TasksWidget - Pending tasks for Bento dashboard
 *
 * Shows extracted tasks from recent entries
 */
const TasksWidget = ({
  entries = [],
  category,
  onToggleTask,
  isEditing = false,
  onDelete,
  size = '1x1',
}) => {
  // Extract pending tasks from entries
  const tasks = useMemo(() => {
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

  const handleToggle = (task) => {
    if (isEditing) return;
    onToggleTask?.(task.text, task.entryId, task.index);
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
                  className="flex items-start gap-2"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <button
                    onClick={() => handleToggle(task)}
                    disabled={isEditing}
                    className="
                      mt-0.5 w-4 h-4 rounded
                      border border-warm-300
                      flex items-center justify-center
                      hover:border-primary-400 hover:bg-primary-50
                      transition-colors
                    "
                  >
                    {task.completed && <Check size={10} className="text-primary-600" />}
                  </button>
                  <span className="text-xs text-warm-600 line-clamp-2 flex-1">
                    {task.text}
                  </span>
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
