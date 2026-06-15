/**
 * Drag-and-Drop Reorder Tests
 *
 * Spec: Sequence Editor Editable Rows and Drag-Reorder
 * Task Group 5, Task 5.2: Write 5 focused tests for drag-and-drop reorder functionality
 *
 * Tests verify:
 * - Test 1: FlowTab renders DndContext and SortableContext wrappers around the node list
 * - Test 2: SequenceNodeRow provides useSortable attributes and listeners on the drag handle element (not the entire row)
 * - Test 3: DragEnd handler correctly computes new ordering using arrayMove and updates order_index for all affected siblings
 * - Test 4: DnD reorder within a nested operand scope only affects sibling nodes within that operand (not root-level nodes)
 * - Test 5: Sensors are configured with PointerSensor (distance: 5px activation constraint) and KeyboardSensor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { FlowTab } from '../FlowTab';
import { SequenceNodeRow } from '../SequenceNodeRow';
import type { SequenceDiagram, SequenceParticipant } from '../../../../types/sequenceDiagram';
import type { TreeNode } from '../FlowTab';

// ============================================================================
// Mocks
// ============================================================================

// Track DndContext and SortableContext props for inspection
let capturedDndContextProps: any = null;
let capturedSortableContextProps: any[] = [];
let capturedSensors: any[] = [];

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
    useSensor: (sensor: any, options?: any) => {
      const sensorDescriptor = { sensor, options };
      capturedSensors.push(sensorDescriptor);
      return sensorDescriptor;
    },
    useSensors: (...args: any[]) => args,
  };
});

// Mock @dnd-kit/sortable
let capturedUseSortableCalls: any[] = [];

vi.mock('@dnd-kit/sortable', () => {
  const React = require('react');
  return {
    SortableContext: ({ children, items, strategy, ...rest }: any) => {
      capturedSortableContextProps.push({ items, strategy, ...rest });
      return React.createElement('div', { 'data-testid': 'sortable-context' }, children);
    },
    verticalListSortingStrategy: { name: 'verticalListSortingStrategy' },
    arrayMove: (arr: any[], oldIndex: number, newIndex: number) => {
      // Real arrayMove implementation for test assertions
      const result = [...arr];
      const [removed] = result.splice(oldIndex, 1);
      result.splice(newIndex, 0, removed);
      return result;
    },
    useSortable: ({ id, ...rest }: any) => {
      capturedUseSortableCalls.push({ id, ...rest });
      return {
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
      };
    },
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

function createTestParticipant(id: string, orderIndex: number): SequenceParticipant {
  return {
    id,
    ref_kind: 'Application',
    ref_id: `app-${id}`,
    order_index: orderIndex,
  };
}

function createTestSequenceDiagramWithMultipleNodes(): SequenceDiagram {
  const participants = [
    createTestParticipant('p1', 0),
    createTestParticipant('p2', 1),
  ];

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
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'Message A',
      },
      {
        id: 'msg-2',
        exchange_id: 'exch-2',
        exchange_role: 'Request',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        label_text: 'Message B',
      },
      {
        id: 'msg-3',
        exchange_id: 'exch-3',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'Message C',
      },
    ],
    fragments: [],
    operands: [],
    sequence_nodes: [
      {
        id: 'node-1',
        node_kind: 'Message',
        message_id: 'msg-1',
        order_index: 0,
      },
      {
        id: 'node-2',
        node_kind: 'Message',
        message_id: 'msg-2',
        order_index: 1,
      },
      {
        id: 'node-3',
        node_kind: 'Message',
        message_id: 'msg-3',
        order_index: 2,
      },
    ],
  };
}

function createDiagramWithNestedNodes(): SequenceDiagram {
  const participants = [
    createTestParticipant('p1', 0),
    createTestParticipant('p2', 1),
  ];

  return {
    id: 'seq-2',
    model_file_id: 'model-1',
    name: 'Test Sequence With Nesting',
    type: 'Sequence',
    participants,
    messages: [
      {
        id: 'msg-root',
        exchange_id: 'exch-root',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'Root Message',
      },
      {
        id: 'msg-nested-1',
        exchange_id: 'exch-nested-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'Nested A',
      },
      {
        id: 'msg-nested-2',
        exchange_id: 'exch-nested-2',
        exchange_role: 'Request',
        from_participant_id: 'p2',
        to_participant_id: 'p1',
        label_text: 'Nested B',
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
      // Root-level message
      {
        id: 'node-root-msg',
        node_kind: 'Message',
        message_id: 'msg-root',
        order_index: 0,
      },
      // Root-level fragment
      {
        id: 'node-frag',
        node_kind: 'Fragment',
        fragment_id: 'frag-1',
        order_index: 1,
      },
      // Nested nodes inside the fragment's operand
      {
        id: 'node-nested-1',
        node_kind: 'Message',
        message_id: 'msg-nested-1',
        order_index: 0,
        parent_operand_id: 'op-1',
      },
      {
        id: 'node-nested-2',
        node_kind: 'Message',
        message_id: 'msg-nested-2',
        order_index: 1,
        parent_operand_id: 'op-1',
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DnD Reorder (Task Group 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDndContextProps = null;
    capturedSortableContextProps = [];
    capturedSensors = [];
    capturedUseSortableCalls = [];
  });

  // Test 1: FlowTab renders DndContext and SortableContext wrappers around the node list
  it('FlowTab renders DndContext and SortableContext wrappers around the node list', () => {
    const diagram = createTestSequenceDiagramWithMultipleNodes();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Verify DndContext wrapper is rendered
    const dndContext = screen.getByTestId('dnd-context');
    expect(dndContext).toBeInTheDocument();

    // Verify SortableContext wrapper is rendered
    const sortableContexts = screen.getAllByTestId('sortable-context');
    expect(sortableContexts.length).toBeGreaterThanOrEqual(1);

    // Verify the root SortableContext was called with root-level node IDs
    expect(capturedSortableContextProps.length).toBeGreaterThanOrEqual(1);
    const rootSortableContext = capturedSortableContextProps[0];
    expect(rootSortableContext.items).toEqual(['node-1', 'node-2', 'node-3']);

    // Verify DndContext received onDragEnd handler and sensors
    expect(capturedDndContextProps.onDragEnd).toBeDefined();
    expect(capturedDndContextProps.sensors).toBeDefined();
  });

  // Test 2: SequenceNodeRow provides useSortable attributes and listeners on the drag handle element (not the entire row)
  it('SequenceNodeRow provides useSortable attributes and listeners on the drag handle element (not the entire row)', () => {
    const diagram = createTestSequenceDiagramWithMultipleNodes();
    const treeNode: TreeNode = {
      node: diagram.sequence_nodes[0],
      children: [],
      depth: 0,
    };

    render(
      <SequenceNodeRow
        treeNode={treeNode}
        sequenceDiagram={diagram}
        metaModel={null}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddInside={vi.fn()}
        sortableId="node-1"
        isDndEnabled={true}
      />
    );

    // Verify useSortable was called with the correct id
    expect(capturedUseSortableCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedUseSortableCalls[0].id).toBe('node-1');

    // Verify the row element exists
    const row = screen.getByTestId('sequence-node-node-1');
    expect(row).toBeInTheDocument();

    // Verify the drag handle has the sortable attributes (aria-roledescription)
    const dragHandle = row.querySelector('[data-testid="drag-handle-node-1"]');
    expect(dragHandle).toBeInTheDocument();
    expect(dragHandle).toHaveAttribute('aria-roledescription', 'sortable');

    // Verify the row itself does NOT have sortable attributes
    expect(row).not.toHaveAttribute('aria-roledescription', 'sortable');
  });

  // Test 3: DragEnd handler correctly computes new ordering using arrayMove and updates order_index
  it('DragEnd handler correctly computes new ordering using arrayMove and updates order_index for all affected siblings', () => {
    const diagram = createTestSequenceDiagramWithMultipleNodes();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Simulate drag end: move node-1 (index 0) to position of node-3 (index 2)
    expect(capturedDndContextProps.onDragEnd).toBeDefined();

    act(() => {
      capturedDndContextProps.onDragEnd({
        active: { id: 'node-1' },
        over: { id: 'node-3' },
      });
    });

    // Verify onUpdate was called
    expect(onUpdate).toHaveBeenCalledTimes(1);

    const updateCall = onUpdate.mock.calls[0][0];
    expect(updateCall.sequence_nodes).toBeDefined();

    // After moving node-1 from index 0 to index 2:
    // New order: node-2 (0), node-3 (1), node-1 (2)
    const updatedNodes = updateCall.sequence_nodes;
    const node1 = updatedNodes.find((n: any) => n.id === 'node-1');
    const node2 = updatedNodes.find((n: any) => n.id === 'node-2');
    const node3 = updatedNodes.find((n: any) => n.id === 'node-3');

    expect(node2.order_index).toBe(0);
    expect(node3.order_index).toBe(1);
    expect(node1.order_index).toBe(2);
  });

  // Test 4: DnD reorder within a nested operand scope only affects sibling nodes within that operand
  it('DnD reorder within a nested operand scope only affects sibling nodes within that operand (not root-level nodes)', () => {
    const diagram = createDiagramWithNestedNodes();
    const onUpdate = vi.fn();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={onUpdate}
        metaModel={null}
      />
    );

    // Simulate drag end: move node-nested-1 to position of node-nested-2 within the operand scope
    act(() => {
      capturedDndContextProps.onDragEnd({
        active: { id: 'node-nested-1' },
        over: { id: 'node-nested-2' },
      });
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);

    const updateCall = onUpdate.mock.calls[0][0];
    const updatedNodes = updateCall.sequence_nodes;

    // Root-level nodes should be UNAFFECTED
    const rootMsg = updatedNodes.find((n: any) => n.id === 'node-root-msg');
    const fragNode = updatedNodes.find((n: any) => n.id === 'node-frag');
    expect(rootMsg.order_index).toBe(0);  // unchanged
    expect(fragNode.order_index).toBe(1); // unchanged

    // Nested nodes should be swapped
    const nested1 = updatedNodes.find((n: any) => n.id === 'node-nested-1');
    const nested2 = updatedNodes.find((n: any) => n.id === 'node-nested-2');
    expect(nested2.order_index).toBe(0);  // was 1, now 0
    expect(nested1.order_index).toBe(1);  // was 0, now 1
  });

  // Test 5: Sensors are configured with PointerSensor (distance: 5px) and KeyboardSensor
  it('Sensors are configured with PointerSensor (distance: 5px activation constraint) and KeyboardSensor', () => {
    const diagram = createTestSequenceDiagramWithMultipleNodes();

    render(
      <FlowTab
        sequenceDiagram={diagram}
        onUpdate={vi.fn()}
        metaModel={null}
      />
    );

    // Verify sensors were configured
    expect(capturedDndContextProps.sensors).toBeDefined();
    expect(capturedDndContextProps.sensors.length).toBe(2);

    // Verify PointerSensor is the first sensor with distance: 5 activation constraint
    const pointerSensor = capturedDndContextProps.sensors[0];
    expect(pointerSensor.sensor.name).toBe('PointerSensor');
    expect(pointerSensor.options).toEqual({
      activationConstraint: { distance: 5 },
    });

    // Verify KeyboardSensor is the second sensor
    const keyboardSensor = capturedDndContextProps.sensors[1];
    expect(keyboardSensor.sensor.name).toBe('KeyboardSensor');
  });
});
