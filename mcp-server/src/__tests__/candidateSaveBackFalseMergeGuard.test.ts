/**
 * Tests for the save-back false-merge guard + below-gate hardening (Oracle
 * Integrity & Determinism, Spec #3, Task Group 5).
 *
 * Scope (5.1) -- two guards, on the SAME shared identity primitive
 * (`normalizeNameForMatch` / the 0.75 gate), exercised through the REAL
 * `saveDiscoveryCandidatesToModel` orchestration with axios mocked at the
 * module level (mirrors `candidateSaveBackModelAware.test.ts`):
 *
 *   (1) EXACT (1.0) match driving a relationship binding -> binds SILENTLY,
 *       NO `possible_entity_collision` finding.
 *   (2) NORMALIZED (0.7, e.g. `Order` vs `Orders`) match driving a binding ->
 *       NOT silently bound: a `possible_entity_collision` finding is raised
 *       (detail_json.gapType === 'possible_entity_collision') and the
 *       relationship is left as a reviewable candidate (no row written).
 *   (3) The collision finding is best-effort POSTed via the SAME AMS
 *       findings-bulk route the other save-back findings use.
 *   (4) A below-0.75 candidate is PERSISTED as an explicit "below auto-accept"
 *       reviewable item (not dropped, not minted).
 *   (5) The run-summary below-gate COUNT is nonzero for a below-gate run
 *       (a whole Tier-C `llm-solo` run scores 0.4).
 *
 * The identity primitive is GUARDED in place (not forked): the tests resolve
 * through the production `resolveEntityPoint` / `matchByNormalizedName`.
 */

// Mock dotenv before importing anything else.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock axios at the module level so archModelClient uses our mock.
jest.mock('axios');

// Deterministic ids so assertions can match minted-row prefixes.
let generateIdCounter = 0;
jest.mock('../utils/generateId', () => ({
  generateId: (prefix: string) => {
    generateIdCounter++;
    return `${prefix}test-${String(generateIdCounter).padStart(3, '0')}`;
  },
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';

// ============================================================================
// Helpers (mirrors candidateSaveBackModelAware.test.ts)
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'logical_data_entities',
    name: 'DefaultEntity',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-30T10:00:00Z',
    parent_candidate_id: null,
    ...overrides,
  };
}

function makeModel(opts: { logical?: any[]; physical?: any[] } = {}): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: opts.logical || [],
        logical_data_attributes: [],
        physical_data_entities: opts.physical || [],
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

function wireAxios(model: any, candidates: DiscoveryCandidateDto[]) {
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
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    }),
  };
  axios.create = jest.fn().mockReturnValue(mockClient);
  return { mockClient, putModels, findingsPosts };
}

function lastModel(putModels: any[]): any {
  return putModels[putModels.length - 1];
}

describe('candidateSaveBackService - false-merge guard + below-gate (TG5)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // (1) EXACT match driving a relationship binding -> binds SILENTLY (no finding).
  // ==========================================================================
  it('(1) an EXACT match on both relationship sides binds silently (no collision finding)', async () => {
    const model = makeModel({
      logical: [
        { id: 'lde-customer', name: 'Customer' },
        { id: 'lde-order', name: 'Order' },
      ],
    });
    // Both sides EXACT (byte-for-byte) -> the relationship is written, no finding.
    const rel = makeCandidate({
      id: 'cand-rel-exact',
      candidate_type: 'logical_data_entity_relationships',
      name: 'Customer -> Order',
      confidence: 0.9,
      data: { sourceEntity: 'Customer', targetEntity: 'Order', relationshipType: 'association' },
    });
    const { putModels, findingsPosts } = wireAxios(model, [rel]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // The relationship row was written on the EXACT match.
    const saved = lastModel(putModels);
    const rels = saved.metaModel.relationships.logical_data_entity_relationships;
    expect(rels).toHaveLength(1);
    expect(rels[0].fromDataEntityPointId).toBe('dep_log_lde-customer');
    expect(rels[0].toDataEntityPointId).toBe('dep_log_lde-order');
    // No possible_entity_collision finding -- exact matches bind silently.
    const collisions = (result.findingsEmitted as any[]).filter(
      (f) => f.detailJson?.gapType === 'possible_entity_collision',
    );
    expect(collisions).toHaveLength(0);
    // Nothing was POSTed for a clean exact bind.
    const collisionPosts = findingsPosts.filter((p) =>
      JSON.stringify(p.body).includes('possible_entity_collision'),
    );
    expect(collisionPosts).toHaveLength(0);
  });

  // ==========================================================================
  // (2)+(3) NORMALIZED match driving a binding -> possible_entity_collision
  //         finding + reviewable (no row), POSTed via the AMS findings route.
  // ==========================================================================
  it('(2)+(3) a NORMALIZED (Order vs Orders) relationship match raises possible_entity_collision and writes no row', async () => {
    const model = makeModel({
      logical: [
        { id: 'lde-customer', name: 'Customer' },
        { id: 'lde-order', name: 'Order' },
      ],
    });
    // target "Orders" normalizes to "order" -> a 0.7 NORMALIZED match of "Order".
    const rel = makeCandidate({
      id: 'cand-rel-norm',
      candidate_type: 'logical_data_entity_relationships',
      name: 'Customer -> Orders',
      confidence: 0.9,
      data: { sourceEntity: 'Customer', targetEntity: 'Orders', relationshipType: 'association' },
    });
    const { putModels, findingsPosts } = wireAxios(model, [rel]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // (2) The relationship was NOT silently bound -> no row written (reviewable).
    const saved = lastModel(putModels);
    expect(saved.metaModel.relationships.logical_data_entity_relationships).toHaveLength(0);

    // (2) A possible_entity_collision finding was raised with the right gapType.
    const collisions = (result.findingsEmitted as any[]).filter(
      (f) => f.detailJson?.gapType === 'possible_entity_collision',
    );
    expect(collisions.length).toBeGreaterThanOrEqual(1);
    const c = collisions[0];
    expect(c.findingType).toBe('evidence_gap');
    expect(c.severity).toBe('medium');
    expect(c.detailJson.sourceName).toBe('Orders');
    expect(c.detailJson.matchedName).toBe('Order');
    expect(c.detailJson.bindingKind).toContain('relationship');
    expect(c.links?.[0]).toEqual(
      expect.objectContaining({ targetType: 'discovery_candidate', targetId: 'cand-rel-norm' }),
    );

    // (3) It rode the SAME bulk findings route the other save-back findings use.
    const collisionPosts = findingsPosts.filter((p) =>
      JSON.stringify(p.body).includes('possible_entity_collision'),
    );
    expect(collisionPosts.length).toBeGreaterThanOrEqual(1);
    expect(collisionPosts[0].url).toContain('/findings');
  });

  // ==========================================================================
  // (2b) CASE-FOLD match (Kiro 2026-08-25): a case-only variant is the SAME
  //      name, not a fuzzy collision -- binds confidently, no finding, no
  //      block. (12 relationship rows blocked on pure case differences
  //      between JAXB-derived camelCase entities and PascalCase classes.)
  // ==========================================================================
  it('(2b) a CASE-FOLD (hierarchyViewDetail vs HierarchyViewDetail) match binds confidently with no collision finding', async () => {
    const model = makeModel({
      logical: [
        { id: 'lde-hvd', name: 'hierarchyViewDetail' },
        { id: 'lde-org', name: 'organisation' },
      ],
    });
    // Both sides differ ONLY by case from the committed names.
    const rel = makeCandidate({
      id: 'cand-rel-case',
      candidate_type: 'logical_data_entity_relationships',
      name: 'HierarchyViewDetail -> Organisation',
      confidence: 0.9,
      data: {
        sourceEntity: 'HierarchyViewDetail',
        targetEntity: 'Organisation',
        relationshipType: 'association',
      },
    });
    const { putModels } = wireAxios(model, [rel]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const saved = lastModel(putModels);
    const rels = saved.metaModel.relationships.logical_data_entity_relationships;
    expect(rels).toHaveLength(1);
    expect(rels[0].fromDataEntityPointId).toBe('dep_log_lde-hvd');
    expect(rels[0].toDataEntityPointId).toBe('dep_log_lde-org');
    const collisions = (result.findingsEmitted as any[]).filter(
      (f) => f.detailJson?.gapType === 'possible_entity_collision',
    );
    expect(collisions).toHaveLength(0);
  });

  // ==========================================================================
  // (2c) Attribution (Kiro 2026-08-25): a residual NORMALIZED block names the
  //      side that actually mismatched -- a target-only fuzz stamps
  //      missingField 'targetEntity', never 'sourceEntity'.
  // ==========================================================================
  it('(2c) a target-only NORMALIZED block stamps missingField targetEntity', async () => {
    const model = makeModel({
      logical: [
        { id: 'lde-customer', name: 'Customer' },
        { id: 'lde-order', name: 'Order' },
      ],
    });
    const rel = makeCandidate({
      id: 'cand-rel-target-norm',
      candidate_type: 'logical_data_entity_relationships',
      name: 'Customer -> Orders',
      confidence: 0.9,
      data: { sourceEntity: 'Customer', targetEntity: 'Orders', relationshipType: 'association' },
    });
    wireAxios(model, [rel]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const blocked = (result.reasons as any[]).filter(
      (r) => r.reason === 'blocked' && r.candidateId === 'cand-rel-target-norm',
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].missingField).toBe('targetEntity');
  });

  // ==========================================================================
  // (4) A below-0.75 candidate is PERSISTED as an explicit reviewable item.
  // ==========================================================================
  it('(4) a below-0.75 candidate is recorded as a below_auto_accept reviewable item (not minted, not dropped)', async () => {
    const model = makeModel({ logical: [] });
    const lowConf = makeCandidate({
      id: 'cand-low',
      candidate_type: 'logical_data_entities',
      name: 'TentativeEntity',
      confidence: 0.4, // Tier-C llm-solo score, below the 0.75 gate.
    });
    const { putModels } = wireAxios(model, [lowConf]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // The 0.75 gate stands -> NOT auto-created (no model pollution).
    expect(result.entitiesCreated).toBe(0);
    const saved = lastModel(putModels);
    const saved_logicals = (saved?.metaModel?.entities?.logical_data_entities) || [];
    expect(saved_logicals.find((e: any) => e.name === 'TentativeEntity')).toBeUndefined();

    // ...but it is NOT silently dropped: recorded as an explicit reviewable.
    expect(result.belowGateCandidates).toHaveLength(1);
    expect(result.belowGateCandidates[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-low',
        candidateName: 'TentativeEntity',
        candidateType: 'logical_data_entities',
        confidence: 0.4,
        reviewStatus: 'below_auto_accept',
      }),
    );
  });

  // ==========================================================================
  // (5) The run-summary below-gate COUNT is nonzero for a whole below-gate run.
  // ==========================================================================
  it('(5) the run-summary belowGateCount is nonzero for a whole Tier-C below-gate run', async () => {
    const model = makeModel({ logical: [] });
    // A whole Tier-C `llm-solo` run: every candidate scores 0.4 (below 0.75).
    const tierC = [
      makeCandidate({ id: 'cand-c1', name: 'EntityA', confidence: 0.4 }),
      makeCandidate({ id: 'cand-c2', name: 'EntityB', confidence: 0.4 }),
      makeCandidate({ id: 'cand-c3', name: 'EntityC', confidence: 0.4 }),
    ];
    wireAxios(model, tierC);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // The count reaches the run summary and equals the below-gate set size.
    expect(result.belowGateCount).toBe(3);
    expect(result.belowGateCount).toBe(result.belowGateCandidates.length);
    expect(result.belowGateCount).toBeGreaterThan(0);
    // None were minted (the gate stands).
    expect(result.entitiesCreated).toBe(0);
  });
});
