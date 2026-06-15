/**
 * Tests for save-back of SOAP endpoint candidates.
 *
 * Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), Group 10.
 *
 * Group 10 extends the existing `case 'endpoints'` arm of
 * `convertCandidateToEntity` in `candidateSaveBackService.ts` to bundle the
 * seven SOAP-specific `data` fields emitted by
 * `springClassicSoap/soapEndpointEmitter.ts` into a `protocol_metadata_json`
 * JSONB blob on the resulting endpoint entity row.
 *
 * The seven SOAP fields (must match the emitter output byte-for-byte):
 *   - soap_action
 *   - request_root_element
 *   - request_namespace
 *   - response_root_element
 *   - request_dto_class
 *   - response_dto_class
 *   - wsdl_source
 *
 * Tests (per Group 10 task spec, 10.1):
 *   1. Round-trip: endpoint candidate with all seven SOAP fields lands on
 *      `protocol_metadata_json` byte-for-byte.
 *   2. Back-compat: REST endpoint candidate (no SOAP fields) leaves
 *      `protocol_metadata_json` undefined / null; REST columns unchanged.
 *   3. Partial SOAP fields: candidate with only `soap_action` and
 *      `wsdl_source` populated produces a JSONB blob containing only those
 *      keys -- missing fields are ABSENT keys, not `null` values.
 */

// Mock dotenv before importing anything else (mirrors pattern in
// candidateSaveBackNewTypes.test.ts).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import { convertCandidateToEntity } from '../services/candidateSaveBackService';

// ============================================================================
// Helper: create a mock DiscoveryCandidateDto
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-default',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'greet',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-17T10:00:00Z',
    parent_candidate_id: 'cand-ifc-1',
    ...overrides,
  };
}

// Parent FK map shared across all tests -- the endpoint candidates resolve
// to a synthetic interface entity ID via the parent-candidate map.
const PARENT_MAP: Record<string, string> = {
  'cand-ifc-1': 'ifc-existing-soap-1',
};

describe('candidateSaveBackService - SOAP endpoint save-back (TG10)', () => {

  // ==========================================================================
  // Test 1: Round-trip -- all seven SOAP fields land in protocol_metadata_json
  // ==========================================================================
  it('round-trips all seven SOAP fields into protocol_metadata_json', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-soap-1',
      name: 'greet',
      candidate_type: 'endpoints',
      data: {
        description: 'SOAP greet operation',
        operation_verb: 'POST',
        path_or_address: '/document-literal-wrapped/GreetingsService',
        // The seven SOAP fields (emitted by soapEndpointEmitter.ts)
        soap_action: 'http://example.com/greetings/greet',
        request_root_element: 'greet',
        request_namespace: 'http://example.com/greetings',
        response_root_element: 'greetResponse',
        request_dto_class: 'com.example.greetings.Greet',
        response_dto_class: 'com.example.greetings.GreetResponse',
        wsdl_source: 'src/main/resources/wsdl/greetings.wsdl',
      },
      parent_candidate_id: 'cand-ifc-1',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // Sanity: shared endpoint columns still populate as before.
    expect(entity.id).toMatch(/^ep-/);
    expect(entity.name).toBe('greet');
    expect(entity.description).toBe('SOAP greet operation');
    expect(entity.model_file_id).toBe('TestProject');
    expect(entity.interface_id).toBe('ifc-existing-soap-1');
    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/document-literal-wrapped/GreetingsService');

    // Byte-for-byte round-trip of the seven SOAP fields into the JSONB blob.
    expect(entity.protocol_metadata_json).toEqual({
      soap_action: 'http://example.com/greetings/greet',
      request_root_element: 'greet',
      request_namespace: 'http://example.com/greetings',
      response_root_element: 'greetResponse',
      request_dto_class: 'com.example.greetings.Greet',
      response_dto_class: 'com.example.greetings.GreetResponse',
      wsdl_source: 'src/main/resources/wsdl/greetings.wsdl',
    });
  });

  // ==========================================================================
  // Test 2: Back-compat -- REST candidate leaves protocol_metadata_json null
  // ==========================================================================
  it('leaves protocol_metadata_json null for REST endpoint candidates (back-compat)', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-rest-1',
      name: 'POST /api/orders',
      candidate_type: 'endpoints',
      data: {
        description: 'Creates a new order',
        http_method: 'POST',
        path: '/api/orders',
        // No SOAP fields whatsoever.
      },
      parent_candidate_id: 'cand-ifc-1',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // REST endpoint columns populate as before.
    expect(entity.id).toMatch(/^ep-/);
    expect(entity.name).toBe('POST /api/orders');
    expect(entity.description).toBe('Creates a new order');
    expect(entity.model_file_id).toBe('TestProject');
    expect(entity.interface_id).toBe('ifc-existing-soap-1');
    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/api/orders');

    // No SOAP metadata -- the column is left absent on the entity object so
    // the downstream PUT serialises it to JSON `null` / omits the key, and
    // the DB column stays NULL on the row (default).
    expect(entity.protocol_metadata_json).toBeUndefined();
  });

  // ==========================================================================
  // Test 3: Partial SOAP fields -- absent-key semantics in the JSONB blob
  // ==========================================================================
  it('forwards only the SOAP keys actually present on the candidate data', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-soap-partial',
      name: 'partialOp',
      candidate_type: 'endpoints',
      data: {
        description: 'SOAP op with partial metadata',
        operation_verb: 'POST',
        path_or_address: '/svc/partial',
        // Only two of the seven SOAP fields populated.
        soap_action: 'http://example.com/partial/op',
        wsdl_source: 'src/main/resources/wsdl/partial.wsdl',
        // The other five SOAP fields are NOT present on the data object
        // (undefined keys). They must NOT appear in the JSONB blob.
      },
      parent_candidate_id: 'cand-ifc-1',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // Sanity on the surrounding endpoint shape.
    expect(entity.id).toMatch(/^ep-/);
    expect(entity.interface_id).toBe('ifc-existing-soap-1');
    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/svc/partial');

    // The blob is created (because at least one SOAP key is present).
    expect(entity.protocol_metadata_json).toBeDefined();

    // Only the present keys appear; absent ones are NOT serialised as null.
    expect(entity.protocol_metadata_json).toEqual({
      soap_action: 'http://example.com/partial/op',
      wsdl_source: 'src/main/resources/wsdl/partial.wsdl',
    });

    // Cross-check absent-key semantics via Object.keys.
    const blobKeys = Object.keys(entity.protocol_metadata_json);
    expect(blobKeys).toHaveLength(2);
    expect(blobKeys).toContain('soap_action');
    expect(blobKeys).toContain('wsdl_source');
    expect(blobKeys).not.toContain('request_root_element');
    expect(blobKeys).not.toContain('request_namespace');
    expect(blobKeys).not.toContain('response_root_element');
    expect(blobKeys).not.toContain('request_dto_class');
    expect(blobKeys).not.toContain('response_dto_class');
  });

  // ==========================================================================
  // Test 4 (Phase 2 Group 3 -- W-10): `discovery_method` rides into
  // `protocol_metadata_json` alongside the seven Phase 1 SOAP fields when
  // the candidate's `data` carries the Phase 1 deterministic value
  // (`'framework_scanner'`). No new AMS schema change -- the field is
  // just another key on the existing JSONB blob.
  // ==========================================================================
  it('round-trips discovery_method=framework_scanner inside protocol_metadata_json', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-soap-framework',
      name: 'greet',
      candidate_type: 'endpoints',
      data: {
        description: 'SOAP greet operation (framework scanner)',
        operation_verb: 'POST',
        path_or_address: '/ws/greet',
        soap_action: 'http://example.com/greet',
        request_root_element: 'greet',
        request_namespace: 'http://example.com/',
        response_root_element: 'greetResponse',
        request_dto_class: 'com.example.Greet',
        response_dto_class: 'com.example.GreetResponse',
        wsdl_source: 'src/main/resources/wsdl/greet.wsdl',
        // Phase 2 Group 3 trace metadata.
        discovery_method: 'framework_scanner',
      },
      parent_candidate_id: 'cand-ifc-1',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // discovery_method rides into the same JSONB blob as the seven Phase 1
    // SOAP fields -- the candidate-side enumeration in
    // `SOAP_PROTOCOL_METADATA_FIELDS` was extended (not replaced) so the
    // round-trip is a single-blob write.
    expect(entity.protocol_metadata_json).toEqual({
      soap_action: 'http://example.com/greet',
      request_root_element: 'greet',
      request_namespace: 'http://example.com/',
      response_root_element: 'greetResponse',
      request_dto_class: 'com.example.Greet',
      response_dto_class: 'com.example.GreetResponse',
      wsdl_source: 'src/main/resources/wsdl/greet.wsdl',
      discovery_method: 'framework_scanner',
    });
  });

  // ==========================================================================
  // Test 5 (Phase 2 Group 3 -- W-10): `discovery_method='llm_extraction'`
  // round-trips with the same shape -- this is the Workstream A emitter's
  // future value (Group 7 will set it). The save-back arm carries it
  // unchanged; AMS persists it as another key on `protocol_metadata_json`.
  // ==========================================================================
  it('round-trips discovery_method=llm_extraction inside protocol_metadata_json', () => {
    const candidate = makeCandidate({
      id: 'cand-ep-soap-llm',
      name: 'getAccount',
      candidate_type: 'endpoints',
      data: {
        description: 'SOAP getAccount operation (LLM extraction, Phase 2)',
        operation_verb: 'POST',
        path_or_address: '/svc/account',
        // Subset of SOAP fields the LLM extractor produces -- it has no
        // WSDL source by construction, so wsdl_source is intentionally
        // ABSENT.
        soap_action: 'http://example.com/getAccount',
        request_root_element: 'getAccount',
        response_root_element: 'getAccountResponse',
        request_dto_class: 'com.example.GetAccount',
        response_dto_class: 'com.example.GetAccountResponse',
        // Phase 2 Group 3 trace metadata -- Workstream A path.
        discovery_method: 'llm_extraction',
      },
      parent_candidate_id: 'cand-ifc-1',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // discovery_method='llm_extraction' rides through; absent SOAP fields
    // (request_namespace, wsdl_source) stay absent.
    expect(entity.protocol_metadata_json).toEqual({
      soap_action: 'http://example.com/getAccount',
      request_root_element: 'getAccount',
      response_root_element: 'getAccountResponse',
      request_dto_class: 'com.example.GetAccount',
      response_dto_class: 'com.example.GetAccountResponse',
      discovery_method: 'llm_extraction',
    });

    const blobKeys = Object.keys(entity.protocol_metadata_json);
    expect(blobKeys).toContain('discovery_method');
    expect(blobKeys).not.toContain('wsdl_source');
    expect(blobKeys).not.toContain('request_namespace');
  });

});
