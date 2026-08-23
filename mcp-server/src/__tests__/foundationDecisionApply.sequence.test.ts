/** Sequence-generator materialization (Oracle Nine item 2). */
import { applyDecisionsToEntities } from '../services/foundationDecisionApplyService';

describe('applyDecisionsToEntities — sequence_generator payload', () => {
  it('materializes strategy + mappings onto the sequence table entity', () => {
    const entities = [{ id: 'e1', name: 'seq_registry' }] as never[];
    const result = applyDecisionsToEntities(entities, [
      {
        decision_key: 'F-9',
        rule_key: 'sequence_generator',
        answer: 'native_sequences',
        scope: null,
        target_entity_names: ['seq_registry'],
        payload_json: {
          sequence_strategy: 'native',
          name_column: 'SequenceName',
          number_column: 'SequenceNumber',
          mappings: [{ sequence_name: 'WidgetId', table: 'screen_filter', column: 'WidgetId' }],
        },
      },
    ] as never);
    expect(result.updated).toBe(1);
    const entity = entities[0] as { constraints_metadata?: Record<string, unknown> };
    expect(entity.constraints_metadata?.sequence_generator).toMatchObject({
      strategy: 'native',
      name_column: 'SequenceName',
      number_column: 'SequenceNumber',
      decision_ref: 'F-9',
    });
  });
});
