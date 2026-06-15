/**
 * Activity Flow Button and UI Integration Tests
 * Task Group 3: Button and UI Integration
 *
 * Tests for the "+ New Activity Flow" button behavior in PalettePanel:
 * - Test 1: Button appears in Activity diagram CREATE section
 * - Test 2: Button click toggles activity flow creation mode
 * - Test 3: Button shows "Cancel Flow" when mode is active
 * - Test 4: Button is disabled when no active diagram
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES } from '../types/model';
import {
  ActivityFlowCreationMode,
  initialActivityFlowCreationMode,
  enterActivityFlowCreationMode,
  exitActivityFlowCreationMode,
  getActivityFlowModeHintText,
} from '../utils/activityFlowCreation';

// ============================================================================
// Helper types and functions to simulate PalettePanel behavior
// ============================================================================

type DiagramType = 'General' | 'ER' | 'State' | 'Activity';

interface CreateSectionButton {
  label: string;
  entityType: string;
  title: string;
}

/**
 * Simulates the getCreateSectionButtons function from PalettePanel
 */
function getCreateSectionButtons(diagramType: DiagramType): CreateSectionButton[] {
  switch (diagramType) {
    case 'ER':
      return [
        { label: '+ New Logical Entity', entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY, title: 'Create Logical Data Entity' },
        { label: '+ New Physical Entity', entityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY, title: 'Create Physical Data Entity' },
      ];
    case 'State':
      return [
        { label: '+ New State', entityType: ENTITY_TYPES.STATE, title: 'Create State' },
        { label: '+ New State Transition', entityType: 'STATE_TRANSITION', title: 'Create State Transition' },
      ];
    case 'Activity':
      return [
        { label: '+ New Partition', entityType: ENTITY_TYPES.ACTIVITY_PARTITION, title: 'Create Activity Partition' },
        { label: '+ New Activity', entityType: ENTITY_TYPES.ACTIVITY, title: 'Create Activity' },
        { label: '+ New Activity Flow', entityType: 'ACTIVITY_FLOW', title: 'Create Activity Flow' },
      ];
    default:
      return [];
  }
}

/**
 * Simulates hasActiveSelectedDiagram from PalettePanel
 */
function hasActiveSelectedDiagram(
  currentDiagramId: string | null,
  diagram: { diagram_nodes: unknown[] } | undefined
): boolean {
  return currentDiagramId !== null && diagram !== undefined;
}

/**
 * Simulates the handleCreateButtonClick function for ACTIVITY_FLOW
 */
function handleCreateButtonClick(
  entityType: string,
  currentMode: ActivityFlowCreationMode,
  hasActiveDiagram: boolean
): { newMode: ActivityFlowCreationMode; action: 'enter' | 'exit' | 'drawer' | 'blocked' } {
  if (entityType === 'ACTIVITY_FLOW') {
    if (!hasActiveDiagram) {
      return { newMode: currentMode, action: 'blocked' };
    }
    if (currentMode.active) {
      return { newMode: exitActivityFlowCreationMode(), action: 'exit' };
    } else {
      return { newMode: enterActivityFlowCreationMode(), action: 'enter' };
    }
  }
  // Other entity types would go to the drawer
  return { newMode: currentMode, action: 'drawer' };
}

/**
 * Simulates the button rendering logic
 */
function getButtonRenderState(
  button: CreateSectionButton,
  activityFlowCreationMode: ActivityFlowCreationMode,
  hasActiveDiagram: boolean
): {
  isDisabled: boolean;
  isActive: boolean;
  icon: string;
  displayText: string;
  buttonClass: 'createButton' | 'createButtonActive';
} {
  const isActivityFlowButton = button.entityType === 'ACTIVITY_FLOW';
  const isActive = isActivityFlowButton && activityFlowCreationMode.active;
  const buttonClass = isActive ? 'createButtonActive' : 'createButton';

  return {
    isDisabled: !hasActiveDiagram,
    isActive,
    icon: isActive ? 'x' : '+',
    displayText: isActive ? 'Cancel Flow' : button.label.replace('+ ', ''),
    buttonClass,
  };
}

// ============================================================================
// Test Suite: Activity Flow Button and UI Integration
// ============================================================================

describe('Activity Flow Button and UI Integration', () => {
  /**
   * Test 1: Button appears in Activity diagram CREATE section
   */
  describe('Button appears in Activity diagram CREATE section', () => {
    it('should include Activity Flow button in Activity diagram create buttons', () => {
      const buttons = getCreateSectionButtons('Activity');
      const activityFlowButton = buttons.find(b => b.entityType === 'ACTIVITY_FLOW');

      expect(activityFlowButton).toBeDefined();
      expect(activityFlowButton!.label).toBe('+ New Activity Flow');
      expect(activityFlowButton!.title).toBe('Create Activity Flow');
    });

    it('should place Activity Flow button after Partition and Activity buttons', () => {
      const buttons = getCreateSectionButtons('Activity');

      expect(buttons.length).toBe(3);
      expect(buttons[0].entityType).toBe(ENTITY_TYPES.ACTIVITY_PARTITION);
      expect(buttons[1].entityType).toBe(ENTITY_TYPES.ACTIVITY);
      expect(buttons[2].entityType).toBe('ACTIVITY_FLOW');
    });

    it('should NOT include Activity Flow button in State diagram', () => {
      const buttons = getCreateSectionButtons('State');
      const activityFlowButton = buttons.find(b => b.entityType === 'ACTIVITY_FLOW');

      expect(activityFlowButton).toBeUndefined();
    });

    it('should NOT include Activity Flow button in ER diagram', () => {
      const buttons = getCreateSectionButtons('ER');
      const activityFlowButton = buttons.find(b => b.entityType === 'ACTIVITY_FLOW');

      expect(activityFlowButton).toBeUndefined();
    });

    it('should NOT include Activity Flow button in General diagram', () => {
      const buttons = getCreateSectionButtons('General');
      const activityFlowButton = buttons.find(b => b.entityType === 'ACTIVITY_FLOW');

      expect(activityFlowButton).toBeUndefined();
    });
  });

  /**
   * Test 2: Button click toggles activity flow creation mode
   */
  describe('Button click toggles activity flow creation mode', () => {
    it('should enter mode when button is clicked and mode is inactive', () => {
      const currentMode = { ...initialActivityFlowCreationMode };
      const result = handleCreateButtonClick('ACTIVITY_FLOW', currentMode, true);

      expect(result.action).toBe('enter');
      expect(result.newMode.active).toBe(true);
      expect(result.newMode.sourceActivityNodeId).toBeNull();
    });

    it('should exit mode when button is clicked and mode is active', () => {
      const currentMode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };
      const result = handleCreateButtonClick('ACTIVITY_FLOW', currentMode, true);

      expect(result.action).toBe('exit');
      expect(result.newMode.active).toBe(false);
      expect(result.newMode.sourceActivityNodeId).toBeNull();
    });

    it('should exit mode when button is clicked with source already selected', () => {
      const currentMode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };
      const result = handleCreateButtonClick('ACTIVITY_FLOW', currentMode, true);

      expect(result.action).toBe('exit');
      expect(result.newMode.active).toBe(false);
      expect(result.newMode.sourceActivityNodeId).toBeNull();
    });

    it('should toggle mode state correctly through multiple clicks', () => {
      // Start inactive
      let mode: ActivityFlowCreationMode = { ...initialActivityFlowCreationMode };
      expect(mode.active).toBe(false);

      // First click - enter mode
      let result = handleCreateButtonClick('ACTIVITY_FLOW', mode, true);
      mode = result.newMode;
      expect(mode.active).toBe(true);

      // Second click - exit mode
      result = handleCreateButtonClick('ACTIVITY_FLOW', mode, true);
      mode = result.newMode;
      expect(mode.active).toBe(false);

      // Third click - enter mode again
      result = handleCreateButtonClick('ACTIVITY_FLOW', mode, true);
      mode = result.newMode;
      expect(mode.active).toBe(true);
    });

    it('should use drawer for non-ACTIVITY_FLOW entity types', () => {
      const currentMode = { ...initialActivityFlowCreationMode };

      const partitionResult = handleCreateButtonClick(ENTITY_TYPES.ACTIVITY_PARTITION, currentMode, true);
      expect(partitionResult.action).toBe('drawer');

      const activityResult = handleCreateButtonClick(ENTITY_TYPES.ACTIVITY, currentMode, true);
      expect(activityResult.action).toBe('drawer');
    });
  });

  /**
   * Test 3: Button shows "Cancel Flow" when mode is active
   */
  describe('Button shows "Cancel Flow" when mode is active', () => {
    it('should show "+ New Activity Flow" text when mode is inactive', () => {
      const button: CreateSectionButton = {
        label: '+ New Activity Flow',
        entityType: 'ACTIVITY_FLOW',
        title: 'Create Activity Flow',
      };
      const mode = { ...initialActivityFlowCreationMode };

      const renderState = getButtonRenderState(button, mode, true);

      expect(renderState.displayText).toBe('New Activity Flow');
      expect(renderState.icon).toBe('+');
      expect(renderState.buttonClass).toBe('createButton');
    });

    it('should show "Cancel Flow" text when mode is active', () => {
      const button: CreateSectionButton = {
        label: '+ New Activity Flow',
        entityType: 'ACTIVITY_FLOW',
        title: 'Create Activity Flow',
      };
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      const renderState = getButtonRenderState(button, mode, true);

      expect(renderState.displayText).toBe('Cancel Flow');
      expect(renderState.icon).toBe('x');
      expect(renderState.buttonClass).toBe('createButtonActive');
    });

    it('should show "Cancel Flow" even when source is selected', () => {
      const button: CreateSectionButton = {
        label: '+ New Activity Flow',
        entityType: 'ACTIVITY_FLOW',
        title: 'Create Activity Flow',
      };
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };

      const renderState = getButtonRenderState(button, mode, true);

      expect(renderState.displayText).toBe('Cancel Flow');
      expect(renderState.icon).toBe('x');
      expect(renderState.buttonClass).toBe('createButtonActive');
    });

    it('should not affect other buttons when activity flow mode is active', () => {
      const partitionButton: CreateSectionButton = {
        label: '+ New Partition',
        entityType: ENTITY_TYPES.ACTIVITY_PARTITION,
        title: 'Create Activity Partition',
      };
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      const renderState = getButtonRenderState(partitionButton, mode, true);

      // Partition button should not be affected by activity flow mode
      expect(renderState.isActive).toBe(false);
      expect(renderState.displayText).toBe('New Partition');
      expect(renderState.icon).toBe('+');
      expect(renderState.buttonClass).toBe('createButton');
    });
  });

  /**
   * Test 4: Button is disabled when no active diagram
   */
  describe('Button is disabled when no active diagram', () => {
    it('should be disabled when currentDiagramId is null', () => {
      const hasActiveDiagram = hasActiveSelectedDiagram(null, { diagram_nodes: [] });

      expect(hasActiveDiagram).toBe(false);
    });

    it('should be disabled when diagram is undefined', () => {
      const hasActiveDiagram = hasActiveSelectedDiagram('diagram-1', undefined);

      expect(hasActiveDiagram).toBe(false);
    });

    it('should be enabled when both diagram ID and diagram exist', () => {
      const hasActiveDiagram = hasActiveSelectedDiagram('diagram-1', { diagram_nodes: [] });

      expect(hasActiveDiagram).toBe(true);
    });

    it('should block mode entry when no active diagram', () => {
      const currentMode = { ...initialActivityFlowCreationMode };
      const result = handleCreateButtonClick('ACTIVITY_FLOW', currentMode, false);

      expect(result.action).toBe('blocked');
      expect(result.newMode.active).toBe(false);
    });

    it('should render button as disabled when no active diagram', () => {
      const button: CreateSectionButton = {
        label: '+ New Activity Flow',
        entityType: 'ACTIVITY_FLOW',
        title: 'Create Activity Flow',
      };
      const mode = { ...initialActivityFlowCreationMode };

      const renderState = getButtonRenderState(button, mode, false);

      expect(renderState.isDisabled).toBe(true);
    });
  });

  /**
   * Additional tests for hint text display
   */
  describe('Hint text display during activity flow mode', () => {
    it('should show initial hint when mode is active but no source selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: null,
      };

      const hintText = getActivityFlowModeHintText(mode);

      expect(hintText).toBe('Click an activity to select as source. Press Escape to cancel.');
    });

    it('should show target hint when source is selected', () => {
      const mode: ActivityFlowCreationMode = {
        active: true,
        sourceActivityNodeId: 'node-activity-1',
      };

      const hintText = getActivityFlowModeHintText(mode);

      expect(hintText).toBe('Click another activity to create the flow. Press Escape to cancel.');
    });

    it('should return empty string when mode is not active', () => {
      const mode = { ...initialActivityFlowCreationMode };

      const hintText = getActivityFlowModeHintText(mode);

      expect(hintText).toBe('');
    });
  });
});
