/**
 * SequenceDiagramIntegration.test.ts
 * Task Group 10: Strategic Integration Tests for Sequence Diagram Canvas Rendering
 *
 * These tests verify end-to-end workflows that span multiple components:
 * - Layout calculation -> Rendering -> Live updates
 * - Complete workflow: add participant -> see on canvas
 * - Complete workflow: add message -> see arrow with correct style
 * - Complete workflow: add fragment -> see frame with guard
 *
 * Focus: Integration points between layout -> render -> update pipeline
 */

import { describe, it, expect } from 'vitest';
import {
  computeSequenceLayout,
  LAYOUT_CONSTANTS,
  SequenceLayoutResult,
} from '../utils/sequenceLayout';
import {
  resolveParticipantName,
  resolveMessageLabel,
  getMessageStrokeStyle,
  shouldRenderMessage,
  wrapTextWithEllipsis,
  getFragmentLabel,
} from '../components/DiagramsView/SequenceDiagramRenderer';
import {
  SequenceDiagram,
  SequenceParticipant,
  SequenceMessage,
  SequenceFragment,
  SequenceOperand,
  SequenceNode,
} from '../types/sequenceDiagram';
import { MetaModel, MetaModelEntities, MetaModelRelationships } from '../types/model';
import {
  PARTICIPANT_SPACING_DEFAULT,
  clampParticipantSpacing,
  getParticipantSpacingFromSettings,
  createSettingsWithParticipantSpacing,
} from '../utils/participantSpacingUtils';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestMetaModel(overrides: Partial<MetaModelEntities> = {}): MetaModel {
  const entities: MetaModelEntities = {
    business_users: [
      { id: 'user-1', name: 'Alice Customer', description: '', tags: '' },
    ],
    applications: [
      { id: 'app-1', name: 'Web Portal', description: '', tags: '' },
      { id: 'app-2', name: 'API Gateway', description: '', tags: '' },
      { id: 'app-3', name: 'Payment Service', description: '', tags: '' },
    ],
    services: [
      { id: 'svc-1', name: 'Authentication Service', description: '', tags: '' },
    ],
    methods: [
      { id: 'method-1', name: 'processPayment', description: '', tags: '' },
      { id: 'method-2', name: 'validateToken', description: '', tags: '' },
    ],
    events: [
      { id: 'event-1', name: 'PaymentCompleted', description: '', tags: '' },
    ],
    business_processes: [],
    process_activities: [],
    business_points: [],
    app_components: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
    ...overrides,
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

function createMessage(
  id: string,
  fromId: string,
  toId: string,
  exchangeRole: 'Request' | 'Response' = 'Request',
  options: { refKind?: 'Method' | 'Event'; refId?: string; labelText?: string } = {}
): SequenceMessage {
  const message: SequenceMessage = {
    id,
    exchange_id: `exchange-${id}`,
    exchange_role: exchangeRole,
    from_participant_id: fromId,
    to_participant_id: toId,
  };
  if (options.refKind && options.refId) {
    message.ref_kind = options.refKind;
    message.ref_id = options.refId;
  } else if (options.labelText) {
    message.label_text = options.labelText;
  }
  return message;
}

function createFragment(
  id: string,
  fragmentKind: 'Loop' | 'Optional' | 'Alternative' = 'Loop'
): SequenceFragment {
  return {
    id,
    fragment_kind: fragmentKind,
  };
}

function createOperand(
  id: string,
  fragmentId: string,
  operandIndex: number,
  guardExpression: string
): SequenceOperand {
  return {
    id,
    fragment_id: fragmentId,
    guard_expression: guardExpression,
    operand_index: operandIndex,
  };
}

function createMessageNode(
  id: string,
  messageId: string,
  orderIndex: number,
  parentNodeId?: string,
  parentOperandId?: string
): SequenceNode {
  return {
    id,
    node_kind: 'Message',
    message_id: messageId,
    order_index: orderIndex,
    parent_node_id: parentNodeId,
    parent_operand_id: parentOperandId,
  };
}

function createFragmentNode(
  id: string,
  fragmentId: string,
  orderIndex: number
): SequenceNode {
  return {
    id,
    node_kind: 'Fragment',
    fragment_id: fragmentId,
    order_index: orderIndex,
  };
}

function createTestDiagram(overrides: Partial<SequenceDiagram> = {}): SequenceDiagram {
  return {
    id: 'test-diagram-1',
    model_file_id: 'test-model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants: [],
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
    ...overrides,
  };
}

// ============================================================================
// Integration Test 1: Complete Workflow - Add Participant -> See on Canvas
// ============================================================================

describe('Integration Test 1: Add Participant -> See on Canvas', () => {
  it('should compute layout and resolve name when participant is added', () => {
    const metaModel = createTestMetaModel();

    // Step 1: Add a BusinessUser participant
    const participant = createParticipant('p1', 0, 'BusinessUser', 'user-1');
    const diagram = createTestDiagram({
      participants: [participant],
    });

    // Step 2: Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Step 3: Resolve name from metaModel
    const displayName = resolveParticipantName(
      participant.ref_kind,
      participant.ref_id,
      metaModel
    );

    // Verify layout is computed correctly
    expect(layout.participantLayouts).toHaveLength(1);
    expect(layout.participantLayouts[0].participantId).toBe('p1');
    expect(layout.participantLayouts[0].refKind).toBe('BusinessUser');
    expect(layout.participantLayouts[0].x).toBe(LAYOUT_CONSTANTS.leftMargin);
    expect(layout.participantLayouts[0].lifelineX).toBe(
      LAYOUT_CONSTANTS.leftMargin + LAYOUT_CONSTANTS.headerBoxWidth / 2
    );

    // Verify name is resolved from metaModel
    expect(displayName).toBe('Alice Customer');

    // Verify lifeline extends correctly
    expect(layout.lifelineTopY).toBeGreaterThan(layout.participantLayouts[0].y);
    expect(layout.lifelineBottomY).toBeGreaterThan(layout.lifelineTopY);
  });

  it('should handle multiple participants with correct left-to-right ordering', () => {
    const metaModel = createTestMetaModel();

    // Add 3 participants in non-sequential order
    const participants = [
      createParticipant('p3', 2, 'Application', 'app-3'),
      createParticipant('p1', 0, 'BusinessUser', 'user-1'),
      createParticipant('p2', 1, 'Application', 'app-1'),
    ];
    const diagram = createTestDiagram({ participants });

    // Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Verify participants are sorted by order_index
    expect(layout.participantLayouts[0].participantId).toBe('p1');
    expect(layout.participantLayouts[1].participantId).toBe('p2');
    expect(layout.participantLayouts[2].participantId).toBe('p3');

    // Verify X positions increase left-to-right
    expect(layout.participantLayouts[0].x).toBeLessThan(layout.participantLayouts[1].x);
    expect(layout.participantLayouts[1].x).toBeLessThan(layout.participantLayouts[2].x);

    // Verify all names resolve correctly
    expect(resolveParticipantName('BusinessUser', 'user-1', metaModel)).toBe('Alice Customer');
    expect(resolveParticipantName('Application', 'app-1', metaModel)).toBe('Web Portal');
    expect(resolveParticipantName('Application', 'app-3', metaModel)).toBe('Payment Service');
  });
});

// ============================================================================
// Integration Test 2: Complete Workflow - Add Message -> See Arrow with Style
// ============================================================================

describe('Integration Test 2: Add Message -> See Arrow with Correct Style', () => {
  it('should compute message layout and apply correct Request style', () => {
    const metaModel = createTestMetaModel();

    // Create diagram with participants and a Request message
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2', 'Request', { refKind: 'Method', refId: 'method-1' }),
    ];
    const nodes = [createMessageNode('n1', 'm1', 0)];
    const diagram = createTestDiagram({ participants, messages, sequence_nodes: nodes });

    // Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Get message layout
    expect(layout.messageLayouts).toHaveLength(1);
    const messageLayout = layout.messageLayouts[0];

    // Verify message position
    expect(messageLayout.fromX).toBe(layout.participantLayouts[0].lifelineX);
    expect(messageLayout.toX).toBe(layout.participantLayouts[1].lifelineX);
    expect(messageLayout.y).toBe(layout.messageStartY);

    // Verify Request style (solid line)
    const style = getMessageStrokeStyle('Request');
    expect(style.strokeDasharray).toBe('');
    expect(style.strokeWidth).toBeGreaterThan(0);

    // Verify label resolution from metaModel
    const label = resolveMessageLabel(messages[0], metaModel);
    expect(label).toBe('processPayment');

    // Verify message can be rendered (participants exist)
    const participantIdSet = new Set(participants.map(p => p.id));
    const renderCheck = shouldRenderMessage(messages[0], participantIdSet);
    expect(renderCheck.shouldRender).toBe(true);
  });

  it('should apply correct Response style (dashed line)', () => {
    const metaModel = createTestMetaModel();

    // Create diagram with Response message
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'getUser' }),
      createMessage('m2', 'p2', 'p1', 'Response', { refKind: 'Event', refId: 'event-1' }),
    ];
    const nodes = [
      createMessageNode('n1', 'm1', 0),
      createMessageNode('n2', 'm2', 1),
    ];
    const diagram = createTestDiagram({ participants, messages, sequence_nodes: nodes });

    // Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Verify Response message layout
    expect(layout.messageLayouts).toHaveLength(2);
    const responseLayout = layout.messageLayouts[1];

    // Response goes from p2 to p1 (right to left)
    expect(responseLayout.fromX).toBe(layout.participantLayouts[1].lifelineX);
    expect(responseLayout.toX).toBe(layout.participantLayouts[0].lifelineX);
    expect(responseLayout.y).toBeGreaterThan(layout.messageLayouts[0].y);

    // Verify Response style (dashed line)
    const style = getMessageStrokeStyle('Response');
    expect(style.strokeDasharray).toBe('6,4');

    // Verify label resolution
    const label = resolveMessageLabel(messages[1], metaModel);
    expect(label).toBe('PaymentCompleted');
  });
});

// ============================================================================
// Integration Test 3: Complete Workflow - Add Fragment -> See Frame with Guard
// ============================================================================

describe('Integration Test 3: Add Fragment -> See Frame with Guard', () => {
  it('should compute fragment frame and display guard for Loop fragment', () => {
    // Create diagram with Loop fragment containing messages
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'processItem' }),
    ];
    const fragments = [createFragment('f1', 'Loop')];
    const operands = [createOperand('op1', 'f1', 0, 'i < items.length')];
    const nodes = [
      createFragmentNode('fn1', 'f1', 0),
      createMessageNode('n1', 'm1', 0, 'fn1', 'op1'),
    ];
    const diagram = createTestDiagram({
      participants,
      messages,
      fragments,
      operands,
      sequence_nodes: nodes,
    });

    // Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Verify fragment layout
    expect(layout.fragmentLayouts).toHaveLength(1);
    const fragmentLayout = layout.fragmentLayouts[0];

    // Verify fragment spans all lifelines
    expect(fragmentLayout.leftX).toBeLessThan(layout.participantLayouts[0].lifelineX);
    expect(fragmentLayout.rightX).toBeGreaterThan(layout.participantLayouts[1].lifelineX);

    // Verify fragment contains the message vertically
    const messageLayout = layout.messageLayouts[0];
    expect(fragmentLayout.topY).toBeLessThan(messageLayout.y);
    expect(fragmentLayout.bottomY).toBeGreaterThan(messageLayout.y);

    // Verify fragment label
    expect(getFragmentLabel('Loop')).toBe('loop');

    // Verify operand guard expression is available
    expect(fragmentLayout.operands).toHaveLength(1);
    expect(fragmentLayout.operands[0].guardExpression).toBe('i < items.length');
  });

  it('should handle Alternative fragment with multiple operand regions', () => {
    // Create diagram with Alternative fragment and 2 operands
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'success' }),
      createMessage('m2', 'p1', 'p2', 'Request', { labelText: 'error' }),
    ];
    const fragments = [createFragment('f1', 'Alternative')];
    const operands = [
      createOperand('op1', 'f1', 0, 'status == 200'),
      createOperand('op2', 'f1', 1, 'else'),
    ];
    const nodes = [
      createFragmentNode('fn1', 'f1', 0),
      createMessageNode('n1', 'm1', 0, 'fn1', 'op1'),
      createMessageNode('n2', 'm2', 1, 'fn1', 'op2'),
    ];
    const diagram = createTestDiagram({
      participants,
      messages,
      fragments,
      operands,
      sequence_nodes: nodes,
    });

    // Compute layout
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    // Verify fragment layout
    expect(layout.fragmentLayouts).toHaveLength(1);
    const fragmentLayout = layout.fragmentLayouts[0];

    // Verify fragment label is 'alt'
    expect(getFragmentLabel('Alternative')).toBe('alt');

    // Verify both operands are present
    expect(fragmentLayout.operands).toHaveLength(2);
    expect(fragmentLayout.operands[0].guardExpression).toBe('status == 200');
    expect(fragmentLayout.operands[1].guardExpression).toBe('else');

    // Verify operands are sorted by operandIndex
    expect(fragmentLayout.operands[0].operandIndex).toBe(0);
    expect(fragmentLayout.operands[1].operandIndex).toBe(1);
  });
});

// ============================================================================
// Integration Test 4: Participant Spacing Changes -> Layout Updates
// ============================================================================

describe('Integration Test 4: Spacing Changes -> Layout Updates', () => {
  it('should update all layout positions when participantSpacing changes', () => {
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
      createParticipant('p2', 1, 'Application', 'app-2'),
      createParticipant('p3', 2, 'Application', 'app-3'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'p2', 'Request', { labelText: 'call1' }),
      createMessage('m2', 'p2', 'p3', 'Request', { labelText: 'call2' }),
    ];
    const fragments = [createFragment('f1', 'Loop')];
    const operands = [createOperand('op1', 'f1', 0, 'condition')];
    const nodes = [
      createFragmentNode('fn1', 'f1', 0),
      createMessageNode('n1', 'm1', 0, 'fn1', 'op1'),
      createMessageNode('n2', 'm2', 1, 'fn1', 'op1'),
    ];
    const diagram = createTestDiagram({
      participants,
      messages,
      fragments,
      operands,
      sequence_nodes: nodes,
    });

    // Compute layout with default spacing
    const layout220 = computeSequenceLayout(diagram, 220);

    // Compute layout with increased spacing
    const layout400 = computeSequenceLayout(diagram, 400);

    // Verify participant X positions change
    expect(layout400.participantLayouts[1].x).toBeGreaterThan(layout220.participantLayouts[1].x);
    expect(layout400.participantLayouts[2].x).toBeGreaterThan(layout220.participantLayouts[2].x);

    // Verify message toX positions change (arrows get longer)
    expect(layout400.messageLayouts[0].toX).toBeGreaterThan(layout220.messageLayouts[0].toX);

    // Verify fragment rightX changes (frame gets wider)
    expect(layout400.fragmentLayouts[0].rightX).toBeGreaterThan(layout220.fragmentLayouts[0].rightX);

    // Verify positions that should NOT change (left edge stays anchored)
    expect(layout400.participantLayouts[0].x).toBe(layout220.participantLayouts[0].x);
    expect(layout400.fragmentLayouts[0].leftX).toBe(layout220.fragmentLayouts[0].leftX);
  });

  it('should integrate with settings persistence for spacing', () => {
    // Simulate reading spacing from settings
    const settings = { sequence: { participantSpacing: 350 } };
    const spacingFromSettings = getParticipantSpacingFromSettings(settings);
    expect(spacingFromSettings).toBe(350);

    // Simulate updating settings
    const newSettings = createSettingsWithParticipantSpacing(settings, 450);
    expect(newSettings.sequence.participantSpacing).toBe(450);

    // Verify clamping works in integration
    const clampedSettings = createSettingsWithParticipantSpacing(undefined, 1000);
    expect(clampedSettings.sequence.participantSpacing).toBe(600); // MAX

    // Verify the clamped value produces valid layout
    const layout = computeSequenceLayout(
      createTestDiagram({
        participants: [
          createParticipant('p1', 0, 'Application', 'app-1'),
          createParticipant('p2', 1, 'Application', 'app-2'),
        ],
      }),
      clampedSettings.sequence.participantSpacing
    );
    expect(layout.participantLayouts[1].x).toBe(
      LAYOUT_CONSTANTS.leftMargin + 600 // MAX spacing
    );
  });
});

// ============================================================================
// Integration Test 5: Empty and Edge Cases
// ============================================================================

describe('Integration Test 5: Empty and Edge Cases', () => {
  it('should handle empty diagram gracefully', () => {
    const diagram = createTestDiagram();
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);

    expect(layout.participantLayouts).toHaveLength(0);
    expect(layout.messageLayouts).toHaveLength(0);
    expect(layout.fragmentLayouts).toHaveLength(0);
    expect(layout.lifelineBottomY).toBeGreaterThan(0);
  });

  it('should skip message with missing participant and continue rendering', () => {
    const participants = [
      createParticipant('p1', 0, 'Application', 'app-1'),
    ];
    const messages = [
      createMessage('m1', 'p1', 'missing-p2', 'Request', { labelText: 'test' }),
    ];
    const nodes = [createMessageNode('n1', 'm1', 0)];
    const diagram = createTestDiagram({ participants, messages, sequence_nodes: nodes });

    // Layout should still be computed
    const layout = computeSequenceLayout(diagram, PARTICIPANT_SPACING_DEFAULT);
    expect(layout.participantLayouts).toHaveLength(1);

    // Message validation should fail but not crash
    const participantIdSet = new Set(participants.map(p => p.id));
    const renderCheck = shouldRenderMessage(messages[0], participantIdSet);
    expect(renderCheck.shouldRender).toBe(false);
    expect(renderCheck.reason).toContain('to_participant_id');
  });

  it('should handle long text with ellipsis in participant headers', () => {
    const longName = 'This is an extremely long application name that should be truncated with ellipsis after three lines';
    const maxWidth = LAYOUT_CONSTANTS.headerBoxWidth - 20; // Account for padding
    const result = wrapTextWithEllipsis(longName, maxWidth, 12, 3);

    expect(result.lines.length).toBeLessThanOrEqual(3);
    expect(result.truncated).toBe(true);
    expect(result.lines[result.lines.length - 1]).toContain('...');
  });

  it('should handle entity not found in metaModel with fallback', () => {
    const metaModel = createTestMetaModel();

    // Try to resolve a non-existent entity
    const name = resolveParticipantName('Application', 'non-existent-app', metaModel);
    expect(name).toBe('non-existent-app'); // Falls back to ref_id

    // Try to resolve a non-existent message entity
    const message = createMessage('m1', 'p1', 'p2', 'Request', { refKind: 'Method', refId: 'non-existent-method' });
    const label = resolveMessageLabel(message, metaModel);
    expect(label).toBe('non-existent-method'); // Falls back to ref_id
  });
});
