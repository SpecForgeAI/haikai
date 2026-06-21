/**
 * Tests for the durable LINKED findings emitted for Blocked + Quality-gap
 * candidates (Skipped-candidate visibility + grouped bulk-fill, 2026-06-20,
 * Task Group 2).
 *
 * The findings EXTEND the existing saveBackFindings -> bulkCreateDiscoveryFindings
 * best-effort path and link to the candidate (target_type='discovery_candidate')
 * so the "what's wrong" signal survives a page reload. Exercised through the REAL
 * `saveDiscoveryCandidatesToModel` orchestration with axios mocked at the module
 * level (mirrors candidateSaveBackFalseMergeGuard.test.ts).
 *
 * Coverage (2-8 budget):
 *   (1) a BLOCKED candidate emits a linked finding (evidence_gap gapType,
 *       targetType='discovery_candidate');
 *   (2) a QUALITY-GAP candidate (committed, no attributes) emits a linked finding;
 *   (3) emission is best-effort: a finding-emit failure does NOT fail save-back;
 *   (4) under commit=false (dry-run) NO finding is written (preview side-effect-free).
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

let generateIdCounter = 0;
jest.mock('../utils/generateId', () => ({
  generateId: (prefix: string) => {
    generateIdCounter++;
    return `${prefix}test-${String(generateIdCounter).padStart(3, '0')}`;
  },
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'logical_data_entities',
    name: 'DefaultEntity',
    confidence: 0.9,
    status: 'proposed',
    review_status: 'approved',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-06-20T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

function makeModel(): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        business_logics: [],
      },
      relationships: {
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        interface_logical_entities: [],
        endpoint_data_effects: [],
        data_movements: [],
      },
    },
    diagrams: [],
  };
}

function wireAxios(
  model: any,
  candidates: DiscoveryCandidateDto[],
  opts: { findingsFail?: boolean } = {},
) {
  const axios = require('axios');
  const putModels: any[] = [];
  const findingsPosts: any[] = [];

  const mockClient = {
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/api/projects') {
        return Promise.resolve({ data: [{ id: 'proj-001', name: 'TestProject' }] });
      }
      if (url.includes('/candidate-entity-mappings')) {
        return Promise.resolve({ data: [] });
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
      if (url.startsWith('/api/model/projects/') && url.endsWith('/architectures/arch-001')) {
        putModels.push(JSON.parse(JSON.stringify(body)));
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockImplementation((url: string, body: any) => {
      if (url.includes('/findings/bulk') || url.endsWith('/findings')) {
        findingsPosts.push({ url, body });
        if (opts.findingsFail) {
          return Promise.reject(new Error('simulated findings persistence failure'));
        }
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    }),
  };
  axios.create = jest.fn().mockReturnValue(mockClient);
  return { mockClient, putModels, findingsPosts };
}

/** All finding payloads POSTed across all bulk calls. */
function postedFindings(findingsPosts: any[]): any[] {
  return findingsPosts.flatMap((p) => (Array.isArray(p.body) ? p.body : p.body?.findings || []));
}

describe('candidateSaveBackService - durable linked findings for Blocked + Quality-gap (TG2)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // (1) BLOCKED candidate -> linked evidence_gap finding.
  // ==========================================================================
  it('(1) a blocked candidate emits a linked evidence_gap finding (targetType=discovery_candidate)', async () => {
    const model = makeModel();
    const orphan = makeCandidate({
      id: 'cand-orphan',
      candidate_type: 'logical_data_attributes',
      name: 'orphanField',
      confidence: 0.95,
      parent_candidate_id: null,
      data: {},
    });
    const { findingsPosts } = wireAxios(model, [orphan]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // The finding rode the result (findingsEmitted) AND was POSTed.
    const emitted = (result.findingsEmitted as any[]).filter(
      (f) => f.detailJson?.outcome === 'blocked' && f.links?.[0]?.targetId === 'cand-orphan',
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].findingType).toBe('evidence_gap');
    expect(emitted[0].detailJson.gapType).toBeDefined();
    expect(emitted[0].links[0].targetType).toBe('discovery_candidate');

    const posted = postedFindings(findingsPosts).filter(
      (f) => f.detail_json?.outcome === 'blocked',
    );
    expect(posted.length).toBeGreaterThanOrEqual(1);
  });

  // ==========================================================================
  // (2) QUALITY-GAP candidate -> linked evidence_gap finding.
  // ==========================================================================
  it('(2) a quality-gap candidate (committed, no attributes) emits a linked evidence_gap finding', async () => {
    const model = makeModel();
    // A logical entity that commits but has NO attribute children -> quality gap.
    const entity = makeCandidate({
      id: 'cand-bare-entity',
      candidate_type: 'logical_data_entities',
      name: 'BareEntity',
      confidence: 0.95,
    });
    const { findingsPosts, putModels } = wireAxios(model, [entity]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // It DID commit (quality-gap candidates still commit).
    expect(result.entitiesCreated).toBe(1);
    expect(putModels.length).toBeGreaterThanOrEqual(1);

    // A quality_gap finding linked to the candidate was emitted + posted.
    const emitted = (result.findingsEmitted as any[]).filter(
      (f) => f.detailJson?.outcome === 'quality_gap' && f.links?.[0]?.targetId === 'cand-bare-entity',
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].findingType).toBe('evidence_gap');
    expect(emitted[0].detailJson.gapType).toBe('data_entity_missing_attributes');
    expect(emitted[0].detailJson.missingField).toBe('attributes');
    expect(emitted[0].links[0].targetType).toBe('discovery_candidate');

    const posted = postedFindings(findingsPosts).filter(
      (f) => f.detail_json?.outcome === 'quality_gap',
    );
    expect(posted.length).toBeGreaterThanOrEqual(1);

    // The reason arm carries a quality_gap entry for it (alongside its created
    // entry -- a quality-gap candidate is BOTH committed AND flagged).
    const armEntries = (result.reasons as any[]).filter((r) => r.candidateId === 'cand-bare-entity');
    expect(armEntries.some((r) => r.reason === 'created')).toBe(true);
    const qg = armEntries.find((r) => r.reason === 'quality_gap');
    expect(qg).toBeDefined();
    expect(qg.missingField).toBe('attributes');
  });

  // ==========================================================================
  // (3) Emission is best-effort: a finding-emit failure does NOT fail save-back.
  // ==========================================================================
  it('(3) a finding-emit failure does not fail the save-back (best-effort)', async () => {
    const model = makeModel();
    const good = makeCandidate({
      id: 'cand-good',
      candidate_type: 'logical_data_entities',
      name: 'GoodEntity',
      confidence: 0.95,
    });
    const orphan = makeCandidate({
      id: 'cand-orphan3',
      candidate_type: 'logical_data_attributes',
      name: 'lonely',
      confidence: 0.95,
      parent_candidate_id: null,
      data: {},
    });
    const { putModels, findingsPosts } = wireAxios(model, [good, orphan], { findingsFail: true });

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    // Must NOT throw even though the findings POST rejects.
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // The model still saved + the good entity committed.
    expect(putModels.length).toBeGreaterThanOrEqual(1);
    expect(result.entitiesCreated).toBe(1);
    // A POST was attempted (and rejected) -- best-effort swallowed the error.
    expect(findingsPosts.length).toBeGreaterThanOrEqual(1);
    // The finding still rides on the result for the immediate chip/panel.
    expect((result.findingsEmitted as any[]).some((f) => f.detailJson?.outcome === 'blocked')).toBe(true);
  });

  // ==========================================================================
  // (4) commit=false -> NO finding written (preview side-effect-free).
  // ==========================================================================
  it('(4) under commit=false no finding is written, but the projection still lists them', async () => {
    const model = makeModel();
    const orphan = makeCandidate({
      id: 'cand-orphan4',
      candidate_type: 'logical_data_attributes',
      name: 'lonely4',
      confidence: 0.95,
      parent_candidate_id: null,
      data: {},
    });
    const bareEntity = makeCandidate({
      id: 'cand-bare4',
      candidate_type: 'logical_data_entities',
      name: 'BareEntity4',
      confidence: 0.95,
    });
    const { putModels, findingsPosts } = wireAxios(model, [orphan, bareEntity]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual', false);

    // No persistence at all under dry-run.
    expect(putModels).toHaveLength(0);
    expect(findingsPosts).toHaveLength(0);

    // But the projection still reports what WOULD be emitted (blocked + quality-gap).
    const outcomes = (result.findingsEmitted as any[]).map((f) => f.detailJson?.outcome).filter(Boolean);
    expect(outcomes).toContain('blocked');
    expect(outcomes).toContain('quality_gap');
  });
});
