/**
 * Tests for Mapping Confirmation Utilities
 *
 * Spec: Mapping Confirmation Modal Framework (Increment 6)
 *
 * Task Group 1: Output Types and Candidate-Building Pure Functions
 * 6 focused tests covering:
 * - buildEntityCandidates for LOGICAL and PHYSICAL viewModes
 * - buildAttributeCandidates filtering by parent entity and edge cases
 * - buildRelationshipCandidates with valid canonical key, no match, and empty entityId
 *
 * Task Group 2: Editable Selections State and Cascade Logic
 * 7 focused tests covering:
 * - initializeSelectionsFromMappingResult for matched/unmatched entities, attributes, edges
 * - cascadeEntityChange: attribute reset, same-name revalidation, relationship re-evaluation
 * - computeValidationState and buildCompletedMapping
 *
 * Task Group 5: Gap-fill tests
 * 3 additional tests covering:
 * - PHYSICAL viewMode attribute candidates filtering
 * - Full cascade chain: entity change triggers attribute revalidation AND relationship re-evaluation
 * - buildEntityCandidates returns empty array for unrecognized viewMode
 */

import { describe, it, expect } from 'vitest';
import { MetaModel } from '../types/model';
import {
  TemporaryArchitectureDiagram,
} from '../types/temporaryArchitectureDiagram';
import {
  DiagramMappingResult,
} from './temporaryDiagramMapping';
import {
  buildEntityCandidates,
  buildAttributeCandidates,
  buildRelationshipCandidates,
  initializeSelectionsFromMappingResult,
  cascadeEntityChange,
  computeValidationState,
  buildCompletedMapping,
} from './mappingConfirmationUtils';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestMetaModel(): MetaModel {
  return {
    entities: {
      logical_data_entities: [
        { id: 'le1', name: 'Customer', description: '', tags: '' },
        { id: 'le2', name: 'Order', description: '', tags: '' },
        { id: 'le3', name: 'Product', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'la1', name: 'customer_name', description: '', logical_entity_id: 'le1', data_type: 'VARCHAR', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'la2', name: 'customer_email', description: '', logical_entity_id: 'le1', data_type: 'VARCHAR', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'la3', name: 'order_date', description: '', logical_entity_id: 'le2', data_type: 'DATE', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'la4', name: 'customer_name', description: '', logical_entity_id: 'le3', data_type: 'VARCHAR', is_primary_key: false, is_nullable: false, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pe1', name: 'customers_table', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
        { id: 'pe2', name: 'orders_table', description: '', physical_type: 'TABLE', database: 'main', tags: '' },
      ],
      physical_data_attributes: [
        { id: 'pa1', name: 'cust_name', description: '', physical_entity_id: 'pe1', data_type: 'VARCHAR(255)', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'pa2', name: 'ord_date', description: '', physical_entity_id: 'pe2', data_type: 'DATE', is_primary_key: false, is_nullable: false, tags: '' },
      ],
      // Provide empty arrays for required MetaModelEntities fields
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
    },
    relationships: {
      logical_data_entity_relationships: [
        {
          id: 'rel1',
          cardinality: 'ONE_TO_MANY',
          relationship: 'ASSOCIATION',
          description: 'Customer has orders',
          tags: '',
          fromDataEntityPointId: 'dep_log_le1',
          toDataEntityPointId: 'dep_log_le2',
        },
        {
          id: 'rel2',
          cardinality: 'MANY_TO_MANY',
          relationship: 'ASSOCIATION',
          description: 'Order has products',
          tags: '',
          fromDataEntityPointId: 'dep_log_le2',
          toDataEntityPointId: 'dep_log_le3',
        },
      ],
      // Provide empty arrays for required MetaModelRelationships fields
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
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
    },
  };
}

/**
 * Creates a temporary diagram with nodes, compartments, and edges
 * suitable for testing cascade logic.
 */
function createTestTemporaryDiagram(): TemporaryArchitectureDiagram {
  return {
    id: 'td1',
    name: 'Test Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [
      {
        id: 'n1',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 0, pos_y: 0, width: 200, height: 100,
        compartments: [
          {
            id: 'c1',
            compartment_kind: 'ATTRIBUTES',
            items: [
              { id: 'item1', item_kind: 'ATTRIBUTE', ref_name: 'customer_name', display_name: 'Customer Name', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
              { id: 'item2', item_kind: 'ATTRIBUTE', ref_name: 'customer_email', display_name: 'Customer Email', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
            ],
          },
        ],
      },
      {
        id: 'n2',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Order',
        display_name: 'Order',
        pos_x: 300, pos_y: 0, width: 200, height: 100,
        compartments: [
          {
            id: 'c2',
            compartment_kind: 'ATTRIBUTES',
            items: [
              { id: 'item3', item_kind: 'ATTRIBUTE', ref_name: 'order_date', display_name: 'Order Date', semantic_type: 'LOGICAL_DATA_ATTRIBUTE' },
            ],
          },
        ],
      },
    ],
    edges: [
      {
        id: 'e1',
        edge_kind: 'RELATIONSHIP',
        semantic_type: 'DATA_ENTITY_RELATIONSHIP',
        source_node_id: 'n1',
        target_node_id: 'n2',
        source_ref_name: 'Customer',
        target_ref_name: 'Order',
        edge_points: [{ sequence_order: 1, pos_x: 200, pos_y: 50 }, { sequence_order: 2, pos_x: 300, pos_y: 50 }],
      },
    ],
  };
}

/**
 * Creates a DiagramMappingResult that matches the test temporary diagram.
 * Simulates a partially_matched result where some items are matched and some are not.
 */
function createTestMappingResult(): DiagramMappingResult {
  return {
    nodes: [
      { temporaryNodeId: 'n1', matchedEntityId: 'le1', status: 'matched' },
      { temporaryNodeId: 'n2', matchedEntityId: null, status: 'unmatched', reasonCode: 'no_entity_match' },
    ],
    attributes: [
      { temporaryItemId: 'item1', parentTemporaryNodeId: 'n1', matchedAttributeId: 'la1', status: 'matched' },
      { temporaryItemId: 'item2', parentTemporaryNodeId: 'n1', matchedAttributeId: null, status: 'unmatched', reasonCode: 'no_attribute_match' },
      { temporaryItemId: 'item3', parentTemporaryNodeId: 'n2', matchedAttributeId: null, status: 'unmatched', reasonCode: 'no_attribute_match' },
    ],
    edges: [
      { temporaryEdgeId: 'e1', matchedRelationshipId: 'rel1', status: 'matched' },
    ],
    summary: {
      nodes: { total: 2, matched: 1, unmatched: 1 },
      attributes: { total: 3, matched: 1, unmatched: 2 },
      edges: { total: 1, matched: 1, unmatched: 0 },
    },
    overallStatus: 'partially_matched',
  };
}

/**
 * Creates a fully matched mapping result for testing buildCompletedMapping.
 */
function createFullyResolvedMappingResult(): DiagramMappingResult {
  return {
    nodes: [
      { temporaryNodeId: 'n1', matchedEntityId: 'le1', status: 'matched' },
      { temporaryNodeId: 'n2', matchedEntityId: 'le2', status: 'matched' },
    ],
    attributes: [
      { temporaryItemId: 'item1', parentTemporaryNodeId: 'n1', matchedAttributeId: 'la1', status: 'matched' },
      { temporaryItemId: 'item2', parentTemporaryNodeId: 'n1', matchedAttributeId: 'la2', status: 'matched' },
      { temporaryItemId: 'item3', parentTemporaryNodeId: 'n2', matchedAttributeId: 'la3', status: 'matched' },
    ],
    edges: [
      { temporaryEdgeId: 'e1', matchedRelationshipId: 'rel1', status: 'matched' },
    ],
    summary: {
      nodes: { total: 2, matched: 2, unmatched: 0 },
      attributes: { total: 3, matched: 3, unmatched: 0 },
      edges: { total: 1, matched: 1, unmatched: 0 },
    },
    overallStatus: 'fully_matched',
  };
}

// ============================================================================
// Task Group 1 Tests
// ============================================================================

describe('mappingConfirmationUtils', () => {
  describe('buildEntityCandidates', () => {
    it('returns logical entities for LOGICAL viewMode and physical entities for PHYSICAL viewMode', () => {
      const metaModel = createTestMetaModel();

      const logicalCandidates = buildEntityCandidates(metaModel, 'LOGICAL');
      expect(logicalCandidates).toHaveLength(3);
      expect(logicalCandidates[0]).toEqual({ id: 'le1', name: 'Customer' });
      expect(logicalCandidates[1]).toEqual({ id: 'le2', name: 'Order' });
      expect(logicalCandidates[2]).toEqual({ id: 'le3', name: 'Product' });

      const physicalCandidates = buildEntityCandidates(metaModel, 'PHYSICAL');
      expect(physicalCandidates).toHaveLength(2);
      expect(physicalCandidates).toEqual([
        { id: 'pe1', name: 'customers_table' },
        { id: 'pe2', name: 'orders_table' },
      ]);
    });
  });

  describe('buildAttributeCandidates', () => {
    it('returns only attributes belonging to the specified parentEntityId', () => {
      const metaModel = createTestMetaModel();

      // Logical: attributes for le1 (Customer)
      const le1Attrs = buildAttributeCandidates(metaModel, 'LOGICAL', 'le1');
      expect(le1Attrs).toHaveLength(2);
      expect(le1Attrs).toEqual([
        { id: 'la1', name: 'customer_name' },
        { id: 'la2', name: 'customer_email' },
      ]);

      // Logical: attributes for le2 (Order)
      const le2Attrs = buildAttributeCandidates(metaModel, 'LOGICAL', 'le2');
      expect(le2Attrs).toHaveLength(1);
      expect(le2Attrs).toEqual([
        { id: 'la3', name: 'order_date' },
      ]);

      // Physical: attributes for pe1 (customers_table)
      const pe1Attrs = buildAttributeCandidates(metaModel, 'PHYSICAL', 'pe1');
      expect(pe1Attrs).toHaveLength(1);
      expect(pe1Attrs).toEqual([
        { id: 'pa1', name: 'cust_name' },
      ]);
    });

    it('returns empty array when parentEntityId is empty string or does not match any entity', () => {
      const metaModel = createTestMetaModel();

      // Empty string parentEntityId
      const emptyResult = buildAttributeCandidates(metaModel, 'LOGICAL', '');
      expect(emptyResult).toEqual([]);

      // Non-existent entity ID
      const noMatchResult = buildAttributeCandidates(metaModel, 'LOGICAL', 'nonexistent_id');
      expect(noMatchResult).toEqual([]);
    });
  });

  describe('buildRelationshipCandidates', () => {
    it('returns matching relationships when source/target entity IDs produce a valid canonical DEP ID key', () => {
      const metaModel = createTestMetaModel();

      // le1 -> le2 should match rel1 (Customer -> Order)
      const candidates = buildRelationshipCandidates(metaModel, 'le1', 'le2', 'LOGICAL');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('rel1');
      expect(candidates[0].label).toBe('One To Many - Association');

      // Reverse direction (le2 -> le1) should also match due to canonical key sorting
      const reverseCandidates = buildRelationshipCandidates(metaModel, 'le2', 'le1', 'LOGICAL');
      expect(reverseCandidates).toHaveLength(1);
      expect(reverseCandidates[0].id).toBe('rel1');
    });

    it('returns empty array when no relationship connects the given entity pair', () => {
      const metaModel = createTestMetaModel();

      // pe1 and pe2 are physical entities -- there are no physical relationships in the test data
      const candidates = buildRelationshipCandidates(metaModel, 'pe1', 'pe2', 'PHYSICAL');
      expect(candidates).toEqual([]);
    });

    it('returns empty array when either entityId is empty string', () => {
      const metaModel = createTestMetaModel();

      const emptySource = buildRelationshipCandidates(metaModel, '', 'le2', 'LOGICAL');
      expect(emptySource).toEqual([]);

      const emptyTarget = buildRelationshipCandidates(metaModel, 'le1', '', 'LOGICAL');
      expect(emptyTarget).toEqual([]);

      const bothEmpty = buildRelationshipCandidates(metaModel, '', '', 'LOGICAL');
      expect(bothEmpty).toEqual([]);
    });
  });

  // ============================================================================
  // Task Group 2 Tests
  // ============================================================================

  describe('initializeSelectionsFromMappingResult', () => {
    it('correctly pre-populates matched entities and leaves unmatched as empty string', () => {
      const mappingResult = createTestMappingResult();
      const selections = initializeSelectionsFromMappingResult(mappingResult);

      // n1 was matched to le1
      expect(selections.entitySelections['n1']).toBe('le1');
      // n2 was unmatched
      expect(selections.entitySelections['n2']).toBe('');
    });

    it('correctly pre-populates matched attributes and edges', () => {
      const mappingResult = createTestMappingResult();
      const selections = initializeSelectionsFromMappingResult(mappingResult);

      // item1 was matched to la1
      expect(selections.attributeSelections['item1']).toBe('la1');
      // item2 was unmatched
      expect(selections.attributeSelections['item2']).toBe('');
      // item3 was unmatched
      expect(selections.attributeSelections['item3']).toBe('');

      // e1 was matched to rel1
      expect(selections.edgeSelections['e1']).toBe('rel1');
    });
  });

  describe('cascadeEntityChange', () => {
    it('resets all child attribute selections for the changed node to empty string', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      // Start with some attribute selections for n1's children
      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1',
        'item2': 'la2',
        'item3': '',
      };
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };

      // Change n1's entity from le1 to a different entity (le3 - Product)
      // which has no attribute named 'customer_email' but does have 'customer_name'
      const entitySelections: Record<string, string> = { 'n1': 'le3', 'n2': '' };

      const result = cascadeEntityChange(
        'n1', 'le3',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // item1 (ref_name: 'customer_name') should be revalidated and match la4 under le3
      expect(result.attributeSelections['item1']).toBe('la4');
      // item2 (ref_name: 'customer_email') has no match in le3, so should be empty
      expect(result.attributeSelections['item2']).toBe('');
      // item3 belongs to n2, should be unaffected
      expect(result.attributeSelections['item3']).toBe('');
    });

    it('auto-revalidates attributes whose ref_name exactly matches an attribute name in the new entity', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1', 'item2': 'la2', 'item3': '',
      };
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };
      const entitySelections: Record<string, string> = { 'n1': 'le3', 'n2': '' };

      const result = cascadeEntityChange(
        'n1', 'le3',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // le3 (Product) has attribute 'customer_name' (la4)
      // item1 ref_name is 'customer_name' -> should auto-revalidate to la4
      expect(result.attributeSelections['item1']).toBe('la4');

      // item2 ref_name is 'customer_email' -> no match in le3 -> stays empty
      expect(result.attributeSelections['item2']).toBe('');
    });

    it('triggers relationship re-evaluation for edges connected to the changed node', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1', 'item2': '', 'item3': '',
      };
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };

      // Change n1 from le1 to le3 (Product). The edge e1 connects n1 -> n2.
      // n2 is mapped to le2 (Order). le3 <-> le2 has rel2.
      // The current selection rel1 (le1 <-> le2) is no longer valid.
      const entitySelections: Record<string, string> = { 'n1': 'le3', 'n2': 'le2' };

      const result = cascadeEntityChange(
        'n1', 'le3',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // rel1 connects le1 <-> le2. After changing n1 to le3, the candidates for
      // e1 (n1=le3, n2=le2) are now [rel2]. rel1 is no longer valid -> reset to ''
      expect(result.edgeSelections['e1']).toBe('');
    });

    it('preserves edge selection when it is still valid in the new candidate list', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1', 'item2': '', 'item3': '',
      };
      // Edge is currently set to rel1
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };

      // n1 stays le1, n2 stays le2 -> rel1 is still valid
      // Simulate re-selecting the same entity (le1) for n1
      const entitySelections: Record<string, string> = { 'n1': 'le1', 'n2': 'le2' };

      const result = cascadeEntityChange(
        'n1', 'le1',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // rel1 is still a valid candidate for le1 <-> le2, so it should be preserved
      expect(result.edgeSelections['e1']).toBe('rel1');
    });

    it('resets edge selection when one endpoint entity is unselected (empty)', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1', 'item2': '', 'item3': '',
      };
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };

      // Change n1 to empty (deselect entity)
      const entitySelections: Record<string, string> = { 'n1': '', 'n2': 'le2' };

      const result = cascadeEntityChange(
        'n1', '',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // n1 has no entity -> edge must be reset
      expect(result.edgeSelections['e1']).toBe('');
    });
  });

  describe('computeValidationState', () => {
    it('returns isAllResolved true when all selections are non-empty', () => {
      const result = computeValidationState(
        { 'n1': 'le1', 'n2': 'le2' },
        { 'item1': 'la1', 'item2': 'la2', 'item3': 'la3' },
        { 'e1': 'rel1' }
      );

      expect(result.isAllResolved).toBe(true);
      expect(result.resolvedCount).toBe(6);
      expect(result.totalCount).toBe(6);
    });

    it('returns isAllResolved false when some selections are empty', () => {
      const result = computeValidationState(
        { 'n1': 'le1', 'n2': '' },
        { 'item1': 'la1', 'item2': '', 'item3': '' },
        { 'e1': 'rel1' }
      );

      expect(result.isAllResolved).toBe(false);
      expect(result.resolvedCount).toBe(3);
      expect(result.totalCount).toBe(6);
    });

    it('returns isAllResolved false for empty selections (zero total)', () => {
      const result = computeValidationState({}, {}, {});

      expect(result.isAllResolved).toBe(false);
      expect(result.resolvedCount).toBe(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('buildCompletedMapping', () => {
    it('produces a well-formed CompletedDiagramMapping with all non-null resolved IDs', () => {
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createFullyResolvedMappingResult();

      const entitySelections: Record<string, string> = { 'n1': 'le1', 'n2': 'le2' };
      const attributeSelections: Record<string, string> = { 'item1': 'la1', 'item2': 'la2', 'item3': 'la3' };
      const edgeSelections: Record<string, string> = { 'e1': 'rel1' };

      const completed = buildCompletedMapping(
        entitySelections, attributeSelections, edgeSelections,
        diagram, 'LOGICAL', mappingResult
      );

      // Verify structure
      expect(completed.viewMode).toBe('LOGICAL');
      expect(completed.sourceTemporaryDiagram).toBe(diagram);

      // Verify completed nodes
      expect(completed.completedNodes).toHaveLength(2);
      expect(completed.completedNodes).toContainEqual({
        temporaryNodeId: 'n1', resolvedEntityId: 'le1',
      });
      expect(completed.completedNodes).toContainEqual({
        temporaryNodeId: 'n2', resolvedEntityId: 'le2',
      });

      // Verify completed attributes
      expect(completed.completedAttributes).toHaveLength(3);
      expect(completed.completedAttributes).toContainEqual({
        temporaryItemId: 'item1', parentTemporaryNodeId: 'n1', resolvedAttributeId: 'la1',
      });
      expect(completed.completedAttributes).toContainEqual({
        temporaryItemId: 'item2', parentTemporaryNodeId: 'n1', resolvedAttributeId: 'la2',
      });
      expect(completed.completedAttributes).toContainEqual({
        temporaryItemId: 'item3', parentTemporaryNodeId: 'n2', resolvedAttributeId: 'la3',
      });

      // Verify completed edges
      expect(completed.completedEdges).toHaveLength(1);
      expect(completed.completedEdges[0]).toEqual({
        temporaryEdgeId: 'e1', resolvedRelationshipId: 'rel1',
      });

      // Verify all resolved IDs are non-empty strings
      for (const node of completed.completedNodes) {
        expect(node.resolvedEntityId).not.toBe('');
      }
      for (const attr of completed.completedAttributes) {
        expect(attr.resolvedAttributeId).not.toBe('');
      }
      for (const edge of completed.completedEdges) {
        expect(edge.resolvedRelationshipId).not.toBe('');
      }
    });
  });

  // ============================================================================
  // Task Group 5: Gap-Fill Tests
  // ============================================================================

  describe('Gap-fill: PHYSICAL viewMode attribute candidates', () => {
    /**
     * Gap: TG1 tested PHYSICAL attributes briefly in a combined test, but did not
     * verify filtering for multiple physical entities or confirm that PHYSICAL
     * attributes from one entity do not leak into another entity's candidate list.
     */
    it('filters physical data attributes by physical_entity_id correctly across multiple entities', () => {
      const metaModel = createTestMetaModel();

      // pe1 (customers_table) should only have pa1 (cust_name)
      const pe1Attrs = buildAttributeCandidates(metaModel, 'PHYSICAL', 'pe1');
      expect(pe1Attrs).toHaveLength(1);
      expect(pe1Attrs[0]).toEqual({ id: 'pa1', name: 'cust_name' });

      // pe2 (orders_table) should only have pa2 (ord_date)
      const pe2Attrs = buildAttributeCandidates(metaModel, 'PHYSICAL', 'pe2');
      expect(pe2Attrs).toHaveLength(1);
      expect(pe2Attrs[0]).toEqual({ id: 'pa2', name: 'ord_date' });

      // Verify no cross-contamination: pe1 should NOT contain ord_date
      expect(pe1Attrs.find(a => a.name === 'ord_date')).toBeUndefined();
      // pe2 should NOT contain cust_name
      expect(pe2Attrs.find(a => a.name === 'cust_name')).toBeUndefined();
    });
  });

  describe('Gap-fill: full cascade chain', () => {
    /**
     * Gap: Existing cascade tests verify attribute revalidation and relationship
     * re-evaluation separately. This test verifies the full chain in a single call:
     * entity change -> attribute same-name revalidation finds a match -> AND
     * relationship re-evaluation invalidates the previous selection.
     */
    it('performs attribute revalidation AND relationship re-evaluation in a single cascade call', () => {
      const metaModel = createTestMetaModel();
      const diagram = createTestTemporaryDiagram();
      const mappingResult = createTestMappingResult();

      // Setup: n1=le1 (Customer), n2=le2 (Order), edge e1=rel1 (le1<->le2)
      // item1 (customer_name) matched to la1, item2 (customer_email) matched to la2
      const currentAttrSelections: Record<string, string> = {
        'item1': 'la1', 'item2': 'la2', 'item3': '',
      };
      const currentEdgeSelections: Record<string, string> = { 'e1': 'rel1' };

      // Action: Change n1 from le1 (Customer) to le3 (Product)
      // Expected attribute cascade: le3 has 'customer_name' (la4) but not 'customer_email'
      // Expected relationship cascade: rel1 connects le1<->le2, but now n1=le3,
      //   so candidates become le3<->le2 = [rel2]. rel1 is no longer valid.
      const entitySelections: Record<string, string> = { 'n1': 'le3', 'n2': 'le2' };

      const result = cascadeEntityChange(
        'n1', 'le3',
        currentAttrSelections, currentEdgeSelections,
        diagram, metaModel, 'LOGICAL', mappingResult,
        entitySelections
      );

      // Verify BOTH cascades happened in the same call:
      // Attribute revalidation: item1 auto-matched to la4 (same name 'customer_name')
      expect(result.attributeSelections['item1']).toBe('la4');
      // Attribute reset: item2 has no match in le3
      expect(result.attributeSelections['item2']).toBe('');
      // Unaffected: item3 belongs to n2
      expect(result.attributeSelections['item3']).toBe('');

      // Relationship re-evaluation: rel1 is no longer valid for le3<->le2
      expect(result.edgeSelections['e1']).toBe('');
    });
  });

  describe('Gap-fill: buildEntityCandidates defensive behavior', () => {
    /**
     * Gap: No test verified that an unrecognized viewMode returns an empty array
     * rather than throwing or returning undefined.
     */
    it('returns empty array for unrecognized viewMode', () => {
      const metaModel = createTestMetaModel();

      const unknownMode = buildEntityCandidates(metaModel, 'UNKNOWN');
      expect(unknownMode).toEqual([]);

      const emptyMode = buildEntityCandidates(metaModel, '');
      expect(emptyMode).toEqual([]);
    });
  });
});
