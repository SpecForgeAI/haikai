/**
 * State Transition Edge Rendering Tests
 * Task Group 3: State Transition Edge Rendering and Label Resolution
 *
 * Tests for state transition rendering functions:
 * - renderStateTransition: Returns valid line path and arrowhead
 * - resolveTransitionLabel: Label resolution priority order
 *   - Priority 1: triggerRefKind/triggerRefId resolves to Method/Event name
 *   - Priority 2: triggerLabelText used when no ref
 *   - Priority 3: guardExpression wrapped in brackets
 *   - Priority 4: effectRefKind/effectRefId resolves to Method name
 *   - Combined label format when multiple fields present
 */

import {
  renderStateTransition,
  resolveTransitionLabel,
  StateTransitionRenderResult,
} from '../utils/stateTransitionRendering';
import { StateTransition, MetaModel } from '../types/model';

// Helper function to create a mock MetaModel with test data
function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [
        { id: 'method-1', class_id: 'class-1', name: 'validateInput' },
        { id: 'method-2', class_id: 'class-1', name: 'processData' },
        { id: 'method-3', class_id: 'class-1', name: 'isValid' },
      ],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [
        { id: 'event-1', name: 'UserClicked', description: '', tags: '' },
        { id: 'event-2', name: 'DataReceived', description: '', tags: '' },
      ],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

describe('State Transition Edge Rendering', () => {
  /**
   * Test 1: renderStateTransition returns valid line path and arrowhead
   */
  describe('renderStateTransition', () => {
    it('should return valid line path and arrowhead path', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };
      const label = 'click';

      const result = renderStateTransition(sourcePosition, targetPosition, label);

      // Verify it returns a valid StateTransitionRenderResult
      expect(result).toBeDefined();
      expect(result.linePath).toBeDefined();
      expect(typeof result.linePath).toBe('string');
      expect(result.arrowheadPath).toBeDefined();
      expect(typeof result.arrowheadPath).toBe('string');

      // Verify line path is a valid SVG path (M start L end)
      expect(result.linePath).toContain('M');
      expect(result.linePath).toContain('L');
      expect(result.linePath).toMatch(/M\s*100\s*100/);
      expect(result.linePath).toMatch(/L\s*300\s*100/);

      // Verify arrowhead path is a valid SVG path (M L L Z for triangle)
      expect(result.arrowheadPath).toContain('M');
      expect(result.arrowheadPath).toContain('L');
      expect(result.arrowheadPath).toContain('Z');

      // Verify stroke styling
      expect(result.strokeColor).toBeDefined();
      expect(result.strokeWidth).toBeGreaterThan(0);
      expect(result.arrowheadFill).toBeDefined();

      // Verify label position is at midpoint
      expect(result.labelPosition).toBeDefined();
      expect(result.labelPosition!.x).toBe(200); // Midpoint of 100 and 300
      expect(result.labelPosition!.y).toBe(100); // Same Y for horizontal line
      expect(result.labelText).toBe('click');
    });

    it('should calculate correct label position for diagonal lines', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 200, y: 200 };

      const result = renderStateTransition(sourcePosition, targetPosition, 'transition');

      // Midpoint should be (150, 150)
      expect(result.labelPosition!.x).toBe(150);
      expect(result.labelPosition!.y).toBe(150);
    });

    it('should handle no label (undefined labelText)', () => {
      const sourcePosition = { x: 100, y: 100 };
      const targetPosition = { x: 300, y: 100 };

      const result = renderStateTransition(sourcePosition, targetPosition, undefined);

      // Label position should still be calculated but labelText undefined
      expect(result.labelText).toBeUndefined();
      expect(result.labelPosition).toBeDefined(); // Position still calculated
    });
  });

  /**
   * Test 2: Label resolution priority 1 - triggerRefKind/triggerRefId resolves to Method/Event name
   */
  describe('resolveTransitionLabel - Priority 1: triggerRef', () => {
    it('should resolve Method trigger reference to method name', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Method',
        trigger_ref_id: 'method-1',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('validateInput');
    });

    it('should resolve Event trigger reference to event name', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('UserClicked');
    });

    it('should return undefined if trigger reference not found', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Method',
        trigger_ref_id: 'method-nonexistent',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      // Should fall through to other priorities or return undefined
      expect(label).toBeUndefined();
    });
  });

  /**
   * Test 3: Label resolution priority 2 - triggerLabelText used when no ref
   */
  describe('resolveTransitionLabel - Priority 2: triggerLabelText', () => {
    it('should return triggerLabelText when no trigger reference', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'user clicks button',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('user clicks button');
    });

    it('should prefer triggerRef over triggerLabelText', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
        trigger_label_text: 'fallback text',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('UserClicked'); // Priority 1 wins
    });
  });

  /**
   * Test 4: Label resolution priority 3 - guardExpression wrapped in brackets
   */
  describe('resolveTransitionLabel - Priority 3: guardExpression', () => {
    it('should wrap guardExpression in square brackets', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        guard_expression: 'count > 0',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('[count > 0]');
    });

    it('should combine trigger and guard with separator', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'click',
        guard_expression: 'isEnabled',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('click [isEnabled]');
    });
  });

  /**
   * Test 5: Label resolution priority 4 - effectRefKind/effectRefId resolves to Method name
   */
  describe('resolveTransitionLabel - Priority 4: effectRef', () => {
    it('should resolve Method effect reference to method name', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        effect_ref_kind: 'Method',
        effect_ref_id: 'method-2',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('/ processData');
    });

    it('should use effectLabelText when no effect reference', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        effect_label_text: 'doAction()',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('/ doAction()');
    });
  });

  /**
   * Test 6: Combined label format when multiple fields present
   */
  describe('resolveTransitionLabel - Combined format', () => {
    it('should combine trigger, guard, and effect in UML format', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
        guard_expression: 'isValid',
        effect_ref_kind: 'Method',
        effect_ref_id: 'method-2',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      // UML format: trigger [guard] / effect
      expect(label).toBe('UserClicked [isValid] / processData');
    });

    it('should combine triggerLabelText, guard, and effectLabelText', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'onClick',
        guard_expression: 'x > 0',
        effect_label_text: 'runAction',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('onClick [x > 0] / runAction');
    });

    it('should handle trigger with effect only (no guard)', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'submit',
        effect_label_text: 'save',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('submit / save');
    });

    it('should return undefined when no label content', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBeUndefined();
    });

    it('should handle guard ref when guard_ref_kind and guard_ref_id are set', () => {
      const metaModel = createMockMetaModel();
      const transition: StateTransition = {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'event',
        guard_ref_kind: 'Method',
        guard_ref_id: 'method-3',
      };

      const label = resolveTransitionLabel(transition, metaModel);

      // Guard ref resolves to method name wrapped in brackets
      expect(label).toBe('event [isValid]');
    });
  });
});
