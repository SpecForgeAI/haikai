/**
 * endpoint_data_effects idempotent match includes access_mode (Kiro
 * 2026-08-24, replicated from the work-machine fix).
 *
 * A read edge and a write edge for the same endpoint+table are DIFFERENT
 * facts — the wire table has no unique constraint on the (endpoint_id,
 * data_entity_point_id) pair, so both rows are legal. The deferred Pass 2.6
 * match keyed on the pair alone collapsed them: the first mode to arrive
 * was created, the second silently counted 'reused', and since deferred
 * order comes from the candidate API (not emission order) WHICH mode
 * survived varied per run — the read/write cards reshuffled every round.
 *
 * Drives the real saveDiscoveryCandidatesToModel (mock pattern mirrors the
 * data_movements idempotency sibling).
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => {
  const actual = jest.requireActual('../services/archModelClient');
  return {
    ...actual,
    archModelClient: {
      getProjectById: jest.fn(),
      getCandidatesByRun: jest.fn(),
      getCandidateEntityMappingsByRun: jest.fn(),
      getModel: jest.fn(),
      putModel: jest.fn(),
      updateCandidate: jest.fn(),
      bulkCreateCandidateEntityMappings: jest.fn(),
      bulkCreateDiscoveryFindings: jest.fn(),
    },
  };
});

import { DiscoveryCandidateDto, archModelClient } from '../services/archModelClient';
import { saveDiscoveryCandidatesToModel } from '../services/candidateSaveBackService';

function makeModel(): any {
  return {
    metaModel: {
      entities: {
        services: [],
        interfaces: [],
        endpoints: [{ id: 'ep-1', name: 'POST /api/deal-books' }],
        physical_data_entities: [{ id: 'pde-1', name: 'deal_book' }],
      },
      relationships: {
        endpoint_data_effects: [],
      },
    },
  };
}

function effectCandidate(
  id: string,
  accessMode: string | null,
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-001',
    candidate_type: 'endpoint_data_effects',
    name: `POST /api/deal-books → deal_book (${accessMode ?? 'unknown'})`,
    confidence: 0.9,
    status: 'approved',
    source_cluster_ids: [],
    data: {
      endpoint_id: 'ep-1',
      data_entity_point_id: 'dep_phy_pde-1',
      ...(accessMode !== null ? { access_mode: accessMode } : {}),
    },
  } as unknown as DiscoveryCandidateDto;
}

function wireClient(candidates: DiscoveryCandidateDto[], persisted: any) {
  const client = archModelClient as jest.Mocked<typeof archModelClient>;
  client.getProjectById.mockResolvedValue({ id: 'proj-1', name: 'TestProject' } as any);
  client.getCandidatesByRun.mockResolvedValue(candidates as any);
  client.getCandidateEntityMappingsByRun.mockResolvedValue([] as any);
  client.getModel.mockImplementation(async () => persisted);
  client.putModel.mockImplementation(async (..._args: any[]) => {
    const body = _args[3];
    persisted.metaModel.relationships.endpoint_data_effects =
      body.metaModel.relationships.endpoint_data_effects;
    return body;
  });
  client.updateCandidate.mockResolvedValue(undefined as any);
  client.bulkCreateCandidateEntityMappings.mockResolvedValue(undefined as any);
  client.bulkCreateDiscoveryFindings.mockResolvedValue(undefined as any);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('endpoint_data_effects idempotency includes access_mode (Kiro 2026-08-24)', () => {
  it('a read edge and a write edge for the SAME endpoint+table both commit', async () => {
    const persisted = makeModel();
    wireClient(
      [effectCandidate('cand-read', 'read'), effectCandidate('cand-write', 'write')],
      persisted,
    );

    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    const rows = persisted.metaModel.relationships.endpoint_data_effects;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.access_mode).sort()).toEqual(['read', 'write']);
    // Both rows share the pair — only the mode distinguishes them.
    expect(new Set(rows.map((r: any) => r.endpoint_id)).size).toBe(1);
    expect(new Set(rows.map((r: any) => r.data_entity_point_id)).size).toBe(1);
  });

  it('the SAME mode re-run stays idempotent (one row, reused)', async () => {
    const persisted = makeModel();
    wireClient([effectCandidate('cand-write', 'write')], persisted);

    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');
    expect(persisted.metaModel.relationships.endpoint_data_effects).toHaveLength(1);

    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');
    expect(persisted.metaModel.relationships.endpoint_data_effects).toHaveLength(1);
    expect(persisted.metaModel.relationships.endpoint_data_effects[0].access_mode).toBe('write');
  });

  it('order independence: write-then-read commits both, exactly like read-then-write', async () => {
    const persisted = makeModel();
    wireClient(
      [effectCandidate('cand-write', 'write'), effectCandidate('cand-read', 'read')],
      persisted,
    );

    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    const rows = persisted.metaModel.relationships.endpoint_data_effects;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.access_mode).sort()).toEqual(['read', 'write']);
  });

  it('a null access_mode matches only another null (nullish key equality)', async () => {
    const persisted = makeModel();
    wireClient([effectCandidate('cand-null', null), effectCandidate('cand-read', 'read')], persisted);

    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');

    const rows = persisted.metaModel.relationships.endpoint_data_effects;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.access_mode).sort((a: any, b: any) =>
      String(a).localeCompare(String(b)),
    )).toEqual([null, 'read']);

    // Re-running keeps both (each mode matches only its own kind).
    await saveDiscoveryCandidatesToModel('proj-1', 'arch-1', 'run-001', 'auto');
    expect(persisted.metaModel.relationships.endpoint_data_effects).toHaveLength(2);
  });
});
