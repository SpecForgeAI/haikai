/**
 * AddMessageExchangeDrawer.responseCheckboxUI.test.tsx
 * Task Group 2: Tests for response "What to Show?" checkbox group UI
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AddMessageExchangeDrawer,
  AddMessageExchangeDrawerProps,
} from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import { SequenceParticipant } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

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
  return render(<AddMessageExchangeDrawer {...defaults} />);
}

/**
 * Helper: set up the drawer in endpoint_response mode.
 * Selects from/to participants, switches request to Reference/InterfaceEndpoint,
 * checks Include Response, selects Endpoint Response radio.
 */
async function setupEndpointResponseMode(user: ReturnType<typeof userEvent.setup>) {
  // Select from/to participants
  const fromSelect = screen.getByTestId('field-fromParticipant');
  const toSelect = screen.getByTestId('field-toParticipant');
  await user.selectOptions(fromSelect, 'p1');
  await user.selectOptions(toSelect, 'p2');

  // Switch request to Reference mode
  const allRadios = screen.getAllByRole('radio');
  const referenceRadio = allRadios.find(r => r.closest('span')?.textContent?.includes('Reference')) as HTMLInputElement;
  await user.click(referenceRadio);

  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
  });

  // Select InterfaceEndpoint
  await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');

  // Check Include Response
  await user.click(screen.getByTestId('field-includeResponse'));

  await waitFor(() => {
    expect(screen.getByTestId('radio-responseContentMode-endpoint_response')).toBeInTheDocument();
  });

  // Select Endpoint Response radio
  await user.click(screen.getByTestId('radio-responseContentMode-endpoint_response'));
}

describe('AddMessageExchangeDrawer - Response Checkbox Group UI (Task Group 2)', () => {
  it('response "What to Show?" checkbox group renders when responseContentMode === endpoint_response', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseMode(user);

    await waitFor(() => {
      expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
    });
  });

  it('response "What to Show?" checkbox group does NOT render when responseContentMode !== endpoint_response', async () => {
    const user = userEvent.setup();
    renderDrawer();

    // Select participants and enable response with label mode (default)
    const fromSelect = screen.getByTestId('field-fromParticipant');
    const toSelect = screen.getByTestId('field-toParticipant');
    await user.selectOptions(fromSelect, 'p1');
    await user.selectOptions(toSelect, 'p2');

    await user.click(screen.getByTestId('field-includeResponse'));

    // responseContentMode defaults to 'label', so no response what-to-show group
    expect(screen.queryByTestId('response-what-to-show-group')).not.toBeInTheDocument();
  });

  it('response checkbox labels are "Name", "Verb and Path", "Response Data"', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseMode(user);

    await waitFor(() => {
      expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
    });

    const group = screen.getByTestId('response-what-to-show-group');
    const labels = within(group).getAllByRole('checkbox').map(cb => cb.closest('label')?.textContent?.trim());

    expect(labels).toEqual(['Name', 'Verb and Path', 'Response Data']);
  });

  it('request third checkbox label reads "Request Data" (not "Request/Response Data")', async () => {
    const user = userEvent.setup();
    renderDrawer();

    // Switch request to Reference/InterfaceEndpoint to show the what-to-show group
    const allRadios = screen.getAllByRole('radio');
    const referenceRadio = allRadios.find(r => r.closest('span')?.textContent?.includes('Reference')) as HTMLInputElement;
    await user.click(referenceRadio);

    await waitFor(() => {
      expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('field-requestRefKind'), 'InterfaceEndpoint');

    await waitFor(() => {
      expect(screen.getByTestId('what-to-show-group')).toBeInTheDocument();
    });

    const requestGroup = screen.getByTestId('what-to-show-group');
    const reqResCheckbox = within(requestGroup).getByTestId('field-showEndpointReqResData');
    const label = reqResCheckbox.closest('label')?.textContent?.trim();

    expect(label).toBe('Request Data');
    expect(label).not.toBe('Request/Response Data');
  });

  it('response checkboxes are wired to responseShowEndpointName, responseShowEndpointVerbPath, responseShowEndpointReqResData', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await setupEndpointResponseMode(user);

    await waitFor(() => {
      expect(screen.getByTestId('response-what-to-show-group')).toBeInTheDocument();
    });

    const nameCheckbox = screen.getByTestId('field-responseShowEndpointName') as HTMLInputElement;
    const verbPathCheckbox = screen.getByTestId('field-responseShowEndpointVerbPath') as HTMLInputElement;
    const reqResDataCheckbox = screen.getByTestId('field-responseShowEndpointReqResData') as HTMLInputElement;

    // Check defaults: false, false, true
    expect(nameCheckbox.checked).toBe(false);
    expect(verbPathCheckbox.checked).toBe(false);
    expect(reqResDataCheckbox.checked).toBe(true);

    // Toggle name on
    await user.click(nameCheckbox);
    expect(nameCheckbox.checked).toBe(true);

    // Toggle reqResData off
    await user.click(reqResDataCheckbox);
    expect(reqResDataCheckbox.checked).toBe(false);
  });
});
