/**
 * UI Domain Palette Utilities Tests
 * Spec 2026-01-03: Diagram View RHS UI Domain Palette
 * Task Group 2: UI Domain Palette Utilities
 *
 * Tests for UI domain palette utility functions including:
 * - isEntityOnDiagram: Check if an entity has a node on the diagram
 * - formatUIScreenLabel: Format UIScreen entity label
 * - formatUIWorkflowTransitionLabel: Format UIWorkflowTransition entity label
 * - formatUIComponentLabel: Format UIComponent entity label
 * - formatUIActionLabel: Format UIAction entity label
 */

import {
  isEntityOnDiagram,
  formatUIScreenLabel,
  formatUIWorkflowTransitionLabel,
  formatUIComponentLabel,
  formatUIActionLabel,
} from '../utils/uiDomainPaletteUtils';
import type { DiagramNode, UIScreen, UIWorkflowTransition, UIComponent, UIAction } from '../types/model';

describe('UI Domain Palette Utilities', () => {
  describe('isEntityOnDiagram', () => {
    const mockDiagramNodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'UI_SCREEN',
        entity_id: 'screen-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      },
      {
        id: 'node-2',
        entity_type: 'UI_COMPONENT',
        entity_id: 'component-1',
        pos_x: 300,
        pos_y: 100,
        width: 150,
        height: 80,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      },
      {
        id: 'node-3',
        entity_type: 'UI_ACTION',
        entity_id: 'action-1',
        pos_x: 500,
        pos_y: 100,
        width: 150,
        height: 80,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      },
      {
        id: 'node-4',
        entity_type: 'UI_WORKFLOW_TRANSITION',
        entity_id: 'transition-1',
        pos_x: 700,
        pos_y: 100,
        width: 150,
        height: 80,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      },
    ];

    it('should return true when UI_SCREEN node exists on diagram', () => {
      const result = isEntityOnDiagram('UI_SCREEN', 'screen-1', mockDiagramNodes);
      expect(result).toBe(true);
    });

    it('should return false when node does not exist on diagram', () => {
      const result = isEntityOnDiagram('UI_SCREEN', 'screen-nonexistent', mockDiagramNodes);
      expect(result).toBe(false);
    });

    it('should work for UI_WORKFLOW_TRANSITION entity type', () => {
      const result = isEntityOnDiagram('UI_WORKFLOW_TRANSITION', 'transition-1', mockDiagramNodes);
      expect(result).toBe(true);

      const nonExistent = isEntityOnDiagram('UI_WORKFLOW_TRANSITION', 'transition-nonexistent', mockDiagramNodes);
      expect(nonExistent).toBe(false);
    });

    it('should work for UI_COMPONENT entity type', () => {
      const result = isEntityOnDiagram('UI_COMPONENT', 'component-1', mockDiagramNodes);
      expect(result).toBe(true);

      const nonExistent = isEntityOnDiagram('UI_COMPONENT', 'component-nonexistent', mockDiagramNodes);
      expect(nonExistent).toBe(false);
    });

    it('should work for UI_ACTION entity type', () => {
      const result = isEntityOnDiagram('UI_ACTION', 'action-1', mockDiagramNodes);
      expect(result).toBe(true);

      const nonExistent = isEntityOnDiagram('UI_ACTION', 'action-nonexistent', mockDiagramNodes);
      expect(nonExistent).toBe(false);
    });

    it('should return false for empty diagram nodes array', () => {
      const result = isEntityOnDiagram('UI_SCREEN', 'screen-1', []);
      expect(result).toBe(false);
    });
  });

  describe('formatUIEntityLabel', () => {
    describe('formatUIScreenLabel', () => {
      it('should return "name (route)" when route is present', () => {
        const screen: UIScreen = {
          id: 'screen-1',
          name: 'Dashboard',
          route: '/dashboard',
          description: 'Main dashboard view',
        };
        expect(formatUIScreenLabel(screen)).toBe('Dashboard (/dashboard)');
      });

      it('should return just name when route is empty', () => {
        const screen: UIScreen = {
          id: 'screen-2',
          name: 'Settings',
          route: '',
          description: 'Settings page',
        };
        expect(formatUIScreenLabel(screen)).toBe('Settings');
      });
    });

    describe('formatUIWorkflowTransitionLabel', () => {
      const mockScreens: UIScreen[] = [
        { id: 'screen-1', name: 'Login', route: '/login' },
        { id: 'screen-2', name: 'Dashboard', route: '/dashboard' },
      ];

      it('should return "name (source -> target)" when both screens can be resolved', () => {
        const transition: UIWorkflowTransition = {
          id: 'transition-1',
          name: 'Navigate to Dashboard',
          source_screen_id: 'screen-1',
          target_screen_id: 'screen-2',
          trigger: 'Submit Login',
        };
        expect(formatUIWorkflowTransitionLabel(transition, mockScreens)).toBe(
          'Navigate to Dashboard (Login -> Dashboard)'
        );
      });

      it('should return just name when source screen cannot be resolved', () => {
        const transition: UIWorkflowTransition = {
          id: 'transition-2',
          name: 'Unknown Source',
          source_screen_id: 'nonexistent',
          target_screen_id: 'screen-2',
        };
        expect(formatUIWorkflowTransitionLabel(transition, mockScreens)).toBe('Unknown Source');
      });

      it('should return just name when target screen cannot be resolved', () => {
        const transition: UIWorkflowTransition = {
          id: 'transition-3',
          name: 'Unknown Target',
          source_screen_id: 'screen-1',
          target_screen_id: 'nonexistent',
        };
        expect(formatUIWorkflowTransitionLabel(transition, mockScreens)).toBe('Unknown Target');
      });

      it('should return just name when screens array is empty', () => {
        const transition: UIWorkflowTransition = {
          id: 'transition-4',
          name: 'No Screens',
          source_screen_id: 'screen-1',
          target_screen_id: 'screen-2',
        };
        expect(formatUIWorkflowTransitionLabel(transition, [])).toBe('No Screens');
      });
    });

    describe('formatUIComponentLabel', () => {
      it('should return "name [type]" when component_type is present', () => {
        const component: UIComponent = {
          id: 'component-1',
          name: 'Submit Button',
          component_type: 'Button',
          description: 'A button that submits forms',
        };
        expect(formatUIComponentLabel(component)).toBe('Submit Button [Button]');
      });

      it('should return just name when component_type is not present', () => {
        const component: UIComponent = {
          id: 'component-2',
          name: 'Navigation Bar',
          description: 'Top navigation bar',
        };
        expect(formatUIComponentLabel(component)).toBe('Navigation Bar');
      });

      it('should return just name when component_type is empty string', () => {
        const component: UIComponent = {
          id: 'component-3',
          name: 'Footer',
          component_type: '',
          description: 'Page footer',
        };
        expect(formatUIComponentLabel(component)).toBe('Footer');
      });
    });

    describe('formatUIActionLabel', () => {
      it('should return "name [trigger_type/effect_type]" when both are present', () => {
        const action: UIAction = {
          id: 'action-1',
          name: 'Submit Form',
          trigger_type: 'Click',
          effect_type: 'Submit',
          owner_type: 'Component',
          owner_id: 'component-1',
        };
        expect(formatUIActionLabel(action)).toBe('Submit Form [Click/Submit]');
      });

      it('should return "name [trigger_type]" when only trigger_type is present', () => {
        const action: UIAction = {
          id: 'action-2',
          name: 'Click Handler',
          trigger_type: 'Click',
          effect_type: '',
          owner_type: 'Screen',
          owner_id: 'screen-1',
        };
        expect(formatUIActionLabel(action)).toBe('Click Handler [Click]');
      });

      it('should return "name [effect_type]" when only effect_type is present', () => {
        const action: UIAction = {
          id: 'action-3',
          name: 'Navigate Action',
          trigger_type: '',
          effect_type: 'Navigate',
          owner_type: 'Component',
          owner_id: 'component-2',
        };
        expect(formatUIActionLabel(action)).toBe('Navigate Action [Navigate]');
      });

      it('should return just name when neither trigger_type nor effect_type are present', () => {
        const action: UIAction = {
          id: 'action-4',
          name: 'Generic Action',
          trigger_type: '',
          effect_type: '',
          owner_type: 'Screen',
          owner_id: 'screen-1',
        };
        expect(formatUIActionLabel(action)).toBe('Generic Action');
      });
    });
  });
});
