/**
 * LLM gap-proposal generation (Spec 2026-08-04-4): prompt building over the
 * committed model, strict parsing, and the hallucination guard — every
 * table/column/relationship a proposal names must exist, or the proposal is
 * dropped with an honest warning.
 */
import {
  joinlessRelationships,
  parseFkProposals,
  parsePkProposals,
  runGapProposalGeneration,
} from '../services/dbGapProposalGeneration';
import type { CommittedPhysicalModel } from '../services/dbMigrationPack/inputs';

function model(): CommittedPhysicalModel {
  return {
    physicalDataEntities: [
      { id: 'e-orders', name: 'dbo.orders' },
      { id: 'e-customers', name: 'dbo.customers' },
    ],
    physicalDataAttributes: [
      { id: 'a1', name: 'order_id', physical_entity_id: 'e-orders', data_type: 'int', is_identity: true },
      { id: 'a2', name: 'customer_id', physical_entity_id: 'e-orders', data_type: 'int' },
      { id: 'a3', name: 'id', physical_entity_id: 'e-customers', data_type: 'int', is_identity: true },
      { id: 'a4', name: 'name', physical_entity_id: 'e-customers', data_type: 'varchar(80)' },
    ],
    dataEntityPoints: [
      { id: 'p-orders', physical_entity_id: 'e-orders' },
      { id: 'p-customers', physical_entity_id: 'e-customers' },
    ],
    dataEntityRelationships: [
      {
        id: 'rel-1',
        fromDataEntityPointId: 'p-orders',
        toDataEntityPointId: 'p-customers',
        fk_columns: null,
      },
    ],
  };
}

describe('joinlessRelationships', () => {
  it('finds relationships without fk_columns and resolves entities', () => {
    const rels = joinlessRelationships(model());
    expect(rels).toHaveLength(1);
    expect(rels[0].fromEntity.name).toBe('dbo.orders');
    expect(rels[0].toEntity.name).toBe('dbo.customers');
  });

  it('skips relationships that already carry join columns', () => {
    const m = model();
    m.dataEntityRelationships[0].fk_columns = {
      join_columns: ['customer_id'],
      referenced_columns: ['id'],
    };
    expect(joinlessRelationships(m)).toHaveLength(0);
  });
});

describe('parseFkProposals', () => {
  const FINDING = 'relationships_without_fk_columns:all_relationships';

  it('accepts a valid proposal and shapes the AMS row', () => {
    const content = JSON.stringify({
      proposals: [
        {
          relationship_id: 'rel-1',
          from_table: 'dbo.orders',
          join_columns: ['customer_id'],
          to_table: 'dbo.customers',
          referenced_columns: ['id'],
          rationale: 'customer_id matches customers.id by convention',
          confidence: 'high',
        },
      ],
    });
    const { proposals, warnings } = parseFkProposals(content, FINDING, model());
    expect(warnings).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      proposal_key: 'fk--rel-1',
      finding_key: FINDING,
      kind: 'fk_join',
      confidence: 'high',
    });
    expect(proposals[0].payload_json).toMatchObject({
      relationship_id: 'rel-1',
      join_columns: ['customer_id'],
      referenced_columns: ['id'],
    });
  });

  it('drops hallucinated columns / unknown relationships with warnings', () => {
    const content = JSON.stringify({
      proposals: [
        {
          relationship_id: 'rel-1',
          join_columns: ['made_up_col'],
          referenced_columns: ['id'],
        },
        { relationship_id: 'rel-does-not-exist', join_columns: ['x'], referenced_columns: ['y'] },
      ],
    });
    const { proposals, warnings } = parseFkProposals(content, FINDING, model());
    expect(proposals).toHaveLength(0);
    expect(warnings.some((w) => w.includes('hallucinated'))).toBe(true);
    expect(warnings.some((w) => w.includes('unknown'))).toBe(true);
  });

  it('drops mismatched column list lengths', () => {
    const content = JSON.stringify({
      proposals: [
        { relationship_id: 'rel-1', join_columns: ['customer_id', 'extra'], referenced_columns: ['id'] },
      ],
    });
    const { proposals, warnings } = parseFkProposals(content, FINDING, model());
    expect(proposals).toHaveLength(0);
    expect(warnings[0]).toContain('mismatched');
  });
});

describe('parsePkProposals', () => {
  const FINDING = 'no_primary_keys:all_tables';

  it('accepts valid tables/columns, drops hallucinations', () => {
    const content = JSON.stringify({
      proposals: [
        { table: 'dbo.orders', columns: ['order_id'], rationale: 'identity column', confidence: 'high' },
        { table: 'dbo.ghost', columns: ['id'] },
        { table: 'dbo.customers', columns: ['nope'] },
      ],
    });
    const { proposals, warnings } = parsePkProposals(content, FINDING, model());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ proposal_key: 'pk--dbo.orders', kind: 'primary_key' });
    expect(proposals[0].payload_json).toMatchObject({
      table: 'dbo.orders',
      entity_id: 'e-orders',
      columns: ['order_id'],
    });
    expect(warnings).toHaveLength(2);
  });
});

describe('runGapProposalGeneration', () => {
  it('routes fk findings through the LLM and validates output', async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const result = await runGapProposalGeneration({
      projectId: 'p-1',
      findingKind: 'relationships_without_fk_columns',
      findingKey: 'relationships_without_fk_columns:all_relationships',
      model: model(),
      callLlm: async (args) => {
        calls.push(args);
        return {
          content: JSON.stringify({
            proposals: [
              {
                relationship_id: 'rel-1',
                join_columns: ['customer_id'],
                referenced_columns: ['id'],
                rationale: 'naming convention',
                confidence: 'medium',
              },
            ],
          }),
        };
      },
    });
    expect(result.supported).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].userPrompt).toContain('rel-1');
    expect(calls[0].userPrompt).toContain('dbo.orders');
    expect(calls[0].userPrompt).toContain('customer_id');
  });

  it('unsupported finding kinds never reach the LLM', async () => {
    const result = await runGapProposalGeneration({
      projectId: 'p-1',
      findingKind: 'no_code_objects',
      findingKey: 'no_code_objects:all_code_objects',
      model: model(),
      callLlm: async () => {
        throw new Error('must not be called');
      },
    });
    expect(result.supported).toBe(false);
    expect(result.unsupportedReason).toContain('harvest');
    expect(result.proposals).toEqual([]);
  });

  it('pk findings with no pk-less tables short-circuit without an LLM call', async () => {
    const m = model();
    m.physicalDataAttributes[0].is_primary_key = true;
    m.physicalDataAttributes[2].is_primary_key = true;
    const result = await runGapProposalGeneration({
      projectId: 'p-1',
      findingKind: 'no_primary_keys',
      findingKey: 'no_primary_keys:all_tables',
      model: m,
      callLlm: async () => {
        throw new Error('must not be called');
      },
    });
    expect(result.supported).toBe(true);
    expect(result.proposals).toEqual([]);
    expect(result.warnings[0]).toContain('already carries');
  });
});
