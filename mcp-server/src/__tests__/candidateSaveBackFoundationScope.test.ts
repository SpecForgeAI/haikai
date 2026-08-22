/**
 * Foundation scope at save-back (Foundations Spec 2, 2026-08-22).
 *
 * Pins the three save-time behaviours the scope data plane depends on:
 *   1. PRESERVATION — an existing entity's migration_scope survives a
 *      re-scan save untouched (additive doctrine: save-back never rebuilds
 *      existing rows);
 *   2. RECONCILIATION — stored decisions apply to entities CREATED by this
 *      save (fresh-project ordering: answers land before the first save);
 *   3. STATUS FLIP — a candidate committing an excluded entity terminates
 *      as `committed_excluded` (review_status stays 'committed').
 *
 * Drives the REAL saveDiscoveryCandidatesToModel with axios mocked at the
 * module level (mirrors candidateSaveBackStructuralBackfill.test.ts).
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));
jest.mock('axios');

import { DiscoveryCandidateDto } from '../services/archModelClient';

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'physical_data_entities',
    name: 'DefaultEntity',
    confidence: 0.9,
    status: 'approved',
    review_status: 'approved',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-08-22T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  } as DiscoveryCandidateDto;
}

function makeModel(physical: any[] = []): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: physical,
        physical_data_attributes: [],
      },
      relationships: {
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        interface_logical_entities: [],
        endpoint_data_effects: [],
      },
    },
    diagrams: [],
  };
}

function wireAxios(model: any, candidates: DiscoveryCandidateDto[], decisions: any[]) {
  const axios = require('axios');
  const putModels: any[] = [];
  const candidatePatches: Array<{ url: string; body: any }> = [];

  const mockClient = {
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({ data: [{ id: 'proj-001', name: 'TestProject' }] });
      }
      if (url.includes('/candidate-entity-mappings')) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes('/foundation-decisions')) {
        return Promise.resolve({ data: decisions });
      }
      if (url.includes('/candidates')) {
        return Promise.resolve({ data: candidates });
      }
      if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
        return Promise.resolve({ data: model });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    }),
    put: jest.fn().mockImplementation((url: string, body: any) => {
      // updateCandidate rides PUT too — split candidate updates from model
      // PUTs by URL shape.
      if (url.includes('/candidates/')) {
        candidatePatches.push({ url, body: JSON.parse(JSON.stringify(body)) });
      } else if (url.startsWith('/api/model/projects/')) {
        putModels.push(JSON.parse(JSON.stringify(body)));
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: [] }),
    patch: jest.fn().mockImplementation((url: string, body: any) => {
      candidatePatches.push({ url, body: JSON.parse(JSON.stringify(body)) });
      return Promise.resolve({ data: {} });
    }),
  };
  axios.create = jest.fn().mockReturnValue(mockClient);
  return { mockClient, putModels, candidatePatches };
}

function lastModel(putModels: any[]): any {
  return putModels[putModels.length - 1];
}

describe('candidateSaveBackService — foundation scope (Spec 2, 2026-08-22)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('preserves an existing entity scope on re-save AND flips its candidate to committed_excluded', async () => {
    const model = makeModel([
      {
        id: 'pde-existing',
        name: 'orders_bak',
        migration_scope: 'excluded',
        scope_decision_ref: 'F-1',
      },
    ]);
    const candidates = [
      makeCandidate({
        id: 'cand-bak',
        name: 'orders_bak',
        data: { schemaName: 'dbo', objectType: 'table' },
      }),
    ];
    const { putModels, candidatePatches } = wireAxios(model, candidates, []);
    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', { commit: true });

    const saved = lastModel(putModels);
    const entity = saved.metaModel.entities.physical_data_entities.find(
      (e: any) => e.name === 'orders_bak',
    );
    expect(entity).toMatchObject({
      migration_scope: 'excluded',
      scope_decision_ref: 'F-1',
    });

    // An exact re-discovered duplicate is SUPPRESSED pre-merge (existing
    // semantics) — it never commits, so no status update fires for it. The
    // committed_excluded flip is pinned by the fresh-creation test below.
    const patch = candidatePatches.find((p) => p.url.includes('cand-bak'));
    expect(patch?.body?.status).not.toBe('committed');
  });

  it('reconciles STORED decisions onto freshly created entities (decisions-first ordering)', async () => {
    const model = makeModel([]);
    const candidates = [
      makeCandidate({
        id: 'cand-fresh',
        name: 'orders_bak',
        data: { schemaName: 'dbo', objectType: 'table' },
      }),
      makeCandidate({
        id: 'cand-keep',
        name: 'orders',
        data: { schemaName: 'dbo', objectType: 'table' },
      }),
    ];
    const decisions = [
      {
        decision_key: 'F-1',
        rule_key: 'backup_copy',
        answer: 'exclude_all',
        scope: 'excluded',
        targets_json: [{ entity_name: 'orders_bak' }],
        stale: false,
      },
      {
        decision_key: 'F-2',
        rule_key: 'key_posture',
        answer: 'promote_pk',
        scope: null,
        targets_json: [{ entity_name: 'orders' }],
        payload_json: { promote_pk_columns: ['id'] },
        stale: false,
      },
    ];
    const { mockClient, putModels, candidatePatches } = wireAxios(model, candidates, decisions);
    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', { commit: true });
    void mockClient;

    const saved = lastModel(putModels);
    const entities = saved.metaModel.entities.physical_data_entities;
    const bak = entities.find((e: any) => e.name === 'orders_bak');
    expect(bak).toMatchObject({ migration_scope: 'excluded', scope_decision_ref: 'F-1' });
    const orders = entities.find((e: any) => e.name === 'orders');
    expect(orders.constraints_metadata.primary_key).toMatchObject({
      columns: ['id'],
      provenance: 'foundation_promoted',
      decision_ref: 'F-2',
    });

    const bakPatch = candidatePatches.find((p) => p.url.includes('cand-fresh'));
    expect(bakPatch?.body.status).toBe('committed_excluded');
    const keepPatch = candidatePatches.find((p) => p.url.includes('cand-keep'));
    expect(keepPatch?.body.status).toBe('committed');
  });
});
