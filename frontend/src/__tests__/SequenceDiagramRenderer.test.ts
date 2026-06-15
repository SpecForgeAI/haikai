/**
 * SequenceDiagramRenderer.test.ts
 * Task Group 2: Tests for participant header rendering functions
 *
 * Tests the participant rendering logic in Sequence Diagrams including:
 * - Box header rendering with wrapped text (3 lines max, then ellipsis)
 * - Stickman rendering logic for BusinessUser ref_kind participants
 * - Participant name resolution via metaModel lookup with fallback to ref_id
 * - Participants sort by order_index for left-to-right positioning
 */

import { describe, it, expect } from 'vitest';
import {
  resolveParticipantName,
  wrapTextWithEllipsis,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import {
  computeSequenceLayout,
  LAYOUT_CONSTANTS,
} from '../utils/sequenceLayout';
import { SequenceDiagram, SequenceParticipant } from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

/**
 * Helper function to create a minimal MetaModel for testing
 */
function createTestMetaModel(
  applications: Array<{ id: string; name: string }> = [],
  businessUsers: Array<{ id: string; name: string }> = [],
  services: Array<{ id: string; name: string }> = []
): MetaModel {
  const entities: MetaModelEntities = {
    business_users: businessUsers.map(u => ({
      id: u.id,
      name: u.name,
      description: '',
      tags: '',
    })),
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: applications.map(a => ({
      id: a.id,
      name: a.name,
      description: '',
      tags: '',
    })),
    app_components: [],
    services: services.map(s => ({
      id: s.id,
      name: s.name,
      description: '',
      tags: '',
    })),
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
  };

  const relationships: MetaModelRelationships = {
    business_user_business_points: [],
    application_point_business_points: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  };

  return { entities, relationships };
}

/**
 * Helper function to create a minimal SequenceDiagram for testing
 */
function createTestDiagram(
  participants: SequenceParticipant[] = []
): SequenceDiagram {
  return {
    id: 'test-diagram-1',
    model_file_id: 'test-model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants,
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };
}

/**
 * Helper to create a participant
 */
function createParticipant(
  id: string,
  orderIndex: number,
  refKind: 'Application' | 'BusinessUser' | 'Service' = 'Application',
  refId: string = `ref-${id}`
): SequenceParticipant {
  return {
    id,
    ref_kind: refKind,
    ref_id: refId,
    order_index: orderIndex,
  };
}

describe('SequenceDiagramRenderer - Participant Header Rendering', () => {
  describe('Test 1: Box header rendering with wrapped text (3 lines max, then ellipsis)', () => {
    it('should wrap long text to multiple lines', () => {
      const result = wrapTextWithEllipsis(
        'This is a very long application name that needs wrapping',
        130, // maxWidth (150 - padding)
        12   // fontSize
      );

      // Should produce multiple lines
      expect(result.lines.length).toBeGreaterThan(1);
    });

    it('should add ellipsis when text exceeds 3 lines', () => {
      const result = wrapTextWithEllipsis(
        'This is an extremely long application name that definitely needs to be wrapped across multiple lines and should show ellipsis at the end because it is too long',
        130,
        12,
        3 // maxLines
      );

      // Should be capped at 3 lines
      expect(result.lines.length).toBeLessThanOrEqual(3);

      // Should have ellipsis indicator
      expect(result.truncated).toBe(true);
    });

    it('should not add ellipsis when text fits in 3 lines or fewer', () => {
      const result = wrapTextWithEllipsis(
        'Short name',
        130,
        12,
        3
      );

      expect(result.truncated).toBe(false);
      expect(result.lines.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Test 2: Stickman rendering for BusinessUser ref_kind participants', () => {
    it('should identify BusinessUser participants for stickman rendering', () => {
      const participants = [
        createParticipant('p1', 0, 'BusinessUser', 'user-1'),
        createParticipant('p2', 1, 'Application', 'app-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // Layout should preserve ref_kind for rendering decisions
      const userLayout = layout.participantLayouts.find(p => p.participantId === 'p1');
      const appLayout = layout.participantLayouts.find(p => p.participantId === 'p2');

      expect(userLayout?.refKind).toBe('BusinessUser');
      expect(appLayout?.refKind).toBe('Application');
    });

    it('should use userHeaderHeight for BusinessUser participants', () => {
      const participants = [
        createParticipant('p1', 0, 'BusinessUser', 'user-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      const userLayout = layout.participantLayouts[0];
      expect(userLayout.height).toBe(LAYOUT_CONSTANTS.userHeaderHeight);
    });

    it('should use headerBoxHeight for non-BusinessUser participants', () => {
      const participants = [
        createParticipant('p1', 0, 'Application', 'app-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      const appLayout = layout.participantLayouts[0];
      expect(appLayout.height).toBe(LAYOUT_CONSTANTS.headerBoxHeight);
    });
  });

  describe('Test 3: Participant name resolution via metaModel lookup with fallback to ref_id', () => {
    it('should resolve entity name from metaModel for Application', () => {
      const metaModel = createTestMetaModel(
        [{ id: 'app-1', name: 'My Application' }]
      );

      const name = resolveParticipantName('Application', 'app-1', metaModel);
      expect(name).toBe('My Application');
    });

    it('should resolve entity name from metaModel for BusinessUser', () => {
      const metaModel = createTestMetaModel(
        [],
        [{ id: 'user-1', name: 'John Doe' }]
      );

      const name = resolveParticipantName('BusinessUser', 'user-1', metaModel);
      expect(name).toBe('John Doe');
    });

    it('should resolve entity name from metaModel for Service', () => {
      const metaModel = createTestMetaModel(
        [],
        [],
        [{ id: 'svc-1', name: 'Payment Service' }]
      );

      const name = resolveParticipantName('Service', 'svc-1', metaModel);
      expect(name).toBe('Payment Service');
    });

    it('should fallback to ref_id when entity not found in metaModel', () => {
      const metaModel = createTestMetaModel();

      const name = resolveParticipantName('Application', 'missing-app', metaModel);
      expect(name).toBe('missing-app');
    });

    it('should fallback to ref_id when ref_kind is unknown', () => {
      const metaModel = createTestMetaModel();

      const name = resolveParticipantName('UnknownKind', 'some-id', metaModel);
      expect(name).toBe('some-id');
    });
  });

  describe('Test 4: Participants sort by order_index for left-to-right positioning', () => {
    it('should render participants in order_index order regardless of array order', () => {
      // Participants added in random order but should render sorted by order_index
      const participants = [
        createParticipant('p3', 2, 'Application', 'app-3'),
        createParticipant('p1', 0, 'Application', 'app-1'),
        createParticipant('p2', 1, 'Application', 'app-2'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // Should be sorted by order_index: p1 (0), p2 (1), p3 (2)
      expect(layout.participantLayouts[0].participantId).toBe('p1');
      expect(layout.participantLayouts[1].participantId).toBe('p2');
      expect(layout.participantLayouts[2].participantId).toBe('p3');
    });

    it('should assign increasing X positions to participants in order_index order', () => {
      const participants = [
        createParticipant('p3', 2, 'Application', 'app-3'),
        createParticipant('p1', 0, 'Application', 'app-1'),
        createParticipant('p2', 1, 'Application', 'app-2'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // X positions should increase: p1.x < p2.x < p3.x
      expect(layout.participantLayouts[0].x).toBeLessThan(layout.participantLayouts[1].x);
      expect(layout.participantLayouts[1].x).toBeLessThan(layout.participantLayouts[2].x);
    });
  });

  describe('Test 5: Lifeline rendering positions', () => {
    it('should compute lifeline at centerline of header box (participantX + headerBoxWidth/2)', () => {
      const participants = [
        createParticipant('p1', 0, 'Application', 'app-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // Header is at x=60 (leftMargin), lifeline should be at x=60+75=135
      expect(layout.participantLayouts[0].lifelineX).toBe(135);
    });

    it('should compute lifelineTopY below header area', () => {
      const participants = [
        createParticipant('p1', 0, 'Application', 'app-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineTopY = topMargin + headerAreaHeight + 10 = 40 + 70 + 10 = 120
      expect(layout.lifelineTopY).toBe(120);
    });

    it('should compute lifelineBottomY with minimum height for empty diagram', () => {
      const participants = [
        createParticipant('p1', 0, 'Application', 'app-1'),
      ];
      const diagram = createTestDiagram(participants);

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineBottomY = messageStartY + max(1, 0) * rowHeight + 60 = 150 + 60 + 60 = 270
      expect(layout.lifelineBottomY).toBe(270);
    });

    it('should extend lifelineBottomY based on message count', () => {
      const participants = [
        createParticipant('p1', 0, 'Application', 'app-1'),
        createParticipant('p2', 1, 'Application', 'app-2'),
      ];
      const diagram: SequenceDiagram = {
        ...createTestDiagram(participants),
        messages: [
          {
            id: 'm1',
            exchange_id: 'ex1',
            exchange_role: 'Request',
            from_participant_id: 'p1',
            to_participant_id: 'p2',
            label_text: 'Test message',
          },
        ],
        sequence_nodes: [
          {
            id: 'n1',
            node_kind: 'Message',
            message_id: 'm1',
            order_index: 0,
          },
        ],
      };

      const layout = computeSequenceLayout(diagram, 220);

      // lifelineBottomY = messageStartY + max(1, 1) * rowHeight + 60 = 150 + 60 + 60 = 270
      expect(layout.lifelineBottomY).toBe(270);
    });
  });
});
