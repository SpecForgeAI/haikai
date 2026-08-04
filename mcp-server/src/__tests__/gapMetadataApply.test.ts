/**
 * Gap-Metadata Apply Service (Spec 4 — LLM gap-proposal queue, 2026-08-04).
 *
 * Verifies the additive model-write doctrine for approved gap proposals:
 *   1. an fk_join delta lands on a relationship WITHOUT fk_columns;
 *   2. a populated relationship is SKIPPED with an honest reason (never
 *      overwritten) and an all-skipped batch never PUTs the model;
 *   3. a primary_key delta flags ONLY the named attributes (case-insensitive)
 *      and stamps constraints_metadata.primary_key with canonical spellings;
 *   4. an entity that already declares constraints_metadata.primary_key is
 *      skipped untouched.
 *
 * Uses the service's injected GapApplyModelClient deps seam (house style)
 * instead of module-level axios mocks — the merge logic is what's under test,
 * not the HTTP client.
 */

import {
  applyGapMetadata,
  FkJoinDelta,
  GapApplyModelClient,
  PrimaryKeyDelta,
} from '../services/gapMetadataApplyService';

// ============================================================================
// Helpers
// ============================================================================

function makeModel(opts: {
  physical?: any[];
  physicalAttrs?: any[];
  rels?: any[];
} = {}): any {
  return {
    metaModel: {
      entities: {
        physical_data_entities: opts.physical ?? [],
        physical_data_attributes: opts.physicalAttrs ?? [],
        data_entity_points: [],
      },
      relationships: {
        logical_data_entity_relationships: opts.rels ?? [],
      },
    },
    diagrams: [],
  };
}

/** Mock client capturing every putModel body (deep-cloned like real wire). */
function makeClient(model: any): {
  client: GapApplyModelClient;
  putModels: any[];
  putModel: jest.Mock;
} {
  const putModels: any[] = [];
  const putModel = jest.fn().mockImplementation(
    (_p: string, _a: string, _f: string, dto: any) => {
      putModels.push(JSON.parse(JSON.stringify(dto)));
      return Promise.resolve({});
    }
  );
  const client: GapApplyModelClient = {
    getProjectById: jest.fn().mockResolvedValue({ id: 'proj-001', name: 'TestProject' }),
    getModel: jest.fn().mockResolvedValue(model),
    putModel,
  };
  return { client, putModels, putModel };
}

const FK_DELTA: FkJoinDelta = {
  kind: 'fk_join',
  relationship_id: 'ler-1',
  fk_columns: {
    join_columns: ['customer_id'],
    referenced_columns: ['id'],
    on_delete: null,
    on_update: null,
  },
};

function bareRelationship(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'ler-1',
    fromDataEntityPointId: 'dep_phy_pde-trade',
    toDataEntityPointId: 'dep_phy_pde-customer',
    cardinality: 'MANY_TO_ONE',
    relationship: 'ASSOCIATION',
    ...overrides,
  };
}

// ============================================================================
// fk_join
// ============================================================================

describe('applyGapMetadata — fk_join', () => {
  it('applies fk_columns to a relationship that has none, and PUTs the model', async () => {
    const model = makeModel({ rels: [bareRelationship()] });
    const { client, putModels } = makeClient(model);

    const result = await applyGapMetadata(
      { projectId: 'proj-001', architectureId: 'arch-001', deltas: [FK_DELTA] },
      client
    );

    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(putModels).toHaveLength(1);
    const rel = putModels[0].metaModel.relationships.logical_data_entity_relationships[0];
    expect(rel.fk_columns).toEqual({
      join_columns: ['customer_id'],
      referenced_columns: ['id'],
      on_delete: null,
      on_update: null,
    });
  });

  it('SKIPS a relationship whose fk_columns is already populated and never PUTs on an all-skipped batch', async () => {
    const presentFk = {
      join_columns: ['orig_col'],
      referenced_columns: ['id'],
      on_delete: 'CASCADE',
      on_update: null,
    };
    const model = makeModel({ rels: [bareRelationship({ fk_columns: presentFk })] });
    const { client, putModel } = makeClient(model);

    const result = await applyGapMetadata(
      { projectId: 'proj-001', architectureId: 'arch-001', deltas: [FK_DELTA] },
      client
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('already carries fk_columns');
    expect(result.skipped[0].delta).toEqual(FK_DELTA);
    // The present metadata is untouched and NO model write happened.
    expect(
      model.metaModel.relationships.logical_data_entity_relationships[0].fk_columns
    ).toEqual(presentFk);
    expect(putModel).not.toHaveBeenCalled();
  });
});

// ============================================================================
// primary_key
// ============================================================================

describe('applyGapMetadata — primary_key', () => {
  const PK_DELTA: PrimaryKeyDelta = {
    kind: 'primary_key',
    entity_id: 'pde-trade',
    // Deliberately different casing than the model's attribute spelling to
    // prove the case-insensitive match + canonical-spelling stamp.
    columns: ['TRADE_ID'],
  };

  function pkModel(entityOverrides: Record<string, unknown> = {}): any {
    return makeModel({
      physical: [
        {
          id: 'pde-trade',
          name: 'TRADE',
          physical_type: 'Table',
          constraints_metadata: null,
          ...entityOverrides,
        },
      ],
      physicalAttrs: [
        {
          id: 'pda-1',
          name: 'trade_id',
          physical_entity_id: 'pde-trade',
          data_type: 'numeric',
          is_primary_key: false,
        },
        {
          id: 'pda-2',
          name: 'amount',
          physical_entity_id: 'pde-trade',
          data_type: 'numeric',
          is_primary_key: false,
        },
      ],
    });
  }

  it('flags the named attributes and stamps constraints_metadata.primary_key (other attributes untouched)', async () => {
    const model = pkModel();
    const { client, putModels } = makeClient(model);

    const result = await applyGapMetadata(
      { projectId: 'proj-001', architectureId: 'arch-001', deltas: [PK_DELTA] },
      client
    );

    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(putModels).toHaveLength(1);
    const saved = putModels[0];
    const attrs = saved.metaModel.entities.physical_data_attributes;
    expect(attrs.find((a: any) => a.id === 'pda-1').is_primary_key).toBe(true);
    // ONLY the named attribute is flagged — the sibling is untouched.
    expect(attrs.find((a: any) => a.id === 'pda-2').is_primary_key).toBe(false);
    const entity = saved.metaModel.entities.physical_data_entities[0];
    expect(entity.constraints_metadata.primary_key).toEqual({
      name: 'pk_trade',
      // Canonical model spelling, not the delta's upper-case input.
      columns: ['trade_id'],
    });
  });

  it('SKIPS when constraints_metadata.primary_key is already present (never overwritten, no PUT)', async () => {
    const presentPk = { name: 'orig_pk', columns: ['trade_id'] };
    const model = pkModel({ constraints_metadata: { primary_key: presentPk } });
    const { client, putModel } = makeClient(model);

    const result = await applyGapMetadata(
      { projectId: 'proj-001', architectureId: 'arch-001', deltas: [PK_DELTA] },
      client
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('already declares constraints_metadata.primary_key');
    expect(
      model.metaModel.entities.physical_data_entities[0].constraints_metadata.primary_key
    ).toEqual(presentPk);
    // No attribute flag was touched either.
    expect(
      model.metaModel.entities.physical_data_attributes.every(
        (a: any) => a.is_primary_key === false
      )
    ).toBe(true);
    expect(putModel).not.toHaveBeenCalled();
  });

  it('SKIPS whole delta (no partial pk) when a named column does not exist on the entity', async () => {
    const model = pkModel();
    const { client, putModel } = makeClient(model);

    const result = await applyGapMetadata(
      {
        projectId: 'proj-001',
        architectureId: 'arch-001',
        deltas: [{ kind: 'primary_key', entity_id: 'pde-trade', columns: ['trade_id', 'ghost'] }],
      },
      client
    );

    expect(result.applied).toBe(0);
    expect(result.skipped[0].reason).toContain('ghost');
    // The valid column was NOT flagged — whole-delta skip, never partial.
    expect(
      model.metaModel.entities.physical_data_attributes.find((a: any) => a.id === 'pda-1')
        .is_primary_key
    ).toBe(false);
    expect(putModel).not.toHaveBeenCalled();
  });
});
