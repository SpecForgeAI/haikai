/**
 * Foundation-decision apply tests (Foundations Spec 1, 2026-08-22).
 *
 * Pins the two additive writes: scope tags + decision receipts onto NAMED
 * entities only (unknown names skipped whole with honest reasons), additive
 * PK promotion (a declared primary key is never overwritten), PUT only when
 * something changed, and the decisions upsert riding alongside.
 */

import {
  applyFoundationDecisions,
  FoundationApplyModelClient,
  FoundationDecisionInput,
} from '../services/foundationDecisionApplyService';

function baseModel() {
  return {
    metaModel: {
      entities: {
        physical_data_entities: [
          { id: 'phy-1', name: 'orders_bak_2018' },
          { id: 'phy-2', name: 'work_queue' },
          {
            id: 'phy-3',
            name: 'versioned_rules',
            constraints_metadata: {
              indexes: [{ name: 'vr_ix', columns: ['RuleId', 'ValidFrom'], is_unique: true }],
            },
          },
          {
            id: 'phy-4',
            name: 'keyed_master',
            constraints_metadata: { primary_key: { name: 'pk_km', columns: ['Id'] } },
          },
        ],
      },
      relationships: {},
    },
  };
}

function clientFor(model: unknown) {
  const puts: unknown[] = [];
  const client: FoundationApplyModelClient = {
    getProjectById: async () => ({ id: 'p1', name: 'Project One' }),
    getModel: async () => model,
    putModel: async (_p, _a, _f, dto) => {
      puts.push(dto);
      return dto;
    },
  };
  return { client, puts };
}

const P = '11111111-1111-1111-1111-111111111111';
const A = '22222222-2222-2222-2222-222222222222';

function decision(partial: Partial<FoundationDecisionInput>): FoundationDecisionInput {
  return {
    decision_key: 'F-1',
    rule_key: 'backup_copy',
    answer: 'exclude_all',
    scope: 'excluded',
    target_entity_names: [],
    ...partial,
  };
}

describe('applyFoundationDecisions', () => {
  it('tags named entities with scope + receipt; unknown names skip whole; decisions upsert rides along', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model);
    const upserts: FoundationDecisionInput[][] = [];

    const result = await applyFoundationDecisions(
      {
        projectId: P,
        architectureId: A,
        decisions: [
          decision({ target_entity_names: ['ORDERS_BAK_2018', 'ghost_table'] }),
          decision({
            decision_key: 'F-3',
            rule_key: 'temp_working',
            answer: 'mark_volatile',
            scope: 'volatile',
            target_entity_names: ['work_queue'],
          }),
        ],
      },
      client,
      async (_p, _a, ds) => {
        upserts.push(ds);
        return ds.length;
      },
    );

    expect(result.entities_updated).toBe(2);
    expect(result.decisions_upserted).toBe(2);
    expect(result.skipped).toEqual([
      {
        decision_key: 'F-1',
        entity_name: 'ghost_table',
        reason: 'entity not found in the committed model',
      },
    ]);
    const entities = model.metaModel.entities.physical_data_entities as Array<
      Record<string, unknown>
    >;
    expect(entities[0]).toMatchObject({
      migration_scope: 'excluded',
      scope_decision_ref: 'F-1',
    });
    expect(entities[1]).toMatchObject({
      migration_scope: 'volatile',
      scope_decision_ref: 'F-3',
    });
    // Entities not named are never touched.
    expect(entities[2].migration_scope).toBeUndefined();
    expect(puts).toHaveLength(1);
    expect(upserts).toHaveLength(1);
  });

  it('materializes PK promotion additively — never over a declared primary key', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model);

    const result = await applyFoundationDecisions(
      {
        projectId: P,
        architectureId: A,
        decisions: [
          decision({
            decision_key: 'F-2',
            rule_key: 'key_posture',
            answer: 'promote_pk',
            scope: null,
            target_entity_names: ['versioned_rules', 'keyed_master'],
            payload_json: { promote_pk_columns: ['RuleId', 'ValidFrom'] },
          }),
        ],
      },
      client,
      async () => 1,
    );

    const entities = model.metaModel.entities.physical_data_entities as Array<
      Record<string, any>
    >;
    expect(entities[2].constraints_metadata.primary_key).toMatchObject({
      columns: ['RuleId', 'ValidFrom'],
      provenance: 'foundation_promoted',
      decision_ref: 'F-2',
    });
    // Declared PK untouched; skip recorded honestly.
    expect(entities[3].constraints_metadata.primary_key).toEqual({
      name: 'pk_km',
      columns: ['Id'],
    });
    expect(result.skipped).toEqual([
      {
        decision_key: 'F-2',
        entity_name: 'keyed_master',
        reason: 'entity already has a declared primary key — promotion skipped (additive)',
      },
    ]);
    expect(puts).toHaveLength(1);
  });

  it('no changes = no model PUT; validation is loud', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model);
    const result = await applyFoundationDecisions(
      {
        projectId: P,
        architectureId: A,
        decisions: [decision({ target_entity_names: ['ghost_only'] })],
      },
      client,
      async () => 1,
    );
    expect(result.entities_updated).toBe(0);
    expect(puts).toHaveLength(0);

    await expect(
      applyFoundationDecisions(
        {
          projectId: P,
          architectureId: A,
          decisions: [decision({ scope: 'nonsense' as never })],
        },
        client,
        async () => 1,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
