/**
 * What's Next Evaluator
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 1 (Task 1.2): Define NextAction, NextActionTarget, WhatsNextResult interfaces
 * Task Group 3 (Task 3.2): Implement evaluateNextActions
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 1 (Tasks 1.1, 1.2): Refactor NextAction into PanelAction | ModalAction
 * discriminated union; update DEFINE_TECH_STACK_ACTION and REFRESH_TECH_STANDARDS_ACTION
 * to ModalAction shape.
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 2 (Task 2.1): Add PickerAction variant to NextAction union.
 * Task Group 3 (Task 3.1): Add START_IMPLEMENTATION_ACTION constant and include in evaluator.
 *
 * Pure, synchronous evaluator function that takes a ProjectSignals snapshot
 * and returns a deterministic WhatsNextResult with up to 5 recommended actions.
 * This module has zero side effects and no I/O.
 */

import { ProjectSignals } from './projectSignals';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Routing target for a panel action that navigates to a specific screen/tab.
 */
export interface PanelActionTarget {
  /** Target view identifier: 'dashboard' | 'product' | 'metamodel' */
  screen: string;
  /** Optional tab within the target view (e.g., 'product', 'roadmap') */
  tab?: string;
  /** Persona ID to activate on the target screen */
  personaId: string;
  /** Task ID to auto-select after persona switch (optional) */
  taskId?: string;
}

/**
 * Minimal target for a modal action (display/badge only, no routing fields).
 */
export interface ModalActionTarget {
  /** Persona ID for display/badge purposes */
  personaId: string;
}

/**
 * A recommended action that opens a RHS panel with persona/task navigation.
 */
export interface PanelAction {
  /** Unique action identifier (e.g., 'define-mission') */
  id: string;
  /** Human-readable action label */
  label: string;
  /** 1-2 sentence reason why this action is recommended */
  reason: string;
  /** Numeric priority (higher = more important, used for ordering) */
  priority: number;
  /** Launch mode: opens the RHS panel */
  launch: 'panel';
  /** Routing target for the panel action */
  target: PanelActionTarget;
}

/**
 * A recommended action that opens a modal dialog directly.
 */
export interface ModalAction {
  /** Unique action identifier (e.g., 'define-tech-stack') */
  id: string;
  /** Human-readable action label */
  label: string;
  /** 1-2 sentence reason why this action is recommended */
  reason: string;
  /** Numeric priority (higher = more important, used for ordering) */
  priority: number;
  /** Launch mode: opens a modal dialog */
  launch: 'modal';
  /** Identifier for the modal to open (e.g., 'generate-standards') */
  modalId: string;
  /** Minimal target for display/badge purposes */
  target: ModalActionTarget;
}

/** Minimal target for a picker action (display/badge only, navigation deferred). */
export interface PickerActionTarget {
  /** Persona ID for display/badge purposes */
  personaId: string;
}

/** A recommended action that triggers an inline work item picker flow. */
export interface PickerAction {
  /** Unique action identifier */
  id: string;
  /** Human-readable action label */
  label: string;
  /** 1-2 sentence reason why this action is recommended */
  reason: string;
  /** Numeric priority */
  priority: number;
  /** Launch mode: triggers the implement picker flow */
  launch: 'implementPicker';
  /** Minimal target for display/badge purposes */
  target: PickerActionTarget;
}

/**
 * A single recommended next action for the user.
 * Discriminated union on the `launch` field: 'panel', 'modal', or 'implementPicker'.
 */
export type NextAction = PanelAction | ModalAction | PickerAction;

/**
 * Result of evaluating the next recommended actions for a project.
 */
export interface WhatsNextResult {
  /** Human-readable explanation of the current project state */
  explanation: string;
  /** Ordered array of recommended actions (max 5, sorted by priority descending) */
  actions: NextAction[];
}

// ============================================================================
// Action Constants (Spec Section 6: Action Catalog)
// ============================================================================

const DEFINE_MISSION_ACTION: PanelAction = {
  id: 'define-mission',
  label: 'Define Product Mission',
  reason: 'A product mission is the foundation for all other activities. Define it first to guide roadmap, architecture, and standards decisions.',
  priority: 100,
  target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
  launch: 'panel',
};

const DEFINE_TECH_STACK_ACTION: ModalAction = {
  id: 'define-tech-stack',
  label: 'Define Tech Stack',
  reason: 'Establishing technology standards early ensures consistent architectural decisions across the project.',
  priority: 80,
  launch: 'modal',
  modalId: 'generate-standards',
  target: { personaId: 'architect' },
};

const DEFINE_ARCHITECTURE_ACTION: PanelAction = {
  id: 'define-architecture',
  label: 'Define Architecture Baseline',
  reason: 'An architecture baseline captures the key services, interfaces, and data entities that form the structural foundation of your system.',
  priority: 75,
  target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' },
  launch: 'panel',
};

const DEFINE_USERS_INTERACTIONS_ACTION: PanelAction = {
  id: 'define-users-interactions',
  label: 'Define Users & Interactions',
  reason: 'Defining user roles, business activities, and UI screens ensures the product design is grounded in real user needs.',
  priority: 65,
  target: { screen: 'metamodel', personaId: 'ux-designer', taskId: 'ux-designer--ui-domain' },
  launch: 'panel',
};

const DEFINE_ROADMAP_ACTION: PanelAction = {
  id: 'define-roadmap',
  label: 'Define Product Roadmap',
  reason: 'A roadmap of initiatives and epics gives the team a clear direction and helps prioritize upcoming work.',
  priority: 55,
  target: { screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' },
  launch: 'panel',
};

const DEFINE_TEST_STRATEGY_ACTION: PanelAction = {
  id: 'define-test-strategy',
  label: 'Define Test Strategy',
  reason: 'A test strategy ensures quality is built in from the start, covering functional, integration, and end-to-end testing approaches.',
  priority: 50,
  target: { screen: 'metamodel', personaId: 'test-engineer', taskId: 'test-engineer--test-strategy' },
  launch: 'panel',
};

const REVIEW_ROADMAP_ACTION: PanelAction = {
  id: 'review-roadmap',
  label: 'Review/Update Roadmap',
  reason: 'Periodically reviewing the roadmap ensures initiatives and epics stay aligned with evolving business priorities.',
  priority: 40,
  target: { screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' },
  launch: 'panel',
};

const REVIEW_ARCHITECTURE_ACTION: PanelAction = {
  id: 'review-architecture',
  label: 'Review/Update Architecture Baseline',
  reason: 'As the project evolves, the architecture model may need updates to reflect new services, interfaces, or data entities.',
  priority: 35,
  target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' },
  launch: 'panel',
};

const REFRESH_TECH_STANDARDS_ACTION: ModalAction = {
  id: 'refresh-tech-standards',
  label: 'Refresh Tech Standards',
  reason: 'Technology standards should be reviewed periodically to incorporate new tools, frameworks, or best practices.',
  priority: 30,
  launch: 'modal',
  modalId: 'generate-standards',
  target: { personaId: 'architect' },
};

const START_IMPLEMENTATION_ACTION: PickerAction = {
  id: 'start-implementation',
  label: 'Start Implementation',
  reason: 'All foundational artifacts are in place. Pick a feature or story to begin implementation.',
  priority: 45,
  launch: 'implementPicker',
  target: { personaId: 'developer' },
};

// ============================================================================
// Evaluator Function
// ============================================================================

/**
 * Evaluates the current project signals and returns a deterministic set of
 * up to 5 recommended next actions, sorted by priority descending.
 *
 * Three-branch logic:
 * 1. Hard rule: No mission => only "Define Product Mission" action
 * 2. Bootstrap checks: Push missing items in priority order, return if any found
 * 3. Optimisation: Push review/refresh actions for fully bootstrapped projects
 *
 * @param signals - The current project state signals
 * @returns A WhatsNextResult with explanation and ordered actions
 */
export function evaluateNextActions(signals: ProjectSignals): WhatsNextResult {
  const actions: NextAction[] = [];

  // ===== HARD RULE: No mission =====
  if (!signals.missionExists) {
    actions.push(DEFINE_MISSION_ACTION);
    return {
      explanation: 'Your project does not yet have a Product Mission defined. This is the essential first step before any other work can begin.',
      actions,
    };
  }

  // ===== BOOTSTRAP CHECKS (in priority order) =====

  if (!signals.techStandardsExists) {
    actions.push(DEFINE_TECH_STACK_ACTION);
  }

  if (!signals.architectureBaselineExists) {
    actions.push(DEFINE_ARCHITECTURE_ACTION);
  }

  if (!signals.usersAndInteractionsExists) {
    actions.push(DEFINE_USERS_INTERACTIONS_ACTION);
  }

  if (!signals.roadmapExists) {
    actions.push(DEFINE_ROADMAP_ACTION);
  }

  if (!signals.testStrategyExists) {
    actions.push(DEFINE_TEST_STRATEGY_ACTION);
  }

  // If any bootstrap items are missing, return those (up to 5)
  if (actions.length > 0) {
    const missingCount = actions.length;
    return {
      explanation: `Your project has a mission defined but is missing ${missingCount} foundational artifact${missingCount > 1 ? 's' : ''}. Complete these to establish a solid project foundation.`,
      actions: actions.slice(0, 5),
    };
  }

  // ===== ALL BOOTSTRAP COMPLETE: OPTIMISATION ACTIONS =====

  actions.push(START_IMPLEMENTATION_ACTION);   // priority 45
  actions.push(REVIEW_ROADMAP_ACTION);         // priority 40
  actions.push(REVIEW_ARCHITECTURE_ACTION);    // priority 35
  actions.push(REFRESH_TECH_STANDARDS_ACTION); // priority 30

  // NOTE: "Refine Backlog" omitted -- Backlog screen has no UnifiedChatPanel in v1
  // NOTE: "Review Delivery Status" omitted -- delivery signals unavailable in v1

  return {
    explanation: 'All foundational artifacts are in place. Here are some actions to keep your project healthy and up to date.',
    actions: actions.slice(0, 5),
  };
}
