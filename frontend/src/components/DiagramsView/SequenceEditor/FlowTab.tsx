/**
 * FlowTab Component
 * Task Group 4: Tab component for managing sequence diagram messages and fragments
 * Task Group 3: Extended with edit message exchange handler (handleEditNode for messages)
 * Task Group 5: Integrated with @dnd-kit for drag-and-drop reorder
 *
 * This component displays the Flow tab content within the SequenceEditorPanel.
 * It shows a linear outline of sequenceNodes as an indented tree structure.
 *
 * Features:
 * - Display sequence nodes (messages and fragments) as indented tree
 * - Indentation reflects nesting depth (parent_node_id, parent_operand_id)
 * - "+ Add Message Exchange" button opens AddMessageExchangeDrawer
 * - "+ Add Fragment" button opens AddFragmentDrawer
 * - Edit button on each node row opens the appropriate edit drawer
 *   - Fragment nodes: opens AddFragmentDrawer in edit mode (Task Group 4)
 *   - Message nodes: opens AddMessageExchangeDrawer in edit mode (Task Group 3)
 * - Drag-and-drop reorder of flow items via @dnd-kit/sortable (Task Group 5)
 */

import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import {
  SequenceDiagram,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../../../types/sequenceDiagram';
import { MetaModel } from '../../../types/model';
import { SequenceNodeRow } from './SequenceNodeRow';
import { AddMessageExchangeDrawer } from './AddMessageExchangeDrawer';
import type { MessageExchangeEditData } from './AddMessageExchangeDrawer';
import { AddFragmentDrawer } from './AddFragmentDrawer';
import type { FragmentEditData } from './AddFragmentDrawer';
import styles from '../SequenceEditorPanel.module.css';

// ============================================================================
// Types
// ============================================================================

export interface FlowTabProps {
  /** The sequence diagram data */
  sequenceDiagram: SequenceDiagram;
  /** Callback to update the sequence diagram */
  onUpdate: (updates: Partial<SequenceDiagram>) => void;
  /** Optional meta model for entity lookups */
  metaModel?: MetaModel | null;
}

export interface TreeNode {
  node: SequenceNode;
  children: TreeNode[];
  depth: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build tree structure from flat sequence nodes list
 * Returns root-level nodes with nested children
 */
export function buildNodeTree(
  nodes: SequenceNode[],
  operands: SequenceOperand[]
): TreeNode[] {
  // Sort by order_index
  const sorted = [...nodes].sort((a, b) => a.order_index - b.order_index);

  // Build lookup map
  const nodeMap = new Map<string, TreeNode>();
  for (const node of sorted) {
    nodeMap.set(node.id, { node, children: [], depth: 0 });
  }

  // Build tree
  const roots: TreeNode[] = [];

  for (const node of sorted) {
    const treeNode = nodeMap.get(node.id)!;

    if (node.parent_node_id && nodeMap.has(node.parent_node_id)) {
      // Nested under another node
      const parent = nodeMap.get(node.parent_node_id)!;
      treeNode.depth = parent.depth + 1;
      parent.children.push(treeNode);
    } else if (node.parent_operand_id) {
      // Nested inside an operand - find the fragment node that owns this operand
      const operand = operands.find(op => op.id === node.parent_operand_id);
      if (operand) {
        // Find the fragment node
        const fragmentNode = sorted.find(
          n => n.node_kind === 'Fragment' && n.fragment_id === operand.fragment_id
        );
        if (fragmentNode && nodeMap.has(fragmentNode.id)) {
          const parent = nodeMap.get(fragmentNode.id)!;
          treeNode.depth = parent.depth + 1;
          parent.children.push(treeNode);
          continue;
        }
      }
      // If we couldn't find the parent fragment, treat as root
      roots.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  // Sort children by order_index
  const sortChildren = (treeNodes: TreeNode[]) => {
    treeNodes.sort((a, b) => a.node.order_index - b.node.order_index);
    for (const tn of treeNodes) {
      sortChildren(tn.children);
    }
  };
  sortChildren(roots);

  return roots;
}

/**
 * Get the next available order_index for new nodes at root level or within a parent
 */
export function getNextOrderIndex(
  nodes: SequenceNode[],
  parentNodeId?: string,
  parentOperandId?: string
): number {
  const siblings = nodes.filter(n =>
    n.parent_node_id === parentNodeId &&
    n.parent_operand_id === parentOperandId
  );

  if (siblings.length === 0) return 0;

  return Math.max(...siblings.map(s => s.order_index)) + 1;
}

/**
 * Generate unique ID for new entities
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// FlowTab Component
// ============================================================================

export function FlowTab({
  sequenceDiagram,
  onUpdate,
  metaModel,
}: FlowTabProps) {
  // Drawer states
  const [isMessageDrawerOpen, setIsMessageDrawerOpen] = useState(false);
  const [isFragmentDrawerOpen, setIsFragmentDrawerOpen] = useState(false);

  // Target operand for "Add inside fragment" action
  const [targetOperandId, setTargetOperandId] = useState<string | undefined>(undefined);
  const [targetParentNodeId, setTargetParentNodeId] = useState<string | undefined>(undefined);

  // Edit mode state for message exchange drawer
  const [editMessageExchangeData, setEditMessageExchangeData] = useState<MessageExchangeEditData | null>(null);

  // Edit mode state for fragment drawer
  const [editFragmentData, setEditFragmentData] = useState<FragmentEditData | null>(null);

  // Build tree structure from nodes
  const nodeTree = useMemo(() =>
    buildNodeTree(
      sequenceDiagram.sequence_nodes || [],
      sequenceDiagram.operands || []
    ),
    [sequenceDiagram.sequence_nodes, sequenceDiagram.operands]
  );

  // DnD sensors: PointerSensor with 5px distance activation constraint, KeyboardSensor
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  // Root-level sortable item IDs derived from nodeTree
  const rootSortableIds = useMemo(() =>
    nodeTree.map(tn => tn.node.id),
    [nodeTree]
  );

  // Handlers for opening drawers (Add mode)
  const handleAddMessageExchange = useCallback(() => {
    setTargetOperandId(undefined);
    setTargetParentNodeId(undefined);
    setEditMessageExchangeData(null); // Clear edit data for Add mode
    setIsMessageDrawerOpen(true);
  }, []);

  const handleAddFragment = useCallback(() => {
    setTargetOperandId(undefined);
    setTargetParentNodeId(undefined);
    setEditFragmentData(null); // Clear edit data when opening for add mode
    setIsFragmentDrawerOpen(true);
  }, []);

  // Handler for "Add inside fragment" action
  const handleAddInsideFragment = useCallback((
    fragmentNodeId: string,
    operandId: string,
    type: 'message' | 'fragment'
  ) => {
    setTargetParentNodeId(fragmentNodeId);
    setTargetOperandId(operandId);
    if (type === 'message') {
      setEditMessageExchangeData(null); // Clear edit data for Add mode
      setIsMessageDrawerOpen(true);
    } else {
      setEditFragmentData(null); // Clear edit data when opening for add mode
      setIsFragmentDrawerOpen(true);
    }
  }, []);

  // Handler for message exchange creation
  const handleMessageExchangeSubmit = useCallback((
    messages: SequenceMessage[],
    nodes: SequenceNode[]
  ) => {
    onUpdate({
      messages: [...(sequenceDiagram.messages || []), ...messages],
      sequence_nodes: [...(sequenceDiagram.sequence_nodes || []), ...nodes],
    });
    setIsMessageDrawerOpen(false);
  }, [sequenceDiagram, onUpdate]);

  // Handler for fragment creation
  const handleFragmentSubmit = useCallback((
    fragment: SequenceFragment,
    operands: SequenceOperand[],
    node: SequenceNode
  ) => {
    onUpdate({
      fragments: [...(sequenceDiagram.fragments || []), fragment],
      operands: [...(sequenceDiagram.operands || []), ...operands],
      sequence_nodes: [...(sequenceDiagram.sequence_nodes || []), node],
    });
    setIsFragmentDrawerOpen(false);
  }, [sequenceDiagram, onUpdate]);

  // Handler for updating a message exchange (edit mode)
  const handleUpdateMessageExchange = useCallback((
    messages: SequenceMessage[],
    nodes: SequenceNode[],
    removedMessageIds?: string[],
    removedNodeIds?: string[]
  ) => {
    const existingMessages = sequenceDiagram.messages || [];
    const existingNodes = sequenceDiagram.sequence_nodes || [];

    // Build set of IDs being updated or added
    const updatedMessageIds = new Set(messages.map(m => m.id));
    const updatedNodeIds = new Set(nodes.map(n => n.id));
    const removedMsgIds = new Set(removedMessageIds || []);
    const removedNdIds = new Set(removedNodeIds || []);

    // Build updated messages: keep existing ones that are not being updated or removed
    let updatedMessages = existingMessages
      .filter(m => !updatedMessageIds.has(m.id) && !removedMsgIds.has(m.id));
    // Add updated/new messages
    updatedMessages = [...updatedMessages, ...messages];

    // Build updated nodes: keep existing ones that are not being updated or removed
    let updatedNodes = existingNodes
      .filter(n => !updatedNodeIds.has(n.id) && !removedNdIds.has(n.id));
    // Add updated/new nodes
    updatedNodes = [...updatedNodes, ...nodes];

    onUpdate({
      messages: updatedMessages,
      sequence_nodes: updatedNodes,
    });

    // Close drawer and clear edit state
    setIsMessageDrawerOpen(false);
    setEditMessageExchangeData(null);
  }, [sequenceDiagram, onUpdate]);

  // Handler for fragment update (edit mode)
  const handleUpdateFragment = useCallback((
    fragment: SequenceFragment,
    operands: SequenceOperand[],
    node: SequenceNode,
    removedOperandIds?: string[]
  ) => {
    // Replace fragment in fragments array by id
    const updatedFragments = (sequenceDiagram.fragments || []).map(f =>
      f.id === fragment.id ? fragment : f
    );

    // Handle operands: remove old ones if specified, replace/add new ones
    let updatedOperands = sequenceDiagram.operands || [];

    // Remove operands marked for removal (when fragment_kind changed)
    if (removedOperandIds && removedOperandIds.length > 0) {
      const removedSet = new Set(removedOperandIds);
      updatedOperands = updatedOperands.filter(o => !removedSet.has(o.id));
    }

    // Replace existing operands by id, or add new ones
    const existingOperandIds = new Set(updatedOperands.map(o => o.id));
    const replacedOperands = updatedOperands.map(o => {
      const replacement = operands.find(newOp => newOp.id === o.id);
      return replacement || o;
    });

    // Add any new operands that don't exist yet
    const newOperands = operands.filter(o => !existingOperandIds.has(o.id));
    const finalOperands = [...replacedOperands, ...newOperands];

    // Replace node in sequence_nodes array by id
    const updatedNodes = (sequenceDiagram.sequence_nodes || []).map(n =>
      n.id === node.id ? node : n
    );

    onUpdate({
      fragments: updatedFragments,
      operands: finalOperands,
      sequence_nodes: updatedNodes,
    });

    setIsFragmentDrawerOpen(false);
    setEditFragmentData(null);
  }, [sequenceDiagram, onUpdate]);

  // Handler for node move up/down
  const handleMoveNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    const nodes = sequenceDiagram.sequence_nodes || [];
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return;

    const node = nodes[nodeIndex];

    // Find siblings (same parent scope)
    const siblings = nodes
      .filter(n =>
        n.parent_node_id === node.parent_node_id &&
        n.parent_operand_id === node.parent_operand_id
      )
      .sort((a, b) => a.order_index - b.order_index);

    const siblingIndex = siblings.findIndex(s => s.id === nodeId);
    if (siblingIndex === -1) return;

    // Check if move is possible
    if (direction === 'up' && siblingIndex === 0) return;
    if (direction === 'down' && siblingIndex === siblings.length - 1) return;

    // Get the sibling to swap with
    const swapIndex = direction === 'up' ? siblingIndex - 1 : siblingIndex + 1;
    const swapNode = siblings[swapIndex];

    // Create new array with swapped order_index values
    const updatedNodes = nodes.map(n => {
      if (n.id === node.id) {
        return { ...n, order_index: swapNode.order_index };
      }
      if (n.id === swapNode.id) {
        return { ...n, order_index: node.order_index };
      }
      return n;
    });

    onUpdate({ sequence_nodes: updatedNodes });
  }, [sequenceDiagram.sequence_nodes, onUpdate]);

  // Handler for DnD drag end - reorders nodes within their sibling scope
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const nodes = sequenceDiagram.sequence_nodes || [];

    // Find the dragged node to determine its sibling scope
    const draggedNode = nodes.find(n => n.id === active.id);
    if (!draggedNode) return;

    // Find siblings in the same scope (same parent_node_id and parent_operand_id)
    // Reuses the sibling scope filtering pattern from handleMoveNode
    const siblings = nodes
      .filter(n =>
        n.parent_node_id === draggedNode.parent_node_id &&
        n.parent_operand_id === draggedNode.parent_operand_id
      )
      .sort((a, b) => a.order_index - b.order_index);

    // Compute old and new indices within sorted siblings
    const oldIndex = siblings.findIndex(s => s.id === active.id);
    const newIndex = siblings.findIndex(s => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Use arrayMove to get the new ordering
    const reorderedSiblings = arrayMove(siblings, oldIndex, newIndex);

    // Reassign order_index values (0, 1, 2, ...) for all siblings in the scope
    const reindexedMap = new Map<string, number>();
    reorderedSiblings.forEach((sibling, idx) => {
      reindexedMap.set(sibling.id, idx);
    });

    // Merge reindexed siblings back into the full sequence_nodes array
    const updatedNodes = nodes.map(n => {
      if (reindexedMap.has(n.id)) {
        return { ...n, order_index: reindexedMap.get(n.id)! };
      }
      return n;
    });

    onUpdate({ sequence_nodes: updatedNodes });
  }, [sequenceDiagram.sequence_nodes, onUpdate]);

  // Handler for node delete
  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = (sequenceDiagram.sequence_nodes || []).find(n => n.id === nodeId);
    if (!node) return;

    // Remove the node
    const updatedNodes = (sequenceDiagram.sequence_nodes || []).filter(n => n.id !== nodeId);

    // If it's a message node, also remove the message
    let updatedMessages = sequenceDiagram.messages || [];
    if (node.node_kind === 'Message' && node.message_id) {
      updatedMessages = updatedMessages.filter(m => m.id !== node.message_id);
    }

    // If it's a fragment node, also remove the fragment and its operands
    let updatedFragments = sequenceDiagram.fragments || [];
    let updatedOperands = sequenceDiagram.operands || [];
    if (node.node_kind === 'Fragment' && node.fragment_id) {
      updatedFragments = updatedFragments.filter(f => f.id !== node.fragment_id);
      updatedOperands = updatedOperands.filter(o => o.fragment_id !== node.fragment_id);

      // Also remove any nodes nested inside this fragment's operands
      const fragmentOperandIds = new Set(
        (sequenceDiagram.operands || [])
          .filter(o => o.fragment_id === node.fragment_id)
          .map(o => o.id)
      );

      // Recursively find all nested nodes
      const nodesToRemove = new Set<string>([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of updatedNodes) {
          if (!nodesToRemove.has(n.id)) {
            if (
              (n.parent_node_id && nodesToRemove.has(n.parent_node_id)) ||
              (n.parent_operand_id && fragmentOperandIds.has(n.parent_operand_id))
            ) {
              nodesToRemove.add(n.id);
              changed = true;
            }
          }
        }
      }

      // Remove nested nodes
      const finalNodes = updatedNodes.filter(n => !nodesToRemove.has(n.id));

      // Remove associated messages
      const messageIdsToRemove = new Set(
        finalNodes
          .filter(n => nodesToRemove.has(n.id) && n.node_kind === 'Message' && n.message_id)
          .map(n => n.message_id)
      );
      updatedMessages = updatedMessages.filter(m => !messageIdsToRemove.has(m.id));

      onUpdate({
        sequence_nodes: finalNodes,
        messages: updatedMessages,
        fragments: updatedFragments,
        operands: updatedOperands,
      });
      return;
    }

    onUpdate({
      sequence_nodes: updatedNodes,
      messages: updatedMessages,
    });
  }, [sequenceDiagram, onUpdate]);

  // Handler for editing a node - routes to appropriate drawer based on node type
  const handleEditNode = useCallback((nodeId: string) => {
    const nodes = sequenceDiagram.sequence_nodes || [];
    const messages = sequenceDiagram.messages || [];
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (node.node_kind === 'Message' && node.message_id) {
      // Message node: look up the message and its exchange
      const message = messages.find(m => m.id === node.message_id);
      if (!message) return;

      const exchangeId = message.exchange_id;

      // Find the request message (exchange_role === 'Request') and optional response message
      const requestMessage = messages.find(
        m => m.exchange_id === exchangeId && m.exchange_role === 'Request'
      );
      const responseMessage = messages.find(
        m => m.exchange_id === exchangeId && m.exchange_role === 'Response'
      );

      if (!requestMessage) return;

      // Find the corresponding nodes
      const requestNode = nodes.find(
        n => n.node_kind === 'Message' && n.message_id === requestMessage.id
      );
      const responseNode = responseMessage
        ? nodes.find(n => n.node_kind === 'Message' && n.message_id === responseMessage.id)
        : undefined;

      if (!requestNode) return;

      // Build editData for the message exchange
      const editData: MessageExchangeEditData = {
        exchangeId,
        requestMessage,
        responseMessage,
        requestNode,
        responseNode,
      };

      // Set edit state and open message drawer
      setEditMessageExchangeData(editData);
      setIsMessageDrawerOpen(true);
    } else if (node.node_kind === 'Fragment' && node.fragment_id) {
      // Fragment nodes: open fragment drawer in edit mode
      const fragment = (sequenceDiagram.fragments || []).find(f => f.id === node.fragment_id);
      if (!fragment) return;

      const fragmentOperands = (sequenceDiagram.operands || [])
        .filter(op => op.fragment_id === fragment.id)
        .sort((a, b) => a.operand_index - b.operand_index);

      const editData: FragmentEditData = {
        fragmentId: fragment.id,
        fragment,
        operands: fragmentOperands,
        node,
      };

      setEditFragmentData(editData);
      setIsFragmentDrawerOpen(true);
    }
  }, [sequenceDiagram]);

  // Render empty state
  const isEmpty = nodeTree.length === 0;

  return (
    <>
      {/* Add Buttons Section */}
      <div className={styles.addButtonSection}>
        <button
          className={styles.addButton}
          onClick={handleAddMessageExchange}
          disabled={!sequenceDiagram.participants || sequenceDiagram.participants.length < 2}
          style={{ marginBottom: '6px' }}
          data-testid="add-message-exchange-button"
        >
          <span className={styles.addButtonIcon}>+</span>
          Add Message Exchange
        </button>
        <button
          className={styles.addButton}
          onClick={handleAddFragment}
          data-testid="add-fragment-button"
        >
          <span className={styles.addButtonIcon}>+</span>
          Add Fragment
        </button>
      </div>

      {/* Node List with DnD */}
      {isEmpty ? (
        <div className={styles.emptyState}>
          No messages or fragments yet. Add message exchanges to define interactions.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rootSortableIds}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.listContainer}>
              {nodeTree.map(treeNode => (
                <SequenceNodeRow
                  key={treeNode.node.id}
                  treeNode={treeNode}
                  sequenceDiagram={sequenceDiagram}
                  metaModel={metaModel}
                  onMoveUp={(id) => handleMoveNode(id, 'up')}
                  onMoveDown={(id) => handleMoveNode(id, 'down')}
                  onEdit={handleEditNode}
                  onDelete={handleDeleteNode}
                  onAddInside={handleAddInsideFragment}
                  sortableId={treeNode.node.id}
                  isDndEnabled={true}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add/Edit Message Exchange Drawer */}
      <AddMessageExchangeDrawer
        isOpen={isMessageDrawerOpen}
        onClose={() => {
          setIsMessageDrawerOpen(false);
          setEditMessageExchangeData(null);
        }}
        participants={sequenceDiagram.participants || []}
        existingNodes={sequenceDiagram.sequence_nodes || []}
        metaModel={metaModel}
        onSubmit={handleMessageExchangeSubmit}
        targetOperandId={targetOperandId}
        targetParentNodeId={targetParentNodeId}
        editData={editMessageExchangeData}
        onUpdate={handleUpdateMessageExchange}
      />

      {/* Add/Edit Fragment Drawer */}
      <AddFragmentDrawer
        isOpen={isFragmentDrawerOpen}
        onClose={() => {
          setIsFragmentDrawerOpen(false);
          setEditFragmentData(null);
        }}
        existingNodes={sequenceDiagram.sequence_nodes || []}
        onSubmit={handleFragmentSubmit}
        onUpdate={handleUpdateFragment}
        editData={editFragmentData}
        targetOperandId={targetOperandId}
        targetParentNodeId={targetParentNodeId}
      />
    </>
  );
}

export default FlowTab;
