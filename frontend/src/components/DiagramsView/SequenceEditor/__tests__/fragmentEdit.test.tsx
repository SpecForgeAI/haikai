/**
 * Fragment Edit Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 4, Task 4.1: Write 4 focused tests for fragment edit functionality
 *
 * Tests verify:
 * - Test 1: AddFragmentDrawer displays "Edit Fragment" title and "Update" button when editData is provided
 * - Test 2: AddFragmentDrawer pre-populates fragment_kind, label_text, and operand guard_expression values from editData
 * - Test 3: Changing fragment_kind during edit resets operands to new kind's default structure via getDefaultOperands()
 * - Test 4: Submitting in edit mode without changing fragment_kind preserves existing IDs; changing fragment_kind recreates operands with new IDs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddFragmentDrawer } from '../AddFragmentDrawer';
import type { FragmentEditData } from '../AddFragmentDrawer';
import type {
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../../../../types/sequenceDiagram';

// ============================================================================
// Test Data
// ============================================================================

function createLoopEditData(): FragmentEditData {
  return {
    fragmentId: 'frag-1',
    fragment: {
      id: 'frag-1',
      fragment_kind: 'Loop',
      label_text: 'Retry Logic',
    },
    operands: [
      {
        id: 'op-1',
        fragment_id: 'frag-1',
        guard_expression: 'retries < 3',
        operand_index: 0,
      },
    ],
    node: {
      id: 'node-frag-1',
      node_kind: 'Fragment',
      fragment_id: 'frag-1',
      order_index: 0,
    },
  };
}

function createAlternativeEditData(): FragmentEditData {
  return {
    fragmentId: 'frag-2',
    fragment: {
      id: 'frag-2',
      fragment_kind: 'Alternative',
      label_text: 'Status Check',
    },
    operands: [
      {
        id: 'op-2a',
        fragment_id: 'frag-2',
        guard_expression: 'status == SUCCESS',
        operand_index: 0,
      },
      {
        id: 'op-2b',
        fragment_id: 'frag-2',
        guard_expression: 'else',
        operand_index: 1,
      },
    ],
    node: {
      id: 'node-frag-2',
      node_kind: 'Fragment',
      fragment_id: 'frag-2',
      order_index: 1,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Fragment Edit (Task Group 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: AddFragmentDrawer displays "Edit Fragment" title and "Update" button when editData is provided
  it('displays "Edit Fragment" title and "Update" button when editData is provided', () => {
    const editData = createLoopEditData();

    render(
      <AddFragmentDrawer
        isOpen={true}
        onClose={vi.fn()}
        existingNodes={[]}
        onSubmit={vi.fn()}
        editData={editData}
        onUpdate={vi.fn()}
      />
    );

    // Verify title is "Edit Fragment" (not "Add Fragment")
    expect(screen.getByText('Edit Fragment')).toBeInTheDocument();
    expect(screen.queryByText('Add Fragment')).not.toBeInTheDocument();

    // Verify submit button says "Update" (not "Add Fragment")
    const submitButton = screen.getByTestId('drawer-submit-button');
    expect(submitButton).toHaveTextContent('Update');
  });

  // Test 2: AddFragmentDrawer pre-populates fragment_kind, label_text, and operand guard_expression values from editData
  it('pre-populates fragment_kind, label_text, and operand guard_expression values from editData', () => {
    const editData = createAlternativeEditData();

    render(
      <AddFragmentDrawer
        isOpen={true}
        onClose={vi.fn()}
        existingNodes={[]}
        onSubmit={vi.fn()}
        editData={editData}
        onUpdate={vi.fn()}
      />
    );

    // Verify fragment_kind is pre-populated
    const kindSelect = screen.getByTestId('field-fragmentKind') as HTMLSelectElement;
    expect(kindSelect.value).toBe('Alternative');

    // Verify label_text is pre-populated
    const labelInput = screen.getByTestId('field-labelText') as HTMLInputElement;
    expect(labelInput.value).toBe('Status Check');

    // Verify operand guard expressions are pre-populated
    const operand0 = screen.getByTestId('field-operand-0') as HTMLInputElement;
    expect(operand0.value).toBe('status == SUCCESS');

    const operand1 = screen.getByTestId('field-operand-1') as HTMLInputElement;
    expect(operand1.value).toBe('else');
  });

  // Test 3: Changing fragment_kind during edit resets operands to new kind's default structure via getDefaultOperands()
  it('changing fragment_kind during edit resets operands to new kind default structure via getDefaultOperands()', async () => {
    const editData = createAlternativeEditData();

    render(
      <AddFragmentDrawer
        isOpen={true}
        onClose={vi.fn()}
        existingNodes={[]}
        onSubmit={vi.fn()}
        editData={editData}
        onUpdate={vi.fn()}
      />
    );

    // Verify initial state has 2 operands (Alternative)
    expect(screen.getByTestId('field-operand-0')).toBeInTheDocument();
    expect(screen.getByTestId('field-operand-1')).toBeInTheDocument();

    // Change fragment_kind from Alternative to Loop
    const kindSelect = screen.getByTestId('field-fragmentKind');
    fireEvent.change(kindSelect, { target: { value: 'Loop' } });

    // After changing to Loop, should have only 1 operand (Loop default)
    await waitFor(() => {
      expect(screen.getByTestId('field-operand-0')).toBeInTheDocument();
      expect(screen.queryByTestId('field-operand-1')).not.toBeInTheDocument();
    });

    // The operand should have empty guard expression (default for new operand)
    const operand0 = screen.getByTestId('field-operand-0') as HTMLInputElement;
    expect(operand0.value).toBe('');
  });

  // Test 4: Submitting in edit mode without changing fragment_kind preserves existing IDs;
  //          changing fragment_kind recreates operands with new IDs
  it('submitting without changing fragment_kind preserves existing IDs; changing kind recreates operand IDs', async () => {
    const editData = createLoopEditData();
    const onUpdate = vi.fn();

    const { rerender } = render(
      <AddFragmentDrawer
        isOpen={true}
        onClose={vi.fn()}
        existingNodes={[]}
        onSubmit={vi.fn()}
        editData={editData}
        onUpdate={onUpdate}
      />
    );

    // --- Part A: Submit without changing fragment_kind ---

    // Update the guard expression but do NOT change fragment_kind
    const operand0 = screen.getByTestId('field-operand-0') as HTMLInputElement;
    fireEvent.change(operand0, { target: { value: 'retries < 5' } });

    // Submit
    const submitButton = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    // Verify preserved IDs
    const [fragment, operands, node, removedOperandIds] = onUpdate.mock.calls[0];

    // Fragment should preserve the existing id
    expect(fragment.id).toBe('frag-1');
    expect(fragment.fragment_kind).toBe('Loop');

    // Operands should preserve existing id
    expect(operands).toHaveLength(1);
    expect(operands[0].id).toBe('op-1');
    expect(operands[0].guard_expression).toBe('retries < 5');
    expect(operands[0].fragment_id).toBe('frag-1');

    // Node should preserve existing id
    expect(node.id).toBe('node-frag-1');
    expect(node.order_index).toBe(0);

    // No removed operand IDs when kind didn't change
    expect(removedOperandIds).toBeUndefined();

    // --- Part B: Now change fragment_kind and submit ---
    onUpdate.mockClear();

    // Re-render with the Alternative edit data to test kind change
    const altEditData = createAlternativeEditData();

    rerender(
      <AddFragmentDrawer
        isOpen={true}
        onClose={vi.fn()}
        existingNodes={[]}
        onSubmit={vi.fn()}
        editData={altEditData}
        onUpdate={onUpdate}
      />
    );

    // Change fragment_kind from Alternative to Optional
    const kindSelect = screen.getByTestId('field-fragmentKind');
    fireEvent.change(kindSelect, { target: { value: 'Optional' } });

    // Wait for operand reset
    await waitFor(() => {
      expect(screen.queryByTestId('field-operand-1')).not.toBeInTheDocument();
    });

    // Fill in the new operand's guard expression
    const newOperand0 = screen.getByTestId('field-operand-0') as HTMLInputElement;
    fireEvent.change(newOperand0, { target: { value: 'isValid' } });

    // Submit
    const submitButton2 = screen.getByTestId('drawer-submit-button');
    fireEvent.click(submitButton2);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    const [fragment2, operands2, node2, removedOperandIds2] = onUpdate.mock.calls[0];

    // Fragment should still preserve id
    expect(fragment2.id).toBe('frag-2');
    expect(fragment2.fragment_kind).toBe('Optional');

    // Operands should have NEW IDs (not the original op-2a or op-2b)
    expect(operands2).toHaveLength(1);
    expect(operands2[0].id).not.toBe('op-2a');
    expect(operands2[0].id).not.toBe('op-2b');
    expect(operands2[0].guard_expression).toBe('isValid');
    expect(operands2[0].fragment_id).toBe('frag-2');

    // Node should still preserve existing id
    expect(node2.id).toBe('node-frag-2');

    // removedOperandIds should contain the old operand IDs
    expect(removedOperandIds2).toEqual(['op-2a', 'op-2b']);
  });
});
