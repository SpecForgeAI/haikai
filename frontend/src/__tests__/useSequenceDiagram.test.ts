import { describe, it, expect } from 'vitest';
import { sequenceContentToSequenceDiagram, sequenceDiagramToSequenceContent } from '../hooks/useSequenceDiagram';
import { SequenceContent } from '../types/typedContent';
import { SequenceDiagram } from '../types/sequenceDiagram';

describe('is_collection propagation through mapping functions', () => {
  it('sequenceContentToSequenceDiagram maps is_collection: true from SequenceMessageRef to SequenceMessage', () => {
    const content: SequenceContent = {
      participants: [],
      messages: [
        {
          id: 'msg-1',
          exchange_id: 'ex-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          ref_kind: 'PhysicalEntity',
          ref_id: 'entity-1',
          is_collection: true,
        },
      ],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

    const result = sequenceContentToSequenceDiagram('d1', 'mf1', 'Test', content);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].is_collection).toBe(true);
  });

  it('sequenceDiagramToSequenceContent maps is_collection: true from SequenceMessage back to SequenceMessageRef', () => {
    const diagram: SequenceDiagram = {
      id: 'd1',
      model_file_id: 'mf1',
      name: 'Test',
      type: 'Sequence',
      participants: [],
      messages: [
        {
          id: 'msg-1',
          exchange_id: 'ex-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          ref_kind: 'PhysicalEntity',
          ref_id: 'entity-1',
          is_collection: true,
        },
      ],
      fragments: [],
      operands: [],
      sequence_nodes: [],
    };

    const result = sequenceDiagramToSequenceContent(diagram);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].is_collection).toBe(true);
  });

  it('is_collection: undefined passes through without error in both directions', () => {
    const content: SequenceContent = {
      participants: [],
      messages: [
        {
          id: 'msg-1',
          exchange_id: 'ex-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          label_text: 'doSomething()',
        },
      ],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

    // Forward: SequenceContent -> SequenceDiagram
    const diagram = sequenceContentToSequenceDiagram('d1', 'mf1', 'Test', content);
    expect(diagram.messages).toHaveLength(1);
    expect(diagram.messages[0].is_collection).toBeUndefined();

    // Reverse: SequenceDiagram -> SequenceContent
    const roundTripped = sequenceDiagramToSequenceContent(diagram);
    expect(roundTripped.messages).toHaveLength(1);
    expect(roundTripped.messages[0].is_collection).toBeUndefined();
  });
});
