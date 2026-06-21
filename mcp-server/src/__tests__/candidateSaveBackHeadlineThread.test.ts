/**
 * HEADLINE end-to-end thread for the Skipped-candidate visibility + grouped
 * bulk-fill (C1) spec (2026-06-20) -- Task Group 8 strategic gap-fill.
 *
 * The per-stack TG1-7 suites each prove ONE seam (arm/classification/qualifier,
 * findings, AMS bulk-edit, gateway proxy, API client, chip, panel). What no
 * single existing test proves is the spine the spec is named for:
 *
 *   a BLOCKED candidate -> surfaced on the reason arm WITH its missing field
 *     -> (the C1 bulk-fill patch supplies that field)
 *       -> a commit=false DRY-RUN PREVIEW now reports it WOULD commit
 *         -> the REAL commit matches that preview (would-still-block becomes
 *            would-commit; commit == preview).
 *
 * Plus the headline business_logics claim threaded through the REAL save-back:
 * two same-named methods on DIFFERENT classes survive as two qualified rows,
 * while a same-name + same-class pair still collapses.
 *
 * Exercised through the REAL `saveDiscoveryCandidatesToModel` orchestration with
 * axios mocked at the module level (the same harness shape as
 * candidateSaveBackReasonArm.test.ts / candidateSaveBackFalseMergeGuard.test.ts).
 * Kept within the TG8 <=10-test budget (3 tests here).
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

function makeModel(opts: { logical?: any[]; business_logics?: any[] } = {}): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: opts.logical || [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        business_logics: opts.business_logics || [],
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

function wireAxios(model: any, candidates: DiscoveryCandidateDto[]) {
  const axios = require('axios');
  const putModels: any[] = [];
  const findingsPosts: any[] = [];
  const candidateUpdates: any[] = [];
  const mappingPosts: any[] = [];

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
      } else if (url.includes('/candidates/')) {
        candidateUpdates.push({ url, body });
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockImplementation((url: string, body: any) => {
      if (url.includes('/findings/bulk') || url.endsWith('/findings')) {
        findingsPosts.push({ url, body });
        return Promise.resolve({ data: [] });
      }
      if (url.includes('/candidate-entity-mappings')) {
        mappingPosts.push({ url, body });
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    }),
  };
  axios.create = jest.fn().mockReturnValue(mockClient);
  return { mockClient, putModels, findingsPosts, candidateUpdates, mappingPosts };
}

function lastModel(putModels: any[]): any {
  return putModels[putModels.length - 1];
}

describe('candidateSaveBackService - HEADLINE blocked -> fill -> preview -> commit thread (TG8)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // (H1) The full spine: a child attribute candidate is BLOCKED (no resolvable
  // parent -> missing logical_entity_id). The C1 bulk-fill links it to an
  // approved parent (the bulk-edit patch). A commit=false DRY-RUN of the FILLED
  // state reports it WOULD now commit; the REAL commit matches that preview.
  // ==========================================================================
  it('(H1) a blocked attribute, once its missing parent FK is filled, flips from would-still-block to would-commit and the real commit matches the preview', async () => {
    // ---- Phase 1: BLOCKED. The attribute has no parent_candidate_id and no
    // data.logical_entity_id, and its name is non-dotted so the name-parse
    // fallback cannot infer a parent -> the orphan BLOCKED branch fires. ----
    const parent = makeCandidate({
      id: 'cand-parent',
      candidate_type: 'logical_data_entities',
      name: 'Customer',
      confidence: 0.95,
    });
    const blockedChild = makeCandidate({
      id: 'cand-child',
      candidate_type: 'logical_data_attributes',
      name: 'email',
      confidence: 0.95,
      parent_candidate_id: null,
      data: {},
    });

    {
      const { putModels } = wireAxios(makeModel(), [parent, blockedChild]);
      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const blockedRun = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

      // The parent commits; the orphan child is BLOCKED on the arm with its
      // specific missing field (the C1 panel groups by exactly this field).
      const childArm = (blockedRun.reasons as any[]).find((r) => r.candidateId === 'cand-child');
      expect(childArm).toBeDefined();
      expect(childArm.reason).toBe('blocked');
      expect(childArm.missingField).toBe('logical_entity_id');

      // No attribute row was written in the blocked state.
      const saved = lastModel(putModels);
      expect(saved.metaModel.entities.logical_data_attributes).toHaveLength(0);
    }

    // ---- The C1 bulk-fill patch: link the child to the approved parent. This is
    // what bulkCandidateEdit persists; here we apply the same field to the
    // candidate set the next save-back reads. ----
    const filledChild = { ...blockedChild, parent_candidate_id: 'cand-parent' };

    // ---- Phase 2: DRY-RUN PREVIEW (commit=false) of the FILLED state. ----
    jest.resetModules();
    generateIdCounter = 0;
    let previewProjection: any;
    {
      const { putModels, mappingPosts } = wireAxios(makeModel(), [parent, filledChild]);
      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      previewProjection = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual', false);

      // The preview persists NOTHING (real resolution, projection only).
      expect(putModels).toHaveLength(0);
      expect(mappingPosts).toHaveLength(0);

      // The child WOULD now commit -- the missing-field block is gone.
      const childArm = (previewProjection.reasons as any[]).find((r) => r.candidateId === 'cand-child');
      expect(childArm).toBeDefined();
      expect(childArm.reason).toBe('created');
      const stillBlocked = (previewProjection.reasons as any[]).filter((r) => r.reason === 'blocked');
      expect(stillBlocked).toHaveLength(0);
    }

    // ---- Phase 3: REAL COMMIT of the FILLED state -> matches the preview. ----
    jest.resetModules();
    generateIdCounter = 0;
    {
      const { putModels } = wireAxios(makeModel(), [parent, filledChild]);
      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const committed = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual', true);

      // The commit counts match what the preview projected (preview cannot drift
      // from commit -- both run the same real save-back path).
      expect(committed.entitiesCreated).toBe(previewProjection.entitiesCreated);
      expect(committed.candidatesCommitted).toBe(previewProjection.candidatesCommitted);

      // And the attribute row was actually written this time, parented correctly.
      const saved = lastModel(putModels);
      const attrs = saved.metaModel.entities.logical_data_attributes;
      expect(attrs).toHaveLength(1);
      expect(attrs[0].name).toBe('email');
      // Its parent FK resolves to the just-created Customer entity.
      const customer = saved.metaModel.entities.logical_data_entities.find((e: any) => e.name === 'Customer');
      expect(customer).toBeDefined();
      expect(attrs[0].logical_entity_id).toBe(customer.id);
    }
  });

  // ==========================================================================
  // (H2) business_logics two-distinct-survive, threaded through the REAL
  // save-back: Order.process + Payment.process survive as TWO qualified rows;
  // the duplicate Order.process collapses (genuine same-name + same-class dup).
  // This is the headline merge claim; asserted here independently of TG1's unit
  // so the cross-distinct + same-class-collapse pair is locked at the spine.
  // ==========================================================================
  it('(H2) two same-named business_logics on different classes survive as two qualified rows while a same-name+same-class pair collapses', async () => {
    const orderA = makeCandidate({
      id: 'bl-order-a',
      candidate_type: 'business_logics',
      name: 'process',
      confidence: 0.95,
      data: { className: 'OrderService' },
    });
    const orderDup = makeCandidate({
      id: 'bl-order-dup',
      candidate_type: 'business_logics',
      name: 'process',
      confidence: 0.95,
      data: { className: 'OrderService' },
    });
    const payment = makeCandidate({
      id: 'bl-payment',
      candidate_type: 'business_logics',
      name: 'process',
      confidence: 0.95,
      data: { controllerClassName: 'PaymentService' },
    });

    const { putModels } = wireAxios(makeModel(), [orderA, orderDup, payment]);
    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const saved = lastModel(putModels);
    const names = saved.metaModel.entities.business_logics.map((b: any) => b.name).sort();
    // Two distinct qualified rows survive; the same-class dup did NOT add a third.
    expect(names).toEqual(['OrderService.process', 'PaymentService.process']);
    expect(result.entitiesCreated).toBe(2);

    // The collapsed same-class dup is surfaced as an intra-scan reuse (never a
    // silent drop) under the qualified name.
    const collapsed = (result.reasons as any[]).find(
      (r) => r.candidateId === 'bl-order-dup' && r.reason === 'reused',
    );
    expect(collapsed).toBeDefined();
    expect(collapsed.reusedSubclass).toBe('intra-scan');
    expect(collapsed.name).toBe('OrderService.process');
  });

  // ==========================================================================
  // (H3) Preview/commit parity on a MIXED batch: a committable entity, a blocked
  // orphan, and a quality-gap entity. The dry-run projection's reason arm equals
  // the committing run's arm (same outcomes; preview cannot drift from commit),
  // and only the committing run persists.
  // ==========================================================================
  it('(H3) the dry-run projection arm matches the committed run arm on a mixed batch, and only the commit persists', async () => {
    const good = makeCandidate({ id: 'm-good', candidate_type: 'logical_data_entities', name: 'Ledger', confidence: 0.95 });
    const orphan = makeCandidate({
      id: 'm-orphan',
      candidate_type: 'logical_data_attributes',
      name: 'lonely',
      confidence: 0.95,
      parent_candidate_id: null,
      data: {},
    });
    const bare = makeCandidate({ id: 'm-bare', candidate_type: 'logical_data_entities', name: 'BareThing', confidence: 0.95 });

    // Outcome key = candidateId -> reason(+subclass/missingField) for stable compare.
    const armKey = (reasons: any[]) =>
      reasons
        .map((r) => `${r.candidateId}:${r.reason}:${r.reusedSubclass || ''}:${r.missingField || ''}`)
        .sort();

    // Preview.
    let previewArm: string[];
    {
      const { putModels, findingsPosts } = wireAxios(makeModel(), [good, orphan, bare]);
      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const preview = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual', false);
      expect(putModels).toHaveLength(0);
      expect(findingsPosts).toHaveLength(0);
      previewArm = armKey(preview.reasons as any[]);
    }

    // Commit.
    jest.resetModules();
    generateIdCounter = 0;
    {
      const { putModels } = wireAxios(makeModel(), [good, orphan, bare]);
      const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
      const commit = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001', 'manual', true);
      expect(putModels.length).toBeGreaterThanOrEqual(1);
      // The committed arm equals the previewed arm -- the preview is faithful.
      expect(armKey(commit.reasons as any[])).toEqual(previewArm);
    }
  });
});
