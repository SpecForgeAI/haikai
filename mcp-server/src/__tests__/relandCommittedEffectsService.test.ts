/**
 * reland_committed_effects (2026-09-03): re-insert the effect rows of
 * candidates a save-back stamped `committed` whose phase-2 PUT never landed.
 * Additive + idempotent, straight from the intact candidates (no re-scan),
 * with the post-PUT assertion the original save lacked.
 */

import {
  relandCommittedEffects,
  RelandModelClient,
} from '../services/relandCommittedEffectsService';
import type { DiscoveryCandidateDto } from '../services/archModelClient';

function baseModel() {
  return {
    metaModel: {
      entities: {
        endpoints: [{ id: 'ep-1', name: 'POST /api/deal-books' }],
        physical_data_entities: [{ id: 'pde-1', name: 'deal_book' }],
      },
      relationships: { endpoint_data_effects: [] as any[] },
    },
  };
}

function candidate(
  id: string,
  overrides: Partial<{ status: string; review_status: string; data: Record<string, unknown> }> = {},
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-1',
    candidate_type: 'endpoint_data_effects',
    name: 'POST /api/deal-books → deal_book (write)',
    confidence: 0.9,
    status: overrides.status ?? 'committed',
    review_status: overrides.review_status ?? 'committed',
    source_cluster_ids: [],
    data: overrides.data ?? {
      endpoint_id: 'ep-1',
      data_entity_point_id: 'dep_phy_pde-1',
      access_mode: 'write',
      committedEntityId: 'ede-stamped-1',
      committedEntityType: 'endpoint_data_effects',
    },
  } as unknown as DiscoveryCandidateDto;
}

function clientFor(
  model: any,
  candidatesByRun: Record<string, DiscoveryCandidateDto[]>,
  opts: { dropOnPut?: boolean } = {},
) {
  const puts: any[] = [];
  const client: RelandModelClient = {
    getProjectById: async () => ({ id: 'p1', name: 'Project One' }),
    getModel: async () => model,
    putModel: async (_p, _a, _f, dto) => {
      puts.push(JSON.parse(JSON.stringify(dto)));
      if (opts.dropOnPut) {
        // Simulate the store silently dropping the rows.
        model.metaModel.relationships.endpoint_data_effects = [];
      }
      return dto;
    },
    getCandidatesByRun: async (_p, _a, runId) => candidatesByRun[runId] ?? [],
  };
  return { client, puts };
}

describe('relandCommittedEffects', () => {
  it('re-inserts a committed candidate under its STAMPED ede- id and asserts it landed', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model, { 'run-1': [candidate('c1')] });

    const result = await relandCommittedEffects(
      { projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] },
      client,
    );

    expect(result).toMatchObject({ runsScanned: 1, candidatesSeen: 1, relanded: 1, alreadyPresent: 0 });
    expect(puts).toHaveLength(1);
    const rows = model.metaModel.relationships.endpoint_data_effects;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('ede-stamped-1');
    expect(rows[0].endpoint_id).toBe('ep-1');
    expect(rows[0].access_mode).toBe('write');
  });

  it('is idempotent: a second run reports alreadyPresent and makes NO PUT', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model, { 'run-1': [candidate('c1')] });
    await relandCommittedEffects({ projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] }, client);

    const second = await relandCommittedEffects(
      { projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] },
      client,
    );

    expect(second).toMatchObject({ relanded: 0, alreadyPresent: 1 });
    expect(puts).toHaveLength(1);
  });

  it('ignores non-committed candidates and reports unresolvable ones as skipped', async () => {
    const model = baseModel();
    const { client, puts } = clientFor(model, {
      'run-1': [
        candidate('pending', { status: 'approved', review_status: 'approved' }),
        candidate('orphan', {
          data: { endpointName: 'GET /no/such/route', dataEntityName: 'deal_book', access_mode: 'read' },
        }),
      ],
    });

    const result = await relandCommittedEffects(
      { projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] },
      client,
    );

    expect(result.candidatesSeen).toBe(1); // only the committed one
    expect(result.relanded).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ runId: 'run-1', candidateId: 'orphan' });
    expect(result.skipped[0].reason).toMatch(/could not resolve/);
    expect(puts).toHaveLength(0);
  });

  it('FAILS LOUDLY when the PUT succeeds but the store drops the rows', async () => {
    const model = baseModel();
    const { client } = clientFor(model, { 'run-1': [candidate('c1')] }, { dropOnPut: true });

    await expect(
      relandCommittedEffects({ projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] }, client),
    ).rejects.toThrow(/absent from the model afterwards/);
  });

  it('404s when the architecture has no committed model', async () => {
    const { client } = clientFor(null, {});
    await expect(
      relandCommittedEffects({ projectId: 'p1', architectureId: 'a1', runIds: ['run-1'] }, client),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
