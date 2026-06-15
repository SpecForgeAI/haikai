/**
 * SequenceDiagramRenderer.redraw.test.tsx
 *
 * Tests for renderer redraw rendering:
 * - Redrawn participant headers at computed Y positions
 * - Lifeline segmentation at redraw points
 * - SVG height correctness
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { SequenceDiagramRenderer, computeLifelineSegments } from '../components/DiagramsView/SequenceDiagramRenderer';
import { computeSequenceLayout, LAYOUT_CONSTANTS } from '../utils/sequenceLayout';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceNode,
} from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestMetaModel(): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [
      { id: 'app-A', name: 'App A', description: '', tags: '' },
      { id: 'app-B', name: 'App B', description: '', tags: '' },
    ],
    app_components: [],
    services: [],
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

function createParticipant(id: string, orderIndex: number): SequenceParticipant {
  return { id, ref_kind: 'Application', ref_id: `app-${id}`, order_index: orderIndex };
}

function createMessage(id: string, fromId: string, toId: string): SequenceMessage {
  return {
    id,
    exchange_id: `ex-${id}`,
    exchange_role: 'Request',
    from_participant_id: fromId,
    to_participant_id: toId,
    label_text: `msg-${id}`,
  };
}

function msgNode(nodeId: string, messageId: string, orderIndex: number): SequenceNode {
  return {
    id: nodeId,
    node_kind: 'Message',
    message_id: messageId,
    order_index: orderIndex,
  };
}

/**
 * Creates a tall diagram with N messages (enough to trigger redraws).
 */
function createTallDiagram(messageCount: number): SequenceDiagram {
  const participants = [createParticipant('A', 0), createParticipant('B', 1)];
  const messages: SequenceMessage[] = [];
  const nodes: SequenceNode[] = [];

  for (let i = 0; i < messageCount; i++) {
    const msgId = `m${i}`;
    messages.push(createMessage(msgId, 'A', 'B'));
    nodes.push(msgNode(`n${i}`, msgId, i));
  }

  return {
    id: 'sd-1',
    model_file_id: 'mf-1',
    name: 'Tall Diagram',
    type: 'Sequence',
    participants,
    messages,
    fragments: [],
    operands: [],
    sequence_nodes: nodes,
  };
}

/**
 * Creates a short diagram (few messages, no redraws expected).
 */
function createShortDiagram(): SequenceDiagram {
  return {
    id: 'sd-short',
    model_file_id: 'mf-1',
    name: 'Short Diagram',
    type: 'Sequence',
    participants: [createParticipant('A', 0), createParticipant('B', 1)],
    messages: [createMessage('m1', 'A', 'B'), createMessage('m2', 'B', 'A')],
    fragments: [],
    operands: [],
    sequence_nodes: [msgNode('n1', 'm1', 0), msgNode('n2', 'm2', 1)],
  };
}

const headerAreaHeight = Math.max(LAYOUT_CONSTANTS.headerBoxHeight, LAYOUT_CONSTANTS.userHeaderHeight);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SequenceDiagramRenderer redraw rendering', () => {
  const metaModel = createTestMetaModel();

  it('Test 1: No extra ParticipantHeader components when participantRedrawYPositions is empty', () => {
    const diagram = createShortDiagram();
    const { container } = render(
      <svg>
        <SequenceDiagramRenderer
          sequenceDiagram={diagram}
          participantSpacing={220}
          metaModel={metaModel}
        />
      </svg>
    );

    // Should have exactly 2 participant groups (one per participant)
    const participantGroups = container.querySelectorAll('.sequence-participant');
    expect(participantGroups.length).toBe(2);
  });

  it('Test 2: One redraw position produces a full set of participant headers at the redraw Y', () => {
    // 20 messages: row 17 at Y=150+17*60=1170, 1170-40=1130 >= 1000 threshold
    const diagram = createTallDiagram(20);
    const layout = computeSequenceLayout(diagram, 220);

    // Verify we have at least one redraw position
    expect(layout.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    const { container } = render(
      <svg>
        <SequenceDiagramRenderer
          sequenceDiagram={diagram}
          participantSpacing={220}
          metaModel={metaModel}
        />
      </svg>
    );

    // Should have original (2) + redrawn (2 per redraw position) participant groups
    const participantGroups = container.querySelectorAll('.sequence-participant');
    const expectedCount = 2 + layout.participantRedrawYPositions.length * 2;
    expect(participantGroups.length).toBe(expectedCount);
  });

  it('Test 3: Redrawn headers have correct unique keys incorporating redraw index', () => {
    const diagram = createTallDiagram(20);
    const layout = computeSequenceLayout(diagram, 220);
    expect(layout.participantRedrawYPositions.length).toBeGreaterThanOrEqual(1);

    const { container } = render(
      <svg>
        <SequenceDiagramRenderer
          sequenceDiagram={diagram}
          participantSpacing={220}
          metaModel={metaModel}
        />
      </svg>
    );

    // Redrawn headers should have different Y positions from originals
    const allRects = container.querySelectorAll('.sequence-participant rect');

    // Original headers are at y=40 (topMargin)
    const originalY = LAYOUT_CONSTANTS.topMargin;
    const rectYValues = Array.from(allRects).map(r => Number(r.getAttribute('y')));

    // Should have rects at the original Y and at redraw Y positions
    const originalRects = rectYValues.filter(y => y === originalY);
    expect(originalRects.length).toBe(2); // 2 original participants

    // Redraw Y rects
    for (const redrawY of layout.participantRedrawYPositions) {
      const redrawRects = rectYValues.filter(y => y === redrawY);
      expect(redrawRects.length).toBe(2); // 2 participants at each redraw Y
    }
  });

  it('Test 4: Lifeline is segmented into correct intervals (gap at each redraw header)', () => {
    const lifelineTopY = 120;
    const lifelineBottomY = 2500;
    const redrawPositions = [1100, 2200];
    const redrawBlockHeight = headerAreaHeight + 20; // 70 + 20 = 90

    const segments = computeLifelineSegments(lifelineTopY, lifelineBottomY, redrawPositions);

    // Should have 3 segments:
    // [120, 1100], [1100+90=1190, 2200], [2200+90=2290, 2500]
    expect(segments.length).toBe(3);
    expect(segments[0]).toEqual({ topY: 120, bottomY: 1100 });
    expect(segments[1]).toEqual({ topY: 1190, bottomY: 2200 });
    expect(segments[2]).toEqual({ topY: 2290, bottomY: 2500 });
  });

  it('Test 5: Lifeline segments do not overlap with redrawn header bounding boxes', () => {
    const lifelineTopY = 120;
    const lifelineBottomY = 3000;
    const redrawPositions = [1000, 2000];
    const redrawBlockHeight = headerAreaHeight + 20;

    const segments = computeLifelineSegments(lifelineTopY, lifelineBottomY, redrawPositions);

    for (const redrawY of redrawPositions) {
      const headerTop = redrawY;
      const headerBottom = redrawY + redrawBlockHeight;

      for (const seg of segments) {
        // No segment should overlap with the header bounding box
        const overlaps = seg.topY < headerBottom && seg.bottomY > headerTop;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('Test 6: SVG total height accounts for all inserted vertical space', () => {
    const diagram = createTallDiagram(20);
    const layoutWithRedraw = computeSequenceLayout(diagram, 220);

    const numRedraws = layoutWithRedraw.participantRedrawYPositions.length;
    expect(numRedraws).toBeGreaterThanOrEqual(1);

    // Each redraw inserts (headerAreaHeight + 20) of vertical space
    const insertedSpace = numRedraws * (headerAreaHeight + 20);

    // The lifelineBottomY should be greater than the last message Y
    const lastMessageY = layoutWithRedraw.messageLayouts[layoutWithRedraw.messageLayouts.length - 1]?.y ?? 0;
    expect(layoutWithRedraw.lifelineBottomY).toBeGreaterThan(lastMessageY);

    // lifelineBottomY should include the inserted space
    // Base lifelineBottomY (without redraws) = messageStartY + max(1, rowCount) * rowHeight + 60
    // With 20 messages that's 150 + 20*60 + 60 = 1410
    // With redraws, it should be 1410 + insertedSpace
    const baseLifelineBottomY = 150 + 20 * 60 + 60; // 1410
    expect(layoutWithRedraw.lifelineBottomY).toBe(baseLifelineBottomY + insertedSpace);
  });
});

describe('computeLifelineSegments', () => {
  it('returns single segment when no redraw positions', () => {
    const segments = computeLifelineSegments(100, 500, []);
    expect(segments).toEqual([{ topY: 100, bottomY: 500 }]);
  });
});
