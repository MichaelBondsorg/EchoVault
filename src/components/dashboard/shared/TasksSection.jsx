import React from 'react';
import { CheckSquare } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';
import FeedbackLoop from './FeedbackLoop';

/**
 * TasksSection - Collapsible section for tasks with completion tracking
 *
 * Displays tasks from today and carried forward from yesterday
 * Uses FeedbackLoop for individual task completion with confetti
 */

const TasksSection = ({
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

  // Don't render if no tasks
  if (allTasks.length === 0) return null;

  const totalCount = tasks.length + carriedForward.length;
  const carriedCount = carriedForward.length;

  return (
    <CollapsibleSection
      title="Tasks"
      icon={CheckSquare}
      colorScheme="blue"
      defaultExpanded={false}
      badge={carriedCount > 0 ? `${carriedCount} carried` : null}
    >
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

        {/* Show remaining count if truncated */}
        {totalCount > maxDisplay && (
          <div className="text-xs text-lavender-500 dark:text-lavender-400 text-center pt-2">
            +{totalCount - maxDisplay} more task{totalCount - maxDisplay !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export default TasksSection;
