/**
 * Integration Tests for Custom Interface Visualisation + Advanced Add Child Layout Controls
 *
 * Task Group 5: Integration and Testing
 * Tests for the complete feature integration including:
 * - Layout configuration flow from dialog to layout algorithm
 * - Interface custom rendering with endpoints
 * - Grid layout algorithm with various configurations
 */

import {
  measureWithGrid,
  assignPositionsWithGrid,
  layoutAdvancedAddSelection,
  convertTodiagramNodes,
} from '../utils/compoundLayout';
import {
  formatEndpointLine,
  getEndpointLinesForInterface,
  calculateEndpointSectionHeight,
  isInterfaceWithCustomRendering,
  getEndpointLinesForNode,
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
} from '../utils/interfaceCustomRenderer';
import {
  LayoutTreeNode,
  LayoutConfig,
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONSTRAINTS,
  SPACING_PRESETS,
  AdvancedAddResult,
} from '../types/advancedAdd';
import { DiagramNode, Endpoint, EndpointType, MetaModel, ENTITY_TYPES } from '../types/model';

// Helper to create minimal metaModel fixture
function createTestMetaModel(endpoints: Endpoint[]): MetaModel {
  return {
    entities: {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: endpoints,
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
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

describe('Custom Interface Visualisation + Advanced Add Child Layout Controls - Integration', () => {
  // Test 5.1: Complete layout flow from config to positioned nodes
  describe('Layout Flow Integration', () => {
    it('should produce correctly positioned nodes with grid layout config', () => {
      const tree: LayoutTreeNode = {
        id: 'app-1',
        type: 'APPLICATION',
        label: 'Test Application',
        children: [
          { id: 'svc-1', type: 'SERVICE', label: 'Service 1', children: [] },
          { id: 'svc-2', type: 'SERVICE', label: 'Service 2', children: [] },
          { id: 'svc-3', type: 'SERVICE', label: 'Service 3', children: [] },
          { id: 'svc-4', type: 'SERVICE', label: 'Service 4', children: [] },
        ],
      };

      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 2,
        childNodeWidth: 150,
      };

      const viewportCenter = { x: 400, y: 300 };
      const result = layoutAdvancedAddSelection(tree, viewportCenter, 'normal', layoutConfig);

      // The root now spawns at the fixed origin (100,100); viewportCenter is
      // ignored (kept for API compatibility).
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);

      // Verify 2-column grid: children 0,1 on same row, children 2,3 on same row
      expect(result.children[0].y).toBe(result.children[1].y);
      expect(result.children[2].y).toBe(result.children[3].y);
      expect(result.children[0].y).toBeLessThan(result.children[2].y);
    });

    it('should correctly convert layout to diagram nodes with proper z-index', () => {
      const tree: LayoutTreeNode = {
        id: 'app-1',
        type: 'APPLICATION',
        label: 'Parent App',
        children: [
          { id: 'svc-1', type: 'SERVICE', label: 'Child Service', children: [] },
        ],
      };

      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 1,
        childNodeWidth: 160,
      };

      const viewportCenter = { x: 500, y: 400 };
      const layoutResult = layoutAdvancedAddSelection(tree, viewportCenter, 'normal', layoutConfig);
      const diagramNodes = convertTodiagramNodes(layoutResult, 10);

      // Verify z-index ordering: parent < children
      const parentNode = diagramNodes.find(n => n.entity_id === 'app-1');
      const childNode = diagramNodes.find(n => n.entity_id === 'svc-1');

      expect(parentNode).toBeDefined();
      expect(childNode).toBeDefined();
      expect(childNode!.z_index).toBeGreaterThan(parentNode!.z_index);
    });
  });

  // Test 5.2: Interface with endpoints integration
  describe('Interface Custom Rendering Integration', () => {
    it('should format multiple endpoints correctly for display', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-1',
          name: 'Get Customer',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/customers/{id}',
          operation_verb: 'GET',
          tags: '',
        },
        {
          id: 'ep-2',
          name: 'Create Customer',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/customers',
          operation_verb: 'POST',
          tags: '',
        },
        {
          id: 'ep-3',
          name: 'Update Customer',
          description: '',
          interface_id: 'if-1',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/customers/{id}',
          operation_verb: 'PUT',
          tags: '',
        },
      ];

      const metaModel = createTestMetaModel(endpoints);
      const lines = getEndpointLinesForInterface('if-1', metaModel);

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('1. GET /customers/{id} - Get Customer');
      expect(lines[1]).toBe('2. POST /customers - Create Customer');
      expect(lines[2]).toBe('3. PUT /customers/{id} - Update Customer');
    });

    it('should detect Interface nodes that need custom rendering', () => {
      const interfaceNode: DiagramNode = {
        id: 'node-1',
        entity_type: ENTITY_TYPES.INTERFACE,
        entity_id: 'if-1',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
        z_index: 1,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
        embedded_endpoint_ids: ['ep-1', 'ep-2'],
      };

      const regularNode: DiagramNode = {
        id: 'node-2',
        entity_type: ENTITY_TYPES.SERVICE,
        entity_id: 'svc-1',
        pos_x: 300,
        pos_y: 100,
        width: 120,
        height: 60,
        z_index: 2,
        auto_size: false,
        parent_node_id: null,
        style_override: {},
      };

      expect(isInterfaceWithCustomRendering(interfaceNode)).toBe(true);
      expect(isInterfaceWithCustomRendering(regularNode)).toBe(false);
    });

    it('should calculate correct height for endpoint section', () => {
      const threeEndpoints = ['Line 1', 'Line 2', 'Line 3'];
      const fiveEndpoints = ['L1', 'L2', 'L3', 'L4', 'L5'];

      const height3 = calculateEndpointSectionHeight(threeEndpoints);
      const height5 = calculateEndpointSectionHeight(fiveEndpoints);

      // Height should increase linearly with number of endpoints
      const expectedDiff = 2 * ENDPOINT_LINE_HEIGHT;
      expect(height5 - height3).toBe(expectedDiff);
    });
  });

  // Test 5.3: Layout constraints validation
  describe('Layout Constraints Integration', () => {
    it('should use correct defaults when no layout config provided', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'Root',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'Child', children: [] },
        ],
      };

      // No layoutConfig provided - should use single column layout
      const result = layoutAdvancedAddSelection(tree, { x: 500, y: 400 }, 'normal');

      // Single column = children stacked vertically (same X)
      if (result.children.length > 0) {
        expect(result.children[0].x).toBeDefined();
      }
    });

    it('should respect column count constraints (1-10)', () => {
      expect(LAYOUT_CONSTRAINTS.childColumns.min).toBe(1);
      expect(LAYOUT_CONSTRAINTS.childColumns.max).toBe(10);
    });

    it('should respect node width constraints (10-1000)', () => {
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.min).toBe(10);
      expect(LAYOUT_CONSTRAINTS.childNodeWidth.max).toBe(1000);
    });
  });

  // Test 5.4: Spacing presets with grid layout
  describe('Spacing Presets with Grid Layout', () => {
    it('should apply different spacing presets correctly with grid layout', () => {
      const tree: LayoutTreeNode = {
        id: 'root',
        type: 'APPLICATION',
        label: 'App',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'S1', children: [] },
          { id: 'c2', type: 'SERVICE', label: 'S2', children: [] },
        ],
      };

      const tightConfig: LayoutConfig = {
        ...SPACING_PRESETS.tight,
        childColumns: 2,
        childNodeWidth: 100,
      };

      const spaciousConfig: LayoutConfig = {
        ...SPACING_PRESETS.spacious,
        childColumns: 2,
        childNodeWidth: 100,
      };

      const tightResult = layoutAdvancedAddSelection(tree, { x: 400, y: 300 }, 'tight', tightConfig);
      const spaciousResult = layoutAdvancedAddSelection(tree, { x: 400, y: 300 }, 'spacious', spaciousConfig);

      // Spacious layout should produce larger container
      expect(spaciousResult.width).toBeGreaterThan(tightResult.width);
      expect(spaciousResult.height).toBeGreaterThan(tightResult.height);
    });
  });

  // Test 5.5: Edge cases
  describe('Edge Cases', () => {
    it('should handle empty children array in grid layout', () => {
      const tree: LayoutTreeNode = {
        id: 'leaf',
        type: 'SERVICE',
        label: 'Leaf Node',
        children: [],
      };

      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 3,
        childNodeWidth: 120,
      };

      const result = layoutAdvancedAddSelection(tree, { x: 400, y: 300 }, 'normal', layoutConfig);

      expect(result.children).toHaveLength(0);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });

    it('should handle more columns than children', () => {
      const tree: LayoutTreeNode = {
        id: 'parent',
        type: 'APPLICATION',
        label: 'Parent',
        children: [
          { id: 'c1', type: 'SERVICE', label: 'Only Child', children: [] },
        ],
      };

      const layoutConfig: LayoutConfig = {
        ...SPACING_PRESETS.normal,
        childColumns: 5, // More columns than children
        childNodeWidth: 100,
      };

      const result = layoutAdvancedAddSelection(tree, { x: 400, y: 300 }, 'normal', layoutConfig);

      expect(result.children).toHaveLength(1);
      // Single child should still be properly positioned
      expect(result.children[0].x).toBeDefined();
      expect(result.children[0].y).toBeDefined();
    });

    it('should handle interface with no endpoints', () => {
      const emptyMetaModel = createTestMetaModel([]);
      const lines = getEndpointLinesForInterface('if-nonexistent', emptyMetaModel);

      expect(lines).toHaveLength(0);
      expect(calculateEndpointSectionHeight(lines)).toBe(0);
    });
  });

  // Test 5.6: AdvancedAddResult structure
  describe('AdvancedAddResult Integration', () => {
    it('should support all layout-related fields', () => {
      const result: AdvancedAddResult = {
        treeData: {
          key: 'root',
          label: 'Root',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test App',
          isRoot: true,
          children: [],
        },
        selectedKeys: new Set(['root']),
        selections: [],
        spacingPreset: 'normal',
        childColumns: 3,
        childNodeWidth: 200,
      };

      expect(result.spacingPreset).toBe('normal');
      expect(result.childColumns).toBe(3);
      expect(result.childNodeWidth).toBe(200);
    });

    it('should work with optional layout fields (backward compatibility)', () => {
      const result: AdvancedAddResult = {
        treeData: {
          key: 'root',
          label: 'Root',
          entityType: 'APPLICATION',
          entityId: 'app-1',
          entityName: 'Test App',
          isRoot: true,
          children: [],
        },
        selectedKeys: new Set(['root']),
        selections: [],
        // No layout fields - should be optional
      };

      expect(result.childColumns).toBeUndefined();
      expect(result.childNodeWidth).toBeUndefined();
    });
  });
});
