/**
 * Icon Replacement and Edit Button Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 1, Task 1.1: Write 4 focused tests for icon replacement and edit button rendering
 *
 * Tests verify (updated 2026-06-12: the move up/down chevron buttons were
 * replaced by drag-reorder via the GripVertical handle; rows now render
 * [Edit] [Delete] action buttons only):
 * - Test 1: ParticipantRow renders Pencil and X lucide-react icons (no unicode)
 * - Test 2: SequenceNodeRow (message node) renders icons in order [Edit] [Delete]
 * - Test 3: SequenceNodeRow (fragment node) renders Edit alongside Delete + drag handle
 * - Test 4: ParticipantRow renders GripVertical lucide-react icon for the drag handle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ParticipantsTab } from '../ParticipantsTab';
import { SequenceNodeRow } from '../SequenceNodeRow';
import type { SequenceDiagram, SequenceParticipant } from '../../../../types/sequenceDiagram';
import type { TreeNode } from '../FlowTab';

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

vi.mock('../../../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// ============================================================================
// Test Data
// ============================================================================

function createTestParticipant(id: string, orderIndex: number): SequenceParticipant {
  return {
    id,
    ref_kind: 'Application',
    ref_id: `app-${id}`,
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
    messages: [
      {
        id: 'msg-1',
        exchange_id: 'exch-1',
        exchange_role: 'Request',
        from_participant_id: participants[0]?.id || 'p1',
        to_participant_id: participants[1]?.id || 'p2',
        label_text: 'Test Message',
      },
    ],
    fragments: [
      {
        id: 'frag-1',
        fragment_kind: 'Loop',
        label_text: 'Retry Loop',
      },
    ],
    operands: [
      {
        id: 'op-1',
        fragment_id: 'frag-1',
        guard_expression: 'condition',
        operand_index: 0,
      },
    ],
    sequence_nodes: [
      {
        id: 'node-msg-1',
        node_kind: 'Message',
        message_id: 'msg-1',
        order_index: 0,
      },
      {
        id: 'node-frag-1',
        node_kind: 'Fragment',
        fragment_id: 'frag-1',
        order_index: 1,
      },
    ],
  };
}

function createMessageTreeNode(diagram: SequenceDiagram): TreeNode {
  return {
    node: diagram.sequence_nodes[0], // message node
    children: [],
    depth: 0,
  };
}

function createFragmentTreeNode(diagram: SequenceDiagram): TreeNode {
  return {
    node: diagram.sequence_nodes[1], // fragment node
    children: [],
    depth: 0,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Icon Replacement and Edit Button (Task Group 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: ParticipantRow renders Pencil and X lucide-react icons
  it('ParticipantRow renders Pencil and X lucide-react icons instead of unicode characters', () => {
    const participants = [
      createTestParticipant('p1', 0),
      createTestParticipant('p2', 1),
    ];
    const diagram = createTestSequenceDiagram(participants);

    render(
      <ParticipantsTab
        sequenceDiagram={diagram}
        onUpdate={vi.fn()}
        metaModel={null}
      />
    );

    // Find the first participant row
    const row = screen.getByTestId('participant-row-p1');

    // Verify lucide-react icons are rendered (not unicode characters).
    // Move up/down chevrons were replaced by the drag-reorder handle.
    const pencil = within(row).getByTestId('icon-pencil');
    const xIcon = within(row).getByTestId('icon-x');

    expect(pencil).toBeInTheDocument();
    expect(xIcon).toBeInTheDocument();

    // Verify no unicode characters remain (common unicode for arrows and close)
    expect(row.innerHTML).not.toContain('\u25B2'); // up triangle
    expect(row.innerHTML).not.toContain('\u25BC'); // down triangle
    expect(row.innerHTML).not.toContain('\u2715'); // X mark
  });

  // Test 2: SequenceNodeRow (message node) renders icons in correct left-to-right order
  it('SequenceNodeRow (message node) renders Pencil and X icons in correct order: [Edit] [Delete]', () => {
    const participants = [
      createTestParticipant('p1', 0),
      createTestParticipant('p2', 1),
    ];
    const diagram = createTestSequenceDiagram(participants);
    const treeNode = createMessageTreeNode(diagram);

    render(
      <SequenceNodeRow
        treeNode={treeNode}
        sequenceDiagram={diagram}
        metaModel={null}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
        onAddInside={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const row = screen.getByTestId('sequence-node-node-msg-1');

    // Find all buttons within the actions area
    const buttons = within(row).getAllByRole('button');

    // Verify order: [Edit] [Delete] (reorder is via the drag handle span,
    // which is not a button)
    // Edit button contains Pencil icon
    expect(within(buttons[0]).getByTestId('icon-pencil')).toBeInTheDocument();
    // Delete button contains X icon
    expect(within(buttons[1]).getByTestId('icon-x')).toBeInTheDocument();
    // Drag handle renders the GripVertical icon
    expect(within(row).getByTestId('icon-grip-vertical')).toBeInTheDocument();
  });

  // Test 3: SequenceNodeRow (fragment node) renders the Edit button alongside existing move and delete buttons
  it('SequenceNodeRow (fragment node) renders the Edit button alongside existing move and delete buttons', () => {
    const participants = [
      createTestParticipant('p1', 0),
      createTestParticipant('p2', 1),
    ];
    const diagram = createTestSequenceDiagram(participants);
    const treeNode = createFragmentTreeNode(diagram);

    render(
      <SequenceNodeRow
        treeNode={treeNode}
        sequenceDiagram={diagram}
        metaModel={null}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
        onAddInside={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const row = screen.getByTestId('sequence-node-node-frag-1');

    // Verify the action icons present on the fragment row: Edit + Delete,
    // plus the drag handle (chevron move buttons were removed).
    expect(within(row).getByTestId('icon-pencil')).toBeInTheDocument();
    expect(within(row).getByTestId('icon-x')).toBeInTheDocument();
    expect(within(row).getByTestId('icon-grip-vertical')).toBeInTheDocument();

    // Verify buttons / handle via data-testid attributes
    expect(within(row).getByTestId('drag-handle-node-frag-1')).toBeInTheDocument();
    expect(within(row).getByTestId('edit-node-frag-1')).toBeInTheDocument();
    expect(within(row).getByTestId('delete-node-frag-1')).toBeInTheDocument();
  });

  // Test 4: ParticipantRow renders GripVertical lucide-react icon for the decorative drag handle
  it('ParticipantRow renders GripVertical lucide-react icon instead of unicode for the decorative drag handle', () => {
    const participants = [
      createTestParticipant('p1', 0),
    ];
    const diagram = createTestSequenceDiagram(participants);

    render(
      <ParticipantsTab
        sequenceDiagram={diagram}
        onUpdate={vi.fn()}
        metaModel={null}
      />
    );

    const row = screen.getByTestId('participant-row-p1');

    // Verify GripVertical icon is rendered
    const gripVertical = within(row).getByTestId('icon-grip-vertical');
    expect(gripVertical).toBeInTheDocument();

    // Verify unicode hamburger icon is NOT present
    expect(row.innerHTML).not.toContain('\u2630'); // trigram for heaven (hamburger)
  });
});
