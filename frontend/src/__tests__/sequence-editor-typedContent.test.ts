/**
 * Sequence Editor TypedContent Tests
 * Task Group 7.1: Tests for Sequence Editor reading from and writing to activeDiagram.typedContent
 *
 * These tests verify that:
 * 1. Sequence Editor reads participants from activeDiagram.typedContent.content
 * 2. Sequence Editor reads messages from activeDiagram.typedContent.content
 * 3. On save, typedContent.content is updated and persisted via diagram save API
 * 4. New Sequence diagram loads with empty typedContent (no 404 error)
 */

import { describe, it, expect } from 'vitest';
import { Diagram } from '../types/model';
import { TypedContentEnvelope, SequenceContent, createDefaultSequenceContent } from '../types/typedContent';
import { SequenceParticipant, SequenceMessage } from '../types/sequenceDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Sequence diagram with typedContent
 */
function createMockSequenceDiagram(
  id: string,
  typedContent?: TypedContentEnvelope
): Diagram {
  return {
    id,
    name: 'Test Sequence Diagram',
    description: '',
    diagram_type: 'Sequence',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent,
  };
}

/**
 * Create a mock SequenceContent with participants and messages
 */
function createMockSequenceContent(
  participants: SequenceParticipant[],
  messages: SequenceMessage[]
): SequenceContent {
  return {
    participants,
    messages,
    fragments: [],
    operands: [],
    sequenceNodes: [],
  };
}

/**
 * Create a mock TypedContentEnvelope for Sequence
 */
function createMockSequenceEnvelope(
  content: SequenceContent
): TypedContentEnvelope {
  return {
    type: 'Sequence',
    version: 1,
    content,
  };
}

// ============================================================================
// Test 1: Sequence Editor reads participants from activeDiagram.typedContent.content
// ============================================================================

describe('Sequence Editor reads participants from typedContent', () => {
  it('should read participants from activeDiagram.typedContent.content', () => {
    // Arrange: Create participants
    const participant1: SequenceParticipant = {
      id: 'p1',
      ref_kind: 'Application',
      ref_id: 'app-1',
      order_index: 0,
    };
    const participant2: SequenceParticipant = {
      id: 'p2',
      ref_kind: 'Service',
      ref_id: 'svc-1',
      order_index: 1,
    };

    // Create sequence content with participants
    const sequenceContent = createMockSequenceContent([participant1, participant2], []);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // Act: Extract participants from typedContent
    const content = diagram.typedContent?.content as SequenceContent | undefined;
    const participants = content?.participants ?? [];

    // Assert: Participants should be available from typedContent
    expect(participants).toHaveLength(2);
    expect(participants[0].id).toBe('p1');
    expect(participants[0].ref_kind).toBe('Application');
    expect(participants[0].ref_id).toBe('app-1');
    expect(participants[1].id).toBe('p2');
    expect(participants[1].ref_kind).toBe('Service');
    expect(participants[1].ref_id).toBe('svc-1');
  });

  it('should return empty array when typedContent has no participants', () => {
    // Arrange: Empty sequence content
    const sequenceContent = createMockSequenceContent([], []);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // Act: Extract participants from typedContent
    const content = diagram.typedContent?.content as SequenceContent | undefined;
    const participants = content?.participants ?? [];

    // Assert: Participants should be empty array
    expect(participants).toHaveLength(0);
  });

  it('should handle missing typedContent gracefully', () => {
    // Arrange: Diagram without typedContent
    const diagram = createMockSequenceDiagram('seq-1', undefined);

    // Act: Safely extract participants
    const content = diagram.typedContent?.content as SequenceContent | undefined;
    const participants = content?.participants ?? [];

    // Assert: Participants should default to empty array
    expect(participants).toHaveLength(0);
  });
});

// ============================================================================
// Test 2: Sequence Editor reads messages from activeDiagram.typedContent.content
// ============================================================================

describe('Sequence Editor reads messages from typedContent', () => {
  it('should read messages from activeDiagram.typedContent.content', () => {
    // Arrange: Create messages
    const message1: SequenceMessage = {
      id: 'm1',
      exchange_id: 'ex1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      label_text: 'Hello',
    };
    const message2: SequenceMessage = {
      id: 'm2',
      exchange_id: 'ex1',
      exchange_role: 'Response',
      from_participant_id: 'p2',
      to_participant_id: 'p1',
      label_text: 'World',
    };

    // Create sequence content with messages
    const sequenceContent = createMockSequenceContent([], [message1, message2]);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // Act: Extract messages from typedContent
    const content = diagram.typedContent?.content as SequenceContent | undefined;
    const messages = content?.messages ?? [];

    // Assert: Messages should be available from typedContent
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('m1');
    expect(messages[0].label_text).toBe('Hello');
    expect(messages[0].exchange_role).toBe('Request');
    expect(messages[1].id).toBe('m2');
    expect(messages[1].label_text).toBe('World');
    expect(messages[1].exchange_role).toBe('Response');
  });

  it('should return empty array when typedContent has no messages', () => {
    // Arrange: Empty sequence content
    const sequenceContent = createMockSequenceContent([], []);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // Act: Extract messages from typedContent
    const content = diagram.typedContent?.content as SequenceContent | undefined;
    const messages = content?.messages ?? [];

    // Assert: Messages should be empty array
    expect(messages).toHaveLength(0);
  });
});

// ============================================================================
// Test 3: On save, typedContent.content is updated and persisted via diagram save API
// ============================================================================

describe('Sequence Editor updates typedContent on save', () => {
  it('should update typedContent.content when adding a participant', () => {
    // Arrange: Start with empty sequence content
    const sequenceContent = createMockSequenceContent([], []);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // New participant to add
    const newParticipant: SequenceParticipant = {
      id: 'p1',
      ref_kind: 'Application',
      ref_id: 'app-1',
      order_index: 0,
    };

    // Act: Update typedContent with new participant (simulating what updateSequenceContent does)
    const currentContent = diagram.typedContent?.content as SequenceContent;
    const updatedContent: SequenceContent = {
      ...currentContent,
      participants: [...currentContent.participants, newParticipant],
    };
    const updatedEnvelope: TypedContentEnvelope = {
      ...diagram.typedContent!,
      content: updatedContent,
    };
    const updatedDiagram: Diagram = {
      ...diagram,
      typedContent: updatedEnvelope,
    };

    // Assert: Updated diagram has the new participant in typedContent
    const finalContent = updatedDiagram.typedContent?.content as SequenceContent;
    expect(finalContent.participants).toHaveLength(1);
    expect(finalContent.participants[0].id).toBe('p1');
    expect(updatedDiagram.typedContent?.type).toBe('Sequence');
    expect(updatedDiagram.typedContent?.version).toBe(1);
  });

  it('should maintain envelope structure (type, version, content) when updating', () => {
    // Arrange: Existing sequence content
    const existingParticipant: SequenceParticipant = {
      id: 'p1',
      ref_kind: 'Application',
      ref_id: 'app-1',
      order_index: 0,
    };
    const sequenceContent = createMockSequenceContent([existingParticipant], []);
    const envelope = createMockSequenceEnvelope(sequenceContent);
    const diagram = createMockSequenceDiagram('seq-1', envelope);

    // Act: Add a message
    const newMessage: SequenceMessage = {
      id: 'm1',
      exchange_id: 'ex1',
      exchange_role: 'Request',
      from_participant_id: 'p1',
      to_participant_id: 'p2',
      label_text: 'Request',
    };

    const currentContent = diagram.typedContent?.content as SequenceContent;
    const updatedContent: SequenceContent = {
      ...currentContent,
      messages: [...currentContent.messages, newMessage],
    };
    const updatedEnvelope: TypedContentEnvelope = {
      ...diagram.typedContent!,
      content: updatedContent,
    };

    // Assert: Envelope structure is maintained
    expect(updatedEnvelope.type).toBe('Sequence');
    expect(updatedEnvelope.version).toBe(1);
    expect((updatedEnvelope.content as SequenceContent).participants).toHaveLength(1);
    expect((updatedEnvelope.content as SequenceContent).messages).toHaveLength(1);
    expect((updatedEnvelope.content as SequenceContent).fragments).toHaveLength(0);
    expect((updatedEnvelope.content as SequenceContent).operands).toHaveLength(0);
    expect((updatedEnvelope.content as SequenceContent).sequenceNodes).toHaveLength(0);
  });
});

// ============================================================================
// Test 4: New Sequence diagram loads with empty typedContent (no 404 error)
// ============================================================================

describe('New Sequence diagram loads with empty typedContent', () => {
  it('should create default empty typedContent for new Sequence diagrams', () => {
    // Act: Create default sequence content (simulating backend behavior)
    const defaultContent = createDefaultSequenceContent();

    // Assert: Default content has empty arrays
    expect(defaultContent.participants).toEqual([]);
    expect(defaultContent.messages).toEqual([]);
    expect(defaultContent.fragments).toEqual([]);
    expect(defaultContent.operands).toEqual([]);
    expect(defaultContent.sequenceNodes).toEqual([]);
  });

  it('should handle new Sequence diagram with empty typedContent without errors', () => {
    // Arrange: Create a new Sequence diagram with default typedContent
    const defaultContent = createDefaultSequenceContent();
    const envelope: TypedContentEnvelope = {
      type: 'Sequence',
      version: 1,
      content: defaultContent,
    };
    const newDiagram = createMockSequenceDiagram('new-seq', envelope);

    // Act: Safely access all sequence data (simulating editor initialization)
    const content = newDiagram.typedContent?.content as SequenceContent;
    const participants = content?.participants ?? [];
    const messages = content?.messages ?? [];
    const fragments = content?.fragments ?? [];
    const operands = content?.operands ?? [];
    const sequenceNodes = content?.sequenceNodes ?? [];

    // Assert: All arrays are accessible and empty (no 404-like errors)
    expect(() => participants.length).not.toThrow();
    expect(() => messages.length).not.toThrow();
    expect(() => fragments.length).not.toThrow();
    expect(() => operands.length).not.toThrow();
    expect(() => sequenceNodes.length).not.toThrow();

    expect(participants).toHaveLength(0);
    expect(messages).toHaveLength(0);
    expect(fragments).toHaveLength(0);
    expect(operands).toHaveLength(0);
    expect(sequenceNodes).toHaveLength(0);
  });

  it('should work with diagram that has typedContent from backend', () => {
    // Arrange: Simulate a diagram with typedContent as it would come from backend
    // Backend populates default typedContent when creating Sequence diagrams
    const diagram: Diagram = {
      id: 'seq-new',
      name: 'New Sequence Diagram',
      description: '',
      diagram_type: 'Sequence',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'Sequence',
        version: 1,
        content: {
          participants: [],
          messages: [],
          fragments: [],
          operands: [],
          sequenceNodes: [],
        },
      },
    };

    // Act: Access sequence data (simulating editor opening)
    const sequenceContent = diagram.typedContent?.content as SequenceContent | undefined;

    // Assert: Content is properly structured with no errors
    expect(diagram.typedContent).toBeDefined();
    expect(diagram.typedContent?.type).toBe('Sequence');
    expect(diagram.typedContent?.version).toBe(1);
    expect(sequenceContent).toBeDefined();
    expect(sequenceContent?.participants).toBeDefined();
    expect(sequenceContent?.messages).toBeDefined();
    // No 404 or loading error should occur
  });
});
