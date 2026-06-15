/**
 * AddMessageExchangeDrawer.validationAndSubmit.test.tsx
 * Task Group 3: Tests for validation and submit behavior
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AddMessageExchangeDrawer,
  AddMessageExchangeDrawerProps,
} from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import { SequenceParticipant, SequenceMessage } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

function createTestMetaModel(): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'Test App 1', description: '', tags: '' },
    ],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [
      { id: 'ep-1', name: 'GetOrder', description: '', interface_id: 'iface-1', verb: 'GET', path: '/orders', request_data_entity_point_id: '', response_data_entity_point_id: '' },
    ],
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
  { id: 'p2', ref_kind: 'Application', ref_id: 'app-1', order_index: 1 },
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
 * Helper: set up form to InterfaceEndpoint request with endpoint_response mode selected,
 * with all response show flags unchecked.
 */
async function setupEndpointResponseForm(user: ReturnType<typeof userEvent.setup>) {
  // Select participants
  const fromSelect = screen.getByTestId('field-fromParticipant');
  const toSelect = screen.getByTestId('field-toParticipant');
  await user.selectOptions(fromSelect, 'p1');
  await user.selectOptions(toSelect, 'p2');

  // Switch to reference mode
  const allRadios = screen.getAllByRole('radio');
  const referenceRadio = allRadios.find(radio => {
    const parent = radio.closest('span');
    return parent?.textContent?.includes('Reference') && !parent?.textContent?.includes('Endpoint');
  }) as HTMLInputElement;
  await user.click(referenceRadio);

  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
  });

  // Select InterfaceEndpoint
  await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');

  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefId')).toBeInTheDocument();
  });

  // Select endpoint reference
  await user.selectOptions(screen.getByTestId('field-requestRefId'), 'ep-1');

  // Enable response
  await user.click(screen.getByTestId('field-includeResponse'));

  // Select Endpoint Response mode
  await waitFor(() => {
    expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
  });
  await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));

  // Wait for response what-to-show group
  await waitFor(() => {
    expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
  });

  // Uncheck the default-checked responseShowEndpointReqResData
  const responseDataCheckbox = screen.getByTestId('field-responseShowEndpointReqResData');
  if ((responseDataCheckbox as HTMLInputElement).checked) {
    await user.click(responseDataCheckbox);
  }
}

describe('AddMessageExchangeDrawer - Validation and Submit Logic', () => {
  it('shows validation error when includeResponse is true, responseContentMode === endpoint_response, and all three response show flags are false', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseForm(user);

    // Click submit
    await user.click(screen.getByTestId('drawer-submit-button'));

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText('Choose at least one thing to show')).toBeInTheDocument();
    });
  });

  it('shows no validation error when at least one response show flag is true', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDrawer();

    await setupEndpointResponseForm(user);

    // Check one response show flag
    await user.click(screen.getByTestId('field-responseShowEndpointName'));

    // Click submit
    await user.click(screen.getByTestId('drawer-submit-button'));

    // Should succeed (onSubmit called)
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it('handleSubmit uses responseShowEndpointName/VerbPath/ReqResData for response message, not request flags', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDrawer();

    // Select participants
    await user.selectOptions(screen.getByTestId('field-fromParticipant'), 'p1');
    await user.selectOptions(screen.getByTestId('field-toParticipant'), 'p2');

    // Switch to reference mode
    const allRadios = screen.getAllByRole('radio');
    const referenceRadio = allRadios.find(radio => {
      const parent = radio.closest('span');
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

    // Enable response
    await user.click(screen.getByTestId('field-includeResponse'));
    await waitFor(() => {
      expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));
    await waitFor(() => {
      expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
    });

    // Set response flags: check Name only (uncheck ReqResData default)
    await user.click(screen.getByTestId('field-responseShowEndpointName'));
    const resDataCb = screen.getByTestId('field-responseShowEndpointReqResData');
    if ((resDataCb as HTMLInputElement).checked) {
      await user.click(resDataCb);
    }

    // Submit
    await user.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const [messages] = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [SequenceMessage[]];
    const responseMsg = messages.find(m => m.exchange_role === 'Response');
    expect(responseMsg).toBeDefined();
    expect(responseMsg!.show_endpoint_name).toBe(true);
    expect(responseMsg!.show_endpoint_verb_path).toBe(false);
    expect(responseMsg!.show_endpoint_req_res_data).toBe(false);
  });

  it('handleSubmit still uses request show flags for request message', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDrawer();

    // Select participants
    await user.selectOptions(screen.getByTestId('field-fromParticipant'), 'p1');
    await user.selectOptions(screen.getByTestId('field-toParticipant'), 'p2');

    // Switch to reference mode
    const allRadios = screen.getAllByRole('radio');
    const referenceRadio = allRadios.find(radio => {
      const parent = radio.closest('span');
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

    // Request show flags: defaults are showEndpointName=false, showEndpointVerbPath=true, showEndpointReqResData=true
    // Check showEndpointName to make it true
    await user.click(screen.getByTestId('field-showEndpointName'));

    // Enable response
    await user.click(screen.getByTestId('field-includeResponse'));
    await waitFor(() => {
      expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));
    await waitFor(() => {
      expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
    });

    // Response flags: default has responseShowEndpointReqResData=true, which is enough to pass validation

    // Submit
    await user.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const [messages] = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as [SequenceMessage[]];
    const requestMsg = messages.find(m => m.exchange_role === 'Request');
    expect(requestMsg).toBeDefined();
    // Request should use request show flags (showEndpointName=true after click, VerbPath=true default, ReqResData=true default)
    expect(requestMsg!.show_endpoint_name).toBe(true);
    expect(requestMsg!.show_endpoint_verb_path).toBe(true);
    expect(requestMsg!.show_endpoint_req_res_data).toBe(true);
  });
});
