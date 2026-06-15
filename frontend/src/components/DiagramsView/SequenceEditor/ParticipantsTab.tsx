/**
 * ParticipantsTab Component
 * Task Group 3: Participants tab for Sequence diagram editor
 * Task Group 2: Extended with edit participant support
 *
 * Displays and manages sequence diagram participants (lifelines).
 * Features:
 * - List of participants sorted by order_index
 * - Each row shows resolved entity label from refKind/refId
 * - Drag handle icon for reordering (visual only in v1)
 * - Move up/down buttons for reordering
 * - Edit button per row (opens edit drawer)
 * - Delete action button per row
 * - "+ Add Participant" button opens drawer
 */

import { useState, useCallback, useMemo } from 'react';
import { Pencil, X, GripVertical } from 'lucide-react';
import { SequenceDiagram, SequenceParticipant, ParticipantRefKind } from '../../../types/sequenceDiagram';
import { MetaModel } from '../../../types/model';
import {
  resolveParticipantLabel,
  sortParticipantsByOrder,
  addParticipantToDiagram,
  removeParticipantFromDiagram,
  moveParticipantUpInDiagram,
  moveParticipantDownInDiagram,
} from '../../../utils/sequenceDiagramUtils';
import { AddParticipantDrawer } from './AddParticipantDrawer';
import type { ParticipantEditData } from './AddParticipantDrawer';
import styles from '../SequenceEditorPanel.module.css';

/**
 * Props for the ParticipantsTab component
 */
export interface ParticipantsTabProps {
  /** The sequence diagram being edited */
  sequenceDiagram: SequenceDiagram;
  /** Callback to update the sequence diagram (triggers autosave) */
  onUpdate: (updates: Partial<SequenceDiagram>) => void;
  /** The meta-model for entity resolution */
  metaModel: MetaModel | null;
}

/**
 * ParticipantsTab - Displays and manages sequence diagram participants
 */
export function ParticipantsTab({
  sequenceDiagram,
  onUpdate,
  metaModel,
}: ParticipantsTabProps) {
  // State for add participant drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // State for edit participant data (null = add mode, non-null = edit mode)
  const [editParticipantData, setEditParticipantData] = useState<ParticipantEditData | null>(null);

  // Get sorted participants
  const sortedParticipants = useMemo(
    () => sortParticipantsByOrder(sequenceDiagram.participants || []),
    [sequenceDiagram.participants]
  );

  // Handle opening the add participant drawer (add mode)
  const handleOpenDrawer = useCallback(() => {
    setEditParticipantData(null); // Clear edit data to ensure add mode
    setIsDrawerOpen(true);
  }, []);

  // Handle closing the add participant drawer
  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditParticipantData(null);
  }, []);

  // Handle adding a new participant
  const handleAddParticipant = useCallback(
    (refKind: ParticipantRefKind, refId: string) => {
      const updatedDiagram = addParticipantToDiagram(sequenceDiagram, refKind, refId);
      onUpdate({ participants: updatedDiagram.participants });
      setIsDrawerOpen(false);
    },
    [sequenceDiagram, onUpdate]
  );

  // Handle deleting a participant
  const handleDeleteParticipant = useCallback(
    (participantId: string) => {
      const updatedDiagram = removeParticipantFromDiagram(sequenceDiagram, participantId);
      onUpdate({ participants: updatedDiagram.participants });
    },
    [sequenceDiagram, onUpdate]
  );

  // Handle moving a participant up
  const handleMoveUp = useCallback(
    (participantId: string) => {
      const updatedDiagram = moveParticipantUpInDiagram(sequenceDiagram, participantId);
      onUpdate({ participants: updatedDiagram.participants });
    },
    [sequenceDiagram, onUpdate]
  );

  // Handle moving a participant down
  const handleMoveDown = useCallback(
    (participantId: string) => {
      const updatedDiagram = moveParticipantDownInDiagram(sequenceDiagram, participantId);
      onUpdate({ participants: updatedDiagram.participants });
    },
    [sequenceDiagram, onUpdate]
  );

  // Handle editing a participant: look up participant by id, set edit data, open drawer
  const handleEditParticipant = useCallback(
    (participantId: string) => {
      const participant = sequenceDiagram.participants.find(p => p.id === participantId);
      if (!participant) return;

      setEditParticipantData({
        participantId: participant.id,
        refKind: participant.ref_kind,
        refId: participant.ref_id,
      });
      setIsDrawerOpen(true);
    },
    [sequenceDiagram.participants]
  );

  // Handle updating a participant: replace ref_kind and ref_id in place, preserving id and order_index
  const handleUpdateParticipant = useCallback(
    (participantId: string, refKind: ParticipantRefKind, refId: string) => {
      const updatedParticipants = sequenceDiagram.participants.map(p => {
        if (p.id === participantId) {
          return {
            ...p,
            ref_kind: refKind,
            ref_id: refId,
          };
        }
        return p;
      });
      onUpdate({ participants: updatedParticipants });
      setIsDrawerOpen(false);
      setEditParticipantData(null);
    },
    [sequenceDiagram.participants, onUpdate]
  );

  return (
    <>
      {/* Add Participant Button */}
      <div className={styles.addButtonSection}>
        <button
          className={styles.addButton}
          onClick={handleOpenDrawer}
          data-testid="add-participant-button"
        >
          <span className={styles.addButtonIcon}>+</span>
          Add Participant
        </button>
      </div>

      {/* Participants List */}
      {sortedParticipants.length === 0 ? (
        <div className={styles.emptyState}>
          No participants yet. Add participants to define lifelines.
        </div>
      ) : (
        <ul className={styles.listContainer} data-testid="participants-list">
          {sortedParticipants.map((participant, index) => (
            <ParticipantRow
              key={participant.id}
              participant={participant}
              label={resolveParticipantLabel(participant, metaModel)}
              isFirst={index === 0}
              isLast={index === sortedParticipants.length - 1}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onEdit={handleEditParticipant}
              onDelete={handleDeleteParticipant}
            />
          ))}
        </ul>
      )}

      {/* Add/Edit Participant Drawer */}
      <AddParticipantDrawer
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        onSubmit={handleAddParticipant}
        metaModel={metaModel}
        editData={editParticipantData}
        onUpdate={handleUpdateParticipant}
      />
    </>
  );
}

/**
 * Props for the ParticipantRow component
 */
export interface ParticipantRowProps {
  /** The participant to display */
  participant: SequenceParticipant;
  /** The resolved display label for the participant */
  label: string;
  /** Whether this is the first participant in the list */
  isFirst: boolean;
  /** Whether this is the last participant in the list */
  isLast: boolean;
  /** Callback to move the participant up */
  onMoveUp: (id: string) => void;
  /** Callback to move the participant down */
  onMoveDown: (id: string) => void;
  /** Callback to edit the participant */
  onEdit: (id: string) => void;
  /** Callback to delete the participant */
  onDelete: (id: string) => void;
}

/**
 * ParticipantRow - Renders a single participant row with actions
 */
export function ParticipantRow({
  participant,
  label,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: ParticipantRowProps) {
  return (
    <li className={styles.listItem} data-testid={`participant-row-${participant.id}`}>
      {/* Drag handle (visual only) */}
      <span className={styles.dragHandle} title="Drag to reorder">
        <GripVertical size={14} />
      </span>

      {/* Participant label */}
      <span className={styles.itemLabel} title={`${participant.ref_kind}: ${label}`}>
        {label}
      </span>

      {/* Action buttons: [Edit] [Delete] */}
      <div className={styles.itemActions}>
        {/* Edit button */}
        <button
          className={styles.actionButton}
          onClick={() => onEdit(participant.id)}
          title="Edit participant"
          data-testid={`edit-${participant.id}`}
        >
          <Pencil size={14} />
        </button>

        {/* Delete button */}
        <button
          className={`${styles.actionButton} ${styles.actionButtonDanger}`}
          onClick={() => onDelete(participant.id)}
          title="Delete participant"
          data-testid={`delete-${participant.id}`}
        >
          <X size={14} />
        </button>
      </div>
    </li>
  );
}

export default ParticipantsTab;
