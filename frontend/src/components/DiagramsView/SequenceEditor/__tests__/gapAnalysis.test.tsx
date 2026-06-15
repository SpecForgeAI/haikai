/**
 * Gap Analysis Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 6, Task 6.3: Up to 8 additional strategic tests to fill critical gaps
 *
 * Gap areas covered:
 * - Test 1: Drawer mode switching lifecycle (edit -> add) resets form correctly
 * - Test 2: Participant edit onUpdate only contains participants (no message rewriting)
 * - Test 3: Clicking Edit on a Response node routes to the full exchange (Request + Response)
 * - Test 4: Clicking Edit on a Fragment node populates fragment edit data in FlowTab
 * - Test 5: FlowTab handleUpdateMessageExchange with response removal propagates correctly
 * - Test 6: FlowTab handleUpdateFragment with changed fragment_kind removes old operands
 * - Test 7: DnD reorder followed by edit still targets the correct node
 * - Test 8: Message exchange drawer shows clean Add mode after being used in Edit mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { ParticipantsTab } from '../ParticipantsTab';
import { FlowTab } from '../FlowTab';
import type {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
  SequenceFragment,
  SequenceOperand,
  ParticipantRefKind,
} from '../../../../types/sequenceDiagram';
import type { MetaModel } from '../../../../types/model';

// ============================================================================
// Mocks
// ============================================================================

// Track DndContext and SortableContext props for inspection
let capturedDndContextProps: any = null;
let capturedSortableContextProps: any[] = [];

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => {
  const React = require('react');
  return {
    DndContext: ({ children, sensors, collisionDetection, onDragEnd, ...rest }: any) => {
      capturedDndContextProps = { sensors, collisionDetection, onDragEnd, ...rest };
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children);
    },
    closestCenter: vi.fn(),
    PointerSensor: { name: 'PointerSensor' },
    KeyboardSensor: { name: 'KeyboardSensor' },
    useSensor: (sensor: any, options?: any) => ({ sensor, options }),
    useSensors: (...args: any[]) => args,
  };
});

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => {
  const React = require('react');
  return {
    SortableContext: ({ children, items, strategy, ...rest }: any) => {
      capturedSortableContextProps.push({ items, strategy, ...rest });
      return React.createElement('div', { 'data-testid': 'sortable-context' }, children);
    },
    verticalListSortingStrategy: { name: 'verticalListSortingStrategy' },
    arrayMove: (arr: any[], oldIndex: number, newIndex: number) => {
      const result = [...arr];
      const [removed] = result.splice(oldIndex, 1);
      result.splice(newIndex, 0, removed);
      return result;
    },
    useSortable: ({ id, ...rest }: any) => ({
      attributes: { role: 'button', tabIndex: 0, 'aria-roledescription': 'sortable' },
      listeners: { onPointerDown: vi.fn(), onKeyDown: vi.fn() },
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
      isSorting: false,
      isOver: false,
      active: null,
      activeIndex: -1,
      index: 0,
      newIndex: 0,
      overIndex: -1,
      over: null,
      items: [],
      rect: { current: null },
      node: { current: null },
      data: {},
      setDroppableNodeRef: vi.fn(),
      setDraggableNodeRef: vi.fn(),
    }),
  };
});

// Mock @dnd-kit/utilities
vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: (transform: any) => transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    },
    Translate: {
      toString: (transform: any) => transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    },
  },
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  ChevronUp: (props: any) => <svg data-testid="icon-chevron-up" {...props} />,
  ChevronDown: (props: any) => <svg data-testid="icon-chevron-down" {...props} />,
  Pencil: (props: any) => <svg data-testid="icon-pencil" {...props} />,
  X: (props: any) => <svg data-testid="icon-x" {...props} />,
  GripVertical: (props: any) => <svg data-testid="icon-grip-vertical" {...props} />,
}));

// ============================================================================
// Test Data Factories
// ============================================================================

function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'App One', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-2', name: 'App Two', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', name: 'Service One', description: '', tags: '' },
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

function createParticipant(id: string, orderIndex: number, refKind: ParticipantRefKind = 'Application', refId?: string): SequenceParticipant {
  return {
    id,
    ref_kind: refKind,
    ref_id: refId || `app-${orderIndex + 1}`,
    order_index: orderIndex,
  };
}

/**
 * Creates a full diagram with 2 participants, a request+response exchange, and a Loop fragment
 */
function createFullDiagram(): SequenceDiagram {
  return {
    id: 'seq-1',
    model_file_id: 'model-1',
    name: 'Test Sequence',
    type: 'Sequence',
    participants: [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ],
    messages: [
      {
        id: 'msg-req-1',
        exchange_id: 'exch-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'getOrders()',
      },
      {
        id: 'msg-res-1',
        exchange_id: 'exch-1',
        exchange_role: 'Response',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        label_text: 'Order list',
      },
      {
        id: 'msg-2',
        exchange_id: 'exch-2',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'processOrder()',
      },
    ],
    fragments: [
      {
        id: 'frag-1',
        fragment_kind: 'Loop',
        label_text: 'Retry Logic',
      },
    ],
    operands: [
      {
        id: 'op-1',
        fragment_id: 'frag-1',
        guard_expression: 'retries < 3',
        operand_index: 0,
      },
    ],
    sequence_nodes: [
      {
        id: 'node-req-1',
        node_kind: 'Message',
        message_id: 'msg-req-1',
        order_index: 0,
      },
      {
        id: 'node-res-1',
        node_kind: 'Message',
        message_id: 'msg-res-1',
        order_index: 1,
      },
      {
        id: 'node-2',
        node_kind: 'Message',
        message_id: 'msg-2',
        order_index: 2,
      },
      {
        id: 'node-frag-1',
        node_kind: 'Fragment',
        fragment_id: 'frag-1',
        order_index: 3,
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Gap Analysis Tests (Task Group 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDndContextProps = null;
    capturedSortableContextProps = [];
  });

  // Test 1: Drawer mode switching lifecycle (edit -> add) resets form correctly
  it('ParticipantsTab drawer resets to empty fields when switching from edit mode to add mode', async () => {
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const diagram: SequenceDiagram = {
      id: 'seq-1',
      model_file_id: 'model-1',
      name: 'Test',
      type: 'Sequence',
      participants,
      messages: [],
      fragments: [],
      operands: [],
      sequence_nodes: [],
    };
    const metaModel = createTestMetaModel();
    const onUpdate = vi.fn();

    render(
      <ParticipantsTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={metaModel}
      />
    );

    // Step 1: Click edit on p1 to open drawer in edit mode
    fireEvent.click(screen.getByTestId('edit-p1'));
    await waitFor(() => {
      // Use heading role to specifically target the drawer title <h2>
      expect(screen.getByRole('heading', { name: 'Edit Participant' })).toBeInTheDocument();
    });

    // Verify edit mode has pre-populated data
    const refKindInEdit = screen.getByTestId('field-refKind') as HTMLSelectElement;
    expect(refKindInEdit.value).toBe('Application');

    // Step 2: Cancel/close the edit drawer
    fireEvent.click(screen.getByTestId('drawer-cancel-button'));

    // Step 3: Open drawer in Add mode
    fireEvent.click(screen.getByTestId('add-participant-button'));
    await waitFor(() => {
      // Use heading role to specifically target the drawer title <h2>
      expect(screen.getByRole('heading', { name: 'Add Participant' })).toBeInTheDocument();
    });

    // Verify add mode has empty/default fields
    const refKindInAdd = screen.getByTestId('field-refKind') as HTMLSelectElement;
    expect(refKindInAdd.value).toBe('');

    // Verify submit button says "Add Participant"
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Add Participant');
  });

  // Test 2: Participant edit onUpdate only contains participants (no message rewriting)
  it('editing a participant calls onUpdate with only participants key, not messages or sequence_nodes', async () => {
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const diagram: SequenceDiagram = {
      id: 'seq-1',
      model_file_id: 'model-1',
      name: 'Test',
      type: 'Sequence',
      participants,
      messages: [
        {
          id: 'msg-1',
          exchange_id: 'exch-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          label_text: 'test()',
        },
      ],
      fragments: [],
      operands: [],
      sequence_nodes: [
        { id: 'node-1', node_kind: 'Message', message_id: 'msg-1', order_index: 0 },
      ],
    };
    const metaModel = createTestMetaModel();
    const onUpdate = vi.fn();

    render(
      <ParticipantsTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={metaModel}
      />
    );

    // Click edit on p1
    fireEvent.click(screen.getByTestId('edit-p1'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Participant' })).toBeInTheDocument();
    });

    // Change ref_kind to Service
    const refKindSelect = screen.getByTestId('field-refKind') as HTMLSelectElement;
    fireEvent.change(refKindSelect, { target: { value: 'Service' } });

    // Select a service ref
    await waitFor(() => {
      const refIdSelect = screen.getByTestId('field-refId') as HTMLSelectElement;
      expect(refIdSelect).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('field-refId'), { target: { value: 'svc-1' } });

    // Submit
    fireEvent.click(screen.getByTestId('drawer-submit-button'));

    // Verify onUpdate was called
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = onUpdate.mock.calls[0][0];

    // Should contain only 'participants' key -- no messages or sequence_nodes rewriting
    expect(updatePayload).toHaveProperty('participants');
    expect(updatePayload).not.toHaveProperty('messages');
    expect(updatePayload).not.toHaveProperty('sequence_nodes');
    expect(updatePayload).not.toHaveProperty('fragments');
    expect(updatePayload).not.toHaveProperty('operands');
  });

  // Test 3: Clicking Edit on a Response node opens the full exchange (routes via exchange_id)
  it('clicking Edit on a Response node opens the message exchange drawer with the full exchange', async () => {
    const diagram = createFullDiagram();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Click edit on the Response node (node-res-1)
    const editResponseButton = screen.getByTestId('edit-node-res-1');
    fireEvent.click(editResponseButton);

    // Verify the message exchange drawer opens in edit mode
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Message Exchange' })).toBeInTheDocument();
    });

    // Verify both request and response fields are populated (full exchange)
    const fromSelect = screen.getByTestId('field-fromParticipant') as HTMLSelectElement;
    const toSelect = screen.getByTestId('field-toParticipant') as HTMLSelectElement;
    expect(fromSelect.value).toBe('p1'); // Request's from_participant_id
    expect(toSelect.value).toBe('p2');   // Request's to_participant_id

    // Verify include response is checked (response message exists)
    const includeResponseCheckbox = screen.getByTestId('field-includeResponse') as HTMLInputElement;
    expect(includeResponseCheckbox.checked).toBe(true);

    // Verify response label text is populated
    const responseLabelInput = screen.getByTestId('field-responseLabelText') as HTMLInputElement;
    expect(responseLabelInput.value).toBe('Order list');
  });

  // Test 4: Clicking Edit on a Fragment node populates the fragment drawer
  it('clicking Edit on a Fragment node opens the fragment drawer with pre-populated data', async () => {
    const diagram = createFullDiagram();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Click edit on the fragment node (node-frag-1)
    const editFragmentButton = screen.getByTestId('edit-node-frag-1');
    fireEvent.click(editFragmentButton);

    // Verify the fragment drawer opens in edit mode
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Fragment' })).toBeInTheDocument();
    });

    // Verify fragment_kind is pre-populated
    const kindSelect = screen.getByTestId('field-fragmentKind') as HTMLSelectElement;
    expect(kindSelect.value).toBe('Loop');

    // Verify label_text is pre-populated
    const labelInput = screen.getByTestId('field-labelText') as HTMLInputElement;
    expect(labelInput.value).toBe('Retry Logic');

    // Verify operand guard expression is pre-populated
    const operand0 = screen.getByTestId('field-operand-0') as HTMLInputElement;
    expect(operand0.value).toBe('retries < 3');

    // Verify submit button says "Update"
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Update');
  });

  // Test 5: FlowTab handleUpdateMessageExchange removes response message and node when toggled off
  it('FlowTab correctly removes response message and node when Include Response is toggled off during edit', async () => {
    const diagram = createFullDiagram();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Click edit on the Request node (node-req-1)
    fireEvent.click(screen.getByTestId('edit-node-req-1'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Message Exchange' })).toBeInTheDocument();
    });

    // Toggle off "Include Response"
    const includeResponseCheckbox = screen.getByTestId('field-includeResponse') as HTMLInputElement;
    expect(includeResponseCheckbox.checked).toBe(true);
    fireEvent.click(includeResponseCheckbox);
    expect(includeResponseCheckbox.checked).toBe(false);

    // Submit the form
    fireEvent.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    const updatePayload = onUpdate.mock.calls[0][0];

    // Verify the response message (msg-res-1) is removed from messages
    const remainingMessages = updatePayload.messages;
    const removedResponseMsg = remainingMessages.find((m: SequenceMessage) => m.id === 'msg-res-1');
    expect(removedResponseMsg).toBeUndefined();

    // Verify the response node (node-res-1) is removed from sequence_nodes
    const remainingNodes = updatePayload.sequence_nodes;
    const removedResponseNode = remainingNodes.find((n: SequenceNode) => n.id === 'node-res-1');
    expect(removedResponseNode).toBeUndefined();

    // Verify the request message is still present
    const requestMsg = remainingMessages.find((m: SequenceMessage) => m.id === 'msg-req-1');
    expect(requestMsg).toBeDefined();
    expect(requestMsg.exchange_role).toBe('Request');

    // Verify other messages (msg-2) are unaffected
    const otherMsg = remainingMessages.find((m: SequenceMessage) => m.id === 'msg-2');
    expect(otherMsg).toBeDefined();
  });

  // Test 6: FlowTab handleUpdateFragment with changed fragment_kind removes old operands and creates new ones
  it('FlowTab correctly removes old operands and creates new ones when fragment_kind changes during edit', async () => {
    const diagram = createFullDiagram();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Click edit on the fragment node (node-frag-1)
    fireEvent.click(screen.getByTestId('edit-node-frag-1'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Fragment' })).toBeInTheDocument();
    });

    // Change fragment_kind from Loop to Alternative
    const kindSelect = screen.getByTestId('field-fragmentKind');
    fireEvent.change(kindSelect, { target: { value: 'Alternative' } });

    // Wait for operand reset to Alternative defaults (2 operands)
    await waitFor(() => {
      expect(screen.getByTestId('field-operand-0')).toBeInTheDocument();
      expect(screen.getByTestId('field-operand-1')).toBeInTheDocument();
    });

    // Fill in guard expressions for the new operands
    fireEvent.change(screen.getByTestId('field-operand-0'), { target: { value: 'status == OK' } });
    fireEvent.change(screen.getByTestId('field-operand-1'), { target: { value: 'else' } });

    // Submit the form
    fireEvent.click(screen.getByTestId('drawer-submit-button'));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    const updatePayload = onUpdate.mock.calls[0][0];

    // Verify the old operand (op-1) is removed from operands
    const oldOperand = updatePayload.operands.find((o: SequenceOperand) => o.id === 'op-1');
    expect(oldOperand).toBeUndefined();

    // Verify new operands exist with fragment_id = frag-1
    const newOperands = updatePayload.operands.filter((o: SequenceOperand) => o.fragment_id === 'frag-1');
    expect(newOperands.length).toBe(2);
    expect(newOperands[0].id).not.toBe('op-1');
    expect(newOperands[1].id).not.toBe('op-1');

    // Verify fragment is updated to Alternative
    const updatedFragment = updatePayload.fragments.find((f: SequenceFragment) => f.id === 'frag-1');
    expect(updatedFragment).toBeDefined();
    expect(updatedFragment.fragment_kind).toBe('Alternative');
  });

  // Test 7: DnD reorder followed by edit targets the correct node
  it('after DnD reorder, clicking edit on a node still targets the correct item', async () => {
    // Create a diagram with 3 message nodes for reordering
    const diagram: SequenceDiagram = {
      id: 'seq-1',
      model_file_id: 'model-1',
      name: 'Test',
      type: 'Sequence',
      participants: [
        createParticipant('p1', 0, 'Application', 'app-1'),
        createParticipant('p2', 1, 'Application', 'app-2'),
      ],
      messages: [
        { id: 'msg-a', exchange_id: 'exch-a', exchange_role: 'Request' as const, from_participant_id: 'p1', to_participant_id: 'p2', label_text: 'Alpha' },
        { id: 'msg-b', exchange_id: 'exch-b', exchange_role: 'Request' as const, from_participant_id: 'p2', to_participant_id: 'p1', label_text: 'Beta' },
        { id: 'msg-c', exchange_id: 'exch-c', exchange_role: 'Request' as const, from_participant_id: 'p1', to_participant_id: 'p2', label_text: 'Gamma' },
      ],
      fragments: [],
      operands: [],
      sequence_nodes: [
        { id: 'node-a', node_kind: 'Message', message_id: 'msg-a', order_index: 0 },
        { id: 'node-b', node_kind: 'Message', message_id: 'msg-b', order_index: 1 },
        { id: 'node-c', node_kind: 'Message', message_id: 'msg-c', order_index: 2 },
      ],
    };

    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Simulate DnD: move node-a (index 0) to position of node-c (index 2)
    act(() => {
      capturedDndContextProps.onDragEnd({
        active: { id: 'node-a' },
        over: { id: 'node-c' },
      });
    });

    // Verify reorder happened
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const reorderUpdate = onUpdate.mock.calls[0][0];
    const reorderedNodeA = reorderUpdate.sequence_nodes.find((n: SequenceNode) => n.id === 'node-a');
    expect(reorderedNodeA.order_index).toBe(2); // moved to end

    // Reset the mock for the edit test
    onUpdate.mockClear();

    // Now click edit on node-b (which should still be node-b regardless of reorder)
    const editBButton = screen.getByTestId('edit-node-b');
    fireEvent.click(editBButton);

    // Verify the correct exchange is opened in edit mode
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Message Exchange' })).toBeInTheDocument();
    });

    // The exchange being edited should be for msg-b (label: "Beta")
    const labelInput = screen.getByTestId('field-requestLabelText') as HTMLInputElement;
    expect(labelInput.value).toBe('Beta');
  });

  // Test 8: Message exchange drawer shows clean Add mode after being used in Edit mode
  it('message exchange drawer resets to clean Add mode after being used in Edit mode', async () => {
    const diagram = createFullDiagram();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Step 1: Open drawer in edit mode by clicking edit on node-req-1
    fireEvent.click(screen.getByTestId('edit-node-req-1'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Message Exchange' })).toBeInTheDocument();
    });

    // Verify edit mode has pre-populated data
    const labelInEdit = screen.getByTestId('field-requestLabelText') as HTMLInputElement;
    expect(labelInEdit.value).toBe('getOrders()');

    // Step 2: Cancel the edit drawer
    fireEvent.click(screen.getByTestId('drawer-cancel-button'));

    // Step 3: Open drawer in Add mode
    fireEvent.click(screen.getByTestId('add-message-exchange-button'));
    await waitFor(() => {
      // Use heading role to specifically target the drawer title <h2>
      expect(screen.getByRole('heading', { name: 'Add Message Exchange' })).toBeInTheDocument();
    });

    // Verify add mode has empty fields (not stale edit data)
    const fromSelectInAdd = screen.getByTestId('field-fromParticipant') as HTMLSelectElement;
    expect(fromSelectInAdd.value).toBe('');

    const toSelectInAdd = screen.getByTestId('field-toParticipant') as HTMLSelectElement;
    expect(toSelectInAdd.value).toBe('');

    // Verify submit button says "Add Message Exchange"
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Add Message Exchange');
  });
});
