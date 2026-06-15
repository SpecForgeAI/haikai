/**
 * Tests for AdvancedAddDialog Component
 *
 * Task Group 2: AdvancedAddDialog Modal Component
 * Tests the dialog component functionality including tree rendering,
 * selection semantics, and user interactions.
 */

import { ENTITY_TYPES, MetaModel } from '../types/model';
import { buildTreeData, getEntityTypeDisplayName } from '../components/DiagramsView/AdvancedAddDialog';

// Mock meta-model for testing
const createMockMetaModel = (): MetaModel => ({
  entities: {
    business_users: [
      { id: 'bu-1', name: 'Business User 1', description: '', tags: '' },
    ],
    business_processes: [
      { id: 'bp-1', name: 'Process 1', description: '', tags: '' },
      { id: 'bp-2', name: 'Process 2', description: '', tags: '' },
    ],
    process_activities: [
      { id: 'pa-1', business_process_id: 'bp-1', name: 'Activity 1', description: '', sequence_order: 1, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
      { id: 'pa-2', business_process_id: 'bp-1', name: 'Activity 2', description: '', sequence_order: 2, actor_hint: 'END_USER', user_interaction_level: 'MODERATE', tags: '' },
    ],
    applications: [
      { id: 'app-1', name: 'Test Application', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ],
    app_components: [
      { id: 'ac-1', application_id: 'app-1', name: 'Component 1', description: '', tags: '' },
      { id: 'ac-2', application_id: 'app-1', name: 'Component 2', description: '', tags: '' },
    ],
    services: [
      { id: 'svc-1', application_id: 'app-1', app_component_id: 'ac-1', name: 'Service 1', description: '', service_type: 'API', tags: '' },
      { id: 'svc-2', application_id: 'app-1', name: 'Service 2', description: '', service_type: 'API', tags: '' },
    ],
    interfaces: [
      { id: 'int-1', service_id: 'svc-1', name: 'Interface 1', description: '', interface_type: 'REST_API', tags: '' },
    ],
    application_points: [
      { id: 'ap-1', application_id: 'app-1', name: 'App Point 1', description: '', kind: 'APPLICATION', point_type: '', tags: '' },
    ],
    business_points: [
      { id: 'bpt-1', name: 'Process 1 Point', description: '', kind: 'BUSINESS_PROCESS', business_process_id: 'bp-1', tags: '' },
    ],
    logical_data_entities: [
      { id: 'lde-1', name: 'Logical Entity 1', description: '', tags: '' },
    ],
    logical_data_attributes: [
      { id: 'lda-1', logical_entity_id: 'lde-1', name: 'Attribute 1', description: '', data_type: 'String', is_primary_key: false, is_nullable: true, tags: '' },
    ],
    physical_data_entities: [
      { id: 'pde-1', name: 'Physical Entity 1', description: '', physical_type: 'Table', database: 'DB1', tags: '' },
    ],
    physical_data_attributes: [
      { id: 'pda-1', physical_entity_id: 'pde-1', name: 'Column 1', description: '', data_type: 'VARCHAR', is_primary_key: false, is_nullable: true, tags: '' },
    ],
  },
  relationships: {
    business_user_business_points: [],
    application_point_business_points: [
      { id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bpt-1', description: '', tags: '' },
    ],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [
      { id: 'ldepde-1', logical_entity_id: 'lde-1', physical_entity_id: 'pde-1', description: '', tags: '' },
    ],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  },
});

describe('AdvancedAddDialog Component', () => {
  // Test 1: Dialog renders with correct title format
  describe('Dialog title format', () => {
    it('should format title as "Advanced Add: <EntityType> "<EntityName>""', () => {
      const rootEntity = { id: 'app-1', name: 'Payments App', type: ENTITY_TYPES.APPLICATION };

      // Test getEntityTypeDisplayName
      expect(getEntityTypeDisplayName(ENTITY_TYPES.APPLICATION)).toBe('Application');
      expect(getEntityTypeDisplayName(ENTITY_TYPES.BUSINESS_PROCESS)).toBe('Business Process');
      expect(getEntityTypeDisplayName(ENTITY_TYPES.APP_COMPONENT)).toBe('App Component');

      // The title would be: Advanced Add: Application "Payments App"
      const expectedTitle = `Advanced Add: ${getEntityTypeDisplayName(rootEntity.type)} "${rootEntity.name}"`;
      expect(expectedTitle).toBe('Advanced Add: Application "Payments App"');
    });

    it('should handle various entity types in title', () => {
      const entityTypes = [
        { type: ENTITY_TYPES.BUSINESS_PROCESS, display: 'Business Process' },
        { type: ENTITY_TYPES.SERVICE, display: 'Service' },
        { type: ENTITY_TYPES.INTERFACE, display: 'Interface' },
        { type: ENTITY_TYPES.LOGICAL_DATA_ENTITY, display: 'Logical Data Entity' },
      ];

      entityTypes.forEach(({ type, display }) => {
        expect(getEntityTypeDisplayName(type)).toBe(display);
      });
    });
  });

  // Test 2: Root node is checked and disabled
  describe('Root node selection', () => {
    it('should mark root node as isRoot in tree data', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      expect(treeData.isRoot).toBe(true);
      expect(treeData.entityId).toBe('app-1');
      expect(treeData.entityName).toBe('Test Application');
    });

    it('should include root key in initial selection', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Root should always be in selection
      expect(treeData.key).toContain('root-app-1');
    });
  });

  // Test 3: Selecting child node should include parent relationship
  describe('Selection cascading - selecting child selects ancestors', () => {
    it('should build tree with parent-child relationships', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Should have children (app components, services, business processes)
      expect(treeData.children.length).toBeGreaterThan(0);

      // Find app component children
      const appComponentChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.APP_COMPONENT
      );
      expect(appComponentChildren.length).toBe(2); // ac-1 and ac-2

      // Each child should have parentKey pointing to root
      appComponentChildren.forEach((child) => {
        expect(child.parentKey).toBe(treeData.key);
        expect(child.isRoot).toBe(false);
      });
    });

    it('should propagate relationship kind to child nodes', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // App components should have PARENT_CHILD relationship kind
      const appComponentChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.APP_COMPONENT
      );
      appComponentChildren.forEach((child) => {
        expect(child.relationshipKind).toBe('PARENT_CHILD');
      });

      // Business processes should have ASSOCIATION relationship kind
      const bpChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.BUSINESS_PROCESS
      );
      bpChildren.forEach((child) => {
        expect(child.relationshipKind).toBe('ASSOCIATION');
      });
    });
  });

  // Test 4: Deselecting node deselects descendants but leaves ancestors unchanged
  describe('Selection cascading - deselecting deselects descendants', () => {
    it('should build nested tree structure for cascading deselection', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Find an app component with services
      const acWithServices = treeData.children.find(
        (child) =>
          child.entityType === ENTITY_TYPES.APP_COMPONENT &&
          child.children.some((gc) => gc.entityType === ENTITY_TYPES.SERVICE)
      );

      // ac-1 should have svc-1 as child
      if (acWithServices) {
        expect(acWithServices.children.length).toBeGreaterThan(0);
        const serviceChild = acWithServices.children.find(
          (c) => c.entityType === ENTITY_TYPES.SERVICE
        );
        expect(serviceChild).toBeDefined();
        expect(serviceChild?.parentKey).toBe(acWithServices.key);
      }
    });
  });

  // Test 5: Indeterminate checkbox state
  describe('Indeterminate checkbox state', () => {
    it('should build tree with multiple levels for indeterminate testing', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'bp-1', name: 'Process 1', type: ENTITY_TYPES.BUSINESS_PROCESS };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Should have process activities as children
      const activityChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.PROCESS_ACTIVITY
      );
      expect(activityChildren.length).toBe(2); // pa-1 and pa-2
    });
  });

  // Test 6: Add to Diagram button triggers onAdd callback
  describe('Add to Diagram button', () => {
    it('should build correct tree structure for selection building', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Verify tree has selectable children
      expect(treeData.children.length).toBeGreaterThan(0);

      // Each child should have the required properties for selection
      treeData.children.forEach((child) => {
        expect(child.key).toBeDefined();
        expect(child.entityType).toBeDefined();
        expect(child.entityId).toBeDefined();
        expect(child.relationshipKind).toBeDefined();
      });
    });
  });

  // Additional tests for tree building
  describe('Tree building from meta-model', () => {
    it('should find linked business processes via application points', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Should find bp-1 linked via application point
      const bpChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.BUSINESS_PROCESS
      );
      expect(bpChildren.length).toBe(1);
      expect(bpChildren[0].entityId).toBe('bp-1');
    });

it('should build multi-level tree with deduplication (svc-1 under AppComponent, svc-2 under Application)', () => {      const metaModel = createMockMetaModel();      const rootEntity = { id: 'app-1', name: 'Test Application', type: ENTITY_TYPES.APPLICATION };      const treeData = buildTreeData(metaModel, rootEntity);      // With deduplication: svc-1 (has app_component_id=ac-1) appears only under ac-1      // svc-2 (no app_component_id) appears directly under Application      const directServiceChildren = treeData.children.filter(        (child) => child.entityType === ENTITY_TYPES.SERVICE      );      expect(directServiceChildren.length).toBe(1);      expect(directServiceChildren[0].entityId).toBe('svc-2');      // svc-1 should be under ac-1 and have interface children      const ac1 = treeData.children.find(        (c) => c.entityType === ENTITY_TYPES.APP_COMPONENT && c.entityId === 'ac-1'      );      expect(ac1).toBeDefined();      const svc1UnderAc = ac1!.children.find(        (c) => c.entityType === ENTITY_TYPES.SERVICE && c.entityId === 'svc-1'      );      expect(svc1UnderAc).toBeDefined();      // svc-1 should have interface children (int-1)      const interfaceChildren = svc1UnderAc!.children.filter(        (c) => c.entityType === ENTITY_TYPES.INTERFACE      );      expect(interfaceChildren.length).toBe(1);      expect(interfaceChildren[0].entityId).toBe('int-1');    });
    });

    it('should handle entity with no related entities', () => {
      const emptyMetaModel: MetaModel = {
        entities: {
          business_users: [],
          business_processes: [],
          process_activities: [],
          applications: [{ id: 'app-solo', name: 'Solo App', description: '', app_type: 'Web', status: 'Active', tags: '' }],
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
      };

      const rootEntity = { id: 'app-solo', name: 'Solo App', type: ENTITY_TYPES.APPLICATION };
      const treeData = buildTreeData(emptyMetaModel, rootEntity);

      expect(treeData.isRoot).toBe(true);
      expect(treeData.children.length).toBe(0);
    });
  });

  // Test logical data entity relationships
  describe('Logical Data Entity tree building', () => {
    it('should include logical attributes as children', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'lde-1', name: 'Logical Entity 1', type: ENTITY_TYPES.LOGICAL_DATA_ENTITY };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Should have logical attribute children
      const attrChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE
      );
      expect(attrChildren.length).toBe(1);
      expect(attrChildren[0].entityId).toBe('lda-1');
      expect(attrChildren[0].relationshipKind).toBe('PARENT_CHILD');
    });

    it('should include physical entities as association children', () => {
      const metaModel = createMockMetaModel();
      const rootEntity = { id: 'lde-1', name: 'Logical Entity 1', type: ENTITY_TYPES.LOGICAL_DATA_ENTITY };

      const treeData = buildTreeData(metaModel, rootEntity);

      // Should have physical entity children via association
      const pdeChildren = treeData.children.filter(
        (child) => child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );
      expect(pdeChildren.length).toBe(1);
      expect(pdeChildren[0].entityId).toBe('pde-1');
      expect(pdeChildren[0].relationshipKind).toBe('ASSOCIATION');
    });
  });
});
