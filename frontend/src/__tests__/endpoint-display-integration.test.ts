/**
 * endpoint-display-integration.test.ts
 *
 * Task Group 6: Integration tests for the Sequence Diagram Interface Endpoint
 * Message Exchange Display and Endpoint Response feature.
 *
 * These tests verify cross-layer integration points that individual unit tests
 * from Task Groups 1-5 do not cover:
 * 1. End-to-end: InterfaceEndpoint message with all 3 show flags -> multi-line render
 * 2. End-to-end: Endpoint Response mode creates response message with correct fields
 * 3. End-to-end: Legacy message (no flags) renders with endpoint name
 * 4. Integration: hook mapping round-trip preserves all SequenceMessageRef fields
 * 5. Integration: response_mode=endpoint_response copies ref_kind/ref_id from request
 * 6. Backward compatibility: old data without show_* flags renders endpoint name
 * 7. Validation: non-InterfaceEndpoint messages do not produce multi-line labels
 * 8. Dynamic row height: 3-line label gets increased row height without overlap
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMessageLabel,
  getLabelLineCount,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import { resolveDataEntityPointName } from '../utils/resolveDataEntityPointName';
import { computeSequenceLayout, computeRowHeight } from '../utils/sequenceLayout';
import {
  sequenceContentToSequenceDiagram,
  sequenceDiagramToSequenceContent,
} from '../hooks/useSequenceDiagram';
import type { SequenceMessage, SequenceDiagram } from '../types/sequenceDiagram';
import type { SequenceMessageRef, SequenceContent } from '../types/typedContent';
import type { MetaModel, MetaModelEntities, MetaModelRelationships, Endpoint, EndpointType } from '../types/model';

// ============================================================================
// Helpers
// ============================================================================

function createMetaModel(opts: {
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
    endpoints: opts.endpoints || [],
    classes: [],
    methods: [{ id: 'method-1', name: 'doSomething', description: '', class_id: '' }],
    application_points: [],
    logical_data_entities: (opts.logicalEntities || []).map(e => ({
      id: e.id, name: e.name, description: '', tags: '',
    })),
    logical_data_attributes: [],
    physical_data_entities: (opts.physicalEntities || []).map(e => ({
      id: e.id, name: e.name, description: '', tags: '', physical_type: '', database: '',
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

function createEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'ep-100',
    name: 'Create Order',
    description: '',
    interface_id: 'iface-1',
    endpoint_type: 'HTTP_REST' as EndpointType,
    path_or_address: '/api/orders',
    operation_verb: 'POST',
    request_data_entity_point_id: 'dep_log_lde-req',
    response_data_entity_point_id: 'dep_phy_pde-res',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SequenceMessage>): SequenceMessage {
  return {
    id: 'msg-int-1',
    exchange_id: 'ex-int-1',
    exchange_role: 'Request',
    from_participant_id: 'p1',
    to_participant_id: 'p2',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Task Group 6: End-to-end Integration Tests', () => {

  // Test 1: All 3 show flags produce a 3-line label that renders correctly
  it('InterfaceEndpoint with all 3 show flags produces a 3-line multi-line label', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({
      endpoints: [endpoint],
      logicalEntities: [{ id: 'lde-req', name: 'OrderRequest' }],
      physicalEntities: [{ id: 'pde-res', name: 'OrderResponse' }],
    });

    const message = makeMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-100',
      exchange_role: 'Request',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: true,
    });

    const label = resolveMessageLabel(message, metaModel);
    expect(Array.isArray(label)).toBe(true);
    expect(label).toHaveLength(3);
    expect(label).toEqual(['Create Order', 'POST /api/orders', 'OrderRequest']);

    // Verify line count and row height
    const lineCount = getLabelLineCount(label);
    expect(lineCount).toBe(3);
    expect(computeRowHeight(lineCount)).toBe(80);
  });

  // Test 2: Endpoint Response mode resolves response data entity
  it('endpoint_response mode resolves response_data_entity_point_id for Response role', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({
      endpoints: [endpoint],
      physicalEntities: [{ id: 'pde-res', name: 'OrderResponse' }],
    });

    const responseMsg = makeMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-100',
      exchange_role: 'Response',
      response_mode: 'endpoint_response',
      show_endpoint_name: true,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
    });

    const label = resolveMessageLabel(responseMsg, metaModel);
    expect(Array.isArray(label)).toBe(true);
    expect(label).toEqual(['Create Order', 'OrderResponse']);
  });

  // Test 3: Legacy message (no flags) renders endpoint name
  it('legacy message with no show_* flags renders endpoint name as fallback', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({ endpoints: [endpoint] });

    const message = makeMessage({
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-100',
      // No show_* flags at all
    });

    const label = resolveMessageLabel(message, metaModel);
    expect(label).toEqual(['Create Order']);
  });

  // Test 4: Hook mapping round-trip preserves all endpoint display fields
  it('hook mapping round-trip preserves show_* flags and response_mode', () => {
    const originalRef: SequenceMessageRef = {
      id: 'msg-rt',
      exchange_id: 'ex-rt',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-100',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: false,
      response_mode: 'endpoint_response',
    };

    const content: SequenceContent = {
      participants: [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
      ],
      messages: [originalRef],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

    // content -> diagram -> content
    const diagram = sequenceContentToSequenceDiagram('d1', 'mf1', 'Test', content);
    const roundTripped = sequenceDiagramToSequenceContent(diagram);
    const result = roundTripped.messages[0];

    expect(result.show_endpoint_name).toBe(true);
    expect(result.show_endpoint_verb_path).toBe(true);
    expect(result.show_endpoint_req_res_data).toBe(false);
    expect(result.response_mode).toBe('endpoint_response');
    expect(result.ref_kind).toBe('InterfaceEndpoint');
    expect(result.ref_id).toBe('ep-100');
  });

  // Test 5: response_mode=endpoint_response with copied ref_kind/ref_id renders correctly
  it('response message with endpoint_response mode and copied ref fields resolves label', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({
      endpoints: [endpoint],
      logicalEntities: [{ id: 'lde-req', name: 'OrderRequest' }],
      physicalEntities: [{ id: 'pde-res', name: 'OrderResponse' }],
    });

    // Simulate what handleSubmit does: copy ref_kind, ref_id, show_* from request
    const requestMsg = makeMessage({
      id: 'msg-req',
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-100',
      exchange_role: 'Request',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: true,
    });

    const responseMsg = makeMessage({
      id: 'msg-res',
      exchange_role: 'Response',
      from_participant_id: 'p2',
      to_participant_id: 'p1',
      ref_kind: requestMsg.ref_kind,
      ref_id: requestMsg.ref_id,
      response_mode: 'endpoint_response',
      show_endpoint_name: requestMsg.show_endpoint_name,
      show_endpoint_verb_path: requestMsg.show_endpoint_verb_path,
      show_endpoint_req_res_data: requestMsg.show_endpoint_req_res_data,
    });

    const reqLabel = resolveMessageLabel(requestMsg, metaModel);
    const resLabel = resolveMessageLabel(responseMsg, metaModel);

    // Request uses request_data_entity_point_id
    expect(reqLabel).toEqual(['Create Order', 'POST /api/orders', 'OrderRequest']);
    // Response uses response_data_entity_point_id
    expect(resLabel).toEqual(['Create Order', 'POST /api/orders', 'OrderResponse']);
  });

  // Test 6: Backward compatibility - old data without show_* flags through full pipeline
  it('old data without show_* flags round-trips through hook and renders endpoint name', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({ endpoints: [endpoint] });

    // Simulate old data from backend: no show_* fields at all
    const content: SequenceContent = {
      participants: [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
      ],
      messages: [{
        id: 'msg-old',
        exchange_id: 'ex-old',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'ep-100',
        // No show_* or response_mode fields
      }],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

    const diagram = sequenceContentToSequenceDiagram('d1', 'mf1', 'Test', content);
    const msg = diagram.messages[0];

    // Fields should be undefined (not set)
    expect(msg.show_endpoint_name).toBeUndefined();
    expect(msg.show_endpoint_verb_path).toBeUndefined();
    expect(msg.show_endpoint_req_res_data).toBeUndefined();
    expect(msg.response_mode).toBeUndefined();

    // Renderer should fallback to endpoint name
    const label = resolveMessageLabel(msg, metaModel);
    expect(label).toEqual(['Create Order']);
  });

  // Test 7: Non-InterfaceEndpoint messages do not produce multi-line labels
  it('non-InterfaceEndpoint ref_kind produces single-string label, not array', () => {
    const metaModel = createMetaModel();

    const message = makeMessage({
      ref_kind: 'Method',
      ref_id: 'method-1',
    });

    const label = resolveMessageLabel(message, metaModel);
    expect(typeof label).toBe('string');
    expect(label).toBe('doSomething');
  });

  // Test 8: Dynamic row height - 3-line label gets correct layout spacing
  it('layout engine uses increased row height for 3-line endpoint labels', () => {
    const endpoint = createEndpoint();
    const metaModel = createMetaModel({
      endpoints: [endpoint],
      logicalEntities: [{ id: 'lde-req', name: 'OrderRequest' }],
    });

    // Create a diagram with 2 messages: first is 3-line endpoint, second is 1-line
    const diagram: SequenceDiagram = {
      id: 'd1',
      model_file_id: 'mf1',
      name: 'Test',
      type: 'Sequence',
      participants: [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
      ],
      messages: [
        makeMessage({
          id: 'msg-3line',
          ref_kind: 'InterfaceEndpoint',
          ref_id: 'ep-100',
          show_endpoint_name: true,
          show_endpoint_verb_path: true,
          show_endpoint_req_res_data: true,
        }),
        makeMessage({
          id: 'msg-1line',
          exchange_id: 'ex-2',
          label_text: 'Simple label',
        }),
      ],
      fragments: [],
      operands: [],
      sequence_nodes: [
        { id: 'n1', node_kind: 'Message', message_id: 'msg-3line', order_index: 0, parent_node_id: undefined, parent_operand_id: undefined },
        { id: 'n2', node_kind: 'Message', message_id: 'msg-1line', order_index: 1, parent_node_id: undefined, parent_operand_id: undefined },
      ],
    };

    // Compute label line counts
    const lineCounts = new Map<string, number>();
    for (const msg of diagram.messages) {
      const label = resolveMessageLabel(msg, metaModel);
      lineCounts.set(msg.id, getLabelLineCount(label));
    }

    expect(lineCounts.get('msg-3line')).toBe(3);
    expect(lineCounts.get('msg-1line')).toBe(1);

    // Compute layout with dynamic row heights
    const layout = computeSequenceLayout(diagram, 220, lineCounts);

    // Find the two message layouts
    const msg1Layout = layout.messageLayouts.find(m => m.messageId === 'msg-3line')!;
    const msg2Layout = layout.messageLayouts.find(m => m.messageId === 'msg-1line')!;

    // The second message should be offset by the 3-line row height (80px), not 60px
    const yGap = msg2Layout.y - msg1Layout.y;
    expect(yGap).toBe(80); // computeRowHeight(3) = 80
  });
});
