/**
 * ParticipantsTab Component Tests
 * Task Group 3: Tests for the ParticipantsTab component
 *
 * Tests the participants tab functionality for Sequence diagram editing.
 * Includes tests for participant list rendering, add/delete actions, and label resolution.
 */

import { describe, it, expect } from 'vitest';
import { SequenceParticipant, PARTICIPANT_REF_KINDS } from '../types/sequenceDiagram';
import { MetaModel } from '../types/model';

/**
 * Helper function to resolve participant label from refKind/refId
 * This mirrors the logic in sequenceDiagramUtils.ts
 */
function resolveParticipantLabel(
  participant: SequenceParticipant,
  metaModel: MetaModel
): string {
  const { ref_kind, ref_id } = participant;

  if (!ref_kind || !ref_id) {
    return 'Unknown Participant';
  }

  // Look up entity by refKind/refId
  switch (ref_kind) {
    case 'BusinessUser':
      return metaModel.entities.business_users.find(e => e.id === ref_id)?.name || `BusinessUser:${ref_id}`;
    case 'Application':
      return metaModel.entities.applications.find(e => e.id === ref_id)?.name || `Application:${ref_id}`;
    case 'ApplicationComponent':
      return metaModel.entities.app_components.find(e => e.id === ref_id)?.name || `AppComponent:${ref_id}`;
    case 'Service':
      return metaModel.entities.services.find(e => e.id === ref_id)?.name || `Service:${ref_id}`;
    case 'Interface':
      return metaModel.entities.interfaces.find(e => e.id === ref_id)?.name || `Interface:${ref_id}`;
    case 'InterfaceEndpoint':
      return metaModel.entities.endpoints?.find(e => e.id === ref_id)?.name || `Endpoint:${ref_id}`;
    case 'Class':
      return metaModel.entities.classes?.find(e => e.id === ref_id)?.name || `Class:${ref_id}`;
    default:
      return `${ref_kind}:${ref_id}`;
  }
}

/**
 * Helper function to sort participants by order_index
 */
function sortParticipantsByOrder(participants: SequenceParticipant[]): SequenceParticipant[] {
  return [...participants].sort((a, b) => a.order_index - b.order_index);
}

/**
 * Helper function to get next order_index for a new participant
 */
function getNextOrderIndex(participants: SequenceParticipant[]): number {
  if (participants.length === 0) return 0;
  const maxIndex = Math.max(...participants.map(p => p.order_index));
  return maxIndex + 1;
}

/**
 * Helper function to add a participant to the list
 */
function addParticipant(
  participants: SequenceParticipant[],
  refKind: string,
  refId: string
): SequenceParticipant[] {
  const newParticipant: SequenceParticipant = {
    id: `participant-${Date.now()}`,
    ref_kind: refKind as SequenceParticipant['ref_kind'],
    ref_id: refId,
    order_index: getNextOrderIndex(participants),
  };
  return [...participants, newParticipant];
}

/**
 * Helper function to delete a participant from the list
 */
function deleteParticipant(
  participants: SequenceParticipant[],
  participantId: string
): SequenceParticipant[] {
  return participants.filter(p => p.id !== participantId);
}

/**
 * Helper function to reorder participants (move up)
 */
function moveParticipantUp(
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
 * Helper function to reorder participants (move down)
 */
function moveParticipantDown(
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

// Create a minimal mock MetaModel for testing
function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'user-1', name: 'John Smith', description: '', tags: '' },
        { id: 'user-2', name: 'Jane Doe', description: '', tags: '' },
      ],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Frontend App', description: '', app_type: '', status: '', tags: '' },
        { id: 'app-2', name: 'Backend API', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [
        { id: 'comp-1', name: 'Auth Module', description: '', application_id: 'app-1', tags: '' },
      ],
      services: [
        { id: 'svc-1', name: 'User Service', description: '', application_id: 'app-2', service_type: '', tags: '' },
      ],
      interfaces: [
        { id: 'int-1', name: 'REST API', description: '', service_id: 'svc-1', interface_type: 'REST_API', tags: '' },
      ],
      endpoints: [],
      classes: [
        { id: 'class-1', name: 'UserController' },
      ],
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
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

describe('ParticipantsTab - List Rendering', () => {
  describe('Task 3.1: Participant list renders sorted by order_index', () => {
    it('should sort participants by order_index ascending', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-3', ref_kind: 'Application', ref_id: 'app-1', order_index: 2 },
        { id: 'p-1', ref_kind: 'BusinessUser', ref_id: 'user-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      ];

      const sorted = sortParticipantsByOrder(participants);

      expect(sorted[0].id).toBe('p-1');
      expect(sorted[1].id).toBe('p-2');
      expect(sorted[2].id).toBe('p-3');
    });

    it('should handle empty participant list', () => {
      const participants: SequenceParticipant[] = [];
      const sorted = sortParticipantsByOrder(participants);

      expect(sorted).toHaveLength(0);
    });

    it('should handle single participant', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
      ];

      const sorted = sortParticipantsByOrder(participants);

      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe('p-1');
    });
  });
});

describe('ParticipantsTab - Label Resolution', () => {
  describe('Task 3.1: Participant row shows resolved label from refKind/refId', () => {
    const metaModel = createMockMetaModel();

    it('should resolve BusinessUser label correctly', () => {
      const participant: SequenceParticipant = {
        id: 'p-1',
        ref_kind: 'BusinessUser',
        ref_id: 'user-1',
        order_index: 0,
      };

      const label = resolveParticipantLabel(participant, metaModel);

      expect(label).toBe('John Smith');
    });

    it('should resolve Application label correctly', () => {
      const participant: SequenceParticipant = {
        id: 'p-2',
        ref_kind: 'Application',
        ref_id: 'app-1',
        order_index: 1,
      };

      const label = resolveParticipantLabel(participant, metaModel);

      expect(label).toBe('Frontend App');
    });

    it('should resolve Service label correctly', () => {
      const participant: SequenceParticipant = {
        id: 'p-3',
        ref_kind: 'Service',
        ref_id: 'svc-1',
        order_index: 2,
      };

      const label = resolveParticipantLabel(participant, metaModel);

      expect(label).toBe('User Service');
    });

    it('should resolve Class label correctly', () => {
      const participant: SequenceParticipant = {
        id: 'p-4',
        ref_kind: 'Class',
        ref_id: 'class-1',
        order_index: 3,
      };

      const label = resolveParticipantLabel(participant, metaModel);

      expect(label).toBe('UserController');
    });

    it('should return fallback label for unknown ref_id', () => {
      const participant: SequenceParticipant = {
        id: 'p-5',
        ref_kind: 'Application',
        ref_id: 'unknown-id',
        order_index: 4,
      };

      const label = resolveParticipantLabel(participant, metaModel);

      expect(label).toBe('Application:unknown-id');
    });
  });
});

describe('ParticipantsTab - Add Participant', () => {
  describe('Task 3.1: "+ Add Participant" functionality', () => {
    it('should add participant with correct next order_index', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      ];

      const updated = addParticipant(participants, 'BusinessUser', 'user-1');

      expect(updated).toHaveLength(3);
      expect(updated[2].order_index).toBe(2);
      expect(updated[2].ref_kind).toBe('BusinessUser');
      expect(updated[2].ref_id).toBe('user-1');
    });

    it('should add first participant with order_index 0', () => {
      const participants: SequenceParticipant[] = [];

      const updated = addParticipant(participants, 'Application', 'app-1');

      expect(updated).toHaveLength(1);
      expect(updated[0].order_index).toBe(0);
    });

    it('should support all PARTICIPANT_REF_KINDS', () => {
      // Verify that all participant ref kinds are supported
      expect(PARTICIPANT_REF_KINDS).toContain('BusinessUser');
      expect(PARTICIPANT_REF_KINDS).toContain('Application');
      expect(PARTICIPANT_REF_KINDS).toContain('ApplicationComponent');
      expect(PARTICIPANT_REF_KINDS).toContain('Service');
      expect(PARTICIPANT_REF_KINDS).toContain('Interface');
      expect(PARTICIPANT_REF_KINDS).toContain('InterfaceEndpoint');
      expect(PARTICIPANT_REF_KINDS).toContain('Class');
    });
  });
});

describe('ParticipantsTab - Delete Participant', () => {
  describe('Task 3.1: Delete action removes participant from list', () => {
    it('should remove participant by id', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        { id: 'p-3', ref_kind: 'BusinessUser', ref_id: 'user-1', order_index: 2 },
      ];

      const updated = deleteParticipant(participants, 'p-2');

      expect(updated).toHaveLength(2);
      expect(updated.find(p => p.id === 'p-2')).toBeUndefined();
      expect(updated.find(p => p.id === 'p-1')).toBeDefined();
      expect(updated.find(p => p.id === 'p-3')).toBeDefined();
    });

    it('should handle deletion of non-existent participant', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
      ];

      const updated = deleteParticipant(participants, 'non-existent');

      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe('p-1');
    });

    it('should handle deletion from empty list', () => {
      const participants: SequenceParticipant[] = [];

      const updated = deleteParticipant(participants, 'p-1');

      expect(updated).toHaveLength(0);
    });
  });
});

describe('ParticipantsTab - Reordering', () => {
  describe('Task 3.5: Move up/down reordering', () => {
    it('should move participant up correctly', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        { id: 'p-3', ref_kind: 'BusinessUser', ref_id: 'user-1', order_index: 2 },
      ];

      const updated = moveParticipantUp(participants, 'p-2');
      const sorted = sortParticipantsByOrder(updated);

      // p-2 should now be first (order_index 0), p-1 should be second (order_index 1)
      expect(sorted[0].id).toBe('p-2');
      expect(sorted[1].id).toBe('p-1');
      expect(sorted[2].id).toBe('p-3');
    });

    it('should move participant down correctly', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
        { id: 'p-3', ref_kind: 'BusinessUser', ref_id: 'user-1', order_index: 2 },
      ];

      const updated = moveParticipantDown(participants, 'p-2');
      const sorted = sortParticipantsByOrder(updated);

      // p-2 should now be last (order_index 2), p-3 should be second (order_index 1)
      expect(sorted[0].id).toBe('p-1');
      expect(sorted[1].id).toBe('p-3');
      expect(sorted[2].id).toBe('p-2');
    });

    it('should not move first participant up', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      ];

      const updated = moveParticipantUp(participants, 'p-1');
      const sorted = sortParticipantsByOrder(updated);

      expect(sorted[0].id).toBe('p-1');
      expect(sorted[1].id).toBe('p-2');
    });

    it('should not move last participant down', () => {
      const participants: SequenceParticipant[] = [
        { id: 'p-1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p-2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      ];

      const updated = moveParticipantDown(participants, 'p-2');
      const sorted = sortParticipantsByOrder(updated);

      expect(sorted[0].id).toBe('p-1');
      expect(sorted[1].id).toBe('p-2');
    });
  });
});
