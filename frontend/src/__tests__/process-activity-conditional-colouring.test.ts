/**
 * Process Activity Conditional Colouring Tests
 *
 * Tests for the conditional background colouring of PROCESS_ACTIVITY nodes
 * based on their user_interaction_level attribute.
 *
 * This test file covers all 5 task groups from the spec:
 * - Task Group 1: Colour Infrastructure Verification
 * - Task Group 2: Canvas.tsx Core Fix
 * - Task Group 3: Node Creation Path Verification
 * - Task Group 4: Live Update Behaviour
 * - Task Group 5: Test Review & Gap Analysis
 */

import {
  processActivityColors,
  getProcessActivityDefaultFill,
} from '../config/defaults';
import { getNodeFillColor } from '../utils/rendering';
import { createDiagramNodeFromEntity } from '../utils/nodeCreation';
import {
  ArchitectureModel,
  DiagramNode,
  ProcessActivity,
  UserInteractionLevel,
  ENTITY_TYPES,
} from '../types/model';

// ============================================================================
// Task Group 1: Colour Infrastructure Verification Tests
// ============================================================================

describe('Task Group 1: Colour Infrastructure Verification', () => {
  describe('processActivityColors mapping', () => {
    it('should have correct colour for AUTOMATED level', () => {
      expect(processActivityColors.AUTOMATED).toBe('#a5d6a7');
    });

    it('should have correct colour for MINIMAL level', () => {
      expect(processActivityColors.MINIMAL).toBe('#c8e6c9');
    });

    it('should have correct colour for MODERATE level', () => {
      expect(processActivityColors.MODERATE).toBe('#fff9c4');
    });

    it('should have correct colour for SIGNIFICANT level', () => {
      expect(processActivityColors.SIGNIFICANT).toBe('#ffcdd2');
    });
  });

  describe('getProcessActivityDefaultFill function', () => {
    // Test 1: Returns correct colour for each UserInteractionLevel value
    it('should return correct colour for each UserInteractionLevel value', () => {
      const levels: UserInteractionLevel[] = ['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT'];
      const expectedColors = ['#a5d6a7', '#c8e6c9', '#fff9c4', '#ffcdd2'];

      levels.forEach((level, index) => {
        const activity: ProcessActivity = {
          id: `activity-${index}`,
          business_process_id: 'process-1',
          name: `Activity ${index}`,
          description: '',
          actor_hint: 'END_USER',
          user_interaction_level: level,
          tags: '',
        };

        expect(getProcessActivityDefaultFill(activity)).toBe(expectedColors[index]);
      });
    });

    // Test 2: Defaults to AUTOMATED colour when user_interaction_level is undefined
    it('should default to AUTOMATED colour when user_interaction_level is undefined', () => {
      const activity = {
        id: 'activity-1',
        business_process_id: 'process-1',
        name: 'Test Activity',
        description: '',
        actor_hint: 'END_USER',
        tags: '',
        // user_interaction_level is not set
      } as ProcessActivity;

      expect(getProcessActivityDefaultFill(activity)).toBe(processActivityColors.AUTOMATED);
    });

    // Test 3: getNodeFillColor correctly delegates to getProcessActivityDefaultFill
    it('should delegate to getProcessActivityDefaultFill for PROCESS_ACTIVITY nodes', () => {
      const activity: ProcessActivity = {
        id: 'activity-1',
        business_process_id: 'process-1',
        name: 'Test Activity',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'SIGNIFICANT',
        tags: '',
      };

      const model: ArchitectureModel = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            process_activities: [activity],
            applications: [],
            app_components: [],
            services: [],
            interfaces: [],
            application_points: [],
            logical_data_entities: [],
            logical_data_attributes: [],
            physical_data_entities: [],
            physical_data_attributes: [],
          },
          relationships: {
            business_user_processes: [],
            application_point_business_processes: [],
            logical_data_entity_relationships: [],
            logical_data_entity_physical_data_entities: [],
            logical_data_attribute_physical_data_attributes: [],
            data_movements: [],
            interface_logical_entities: [],
          },
        },
        diagrams: [],
      };

      const node: DiagramNode = {
        id: 'node-1',
        entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
        entity_id: 'activity-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };

      // Should return SIGNIFICANT colour (#ffcdd2)
      expect(getNodeFillColor(node, model)).toBe('#ffcdd2');
    });
  });
});

// ============================================================================
// Task Group 2: Canvas.tsx Core Fix Tests
// ============================================================================

describe('Task Group 2: Canvas Colour Rendering', () => {
  const createTestModel = (activities: ProcessActivity[]): ArchitectureModel => ({
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: activities,
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_processes: [],
        application_point_business_processes: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    },
    diagrams: [],
  });

  const createProcessActivityNode = (entityId: string): DiagramNode => ({
    id: `node-${entityId}`,
    entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    auto_size: false,
    z_index: 1,
    parent_node_id: null,
    style_override: {},
  });

  // Test 1: PROCESS_ACTIVITY with AUTOMATED renders with #a5d6a7
  it('should render PROCESS_ACTIVITY with AUTOMATED level as #a5d6a7', () => {
    const activity: ProcessActivity = {
      id: 'activity-automated',
      business_process_id: 'process-1',
      name: 'Automated Activity',
      description: '',
      actor_hint: 'INTERNAL_SYSTEM',
      user_interaction_level: 'AUTOMATED',
      tags: '',
    };

    const model = createTestModel([activity]);
    const node = createProcessActivityNode('activity-automated');

    expect(getNodeFillColor(node, model)).toBe('#a5d6a7');
  });

  // Test 2: PROCESS_ACTIVITY with SIGNIFICANT renders with #ffcdd2
  it('should render PROCESS_ACTIVITY with SIGNIFICANT level as #ffcdd2', () => {
    const activity: ProcessActivity = {
      id: 'activity-significant',
      business_process_id: 'process-1',
      name: 'Significant Activity',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'SIGNIFICANT',
      tags: '',
    };

    const model = createTestModel([activity]);
    const node = createProcessActivityNode('activity-significant');

    expect(getNodeFillColor(node, model)).toBe('#ffcdd2');
  });

  // Test 3: Non-PROCESS_ACTIVITY node uses entity type default colour
  it('should use entity type default for non-PROCESS_ACTIVITY nodes', () => {
    const model = createTestModel([]);

    const applicationNode: DiagramNode = {
      id: 'node-app',
      entity_type: ENTITY_TYPES.APPLICATION,
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // APPLICATION default background is #E3F2FD
    expect(getNodeFillColor(applicationNode, model)).toBe('#E3F2FD');
  });

  // Test 4: PROCESS_ACTIVITY without explicit background_color derives colour from entity
  it('should derive colour from entity metadata when background_color is not set', () => {
    const activity: ProcessActivity = {
      id: 'activity-minimal',
      business_process_id: 'process-1',
      name: 'Minimal Activity',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'MINIMAL',
      tags: '',
    };

    const model = createTestModel([activity]);

    // Node WITHOUT background_color set
    const node: DiagramNode = {
      id: 'node-minimal',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-minimal',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
      // background_color is NOT set
    };

    expect(getNodeFillColor(node, model)).toBe('#c8e6c9');
  });

  // Additional test: Custom background_color override takes precedence
  it('should respect custom background_color override if set', () => {
    const activity: ProcessActivity = {
      id: 'activity-1',
      business_process_id: 'process-1',
      name: 'Test Activity',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'AUTOMATED',
      tags: '',
    };

    const model = createTestModel([activity]);

    const nodeWithOverride: DiagramNode = {
      id: 'node-override',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
      background_color: '#FF0000', // Custom override
    };

    // Should return the custom colour, not the derived one
    expect(getNodeFillColor(nodeWithOverride, model)).toBe('#FF0000');
  });
});

// ============================================================================
// Task Group 3: Node Creation Path Verification Tests
// ============================================================================

describe('Task Group 3: Node Creation Paths', () => {
  // Test 1: createDiagramNodeFromEntity does NOT set background_color
  it('should NOT set background_color in createDiagramNodeFromEntity', () => {
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 400 };

    const newNode = createDiagramNodeFromEntity(
      ENTITY_TYPES.PROCESS_ACTIVITY,
      'activity-1',
      existingNodes,
      viewportCenter
    );

    // The node should NOT have background_color set
    expect(newNode.background_color).toBeUndefined();
  });

  // Test 2: Simple Add creates node without background_color
  it('should create PROCESS_ACTIVITY node without background_color property', () => {
    const newNode = createDiagramNodeFromEntity(
      ENTITY_TYPES.PROCESS_ACTIVITY,
      'activity-test',
      [],
      { x: 300, y: 200 }
    );

    expect(newNode).toBeDefined();
    expect(newNode.entity_type).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(newNode.background_color).toBeUndefined();
    expect(newNode.style_override).toEqual({});
  });

  // Test 3: Verify node structure matches expected schema
  it('should create node with correct structure for colour derivation', () => {
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.PROCESS_ACTIVITY,
      'activity-123',
      [],
      { x: 100, y: 100 }
    );

    // Essential fields for colour derivation
    expect(node.entity_type).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(node.entity_id).toBe('activity-123');

    // Should NOT have any colour overrides
    expect(node.background_color).toBeUndefined();
    expect(node.line_color).toBeUndefined();
  });

  // Test 4: buildWrappedNodeHierarchy creates nodes without background_color
  // This is tested conceptually - we verify the node structure created
  it('should create nodes with correct entity reference for colour lookup', () => {
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.PROCESS_ACTIVITY,
      'wrapped-activity',
      [],
      { x: 200, y: 200 }
    );

    // Verify all required fields for getNodeFillColor to work
    expect(node.id).toBeDefined();
    expect(node.entity_type).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);
    expect(node.entity_id).toBe('wrapped-activity');
    expect(node.background_color).toBeUndefined();
  });
});

// ============================================================================
// Task Group 4: Live Update Behaviour Tests
// ============================================================================

describe('Task Group 4: Live Update Behaviour', () => {
  const createTestModel = (activity: ProcessActivity): ArchitectureModel => ({
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [activity],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_processes: [],
        application_point_business_processes: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    },
    diagrams: [],
  });

  // Test 1: Changing user_interaction_level updates fill colour
  it('should update fill colour when user_interaction_level changes', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Initial state: AUTOMATED
    const activityAutomated: ProcessActivity = {
      id: 'activity-1',
      business_process_id: 'process-1',
      name: 'Test Activity',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'AUTOMATED',
      tags: '',
    };
    const modelAutomated = createTestModel(activityAutomated);
    expect(getNodeFillColor(node, modelAutomated)).toBe('#a5d6a7');

    // After UPDATE_ENTITY: SIGNIFICANT
    const activitySignificant: ProcessActivity = {
      ...activityAutomated,
      user_interaction_level: 'SIGNIFICANT',
    };
    const modelSignificant = createTestModel(activitySignificant);
    expect(getNodeFillColor(node, modelSignificant)).toBe('#ffcdd2');
  });

  // Test 2: getNodeFillColor reads fresh data from model
  it('should read fresh user_interaction_level from updated model', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Simulate model updates (as would happen via UPDATE_ENTITY dispatch)
    const levels: UserInteractionLevel[] = ['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT'];
    const expectedColors = ['#a5d6a7', '#c8e6c9', '#fff9c4', '#ffcdd2'];

    levels.forEach((level, index) => {
      const activity: ProcessActivity = {
        id: 'activity-1',
        business_process_id: 'process-1',
        name: 'Test Activity',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: level,
        tags: '',
      };

      const model = createTestModel(activity);
      expect(getNodeFillColor(node, model)).toBe(expectedColors[index]);
    });
  });

  // Test 3: Colour derivation does not cache stale values
  it('should not cache stale colour values - always derives fresh', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // First call with MINIMAL
    const activityMinimal: ProcessActivity = {
      id: 'activity-1',
      business_process_id: 'process-1',
      name: 'Test',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'MINIMAL',
      tags: '',
    };
    const model1 = createTestModel(activityMinimal);
    const colour1 = getNodeFillColor(node, model1);
    expect(colour1).toBe('#c8e6c9');

    // Second call with MODERATE (same node, different model state)
    const activityModerate: ProcessActivity = {
      id: 'activity-1',
      business_process_id: 'process-1',
      name: 'Test',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'MODERATE',
      tags: '',
    };
    const model2 = createTestModel(activityModerate);
    const colour2 = getNodeFillColor(node, model2);
    expect(colour2).toBe('#fff9c4');

    // Third call back to MINIMAL
    const colour3 = getNodeFillColor(node, model1);
    expect(colour3).toBe('#c8e6c9');
  });
});

// ============================================================================
// Task Group 5: Test Review & Gap Analysis - Additional Strategic Tests
// ============================================================================

describe('Task Group 5: Gap Analysis - Additional Strategic Tests', () => {
  const createTestModel = (activities: ProcessActivity[]): ArchitectureModel => ({
    metaModel: {
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: activities,
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        business_user_processes: [],
        application_point_business_processes: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
      },
    },
    diagrams: [],
  });

  // Gap 1: Nested PROCESS_ACTIVITY nodes have independent colours from parent
  it('should give each nested PROCESS_ACTIVITY its own colour independent of parent', () => {
    const activities: ProcessActivity[] = [
      {
        id: 'activity-1',
        business_process_id: 'process-1',
        name: 'First Activity',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      },
      {
        id: 'activity-2',
        business_process_id: 'process-1',
        name: 'Second Activity',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'SIGNIFICANT',
        tags: '',
      },
    ];

    const model = createTestModel(activities);

    // Parent Business Process node
    const parentNode: DiagramNode = {
      id: 'node-parent',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 100,
      pos_y: 100,
      width: 200,
      height: 150,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Child activity nodes
    const childNode1: DiagramNode = {
      id: 'node-child-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 110,
      pos_y: 130,
      width: 80,
      height: 40,
      auto_size: false,
      z_index: 2,
      parent_node_id: 'node-parent',
      style_override: {},
    };

    const childNode2: DiagramNode = {
      id: 'node-child-2',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-2',
      pos_x: 110,
      pos_y: 180,
      width: 80,
      height: 40,
      auto_size: false,
      z_index: 3,
      parent_node_id: 'node-parent',
      style_override: {},
    };

    // Each child should have its own colour
    expect(getNodeFillColor(childNode1, model)).toBe('#a5d6a7'); // AUTOMATED
    expect(getNodeFillColor(childNode2, model)).toBe('#ffcdd2'); // SIGNIFICANT

    // Parent should have BUSINESS_PROCESS colour
    expect(getNodeFillColor(parentNode, model)).toBe('#d6f5d6');
  });

  // Gap 2: Mixed node types - only PROCESS_ACTIVITY gets dynamic colour
  it('should only apply dynamic colouring to PROCESS_ACTIVITY nodes', () => {
    const activity: ProcessActivity = {
      id: 'activity-1',
      business_process_id: 'process-1',
      name: 'Test Activity',
      description: '',
      actor_hint: 'END_USER',
      user_interaction_level: 'MODERATE',
      tags: '',
    };

    const model = createTestModel([activity]);

    // PROCESS_ACTIVITY gets dynamic colour
    const activityNode: DiagramNode = {
      id: 'node-activity',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Other entity types get static colours
    const applicationNode: DiagramNode = {
      id: 'node-app',
      entity_type: ENTITY_TYPES.APPLICATION,
      entity_id: 'app-1',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    const businessProcessNode: DiagramNode = {
      id: 'node-bp',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 500,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    expect(getNodeFillColor(activityNode, model)).toBe('#fff9c4'); // MODERATE - dynamic
    expect(getNodeFillColor(applicationNode, model)).toBe('#E3F2FD'); // Static
    expect(getNodeFillColor(businessProcessNode, model)).toBe('#d6f5d6'); // Static
  });

  // Gap 3: Graceful fallback for entity with no user_interaction_level
  it('should gracefully fall back to AUTOMATED for missing user_interaction_level', () => {
    // Create an activity with undefined user_interaction_level
    const activityWithoutLevel = {
      id: 'activity-no-level',
      business_process_id: 'process-1',
      name: 'Activity Without Level',
      description: '',
      actor_hint: 'END_USER',
      tags: '',
      // user_interaction_level is NOT set
    } as ProcessActivity;

    const model = createTestModel([activityWithoutLevel]);

    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-no-level',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Should fall back to AUTOMATED colour
    expect(getNodeFillColor(node, model)).toBe('#a5d6a7');
  });

  // Gap 4: Entity not found in model - fallback behaviour
  it('should fall back to entity type default when activity not found in model', () => {
    // Empty model - activity doesn't exist
    const model = createTestModel([]);

    const node: DiagramNode = {
      id: 'node-orphan',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'non-existent-activity',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Should fall back to PROCESS_ACTIVITY default from entityColors
    expect(getNodeFillColor(node, model)).toBe('#a5d6a7');
  });

  // Gap 5: All four colours render distinctly on same diagram
  it('should render all four distinct colours for different interaction levels', () => {
    const activities: ProcessActivity[] = [
      {
        id: 'act-automated',
        business_process_id: 'process-1',
        name: 'Automated',
        description: '',
        actor_hint: 'INTERNAL_SYSTEM',
        user_interaction_level: 'AUTOMATED',
        tags: '',
      },
      {
        id: 'act-minimal',
        business_process_id: 'process-1',
        name: 'Minimal',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MINIMAL',
        tags: '',
      },
      {
        id: 'act-moderate',
        business_process_id: 'process-1',
        name: 'Moderate',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
        tags: '',
      },
      {
        id: 'act-significant',
        business_process_id: 'process-1',
        name: 'Significant',
        description: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'SIGNIFICANT',
        tags: '',
      },
    ];

    const model = createTestModel(activities);

    const nodes = activities.map((activity, index) => ({
      id: `node-${index}`,
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: activity.id,
      pos_x: 100 + index * 150,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    }));

    const colours = nodes.map(node => getNodeFillColor(node, model));

    // All four colours should be distinct
    expect(new Set(colours).size).toBe(4);

    // And they should match expected values
    expect(colours[0]).toBe('#a5d6a7'); // AUTOMATED
    expect(colours[1]).toBe('#c8e6c9'); // MINIMAL
    expect(colours[2]).toBe('#fff9c4'); // MODERATE
    expect(colours[3]).toBe('#ffcdd2'); // SIGNIFICANT
  });

  // Gap 6: getNodeFillColor works without model (fallback)
  it('should fall back to entity type default when model is undefined', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
      entity_id: 'activity-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      auto_size: false,
      z_index: 1,
      parent_node_id: null,
      style_override: {},
    };

    // Call without model
    const colour = getNodeFillColor(node, undefined);

    // Should fall back to PROCESS_ACTIVITY default from entityColors
    expect(colour).toBe('#a5d6a7');
  });
});
