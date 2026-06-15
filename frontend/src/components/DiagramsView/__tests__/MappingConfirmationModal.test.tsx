/**
 * MappingConfirmationModal Component Tests
 *
 * Spec: Mapping Confirmation Modal Framework (Increment 6)
 * Task Group 3, Task 3.1: 6 focused tests for the modal component
 *
 * Tests verify:
 * 1. Modal renders when isOpen is true and does not render when false
 * 2. Entity section: each NodeMappingRecord renders a row with ref_name label,
 *    status badge ("Auto" or "Unresolved"), and a <select> pre-populated with entity candidates
 * 3. Attribute section: attribute dropdowns are disabled when parent entity selection is empty;
 *    enabled when parent has a selection
 * 4. Entity cascade in component: changing an entity select triggers attribute dropdown rebuild
 * 5. Confirm button is disabled when any selection is empty; enabled when all selections are non-empty
 * 6. onConfirm callback receives a CompletedDiagramMapping when Confirm is clicked with all resolved
 *
 * Task Group 5: Gap-fill tests
 * 5 additional tests covering:
 * 7. Overlay click-to-close calls onClose
 * 8. Escape key closes the modal
 * 9. mode_mismatch node rows render as non-editable warnings (not a dropdown)
 * 10. Relationship section renders with edge rows showing source/target labels
 * 11. Attribute dropdown re-enables when parent entity is selected from unresolved state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MappingConfirmationModal } from '../MappingConfirmationModal';
import type { MetaModel } from '../../../types/model';
import type { TemporaryArchitectureDiagram } from '../../../types/temporaryArchitectureDiagram';
import type { DiagramMappingResult } from '../../../utils/temporaryDiagramMapping';
import type { CompletedDiagramMapping } from '../../../utils/mappingConfirmationUtils';

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
      ],
      physical_data_attributes: [],
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
      ],
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
 * Creates a partially-matched mapping result:
 * - n1 matched to le1, n2 unmatched
 * - item1 matched to la1, item2 unmatched, item3 unmatched
 * - e1 matched to rel1
 */
function createPartiallyMatchedResult(): DiagramMappingResult {
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
 * Creates a fully-matched mapping result where all items are already resolved.
 */
function createFullyMatchedMappingResult(): DiagramMappingResult {
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
// Task Group 3 Tests
// ============================================================================

describe('MappingConfirmationModal', () => {
  let metaModel: MetaModel;
  let diagram: TemporaryArchitectureDiagram;
  let mappingResult: DiagramMappingResult;
  let onClose: ReturnType<typeof vi.fn>;
  let onConfirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    metaModel = createTestMetaModel();
    diagram = createTestTemporaryDiagram();
    mappingResult = createPartiallyMatchedResult();
    onClose = vi.fn();
    onConfirm = vi.fn();
  });

  it('renders when isOpen is true and does not render when false', () => {
    // Render with isOpen=false
    const { rerender } = render(
      <MappingConfirmationModal
        isOpen={false}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    expect(screen.queryByTestId('mapping-confirmation-modal')).toBeNull();

    // Re-render with isOpen=true
    rerender(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    expect(screen.getByTestId('mapping-confirmation-modal')).toBeTruthy();
    expect(screen.getByText('Confirm Diagram Mappings')).toBeTruthy();
  });

  it('renders entity rows with ref_name, status badge, and select dropdown pre-populated with candidates', () => {
    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Verify entities section exists
    expect(screen.getByTestId('entities-section')).toBeTruthy();

    // Row for n1 (Customer, auto-matched)
    const n1Row = screen.getByTestId('entity-row-n1');
    expect(n1Row).toBeTruthy();
    expect(n1Row.textContent).toContain('Customer');

    // Badge should show "Auto" for matched n1
    const n1Badge = screen.getByTestId('entity-badge-n1');
    expect(n1Badge.textContent).toBe('Auto');

    // Select should be pre-selected to le1
    const n1Select = screen.getByTestId('entity-select-n1') as HTMLSelectElement;
    expect(n1Select.value).toBe('le1');

    // Dropdown should contain all 3 logical entities plus placeholder
    const n1Options = n1Select.querySelectorAll('option');
    // 1 placeholder + 3 entities = 4 options
    expect(n1Options.length).toBe(4);

    // Row for n2 (Order, unresolved)
    const n2Row = screen.getByTestId('entity-row-n2');
    expect(n2Row).toBeTruthy();
    expect(n2Row.textContent).toContain('Order');

    // Badge should show "Unresolved" for unmatched n2
    const n2Badge = screen.getByTestId('entity-badge-n2');
    expect(n2Badge.textContent).toBe('Unresolved');

    // Select should be empty (unresolved)
    const n2Select = screen.getByTestId('entity-select-n2') as HTMLSelectElement;
    expect(n2Select.value).toBe('');
  });

  it('disables attribute dropdown when parent entity selection is empty; enabled when parent has a selection', () => {
    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Attributes under n1 (Customer) which has entity selected (le1) should have select dropdowns
    const item1Row = screen.getByTestId('attribute-row-item1');
    expect(item1Row).toBeTruthy();
    // Should have a <select> element because parent entity is selected
    const item1Select = screen.getByTestId('attribute-select-item1') as HTMLSelectElement;
    expect(item1Select).toBeTruthy();

    // Attributes under n2 (Order) which has no entity selected should show disabled hint
    const item3Row = screen.getByTestId('attribute-row-item3');
    expect(item3Row).toBeTruthy();
    expect(item3Row.textContent).toContain('Select parent entity first');
    // There should be no select element for item3 since parent is unresolved
    expect(screen.queryByTestId('attribute-select-item3')).toBeNull();
  });

  it('rebuilds attribute dropdown options when entity selection changes (cascade)', () => {
    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Initially n1 is mapped to le1 (Customer) which has attributes: customer_name, customer_email
    const item1Select = screen.getByTestId('attribute-select-item1') as HTMLSelectElement;
    // Should have placeholder + 2 customer attributes = 3 options
    let item1Options = item1Select.querySelectorAll('option');
    expect(item1Options.length).toBe(3); // placeholder + customer_name + customer_email

    // Change n1 entity from le1 (Customer) to le3 (Product)
    // Product has 1 attribute: customer_name (la4)
    const n1Select = screen.getByTestId('entity-select-n1') as HTMLSelectElement;
    fireEvent.change(n1Select, { target: { value: 'le3' } });

    // After cascade, item1 dropdown should now show Product's attributes
    const updatedItem1Select = screen.getByTestId('attribute-select-item1') as HTMLSelectElement;
    const updatedOptions = updatedItem1Select.querySelectorAll('option');
    // placeholder + 1 product attribute (customer_name) = 2 options
    expect(updatedOptions.length).toBe(2);

    // The cascade should have auto-revalidated item1 (ref_name: 'customer_name')
    // to la4 (the customer_name attribute under Product/le3)
    expect(updatedItem1Select.value).toBe('la4');
  });

  it('Confirm is enabled with partial resolution (only disabled when zero items resolved)', () => {
    // Partial confirm: unresolved items are skipped rather than blocking the Confirm button.
    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Some items are already auto-matched -> Confirm should be enabled
    const confirmButton = screen.getByTestId('modal-confirm-button') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    // Summary should still show partial resolution counter
    const summaryBar = screen.getByTestId('summary-bar');
    expect(summaryBar.textContent).toContain('of');
  });

  it('calls onConfirm with CompletedDiagramMapping when Confirm is clicked with all selections resolved', () => {
    // Use a fully matched result so all selections are pre-populated
    const fullyMatchedResult = createFullyMatchedMappingResult();

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={fullyMatchedResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Confirm button should be enabled
    const confirmButton = screen.getByTestId('modal-confirm-button') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    // Click Confirm
    fireEvent.click(confirmButton);

    // onConfirm should have been called once
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Verify the CompletedDiagramMapping structure
    const completedMapping: CompletedDiagramMapping = onConfirm.mock.calls[0][0];
    expect(completedMapping.viewMode).toBe('LOGICAL');
    expect(completedMapping.sourceTemporaryDiagram).toBe(diagram);

    // Verify completed nodes
    expect(completedMapping.completedNodes).toHaveLength(2);
    expect(completedMapping.completedNodes).toContainEqual({
      temporaryNodeId: 'n1',
      resolvedEntityId: 'le1',
    });
    expect(completedMapping.completedNodes).toContainEqual({
      temporaryNodeId: 'n2',
      resolvedEntityId: 'le2',
    });

    // Verify completed attributes
    expect(completedMapping.completedAttributes).toHaveLength(3);
    expect(completedMapping.completedAttributes).toContainEqual({
      temporaryItemId: 'item1',
      parentTemporaryNodeId: 'n1',
      resolvedAttributeId: 'la1',
    });

    // Verify completed edges
    expect(completedMapping.completedEdges).toHaveLength(1);
    expect(completedMapping.completedEdges[0]).toEqual({
      temporaryEdgeId: 'e1',
      resolvedRelationshipId: 'rel1',
    });

    // Verify all resolved IDs are non-empty strings
    for (const node of completedMapping.completedNodes) {
      expect(node.resolvedEntityId).not.toBe('');
    }
    for (const attr of completedMapping.completedAttributes) {
      expect(attr.resolvedAttributeId).not.toBe('');
    }
    for (const edge of completedMapping.completedEdges) {
      expect(edge.resolvedRelationshipId).not.toBe('');
    }
  });
});

// ============================================================================
// Task Group 5: Gap-Fill Tests
// ============================================================================

describe('MappingConfirmationModal - Gap-Fill Tests', () => {
  let metaModel: MetaModel;
  let diagram: TemporaryArchitectureDiagram;
  let onClose: ReturnType<typeof vi.fn>;
  let onConfirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    metaModel = createTestMetaModel();
    diagram = createTestTemporaryDiagram();
    onClose = vi.fn();
    onConfirm = vi.fn();
  });

  /**
   * Gap 1: Overlay click-to-close.
   * The modal has an overlay click handler but no test verifies clicking the overlay
   * (not the modal content) calls onClose.
   */
  it('calls onClose when the overlay background is clicked', () => {
    const mappingResult = createPartiallyMatchedResult();

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // The overlay is the element with data-testid="mapping-confirmation-modal"
    const overlay = screen.getByTestId('mapping-confirmation-modal');
    expect(overlay).toBeTruthy();

    // Click directly on the overlay (not on child elements)
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Gap 2: Escape key closes the modal.
   * The modal registers a keydown listener for Escape but no test verifies it.
   */
  it('calls onClose when Escape key is pressed', () => {
    const mappingResult = createPartiallyMatchedResult();

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Verify modal is rendered
    expect(screen.getByTestId('mapping-confirmation-modal')).toBeTruthy();

    // Dispatch Escape keydown on document
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * Gap 3: mode_mismatch node rows render as non-editable warnings.
   * The modal renders a warning row for nodes with reasonCode 'mode_mismatch',
   * but no test verifies this path.
   */
  it('renders mode_mismatch node rows as non-editable warnings without a dropdown', () => {
    // Create a mapping result with a mode_mismatch node
    const modeMismatchResult: DiagramMappingResult = {
      nodes: [
        { temporaryNodeId: 'n1', matchedEntityId: null, status: 'unmatched', reasonCode: 'mode_mismatch' },
        { temporaryNodeId: 'n2', matchedEntityId: 'le2', status: 'matched' },
      ],
      attributes: [
        { temporaryItemId: 'item1', parentTemporaryNodeId: 'n1', matchedAttributeId: null, status: 'unmatched', reasonCode: 'no_attribute_match' },
        { temporaryItemId: 'item2', parentTemporaryNodeId: 'n1', matchedAttributeId: null, status: 'unmatched', reasonCode: 'no_attribute_match' },
        { temporaryItemId: 'item3', parentTemporaryNodeId: 'n2', matchedAttributeId: 'la3', status: 'matched' },
      ],
      edges: [
        { temporaryEdgeId: 'e1', matchedRelationshipId: null, status: 'unmatched', reasonCode: 'no_relationship_match' },
      ],
      summary: {
        nodes: { total: 2, matched: 1, unmatched: 1 },
        attributes: { total: 3, matched: 1, unmatched: 2 },
        edges: { total: 1, matched: 0, unmatched: 1 },
      },
      overallStatus: 'partially_matched',
    };

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={modeMismatchResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // n1 should be rendered as a warning row (mode_mismatch)
    const n1Row = screen.getByTestId('entity-row-n1');
    expect(n1Row).toBeTruthy();
    expect(n1Row.textContent).toContain('Customer');
    expect(n1Row.textContent).toContain('Mode mismatch');

    // n1 should NOT have a select dropdown (it is non-editable)
    expect(screen.queryByTestId('entity-select-n1')).toBeNull();
    // n1 should NOT have a badge (badges are only for editable rows)
    expect(screen.queryByTestId('entity-badge-n1')).toBeNull();

    // n2 should still have a normal editable row with a select
    const n2Select = screen.getByTestId('entity-select-n2') as HTMLSelectElement;
    expect(n2Select).toBeTruthy();
  });

  /**
   * Gap 4: Relationship section renders with edge rows.
   * No existing test verifies that the Relationships section renders edge rows with
   * source/target ref_name labels and a select dropdown for auto-matched edges.
   */
  it('renders relationship rows with source/target labels and disabled hint when endpoint is unresolved', () => {
    const mappingResult = createPartiallyMatchedResult();

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Verify relationships section exists
    expect(screen.getByTestId('relationships-section')).toBeTruthy();

    // Verify edge row e1 renders
    const e1Row = screen.getByTestId('edge-row-e1');
    expect(e1Row).toBeTruthy();

    // Should display source and target ref_names
    expect(e1Row.textContent).toContain('Customer');
    expect(e1Row.textContent).toContain('Order');

    // e1 is auto-matched to rel1 -- initially n1 is matched to le1, but n2 is unmatched
    // Since n2 has no entity selected, the edge dropdown should show the disabled hint
    expect(e1Row.textContent).toContain('Select both endpoint entities first');

    // No select dropdown should be present since n2 has no entity selected
    expect(screen.queryByTestId('edge-select-e1')).toBeNull();
  });

  /**
   * Gap 5: Attribute dropdown re-enables when parent entity transitions from
   * unselected to selected. Existing test only checks initial disabled state;
   * this test verifies the transition from disabled to enabled via user interaction.
   */
  it('enables attribute dropdown after selecting parent entity for a previously unresolved node', () => {
    const mappingResult = createPartiallyMatchedResult();

    render(
      <MappingConfirmationModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        mappingResult={mappingResult}
        temporaryDiagram={diagram}
        metaModel={metaModel}
      />
    );

    // Initially n2 is unresolved, so item3 (under n2) should show "Select parent entity first"
    const item3RowBefore = screen.getByTestId('attribute-row-item3');
    expect(item3RowBefore.textContent).toContain('Select parent entity first');
    expect(screen.queryByTestId('attribute-select-item3')).toBeNull();

    // Now select an entity for n2 (Order -> le2)
    const n2Select = screen.getByTestId('entity-select-n2') as HTMLSelectElement;
    fireEvent.change(n2Select, { target: { value: 'le2' } });

    // After selecting le2 for n2, item3 should now have an enabled dropdown
    const item3Select = screen.getByTestId('attribute-select-item3') as HTMLSelectElement;
    expect(item3Select).toBeTruthy();

    // The dropdown should show le2 (Order) attributes: only order_date (la3)
    const item3Options = item3Select.querySelectorAll('option');
    // placeholder + 1 attribute = 2 options
    expect(item3Options.length).toBe(2);

    // item3 ref_name is 'order_date' which matches la3 exactly -> auto-revalidated
    expect(item3Select.value).toBe('la3');
  });
});
