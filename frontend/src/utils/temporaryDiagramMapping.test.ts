/**
 * Tests for Deterministic Diagram Auto-Mapping Engine
 *
 * Spec: Deterministic Diagram Auto-Mapping Framework (Increment 5)
 *
 * Task Group 1: Mapping Result Types and Reason Codes
 * Task Group 2: Pre-Indexing Functions for O(1) Lookups
 * Task Group 3: Entity Matching (Step 1 of 3)
 * Task Group 4: Attribute Matching (Step 2 of 3)
 * Task Group 5: Relationship Matching (Step 3 of 3)
 * Task Group 6: Summary Computation and Orchestrator Finalization
 * Task Group 8: Test Review and Gap Analysis
 */

import { describe, it, expect } from 'vitest';
import {
  mapTemporaryDiagram,
  buildEntityNameIndex,
  buildAttributeIndex,
  buildRelationshipIndex,
  getEntityCollectionKey,
  validateNodeSemanticType,
  mapEntities,
  mapAttributes,
  mapRelationships,
  DiagramMappingResult,
} from './temporaryDiagramMapping';
import { TemporaryArchitectureDiagram } from '../types/temporaryArchitectureDiagram';
import {
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
  LogicalDataEntity,
  LogicalDataAttribute,
  PhysicalDataEntity,
  PhysicalDataAttribute,
  LogicalDataEntityRelationship,
} from '../types/model';

// ============================================================================
// TEST HELPERS: Minimal factory functions for test data
// ============================================================================

/**
 * Creates a minimal empty MetaModel for testing.
 */
function createEmptyMetaModel(): MetaModel {
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
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      ui_characteristics: [],
      package_sets: [],
      packages: [],
      user_journeys: [],
      activity_steps: [],
      // Spec 2026-05-04: Infrastructure Domain Frontend Types
      environments: [],
      cloud_accounts: [],
      locations: [],
      networks: [],
      subnets: [],
      compute_clusters: [],
      compute_resources: [],
      deployment_units: [],
      load_balancers: [],
      listeners: [],
      data_store_instances: [],
      infrastructure_resources: [],
      infrastructure_points: [],
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
      iac_sources: [],
      // Spec 2026-05-06: Library Frontend Types & Tables
      libraries: [],
    } as MetaModelEntities,
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
      // Spec 2026-05-04: Infrastructure Domain Frontend Types
      user_journey_links: [],
      resource_subnet_hostings: [],
      deployment_unit_compute_resources: [],
      load_balancer_resource_routes: [],
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
      iac_resource_bindings: [],
    } as MetaModelRelationships,
  };
}

/**
 * Creates a minimal empty TemporaryArchitectureDiagram for testing.
 */
function createEmptyDiagram(overrides?: Partial<TemporaryArchitectureDiagram>): TemporaryArchitectureDiagram {
  return {
    id: 'diag-1',
    name: 'Test Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

// ============================================================================
// TASK GROUP 1: Mapping Result Types and Reason Codes
// ============================================================================

describe('Task Group 1: Mapping Result Types and Reason Codes', () => {

  describe('mapTemporaryDiagram - result shape and error guards', () => {

    it('returns a result conforming to DiagramMappingResult shape (has nodes, attributes, edges, summary, overallStatus fields)', () => {
      // Given
      const diagram = createEmptyDiagram();
      const metaModel = createEmptyMetaModel();

      // When
      const result: DiagramMappingResult = mapTemporaryDiagram(diagram, metaModel);

      // Then - verify all top-level fields exist with correct types
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('attributes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('overallStatus');
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.attributes)).toBe(true);
      expect(Array.isArray(result.edges)).toBe(true);
      expect(result.summary).toHaveProperty('nodes');
      expect(result.summary).toHaveProperty('attributes');
      expect(result.summary).toHaveProperty('edges');
      expect(result.summary.nodes).toHaveProperty('total');
      expect(result.summary.nodes).toHaveProperty('matched');
      expect(result.summary.nodes).toHaveProperty('unmatched');
      expect(result.summary.attributes).toHaveProperty('total');
      expect(result.summary.attributes).toHaveProperty('matched');
      expect(result.summary.attributes).toHaveProperty('unmatched');
      expect(result.summary.edges).toHaveProperty('total');
      expect(result.summary.edges).toHaveProperty('matched');
      expect(result.summary.edges).toHaveProperty('unmatched');
    });

    it('returns overallStatus no_matches with all counts at zero for empty diagram + empty meta-model', () => {
      // Given
      const diagram = createEmptyDiagram();
      const metaModel = createEmptyMetaModel();

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('no_matches');
      expect(result.summary.nodes.total).toBe(0);
      expect(result.summary.nodes.matched).toBe(0);
      expect(result.summary.nodes.unmatched).toBe(0);
      expect(result.summary.attributes.total).toBe(0);
      expect(result.summary.attributes.matched).toBe(0);
      expect(result.summary.attributes.unmatched).toBe(0);
      expect(result.summary.edges.total).toBe(0);
      expect(result.summary.edges.matched).toBe(0);
      expect(result.summary.edges.unmatched).toBe(0);
      expect(result.nodes).toHaveLength(0);
      expect(result.attributes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('returns all elements flagged as mode_mismatch with overallStatus no_matches for non-ER diagram', () => {
      // Given - a SEQUENCE diagram (not ER)
      const diagram = createEmptyDiagram({
        diagram_kind: 'SEQUENCE',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-1',
            source_ref_name: 'Customer',
            target_ref_name: 'Customer',
            edge_points: [],
          },
        ],
      });
      const metaModel = createEmptyMetaModel();

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('no_matches');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].reasonCode).toBe('mode_mismatch');
      expect(result.nodes[0].matchedEntityId).toBeNull();
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('unmatched');
      expect(result.edges[0].reasonCode).toBe('mode_mismatch');
      expect(result.edges[0].matchedRelationshipId).toBeNull();
    });

    it('returns all elements flagged as mode_mismatch with overallStatus no_matches for non-DATA source domain', () => {
      // Given - a diagram with source_architecture_domain 'BUSINESS'
      const diagram = createEmptyDiagram({
        source_architecture_domain: 'BUSINESS',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
        edges: [],
      });
      const metaModel = createEmptyMetaModel();

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('no_matches');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].reasonCode).toBe('mode_mismatch');
      // Attributes under nodes should also be flagged as mode_mismatch
      expect(result.attributes).toHaveLength(1);
      expect(result.attributes[0].status).toBe('unmatched');
      expect(result.attributes[0].reasonCode).toBe('mode_mismatch');
      expect(result.attributes[0].parentTemporaryNodeId).toBe('node-1');
    });
  });
});

// ============================================================================
// TASK GROUP 2: Pre-Indexing Functions for O(1) Lookups
// ============================================================================

describe('Task Group 2: Pre-Indexing Functions for O(1) Lookups', () => {

  describe('getEntityCollectionKey', () => {

    it('returns logical_data_entities for LOGICAL mode', () => {
      expect(getEntityCollectionKey('LOGICAL')).toBe('logical_data_entities');
    });

    it('returns physical_data_entities for PHYSICAL mode', () => {
      expect(getEntityCollectionKey('PHYSICAL')).toBe('physical_data_entities');
    });

    it('returns null for unrecognized view modes', () => {
      expect(getEntityCollectionKey('UNKNOWN')).toBeNull();
      expect(getEntityCollectionKey('')).toBeNull();
    });
  });

  describe('buildEntityNameIndex', () => {

    it('returns Map keyed by entity name for LOGICAL mode from logical_data_entities', () => {
      // Given
      const entities = createEmptyMetaModel().entities;
      entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
        { id: 'ent-3', name: 'Product', description: '', tags: '' },
      ] as LogicalDataEntity[];

      // When
      const index = buildEntityNameIndex(entities, 'LOGICAL');

      // Then
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBe(3);
      expect(index.get('Customer')).toBe('ent-1');
      expect(index.get('Order')).toBe('ent-2');
      expect(index.get('Product')).toBe('ent-3');
    });

    it('returns Map from physical_data_entities for PHYSICAL mode', () => {
      // Given
      const entities = createEmptyMetaModel().entities;
      entities.physical_data_entities = [
        { id: 'pent-1', name: 'customers', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
        { id: 'pent-2', name: 'orders', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ] as PhysicalDataEntity[];

      // When
      const index = buildEntityNameIndex(entities, 'PHYSICAL');

      // Then
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBe(2);
      expect(index.get('customers')).toBe('pent-1');
      expect(index.get('orders')).toBe('pent-2');
    });
  });

  describe('buildAttributeIndex', () => {

    it('returns Map<entityId, Map<attrName, attrId>> grouped by parent entity for LOGICAL mode', () => {
      // Given
      const entities = createEmptyMetaModel().entities;
      entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'attr-2', name: 'name', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'attr-3', name: 'total', description: '', logical_entity_id: 'ent-2', data_type: 'number', is_primary_key: false, is_nullable: false, tags: '' },
      ] as LogicalDataAttribute[];

      // When
      const index = buildAttributeIndex(entities, 'LOGICAL');

      // Then
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBe(2); // Two parent entities

      const ent1Attrs = index.get('ent-1');
      expect(ent1Attrs).toBeDefined();
      expect(ent1Attrs!.size).toBe(2);
      expect(ent1Attrs!.get('email')).toBe('attr-1');
      expect(ent1Attrs!.get('name')).toBe('attr-2');

      const ent2Attrs = index.get('ent-2');
      expect(ent2Attrs).toBeDefined();
      expect(ent2Attrs!.size).toBe(1);
      expect(ent2Attrs!.get('total')).toBe('attr-3');
    });
  });

  describe('buildRelationshipIndex', () => {

    it('builds Map<canonicalKey, LogicalDataEntityRelationship[]> with bidirectional lookup', () => {
      // Given
      const relationships = createEmptyMetaModel().relationships;
      relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer has Orders',
          tags: '',
        },
        {
          id: 'rel-2',
          fromDataEntityPointId: 'dep_log_ent-2',
          toDataEntityPointId: 'dep_log_ent-3',
          description: 'Order has Products',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      // When
      const index = buildRelationshipIndex(relationships);

      // Then
      expect(index).toBeInstanceOf(Map);
      expect(index.size).toBe(2);

      // Canonical key for ent-1 <-> ent-2: sorted pair joined with |
      // 'dep_log_ent-1' < 'dep_log_ent-2' alphabetically
      const key1 = 'dep_log_ent-1|dep_log_ent-2';
      expect(index.has(key1)).toBe(true);
      expect(index.get(key1)).toHaveLength(1);
      expect(index.get(key1)![0].id).toBe('rel-1');

      // Canonical key for ent-2 <-> ent-3: sorted pair
      const key2 = 'dep_log_ent-2|dep_log_ent-3';
      expect(index.has(key2)).toBe(true);
      expect(index.get(key2)).toHaveLength(1);
      expect(index.get(key2)![0].id).toBe('rel-2');

      // Verify bidirectional: searching B->A should find the same key as A->B
      const reverseSearchKey = ['dep_log_ent-2', 'dep_log_ent-1'].sort().join('|');
      expect(reverseSearchKey).toBe(key1);
      expect(index.has(reverseSearchKey)).toBe(true);
    });
  });

  describe('index builders - empty/undefined collections', () => {

    it('all index builders handle empty/undefined collections gracefully and return empty Maps', () => {
      // Given - entities with explicitly empty arrays
      const emptyEntities = createEmptyMetaModel().entities;
      const emptyRelationships = createEmptyMetaModel().relationships;

      // When
      const entityIndexLogical = buildEntityNameIndex(emptyEntities, 'LOGICAL');
      const entityIndexPhysical = buildEntityNameIndex(emptyEntities, 'PHYSICAL');
      const entityIndexUnknown = buildEntityNameIndex(emptyEntities, 'UNKNOWN');
      const attrIndexLogical = buildAttributeIndex(emptyEntities, 'LOGICAL');
      const attrIndexPhysical = buildAttributeIndex(emptyEntities, 'PHYSICAL');
      const attrIndexUnknown = buildAttributeIndex(emptyEntities, 'UNKNOWN');
      const relIndex = buildRelationshipIndex(emptyRelationships);

      // Then - all return empty Maps
      expect(entityIndexLogical.size).toBe(0);
      expect(entityIndexPhysical.size).toBe(0);
      expect(entityIndexUnknown.size).toBe(0);
      expect(attrIndexLogical.size).toBe(0);
      expect(attrIndexPhysical.size).toBe(0);
      expect(attrIndexUnknown.size).toBe(0);
      expect(relIndex.size).toBe(0);

      // Also test with undefined-like scenarios (cast to simulate missing collections)
      const sparseEntities = { ...emptyEntities } as MetaModelEntities;
      (sparseEntities as any).logical_data_entities = undefined;
      (sparseEntities as any).physical_data_entities = undefined;
      (sparseEntities as any).logical_data_attributes = undefined;
      (sparseEntities as any).physical_data_attributes = undefined;

      const sparseRelationships = { ...emptyRelationships } as MetaModelRelationships;
      (sparseRelationships as any).logical_data_entity_relationships = undefined;

      expect(buildEntityNameIndex(sparseEntities, 'LOGICAL').size).toBe(0);
      expect(buildEntityNameIndex(sparseEntities, 'PHYSICAL').size).toBe(0);
      expect(buildAttributeIndex(sparseEntities, 'LOGICAL').size).toBe(0);
      expect(buildAttributeIndex(sparseEntities, 'PHYSICAL').size).toBe(0);
      expect(buildRelationshipIndex(sparseRelationships).size).toBe(0);
    });
  });
});

// ============================================================================
// TASK GROUP 3: Entity Matching (Step 1 of 3)
// ============================================================================

describe('Task Group 3: Entity Matching (Step 1 of 3)', () => {

  describe('mapEntities - entity matching via mapTemporaryDiagram', () => {

    it('produces a matched record with entity ID when node ref_name exactly matches a logical entity name', () => {
      // Given - a diagram with a node whose ref_name matches an entity
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('matched');
      expect(result.nodes[0].matchedEntityId).toBe('ent-1');
      expect(result.nodes[0].temporaryNodeId).toBe('node-1');
      expect(result.nodes[0].reasonCode).toBeUndefined();
    });

    it('produces an unmatched record with no_entity_match when node ref_name is not found in meta-model', () => {
      // Given - a diagram with a node whose ref_name does not match any entity
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'NonExistentEntity',
            display_name: 'Non Existent',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].matchedEntityId).toBeNull();
      expect(result.nodes[0].reasonCode).toBe('no_entity_match');
    });

    it('enforces case-sensitive matching (Customer does not match customer)', () => {
      // Given - entity named "Customer" but node ref_name is "customer" (different case)
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'customer',
            display_name: 'customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - should NOT match due to case sensitivity
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].matchedEntityId).toBeNull();
      expect(result.nodes[0].reasonCode).toBe('no_entity_match');
    });

    it('produces mode_mismatch when node semantic_type LOGICAL_DATA_ENTITY is in a PHYSICAL view_mode diagram', () => {
      // Given - a PHYSICAL diagram containing a LOGICAL_DATA_ENTITY node
      const metaModel = createEmptyMetaModel();
      metaModel.entities.physical_data_entities = [
        { id: 'pent-1', name: 'Customer', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ] as PhysicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'PHYSICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].reasonCode).toBe('mode_mismatch');
      expect(result.nodes[0].matchedEntityId).toBeNull();
    });

    it('matches PHYSICAL_DATA_ENTITY node against physical_data_entities in a PHYSICAL view_mode diagram', () => {
      // Given - a PHYSICAL diagram with a PHYSICAL_DATA_ENTITY node
      const metaModel = createEmptyMetaModel();
      metaModel.entities.physical_data_entities = [
        { id: 'pent-1', name: 'customers', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ] as PhysicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'PHYSICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'PHYSICAL_DATA_ENTITY',
            ref_name: 'customers',
            display_name: 'customers',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('matched');
      expect(result.nodes[0].matchedEntityId).toBe('pent-1');
      expect(result.nodes[0].temporaryNodeId).toBe('node-1');
      expect(result.nodes[0].reasonCode).toBeUndefined();
    });
  });

  describe('validateNodeSemanticType', () => {

    it('returns true for LOGICAL_DATA_ENTITY in LOGICAL mode', () => {
      expect(validateNodeSemanticType('LOGICAL_DATA_ENTITY', 'LOGICAL')).toBe(true);
    });

    it('returns true for PHYSICAL_DATA_ENTITY in PHYSICAL mode', () => {
      expect(validateNodeSemanticType('PHYSICAL_DATA_ENTITY', 'PHYSICAL')).toBe(true);
    });

    it('returns false for LOGICAL_DATA_ENTITY in PHYSICAL mode', () => {
      expect(validateNodeSemanticType('LOGICAL_DATA_ENTITY', 'PHYSICAL')).toBe(false);
    });

    it('returns false for PHYSICAL_DATA_ENTITY in LOGICAL mode', () => {
      expect(validateNodeSemanticType('PHYSICAL_DATA_ENTITY', 'LOGICAL')).toBe(false);
    });

    it('returns false for unrecognized semantic_type', () => {
      expect(validateNodeSemanticType('UNKNOWN_TYPE', 'LOGICAL')).toBe(false);
    });
  });
});

// ============================================================================
// TASK GROUP 4: Attribute Matching (Step 2 of 3)
// ============================================================================

describe('Task Group 4: Attribute Matching (Step 2 of 3)', () => {

  describe('mapAttributes - attribute matching via mapTemporaryDiagram', () => {

    it('produces a matched record when compartment item ref_name matches an attribute under the matched parent entity', () => {
      // Given - a diagram with a matched entity node containing an attribute that matches
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
      ] as LogicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.attributes).toHaveLength(1);
      expect(result.attributes[0].status).toBe('matched');
      expect(result.attributes[0].matchedAttributeId).toBe('attr-1');
      expect(result.attributes[0].temporaryItemId).toBe('item-1');
      expect(result.attributes[0].parentTemporaryNodeId).toBe('node-1');
      expect(result.attributes[0].reasonCode).toBeUndefined();
    });

    it('produces no_attribute_match when attribute ref_name is not found under the matched parent entity', () => {
      // Given - a matched entity node with an attribute that does not match
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
      ] as LogicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'phone_number',
                    display_name: 'Phone Number',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.attributes).toHaveLength(1);
      expect(result.attributes[0].status).toBe('unmatched');
      expect(result.attributes[0].matchedAttributeId).toBeNull();
      expect(result.attributes[0].reasonCode).toBe('no_attribute_match');
      expect(result.attributes[0].parentTemporaryNodeId).toBe('node-1');
    });

    it('skips compartment items entirely for unmatched parent nodes (no records created)', () => {
      // Given - a diagram with an unmatched entity node containing attributes
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'NonExistentEntity',
            display_name: 'Non Existent',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                  {
                    id: 'item-2',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'name',
                    display_name: 'Name',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - the parent node is unmatched, so no attribute records should be created
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.attributes).toHaveLength(0);
    });

    it('matches attributes against physical_data_attributes filtered by physical_entity_id in PHYSICAL mode', () => {
      // Given - a PHYSICAL diagram with physical entities and attributes
      const metaModel = createEmptyMetaModel();
      metaModel.entities.physical_data_entities = [
        { id: 'pent-1', name: 'customers', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ] as PhysicalDataEntity[];
      metaModel.entities.physical_data_attributes = [
        { id: 'pattr-1', name: 'email_address', description: '', physical_entity_id: 'pent-1', data_type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'pattr-2', name: 'customer_id', description: '', physical_entity_id: 'pent-1', data_type: 'BIGINT', is_primary_key: true, is_nullable: false, tags: '' },
      ] as PhysicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'PHYSICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'PHYSICAL_DATA_ENTITY',
            ref_name: 'customers',
            display_name: 'customers',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email_address',
                    display_name: 'email_address',
                    semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
                  },
                  {
                    id: 'item-2',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'customer_id',
                    display_name: 'customer_id',
                    semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('matched');
      expect(result.nodes[0].matchedEntityId).toBe('pent-1');

      expect(result.attributes).toHaveLength(2);
      expect(result.attributes[0].status).toBe('matched');
      expect(result.attributes[0].matchedAttributeId).toBe('pattr-1');
      expect(result.attributes[1].status).toBe('matched');
      expect(result.attributes[1].matchedAttributeId).toBe('pattr-2');
    });
  });
});

// ============================================================================
// TASK GROUP 5: Relationship Matching (Step 3 of 3)
// ============================================================================

describe('Task Group 5: Relationship Matching (Step 3 of 3)', () => {

  describe('mapRelationships - relationship matching via mapTemporaryDiagram', () => {

    it('produces a matched record when edge connects two matched nodes with a matching relationship in the meta-model', () => {
      // Given - two matched entities with a relationship between them
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer has Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-1');
      expect(result.edges[0].temporaryEdgeId).toBe('edge-1');
      expect(result.edges[0].reasonCode).toBeUndefined();
    });

    it('produces invalid_node_reference when edge source_node_id references a node not in the diagram', () => {
      // Given - an edge referencing a non-existent node
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-nonexistent',
            target_node_id: 'node-1',
            source_ref_name: 'Missing',
            target_ref_name: 'Customer',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('unmatched');
      expect(result.edges[0].reasonCode).toBe('invalid_node_reference');
      expect(result.edges[0].matchedRelationshipId).toBeNull();
    });

    it('produces no_relationship_match when edge connects two nodes where one is unmatched', () => {
      // Given - one matched node and one unmatched node
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer has Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'UnknownEntity',
            display_name: 'Unknown',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'UnknownEntity',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('unmatched');
      expect(result.edges[0].reasonCode).toBe('no_relationship_match');
      expect(result.edges[0].matchedRelationshipId).toBeNull();
    });

    it('matches bidirectionally: edge A->B matches a relationship stored as B->A', () => {
      // Given - relationship stored as ent-2 -> ent-1 but edge goes node-1 (ent-1) -> node-2 (ent-2)
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-reverse',
          fromDataEntityPointId: 'dep_log_ent-2',
          toDataEntityPointId: 'dep_log_ent-1',
          description: 'Order belongs to Customer (stored in reverse)',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - should match despite reversed direction in meta-model
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-reverse');
    });

    it('ignores source_item_ref_name and target_item_ref_name for matching purposes (informational only)', () => {
      // Given - edge with source_item_ref_name and target_item_ref_name set,
      // but relationship still matches at entity level
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer has Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
            // These should be ignored for matching purposes
            source_item_ref_name: 'customer_id',
            target_item_ref_name: 'order_customer_fk',
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - matching should still succeed based on entity-level DEP IDs only
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-1');
    });
  });
});


// ============================================================================
// TASK GROUP 6: Summary Computation and Orchestrator Finalization
// ============================================================================

describe('Task Group 6: Summary Computation and Orchestrator Finalization', () => {

  describe('mapTemporaryDiagram orchestrator - end-to-end scenarios', () => {

    it('fully matched diagram: all nodes, attributes, edges matched -> overallStatus fully_matched with correct summary counts', () => {
      // Given - a diagram where every element matches the meta-model
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'attr-2', name: 'order_date', description: '', logical_entity_id: 'ent-2', data_type: 'date', is_primary_key: false, is_nullable: false, tags: '' },
      ] as LogicalDataAttribute[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer has Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-2',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-2',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'order_date',
                    display_name: 'Order Date',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - all elements matched
      expect(result.overallStatus).toBe('fully_matched');

      // Summary counts
      expect(result.summary.nodes.total).toBe(2);
      expect(result.summary.nodes.matched).toBe(2);
      expect(result.summary.nodes.unmatched).toBe(0);

      expect(result.summary.attributes.total).toBe(2);
      expect(result.summary.attributes.matched).toBe(2);
      expect(result.summary.attributes.unmatched).toBe(0);

      expect(result.summary.edges.total).toBe(1);
      expect(result.summary.edges.matched).toBe(1);
      expect(result.summary.edges.unmatched).toBe(0);

      // Individual records
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.every(n => n.status === 'matched')).toBe(true);
      expect(result.attributes).toHaveLength(2);
      expect(result.attributes.every(a => a.status === 'matched')).toBe(true);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
    });

    it('partially matched diagram: some nodes matched, some not -> overallStatus partially_matched', () => {
      // Given - one matching entity and one non-matching entity
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
      ] as LogicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'NonExistentEntity',
            display_name: 'Non Existent',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'NonExistentEntity',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('partially_matched');

      // Nodes: 1 matched, 1 unmatched
      expect(result.summary.nodes.total).toBe(2);
      expect(result.summary.nodes.matched).toBe(1);
      expect(result.summary.nodes.unmatched).toBe(1);

      // Attributes: 1 matched (from matched node), 0 from unmatched node (skipped)
      expect(result.summary.attributes.total).toBe(1);
      expect(result.summary.attributes.matched).toBe(1);
      expect(result.summary.attributes.unmatched).toBe(0);

      // Edges: 1 unmatched (target node unmatched -> no_relationship_match)
      expect(result.summary.edges.total).toBe(1);
      expect(result.summary.edges.matched).toBe(0);
      expect(result.summary.edges.unmatched).toBe(1);
      expect(result.edges[0].reasonCode).toBe('no_relationship_match');
    });

    it('completely unmatched diagram: no nodes match -> overallStatus no_matches, attributes skipped, edges unmatched', () => {
      // Given - no entities in meta-model match any diagram nodes
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-99', name: 'CompletelyDifferent', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('no_matches');

      // Nodes: 0 matched, 2 unmatched
      expect(result.summary.nodes.total).toBe(2);
      expect(result.summary.nodes.matched).toBe(0);
      expect(result.summary.nodes.unmatched).toBe(2);
      expect(result.nodes[0].reasonCode).toBe('no_entity_match');
      expect(result.nodes[1].reasonCode).toBe('no_entity_match');

      // Attributes: all skipped because parent nodes are unmatched
      expect(result.summary.attributes.total).toBe(0);
      expect(result.summary.attributes.matched).toBe(0);
      expect(result.summary.attributes.unmatched).toBe(0);
      expect(result.attributes).toHaveLength(0);

      // Edges: unmatched because source/target entities unresolved
      expect(result.summary.edges.total).toBe(1);
      expect(result.summary.edges.matched).toBe(0);
      expect(result.summary.edges.unmatched).toBe(1);
      expect(result.edges[0].reasonCode).toBe('no_relationship_match');
    });

    it('empty meta-model (empty entity/relationship collections): all elements unmatched, no errors thrown', () => {
      // Given - completely empty meta-model, but diagram has elements
      const metaModel = createEmptyMetaModel();

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  {
                    id: 'item-1',
                    item_kind: 'ATTRIBUTE',
                    ref_name: 'email',
                    display_name: 'Email',
                    semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
                  },
                ],
              },
            ],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-1',
            source_ref_name: 'Customer',
            target_ref_name: 'Customer',
            edge_points: [],
          },
        ],
      });

      // When - should not throw
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then
      expect(result.overallStatus).toBe('no_matches');

      // Node unmatched (no entities in meta-model)
      expect(result.summary.nodes.total).toBe(1);
      expect(result.summary.nodes.matched).toBe(0);
      expect(result.summary.nodes.unmatched).toBe(1);
      expect(result.nodes[0].reasonCode).toBe('no_entity_match');

      // Attributes skipped (parent node unmatched)
      expect(result.summary.attributes.total).toBe(0);
      expect(result.attributes).toHaveLength(0);

      // Edge unmatched (entity unresolved)
      expect(result.summary.edges.total).toBe(1);
      expect(result.summary.edges.matched).toBe(0);
      expect(result.summary.edges.unmatched).toBe(1);
      expect(result.edges[0].reasonCode).toBe('no_relationship_match');
    });
  });
});


// ============================================================================
// TASK GROUP 8: Test Review and Gap Analysis
// ============================================================================

describe('Task Group 8: Gap-Fill Tests', () => {

  describe('End-to-end: full LOGICAL diagram with entities, attributes, and relationships all matching', () => {

    it('verifies complete DiagramMappingResult structure for a fully matched LOGICAL diagram', () => {
      // Given - a complete LOGICAL diagram with 2 entities, 3 attributes, and 1 relationship
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'attr-2', name: 'name', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'attr-3', name: 'order_date', description: '', logical_entity_id: 'ent-2', data_type: 'date', is_primary_key: false, is_nullable: false, tags: '' },
      ] as LogicalDataAttribute[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-1',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer places Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 150,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-1', item_kind: 'ATTRIBUTE', ref_name: 'email', display_name: 'Email', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
                  { id: 'item-2', item_kind: 'ATTRIBUTE', ref_name: 'name', display_name: 'Name', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
                ],
              },
            ],
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 120,
            compartments: [
              {
                id: 'comp-2',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-3', item_kind: 'ATTRIBUTE', ref_name: 'order_date', display_name: 'Order Date', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
                ],
              },
            ],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - verify complete structure
      expect(result.overallStatus).toBe('fully_matched');

      // Nodes: 2 matched
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0]).toEqual({
        temporaryNodeId: 'node-1',
        matchedEntityId: 'ent-1',
        status: 'matched',
      });
      expect(result.nodes[1]).toEqual({
        temporaryNodeId: 'node-2',
        matchedEntityId: 'ent-2',
        status: 'matched',
      });

      // Attributes: 3 matched with correct parent references
      expect(result.attributes).toHaveLength(3);
      expect(result.attributes[0]).toEqual({
        temporaryItemId: 'item-1',
        parentTemporaryNodeId: 'node-1',
        matchedAttributeId: 'attr-1',
        status: 'matched',
      });
      expect(result.attributes[1]).toEqual({
        temporaryItemId: 'item-2',
        parentTemporaryNodeId: 'node-1',
        matchedAttributeId: 'attr-2',
        status: 'matched',
      });
      expect(result.attributes[2]).toEqual({
        temporaryItemId: 'item-3',
        parentTemporaryNodeId: 'node-2',
        matchedAttributeId: 'attr-3',
        status: 'matched',
      });

      // Edges: 1 matched
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        temporaryEdgeId: 'edge-1',
        matchedRelationshipId: 'rel-1',
        status: 'matched',
      });

      // Summary: all counts correct
      expect(result.summary).toEqual({
        nodes: { total: 2, matched: 2, unmatched: 0 },
        attributes: { total: 3, matched: 3, unmatched: 0 },
        edges: { total: 1, matched: 1, unmatched: 0 },
      });
    });
  });

  describe('End-to-end: full PHYSICAL diagram with relationships matching via dep_phy_ DEP IDs', () => {

    it('matches entities, attributes, and relationships in PHYSICAL mode using dep_phy_ prefixed DEP IDs', () => {
      // Given - a PHYSICAL diagram with physical entities, attributes, and a relationship using dep_phy_ DEP IDs
      const metaModel = createEmptyMetaModel();
      metaModel.entities.physical_data_entities = [
        { id: 'pent-1', name: 'customers', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
        { id: 'pent-2', name: 'orders', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ] as PhysicalDataEntity[];
      metaModel.entities.physical_data_attributes = [
        { id: 'pattr-1', name: 'customer_id', description: '', physical_entity_id: 'pent-1', data_type: 'BIGINT', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'pattr-2', name: 'order_id', description: '', physical_entity_id: 'pent-2', data_type: 'BIGINT', is_primary_key: true, is_nullable: false, tags: '' },
      ] as PhysicalDataAttribute[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-phy-1',
          fromDataEntityPointId: 'dep_phy_pent-1',
          toDataEntityPointId: 'dep_phy_pent-2',
          description: 'customers -> orders FK',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'PHYSICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'PHYSICAL_DATA_ENTITY',
            ref_name: 'customers',
            display_name: 'customers',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 120,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-1', item_kind: 'ATTRIBUTE', ref_name: 'customer_id', display_name: 'customer_id', semantic_type: 'PHYSICAL_DATA_ATTRIBUTE' },
                ],
              },
            ],
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'PHYSICAL_DATA_ENTITY',
            ref_name: 'orders',
            display_name: 'orders',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 120,
            compartments: [
              {
                id: 'comp-2',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-2', item_kind: 'ATTRIBUTE', ref_name: 'order_id', display_name: 'order_id', semantic_type: 'PHYSICAL_DATA_ATTRIBUTE' },
                ],
              },
            ],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'customers',
            target_ref_name: 'orders',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - fully matched in PHYSICAL mode
      expect(result.overallStatus).toBe('fully_matched');

      // Entities matched against physical_data_entities
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes[0].matchedEntityId).toBe('pent-1');
      expect(result.nodes[1].matchedEntityId).toBe('pent-2');

      // Attributes matched against physical_data_attributes
      expect(result.attributes).toHaveLength(2);
      expect(result.attributes[0].matchedAttributeId).toBe('pattr-1');
      expect(result.attributes[1].matchedAttributeId).toBe('pattr-2');

      // Relationship matched via dep_phy_ DEP IDs
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-phy-1');

      expect(result.summary).toEqual({
        nodes: { total: 2, matched: 2, unmatched: 0 },
        attributes: { total: 2, matched: 2, unmatched: 0 },
        edges: { total: 1, matched: 1, unmatched: 0 },
      });
    });
  });

  describe('Edge case: node with empty compartments array', () => {

    it('produces zero attribute records for a matched node with empty compartments', () => {
      // Given - a matched entity node with an empty compartments array
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
      ] as LogicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - node matched but no attribute records since compartments is empty
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('matched');
      expect(result.nodes[0].matchedEntityId).toBe('ent-1');
      expect(result.attributes).toHaveLength(0);
      expect(result.summary.attributes.total).toBe(0);
    });
  });

  describe('Edge case: compartments containing non-ATTRIBUTE item_kind items', () => {

    it('skips non-ATTRIBUTE items and only processes ATTRIBUTE items', () => {
      // Given - a node with compartments containing both ATTRIBUTE and non-ATTRIBUTE items
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.entities.logical_data_attributes = [
        { id: 'attr-1', name: 'email', description: '', logical_entity_id: 'ent-1', data_type: 'string', is_primary_key: false, is_nullable: true, tags: '' },
      ] as LogicalDataAttribute[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 150,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-1', item_kind: 'ATTRIBUTE', ref_name: 'email', display_name: 'Email', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
                  { id: 'item-2', item_kind: 'SEPARATOR', ref_name: '---', display_name: '---', semantic_type: 'VISUAL' },
                  { id: 'item-3', item_kind: 'METHOD', ref_name: 'validate', display_name: 'validate()', semantic_type: 'OPERATION' },
                ],
              },
            ],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - only the ATTRIBUTE item should produce a mapping record
      expect(result.attributes).toHaveLength(1);
      expect(result.attributes[0].temporaryItemId).toBe('item-1');
      expect(result.attributes[0].status).toBe('matched');
      expect(result.attributes[0].matchedAttributeId).toBe('attr-1');
      // item-2 and item-3 (non-ATTRIBUTE) should NOT appear in results
      expect(result.summary.attributes.total).toBe(1);
    });
  });

  describe('Edge case: multiple relationships between the same entity pair', () => {

    it('uses the first matching relationship when multiple exist between the same pair', () => {
      // Given - two relationships connecting the same entity pair
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-first',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer places Orders',
          tags: '',
        },
        {
          id: 'rel-second',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-2',
          description: 'Customer reviews Orders',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
          {
            id: 'node-2',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Order',
            display_name: 'Order',
            pos_x: 300,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - first matching relationship used
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-first');
    });
  });

  describe('Edge case: self-referencing edge (source_node_id === target_node_id)', () => {

    it('matches a self-referencing edge when a self-relationship exists in the meta-model', () => {
      // Given - an entity with a self-relationship (e.g., Employee manages Employee)
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Employee', description: '', tags: '' },
      ] as LogicalDataEntity[];
      metaModel.relationships.logical_data_entity_relationships = [
        {
          id: 'rel-self',
          fromDataEntityPointId: 'dep_log_ent-1',
          toDataEntityPointId: 'dep_log_ent-1',
          description: 'Employee manages Employee',
          tags: '',
        },
      ] as LogicalDataEntityRelationship[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Employee',
            display_name: 'Employee',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [
          {
            id: 'edge-self',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-1',
            source_ref_name: 'Employee',
            target_ref_name: 'Employee',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - self-referencing edge matched
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('matched');
      expect(result.edges[0].matchedRelationshipId).toBe('rel-self');
      expect(result.edges[0].temporaryEdgeId).toBe('edge-self');

      // Overall: node matched, edge matched
      expect(result.overallStatus).toBe('fully_matched');
    });
  });

  describe('Defensive: undefined entity collections on MetaModel passed to mapTemporaryDiagram', () => {

    it('handles undefined entity and relationship collections gracefully without throwing', () => {
      // Given - a MetaModel with undefined collections (simulating sparse/corrupted data)
      const metaModel = createEmptyMetaModel();
      (metaModel.entities as any).logical_data_entities = undefined;
      (metaModel.entities as any).logical_data_attributes = undefined;
      (metaModel.relationships as any).logical_data_entity_relationships = undefined;

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [
          {
            id: 'node-1',
            node_kind: 'ENTITY',
            semantic_type: 'LOGICAL_DATA_ENTITY',
            ref_name: 'Customer',
            display_name: 'Customer',
            pos_x: 0,
            pos_y: 0,
            width: 200,
            height: 100,
            compartments: [
              {
                id: 'comp-1',
                compartment_kind: 'ATTRIBUTES',
                items: [
                  { id: 'item-1', item_kind: 'ATTRIBUTE', ref_name: 'email', display_name: 'Email', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
                ],
              },
            ],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-1',
            target_node_id: 'node-1',
            source_ref_name: 'Customer',
            target_ref_name: 'Customer',
            edge_points: [],
          },
        ],
      });

      // When - should not throw
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - all elements unmatched but no exceptions
      expect(result.overallStatus).toBe('no_matches');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].status).toBe('unmatched');
      expect(result.nodes[0].reasonCode).toBe('no_entity_match');
      // Attributes skipped (parent node unmatched)
      expect(result.attributes).toHaveLength(0);
      // Edge unmatched (entity unresolved)
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].status).toBe('unmatched');
      expect(result.edges[0].reasonCode).toBe('no_relationship_match');
    });
  });

  describe('Defensive: diagram with zero nodes but some edges', () => {

    it('flags all edges with invalid_node_reference when diagram has no nodes', () => {
      // Given - a diagram with edges but no nodes
      const metaModel = createEmptyMetaModel();
      metaModel.entities.logical_data_entities = [
        { id: 'ent-1', name: 'Customer', description: '', tags: '' },
        { id: 'ent-2', name: 'Order', description: '', tags: '' },
      ] as LogicalDataEntity[];

      const diagram = createEmptyDiagram({
        view_mode: 'LOGICAL',
        nodes: [],
        edges: [
          {
            id: 'edge-1',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-nonexistent-1',
            target_node_id: 'node-nonexistent-2',
            source_ref_name: 'Customer',
            target_ref_name: 'Order',
            edge_points: [],
          },
          {
            id: 'edge-2',
            edge_kind: 'RELATIONSHIP',
            semantic_type: 'DATA_ENTITY_RELATIONSHIP',
            source_node_id: 'node-nonexistent-3',
            target_node_id: 'node-nonexistent-4',
            source_ref_name: 'Order',
            target_ref_name: 'Customer',
            edge_points: [],
          },
        ],
      });

      // When
      const result = mapTemporaryDiagram(diagram, metaModel);

      // Then - all edges get invalid_node_reference since no nodes exist
      expect(result.nodes).toHaveLength(0);
      expect(result.attributes).toHaveLength(0);
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].status).toBe('unmatched');
      expect(result.edges[0].reasonCode).toBe('invalid_node_reference');
      expect(result.edges[1].status).toBe('unmatched');
      expect(result.edges[1].reasonCode).toBe('invalid_node_reference');

      // Summary
      expect(result.summary.nodes.total).toBe(0);
      expect(result.summary.edges.total).toBe(2);
      expect(result.summary.edges.matched).toBe(0);
      expect(result.summary.edges.unmatched).toBe(2);

      // Overall status: no matches (0 matched, 2 unmatched edges)
      expect(result.overallStatus).toBe('no_matches');
    });
  });
});
