// Bento Widgets
export { default as HeroWidget } from './HeroWidget';
export { default as PromptWidget } from './PromptWidget';
export { default as MiniStatsWidget } from './MiniStatsWidget';
export { default as TasksWidget } from './TasksWidget';
export { default as GoalsWidget } from './GoalsWidget';

// Widget type to component mapping
import HeroWidget from './HeroWidget';
import PromptWidget from './PromptWidget';
import MiniStatsWidget from './MiniStatsWidget';
import TasksWidget from './TasksWidget';
import GoalsWidget from './GoalsWidget';

export const WIDGET_COMPONENTS = {
  hero: HeroWidget,
  prompt: PromptWidget,
  stats: MiniStatsWidget,
  tasks: TasksWidget,
  goals: GoalsWidget,
  // Future widgets
  trend: null,
  digest: null,
  timeline: null,
};

/**
 * Get widget component by type
 * @param {string} type - Widget type
 * @returns {React.Component|null}
 */
export const getWidgetComponent = (type) => {
  return WIDGET_COMPONENTS[type] || null;
};
