/**
 * Endpoint-effect apply tests (Effect-map backfill, 2026-08-20).
 *
 * Pins the additive doctrine on the MCP model-write owner: append with the
 * dep_phy_ convention + write access mode; never duplicate an existing
 * write edge (dep-prefixed or bare id); skip unknown endpoints and — the
 * hallucination guard — unknown table names; PUT only when something
 * actually changed.
 */

import {
  applyEndpointEffects,
  EffectApplyModelClient,
} from '../services/endpointEffectApplyService';

function baseModel() {
  return {
    metaModel: {
      entities: {
        endpoints: [
          { id: 'ep-1', operation_verb: 'POST', path_or_address: '/filters/lookup' },
          { id: 'ep-2', operation_verb: 'DELETE', path_or_address: '/filters/delete' },
        ],
        physical_data_entities: [
          { id: 'phy-1', name: 'Filters' },
          { id: 'phy-2', name: 'filter_audit' },
        ],
      },
      relationships: {
        endpoint_data_effects: [
          {
            id: 'ede-existing',
            endpoint_id: 'ep-2',
            data_entity_point_id: 'dep_phy_phy-1',
            access_mode: 'write',
          },
        ],
      },
    },
  };
}

function clientFor(model: unknown) {
  const puts: unknown[] = [];
  const client: EffectApplyModelClient = {
    getProjectById: async () => ({ id: 'p1', name: 'Project One' }),
    getModel: async () => model,
    putModel: async (_p, _a, _f, dto) => {
      puts.push(dto);
      return dto;
    },
  };
  return { client, puts };
}

describe('applyEndpointEffects', () => {
  it('appends additive write edges (dep_phy_ convention, case-insensitive table match)', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model);
    const result = await applyEndpointEffects(
      {
        projectId: 'p1',
        architectureId: 'a1',
        deltas: [
          { endpoint_id: 'ep-1', table_name: 'filters', source: 'corpus', evidence: 'root X' },
          { endpoint_id: 'ep-1', table_name: 'FILTER_AUDIT', source: 'llm' },
        ],
      },
      client,
    );
    expect(result.applied).toBe(2);
    expect(result.skipped).toHaveLength(0);
    const edges = model.metaModel.relationships
      .endpoint_data_effects as Array<Record<string, unknown>>;
    expect(edges).toHaveLength(3);
    const added = edges.slice(1);
    expect(added[0]).toMatchObject({
      endpoint_id: 'ep-1',
      data_entity_point_id: 'dep_phy_phy-1',
      access_mode: 'write',
      tags: 'effect_map_backfill',
      confidence: 0.9,
    });
    expect(String(added[0].description)).toContain('corpus');
    expect(String(added[0].description)).toContain('root X');
    expect(added[1]).toMatchObject({
      data_entity_point_id: 'dep_phy_phy-2',
      confidence: 0.7,
    });
    expect(puts).toHaveLength(1);
  });

  it('never duplicates an existing write edge; unknown endpoint/table skip whole (guard)', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model);
    const result = await applyEndpointEffects(
      {
        projectId: 'p1',
        architectureId: 'a1',
        deltas: [
          { endpoint_id: 'ep-2', table_name: 'Filters', source: 'corpus' }, // duplicate
          { endpoint_id: 'ep-9', table_name: 'Filters', source: 'llm' }, // unknown endpoint
          { endpoint_id: 'ep-1', table_name: 'invented_table', source: 'llm' }, // guard
        ],
      },
      client,
    );
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped[0].reason).toContain('already has a write effect edge');
    expect(result.skipped[1].reason).toContain('not found');
    expect(result.skipped[2].reason).toContain('not a physical entity');
    // All-skipped batch: the model is never PUT.
    expect(puts).toHaveLength(0);
    expect(model.metaModel.relationships.endpoint_data_effects).toHaveLength(1);
  });

  it('dedupes within one batch (second identical delta skips as duplicate)', async () => {
    const model = baseModel();
    const { client } = clientFor(model);
    const result = await applyEndpointEffects(
      {
        projectId: 'p1',
        architectureId: 'a1',
        deltas: [
          { endpoint_id: 'ep-1', table_name: 'filters', source: 'corpus' },
          { endpoint_id: 'ep-1', table_name: 'Filters', source: 'llm' },
        ],
      },
      client,
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('never duplicates');
  });

  it('fails loudly (404) when no committed model exists', async () => {
    const { client } = clientFor(null);
    await expect(
      applyEndpointEffects(
        {
          projectId: 'p1',
          architectureId: 'a1',
          deltas: [{ endpoint_id: 'ep-1', table_name: 'filters', source: 'corpus' }],
        },
        client,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
