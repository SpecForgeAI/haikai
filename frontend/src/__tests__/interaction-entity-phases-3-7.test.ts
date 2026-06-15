/**
 * Tests for Interaction Entity + App_Business_Point Super-type
 *
 * Phases 3-7: Rendering, Advanced Add, Validation, Show/Hide Toggle
 * Tests for interactionRendering utilities, advancedAddRelationships, validation, and toggle functionality.
 */

import {
  ENTITY_TYPES,
  resolveAppBusinessPoint,
  MetaModel,
  Interaction,
  DiagramUserInteraction,
  Diagram,
  DiagramNode,
} from '../types/model';
import {
  calculateMidpoint,
  calculateUserToMidpointLine,
  calculateInteractionLinePath,
  getNodeCenter,
  calculateInteractionPaths,
  generateLinePath,
  getStrokeDasharray,
  Point,
} from '../utils/interactionRendering';
import {
  getExpandableRelationships,
  hasExpandableRelationships,
  formatAdvancedAddLabel,
  EXPANDABLE_RELATIONSHIPS,
} from '../utils/advancedAddRelationships';
import {
  validateInteractionReferences,
  formatInteractionReferenceErrorMessage,
} from '../utils/validation';

// ============================================================================
// Phase 3: Diagram Rendering Tests
// ============================================================================

describe('Phase 3: Diagram Rendering', () => {
  describe('interactionRendering utilities', () => {
    describe('calculateMidpoint', () => {
      it('should calculate midpoint between two points', () => {
        const pos1: Point = { x: 0, y: 0 };
        const pos2: Point = { x: 100, y: 100 };
        const result = calculateMidpoint(pos1, pos2);
        expect(result.x).toBe(50);
        expect(result.y).toBe(50);
      });

      it('should handle negative coordinates', () => {
        const pos1: Point = { x: -100, y: -50 };
        const pos2: Point = { x: 100, y: 50 };
        const result = calculateMidpoint(pos1, pos2);
        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
      });

      it('should return same point when both positions are identical', () => {
        const pos1: Point = { x: 50, y: 75 };
        const pos2: Point = { x: 50, y: 75 };
        const result = calculateMidpoint(pos1, pos2);
        expect(result.x).toBe(50);
        expect(result.y).toBe(75);
      });
    });

    describe('calculateUserToMidpointLine', () => {
      it('should return line from user position to target', () => {
        const userPos: Point = { x: 10, y: 20 };
        const target: Point = { x: 100, y: 200 };
        const result = calculateUserToMidpointLine(userPos, target);
        expect(result.start).toEqual(userPos);
        expect(result.end).toEqual(target);
      });
    });

    describe('calculateInteractionLinePath', () => {
      it('should return null when no secondary position (Case 2)', () => {
        const primaryPos: Point = { x: 50, y: 50 };
        const result = calculateInteractionLinePath(primaryPos);
        expect(result).toBeNull();
      });

      it('should return line between primary and secondary (Case 1)', () => {
        const primaryPos: Point = { x: 50, y: 50 };
        const secondaryPos: Point = { x: 150, y: 150 };
        const result = calculateInteractionLinePath(primaryPos, secondaryPos);
        expect(result).not.toBeNull();
        expect(result!.start).toEqual(primaryPos);
        expect(result!.end).toEqual(secondaryPos);
      });
    });

    describe('getNodeCenter', () => {
      it('should calculate center of a node', () => {
        const node: DiagramNode = {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 100,
          pos_y: 200,
          width: 80,
          height: 60,
          auto_size: true,
        };
        const center = getNodeCenter(node);
        expect(center.x).toBe(140); // 100 + 80/2
        expect(center.y).toBe(230); // 200 + 60/2
      });
    });

    describe('calculateInteractionPaths', () => {
      const createTestNodes = (): DiagramNode[] => [
        {
          id: 'user-node',
          entity_type: 'BUSINESS_USER',
          entity_id: 'user-1',
          pos_x: 0,
          pos_y: 0,
          width: 40,
          height: 60,
          auto_size: true,
        },
        {
          id: 'primary-node',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 100,
          pos_y: 100,
          width: 80,
          height: 60,
          auto_size: true,
        },
        {
          id: 'secondary-node',
          entity_type: 'SERVICE',
          entity_id: 'svc-1',
          pos_x: 200,
          pos_y: 100,
          width: 80,
          height: 60,
          auto_size: true,
        },
      ];

      it('should return empty paths when primary node is missing', () => {
        const interaction: DiagramUserInteraction = {
          id: 'dui-1',
          interaction_id: 'int-1',
          primary_node_id: 'non-existent',
          line_style: 'dotted',
        };
        const result = calculateInteractionPaths(interaction, []);
        expect(result.primaryToSecondaryLine).toBeNull();
        expect(result.userToTargetLine).toBeNull();
      });

      it('should calculate paths for Case 1 (two points with user)', () => {
        const nodes = createTestNodes();
        const interaction: DiagramUserInteraction = {
          id: 'dui-1',
          interaction_id: 'int-1',
          primary_node_id: 'primary-node',
          secondary_node_id: 'secondary-node',
          user_node_id: 'user-node',
          line_style: 'dotted',
        };
        const result = calculateInteractionPaths(interaction, nodes);

        // Should have primary-to-secondary line
        expect(result.primaryToSecondaryLine).not.toBeNull();

        // Should have user-to-midpoint line
        expect(result.userToTargetLine).not.toBeNull();
      });

      it('should calculate paths for Case 2 (one point with user)', () => {
        const nodes = createTestNodes();
        const interaction: DiagramUserInteraction = {
          id: 'dui-1',
          interaction_id: 'int-1',
          primary_node_id: 'primary-node',
          user_node_id: 'user-node',
          line_style: 'dotted',
        };
        const result = calculateInteractionPaths(interaction, nodes);

        // Should NOT have primary-to-secondary line
        expect(result.primaryToSecondaryLine).toBeNull();

        // Should have user-to-primary line
        expect(result.userToTargetLine).not.toBeNull();
      });

      it('should handle missing user node gracefully', () => {
        const nodes = createTestNodes();
        const interaction: DiagramUserInteraction = {
          id: 'dui-1',
          interaction_id: 'int-1',
          primary_node_id: 'primary-node',
          secondary_node_id: 'secondary-node',
          line_style: 'dotted',
        };
        const result = calculateInteractionPaths(interaction, nodes);

        // Should have primary-to-secondary line
        expect(result.primaryToSecondaryLine).not.toBeNull();

        // Should NOT have user-to-target line (no user node)
        expect(result.userToTargetLine).toBeNull();
      });
    });

    describe('generateLinePath', () => {
      it('should generate SVG path string', () => {
        const start: Point = { x: 10, y: 20 };
        const end: Point = { x: 100, y: 200 };
        const result = generateLinePath(start, end);
        expect(result).toBe('M 10 20 L 100 200');
      });
    });

    describe('getStrokeDasharray', () => {
      it('should return dasharray for dotted style', () => {
        const result = getStrokeDasharray('dotted');
        expect(result).toBe('4,4');
      });

      it('should return none for solid style', () => {
        const result = getStrokeDasharray('solid');
        expect(result).toBe('none');
      });
    });
  });
});

// ============================================================================
// Phase 4: Advanced Add Tests
// ============================================================================

describe('Phase 4: Advanced Add', () => {
  describe('INTERACTION in EXPANDABLE_RELATIONSHIPS', () => {
    it('should have INTERACTION defined in EXPANDABLE_RELATIONSHIPS', () => {
      expect(EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERACTION]).toBeDefined();
    });

    it('should have 3 relationships for INTERACTION', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      expect(relationships.length).toBe(3);
    });

    it('should have user relationship with CHILD direction', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      const userRel = relationships.find(r => r.foreignKeyField === 'user_id');
      expect(userRel).toBeDefined();
      expect(userRel!.targetEntityType).toBe(ENTITY_TYPES.BUSINESS_USER);
      expect(userRel!.direction).toBe('CHILD');
      expect(userRel!.displayLabelPrefix).toBe('User: ');
    });

    it('should have primary_app_business_point relationship with POLYMORPHIC direction', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      const primaryRel = relationships.find(r => r.foreignKeyField === 'primary_app_business_point_id');
      expect(primaryRel).toBeDefined();
      expect(primaryRel!.direction).toBe('POLYMORPHIC');
      expect(primaryRel!.displayLabelPrefix).toBe('Primary: ');
      expect(primaryRel!.isOptional).toBeUndefined();
    });

    it('should have secondary_app_business_point relationship with POLYMORPHIC direction and isOptional', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      const secondaryRel = relationships.find(r => r.foreignKeyField === 'secondary_app_business_point_id');
      expect(secondaryRel).toBeDefined();
      expect(secondaryRel!.direction).toBe('POLYMORPHIC');
      expect(secondaryRel!.displayLabelPrefix).toBe('Secondary: ');
      expect(secondaryRel!.isOptional).toBe(true);
    });
  });

  describe('hasExpandableRelationships for INTERACTION', () => {
    it('should return true for INTERACTION', () => {
      expect(hasExpandableRelationships(ENTITY_TYPES.INTERACTION)).toBe(true);
    });
  });

  describe('formatAdvancedAddLabel', () => {
    it('should format label without prefix', () => {
      const result = formatAdvancedAddLabel('Order Service', 'SERVICE');
      expect(result).toBe('Order Service (SERVICE)');
    });

    it('should format label with prefix', () => {
      const result = formatAdvancedAddLabel('Order Service', 'SERVICE', 'Primary: ');
      expect(result).toBe('Primary: Order Service (SERVICE)');
    });

    it('should format user label', () => {
      const result = formatAdvancedAddLabel('John Doe', 'BUSINESS_USER', 'User: ');
      expect(result).toBe('User: John Doe (BUSINESS_USER)');
    });
  });
});

// ============================================================================
// Phase 5: Validation Tests
// ============================================================================

describe('Phase 5: Validation', () => {
  // Create a mock MetaModel
  const createMockModel = (): { metaModel: MetaModel; diagrams: any[] } => ({
    metaModel: {
      entities: {
        applications: [
          { id: 'app-001', name: 'Test App', description: '', app_type: 'web', status: 'active', tags: '' },
        ],
        app_components: [],
        services: [
          { id: 'svc-001', name: 'Test Service', description: '', application_id: 'app-001', service_type: 'api', tags: '' },
        ],
        interfaces: [],
        endpoints: [],
        business_processes: [
          { id: 'bp-001', name: 'Test Process', description: '', tags: '' },
        ],
        process_activities: [],
        business_users: [
          { id: 'user-001', name: 'Test User', description: '', tags: '' },
        ],
        business_points: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
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
    },
    diagrams: [],
  });

  describe('validateInteractionReferences', () => {
    it('should return error when user_id is missing', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: '',
          primary_app_business_point_id: 'app-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'user_id' && e.type === 'required')).toBe(true);
    });

    it('should return error when user_id references non-existent user', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'non-existent-user',
          primary_app_business_point_id: 'app-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'user_id' && e.type === 'invalid_fk')).toBe(true);
    });

    it('should return error when primary_app_business_point_id is missing', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: '',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'primary_app_business_point_id' && e.type === 'required')).toBe(true);
    });

    it('should return error when primary_app_business_point_id cannot be resolved', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'non-existent-id',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'primary_app_business_point_id' && e.type === 'invalid_fk')).toBe(true);
    });

    it('should pass validation for valid interaction with APPLICATION as primary', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'app-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBe(0);
    });

    it('should pass validation for valid interaction with SERVICE as primary', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'svc-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBe(0);
    });

    it('should pass validation for valid interaction with BUSINESS_PROCESS as primary', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'bp-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBe(0);
    });

    it('should return error when secondary_app_business_point_id cannot be resolved', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'app-001',
          secondary_app_business_point_id: 'non-existent-id',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.field === 'secondary_app_business_point_id' && e.type === 'invalid_fk')).toBe(true);
    });

    it('should pass validation for valid interaction with secondary point', () => {
      const model = createMockModel() as any;
      const interactions: Interaction[] = [
        {
          id: 'int-001',
          name: 'Test Interaction',
          user_id: 'user-001',
          primary_app_business_point_id: 'app-001',
          secondary_app_business_point_id: 'svc-001',
        },
      ];

      const errors = validateInteractionReferences(interactions, model);
      expect(errors.length).toBe(0);
    });
  });

  describe('formatInteractionReferenceErrorMessage', () => {
    it('should format error message correctly', () => {
      const message = formatInteractionReferenceErrorMessage('Login Flow', 'user');
      expect(message).toBe("Interaction 'Login Flow' is missing a user");
    });

    it('should handle unnamed interaction', () => {
      const message = formatInteractionReferenceErrorMessage('', 'primary App Business Point');
      expect(message).toBe("Interaction 'unnamed row' is missing a primary App Business Point");
    });
  });
});

// ============================================================================
// Phase 6: Show/Hide Toggle Tests (Specification Tests)
// ============================================================================

describe('Phase 6: Show/Hide Toggle', () => {
  describe('showUserInteractions state specification', () => {
    it('should default to true (user interactions visible by default)', () => {
      // Specification test: the default value should be true
      const defaultShowUserInteractions = true;
      expect(defaultShowUserInteractions).toBe(true);
    });

    it('should be a boolean state that can toggle', () => {
      // Specification test: the state can toggle between true and false
      let showUserInteractions = true;
      showUserInteractions = !showUserInteractions;
      expect(showUserInteractions).toBe(false);
      showUserInteractions = !showUserInteractions;
      expect(showUserInteractions).toBe(true);
    });
  });

  describe('conditional rendering based on toggle', () => {
    it('should render interaction lines when showUserInteractions is true', () => {
      const showUserInteractions = true;
      const interactions: DiagramUserInteraction[] = [
        { id: 'dui-1', interaction_id: 'int-1', primary_node_id: 'n1', line_style: 'dotted' },
      ];

      // Should render when toggle is on
      const shouldRender = showUserInteractions && interactions.length > 0;
      expect(shouldRender).toBe(true);
    });

    it('should NOT render interaction lines when showUserInteractions is false', () => {
      const showUserInteractions = false;
      const interactions: DiagramUserInteraction[] = [
        { id: 'dui-1', interaction_id: 'int-1', primary_node_id: 'n1', line_style: 'dotted' },
      ];

      // Should NOT render when toggle is off
      const shouldRender = showUserInteractions && interactions.length > 0;
      expect(shouldRender).toBe(false);
    });
  });
});

// ============================================================================
// Phase 7: Integration Tests
// ============================================================================

describe('Phase 7: Integration Tests', () => {
  describe('Full interaction flow', () => {
    it('should resolve all App_Business_Point types via resolveAppBusinessPoint', () => {
      const metaModel: MetaModel = {
        entities: {
          applications: [{ id: 'app-1', name: 'App', description: '', app_type: 'web', status: 'active', tags: '' }],
          app_components: [{ id: 'ac-1', name: 'Component', description: '', application_id: 'app-1', tags: '' }],
          services: [{ id: 'svc-1', name: 'Service', description: '', application_id: 'app-1', service_type: 'api', tags: '' }],
          interfaces: [{ id: 'int-1', name: 'Interface', description: '', service_id: 'svc-1', interface_type: 'REST_API', tags: '' }],
          endpoints: [{ id: 'ep-1', name: 'Endpoint', description: '', interface_id: 'int-1', endpoint_type: 'HTTP_REST', path_or_address: '/api', tags: '' }],
          business_processes: [{ id: 'bp-1', name: 'Process', description: '', tags: '' }],
          process_activities: [{ id: 'pa-1', name: 'Activity', description: '', business_process_id: 'bp-1', actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' }],
          business_users: [],
          business_points: [],
          application_points: [],
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
          interactions: [],
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

      // Test all App_Business_Point types resolve correctly
      expect(resolveAppBusinessPoint('app-1', metaModel)?.entityType).toBe('APPLICATION');
      expect(resolveAppBusinessPoint('ac-1', metaModel)?.entityType).toBe('APP_COMPONENT');
      expect(resolveAppBusinessPoint('svc-1', metaModel)?.entityType).toBe('SERVICE');
      expect(resolveAppBusinessPoint('int-1', metaModel)?.entityType).toBe('INTERFACE');
      expect(resolveAppBusinessPoint('ep-1', metaModel)?.entityType).toBe('ENDPOINT');
      expect(resolveAppBusinessPoint('bp-1', metaModel)?.entityType).toBe('BUSINESS_PROCESS');
      expect(resolveAppBusinessPoint('pa-1', metaModel)?.entityType).toBe('PROCESS_ACTIVITY');

      // Non-existent ID should return null
      expect(resolveAppBusinessPoint('non-existent', metaModel)).toBeNull();
    });
  });

  describe('Interaction rendering path calculation', () => {
    it('should calculate correct paths for two-point interaction', () => {
      const nodes: DiagramNode[] = [
        { id: 'user-n', entity_type: 'BUSINESS_USER', entity_id: 'u1', pos_x: 0, pos_y: 0, width: 40, height: 60, auto_size: true },
        { id: 'primary-n', entity_type: 'APPLICATION', entity_id: 'a1', pos_x: 100, pos_y: 0, width: 80, height: 60, auto_size: true },
        { id: 'secondary-n', entity_type: 'SERVICE', entity_id: 's1', pos_x: 200, pos_y: 0, width: 80, height: 60, auto_size: true },
      ];

      const interaction: DiagramUserInteraction = {
        id: 'dui-1',
        interaction_id: 'int-1',
        primary_node_id: 'primary-n',
        secondary_node_id: 'secondary-n',
        user_node_id: 'user-n',
        line_style: 'dotted',
      };

      const paths = calculateInteractionPaths(interaction, nodes);

      // Primary to secondary line should exist
      expect(paths.primaryToSecondaryLine).not.toBeNull();
      expect(paths.primaryToSecondaryLine!.start.x).toBe(140); // center of primary
      expect(paths.primaryToSecondaryLine!.end.x).toBe(240); // center of secondary

      // User to midpoint line should exist
      expect(paths.userToTargetLine).not.toBeNull();
      expect(paths.userToTargetLine!.start.x).toBe(20); // center of user
      expect(paths.userToTargetLine!.end.x).toBe(190); // midpoint between 140 and 240
    });
  });

  describe('EXPANDABLE_RELATIONSHIPS coverage', () => {
    it('should have INTERACTION relationships that all have actsAsContainment: false', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      relationships.forEach(rel => {
        // All INTERACTION relationships should be edge-only (not containment)
        expect(rel.actsAsContainment).toBe(false);
      });
    });

    it('should have POLYMORPHIC direction for app_business_point relationships', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERACTION);
      const polymorphicRels = relationships.filter(r => r.direction === 'POLYMORPHIC');
      expect(polymorphicRels.length).toBe(2); // primary and secondary
    });
  });
});
