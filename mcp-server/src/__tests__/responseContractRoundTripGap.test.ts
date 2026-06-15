/**
 * Spec 2026-05-30 Per-endpoint response-contract capture — Task Group 5
 * (cross-layer gap fill). Strategic end-to-end-style assertions for the two
 * highest-risk invariants of the `response_contract` JSONB block as it passes
 * through the MCP save-back boundary (the one layer runnable in isolation):
 *
 *   1. The embedded `confidence` is a BOXED Double inside the blob: a contract
 *      that carries `confidence: null` must round-trip with null PRESERVED — it
 *      must NEVER be coerced to 0.0 (memory project_primitive_double_dto_overwrite).
 *   2. The blob is loose JSONB with its own internal `schema_version`: an
 *      unknown future shape (v2 + extra keys) must pass through verbatim
 *      (forward-compat — the shape can evolve with no further migration).
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

import { DiscoveryCandidateDto } from '../services/archModelClient';
import { convertCandidateToEntity } from '../services/candidateSaveBackService';

const PARENT_MAP: Record<string, string> = { 'cand-ifc-1': 'ifc-1' };

function endpointCandidate(data: Record<string, unknown>): DiscoveryCandidateDto {
  return {
    id: 'cand-ep-5',
    run_id: 'run-005',
    candidate_type: 'endpoints',
    name: 'getOwner',
    confidence: 0.72,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/com/foo/web/OwnerController.java'],
    data: { http_method: 'GET', path: '/owners/{id}', ...data },
    synthesized_at: '2026-05-30T10:00:00Z',
    parent_candidate_id: 'cand-ifc-1',
  };
}

describe('response_contract round-trip — Task Group 5 gap fill', () => {
  it('preserves a null embedded confidence (boxed Double — never coerced to 0.0)', () => {
    const contract = {
      schema_version: 'response_contract.v1',
      status_codes: { success: 200, location_header: false },
      confidence: null,
    };
    const entity = convertCandidateToEntity(
      endpointCandidate({ response_contract: contract }),
      'TestProject',
      PARENT_MAP,
    );
    // null stays null — not 0, not undefined-stripped.
    expect(entity.response_contract.confidence).toBeNull();
    expect(entity.response_contract.confidence).not.toBe(0);
    expect('confidence' in entity.response_contract).toBe(true);
  });

  it('passes an unknown future shape (schema_version v2 + extra keys) through verbatim (loose-JSONB forward compat)', () => {
    const futureContract = {
      schema_version: 'response_contract.v2',
      error_responses: [],
      auth: { required_roles: [], source: 'unresolved' },
      a_brand_new_section: { some: 'future field', nested: [1, 2, 3] },
      confidence: 0.5,
    };
    const entity = convertCandidateToEntity(
      endpointCandidate({ responseContract: futureContract }),
      'TestProject',
      PARENT_MAP,
    );
    // Whole blob (including the unknown section) rides through untouched.
    expect(entity.response_contract).toEqual(futureContract);
    expect(entity.response_contract.schema_version).toBe('response_contract.v2');
    expect(entity.response_contract.a_brand_new_section.nested).toEqual([1, 2, 3]);
  });
});
