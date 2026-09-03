/**
 * Tests for the request-contract save-back pass-through (Spec 2026-06-19
 * Request Contract from Code Evidence, Task Group 2).
 *
 * On save-approved, `convertCandidateToEntity` for an `endpoints` candidate
 * must carry the request-construction facts the discovery scanner / adapter
 * already produced onto the candidate `data` through to the AMS
 * `endpoints.request_contract` JSONB column (added in Task Group 1) — sibling
 * to the existing `response_contract` pass-through.
 *
 * Two shapes are accepted:
 *   (1) a pre-assembled structured `request_contract` block (Phase 2 scanner)
 *       rides through verbatim; snake/camel-tolerant (`requestContract` too);
 *   (2) the loose Phase-1 adapter facts (`consumes` -> request media type,
 *       required `headers`/`requestHeaders`, `requestParams`) are assembled
 *       into a `request_contract` object so they no longer die at save-back.
 *
 * Additive + nullable / absent-key: an endpoint with NO request facts leaves
 * the column UNSET (absent key, never null) so a tier-gated-off / empty scan
 * does not wipe an existing value — mirroring the `response_contract` arm.
 */

// Mock dotenv before importing anything else (mirrors the sibling save-back tests).
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import { convertCandidateToEntity } from '../services/candidateSaveBackService';

function makeEndpointCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return {
    id: 'cand-ep-1',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'POST /owners',
    confidence: 0.81,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/web/OwnerController.java'],
    data: {
      http_method: 'POST',
      path: '/owners',
    },
    synthesized_at: '2026-06-19T10:00:00Z',
    parent_candidate_id: 'cand-ifc-1',
    ...overrides,
  };
}

// Parent FK map — the endpoint candidate resolves its `interface_id` parent FK
// to a synthetic interface entity ID via the parent-candidate map (mirrors the
// response-contract save-back tests).
const PARENT_MAP: Record<string, string> = {
  'cand-ifc-1': 'ifc-1',
};

// A pre-assembled structured request-contract block, mirroring the
// response-contract precedent (internal schema_version, boxed confidence).
const REQUEST_CONTRACT = {
  schema_version: 'request_contract.v1',
  content_type: 'application/json',
  consumes: ['application/json'],
  required_headers: [{ name: 'X-Tenant', source: '@RequestHeader' }],
  param_formats: [
    { name: 'businessDate', location: 'query', format: 'dd-MMM-yyyy', pattern: null, source: '@DateTimeFormat' },
  ],
  provenance: {
    source_files: ['src/main/java/com/foo/web/OwnerController.java'],
    method_id: 'com.foo.web.OwnerController#create(OwnerDto)',
  },
  confidence: 0.81,
};

describe('candidateSaveBackService - endpoints request_contract pass-through', () => {
  it('rides a pre-assembled data.request_contract block through onto entity.request_contract verbatim (snake_case)', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'POST',
        path: '/owners',
        request_contract: REQUEST_CONTRACT,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/owners');
    // The whole block rides through verbatim onto the JSONB column.
    expect(entity.request_contract).toEqual(REQUEST_CONTRACT);
    expect(entity.request_contract.confidence).toBe(0.81);
    expect(entity.request_contract.schema_version).toBe('request_contract.v1');
  });

  it('accepts the camelCase alias data.requestContract identically (snake/camel-tolerant)', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'POST',
        path: '/owners',
        requestContract: REQUEST_CONTRACT,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.request_contract).toEqual(REQUEST_CONTRACT);
    expect(entity.request_contract.content_type).toBe('application/json');
  });

  it('assembles request_contract from the loose adapter facts (consumes/headers/requestParams) when no block is present', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'POST',
        path: '/owners',
        // The Phase-1 facts the springClassic adapter writes onto `data`.
        consumes: ['application/json'],
        headers: ['X-Api-Version'],
        requestHeaders: [
          { name: 'X-Tenant', type: 'String', required: true },
          { name: 'X-Trace', type: 'String', required: false },
        ],
        requestParams: [{ name: 'force', type: 'boolean', required: false }],
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // content_type derives from the first `consumes` media type; consumes[] kept.
    expect(entity.request_contract.content_type).toBe('application/json');
    expect(entity.request_contract.consumes).toEqual(['application/json']);
    // required_headers carries the mapping `headers` discriminator (always
    // required) plus the required @RequestHeader, and EXCLUDES the optional one.
    expect(entity.request_contract.required_headers).toEqual([
      { name: 'X-Api-Version', source: 'mapping-header' },
      { name: 'X-Tenant', source: '@RequestHeader' },
    ]);
    // params carries the captured @RequestParam inputs verbatim.
    expect(entity.request_contract.params).toEqual([
      { name: 'force', type: 'boolean', required: false },
    ]);
  });

  it('leaves entity.request_contract UNSET when the endpoint carries no request facts (additive + nullable round-trip)', () => {
    const candidate = makeEndpointCandidate({
      data: { http_method: 'GET', path: '/owners/{id}' },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('GET');
    expect(entity.path_or_address).toBe('/owners/{id}');
    // Absent key (not null / not undefined-overwrite) — endpoints with no
    // request facts round-trip cleanly, mirroring the response_contract arm.
    expect('request_contract' in entity).toBe(false);
  });

  it('still passes response_contract through alongside the new request_contract arm (no regression)', () => {
    const RESPONSE_CONTRACT = {
      schema_version: 'response_contract.v1',
      status_codes: { success: 201, location_header: true },
      confidence: 0.9,
    };
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'POST',
        path: '/owners',
        response_contract: RESPONSE_CONTRACT,
        request_contract: REQUEST_CONTRACT,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // Both siblings ride through, independently and verbatim.
    expect(entity.response_contract).toEqual(RESPONSE_CONTRACT);
    expect(entity.request_contract).toEqual(REQUEST_CONTRACT);
  });
});

describe('response_contract from static annotation facts (2026-09-03, Kiro review BEHAV-01)', () => {
  // JAX-RS resources declare their media types (@Produces) and return type
  // statically; pre-fix `produces` rode only inside the endpoint's display
  // name and the return type was dropped at save-back, so a JAX-RS estate
  // committed ZERO response contracts while @Consumes DID land.
  it('assembles response_contract from produces + returnType when no scanner block exists', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'GET',
        path: '/orders/{id}',
        produces: ['application/json', 'application/xml'],
        returnType: 'com.app.OrderResponse',
      },
    });
    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);
    expect(entity.response_contract).toEqual({
      schema_version: 'response_contract.static.v1',
      source: 'static_annotations',
      produces: ['application/json', 'application/xml'],
      content_type: 'application/json',
      return_type: 'com.app.OrderResponse',
    });
  });

  it('keeps a scanner-built block and only ENRICHES it with produces / return_type when absent', () => {
    const scanned = { schema_version: 'response_contract.v1', error_responses: [], confidence: 0.9 };
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'GET',
        path: '/orders/{id}',
        response_contract: scanned,
        produces: ['application/json'],
        unwrappedReturnType: 'OrderResponse',
      },
    });
    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);
    expect(entity.response_contract).toMatchObject(scanned);
    expect(entity.response_contract.produces).toEqual(['application/json']);
    expect(entity.response_contract.content_type).toBe('application/json');
    expect(entity.response_contract.return_type).toBe('OrderResponse');
  });

  it('leaves response_contract unset when there are no facts (void return, no produces)', () => {
    const candidate = makeEndpointCandidate({
      data: { http_method: 'DELETE', path: '/orders/{id}', returnType: 'void' },
    });
    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);
    expect(entity.response_contract).toBeUndefined();
  });
});
