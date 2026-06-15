/**
 * useSequenceDiagram Hook
 * Task Group 7: Updated to read from activeDiagram.typedContent instead of API
 *
 * This hook provides:
 * - Local state management for SequenceDiagram content from typedContent
 * - Automatic initialization from diagram.typedContent.content
 * - Debounced autosave via onUpdateDiagram callback
 * - Dirty state and saving state tracking
 * - No API calls - persistence handled via diagram save
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SequenceDiagram, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode } from '../types/sequenceDiagram';
import { Diagram } from '../types/model';
import { TypedContentEnvelope, SequenceContent } from '../types/typedContent';
import { getDiagramType } from '../types/diagramType';

/**
 * Debounce delay for autosave (in milliseconds)
 * Set to 750ms as a balance between responsiveness and avoiding excessive API calls
 */
const AUTOSAVE_DEBOUNCE_MS = 750;

/**
 * Return type for the useSequenceDiagram hook
 */
export interface UseSequenceDiagramResult {
  /** The current sequence diagram data (null if not loaded) */
  sequenceDiagram: SequenceDiagram | null;
  /** Whether the diagram is currently being loaded */
  isLoading: boolean;
  /** Whether changes are currently being saved */
  isSaving: boolean;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Error message if loading/saving failed */
  error: string | null;
  /** Function to update the sequence diagram (triggers autosave) */
  updateSequenceDiagram: (updates: Partial<SequenceDiagram>) => void;
  /** Function to replace the entire sequence diagram state */
  setSequenceDiagram: (diagram: SequenceDiagram) => void;
  /** Function to manually trigger a save */
  saveNow: () => Promise<void>;
  /** Function to reload the diagram from typedContent */
  reload: () => Promise<void>;
}

/**
 * Convert SequenceContent from typedContent to SequenceDiagram format
 * Maps the typedContent structure to the legacy SequenceDiagram interface
 */
export function sequenceContentToSequenceDiagram(
  diagramId: string,
  modelFileId: string,
  diagramName: string,
  content: SequenceContent | undefined
): SequenceDiagram {
  if (!content) {
    // Return empty diagram structure if no content
    return {
      id: diagramId,
      model_file_id: modelFileId,
      name: diagramName,
      type: 'Sequence',
      participants: [],
      messages: [],
      fragments: [],
      operands: [],
      sequence_nodes: [],
    };
  }

  // Map participants from SequenceParticipantRef to SequenceParticipant
  const participants: SequenceParticipant[] = (content.participants || []).map(p => ({
    id: p.id,
    ref_kind: p.ref_kind as SequenceParticipant['ref_kind'],
    ref_id: p.ref_id,
    order_index: p.order_index,
  }));

  // Map messages from SequenceMessageRef to SequenceMessage
  const messages: SequenceMessage[] = (content.messages || []).map(m => ({
    id: m.id,
    exchange_id: m.exchange_id,
    exchange_role: m.exchange_role as SequenceMessage['exchange_role'],
    from_participant_id: m.from_participant_id,
    to_participant_id: m.to_participant_id,
    ref_kind: m.ref_kind as SequenceMessage['ref_kind'],
    ref_id: m.ref_id,
    label_text: m.label_text,
    is_collection: m.is_collection,
    show_endpoint_name: m.show_endpoint_name,
    show_endpoint_verb_path: m.show_endpoint_verb_path,
    show_endpoint_req_res_data: m.show_endpoint_req_res_data,
    response_mode: m.response_mode,
  }));

  // Map fragments from SequenceFragmentRef to SequenceFragment
  const fragments: SequenceFragment[] = (content.fragments || []).map(f => ({
    id: f.id,
    fragment_kind: f.fragment_kind as SequenceFragment['fragment_kind'],
    label_text: f.label_text,
  }));

  // Map operands from SequenceOperandRef to SequenceOperand
  const operands: SequenceOperand[] = (content.operands || []).map(o => ({
    id: o.id,
    fragment_id: o.fragment_id,
    guard_expression: o.guard_expression,
    operand_index: o.operand_index,
  }));

  // Map sequence nodes from SequenceNodeRef to SequenceNode
  const sequence_nodes: SequenceNode[] = (content.sequenceNodes || []).map(n => ({
    id: n.id,
    node_kind: n.node_kind as SequenceNode['node_kind'],
    message_id: n.message_id,
    fragment_id: n.fragment_id,
    order_index: n.order_index,
    parent_node_id: n.parent_node_id,
    parent_operand_id: n.parent_operand_id,
  }));

  return {
    id: diagramId,
    model_file_id: modelFileId,
    name: diagramName,
    type: 'Sequence',
    participants,
    messages,
    fragments,
    operands,
    sequence_nodes,
  };
}

/**
 * Convert SequenceDiagram back to SequenceContent format for storage
 */
export function sequenceDiagramToSequenceContent(diagram: SequenceDiagram): SequenceContent {
  return {
    participants: diagram.participants.map(p => ({
      id: p.id,
      ref_kind: p.ref_kind,
      ref_id: p.ref_id,
      order_index: p.order_index,
    })),
    messages: diagram.messages.map(m => ({
      id: m.id,
      exchange_id: m.exchange_id,
      exchange_role: m.exchange_role,
      from_participant_id: m.from_participant_id,
      to_participant_id: m.to_participant_id,
      ref_kind: m.ref_kind,
      ref_id: m.ref_id,
      label_text: m.label_text,
      is_collection: m.is_collection,
      show_endpoint_name: m.show_endpoint_name,
      show_endpoint_verb_path: m.show_endpoint_verb_path,
      show_endpoint_req_res_data: m.show_endpoint_req_res_data,
      response_mode: m.response_mode,
    })),
    fragments: diagram.fragments.map(f => ({
      id: f.id,
      fragment_kind: f.fragment_kind,
      label_text: f.label_text,
    })),
    operands: diagram.operands.map(o => ({
      id: o.id,
      fragment_id: o.fragment_id,
      guard_expression: o.guard_expression,
      operand_index: o.operand_index,
    })),
    sequenceNodes: diagram.sequence_nodes.map(n => ({
      id: n.id,
      node_kind: n.node_kind,
      message_id: n.message_id,
      fragment_id: n.fragment_id,
      order_index: n.order_index,
      parent_node_id: n.parent_node_id,
      parent_operand_id: n.parent_operand_id,
    })),
  };
}

/**
 * Custom hook for managing sequence diagram state with autosave
 *
 * Task Group 7: This hook now reads from activeDiagram.typedContent.content
 * instead of calling /api/sequence-diagrams/{id}
 *
 * @param activeDiagram - The active Diagram object (null if none selected)
 * @param onUpdateDiagram - Callback to update the diagram's typedContent (for persistence)
 * @returns Hook result with state and update functions
 *
 * @example
 * ```tsx
 * const {
 *   sequenceDiagram,
 *   isLoading,
 *   isSaving,
 *   updateSequenceDiagram,
 * } = useSequenceDiagram(activeDiagram, handleUpdateDiagram);
 *
 * // Update participants (triggers autosave)
 * updateSequenceDiagram({
 *   participants: [...sequenceDiagram.participants, newParticipant],
 * });
 * ```
 */
export function useSequenceDiagram(
  activeDiagram: Diagram | null,
  onUpdateDiagram?: (updates: Partial<Diagram>) => void
): UseSequenceDiagramResult {
  // State
  const [sequenceDiagram, setSequenceDiagramState] = useState<SequenceDiagram | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for debounce timer and latest diagram state
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDiagramRef = useRef<SequenceDiagram | null>(null);
  const isMountedRef = useRef(true);

  // Keep latestDiagramRef in sync
  useEffect(() => {
    latestDiagramRef.current = sequenceDiagram;
  }, [sequenceDiagram]);

  // Track component mount status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Load sequence diagram from typedContent
   * Task Group 7: No longer calls API - reads directly from activeDiagram.typedContent
   * Task Group 2 (FE-2): Uses getDiagramType() for case-insensitive diagram_type comparison
   */
  const loadDiagram = useCallback(() => {
    // Use getDiagramType for case-insensitive comparison (FE-2 fix)
    if (!activeDiagram || getDiagramType(activeDiagram) !== 'Sequence') {
      setSequenceDiagramState(null);
      setError(null);
      setIsDirty(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Extract sequence content from typedContent
      const sequenceContent = activeDiagram.typedContent?.content as SequenceContent | undefined;

      // Convert to SequenceDiagram format
      // model_file_id is not available on Diagram interface, use empty string
      const diagram = sequenceContentToSequenceDiagram(
        activeDiagram.id,
        '', // model_file_id not available on Diagram
        activeDiagram.name,
        sequenceContent
      );

      if (isMountedRef.current) {
        setSequenceDiagramState(diagram);
        setIsDirty(false);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to load sequence diagram from typedContent';
        setError(message);
        setSequenceDiagramState(null);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeDiagram]);

  /**
   * Save the current diagram state via onUpdateDiagram callback
   * Task Group 7: No longer calls PUT API - updates typedContent on the diagram
   */
  const saveDiagram = useCallback(async () => {
    const currentDiagram = latestDiagramRef.current;
    if (!currentDiagram || !activeDiagram || !onUpdateDiagram) {
      return;
    }

    setIsSaving(true);

    try {
      // Convert SequenceDiagram back to SequenceContent
      const sequenceContent = sequenceDiagramToSequenceContent(currentDiagram);

      // Create the updated typedContent envelope
      const updatedTypedContent: TypedContentEnvelope = {
        type: 'Sequence',
        version: 1,
        content: sequenceContent,
      };

      // Update the diagram via callback (triggers diagram save)
      onUpdateDiagram({ typedContent: updatedTypedContent });

      if (isMountedRef.current) {
        setIsDirty(false);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to save sequence diagram';
        setError(message);
        // Keep dirty state true since save failed
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [activeDiagram, onUpdateDiagram]);

  /**
   * Schedule a debounced save
   */
  const scheduleSave = useCallback(() => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Schedule new save
    debounceTimerRef.current = setTimeout(() => {
      saveDiagram();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [saveDiagram]);

  /**
   * Update the sequence diagram with partial updates
   * Triggers debounced autosave
   */
  const updateSequenceDiagram = useCallback((updates: Partial<SequenceDiagram>) => {
    setSequenceDiagramState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ...updates,
      };
    });
    setIsDirty(true);
    scheduleSave();
  }, [scheduleSave]);

  /**
   * Replace the entire sequence diagram state
   * Triggers debounced autosave
   */
  const setSequenceDiagram = useCallback((diagram: SequenceDiagram) => {
    setSequenceDiagramState(diagram);
    setIsDirty(true);
    scheduleSave();
  }, [scheduleSave]);

  /**
   * Manually trigger an immediate save
   */
  const saveNow = useCallback(async () => {
    // Clear any pending debounced save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await saveDiagram();
  }, [saveDiagram]);

  /**
   * Reload the diagram from typedContent
   * Discards any unsaved changes
   */
  const reload = useCallback(async () => {
    // Clear any pending save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    loadDiagram();
  }, [loadDiagram]);

  // Load diagram on mount and when activeDiagram changes
  useEffect(() => {
    // Clear any pending save from previous diagram
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    loadDiagram();
  }, [loadDiagram]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Save any pending changes before unmount
  useEffect(() => {
    return () => {
      // If there are pending changes when unmounting, save immediately
      if (debounceTimerRef.current && latestDiagramRef.current && activeDiagram && onUpdateDiagram) {
        clearTimeout(debounceTimerRef.current);

        // Convert and save synchronously
        const sequenceContent = sequenceDiagramToSequenceContent(latestDiagramRef.current);
        const updatedTypedContent: TypedContentEnvelope = {
          type: 'Sequence',
          version: 1,
          content: sequenceContent,
        };

        // Fire and forget - we're unmounting anyway
        try {
          onUpdateDiagram({ typedContent: updatedTypedContent });
        } catch {
          // Ignore errors during cleanup
        }
      }
    };
  }, [activeDiagram, onUpdateDiagram]);

  return {
    sequenceDiagram,
    isLoading,
    isSaving,
    isDirty,
    error,
    updateSequenceDiagram,
    setSequenceDiagram,
    saveNow,
    reload,
  };
}

export default useSequenceDiagram;
