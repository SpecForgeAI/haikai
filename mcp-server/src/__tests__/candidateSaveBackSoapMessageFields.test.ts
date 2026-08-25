/**
 * Tests for save-back of the SOAP/WSDL message-shape candidates.
 *
 * Spec: SOAP/WSDL Message-Field Depth for Discovery (Spec 4, 2026-05-30) --
 * Task Group 6 (sub-task 6.1). EXTENDS `candidateSaveBackService.ts` to persist
 * the SOAP-derived candidates Group 4 emits (`messageEntityEmitter.ts`) and the
 * Group 5 SOAP `endpoint_data_effects` (`soapDataEffectEmitter.ts`).
 *
 * The genuinely-NEW save-back code under test is the ADDITIVE pass-through of:
 *   - `data.source_provenance` -> `logical_data_entities.source_provenance`
 *     (Group 1 column; `LogicalDataEntityDto.sourceProvenance`, snake_case wire),
 *   - `data.field_metadata`    -> `logical_data_attributes.field_metadata`
 *     (Group 1 column; `LogicalDataAttributeDto.fieldMetadata`, snake_case wire).
 *
 * Everything else is CONFIRMED to ride the existing arms (no fork):
 *   - the shared identity primitive + Issue 2 dedup (idempotent re-run; no
 *     duplicate SOAP entity on a second scan); WSDL<->Java reconciles to ONE
 *     persisted entity through the SAME primitive,
 *   - `interface_logical_entities` (Pass 2.5; `interfaceClassName` +
 *     `logicalEntityName` -> interface.id + `dep_log_<id>`),
 *   - endpoint request/response binding (Pass 1b; `data.requestEntity` /
 *     `data.responseEntity` -> `request_data_entity_point_id` /
 *     `response_data_entity_point_id` via `dep_log_<id>`),
 *   - SOAP `endpoint_data_effects` (Pass 2.6; identical Spec 1 shape).
 *
 * NEVER creates/modifies a `*_points` wrapper; NEVER synthesizes a 1:1
 * logical<->physical mapping. Driven through the REAL
 * `saveDiscoveryCandidatesToModel` orchestration with axios mocked at the module
 * level (mirrors `candidateSaveBackModelAware.test.ts`), so the pass-through,
 * dedup and bindings all exercise the production GET-merge-PUT path and the
 * shared matcher -- no forked logic.
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
    name: 'DefaultMessageType',
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
 * Build a model whose entities/relationships carry only the keys the tests
 * touch; the orchestration tops up any missing keys from the empty shell.
 */
function makeModel(opts: {
  services?: any[];
  interfaces?: any[];
  endpoints?: any[];
  logical?: any[];
  physical?: any[];
  logicalAttrs?: any[];
} = {}): any {
  return {
    metaModel: {
      entities: {
        applications: [],
        services: opts.services || [],
        interfaces: opts.interfaces || [],
        endpoints: opts.endpoints || [],
        logical_data_entities: opts.logical || [],
        logical_data_attributes: opts.logicalAttrs || [],
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

/**
 * Wire axios so the real archModelClient round-trips against the given model +
 * candidates. Captures every PUT'd model. `existingMappings` seeds the
 * candidate-entity-mappings GET (default empty).
 */
function wireAxios(
  model: any,
  candidates: DiscoveryCandidateDto[],
  existingMappings: any[] = [],
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
        return Promise.resolve({ data: existingMappings });
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

/**
 * A SOAP message ENTITY candidate exactly as `messageEntityEmitter.ts`
 * (buildEntityCandidate) shapes its `data`. Provenance on `source_provenance`.
 */
function soapEntityCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return makeCandidate({
    candidate_type: 'logical_data_entities',
    data: {
      source_provenance: 'namespace=http://example.com/greetings; class=com.example.greetings.Greet',
      provenance_namespace: 'http://example.com/greetings',
      provenance_class: 'com.example.greetings.Greet',
      reconciled_sources: ['xsd', 'java'],
      field_count: 1,
      discovery_method: 'framework_scanner',
      _addedBy: 'spring-classic-soap-message',
    },
    ...overrides,
  });
}

/**
 * A SOAP message FIELD (attribute) candidate exactly as
 * `messageEntityEmitter.ts` (buildAttributeCandidate) shapes its `data`. The
 * Group-1 JSONB blob is on `field_metadata`; `is_nullable` source on
 * `isNullable`. Parent FK via `parent_candidate_id` (the entity candidate id).
 */
function soapAttributeCandidate(
  parentCandidateId: string,
  parentEntityName: string,
  fieldName: string,
  fieldMetadata: Record<string, unknown>,
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return makeCandidate({
    candidate_type: 'logical_data_attributes',
    name: fieldName,
    parent_candidate_id: parentCandidateId,
    data: {
      dataType: (fieldMetadata.xsd_source_type as string) || 'xsd:string',
      isNullable: false,
      field_metadata: fieldMetadata,
      logicalEntityName: parentEntityName,
      discovery_method: 'framework_scanner',
      _addedBy: 'spring-classic-soap-message',
    },
    ...overrides,
  });
}

describe('candidateSaveBackService - SOAP message-shape save-back (Spec 4, TG6)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    generateIdCounter = 0;
  });

  // ==========================================================================
  // 1) The NEW pass-through: field_metadata + source_provenance land on the
  //    persisted rows (additive). The SOAP entity + its attribute resolve
  //    through the existing candidate arms; parent-FK `logical_entity_id` is
  //    resolved from the entity candidate id (unchanged mechanism).
  // ==========================================================================
  it('persists the SOAP entity provenance + the attribute field_metadata blob as additive payload', async () => {
    const fieldMetadata = {
      cardinality: { min_occurs: 0, max_occurs: 1, is_collection: false },
      xsd_source_type: 'xsd:string',
      source: 'xsd',
      restrictions: {
        enumeration: ['GOLD', 'SILVER', 'BRONZE'],
        pattern: '[A-Z]+',
        maxLength: 16,
      },
    };
    const entityCand = soapEntityCandidate({ id: 'cand-greet-entity', name: 'Greet' });
    const attrCand = soapAttributeCandidate(
      'cand-greet-entity',
      'Greet',
      'tier',
      fieldMetadata,
      { id: 'cand-greet-tier' },
    );
    const { putModels } = wireAxios(makeModel(), [entityCand, attrCand]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.entitiesCreated).toBe(2); // the entity + the attribute

    const saved = lastModel(putModels);
    const ldes = saved.metaModel.entities.logical_data_entities;
    const ldas = saved.metaModel.entities.logical_data_attributes;
    expect(ldes).toHaveLength(1);
    expect(ldas).toHaveLength(1);

    // Provenance landed on the entity row, snake_case wire key.
    const greet = ldes[0];
    expect(greet.name).toBe('Greet');
    expect(greet.source_provenance).toBe(
      'namespace=http://example.com/greetings; class=com.example.greetings.Greet',
    );

    // The attribute carries: the real is_nullable column (from nillable, NOT
    // overloaded with cardinality), the data_type, the resolved parent FK, AND
    // the additive field_metadata JSONB blob byte-for-byte.
    const tier = ldas[0];
    expect(tier.name).toBe('tier');
    expect(tier.data_type).toBe('xsd:string');
    expect(tier.is_nullable).toBe(false);
    expect(tier.logical_entity_id).toBe(greet.id); // parent-FK resolution unchanged
    expect(tier.field_metadata).toEqual(fieldMetadata);
    // Cardinality lives in the blob, NOT on is_nullable.
    expect(tier.field_metadata.cardinality).toEqual({
      min_occurs: 0,
      max_occurs: 1,
      is_collection: false,
    });
    expect(tier.field_metadata.restrictions.enumeration).toEqual(['GOLD', 'SILVER', 'BRONZE']);
  });

  // ==========================================================================
  // 2) Idempotent on a SECOND scan: a re-discovered SOAP message entity whose
  //    name already exists in the model is AUTO-SUPPRESSED through the reused
  //    identity primitive -- no duplicate SOAP entity minted. (Issue 2 dedup.)
  // ==========================================================================
  it('does not mint a duplicate SOAP entity on a second scan (reused identity primitive + dedup)', async () => {
    const model = makeModel({ logical: [{ id: 'lde-greet-existing', name: 'Greet' }] });
    // Second scan re-discovers the SAME message type (byte-for-byte name).
    const reDiscovered = soapEntityCandidate({
      id: 'cand-greet-again',
      name: 'Greet',
      confidence: 0.95,
    });
    const { putModels } = wireAxios(model, [reDiscovered]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // No second entity minted; the suppression is counted + recorded (no silent drop).
    expect(result.entitiesCreated).toBe(0);
    expect(result.entitiesSuppressed).toBe(1);
    expect(result.suppressedDuplicates[0]).toEqual(
      expect.objectContaining({
        candidateName: 'Greet',
        entityType: 'logical_data_entities',
        existingEntityId: 'lde-greet-existing',
      }),
    );
    const saved = lastModel(putModels);
    expect(saved.metaModel.entities.logical_data_entities).toHaveLength(1);
    expect(saved.metaModel.entities.logical_data_entities[0].id).toBe('lde-greet-existing');
  });

  // ==========================================================================
  // 3) WSDL-vs-Java duplicate reconciles to ONE persisted entity through the
  //    SAME primitive: two entity candidates for the same logical message type
  //    (one carrying the XSD provenance, one the Java DTO class) collapse to a
  //    single persisted `logical_data_entity` (no duplicate row).
  // ==========================================================================
  it('reconciles a WSDL-view and Java-view of the same message type to ONE persisted entity', async () => {
    // NOTE: Group 4's reconciler already collapses the two views before save-back,
    // but the save-back arm must ALSO be idempotent if both views ever reach it
    // (e.g. two passes). Here the XSD-named "Account" already exists in the model
    // and the Java-view "account" re-discovers it -> resolves to the SAME entity
    // via the shared matcher (normalized below the gate => reviewable, never a
    // second mint), and a byte-for-byte "Account" re-discovery is auto-suppressed.
    const model = makeModel({ logical: [{ id: 'lde-account', name: 'Account' }] });
    const xsdView = soapEntityCandidate({
      id: 'cand-account-xsd',
      name: 'Account', // exact -> auto-suppress (same entity)
    });
    const javaView = soapEntityCandidate({
      id: 'cand-account-java',
      name: 'account', // case-fold -> auto-suppressed (Kiro 2026-08-25: a
      // case-only variant is the SAME name, bound confidently — previously
      // this raised a reviewable possible-duplicate for a non-collision)
    });
    const { putModels } = wireAxios(model, [xsdView, javaView]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    // Neither view mints a second entity: both resolve to the one existing entity.
    expect(result.entitiesCreated).toBe(0);
    const saved = lastModel(putModels);
    const accounts = saved.metaModel.entities.logical_data_entities;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('lde-account');
    // BOTH views suppress: exact for the XSD view, case-fold for the Java
    // view (the genuinely-normalized possible-duplicate path stays pinned in
    // candidateSaveBackFalseMergeGuard).
    expect(result.entitiesSuppressed).toBe(2);
    expect(result.possibleDuplicates).toHaveLength(0);
  });

  // ==========================================================================
  // 4) interface_logical_entities is written: the SOAP interface link resolves
  //    `interfaceClassName` -> interface.id and `logicalEntityName` ->
  //    `dep_log_<id>` (existing Pass 2.5 arm; reused, not forked).
  // ==========================================================================
  it('writes interface_logical_entities binding the SOAP interface to its message type', async () => {
    const model = makeModel({
      interfaces: [{ id: 'ifc-greetings', name: 'GreetingsPortType' }],
      logical: [{ id: 'lde-greet', name: 'Greet' }],
    });
    const ileCand = makeCandidate({
      id: 'cand-ile-1',
      candidate_type: 'interface_logical_entities',
      name: 'GreetingsPortType <-> Greet',
      data: {
        interfaceClassName: 'GreetingsPortType',
        logicalEntityName: 'Greet',
        direction: 'exposes',
        _addedBy: 'spring-classic-soap-message',
      },
    });
    const { putModels } = wireAxios(model, [ileCand]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.entitiesCreated).toBe(1);
    const saved = lastModel(putModels);
    const iles = saved.metaModel.relationships.interface_logical_entities;
    expect(iles).toHaveLength(1);
    expect(iles[0].interface_id).toBe('ifc-greetings');
    // The message-type side resolves to the auto-managed point id (synthesized
    // at save-back, NEVER a *_point row we create).
    expect(iles[0].dataEntityPointId).toBe('dep_log_lde-greet');
  });

  // ==========================================================================
  // 5) Endpoint request/response binding for SOAP: an endpoint candidate
  //    carrying `data.requestEntity` / `data.responseEntity` (the in-place
  //    mutation Group 4 makes) binds `request_data_entity_point_id` /
  //    `response_data_entity_point_id` to `dep_log_<id>` (existing Pass 1b).
  // ==========================================================================
  it('binds endpoint request/response message entities to dep_log_<id> for SOAP', async () => {
    const model = makeModel({
      services: [{ id: 'svc-1', name: 'GreetingsService' }],
      interfaces: [{ id: 'ifc-greetings', name: 'GreetingsPortType', service_id: 'svc-1' }],
      logical: [
        { id: 'lde-greet', name: 'Greet' },
        { id: 'lde-greet-resp', name: 'GreetResponse' },
      ],
    });
    // SOAP endpoint candidate: parent is the existing interface (resolved via
    // direct FK on data.interface_id), carrying the request/response message
    // names Group 4 mutated in place.
    const endpointCand = makeCandidate({
      id: 'cand-ep-greet',
      candidate_type: 'endpoints',
      name: 'greet',
      parent_candidate_id: null,
      data: {
        interface_id: 'ifc-greetings', // direct FK -> existing interface
        operation_verb: 'POST',
        path_or_address: '/ws/GreetingsService',
        // The two fields Group 4's emitter sets on the endpoint's data in place:
        requestEntity: 'Greet',
        responseEntity: 'GreetResponse',
        // SOAP protocol metadata also present (rides protocol_metadata_json).
        soap_action: 'http://example.com/greetings/greet',
        request_root_element: 'greet',
      },
    });
    const { putModels } = wireAxios(model, [endpointCand]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.entitiesCreated).toBe(1);
    const saved = lastModel(putModels);
    const endpoints = saved.metaModel.entities.endpoints;
    expect(endpoints).toHaveLength(1);
    const greetEp = endpoints[0];
    expect(greetEp.request_data_entity_point_id).toBe('dep_log_lde-greet');
    expect(greetEp.response_data_entity_point_id).toBe('dep_log_lde-greet-resp');
  });

  // ==========================================================================
  // 6) SOAP endpoint_data_effects persist through the EXISTING Spec 1 path:
  //    the candidate carries the identical Spec 1 shape (endpointName,
  //    dataEntityName, access_mode, path_metadata_json), both sides resolve via
  //    the shared primitive, and the AMS relationship row lands.
  // ==========================================================================
  it('persists a SOAP endpoint_data_effects row through the existing Spec 1 data-effect path', async () => {
    const pathMetadata = {
      hops: [
        { method_id: 'com.foo.GreetEndpoint#greet', class_name: 'GreetEndpoint', method_name: 'greet', role: 'controller' },
        { method_id: 'com.foo.GreetService#load', class_name: 'GreetService', method_name: 'load', role: 'service' },
        { method_id: 'com.foo.AccountRepository#findById', class_name: 'AccountRepository', method_name: 'findById', role: 'repository' },
      ],
      operation_hint: 'select',
      transactional: false,
    };
    const model = makeModel({
      endpoints: [{ id: 'ep-greet', name: 'greet' }],
      logical: [{ id: 'lde-account', name: 'Account' }],
    });
    const edeCand = makeCandidate({
      id: 'cand-ede-soap',
      candidate_type: 'endpoint_data_effects',
      name: 'greet → Account (read)',
      data: {
        endpointName: 'greet',
        dataEntityName: 'Account',
        access_mode: 'read',
        operation_hint: 'select',
        transactional: false,
        path_metadata_json: pathMetadata,
        _addedBy: 'spring-classic-soap-data-effect',
      },
    });
    const { putModels } = wireAxios(model, [edeCand]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    const result = await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    expect(result.entitiesCreated).toBe(1);
    const saved = lastModel(putModels);
    const edes = saved.metaModel.relationships.endpoint_data_effects;
    expect(edes).toHaveLength(1);
    const edge = edes[0];
    expect(edge.endpoint_id).toBe('ep-greet');
    expect(edge.data_entity_point_id).toBe('dep_log_lde-account');
    expect(edge.access_mode).toBe('read');
    expect(edge.path_metadata_json).toEqual(pathMetadata);
    // snake_case-only contract: no camelCase leakage of the point-id field.
    expect(edge.dataEntityPointId).toBeUndefined();
  });

  // ==========================================================================
  // 7) Meta-model guard: across the WHOLE saved model, NO `*_points` wrapper is
  //    ever created by save-back, and NO 1:1 logical<->physical mapping is
  //    synthesized. The point ids are deterministic `dep_log_<id>` REFERENCES
  //    only (auto-managed wrappers stay backend-side).
  // ==========================================================================
  it('never creates a *_points wrapper row and never synthesizes a 1:1 logical<->physical mapping', async () => {
    const model = makeModel({
      interfaces: [{ id: 'ifc-greetings', name: 'GreetingsPortType' }],
      endpoints: [{ id: 'ep-greet', name: 'greet' }],
      logical: [{ id: 'lde-greet', name: 'Greet' }],
    });
    const entityCand = soapEntityCandidate({ id: 'cand-acct', name: 'Account' });
    const attrCand = soapAttributeCandidate('cand-acct', 'Account', 'id', {
      cardinality: { min_occurs: 1, max_occurs: 1, is_collection: false },
      xsd_source_type: 'xsd:long',
      source: 'xsd',
    }, { id: 'cand-acct-id' });
    const ileCand = makeCandidate({
      id: 'cand-ile',
      candidate_type: 'interface_logical_entities',
      name: 'GreetingsPortType <-> Greet',
      data: { interfaceClassName: 'GreetingsPortType', logicalEntityName: 'Greet' },
    });
    const edeCand = makeCandidate({
      id: 'cand-ede',
      candidate_type: 'endpoint_data_effects',
      name: 'greet → Greet (read)',
      data: { endpointName: 'greet', dataEntityName: 'Greet', access_mode: 'read' },
    });
    const { putModels } = wireAxios(model, [entityCand, attrCand, ileCand, edeCand]);

    const { saveDiscoveryCandidatesToModel } = require('../services/candidateSaveBackService');
    await saveDiscoveryCandidatesToModel('proj-001', 'arch-001', 'run-001');

    const saved = lastModel(putModels);

    // No *_points wrapper row was ever written by save-back (they are backend
    // auto-managed; we only synthesize `dep_log_<id>` REFERENCES at the edges).
    expect(saved.metaModel.entities.data_entity_points || []).toHaveLength(0);
    expect(saved.metaModel.entities.application_points || []).toHaveLength(0);
    expect(saved.metaModel.entities.business_points || []).toHaveLength(0);

    // No 1:1 logical<->physical mapping was synthesized for the minted SOAP
    // entity (Spec 4 mints logical-only; physical mapping is never invented).
    expect(
      saved.metaModel.relationships.logical_data_entity_physical_data_entities || [],
    ).toHaveLength(0);
  });
});
