/**
 * Tests for the endpoint verb/path save-back fallbacks (Spec
 * 2026-06-02 Unique, Aggregate Discovery Candidates -- Task Group 6,
 * root cause #2).
 *
 * The JAX-RS inbound-surface detectors write the endpoint's HTTP verb and
 * path onto `data.httpMethod` / `data.fullPath` (camelCase), whereas the
 * WADL pack writes `data.operation_verb` / `data.path_or_address` and the
 * legacy MCP shape uses `data.http_method` / `data.path`. Before this fix
 * the endpoint save-back read only the snake_case shapes, so an un-merged
 * JAX-RS endpoint persisted with an EMPTY verb/path.
 *
 * The fix adds `data.httpMethod` / `data.fullPath` as ADDITIONAL fallbacks,
 * mirroring the file's existing snake/camel dual-tolerant idiom (e.g.
 * `response_contract` / `responseContract`). Precedence is preserved so
 * already-normalized values (the merge engine writes `operation_verb` /
 * `path_or_address`) still win -- the camelCase JAX-RS aliases only fill the
 * gap on the un-merged path.
 */

// Mock dotenv before importing anything else (mirrors the sibling
// response-contract / SOAP endpoint save-back suites).
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import { convertCandidateToEntity } from '../services/candidateSaveBackService';

function makeEndpointCandidate(
  data: Record<string, unknown>,
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return {
    id: 'cand-ep-1',
    run_id: 'run-001',
    candidate_type: 'endpoints',
    name: 'GET /owners/{id}',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/web/OwnerController.java'],
    data,
    synthesized_at: '2026-06-02T10:00:00Z',
    parent_candidate_id: 'cand-ifc-1',
    ...overrides,
  };
}

// Parent FK map — the endpoint resolves its `interface_id` parent FK to a
// synthetic interface entity ID (mirrors the response-contract save-back test).
const PARENT_MAP: Record<string, string> = {
  'cand-ifc-1': 'ifc-1',
};

describe('candidateSaveBackService - endpoint verb/path camelCase fallbacks', () => {
  it('persists a JAX-RS endpoint carrying ONLY data.httpMethod / data.fullPath with populated verb/path', () => {
    // The exact shape the Spring-Classic JAX-RS inbound detectors emit on an
    // un-merged path: camelCase verb/path, no snake_case canonical slots.
    const candidate = makeEndpointCandidate({
      httpMethod: 'POST',
      fullPath: '/owners/{ownerId}/pets',
      controllerClassName: 'com.foo.web.OwnerController',
      methodName: 'addPet',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    // Before the fix these were null because neither httpMethod nor fullPath
    // was read -- the regression this task closes.
    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/owners/{ownerId}/pets');
  });

  it('round-trips a merged endpoint normalized to operation_verb / path_or_address unchanged (snake_case canonical slots still win)', () => {
    // The merge engine normalizes to the canonical save-back names. Even if a
    // stale camelCase alias rides alongside, the normalized snake_case slot
    // must win (existing precedence preserved).
    const candidate = makeEndpointCandidate({
      operation_verb: 'GET',
      path_or_address: '/owners/{id}',
      // Stale pre-normalization aliases that must NOT override the canonical slots.
      httpMethod: 'POST',
      fullPath: '/STALE/path',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('GET');
    expect(entity.path_or_address).toBe('/owners/{id}');
  });

  it('keeps the legacy data.http_method / data.path snake_case shape winning over the camelCase aliases', () => {
    // Belt-and-braces precedence guard: the legacy MCP snake_case keys retain
    // their leading position ahead of the new camelCase fallbacks.
    const candidate = makeEndpointCandidate({
      http_method: 'PUT',
      path: '/owners/{id}',
      httpMethod: 'DELETE',
      fullPath: '/STALE/path',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('PUT');
    expect(entity.path_or_address).toBe('/owners/{id}');
  });

  it('falls back to null when no verb/path field is present in any shape', () => {
    const candidate = makeEndpointCandidate({
      controllerClassName: 'com.foo.web.OwnerController',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBeNull();
    expect(entity.path_or_address).toBeNull();
  });

  it('reads the web.xml handler-detector shape: plain data.method fills the verb (2026-09-01)', () => {
    // The exact candidate shape the webxml-handler detector emits: the verb
    // arrives as plain `method`, which no other slot covered — so every
    // web.xml-mapped servlet committed with operation_verb = NULL while
    // path_or_address populated fine from `data.path`.
    const candidate = makeEndpointCandidate({
      path: '/refreshCache',
      method: 'POST',
      _addedBy: 'webxml-handler-detector',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('POST');
    expect(entity.path_or_address).toBe('/refreshCache');
  });

  it('data.method sits LAST in precedence — every existing shape still wins over it', () => {
    const candidate = makeEndpointCandidate({
      httpMethod: 'PUT',
      method: 'DELETE', // must NOT override the camelCase JAX-RS alias
      path: '/owners/{id}',
    });

    const entity = convertCandidateToEntity(candidate, 'TestProject', PARENT_MAP);

    expect(entity.operation_verb).toBe('PUT');
  });
});
