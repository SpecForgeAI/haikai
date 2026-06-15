/**
 * AddMessageExchangeDrawer.isCollection.test.tsx
 * Task Group 3: Tests for "Is Collection?" checkbox behavior in AddMessageExchangeDrawer
 *
 * Tests the collection flag support including:
 * - Checkbox visibility based on mode and refKind
 * - Reset behavior when refKind changes to non-entity type
 * - Submission behavior including is_collection in message data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddMessageExchangeDrawer, AddMessageExchangeDrawerProps } from '../components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer';
import { SequenceParticipant, SequenceMessage, SequenceNode } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

/**
 * Helper function to create a minimal MetaModel for testing
 */
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
    endpoints: [],
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

/**
 * Helper to create test participants
 */
function createTestParticipants(): SequenceParticipant[] {
  return [
    { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
    { id: 'p2', ref_kind: 'Application', ref_id: 'app-2', order_index: 1 },
  ];
}

/**
 * Default props for rendering the drawer
 */
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

/**
 * Helper to switch to reference mode by clicking the Reference radio button
 */
async function switchToReferenceMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // Find the Reference radio by looking for the radio whose parent span contains "Reference"
  const allRadios = screen.getAllByRole('radio');
  const referenceRadio = allRadios.find(radio => {
    const parent = radio.closest('span');
    return parent?.textContent?.includes('Reference');
  }) as HTMLInputElement;

  if (referenceRadio) {
    await user.click(referenceRadio);
  } else {
    // Fallback: click the second radio button (assuming order is Label, Reference)
    await user.click(allRadios[1]);
  }

  // Wait for the mode switch to take effect and the refKind dropdown to appear
  await waitFor(() => {
    expect(screen.getByTestId('field-requestRefKind')).toBeInTheDocument();
  });
}

describe('AddMessageExchangeDrawer - Is Collection Support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Checkbox Visibility', () => {
    it('shows request Is Collection checkbox when mode=reference and refKind=PhysicalEntity', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select PhysicalEntity as ref kind
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'PhysicalEntity');

      // Now the checkbox should be visible
      await waitFor(() => {
        expect(screen.getByTestId('field-requestIsCollection')).toBeInTheDocument();
      });
    });

    it('shows request Is Collection checkbox when mode=reference and refKind=LogicalEntity', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select LogicalEntity as ref kind
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'LogicalEntity');

      // Now the checkbox should be visible
      await waitFor(() => {
        expect(screen.getByTestId('field-requestIsCollection')).toBeInTheDocument();
      });
    });

    it('hides request Is Collection checkbox when mode=label', () => {
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      // Default mode is 'label', so checkbox should not be visible
      expect(screen.queryByTestId('field-requestIsCollection')).toBeNull();
    });

    it('hides request Is Collection checkbox when refKind=Method', async () => {
      const user = userEvent.setup();
      render(<AddMessageExchangeDrawer {...createDefaultProps()} />);

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select Method as ref kind
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'Method');

      // Checkbox should NOT be visible for Method
      await waitFor(() => {
        expect(screen.queryByTestId('field-requestIsCollection')).toBeNull();
      });
    });
  });

  describe('Reset Behavior', () => {
    it('resets requestIsCollection to false when requestRefKind changes from LogicalEntity to Method', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<AddMessageExchangeDrawer {...createDefaultProps({ onSubmit })} />);

      // Set up participants
      const fromSelect = screen.getByTestId('field-fromParticipant');
      await user.selectOptions(fromSelect, 'p1');

      const toSelect = screen.getByTestId('field-toParticipant');
      await user.selectOptions(toSelect, 'p2');

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select LogicalEntity
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'LogicalEntity');

      // Wait for checkbox to appear and check it
      await waitFor(() => {
        expect(screen.getByTestId('field-requestIsCollection')).toBeInTheDocument();
      });

      const checkbox = screen.getByTestId('field-requestIsCollection') as HTMLInputElement;
      await user.click(checkbox);
      expect(checkbox.checked).toBe(true);

      // Now change to Method
      await user.selectOptions(refKindSelect, 'Method');

      // Checkbox should be hidden
      await waitFor(() => {
        expect(screen.queryByTestId('field-requestIsCollection')).toBeNull();
      });

      // Change back to PhysicalEntity
      await user.selectOptions(refKindSelect, 'PhysicalEntity');

      // Checkbox should appear but be unchecked (reset to false)
      await waitFor(() => {
        const newCheckbox = screen.getByTestId('field-requestIsCollection') as HTMLInputElement;
        expect(newCheckbox.checked).toBe(false);
      });
    });
  });

  describe('Submit Behavior', () => {
    it('includes is_collection=true on request message when checkbox is checked', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<AddMessageExchangeDrawer {...createDefaultProps({ onSubmit })} />);

      // Set up participants
      const fromSelect = screen.getByTestId('field-fromParticipant');
      await user.selectOptions(fromSelect, 'p1');

      const toSelect = screen.getByTestId('field-toParticipant');
      await user.selectOptions(toSelect, 'p2');

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select PhysicalEntity
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'PhysicalEntity');

      // Wait for ref id select and select a value
      await waitFor(() => {
        expect(screen.getByTestId('field-requestRefId')).toBeInTheDocument();
      });

      const refIdSelect = screen.getByTestId('field-requestRefId');
      await user.selectOptions(refIdSelect, 'physical-1');

      // Check the Is Collection checkbox
      await waitFor(() => {
        expect(screen.getByTestId('field-requestIsCollection')).toBeInTheDocument();
      });

      const checkbox = screen.getByTestId('field-requestIsCollection') as HTMLInputElement;
      await user.click(checkbox);
      expect(checkbox.checked).toBe(true);

      // Submit the form
      const submitButton = screen.getByTestId('drawer-submit-button');
      await user.click(submitButton);

      // Wait for submission
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      // Check the submitted message has is_collection=true
      const [messages] = onSubmit.mock.calls[0] as [SequenceMessage[], SequenceNode[]];
      const requestMessage = messages.find(m => m.exchange_role === 'Request');
      expect(requestMessage?.is_collection).toBe(true);
    });

    it('omits is_collection field when checkbox is unchecked', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<AddMessageExchangeDrawer {...createDefaultProps({ onSubmit })} />);

      // Set up participants
      const fromSelect = screen.getByTestId('field-fromParticipant');
      await user.selectOptions(fromSelect, 'p1');

      const toSelect = screen.getByTestId('field-toParticipant');
      await user.selectOptions(toSelect, 'p2');

      // Switch to reference mode
      await switchToReferenceMode(user);

      // Select PhysicalEntity
      const refKindSelect = screen.getByTestId('field-requestRefKind');
      await user.selectOptions(refKindSelect, 'PhysicalEntity');

      // Wait for ref id select and select a value
      await waitFor(() => {
        expect(screen.getByTestId('field-requestRefId')).toBeInTheDocument();
      });

      const refIdSelect = screen.getByTestId('field-requestRefId');
      await user.selectOptions(refIdSelect, 'physical-1');

      // Do NOT check the Is Collection checkbox (leave it unchecked)

      // Submit the form
      const submitButton = screen.getByTestId('drawer-submit-button');
      await user.click(submitButton);

      // Wait for submission
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      // Check the submitted message does NOT have is_collection
      const [messages] = onSubmit.mock.calls[0] as [SequenceMessage[], SequenceNode[]];
      const requestMessage = messages.find(m => m.exchange_role === 'Request');
      expect(requestMessage?.is_collection).toBeUndefined();
    });
  });
});
