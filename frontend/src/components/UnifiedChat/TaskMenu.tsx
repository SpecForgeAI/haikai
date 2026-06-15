/**
 * TaskMenu Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 6, Task 6.3: Create TaskMenu component
 *
 * Renders a list of tasks as clickable cards within a chat message bubble.
 * Each card shows the task's menuLabel as primary text and description as
 * secondary text. Clicking a card calls `onSelectTask(taskId)`.
 *
 * Used inline within MessageBubble when a structuredResponse has
 * type === 'task-menu'.
 */

import styles from './TaskMenu.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface TaskMenuItem {
  /** Task identifier */
  taskId: string;
  /** Short label for the task shown as primary text */
  menuLabel: string;
  /** Longer description shown as secondary text */
  description: string;
}

export interface TaskMenuProps {
  /** Array of tasks to display as clickable cards */
  tasks: TaskMenuItem[];
  /** Callback when a task card is clicked */
  onSelectTask: (taskId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export function TaskMenu({ tasks, onSelectTask }: TaskMenuProps) {
  return (
    <div className={styles.container} data-testid="task-menu">
      {tasks.map((task) => (
        <button
          key={task.taskId}
          type="button"
          className={styles.taskCard}
          onClick={() => onSelectTask(task.taskId)}
          data-testid={`task-card-${task.taskId}`}
        >
          <span className={styles.menuLabel}>{task.menuLabel}</span>
          <span className={styles.description}>{task.description}</span>
        </button>
      ))}
    </div>
  );
}
