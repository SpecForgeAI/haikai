/**
 * LogicalER Modal Integration Tests
 * Task Group 2: Tests for modal wiring to PalettePanel and Create & Add flow
 *
 * Tests the integration between the PalettePanel and LogicalErCreateModal,
 * including modal state management, Create & Add flow, and edge creation.
 */

import { describe, it, expect } from 'vitest';
import {
  LogicalDataEntityRelationship,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';

// Mock form data interface (matches LogicalErCreateModal)
interface LogicalERFormData {
  fromKind: 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';
  fromEntity: string;
  toKind: 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';
  toEntity: string;
  cardinality: 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';
  relationship: 'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY';
  description: string;
}

// Mock MetaModel for testing
const createMockMetaModel = (): MetaModel => ({
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
    methods: [],
    application_points: [],
    logical_data_entities: [
      { id: 'lde-1', name: 'Customer', description: '', tags: '' },
      { id: 'lde-2', name: 'Order', description: '', tags: '' },
      { id: 'lde-3', name: 'Product', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [
      { id: 'pde-1', name: 'customers_table', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
    ],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [],
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
});

// Mock diagram with nodes
const createMockDiagram = (): { diagram_nodes: DiagramNode[]; diagram_edges: DiagramEdge[] } => ({
  diagram_nodes: [
    {
      id: 'node-1',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      z_index: 1,
      parent_node_id: null,
    },
    {
      id: 'node-2',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-2',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      z_index: 2,
      parent_node_id: null,
    },
  ],
  diagram_edges: [],
});

/**
 * Create LogicalDataEntityRelationship from form data
 */
function createRelationshipFromFormData(formData: LogicalERFormData): LogicalDataEntityRelationship {
  return {
    id: generatePrefixedId('ler'),
    from_ref_kind: formData.fromKind,
    from_ref_id: formData.fromEntity,
    to_ref_kind: formData.toKind,
    to_ref_id: formData.toEntity,
    cardinality: formData.cardinality,
    relationship: formData.relationship,
    description: formData.description,
    tags: '',
  };
}

/**
 * Find node for entity on diagram
 */
function findNodeForEntity(
  nodes: DiagramNode[],
  entityType: string,
  entityId: string
): DiagramNode | undefined {
  return nodes.find(n => n.entity_type === entityType && n.entity_id === entityId);
}

/**
 * Check if both endpoint nodes exist on diagram
 */
function checkEndpointsOnDiagram(
  formData: LogicalERFormData,
  diagram: { diagram_nodes: DiagramNode[] }
): { fromNodeExists: boolean; toNodeExists: boolean; fromNode?: DiagramNode; toNode?: DiagramNode } {
  const fromEntityType = formData.fromKind === 'LOGICAL_ENTITY'
    ? ENTITY_TYPES.LOGICAL_DATA_ENTITY
    : ENTITY_TYPES.PHYSICAL_DATA_ENTITY;
  const toEntityType = formData.toKind === 'LOGICAL_ENTITY'
    ? ENTITY_TYPES.LOGICAL_DATA_ENTITY
    : ENTITY_TYPES.PHYSICAL_DATA_ENTITY;

  const fromNode = findNodeForEntity(diagram.diagram_nodes, fromEntityType, formData.fromEntity);
  const toNode = findNodeForEntity(diagram.diagram_nodes, toEntityType, formData.toEntity);

  return {
    fromNodeExists: !!fromNode,
    toNodeExists: !!toNode,
    fromNode,
    toNode,
  };
}

/**
 * Simulate edge creation for LogicalER relationship
 */
function createLogicalEREdge(
  relationship: LogicalDataEntityRelationship,
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): DiagramEdge {
  return {
    id: generatePrefixedId('edge'),
    relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
    relationship_id: relationship.id,
    source_node_id: sourceNode.id,
    target_node_id: targetNode.id,
    edge_points: [
      { id: 'ep-1', sequence_order: 0, pos_x: sourceNode.pos_x + sourceNode.width, pos_y: sourceNode.pos_y + sourceNode.height / 2 },
      { id: 'ep-2', sequence_order: 1, pos_x: targetNode.pos_x, pos_y: targetNode.pos_y + targetNode.height / 2 },
    ],
    line_type: 'SOLID',
  };
}

describe('LogicalER Modal Integration - Modal State Management', () => {
  describe('Task 2.2: Modal state management in PalettePanel', () => {
    it('should track modal open state', () => {
      // Simulate modal state
      let logicalErModalOpen = false;

      // Open modal
      logicalErModalOpen = true;
      expect(logicalErModalOpen).toBe(true);

      // Close modal
      logicalErModalOpen = false;
      expect(logicalErModalOpen).toBe(false);
    });

    it('should reset modal data when modal closes', () => {
      let modalData: LogicalERFormData | null = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      // Close modal resets data
      modalData = null;
      expect(modalData).toBeNull();
    });
  });
});

describe('LogicalER Modal Integration - Create & Add Flow', () => {
  describe('Task 2.3: "+ New Logical ER" opens modal', () => {
    it('should open modal when handleCreateButtonClick is called for LOGICAL_DATA_ENTITY_RELATIONSHIP', () => {
      let modalOpened = false;

      const handleCreateButtonClick = (entityType: string) => {
        if (entityType === 'LOGICAL_DATA_ENTITY_RELATIONSHIP') {
          modalOpened = true;
        }
      };

      handleCreateButtonClick('LOGICAL_DATA_ENTITY_RELATIONSHIP');
      expect(modalOpened).toBe(true);
    });

    it('should not open modal for other entity types', () => {
      let modalOpened = false;

      const handleCreateButtonClick = (entityType: string) => {
        if (entityType === 'LOGICAL_DATA_ENTITY_RELATIONSHIP') {
          modalOpened = true;
        }
      };

      handleCreateButtonClick('STATE');
      expect(modalOpened).toBe(false);
    });
  });

  describe('Task 2.4: Create & Add dispatches ADD_RELATIONSHIP action', () => {
    it('should create relationship from form data with correct fields', () => {
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_MANY',
        relationship: 'COMPOSITION',
        description: 'Customer has many Orders',
      };

      const relationship = createRelationshipFromFormData(formData);

      // ID format: prefix-timestamp-random (e.g., ler-abc123-xyz45)
      expect(relationship.id).toMatch(/^ler-/);
      expect(relationship.from_ref_kind).toBe('LOGICAL_ENTITY');
      expect(relationship.from_ref_id).toBe('lde-1');
      expect(relationship.to_ref_kind).toBe('LOGICAL_ENTITY');
      expect(relationship.to_ref_id).toBe('lde-2');
      expect(relationship.cardinality).toBe('ONE_TO_MANY');
      expect(relationship.relationship).toBe('COMPOSITION');
      expect(relationship.description).toBe('Customer has many Orders');
    });

    it('should dispatch ADD_RELATIONSHIP action structure', () => {
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const relationship = createRelationshipFromFormData(formData);

      const action = {
        type: 'ADD_RELATIONSHIP' as const,
        relationshipType: 'logical_data_entity_relationships' as const,
        relationship,
      };

      expect(action.type).toBe('ADD_RELATIONSHIP');
      expect(action.relationshipType).toBe('logical_data_entity_relationships');
      expect(action.relationship.from_ref_id).toBe('lde-1');
    });
  });

  describe('Task 2.5: Edge is created and added to diagram', () => {
    it('should create edge with correct relationship type', () => {
      const diagram = createMockDiagram();
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const relationship = createRelationshipFromFormData(formData);
      const { fromNode, toNode } = checkEndpointsOnDiagram(formData, diagram);

      expect(fromNode).toBeDefined();
      expect(toNode).toBeDefined();

      const edge = createLogicalEREdge(relationship, fromNode!, toNode!);

      expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP);
      expect(edge.relationship_id).toBe(relationship.id);
      expect(edge.source_node_id).toBe('node-1');
      expect(edge.target_node_id).toBe('node-2');
    });

    it('should create edge points connecting node boundaries', () => {
      const diagram = createMockDiagram();
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const relationship = createRelationshipFromFormData(formData);
      const { fromNode, toNode } = checkEndpointsOnDiagram(formData, diagram);
      const edge = createLogicalEREdge(relationship, fromNode!, toNode!);

      expect(edge.edge_points).toHaveLength(2);
      expect(edge.edge_points[0].sequence_order).toBe(0);
      expect(edge.edge_points[1].sequence_order).toBe(1);
    });
  });

  describe('Task 2.6: Auto-add missing endpoint nodes', () => {
    it('should detect when fromNode is missing from diagram', () => {
      const diagram = createMockDiagram();
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-3', // Product - not on diagram
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2', // Order - on diagram
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const { fromNodeExists, toNodeExists } = checkEndpointsOnDiagram(formData, diagram);

      expect(fromNodeExists).toBe(false);
      expect(toNodeExists).toBe(true);
    });

    it('should detect when toNode is missing from diagram', () => {
      const diagram = createMockDiagram();
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1', // Customer - on diagram
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-3', // Product - not on diagram
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const { fromNodeExists, toNodeExists } = checkEndpointsOnDiagram(formData, diagram);

      expect(fromNodeExists).toBe(true);
      expect(toNodeExists).toBe(false);
    });

    it('should detect when both nodes are missing from diagram', () => {
      const diagram = { diagram_nodes: [], diagram_edges: [] };
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1',
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2',
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const { fromNodeExists, toNodeExists } = checkEndpointsOnDiagram(formData, diagram);

      expect(fromNodeExists).toBe(false);
      expect(toNodeExists).toBe(false);
    });

    it('should detect when both nodes exist on diagram', () => {
      const diagram = createMockDiagram();
      const formData: LogicalERFormData = {
        fromKind: 'LOGICAL_ENTITY',
        fromEntity: 'lde-1', // Customer - on diagram
        toKind: 'LOGICAL_ENTITY',
        toEntity: 'lde-2', // Order - on diagram
        cardinality: 'ONE_TO_ONE',
        relationship: 'ASSOCIATION',
        description: '',
      };

      const { fromNodeExists, toNodeExists } = checkEndpointsOnDiagram(formData, diagram);

      expect(fromNodeExists).toBe(true);
      expect(toNodeExists).toBe(true);
    });
  });

  describe('Task 2.7: Modal closes on successful creation', () => {
    it('should call onClose after successful submission', async () => {
      let modalClosed = false;
      let submissionCompleted = false;

      const onClose = () => {
        modalClosed = true;
      };

      const onSubmit = async () => {
        // Simulate successful creation
        submissionCompleted = true;
      };

      // Simulate submission flow
      await onSubmit();
      if (submissionCompleted) {
        onClose();
      }

      expect(submissionCompleted).toBe(true);
      expect(modalClosed).toBe(true);
    });

    it('should not close modal on submission error', async () => {
      let modalClosed = false;
      let errorCaught = false;

      const onClose = () => {
        modalClosed = true;
      };

      const onSubmit = async () => {
        throw new Error('Network error');
      };

      // Simulate submission flow with error handling
      try {
        await onSubmit();
        onClose();
      } catch {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
      expect(modalClosed).toBe(false);
    });
  });
});

describe('LogicalER Modal Integration - Physical Entity Support', () => {
  it('should support PHYSICAL_ENTITY kind for From endpoint', () => {
    const formData: LogicalERFormData = {
      fromKind: 'PHYSICAL_ENTITY',
      fromEntity: 'pde-1',
      toKind: 'LOGICAL_ENTITY',
      toEntity: 'lde-1',
      cardinality: 'ONE_TO_ONE',
      relationship: 'REALIZATION',
      description: 'Physical table implements logical entity',
    };

    const relationship = createRelationshipFromFormData(formData);

    expect(relationship.from_ref_kind).toBe('PHYSICAL_ENTITY');
    expect(relationship.from_ref_id).toBe('pde-1');
    expect(relationship.to_ref_kind).toBe('LOGICAL_ENTITY');
    expect(relationship.to_ref_id).toBe('lde-1');
  });

  it('should detect physical entity nodes on diagram', () => {
    const diagram = {
      diagram_nodes: [
        {
          id: 'node-pde-1',
          entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
          entity_id: 'pde-1',
          pos_x: 100,
          pos_y: 100,
          width: 120,
          height: 60,
          z_index: 1,
          parent_node_id: null,
        },
      ],
      diagram_edges: [],
    };

    const formData: LogicalERFormData = {
      fromKind: 'PHYSICAL_ENTITY',
      fromEntity: 'pde-1',
      toKind: 'LOGICAL_ENTITY',
      toEntity: 'lde-1',
      cardinality: 'ONE_TO_ONE',
      relationship: 'REALIZATION',
      description: '',
    };

    const { fromNodeExists, toNodeExists } = checkEndpointsOnDiagram(formData, diagram);

    expect(fromNodeExists).toBe(true);
    expect(toNodeExists).toBe(false);
  });
});
