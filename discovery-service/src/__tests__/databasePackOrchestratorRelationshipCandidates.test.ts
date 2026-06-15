/**
 * Bug fix (2026-05-17): the database pack orchestrator's Phase 5 collects
 * `RelationshipInference[]` but Phase 6 (`emitCandidates`) only emits tables
 * + columns. Inferred / declared FK relationships never reached the save-back
 * path so the architecture model was missing them entirely.
 *
 * Fix: orchestrator now appends one `logical_data_entity_relationships`
 * candidate per RelationshipInference between Phase 6 and Phase 7. This
 * suite exercises the pure conversion helper `buildRelationshipCandidates`
 * so the contract is locked in without spinning up the full async pipeline.
 */

import { buildRelationshipCandidates } from '../services/databasePacks/databasePackOrchestrator';
import type {
  IntrospectionResult,
  RelationshipInference,
} from '../services/databasePacks/types';

function emptyIntrospection(): IntrospectionResult {
  return {
    schemas: [],
    tables: [],
    columns: [],
    keysAndIndexes: [],
    views: [],
    procedures: [],
    triggers: [],
  };
}

describe('buildRelationshipCandidates (Spec 2026-05-16 follow-up fix)', () => {
  it('returns an empty list when no relationships were inferred', () => {
    const out = buildRelationshipCandidates([], emptyIntrospection(), 'postgres');
    expect(out).toEqual([]);
  });

  it('emits one logical_data_entity_relationships candidate per RelationshipInference', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'public',
        fromTable: 'orders',
        fromColumns: ['customer_id'],
        toSchema: 'public',
        toTable: 'customers',
        toColumns: ['id'],
        kind: 'declared_fk',
        confidence: 1.0,
      },
    ];
    const out = buildRelationshipCandidates(relationships, emptyIntrospection(), 'postgres');
    expect(out).toHaveLength(1);
    expect(out[0].candidateType).toBe('logical_data_entity_relationships');
    expect(out[0].name).toBe('orders -> customers');
    const data = out[0].data as Record<string, unknown>;
    expect(data.sourceEntity).toBe('orders');
    expect(data.targetEntity).toBe('customers');
    // Save-back's logical_data_entity_relationships case reads these:
    expect(data.relationshipType).toBe('FOREIGN_KEY');
    // PK is not the FK column => MANY_TO_ONE
    expect(data.cardinality).toBe('MANY_TO_ONE');
  });

  it('marks the relationship ONE_TO_ONE when the FK columns equal the source PK', () => {
    // user_profiles.user_id is BOTH the primary key AND the FK to users.id.
    const introspection: IntrospectionResult = {
      ...emptyIntrospection(),
      keysAndIndexes: [
        {
          schemaName: 'public',
          tableName: 'user_profiles',
          kind: 'primary_key',
          name: 'user_profiles_pkey',
          columns: ['user_id'],
        },
      ],
    };
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'public',
        fromTable: 'user_profiles',
        fromColumns: ['user_id'],
        toSchema: 'public',
        toTable: 'users',
        toColumns: ['id'],
        kind: 'declared_fk',
        confidence: 1.0,
      },
    ];
    const out = buildRelationshipCandidates(relationships, introspection, 'postgres');
    expect((out[0].data as Record<string, unknown>).cardinality).toBe('ONE_TO_ONE');
  });

  it('maps inference kinds to relationship_type: declared/unenforced -> FOREIGN_KEY, inferred/ambiguous -> ASSOCIATION', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 's', fromTable: 'a', fromColumns: ['b_id'],
        toSchema: 's',  toTable:  'b', toColumns:  ['id'],
        kind: 'declared_fk', confidence: 1.0,
      },
      {
        fromSchema: 's', fromTable: 'a', fromColumns: ['c_id'],
        toSchema: 's',  toTable:  'c', toColumns:  ['id'],
        kind: 'unenforced_relationship', confidence: 0.9,
      },
      {
        fromSchema: 's', fromTable: 'a', fromColumns: ['d_id'],
        toSchema: 's',  toTable:  'd', toColumns:  ['id'],
        kind: 'inferred', confidence: 0.5,
      },
      {
        fromSchema: 's', fromTable: 'a', fromColumns: ['e_id'],
        toSchema: 's',  toTable:  'e', toColumns:  ['id'],
        kind: 'ambiguous', confidence: 0.3,
      },
    ];
    const out = buildRelationshipCandidates(relationships, emptyIntrospection(), 'sybase');
    const byTarget = (n: string) => out.find((c) => c.name === `a -> ${n}`)!;
    expect((byTarget('b').data as Record<string, unknown>).relationshipType).toBe('FOREIGN_KEY');
    expect((byTarget('c').data as Record<string, unknown>).relationshipType).toBe('FOREIGN_KEY');
    expect((byTarget('d').data as Record<string, unknown>).relationshipType).toBe('ASSOCIATION');
    expect((byTarget('e').data as Record<string, unknown>).relationshipType).toBe('ASSOCIATION');
  });

  it('produces a stable, encoded clientId so save-back can match idempotently across runs', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'public', fromTable: 'orders', fromColumns: ['customer_id'],
        toSchema:   'public', toTable:   'customers', toColumns: ['id'],
        kind: 'declared_fk', confidence: 1.0,
      },
    ];
    const first  = buildRelationshipCandidates(relationships, emptyIntrospection(), 'postgres');
    const second = buildRelationshipCandidates(relationships, emptyIntrospection(), 'postgres');
    expect(first[0].clientId).toBe(second[0].clientId);
    // clientId encodes both endpoints + the column list so a same-name
    // relationship pointing at a different target keeps a distinct id.
    expect(first[0].clientId).toContain('public.orders');
    expect(first[0].clientId).toContain('public.customers');
    expect(first[0].clientId).toContain('customer_id');
  });
});
