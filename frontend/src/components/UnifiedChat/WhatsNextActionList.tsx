/**
 * WhatsNextActionList Component
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 6, Task 6.3: Create WhatsNextActionList component
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 3, Task 3.1: Update NextAction type to discriminated union
 * - Replaced single NextAction interface with PanelAction | ModalAction union
 * - launch field narrowed from string to 'panel' | 'modal'
 * - ModalAction has modalId and minimal target (personaId only)
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 6, Task 6.1: Add PickerAction variant to NextAction union
 * - Added PickerAction with launch: 'implementPicker' and minimal target
 * - NextAction is now PanelAction | ModalAction | PickerAction
 *
 * Renders the "whats-next-actions" structured response as a vertical list
 * of clickable cards. Each card shows the action's label as primary text
 * and reason as secondary text. Clicking a card calls `onActionClick(action)`.
 *
 * Used inline within MessageBubble when a structuredResponse has
 * type === 'whats-next-actions'.
 */

import styles from './WhatsNextActionList.module.css';

// ============================================================================
// Types
// ============================================================================

interface BaseAction {
  /** Unique action identifier (e.g., 'define-mission') */
  id: string;
  /** Human-readable action label */
  label: string;
  /** 1-2 sentence reason why this action is recommended */
  reason: string;
  /** Numeric priority (higher = more important, used for ordering) */
  priority: number;
}

export interface PanelAction extends BaseAction {
  /** Launch mode: opens a RHS panel workflow */
  launch: 'panel';
  /** Routing target for the panel action */
  target: { screen: string; tab?: string; personaId: string; taskId?: string };
}

export interface ModalAction extends BaseAction {
  /** Launch mode: opens a modal directly */
  launch: 'modal';
  /** Identifier of the modal to open (e.g., 'generate-standards') */
  modalId: string;
  /** Minimal target for display/badge purposes (no routing fields) */
  target: { personaId: string };
}

export interface PickerAction extends BaseAction {
  /** Launch mode: triggers inline work item picker */
  launch: 'implementPicker';
  /** Minimal target for display/badge purposes */
  target: { personaId: string };
}

export type NextAction = PanelAction | ModalAction | PickerAction;

// ============================================================================
// Props Interface
// ============================================================================

interface WhatsNextActionListProps {
  /** Human-readable explanation of the current project state */
  explanation: string;
  /** Ordered array of recommended actions */
  actions: NextAction[];
  /** Callback when an action card is clicked */
  onActionClick: (action: NextAction) => void;
}

// ============================================================================
// Component
// ============================================================================

export function WhatsNextActionList({ explanation, actions, onActionClick }: WhatsNextActionListProps) {
  return (
    <div data-testid="whats-next-action-list">
      <p className={styles.explanation}>{explanation}</p>
      <div className={styles.container}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={styles.actionCard}
            onClick={() => onActionClick(action)}
            data-testid={`whats-next-action-${action.id}`}
          >
            <span className={styles.actionLabel}>{action.label}</span>
            <span className={styles.actionReason}>{action.reason}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
