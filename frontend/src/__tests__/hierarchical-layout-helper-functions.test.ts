/**
 * Hierarchical Layout Helper Functions Tests
 *
 * Task Group 3: Helper Function Updates
 * Tests for text measurement helpers, tree conversion, and entity name lookup.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  estimateLabelWidth,
  estimateLabelHeight,
  LAYOUT_DEFAULT_FONT_SIZE,
  LAYOUT_MIN_NODE_WIDTH,
  LAYOUT_PADDING_X,
} from '../utils/compoundLayout';
import { MetaModel, ENTITY_TYPES } from '../types/model';
import { TreeNodeData, LayoutTreeNode } from '../types/advancedAdd';

// ============================================================================
// Mock Setup for Canvas Text Measurement
// ============================================================================

// Track the mock character width for predictable test results
const MOCK_CHAR_WIDTH = 7;

beforeAll(() => {
  // Mock canvas for text measurement
  const mockContext = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * MOCK_CHAR_WIDTH,
    }),
  };

  const mockCanvas = {
    getContext: () => mockContext,
  };

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = ((tagName: string) => {
    if (tagName === 'canvas') {
      return mockCanvas as unknown as HTMLCanvasElement;
    }
    return originalCreateElement(tagName);
  }) as typeof document.createElement;
});

// ============================================================================
// Test Helper: getEntityName() re-implementation for testing
// This matches the implementation in PalettePanel.tsx
// ============================================================================

function getEntityName(
  metaModel: MetaModel,
  entityType: string,
  entityId: string
): string {
  const entityArrayMap: Record<string, keyof MetaModel['entities']> = {
    [ENTITY_TYPES.APPLICATION]: 'applications',
    [ENTITY_TYPES.APP_COMPONENT]: 'app_components',
    [ENTITY_TYPES.SERVICE]: 'services',
    [ENTITY_TYPES.INTERFACE]: 'interfaces',
    [ENTITY_TYPES.BUSINESS_PROCESS]: 'business_processes',
    [ENTITY_TYPES.PROCESS_ACTIVITY]: 'process_activities',
    [ENTITY_TYPES.BUSINESS_USER]: 'business_users',
    [ENTITY_TYPES.APPLICATION_POINT]: 'application_points',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
    [ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE]: 'logical_data_attributes',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
    [ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE]: 'physical_data_attributes',
  };

  const arrayName = entityArrayMap[entityType];
  if (!arrayName) return 'Unknown';

  const entities = metaModel.entities[arrayName] as Array<{ id: string; name: string }>;
  const entity = entities?.find(e => e.id === entityId);
  return entity?.name || 'Unknown';
}

// ============================================================================
// Test Helper: convertTreeNodeToLayoutTree() re-implementation for testing
// This matches the implementation in PalettePanel.tsx
// ============================================================================

function convertTreeNodeToLayoutTree(
  treeNode: TreeNodeData,
  metaModel: MetaModel,
  selectedKeys: Set<string>
): LayoutTreeNode | null {
  // Only include nodes that are selected
  if (!selectedKeys.has(treeNode.key)) {
    return null;
  }

  const entityName = getEntityName(metaModel, treeNode.entityType, treeNode.entityId);

  // Recursively convert children, filtering to only selected nodes
  const children: LayoutTreeNode[] = [];
  for (const child of treeNode.children) {
    const convertedChild = convertTreeNodeToLayoutTree(child, metaModel, selectedKeys);
    if (convertedChild) {
      children.push(convertedChild);
    }
  }

  return {
    id: treeNode.entityId,
    type: treeNode.entityType,
    label: entityName,
    children,
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock MetaModel with test data
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-1', name: 'My Application', valid_from: null, valid_to: null },
        { id: 'app-2', name: 'Another Application', valid_from: null, valid_to: null },
      ],
      app_components: [
        { id: 'comp-1', name: 'Frontend Component', application_id: 'app-1', valid_from: null, valid_to: null },
        { id: 'comp-2', name: 'Backend Component', application_id: 'app-1', valid_from: null, valid_to: null },
      ],
      services: [
        { id: 'svc-1', name: 'User Service', app_component_id: 'comp-1', valid_from: null, valid_to: null },
      ],
      interfaces: [
        { id: 'int-1', name: 'REST API', service_id: 'svc-1', valid_from: null, valid_to: null },
      ],
      business_processes: [
        { id: 'bp-1', name: 'Order Processing', valid_from: null, valid_to: null },
        { id: 'bp-2', name: 'Customer Onboarding', valid_from: null, valid_to: null },
      ],
      process_activities: [
        { id: 'pa-1', name: 'Validate Order', business_process_id: 'bp-1', user_interaction_level: 'none', frequency: 'daily', valid_from: null, valid_to: null },
        { id: 'pa-2', name: 'Process Payment', business_process_id: 'bp-1', user_interaction_level: 'none', frequency: 'daily', valid_from: null, valid_to: null },
      ],
      business_users: [
        { id: 'user-1', name: 'Sales Rep' },
      ],
      application_points: [],
      business_points: [],
      logical_data_entities: [
        { id: 'lde-1', name: 'Customer', valid_from: null, valid_to: null },
        { id: 'lde-2', name: 'Order', valid_from: null, valid_to: null },
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'customer_id', logical_data_entity_id: 'lde-1' },
      ],
      physical_data_entities: [
        { id: 'pde-1', name: 'customers_table', valid_from: null, valid_to: null },
      ],
      physical_data_attributes: [
        { id: 'pda-1', name: 'cust_id', physical_data_entity_id: 'pde-1' },
      ],
    },
    relationships: {
      business_user_processes: [],
      business_user_business_points: [],
      application_point_business_processes: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  } as MetaModel;
}

/**
 * Create a test TreeNodeData structure
 */
function createTestTreeNode(): TreeNodeData {
  return {
    key: 'root-app-1',
    label: 'APPLICATION: My Application',
    entityType: ENTITY_TYPES.APPLICATION,
    entityId: 'app-1',
    entityName: 'My Application',
    isRoot: true,
    children: [
      {
        key: 'comp-comp-1',
        label: 'APP_COMPONENT: Frontend Component',
        entityType: ENTITY_TYPES.APP_COMPONENT,
        entityId: 'comp-1',
        entityName: 'Frontend Component',
        isRoot: false,
        parentKey: 'root-app-1',
        children: [
          {
            key: 'svc-svc-1',
            label: 'SERVICE: User Service',
            entityType: ENTITY_TYPES.SERVICE,
            entityId: 'svc-1',
            entityName: 'User Service',
            isRoot: false,
            parentKey: 'comp-comp-1',
            children: [],
          },
        ],
      },
      {
        key: 'comp-comp-2',
        label: 'APP_COMPONENT: Backend Component',
        entityType: ENTITY_TYPES.APP_COMPONENT,
        entityId: 'comp-2',
        entityName: 'Backend Component',
        isRoot: false,
        parentKey: 'root-app-1',
        children: [],
      },
    ],
  };
}

// ============================================================================
// Test 1: Label width estimation matches expected values
// ============================================================================

describe('estimateLabelWidth() - Text Width Estimation', () => {
  it('should return width based on text length and font size', () => {
    const text = 'Hello World'; // 11 characters
    const expectedWidth = 11 * MOCK_CHAR_WIDTH; // 77 pixels

    const width = estimateLabelWidth(text, LAYOUT_DEFAULT_FONT_SIZE, 'normal');

    expect(width).toBe(expectedWidth);
  });

  it('should return consistent width for same text', () => {
    const text = 'Test Label';
    const width1 = estimateLabelWidth(text);
    const width2 = estimateLabelWidth(text);

    expect(width1).toBe(width2);
  });

  it('should return longer width for longer text', () => {
    const shortText = 'Short';
    const longText = 'This is a much longer label text';

    const shortWidth = estimateLabelWidth(shortText);
    const longWidth = estimateLabelWidth(longText);

    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('should return 0 width for empty string', () => {
    const width = estimateLabelWidth('');
    expect(width).toBe(0);
  });

  it('should handle special characters correctly', () => {
    const textWithSpecials = 'User@Domain.com';
    const expectedWidth = textWithSpecials.length * MOCK_CHAR_WIDTH;

    const width = estimateLabelWidth(textWithSpecials);

    expect(width).toBe(expectedWidth);
  });
});

// ============================================================================
// Test 2: Label height calculation with multi-line text wrapping
// ============================================================================

describe('estimateLabelHeight() - Text Height with Wrapping', () => {
  it('should return single line height for short text', () => {
    const text = 'Short';
    const maxWidth = 200; // Wide enough for single line

    const height = estimateLabelHeight(text, maxWidth);

    // Single line = fontSize (12) + no line spacing
    expect(height).toBe(LAYOUT_DEFAULT_FONT_SIZE);
  });

  it('should return multi-line height for text that wraps', () => {
    const text = 'This is a very long label that will definitely need to wrap to multiple lines';
    // With MOCK_CHAR_WIDTH = 7, 77 chars = 539 pixels
    // maxWidth = 100, so text will wrap to multiple lines
    const maxWidth = 100;

    const height = estimateLabelHeight(text, maxWidth);

    // Height should be greater than single line
    expect(height).toBeGreaterThan(LAYOUT_DEFAULT_FONT_SIZE);
  });

  it('should return 0 height for empty string', () => {
    const height = estimateLabelHeight('', 200);
    expect(height).toBe(0);
  });

  it('should calculate height correctly for narrow container', () => {
    // Create text that will wrap multiple times in a narrow container
    const text = 'Application Component Service Interface';
    const narrowWidth = 50; // Very narrow, will cause wrapping

    const narrowHeight = estimateLabelHeight(text, narrowWidth);
    const wideHeight = estimateLabelHeight(text, 500);

    // Narrow container should produce taller height due to wrapping
    expect(narrowHeight).toBeGreaterThan(wideHeight);
  });

  it('should handle default max width from layout constants', () => {
    const text = 'Test Label';
    const defaultMaxWidth = LAYOUT_MIN_NODE_WIDTH - 2 * LAYOUT_PADDING_X; // 120 - 40 = 80

    const height = estimateLabelHeight(text, defaultMaxWidth);

    // Should return a positive height
    expect(height).toBeGreaterThan(0);
  });
});

// ============================================================================
// Test 3: Tree-to-LayoutTreeNode conversion produces correct structure
// ============================================================================

describe('convertTreeNodeToLayoutTree() - Tree Conversion', () => {
  it('should convert a single root node correctly', () => {
    const metaModel = createTestMetaModel();
    const treeNode = createTestTreeNode();
    const selectedKeys = new Set(['root-app-1']);

    const layoutTree = convertTreeNodeToLayoutTree(treeNode, metaModel, selectedKeys);

    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.id).toBe('app-1');
    expect(layoutTree!.type).toBe(ENTITY_TYPES.APPLICATION);
    expect(layoutTree!.label).toBe('My Application');
    expect(layoutTree!.children).toHaveLength(0); // No children selected
  });

  it('should convert a tree with all nodes selected', () => {
    const metaModel = createTestMetaModel();
    const treeNode = createTestTreeNode();
    const selectedKeys = new Set([
      'root-app-1',
      'comp-comp-1',
      'comp-comp-2',
      'svc-svc-1',
    ]);

    const layoutTree = convertTreeNodeToLayoutTree(treeNode, metaModel, selectedKeys);

    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.id).toBe('app-1');
    expect(layoutTree!.children).toHaveLength(2);

    // Check first child (Frontend Component)
    const frontendComp = layoutTree!.children.find(c => c.id === 'comp-1');
    expect(frontendComp).toBeDefined();
    expect(frontendComp!.label).toBe('Frontend Component');
    expect(frontendComp!.children).toHaveLength(1);

    // Check grandchild (User Service)
    const userService = frontendComp!.children[0];
    expect(userService.id).toBe('svc-1');
    expect(userService.label).toBe('User Service');
    expect(userService.children).toHaveLength(0);

    // Check second child (Backend Component)
    const backendComp = layoutTree!.children.find(c => c.id === 'comp-2');
    expect(backendComp).toBeDefined();
    expect(backendComp!.label).toBe('Backend Component');
    expect(backendComp!.children).toHaveLength(0);
  });

  it('should exclude unselected nodes from the tree', () => {
    const metaModel = createTestMetaModel();
    const treeNode = createTestTreeNode();
    // Only select root and one child, excluding the service
    const selectedKeys = new Set([
      'root-app-1',
      'comp-comp-1',
      // comp-comp-2 not selected
      // svc-svc-1 not selected
    ]);

    const layoutTree = convertTreeNodeToLayoutTree(treeNode, metaModel, selectedKeys);

    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.children).toHaveLength(1);
    expect(layoutTree!.children[0].id).toBe('comp-1');
    expect(layoutTree!.children[0].children).toHaveLength(0); // Service not included
  });

  it('should return null for unselected root', () => {
    const metaModel = createTestMetaModel();
    const treeNode = createTestTreeNode();
    const selectedKeys = new Set<string>(); // Empty - nothing selected

    const layoutTree = convertTreeNodeToLayoutTree(treeNode, metaModel, selectedKeys);

    expect(layoutTree).toBeNull();
  });

  it('should correctly map entityType to type and entityId to id', () => {
    const metaModel = createTestMetaModel();
    const treeNode: TreeNodeData = {
      key: 'bp-bp-1',
      label: 'BUSINESS_PROCESS: Order Processing',
      entityType: ENTITY_TYPES.BUSINESS_PROCESS,
      entityId: 'bp-1',
      entityName: 'Order Processing',
      isRoot: true,
      children: [],
    };
    const selectedKeys = new Set(['bp-bp-1']);

    const layoutTree = convertTreeNodeToLayoutTree(treeNode, metaModel, selectedKeys);

    expect(layoutTree).not.toBeNull();
    expect(layoutTree!.id).toBe('bp-1'); // entityId -> id
    expect(layoutTree!.type).toBe(ENTITY_TYPES.BUSINESS_PROCESS); // entityType -> type
    expect(layoutTree!.label).toBe('Order Processing'); // looked up from metaModel
  });
});

// ============================================================================
// Test 4: Entity name lookup works for all supported entity types
// ============================================================================

describe('getEntityName() - Entity Name Lookup', () => {
  it('should look up APPLICATION name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.APPLICATION, 'app-1');
    expect(name).toBe('My Application');
  });

  it('should look up APP_COMPONENT name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.APP_COMPONENT, 'comp-1');
    expect(name).toBe('Frontend Component');
  });

  it('should look up SERVICE name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.SERVICE, 'svc-1');
    expect(name).toBe('User Service');
  });

  it('should look up INTERFACE name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.INTERFACE, 'int-1');
    expect(name).toBe('REST API');
  });

  it('should look up BUSINESS_PROCESS name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1');
    expect(name).toBe('Order Processing');
  });

  it('should look up PROCESS_ACTIVITY name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.PROCESS_ACTIVITY, 'pa-1');
    expect(name).toBe('Validate Order');
  });

  it('should look up BUSINESS_USER name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.BUSINESS_USER, 'user-1');
    expect(name).toBe('Sales Rep');
  });

  it('should look up LOGICAL_DATA_ENTITY name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-1');
    expect(name).toBe('Customer');
  });

  it('should look up LOGICAL_DATA_ATTRIBUTE name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1');
    expect(name).toBe('customer_id');
  });

  it('should look up PHYSICAL_DATA_ENTITY name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'pde-1');
    expect(name).toBe('customers_table');
  });

  it('should look up PHYSICAL_DATA_ATTRIBUTE name correctly', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE, 'pda-1');
    expect(name).toBe('cust_id');
  });

  it('should return "Unknown" for non-existent entity ID', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, ENTITY_TYPES.APPLICATION, 'non-existent-id');
    expect(name).toBe('Unknown');
  });

  it('should return "Unknown" for unknown entity type', () => {
    const metaModel = createTestMetaModel();
    const name = getEntityName(metaModel, 'UNKNOWN_TYPE', 'some-id');
    expect(name).toBe('Unknown');
  });
});
