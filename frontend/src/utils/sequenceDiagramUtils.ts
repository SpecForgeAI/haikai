/**
 * Sequence Diagram Utilities
 * Task Group 3: Utility functions for sequence diagram operations
 *
 * Provides helper functions for:
 * - Resolving participant labels from refKind/refId
 * - Sorting and reordering participants
 * - Managing sequence nodes
 */

import { MetaModel } from '../types/model';
import {
  SequenceParticipant,
  SequenceDiagram,
  SequenceMessage,
  ParticipantRefKind,
} from '../types/sequenceDiagram';

/**
 * Resolves a participant label from its refKind and refId by looking up the
 * referenced entity in the meta-model.
 *
 * @param participant - The sequence participant to resolve the label for
 * @param metaModel - The meta-model containing all entities
 * @returns The resolved entity name or a fallback label
 *
 * @example
 * ```ts
 * const label = resolveParticipantLabel(participant, metaModel);
 * // Returns "User Service" if the participant references a service with that name
 * ```
 */
export function resolveParticipantLabel(
  participant: SequenceParticipant,
  metaModel: MetaModel | null | undefined
): string {
  if (!metaModel) {
    return 'Unknown Participant';
  }

  const { ref_kind, ref_id } = participant;

  if (!ref_kind || !ref_id) {
    return 'Unknown Participant';
  }

  // Look up entity by refKind/refId
  switch (ref_kind) {
    case 'BusinessUser': {
      const entity = metaModel.entities.business_users?.find(e => e.id === ref_id);
      return entity?.name || `BusinessUser:${ref_id}`;
    }
    case 'Application': {
      const entity = metaModel.entities.applications?.find(e => e.id === ref_id);
      return entity?.name || `Application:${ref_id}`;
    }
    case 'ApplicationComponent': {
      const entity = metaModel.entities.app_components?.find(e => e.id === ref_id);
      return entity?.name || `AppComponent:${ref_id}`;
    }
    case 'Service': {
      const entity = metaModel.entities.services?.find(e => e.id === ref_id);
      return entity?.name || `Service:${ref_id}`;
    }
    case 'Interface': {
      const entity = metaModel.entities.interfaces?.find(e => e.id === ref_id);
      return entity?.name || `Interface:${ref_id}`;
    }
    case 'InterfaceEndpoint': {
      const entity = metaModel.entities.endpoints?.find(e => e.id === ref_id);
      return entity?.name || `Endpoint:${ref_id}`;
    }
    case 'Class': {
      const entity = metaModel.entities.classes?.find(e => e.id === ref_id);
      return entity?.name || `Class:${ref_id}`;
    }
    default:
      return `${ref_kind}:${ref_id}`;
  }
}

/**
 * Resolves a message label from its refKind/refId or label_text.
 * Messages can either reference an entity (Method, LogicalEntity, etc.) or have free-text.
 *
 * @param message - The sequence message to resolve the label for
 * @param metaModel - The meta-model containing all entities
 * @returns The resolved message label
 */
export function resolveMessageLabel(
  message: SequenceMessage,
  metaModel: MetaModel | null | undefined
): string {
  // If label_text is set, use it directly
  if (message.label_text) {
    return message.label_text;
  }

  if (!metaModel || !message.ref_kind || !message.ref_id) {
    return 'Message';
  }

  // Look up entity by refKind/refId
  switch (message.ref_kind) {
    case 'Method': {
      const entity = metaModel.entities.methods?.find(e => e.id === message.ref_id);
      return entity?.name || `Method:${message.ref_id}`;
    }
    case 'LogicalEntity': {
      const entity = metaModel.entities.logical_data_entities?.find(e => e.id === message.ref_id);
      return entity?.name || `LogicalEntity:${message.ref_id}`;
    }
    case 'PhysicalEntity': {
      const entity = metaModel.entities.physical_data_entities?.find(e => e.id === message.ref_id);
      return entity?.name || `PhysicalEntity:${message.ref_id}`;
    }
    case 'Class': {
      const entity = metaModel.entities.classes?.find(e => e.id === message.ref_id);
      return entity?.name || `Class:${message.ref_id}`;
    }
    case 'Event': {
      const entity = metaModel.entities.events?.find(e => e.id === message.ref_id);
      return entity?.name || `Event:${message.ref_id}`;
    }
    case 'Interface': {
      const entity = metaModel.entities.interfaces?.find(e => e.id === message.ref_id);
      return entity?.name || `Interface:${message.ref_id}`;
    }
    case 'InterfaceEndpoint': {
      const entity = metaModel.entities.endpoints?.find(e => e.id === message.ref_id);
      return entity?.name || `InterfaceEndpoint:${message.ref_id}`;
    }
    default:
      return `${message.ref_kind}:${message.ref_id}`;
  }
}

/**
 * Gets reference options for a given participant ref_kind from the meta-model.
 * Used to populate dropdown options in the AddParticipantDrawer.
 *
 * @param refKind - The participant reference kind
 * @param metaModel - The meta-model containing all entities
 * @returns Array of id/name pairs for dropdown options
 */
export function getParticipantReferenceOptions(
  refKind: ParticipantRefKind | string,
  metaModel: MetaModel | null | undefined
): Array<{ id: string; name: string }> {
  if (!metaModel || !refKind) return [];

  switch (refKind) {
    case 'BusinessUser':
      return metaModel.entities.business_users?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'Application':
      return metaModel.entities.applications?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'ApplicationComponent':
      return metaModel.entities.app_components?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'Service':
      return metaModel.entities.services?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'Interface':
      return metaModel.entities.interfaces?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'InterfaceEndpoint':
      return metaModel.entities.endpoints?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'Class':
      return metaModel.entities.classes?.map(e => ({ id: e.id, name: e.name })) || [];
    default:
      return [];
  }
}

/**
 * Sorts participants by order_index ascending.
 *
 * @param participants - Array of participants to sort
 * @returns New sorted array (does not mutate original)
 */
export function sortParticipantsByOrder(
  participants: SequenceParticipant[]
): SequenceParticipant[] {
  return [...participants].sort((a, b) => a.order_index - b.order_index);
}

/**
 * Gets the next available order_index for a new participant.
 *
 * @param participants - Current array of participants
 * @returns The next order_index value
 */
export function getNextParticipantOrderIndex(
  participants: SequenceParticipant[]
): number {
  if (participants.length === 0) return 0;
  const maxIndex = Math.max(...participants.map(p => p.order_index));
  return maxIndex + 1;
}

/**
 * Generates a unique ID for a new participant.
 *
 * @returns A unique participant ID
 */
export function generateParticipantId(): string {
  return `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates a new participant with the given refKind and refId.
 *
 * @param refKind - The reference kind for the participant
 * @param refId - The reference ID for the participant
 * @param participants - Current array of participants (for order_index)
 * @returns A new SequenceParticipant object
 */
export function createParticipant(
  refKind: ParticipantRefKind,
  refId: string,
  participants: SequenceParticipant[]
): SequenceParticipant {
  return {
    id: generateParticipantId(),
    ref_kind: refKind,
    ref_id: refId,
    order_index: getNextParticipantOrderIndex(participants),
  };
}

/**
 * Moves a participant up in the order (decreases order_index).
 * Returns a new array with updated order_index values.
 *
 * @param participants - Current array of participants
 * @param participantId - ID of the participant to move up
 * @returns New array with updated order_index values
 */
export function moveParticipantUp(
  participants: SequenceParticipant[],
  participantId: string
): SequenceParticipant[] {
  const sorted = sortParticipantsByOrder(participants);
  const index = sorted.findIndex(p => p.id === participantId);

  if (index <= 0) return participants; // Cannot move up if first or not found

  // Swap order_index with previous participant
  const updated = [...sorted];
  const temp = updated[index].order_index;
  updated[index] = { ...updated[index], order_index: updated[index - 1].order_index };
  updated[index - 1] = { ...updated[index - 1], order_index: temp };

  return updated;
}

/**
 * Moves a participant down in the order (increases order_index).
 * Returns a new array with updated order_index values.
 *
 * @param participants - Current array of participants
 * @param participantId - ID of the participant to move down
 * @returns New array with updated order_index values
 */
export function moveParticipantDown(
  participants: SequenceParticipant[],
  participantId: string
): SequenceParticipant[] {
  const sorted = sortParticipantsByOrder(participants);
  const index = sorted.findIndex(p => p.id === participantId);

  if (index < 0 || index >= sorted.length - 1) return participants; // Cannot move down if last or not found

  // Swap order_index with next participant
  const updated = [...sorted];
  const temp = updated[index].order_index;
  updated[index] = { ...updated[index], order_index: updated[index + 1].order_index };
  updated[index + 1] = { ...updated[index + 1], order_index: temp };

  return updated;
}

/**
 * Reindexes participants to have sequential order_index values (0, 1, 2, ...).
 * Useful after deletions or bulk operations.
 *
 * @param participants - Array of participants to reindex
 * @returns New array with sequential order_index values
 */
export function reindexParticipants(
  participants: SequenceParticipant[]
): SequenceParticipant[] {
  const sorted = sortParticipantsByOrder(participants);
  return sorted.map((p, index) => ({
    ...p,
    order_index: index,
  }));
}

/**
 * Adds a new participant to the sequence diagram and updates local state.
 *
 * @param diagram - The current sequence diagram
 * @param refKind - The reference kind for the new participant
 * @param refId - The reference ID for the new participant
 * @returns Updated sequence diagram with the new participant
 */
export function addParticipantToDiagram(
  diagram: SequenceDiagram,
  refKind: ParticipantRefKind,
  refId: string
): SequenceDiagram {
  const newParticipant = createParticipant(refKind, refId, diagram.participants);

  return {
    ...diagram,
    participants: [...diagram.participants, newParticipant],
  };
}

/**
 * Removes a participant from the sequence diagram.
 *
 * @param diagram - The current sequence diagram
 * @param participantId - ID of the participant to remove
 * @returns Updated sequence diagram without the participant
 */
export function removeParticipantFromDiagram(
  diagram: SequenceDiagram,
  participantId: string
): SequenceDiagram {
  const filteredParticipants = diagram.participants.filter(p => p.id !== participantId);

  return {
    ...diagram,
    participants: reindexParticipants(filteredParticipants),
  };
}

/**
 * Moves a participant up in the diagram's participant list.
 *
 * @param diagram - The current sequence diagram
 * @param participantId - ID of the participant to move up
 * @returns Updated sequence diagram with reordered participants
 */
export function moveParticipantUpInDiagram(
  diagram: SequenceDiagram,
  participantId: string
): SequenceDiagram {
  return {
    ...diagram,
    participants: moveParticipantUp(diagram.participants, participantId),
  };
}

/**
 * Moves a participant down in the diagram's participant list.
 *
 * @param diagram - The current sequence diagram
 * @param participantId - ID of the participant to move down
 * @returns Updated sequence diagram with reordered participants
 */
export function moveParticipantDownInDiagram(
  diagram: SequenceDiagram,
  participantId: string
): SequenceDiagram {
  return {
    ...diagram,
    participants: moveParticipantDown(diagram.participants, participantId),
  };
}

export default {
  resolveParticipantLabel,
  resolveMessageLabel,
  getParticipantReferenceOptions,
  sortParticipantsByOrder,
  getNextParticipantOrderIndex,
  generateParticipantId,
  createParticipant,
  moveParticipantUp,
  moveParticipantDown,
  reindexParticipants,
  addParticipantToDiagram,
  removeParticipantFromDiagram,
  moveParticipantUpInDiagram,
  moveParticipantDownInDiagram,
};
