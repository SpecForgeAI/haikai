/**
 * Message Exchange Edit Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 3, Task 3.1: Write 6 focused tests for message exchange edit functionality
 *
 * Tests verify:
 * - Test 1: AddMessageExchangeDrawer displays "Edit Message Exchange" title and "Update" button when editData is provided
 * - Test 2: AddMessageExchangeDrawer pre-populates all form fields from editData request message
 * - Test 3: AddMessageExchangeDrawer pre-populates response fields and sets includeResponse=true when editData contains a response message
 * - Test 4: Submitting in edit mode preserves original message id values (does not generate new IDs)
 * - Test 5: Toggling "Include Response" off during edit of a two-message exchange removes the response message and node
 * - Test 6: Toggling "Include Response" on during edit of a request-only exchange creates new response message and node with generated IDs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMessageExchangeDrawer } from '../AddMessageExchangeDrawer';
import type {
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
} from '../../../../types/sequenceDiagram';
import type { MessageExchangeEditData } from '../AddMessageExchangeDrawer';

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

function createTestParticipants(): SequenceParticipant[] {
  return [
    { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
    { id: 'p2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
  ];
}

function createRequestOnlyEditData(): MessageExchangeEditData {
  const requestMessage: SequenceMessage = {
    id: 'msg-req-1',
    exchange_id: 'exch-1',
    exchange_role: 'Request',
    from_participant_id: 'p1',
    to_participant_id: 'p2',
    label_text: 'getOrders()',
  };
  const requestNode: SequenceNode = {
    id: 'node-req-1',
    node_kind: 'Message',
    message_id: 'msg-req-1',
    order_index: 0,
  };
  return {
    exchangeId: 'exch-1',
    requestMessage,
    requestNode,
  };
}

function createFullExchangeEditData(): MessageExchangeEditData {
  const requestMessage: SequenceMessage = {
    id: 'msg-req-1',
    exchange_id: 'exch-1',
    exchange_role: 'Request',
    from_participant_id: 'p1',
    to_participant_id: 'p2',
    ref_kind: 'Method',
    ref_id: 'method-1',
  };
  const responseMessage: SequenceMessage = {
    id: 'msg-res-1',
    exchange_id: 'exch-1',
    exchange_role: 'Response',
    from_participant_id: 'p2',
    to_participant_id: 'p1',
    label_text: 'Order list',
  };
  const requestNode: SequenceNode = {
    id: 'node-req-1',
    node_kind: 'Message',
    message_id: 'msg-req-1',
    order_index: 0,
  };
  const responseNode: SequenceNode = {
    id: 'node-res-1',
    node_kind: 'Message',
    message_id: 'msg-res-1',
    order_index: 1,
  };
  return {
    exchangeId: 'exch-1',
    requestMessage,
    responseMessage,
    requestNode,
    responseNode,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Message Exchange Edit Mode (Task Group 3)', () => {
  const mockOnSubmit = vi.fn();
  const mockOnUpdate = vi.fn();
  const mockOnClose = vi.fn();
  const participants = createTestParticipants();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Displays "Edit Message Exchange" title and "Update" button when editData is provided
  it('displays "Edit Message Exchange" title and "Update" button when editData is provided', () => {
    const editData = createRequestOnlyEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Check title
    expect(screen.getByText('Edit Message Exchange')).toBeInTheDocument();

    // Check button text
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Update');

    // Should NOT show "Add Message Exchange"
    expect(screen.queryByText('Add Message Exchange')).not.toBeInTheDocument();
  });

  // Test 2: Pre-populates all form fields from editData request message (label_text mode)
  it('pre-populates all form fields from editData request message (fromParticipantId, toParticipantId, requestMode, label text)', () => {
    const editData = createRequestOnlyEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Check from/to participant dropdowns are populated
    const fromSelect = screen.getByTestId('field-fromParticipant') as HTMLSelectElement;
    const toSelect = screen.getByTestId('field-toParticipant') as HTMLSelectElement;
    expect(fromSelect.value).toBe('p1');
    expect(toSelect.value).toBe('p2');

    // Check label text is populated (since editData.requestMessage has label_text)
    const labelInput = screen.getByTestId('field-requestLabelText') as HTMLInputElement;
    expect(labelInput.value).toBe('getOrders()');
  });

  // Test 3: Pre-populates response fields and sets includeResponse=true when editData contains response message
  it('pre-populates response fields and sets includeResponse=true when editData contains a response message', () => {
    const editData = createFullExchangeEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode, editData.responseNode!]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Check includeResponse checkbox is checked
    const includeResponseCheckbox = screen.getByTestId('field-includeResponse') as HTMLInputElement;
    expect(includeResponseCheckbox.checked).toBe(true);

    // Check response label text is populated
    const responseLabelInput = screen.getByTestId('field-responseLabelText') as HTMLInputElement;
    expect(responseLabelInput.value).toBe('Order list');
  });

  // Test 4: Submitting in edit mode preserves original message id values
  it('submitting in edit mode preserves original message id values (does not generate new IDs)', async () => {
    const editData = createFullExchangeEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode, editData.responseNode!]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Submit the form
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    });

    const [messages, nodes] = mockOnUpdate.mock.calls[0];

    // Verify request message preserves original ID
    const requestMsg = messages.find((m: SequenceMessage) => m.exchange_role === 'Request');
    expect(requestMsg).toBeDefined();
    expect(requestMsg.id).toBe('msg-req-1');
    expect(requestMsg.exchange_id).toBe('exch-1');

    // Verify response message preserves original ID
    const responseMsg = messages.find((m: SequenceMessage) => m.exchange_role === 'Response');
    expect(responseMsg).toBeDefined();
    expect(responseMsg.id).toBe('msg-res-1');

    // Verify request node preserves original ID
    const requestNode = nodes.find((n: SequenceNode) => n.message_id === 'msg-req-1');
    expect(requestNode).toBeDefined();
    expect(requestNode.id).toBe('node-req-1');

    // Verify response node preserves original ID
    const responseNode = nodes.find((n: SequenceNode) => n.message_id === 'msg-res-1');
    expect(responseNode).toBeDefined();
    expect(responseNode.id).toBe('node-res-1');

    // onSubmit should NOT be called in edit mode
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  // Test 5: Toggling "Include Response" off during edit of a two-message exchange removes the response
  it('toggling "Include Response" off during edit of a two-message exchange removes the response message and node', async () => {
    const editData = createFullExchangeEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode, editData.responseNode!]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Uncheck "Include Response"
    const includeResponseCheckbox = screen.getByTestId('field-includeResponse') as HTMLInputElement;
    fireEvent.click(includeResponseCheckbox);
    expect(includeResponseCheckbox.checked).toBe(false);

    // Submit the form
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    });

    const [messages, nodes, removedMessageIds, removedNodeIds] = mockOnUpdate.mock.calls[0];

    // Should only have request message (no response)
    expect(messages).toHaveLength(1);
    expect(messages[0].exchange_role).toBe('Request');

    // Should only have request node (no response node)
    expect(nodes).toHaveLength(1);

    // Removed IDs should contain the response message and node IDs
    expect(removedMessageIds).toContain('msg-res-1');
    expect(removedNodeIds).toContain('node-res-1');
  });

  // Test 6: Toggling "Include Response" on during edit of a request-only exchange creates new IDs
  it('toggling "Include Response" on during edit of a request-only exchange creates new response message and node with generated IDs', async () => {
    const editData = createRequestOnlyEditData();

    render(
      <AddMessageExchangeDrawer
        isOpen={true}
        onClose={mockOnClose}
        participants={participants}
        existingNodes={[editData.requestNode]}
        metaModel={null}
        onSubmit={mockOnSubmit}
        editData={editData}
        onUpdate={mockOnUpdate}
      />
    );

    // Check "Include Response"
    const includeResponseCheckbox = screen.getByTestId('field-includeResponse') as HTMLInputElement;
    fireEvent.click(includeResponseCheckbox);
    expect(includeResponseCheckbox.checked).toBe(true);

    // Fill in response label text (required for validation)
    const responseLabelInput = screen.getByTestId('field-responseLabelText') as HTMLInputElement;
    fireEvent.change(responseLabelInput, { target: { value: 'New response' } });

    // Submit the form
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    });

    const [messages, nodes, removedMessageIds, removedNodeIds] = mockOnUpdate.mock.calls[0];

    // Should have 2 messages (request + new response)
    expect(messages).toHaveLength(2);

    // Request message should preserve original ID
    const requestMsg = messages.find((m: SequenceMessage) => m.exchange_role === 'Request');
    expect(requestMsg.id).toBe('msg-req-1');

    // Response message should have a NEW generated ID (not one of the original IDs)
    const responseMsg = messages.find((m: SequenceMessage) => m.exchange_role === 'Response');
    expect(responseMsg).toBeDefined();
    expect(responseMsg.id).not.toBe('msg-req-1');
    expect(responseMsg.id).toContain('msg-'); // Generated IDs start with 'msg-'

    // Should have 2 nodes
    expect(nodes).toHaveLength(2);

    // Response node should have a new generated ID
    const responseNode = nodes.find((n: SequenceNode) => n.message_id === responseMsg.id);
    expect(responseNode).toBeDefined();
    expect(responseNode.id).not.toBe('node-req-1');

    // No removed IDs since there was no existing response
    expect(removedMessageIds).toBeUndefined();
    expect(removedNodeIds).toBeUndefined();
  });
});
