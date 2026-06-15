/**
 * Tests for Model-Aware Discovery -- Task Group 4 (the deterministic save-back
 * core): dedup-against-existing, enrich-apply, logical<->physical link, late
 * name-resolution, and conflict / target-gone Findings.
 *
 * Spec: 2026-05-30 Model-Aware Discovery / Dedup Against Existing Entities.
 *
 * Scope (4.1) -- the crux paths only:
 *   (a) EXACT (1.0) match of a re-discovered entity -> AUTO-SUPPRESS, no
 *       duplicate minted, suppressed count/set recorded on the run summary.
 *   (b) NORMALIZED (0.7) match -> a reviewable low-confidence "possible
 *       duplicate" (below the 0.75 gate, NOT auto-applied, NOT minted).
 *   (c) an `enrich` adds an attribute to the resolved existing entity WITHOUT
 *       overwriting any existing field.
 *   (d) a `link` populates `logical_data_entity_physical_data_entities` on an
 *       EXACT match, and does NOT synthesize a 1:1 when there is no match.
 *   (e) an enrich/link whose target is GONE at save-back -> a Finding (not a
 *       silent drop).
 *   (f) a conflicting value for an existing attribute -> a Finding linked to
 *       `architecture_element`, severity `low`, with NO overwrite.
 *
 * Driven through the REAL `saveDiscoveryCandidatesToModel` orchestration with
 * axios mocked at the module level (mirrors `candidateSaveBackOrchestration.test.ts`),
 * so dedup / enrich / link / findings all exercise the production GET-merge-PUT
 * path and the shared identity primitive -- no forked matcher.
 */

// Mock dotenv before importing anything else.
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

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
// Helpers
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

/**
 * Build a model whose entities/relationships sections carry only the keys the
 * tests touch; the orchestration tops up any missing keys from the empty shell.
 */
function makeModel(opts: {
  logical?: any[];
  physical?: any[];
  logicalAttrs?: any[];
  physicalAttrs?: any[];
  links?: any[];
} = {}): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: [],
        interfaces: [],
        endpoints: [],
        logical_data_entities: opts.logical || [],
        logical_data_attributes: opts.logicalAttrs || [],
        physical_data_entities: opts.physical || [],
        physical_data_attributes: opts.physicalAttrs || [],
      },
      relationships: {
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: opts.links || [],
        interface_logical_entities: [],
        endpoint_data_effects: [],
      },
    },
    diagrams: [],
  };
}

/**
 * Wire axios so the real archModelClient round-trips against the given model +
 * candidates. Captures every PUT'd model and POST'd findings body. Returns the
 * mock client so the test can assert on the captured calls.
 */
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
        // Deep-clone so later mutation of the live model doesn't rewrite history.
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

/** The last model body PUT to AMS (the final saved state). */
function lastModel(putModels: any[]): any {
  return putModels[putModels.length - 1];
}

describe('candidateSaveBackService - model-aware dedup/enrich/link (TG4)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // (a) EXACT match -> AUTO-SUPPRESS (no duplicate minted; counted + recorded).
  // ==========================================================================
  it('(a) auto-suppresses a re-discovered entity on an EXACT match and records the suppressed set', async () => {
    const model = makeModel({ logical: [{ id: 'lde-existing', name: 'Owner' }] });
    const reDiscovered = makeCandidate({
      id: 'cand-owner',
      candidate_type: 'logical_data_entities',
      name: 'Owner', // byte-for-byte match of the existing entity
      confidence: 0.95,
    });
    const { putModels } = wireAxios(model, [reDiscovered]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // No second entity minted.
    expect(result.entitiesCreated).toBe(0);
    expect(result.entitiesSuppressed).toBe(1);
    expect(result.suppressedDuplicates).toHaveLength(1);
    expect(result.suppressedDuplicates[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-owner',
        candidateName: 'Owner',
        entityType: 'logical_data_entities',
        existingEntityId: 'lde-existing',
      }),
    );
    // The saved model still has exactly the one pre-existing Owner.
    const saved = lastModel(putModels);
    expect(saved.metaModel.entities.logical_data_entities).toHaveLength(1);
    expect(saved.metaModel.entities.logical_data_entities[0].id).toBe('lde-existing');
    // The suppressed candidate is NOT committed (no provenance action for it).
    expect(result.candidatesCommitted).toBe(0);
  });

  // ==========================================================================
  // (b) NORMALIZED match -> reviewable possible-duplicate (NOT minted/applied).
  // ==========================================================================
  it('(b) treats a NORMALIZED match as a reviewable possible-duplicate below the gate (no mint)', async () => {
    const model = makeModel({ logical: [{ id: 'lde-owner', name: 'Owner' }] });
    // "owners" normalizes to "owner" -> a 0.7 normalized match (below 0.75).
    const reDiscovered = makeCandidate({
      id: 'cand-owners',
      candidate_type: 'logical_data_entities',
      name: 'owners',
      confidence: 0.95,
    });
    const { putModels } = wireAxios(model, [reDiscovered]);

    const { saveDiscoveryCandidatesToModel, NAME_MATCH_NORMALIZED_CONFIDENCE } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // Not auto-suppressed, not minted -- a reviewable possible-duplicate.
    expect(result.entitiesSuppressed).toBe(0);
    expect(result.entitiesCreated).toBe(0);
    expect(result.possibleDuplicates).toHaveLength(1);
    expect(result.possibleDuplicates[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-owners',
        candidateName: 'owners',
        existingEntityId: 'lde-owner',
        confidence: NAME_MATCH_NORMALIZED_CONFIDENCE,
      }),
    );
    // No duplicate "owners" entity was minted.
    const saved = lastModel(putModels);
    expect(saved.metaModel.entities.logical_data_entities).toHaveLength(1);
    expect(saved.metaModel.entities.logical_data_entities[0].name).toBe('Owner');
  });

  // ==========================================================================
  // (c) enrich -> ADD an attribute to the resolved entity WITHOUT overwrite.
  // ==========================================================================
  it('(c) applies an enrich by ADDING an attribute to the resolved entity without overwriting existing fields', async () => {
    const model = makeModel({
      logical: [{ id: 'lde-owner', name: 'Owner' }],
      logicalAttrs: [
        { id: 'lda-existing', name: 'id', logical_entity_id: 'lde-owner', data_type: 'bigint' },
      ],
    });
    const enrich = makeCandidate({
      id: 'cand-enrich-email',
      candidate_type: 'logical_data_attributes',
      name: 'Owner.email',
      confidence: 0.82,
      operation: 'enrich',
      data: { targetEntityName: 'Owner', targetConfidence: 0.9, dataType: 'varchar' },
    });
    const { putModels } = wireAxios(model, [enrich]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.enrichmentsApplied).toBe(1);
    const saved = lastModel(putModels);
    const attrs = saved.metaModel.entities.logical_data_attributes;
    // The pre-existing `id` attribute is untouched...
    const idAttr = attrs.find((a: any) => a.name === 'id');
    expect(idAttr).toBeDefined();
    expect(idAttr.id).toBe('lda-existing');
    expect(idAttr.data_type).toBe('bigint');
    // ...and the new `email` attribute was ADDED under the same parent.
    const emailAttr = attrs.find((a: any) => a.name === 'email');
    expect(emailAttr).toBeDefined();
    expect(emailAttr.logical_entity_id).toBe('lde-owner');
    expect(emailAttr.data_type).toBe('varchar');
    // No conflict finding for a clean add.
    expect(result.findingsEmitted).toHaveLength(0);
  });

  // ==========================================================================
  // (d) link -> populate the mapping on EXACT; synthesize NOTHING on no match.
  // ==========================================================================
  it('(d) writes a logical<->physical mapping row on an EXACT match and never synthesizes a 1:1', async () => {
    const model = makeModel({
      logical: [{ id: 'lde-owner', name: 'Owner' }],
      physical: [{ id: 'pde-owners', name: 'owners' }],
    });
    // EXACT both sides (names match their own layer byte-for-byte).
    const linkExact = makeCandidate({
      id: 'cand-link',
      candidate_type: 'logical_data_entity_physical_data_entities',
      name: 'Owner <-> owners',
      confidence: 0.9,
      operation: 'link',
      data: { logicalEntityName: 'Owner', physicalEntityName: 'owners', targetConfidence: 0.95 },
    });
    const { putModels } = wireAxios(model, [linkExact]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.linksCreated).toBe(1);
    const saved = lastModel(putModels);
    const mappings = saved.metaModel.relationships.logical_data_entity_physical_data_entities;
    expect(mappings).toHaveLength(1);
    // The mapping carries the RAW entity FKs (distinct layers; not a *_point id).
    expect(mappings[0].logical_entity_id).toBe('lde-owner');
    expect(mappings[0].physical_entity_id).toBe('pde-owners');
    // Crucially: no data_entity_point wrapper was created anywhere.
    expect(saved.metaModel.entities.data_entity_points || []).toHaveLength(0);
    expect(JSON.stringify(mappings[0])).not.toContain('dep_log_');
    expect(JSON.stringify(mappings[0])).not.toContain('dep_phy_');
  });

  it('(d2) writes NO mapping (no synthesized 1:1) when the physical side does not exist, and raises a target-gone Finding', async () => {
    const model = makeModel({
      logical: [{ id: 'lde-owner', name: 'Owner' }],
      physical: [], // physical side absent
    });
    const linkNoMatch = makeCandidate({
      id: 'cand-link-gone',
      candidate_type: 'logical_data_entity_physical_data_entities',
      name: 'Owner <-> owners',
      confidence: 0.9,
      operation: 'link',
      data: { logicalEntityName: 'Owner', physicalEntityName: 'owners' },
    });
    const { putModels } = wireAxios(model, [linkNoMatch]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.linksCreated).toBe(0);
    const saved = lastModel(putModels);
    expect(saved.metaModel.relationships.logical_data_entity_physical_data_entities).toHaveLength(0);
    // Target-gone surfaces as a Finding, never a silent drop.
    expect(result.findingsEmitted.length).toBeGreaterThanOrEqual(1);
    expect(result.findingsEmitted[0].findingType).toBe('enrich_target_missing');
  });

  // ==========================================================================
  // (e) enrich whose TARGET is GONE at save-back -> a Finding (not silent).
  // ==========================================================================
  it('(e) emits a Finding (no silent drop) when an enrich target no longer exists at save-back', async () => {
    const model = makeModel({ logical: [{ id: 'lde-other', name: 'Customer' }] });
    const enrichGone = makeCandidate({
      id: 'cand-enrich-gone',
      candidate_type: 'logical_data_attributes',
      name: 'Owner.email',
      confidence: 0.82,
      operation: 'enrich',
      data: { targetEntityName: 'Owner', dataType: 'varchar' }, // "Owner" no longer in model
    });
    const { findingsPosts } = wireAxios(model, [enrichGone]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.enrichmentsApplied).toBe(0);
    expect(result.findingsEmitted).toHaveLength(1);
    expect(result.findingsEmitted[0]).toEqual(
      expect.objectContaining({
        findingType: 'enrich_target_missing',
        severity: 'low',
      }),
    );
    // It links to the originating candidate (not a silent drop).
    expect(result.findingsEmitted[0].links?.[0]).toEqual(
      expect.objectContaining({ targetType: 'discovery_candidate', targetId: 'cand-enrich-gone' }),
    );
    // And it was best-effort POSTed to the AMS findings surface.
    expect(findingsPosts.length).toBeGreaterThanOrEqual(1);
    expect(findingsPosts[0].url).toContain('/findings');
  });

  // ==========================================================================
  // (f) conflicting value for an existing attribute -> a Finding (no overwrite).
  // ==========================================================================
  it('(f) raises a low-severity architecture_element Finding on an attribute conflict and does NOT overwrite', async () => {
    const model = makeModel({
      logical: [{ id: 'lde-owner', name: 'Owner' }],
      logicalAttrs: [
        { id: 'lda-email', name: 'email', logical_entity_id: 'lde-owner', data_type: 'varchar(255)' },
      ],
    });
    // Enrich proposes the SAME attribute name with a DIFFERENT data type.
    const conflicting = makeCandidate({
      id: 'cand-conflict',
      candidate_type: 'logical_data_attributes',
      name: 'Owner.email',
      confidence: 0.82,
      operation: 'enrich',
      data: { targetEntityName: 'Owner', dataType: 'text' }, // differs from varchar(255)
    });
    const { putModels } = wireAxios(model, [conflicting]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // No new attribute added; no overwrite of the existing value.
    expect(result.enrichmentsApplied).toBe(0);
    const saved = lastModel(putModels);
    const attrs = saved.metaModel.entities.logical_data_attributes;
    expect(attrs).toHaveLength(1);
    expect(attrs[0].id).toBe('lda-email');
    expect(attrs[0].data_type).toBe('varchar(255)'); // unchanged

    // A conflict Finding, severity low, linked to the architecture_element.
    expect(result.findingsEmitted).toHaveLength(1);
    const finding = result.findingsEmitted[0];
    expect(finding.findingType).toBe('attribute_conflict');
    expect(finding.severity).toBe('low');
    expect(finding.links?.[0]).toEqual(
      expect.objectContaining({ targetType: 'architecture_element', targetId: 'lde-owner' }),
    );
  });
});
