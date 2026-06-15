/**
 * Tests for the response-contract save-back mapping (Spec 2026-05-30
 * Per-endpoint response-contract capture, Task Group 3).
 *
 * On save-approved, `convertCandidateToEntity` for an `endpoints` candidate
 * must map the structured response-contract block on
 * `candidate.data.response_contract` (snake_case, matching the host
 * `EndpointDto`) onto the AMS `endpoints.response_contract` JSONB column
 * (added in Task Group 1). The pass-through is snake/camel-tolerant (accepts
 * `responseContract` too) and additive + nullable: when no block is present
 * the column is left UNSET (absent key) so endpoints with no contract
 * round-trip cleanly — the block is optional enrichment, not a required field.
 */

// Mock dotenv before importing anything else
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
    name: 'getOwner',
    confidence: 0.72,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/web/OwnerController.java'],
    data: {
      http_method: 'GET',
      path: '/owners/{id}',
    },
    synthesized_at: '2026-05-30T10:00:00Z',
    parent_candidate_id: 'cand-ifc-1',
    ...overrides,
  };
}

// Parent FK map — the endpoint candidate resolves its `interface_id` parent FK
// to a synthetic interface entity ID via the parent-candidate map (mirrors the
// SOAP endpoint save-back tests).
const PARENT_MAP: Record<string, string> = {
  'cand-ifc-1': 'ifc-1',
};

const RESPONSE_CONTRACT = {
  schema_version: 'response_contract.v1',
  error_responses: [
    {
      exception: 'com.foo.OwnerNotFoundException',
      status: 404,
      body_shape: '{ "message": "..." }',
      source: '@ControllerAdvice com.foo.web.ApiAdvice#handleNotFound',
    },
  ],
  auth: {
    required_roles: ['ROLE_USER'],
    expected_unauthenticated_status: 401,
    expected_forbidden_status: 403,
    source: '@PreAuthorize',
  },
  validation: [
    {
      field: 'id',
      constraint: '@Min(1)',
      failure_status: 400,
      message: 'id must be positive',
    },
  ],
  serialization: {
    null_handling: 'NON_NULL omits nulls',
    date_format: 'iso-8601',
    field_naming: 'as-declared',
    envelope: 'bare object',
    headers: [],
  },
  status_codes: { success: 200, location_header: false },
  conditional_variants: [],
  provenance: {
    source_files: ['src/main/java/com/foo/web/OwnerController.java'],
    method_id: 'com.foo.web.OwnerController#getOwner(long)',
    advice_ids: ['com.foo.web.ApiAdvice#handleNotFound'],
  },
  confidence: 0.72,
};

describe('candidateSaveBackService - endpoints response_contract mapping', () => {
  it('maps data.response_contract onto entity.response_contract verbatim (snake_case)', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'GET',
        path: '/owners/{id}',
        response_contract: RESPONSE_CONTRACT,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('GET');
    expect(entity.path_or_address).toBe('/owners/{id}');
    // The whole block rides through verbatim onto the JSONB column.
    expect(entity.response_contract).toEqual(RESPONSE_CONTRACT);
    // Embedded confidence preserved as a number (boxed Double on the AMS side).
    expect(entity.response_contract.confidence).toBe(0.72);
    expect(entity.response_contract.schema_version).toBe('response_contract.v1');
    expect(Array.isArray(entity.response_contract.error_responses)).toBe(true);
  });

  it('accepts the camelCase alias data.responseContract identically (snake/camel-tolerant)', () => {
    const candidate = makeEndpointCandidate({
      data: {
        http_method: 'GET',
        path: '/owners/{id}',
        responseContract: RESPONSE_CONTRACT,
      },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // Stored identically whether the wire key was snake_case or camelCase.
    expect(entity.response_contract).toEqual(RESPONSE_CONTRACT);
    expect(entity.response_contract.auth.required_roles).toEqual(['ROLE_USER']);
  });

  it('leaves entity.response_contract UNSET when the endpoint carries no contract (additive + nullable round-trip)', () => {
    const candidate = makeEndpointCandidate({
      data: { http_method: 'GET', path: '/owners/{id}' },
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('GET');
    expect(entity.path_or_address).toBe('/owners/{id}');
    // Absent key (not null / not undefined-overwrite) — endpoints with no
    // contract round-trip cleanly, mirroring the optional-enrichment contract.
    expect('response_contract' in entity).toBe(false);
  });
});
