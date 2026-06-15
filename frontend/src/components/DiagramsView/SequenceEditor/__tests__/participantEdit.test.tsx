/**
 * Participant Edit Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 2, Task 2.1: Write 4 focused tests for participant edit functionality
 *
 * Tests verify:
 * - Test 1: AddParticipantDrawer displays "Edit Participant" title and "Update" button text when editData prop is provided
 * - Test 2: AddParticipantDrawer pre-populates refKind and refId fields from editData on open
 * - Test 3: AddParticipantDrawer calls onUpdate (not onSubmit) with (participantId, refKind, refId) when submitted in edit mode
 * - Test 4: ParticipantsTab update handler replaces the matching participant's ref_kind and ref_id in place while preserving id and order_index
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { AddParticipantDrawer } from '../AddParticipantDrawer';
import { ParticipantsTab } from '../ParticipantsTab';
import type { SequenceDiagram, SequenceParticipant, ParticipantRefKind } from '../../../../types/sequenceDiagram';
import type { MetaModel } from '../../../../types/model';

// ============================================================================
// Mocks
// ============================================================================

// Mock lucide-react to render identifiable elements
vi.mock('lucide-react', () => ({
  ChevronUp: (props: any) => <svg data-testid="icon-chevron-up" {...props} />,
  ChevronDown: (props: any) => <svg data-testid="icon-chevron-down" {...props} />,
  Pencil: (props: any) => <svg data-testid="icon-pencil" {...props} />,
  X: (props: any) => <svg data-testid="icon-x" {...props} />,
  GripVertical: (props: any) => <svg data-testid="icon-grip-vertical" {...props} />,
}));

// ============================================================================
// Test Data
// ============================================================================

function createTestParticipant(id: string, orderIndex: number, refKind: ParticipantRefKind = 'Application', refId: string = `app-${id}`): SequenceParticipant {
  return {
    id,
    ref_kind: refKind,
    ref_id: refId,
    order_index: orderIndex,
  };
}

function createTestSequenceDiagram(participants: SequenceParticipant[]): SequenceDiagram {
  return {
    id: 'seq-1',
    model_file_id: 'model-1',
    name: 'Test Sequence',
    type: 'Sequence',
    participants,
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };
}

function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-p1', name: 'App One', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-p2', name: 'App Two', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', name: 'Service One', description: '', tags: '' },
        { id: 'svc-2', name: 'Service Two', description: '', tags: '' },
      ],
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
    },
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
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Participant Edit (Task Group 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: AddParticipantDrawer displays "Edit Participant" title and "Update" button text when editData prop is provided
  it('AddParticipantDrawer displays "Edit Participant" title and "Update" button text when editData prop is provided', () => {
    const editData = {
      participantId: 'p1',
      refKind: 'Application' as ParticipantRefKind,
      refId: 'app-p1',
    };

    render(
      <AddParticipantDrawer
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        metaModel={createTestMetaModel()}
        editData={editData}
        onUpdate={vi.fn()}
      />
    );

    // Verify title is "Edit Participant"
    expect(screen.getByText('Edit Participant')).toBeInTheDocument();

    // Verify submit button text is "Update"
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Update');
  });

  // Test 2: AddParticipantDrawer pre-populates refKind and refId fields from editData on open
  it('AddParticipantDrawer pre-populates refKind and refId fields from editData on open', () => {
    const editData = {
      participantId: 'p1',
      refKind: 'Application' as ParticipantRefKind,
      refId: 'app-p1',
    };

    render(
      <AddParticipantDrawer
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        metaModel={createTestMetaModel()}
        editData={editData}
        onUpdate={vi.fn()}
      />
    );

    // Verify refKind is pre-populated
    const refKindSelect = screen.getByTestId('field-refKind') as HTMLSelectElement;
    expect(refKindSelect.value).toBe('Application');

    // Verify refId is pre-populated
    const refIdSelect = screen.getByTestId('field-refId') as HTMLSelectElement;
    expect(refIdSelect.value).toBe('app-p1');
  });

  // Test 3: AddParticipantDrawer calls onUpdate (not onSubmit) with (participantId, refKind, refId) when submitted in edit mode
  it('AddParticipantDrawer calls onUpdate (not onSubmit) with (participantId, refKind, refId) when submitted in edit mode', () => {
    const onSubmit = vi.fn();
    const onUpdate = vi.fn();
    const editData = {
      participantId: 'p1',
      refKind: 'Application' as ParticipantRefKind,
      refId: 'app-p1',
    };

    render(
      <AddParticipantDrawer
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        metaModel={createTestMetaModel()}
        editData={editData}
        onUpdate={onUpdate}
      />
    );

    // Click the submit button
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    // Verify onUpdate was called with the correct args
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('p1', 'Application', 'app-p1');

    // Verify onSubmit was NOT called
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Test 4: ParticipantsTab update handler replaces the matching participant's ref_kind and ref_id in place while preserving id and order_index
  it('ParticipantsTab update handler replaces the matching participant ref_kind and ref_id in place while preserving id and order_index', async () => {
    const participants = [
      createTestParticipant('p1', 0, 'Application', 'app-p1'),
      createTestParticipant('p2', 1, 'Application', 'app-p2'),
    ];
    const diagram = createTestSequenceDiagram(participants);
    const metaModel = createTestMetaModel();
    const onUpdate = vi.fn();

    render(
      <ParticipantsTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={metaModel}
      />
    );

    // Click the edit button for participant p1
    const editButton = screen.getByTestId('edit-p1');
    fireEvent.click(editButton);

    // Wait for the drawer to open and verify it shows "Edit Participant"
    await waitFor(() => {
      expect(screen.getByText('Edit Participant')).toBeInTheDocument();
    });

    // Change the refKind to 'Service'
    const refKindSelect = screen.getByTestId('field-refKind') as HTMLSelectElement;
    fireEvent.change(refKindSelect, { target: { value: 'Service' } });

    // Wait for refId options to update, then select a service
    await waitFor(() => {
      const refIdSelect = screen.getByTestId('field-refId') as HTMLSelectElement;
      expect(refIdSelect).toBeInTheDocument();
    });

    const refIdSelect = screen.getByTestId('field-refId') as HTMLSelectElement;
    fireEvent.change(refIdSelect, { target: { value: 'svc-1' } });

    // Click the Update button
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    // Verify onUpdate was called with updated participants
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updatedParticipants = onUpdate.mock.calls[0][0].participants;

    // Find the updated participant p1
    const updatedP1 = updatedParticipants.find((p: SequenceParticipant) => p.id === 'p1');
    expect(updatedP1).toBeDefined();
    expect(updatedP1.id).toBe('p1'); // id preserved
    expect(updatedP1.order_index).toBe(0); // order_index preserved
    expect(updatedP1.ref_kind).toBe('Service'); // ref_kind updated
    expect(updatedP1.ref_id).toBe('svc-1'); // ref_id updated

    // Verify the other participant is unchanged
    const unchangedP2 = updatedParticipants.find((p: SequenceParticipant) => p.id === 'p2');
    expect(unchangedP2).toBeDefined();
    expect(unchangedP2.ref_kind).toBe('Application');
    expect(unchangedP2.ref_id).toBe('app-p2');
  });
});
