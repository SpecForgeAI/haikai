/**
 * SequenceDiagramRenderer.endpointMultiLine.test.ts
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 5: Multi-line Labels, Data Resolution, and Dynamic Row Height
 *
 * 8 focused tests:
 * 1. resolveMessageLabel returns string[] for InterfaceEndpoint with show_endpoint_name=true
 * 2. resolveMessageLabel returns string[] with verb+path line when show_endpoint_verb_path=true
 * 3. resolveMessageLabel returns string[] with data entity name when show_endpoint_req_res_data=true
 * 4. Legacy backward compatibility: all flags false/missing returns endpoint name
 * 5. resolveDataEntityPointName resolves dep_log_* ID to logical data entity name
 * 6. resolveDataEntityPointName resolves dep_phy_* ID to physical data entity name
 * 7. MessageArrow renders multiple tspan elements for string[] label (via renderMultiLineLabel)
 * 8. Dynamic row height increases for multi-line labels
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMessageLabel,
  getLabelLineCount,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import { resolveDataEntityPointName } from '../utils/resolveDataEntityPointName';
import { computeSequenceLayout, computeRowHeight } from '../utils/sequenceLayout';
import type { SequenceMessage } from '../types/sequenceDiagram';
import type { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';
import type { Endpoint, EndpointType } from '../types/model';

/**
 * Helper to create a minimal MetaModel for testing.
 */
function createTestMetaModel(options: {
  endpoints?: Endpoint[];
  logicalEntities?: Array<{ id: string; name: string }>;
  physicalEntities?: Array<{ id: string; name: string }>;
} = {}): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: options.endpoints || [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: (options.logicalEntities || []).map(e => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    logical_data_attributes: [],
    physical_data_entities: (options.physicalEntities || []).map(e => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
      physical_type: '',
      database: '',
    })),
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
  };

  const relationships: MetaModelRelationships = {
    business_user_business_points: [],
    application_point_business_points: [],
    application_point_business_logics: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
    ui_workflow_transitions: [],
  };

  return { entities, relationships };
}

function createTestEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'ep-001',
    name: 'Get Customer',
    description: '',
    interface_id: 'iface-001',
    endpoint_type: 'HTTP_REST' as EndpointType,
    path_or_address: '/api/v1/customers/{id}',
    operation_verb: 'GET',
    request_data_entity_point_id: 'dep_log_lde-001',
    response_data_entity_point_id: 'dep_phy_pde-001',
    ...overrides,
  };
}

function createTestMessage(overrides: Partial<SequenceMessage>): SequenceMessage {
  return {
    id: 'msg-001',
    exchange_id: 'exchange-001',
    exchange_role: 'Request',
    from_participant_id: 'p1',
    to_participant_id: 'p2',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Task Group 5: Multi-line Labels, Data Resolution, and Dynamic Row Height', () => {

  // Test 1: resolveMessageLabel returns string[] for InterfaceEndpoint with show_endpoint_name=true
  it('returns string[] with endpoint name when show_endpoint_name=true', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({ endpoints: [endpoint] });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      show_endpoint_name: true,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: false,
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Get Customer']);
  });

  // Test 2: resolveMessageLabel returns string[] with verb+path line when show_endpoint_verb_path=true
  it('returns string[] with verb+path when show_endpoint_verb_path=true', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({ endpoints: [endpoint] });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      show_endpoint_name: false,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: false,
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['GET /api/v1/customers/{id}']);
  });

  // Test 3: resolveMessageLabel returns string[] with data entity name when show_endpoint_req_res_data=true
  it('returns string[] with data entity name when show_endpoint_req_res_data=true (Request role)', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({
      endpoints: [endpoint],
      logicalEntities: [{ id: 'lde-001', name: 'CustomerRequest' }],
    });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      exchange_role: 'Request',
      show_endpoint_name: false,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['CustomerRequest']);
  });

  // Test 4: Legacy backward compatibility - all flags false/missing returns endpoint name
  it('returns [endpoint.name] when all show_* flags are false/missing (legacy)', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({ endpoints: [endpoint] });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      // No show_* flags set
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['Get Customer']);
  });

  // Test 5: resolveDataEntityPointName resolves dep_log_* ID to logical data entity name
  it('resolveDataEntityPointName resolves dep_log_* to logical data entity name', () => {
    const metaModel = createTestMetaModel({
      logicalEntities: [{ id: 'lde-abc', name: 'OrderPayload' }],
    });

    const result = resolveDataEntityPointName('dep_log_lde-abc', metaModel);
    expect(result).toBe('OrderPayload');
  });

  // Test 6: resolveDataEntityPointName resolves dep_phy_* ID to physical data entity name
  it('resolveDataEntityPointName resolves dep_phy_* to physical data entity name', () => {
    const metaModel = createTestMetaModel({
      physicalEntities: [{ id: 'pde-xyz', name: 'orders_table' }],
    });

    const result = resolveDataEntityPointName('dep_phy_pde-xyz', metaModel);
    expect(result).toBe('orders_table');
  });

  // Test 7: Multi-line label produces multiple lines for rendering
  it('resolveMessageLabel produces 3-line array when all show_* flags are true', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({
      endpoints: [endpoint],
      logicalEntities: [{ id: 'lde-001', name: 'CustomerRequest' }],
    });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      exchange_role: 'Request',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: true,
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result).toEqual([
      'Get Customer',
      'GET /api/v1/customers/{id}',
      'CustomerRequest',
    ]);
  });

  // Test 8: Dynamic row height increases for multi-line labels
  it('computeRowHeight returns increased height for 2 and 3 line labels', () => {
    expect(computeRowHeight(1)).toBe(60);
    expect(computeRowHeight(2)).toBe(70);
    expect(computeRowHeight(3)).toBe(80);
    expect(computeRowHeight(0)).toBe(60); // 0 lines treated same as 1
  });

  // Additional: getLabelLineCount works correctly
  it('getLabelLineCount returns correct counts for string and string[]', () => {
    expect(getLabelLineCount('hello')).toBe(1);
    expect(getLabelLineCount('')).toBe(0);
    expect(getLabelLineCount(['a', 'b'])).toBe(2);
    expect(getLabelLineCount(['a', 'b', 'c'])).toBe(3);
  });

  // Additional: Response role resolves response_data_entity_point_id
  it('resolves response data entity for Response exchange_role', () => {
    const endpoint = createTestEndpoint();
    const metaModel = createTestMetaModel({
      endpoints: [endpoint],
      physicalEntities: [{ id: 'pde-001', name: 'CustomerResponse' }],
    });

    const message = createTestMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-001',
      exchange_role: 'Response',
      show_endpoint_name: false,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
    });

    const result = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['CustomerResponse']);
  });
});
