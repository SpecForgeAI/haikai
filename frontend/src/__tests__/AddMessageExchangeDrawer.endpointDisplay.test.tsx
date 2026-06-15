/**
 * AddMessageExchangeDrawer.endpointDisplay.test.tsx
 * Task Group 4: Tests for "What to Show?" checkbox group and "Endpoint Response" radio
 *
 * Tests:
 * 1. "What to Show?" checkbox group appears only when requestMode=reference AND requestRefKind=InterfaceEndpoint
 * 2. Checkbox group hidden for non-InterfaceEndpoint reference kinds
 * 3. Validation error when all 3 checkboxes unchecked
 * 4. "Endpoint Response" radio appears only when request refs InterfaceEndpoint AND includeResponse checked
 * 5. Selecting "Endpoint Response" hides Reference Type dropdown and Reference picker
 * 6. handleSubmit sets response_mode and copies show_* flags to response message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddMessageExchangeDrawer, AddMessageExchangeDrawerProps } from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import { SequenceParticipant, SequenceMessage, SequenceNode } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

function createTestMetaModel(): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-1', name: 'Test App 1', description: '', tags: '' },
      { id: 'app-2', name: 'Test App 2', description: '', tags: '' },
    ],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [
      { id: 'ep-1', name: 'Get Order', description: '', interface_id: '', operation_verb: 'GET', path_or_address: '/api/orders' },
    ],
    classes: [],
    methods: [
      { id: 'method-1', name: 'processOrder', description: '', class_id: '' },
    ],
    application_points: [],
    logical_data_entities: [
      { id: 'logical-1', name: 'Customer', description: '', tags: '' },
    ],
    logical_data_attributes: [],
    physical_data_entities: [
      { id: 'physical-1', name: 'Order', description: '', tags: '' },
    ],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [
      { id: 'event-1', name: 'OrderCreated', description: '' },
    ],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
  };

  const relationships: MetaModelRelationships = {
    business_user_business_points: [],
    application_point_business_points: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  };

  return { entities, relationships };
}

function createTestParticipants(): SequenceParticipant[] {
  return [
    { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
    { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
  ];
}

function createDefaultProps(overrides: Partial<AddMessageExchangeDrawerProps> = {}): AddMessageExchangeDrawerProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    participants: createTestParticipants(),
    existingNodes: [],
    metaModel: createTestMetaModel(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

async function switchToReferenceMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const allRadios = screen.getAllByRole('radio');
  const referenceRadio = allRadios.find(radio => {
    const parent = radio.closest('span');
    return parent?.textContent?.includes('Reference');
  }) as HTMLInputElement;

  if (referenceRadio) {
    await user.click(referenceRadio);
  } else {
    await user.click(allRadios[1]);
  }

  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
  });
}

async function selectParticipants(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(screen.getByTestId('field-fromParticipant'), 'p1');
  await user.selectOptions(screen.getByTestId('field-toParticipant'), 'p2');
}

async function setupInterfaceEndpointRequest(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await selectParticipants(user);
  await switchToReferenceMode(user);
  await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');
  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefId')).toBeInTheDocument();
  });
  await user.selectOptions(screen.getByTestId('field-requestRefId'), 'ep-1');
}

describe('AddMessageExchangeDrawer - Endpoint Display Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('What to Show? checkbox group visibility', () => {
    it('shows "What to Show?" checkbox group when requestMode=reference AND requestRefKind=InterfaceEndpoint', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      await switchToReferenceMode(user);
      await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');

      await waitFor(() => {
        expect(screen.getByTestId('what-to-show-group')).toBeInTheDocument();
        expect(screen.getByTestId('field-showEndpointName')).toBeInTheDocument();
        expect(screen.getByTestId('field-showEndpointVerbPath')).toBeInTheDocument();
        expect(screen.getByTestId('field-showEndpointReqResData')).toBeInTheDocument();
      });
    });

    it('hides "What to Show?" checkbox group for non-InterfaceEndpoint reference kinds', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      await switchToReferenceMode(user);
      await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'Method');

      await waitFor(() => {
        expect(screen.queryByTestId('what-to-show-group')).toBeNull();
      });
    });
  });

  describe('What to Show? validation', () => {
    it('shows validation error when all 3 checkboxes are unchecked', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      await setupInterfaceEndpointRequest(user);

      // Uncheck the defaults (showEndpointVerbPath and showEndpointReqResData are true by default)
      const verbPathCheckbox = screen.getByTestId('field-showEndpointVerbPath') as HTMLInputElement;
      const reqResDataCheckbox = screen.getByTestId('field-showEndpointReqResData') as HTMLInputElement;

      await user.click(verbPathCheckbox);  // uncheck
      await user.click(reqResDataCheckbox); // uncheck

      // Submit
      await user.click(screen.getByTestId('drawer-submit-button'));

      await waitFor(() => {
        expect(screen.getByText('Choose at least one thing to show')).toBeInTheDocument();
      });
    });
  });

  describe('Endpoint Response radio option', () => {
    it('shows "Endpoint Response" radio only when request refs InterfaceEndpoint AND includeResponse checked', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      await setupInterfaceEndpointRequest(user);

      // Before checking includeResponse, the radio should not exist
      expect(screen.queryByTestId('radio-responseContentMode-endpoint_response')).toBeNull();

      // Check includeResponse
      await user.click(screen.getByTestId('field-includeResponse'));

      await waitFor(() => {
        expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
      });
    });

    it('hides Reference Type dropdown and Reference picker when "Endpoint Response" is selected', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      await setupInterfaceEndpointRequest(user);

      // Check includeResponse
      await user.click(screen.getByTestId('field-includeResponse'));

      await waitFor(() => {
        expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
      });

      // Select "Endpoint Response" radio
      await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));

      await waitFor(() => {
        // Reference Type dropdown and Reference picker should be hidden
        expect(screen.queryByTestId('field-responseRefKind')).toBeNull();
        expect(screen.queryByTestId('field-responseRefId')).toBeNull();
        // Label text input should also be hidden
        expect(screen.queryByTestId('field-responseLabelText')).toBeNull();
      });
    });
  });

  describe('handleSubmit with endpoint fields', () => {
    it('sets response_mode and copies show_* flags to response message when endpoint_response selected', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<AddMessageExchangeDrawer {...createDefaultProps({ onSubmit })} />);

      await setupInterfaceEndpointRequest(user);

      // Check "Name" checkbox too
      await user.click(screen.getByTestId('field-showEndpointName'));

      // Include response and select "Endpoint Response"
      await user.click(screen.getByTestId('field-includeResponse'));

      await waitFor(() => {
        expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));

      // Submit
      await user.click(screen.getByTestId('drawer-submit-button'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const [messages] = onSubmit.mock.calls[0] as [SequenceMessage[], SequenceNode[]];
      const requestMsg = messages.find(m => m.exchange_role === 'Request')!;
      const responseMsg = messages.find(m => m.exchange_role === 'Response')!;

      // Request message should have show_* flags
      expect(requestMsg.show_endpoint_name).toBe(true);
      expect(requestMsg.show_endpoint_verb_path).toBe(true);
      expect(requestMsg.show_endpoint_req_res_data).toBe(true);
      expect(requestMsg.ref_kind).toBe('InterfaceEndpoint');
      expect(requestMsg.ref_id).toBe('ep-1');

      // Response message should have response_mode and the ref copied from
      // the request. Its show_* flags are now INDEPENDENT of the request's
      // (driven by the field-responseShowEndpoint* checkboxes) with defaults
      // name=false, verb/path=false, req/res data=true.
      expect(responseMsg.response_mode).toBe('endpoint_response');
      expect(responseMsg.ref_kind).toBe('InterfaceEndpoint');
      expect(responseMsg.ref_id).toBe('ep-1');
      expect(responseMsg.show_endpoint_name).toBe(false);
      expect(responseMsg.show_endpoint_verb_path).toBe(false);
      expect(responseMsg.show_endpoint_req_res_data).toBe(true);
    });
  });
});
