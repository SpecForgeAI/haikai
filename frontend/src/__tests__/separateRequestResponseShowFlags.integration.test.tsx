/**
 * separateRequestResponseShowFlags.integration.test.tsx
 * Task Group 5: Integration tests for the separate request/response "What to Show?" feature
 * and the 3-line label y-offset fix.
 *
 * These tests cover cross-cutting concerns between form state, submit, validation,
 * and rendering that are not fully addressed by the unit tests in Task Groups 1-4.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AddMessageExchangeDrawer,
  AddMessageExchangeDrawerProps,
} from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import {
  resolveMessageLabel,
  renderMultiLineLabel,
  MESSAGE_LABEL_LINE_SPACING,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import { SequenceParticipant, SequenceMessage } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestMetaModel(): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'App Alpha', description: '', tags: '' },
      { id: 'app-2', name: 'App Beta', description: '', tags: '' },
    ],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [
      {
        id: 'ep-1',
        name: 'GetOrder',
        description: '',
        interface_id: 'iface-1',
        endpoint_type: 'HTTP_REST' as any,
        path_or_address: '/orders/{id}',
        operation_verb: 'GET',
        request_data_entity_point_id: 'dep_log_lde-req-1',
        response_data_entity_point_id: 'dep_log_lde-res-1',
      },
    ],
    classes: [],
    methods: [
      { id: 'method-1', name: 'processOrder', description: '', class_id: '' },
    ],
    application_points: [],
    logical_data_entities: [
      { id: 'lde-req-1', name: 'OrderRequest', description: '', tags: '' },
      { id: 'lde-res-1', name: 'OrderResponse', description: '', tags: '' },
    ],
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
  };

  const relationships: MetaModelRelationships = {
    application_services: [],
    service_interfaces: [],
    interface_endpoints: [],
    app_component_services: [],
    class_methods: [],
    component_classes: [],
    service_events: [],
    component_states: [],
  };

  return { entities, relationships };
}

const mockParticipants: SequenceParticipant[] = [
  { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
  { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
];

function renderDrawer(overrides: Partial<AddMessageExchangeDrawerProps> = {}) {
  const defaults: AddMessageExchangeDrawerProps = {
    isOpen: true,
    onClose: vi.fn(),
    participants: mockParticipants,
    existingNodes: [],
    metaModel: createTestMetaModel(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { ...render(<AddMessageExchangeDrawer {...defaults} />), onSubmit: defaults.onSubmit };
}

/**
 * Sets up the drawer to InterfaceEndpoint request with endpoint_response mode.
 */
async function setupEndpointResponseMode(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('field-fromParticipant'), 'p1');
  await user.selectOptions(screen.getByTestId('field-toParticipant'), 'p2');

  const allRadios = screen.getAllByRole('radio');
  const referenceRadio = allRadios.find(r => {
    const parent = r.closest('span');
    return parent?.textContent?.includes('Reference') && !parent?.textContent?.includes('Endpoint');
  }) as HTMLInputElement;
  await user.click(referenceRadio);

  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
  });

  await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');
  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefId')).toBeInTheDocument();
  });
  await user.selectOptions(screen.getByTestId('field-requestRefId'), 'ep-1');

  await user.click(screen.getByTestId('field-includeResponse'));
  await waitFor(() => {
    expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));
  await waitFor(() => {
    expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Separate Request/Response Show Flags - Integration Tests', () => {
  it('end-to-end: create message exchange with separate request/response show flags, both messages persist correct flags', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDrawer();

    await setupEndpointResponseMode(user);

    // Request flags: check Name (default off), leave VerbPath (default on), uncheck ReqResData (default on)
    await user.click(screen.getByTestId('field-showEndpointName'));
    const reqDataCb = screen.getByTestId('field-showEndpointReqResData') as HTMLInputElement;
    if (reqDataCb.checked) {
      await user.click(reqDataCb);
    }

    // Response flags: check VerbPath (default off), leave ReqResData (default on)
    await user.click(screen.getByTestId('field-responseShowEndpointVerbPath'));

    // Submit
    await user.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const [messages] = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [SequenceMessage[]];
    const requestMsg = messages.find(m => m.exchange_role === 'Request');
    const responseMsg = messages.find(m => m.exchange_role === 'Response');

    // Request: Name=true, VerbPath=true, ReqResData=false
    expect(requestMsg).toBeDefined();
    expect(requestMsg!.show_endpoint_name).toBe(true);
    expect(requestMsg!.show_endpoint_verb_path).toBe(true);
    expect(requestMsg!.show_endpoint_req_res_data).toBe(false);

    // Response: Name=false, VerbPath=true, ReqResData=true
    expect(responseMsg).toBeDefined();
    expect(responseMsg!.show_endpoint_name).toBe(false);
    expect(responseMsg!.show_endpoint_verb_path).toBe(true);
    expect(responseMsg!.show_endpoint_req_res_data).toBe(true);
  });

  it('legacy message with all show flags false/missing renders endpoint name (backward compatibility)', () => {
    const metaModel = createTestMetaModel();

    const legacyMessage: SequenceMessage = {
      id: 'msg-legacy',
      exchange_id: 'ex-1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 0,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      show_endpoint_name: false,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: false,
    };

    const label = resolveMessageLabel(legacyMessage, metaModel);
    // Legacy fallback: all flags false -> show endpoint name
    expect(label).toEqual(['GetOrder']);
  });

  it('switching responseContentMode away from endpoint_response hides response checkbox group', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseMode(user);

    // Confirm response checkbox group is visible
    expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();

    // Switch to label mode
    await user.click(screen.getByTestId('radio-responseContentMode-label'));

    // Response checkbox group should be gone
    await waitFor(() => {
      expect(screen.queryByTestId('response-what-to-show-group')).not.toBeInTheDocument();
    });
  });

  it('3-line InterfaceEndpoint label renders above arrow without overlap (startY shifted by -10)', () => {
    const lines = ['GetOrder', 'GET /orders/{id}', 'OrderRequest'];
    const labelX = 200;
    const baseY = 300;

    const element = renderMultiLineLabel(lines, labelX, baseY);
    expect(element).not.toBeNull();

    const { container } = render(<svg>{element}</svg>);
    const textEl = container.querySelector('text');
    expect(textEl).not.toBeNull();

    const actualY = parseFloat(textEl!.getAttribute('y')!);
    const totalHeight = (lines.length - 1) * MESSAGE_LABEL_LINE_SPACING;
    const expectedY = baseY - totalHeight / 2 - 10;

    expect(actualY).toBe(expectedY);
  });

  it('request message with Name+VerbPath+RequestData shows 3 lines; response with only ResponseData shows 1 line', () => {
    const metaModel = createTestMetaModel();

    const requestMsg: SequenceMessage = {
      id: 'msg-req',
      exchange_id: 'ex-1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 0,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: true,
    };

    const requestLabel = resolveMessageLabel(requestMsg, metaModel);
    expect(Array.isArray(requestLabel)).toBe(true);
    expect((requestLabel as string[]).length).toBe(3);
    expect(requestLabel).toEqual(['GetOrder', 'GET /orders/{id}', 'OrderRequest']);

    const responseMsg: SequenceMessage = {
      id: 'msg-res',
      exchange_id: 'ex-1',
      exchange_role: 'Response',
      from_participant_id: 'p2',
      to_participant_id: 'p1',
      order_index: 1,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      response_mode: 'endpoint_response',
      show_endpoint_name: false,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
    };

    const responseLabel = resolveMessageLabel(responseMsg, metaModel);
    expect(Array.isArray(responseLabel)).toBe(true);
    expect((responseLabel as string[]).length).toBe(1);
    expect(responseLabel).toEqual(['OrderResponse']);
  });

  it('validation error clears when user checks at least one response show flag', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseMode(user);

    // Uncheck the default responseShowEndpointReqResData
    const resDataCb = screen.getByTestId('field-responseShowEndpointReqResData') as HTMLInputElement;
    if (resDataCb.checked) {
      await user.click(resDataCb);
    }

    // Submit to trigger validation
    await user.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(screen.getByText('Choose at least one thing to show')).toBeInTheDocument();
    });

    // Check one response flag to clear the error
    await user.click(screen.getByTestId('field-responseShowEndpointName'));

    // The validation error should clear (either immediately or on next submit)
    await user.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(screen.queryByText('Choose at least one thing to show')).not.toBeInTheDocument();
    });
  });

  it('response show flags do not affect request message rendering', () => {
    const metaModel = createTestMetaModel();

    // Request message with its own flags (Name + VerbPath only)
    const requestMsg: SequenceMessage = {
      id: 'msg-req',
      exchange_id: 'ex-1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 0,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: false,
    };

    const requestLabel = resolveMessageLabel(requestMsg, metaModel);
    expect(requestLabel).toEqual(['GetOrder', 'GET /orders/{id}']);

    // Response with different flags - uses response data entity
    const responseMsg: SequenceMessage = {
      id: 'msg-res',
      exchange_id: 'ex-1',
      exchange_role: 'Response',
      from_participant_id: 'p2',
      to_participant_id: 'p1',
      order_index: 1,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      response_mode: 'endpoint_response',
      show_endpoint_name: false,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
    };

    // Resolve both independently
    const responseLabel = resolveMessageLabel(responseMsg, metaModel);
    expect(responseLabel).toEqual(['OrderResponse']);

    // Re-check request has not changed
    const requestLabelAgain = resolveMessageLabel(requestMsg, metaModel);
    expect(requestLabelAgain).toEqual(['GetOrder', 'GET /orders/{id}']);
  });

  it('mixed diagram with endpoint and non-endpoint messages renders correctly', () => {
    const metaModel = createTestMetaModel();

    const endpointMsg: SequenceMessage = {
      id: 'msg-ep',
      exchange_id: 'ex-1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 0,
      ref_kind: 'InterfaceEndpoint',
      ref_id: 'ep-1',
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: false,
    };

    const labelMsg: SequenceMessage = {
      id: 'msg-label',
      exchange_id: 'ex-2',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 1,
      label_text: 'Send Notification',
    };

    const methodMsg: SequenceMessage = {
      id: 'msg-method',
      exchange_id: 'ex-3',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      order_index: 2,
      ref_kind: 'Method',
      ref_id: 'method-1',
    };

    const endpointLabel = resolveMessageLabel(endpointMsg, metaModel);
    expect(endpointLabel).toEqual(['GetOrder', 'GET /orders/{id}']);

    const textLabel = resolveMessageLabel(labelMsg, metaModel);
    expect(textLabel).toBe('Send Notification');

    const methodLabel = resolveMessageLabel(methodMsg, metaModel);
    expect(methodLabel).toBe('processOrder');
  });
});
