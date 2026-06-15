/**
 * Tests for Task Group 3: TypeScript Types and Hook Mapping
 * Verifies that the 4 new endpoint display fields are correctly mapped
 * in both directions by sequenceContentToSequenceDiagram and sequenceDiagramToSequenceContent.
 */

import { describe, test, expect } from 'vitest';
import {
  sequenceContentToSequenceDiagram,
  sequenceDiagramToSequenceContent,
} from '../hooks/useSequenceDiagram';
import type { SequenceContent, SequenceMessageRef } from '../types/typedContent';
import type { SequenceDiagram, SequenceMessage } from '../types/sequenceDiagram';

function makeContent(messageOverrides: Partial<SequenceMessageRef> = {}): SequenceContent {
  return {
    participants: [],
    messages: [
      {
        id: 'msg-1',
        exchange_id: 'ex-1',
        exchange_role: 'Request',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'ep-1',
        ...messageOverrides,
      },
    ],
    fragments: [],
    operands: [],
    sequenceNodes: [],
  };
}

function makeDiagram(messageOverrides: Partial<SequenceMessage> = {}): SequenceDiagram {
  return {
    id: 'd1',
    model_file_id: '',
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
        ref_kind: 'InterfaceEndpoint',
        ref_id: 'ep-1',
        ...messageOverrides,
      },
    ],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };
}

describe('useSequenceDiagram endpoint display field mapping', () => {
  test('sequenceContentToSequenceDiagram copies 4 new fields from SequenceMessageRef to SequenceMessage', () => {
    const content = makeContent({
      show_endpoint_name: true,
      show_endpoint_verb_path: false,
      show_endpoint_req_res_data: true,
      response_mode: 'endpoint_response',
    });

    const diagram = sequenceContentToSequenceDiagram('d1', '', 'Test', content);
    const msg = diagram.messages[0];

    expect(msg.show_endpoint_name).toBe(true);
    expect(msg.show_endpoint_verb_path).toBe(false);
    expect(msg.show_endpoint_req_res_data).toBe(true);
    expect(msg.response_mode).toBe('endpoint_response');
  });

  test('sequenceDiagramToSequenceContent copies 4 new fields from SequenceMessage to SequenceMessageRef', () => {
    const diagram = makeDiagram({
      show_endpoint_name: false,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: true,
      response_mode: 'normal',
    });

    const content = sequenceDiagramToSequenceContent(diagram);
    const ref = content.messages[0];

    expect(ref.show_endpoint_name).toBe(false);
    expect(ref.show_endpoint_verb_path).toBe(true);
    expect(ref.show_endpoint_req_res_data).toBe(true);
    expect(ref.response_mode).toBe('normal');
  });

  test('round-trip: fields survive content -> diagram -> content conversion', () => {
    const original = makeContent({
      show_endpoint_name: true,
      show_endpoint_verb_path: true,
      show_endpoint_req_res_data: false,
      response_mode: 'endpoint_response',
    });

    const diagram = sequenceContentToSequenceDiagram('d1', '', 'Test', original);
    const roundTripped = sequenceDiagramToSequenceContent(diagram);
    const ref = roundTripped.messages[0];

    expect(ref.show_endpoint_name).toBe(true);
    expect(ref.show_endpoint_verb_path).toBe(true);
    expect(ref.show_endpoint_req_res_data).toBe(false);
    expect(ref.response_mode).toBe('endpoint_response');
  });

  test('missing fields default gracefully (undefined passes through)', () => {
    const content = makeContent({});
    const diagram = sequenceContentToSequenceDiagram('d1', '', 'Test', content);
    const msg = diagram.messages[0];

    expect(msg.show_endpoint_name).toBeUndefined();
    expect(msg.show_endpoint_verb_path).toBeUndefined();
    expect(msg.show_endpoint_req_res_data).toBeUndefined();
    expect(msg.response_mode).toBeUndefined();

    const content2 = sequenceDiagramToSequenceContent(diagram);
    const ref = content2.messages[0];

    expect(ref.show_endpoint_name).toBeUndefined();
    expect(ref.show_endpoint_verb_path).toBeUndefined();
    expect(ref.show_endpoint_req_res_data).toBeUndefined();
    expect(ref.response_mode).toBeUndefined();
  });
});
