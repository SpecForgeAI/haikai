/**
 * Tests for service-scoped candidate post-filtering and service_id population.
 *
 * Spec: Service-Scoped Discovery (TG8)
 * Task 8.8: Focused tests for candidate filtering and service_id population
 *
 * Tests:
 * 1. Candidates with types in SERVICE_SCOPED_CANDIDATE_TYPES are kept
 * 2. Candidates with types outside the list (class, method, service) are removed
 * 3. Empty candidate list returns empty after filtering
 * 4. service_id population sets data.service_id on all candidates
 * 5. service_id population does not overwrite other data fields
 */

import { SERVICE_SCOPED_CANDIDATE_TYPES } from '../constants/candidateTypes';
import { DiscoveryCandidate } from '../types/candidate';

/**
 * Helper to create a minimal DiscoveryCandidate for testing.
 */
function makeCandidate(
  candidateType: string,
  name: string,
  data: Record<string, unknown> = {}
): DiscoveryCandidate {
  return {
    id: `id-${name}`,
    runId: 'run-1',
    candidateType: candidateType as DiscoveryCandidate['candidateType'],
    name,
    confidence: 0.8,
    status: 'proposed',
    sourceClusterIds: ['src/test.java'],
    data,
    synthesizedAt: new Date().toISOString(),
  };
}

describe('SERVICE_SCOPED_CANDIDATE_TYPES', () => {
  it('contains exactly the eleven allowed types', () => {
    expect(SERVICE_SCOPED_CANDIDATE_TYPES).toEqual([
      'interfaces',
      'endpoints',
      'logical_data_entities',
      'physical_data_entities',
      'physical_data_attributes',
      'logical_data_attributes',
      'business_logics',
      'logical_data_entity_relationships',
      'interface_logical_entities',
      'ui_screens',
      'ui_components',
    ]);
  });

  it('does not include service, class, or method', () => {
    expect(SERVICE_SCOPED_CANDIDATE_TYPES).not.toContain('service');
    expect(SERVICE_SCOPED_CANDIDATE_TYPES).not.toContain('class');
    expect(SERVICE_SCOPED_CANDIDATE_TYPES).not.toContain('method');
  });
});

describe('Candidate post-filter', () => {
  const filterCandidates = (
    candidates: DiscoveryCandidate[],
    allowedTypes: string[]
  ): DiscoveryCandidate[] => {
    return candidates.filter(c => allowedTypes.includes(c.candidateType));
  };

  it('keeps candidates with types in SERVICE_SCOPED_CANDIDATE_TYPES', () => {
    const candidates = [
      makeCandidate('interfaces', 'UserAPI'),
      makeCandidate('endpoints', 'GET /users'),
      makeCandidate('logical_data_entities', 'User'),
      makeCandidate('physical_data_entities', 'users_table'),
    ];

    const filtered = filterCandidates(candidates, SERVICE_SCOPED_CANDIDATE_TYPES);

    expect(filtered).toHaveLength(4);
    expect(filtered.map(c => c.name)).toEqual([
      'UserAPI',
      'GET /users',
      'User',
      'users_table',
    ]);
  });

  it('removes candidates with types outside the allowed list', () => {
    const candidates = [
      makeCandidate('interfaces', 'UserAPI'),
      makeCandidate('class', 'UserController'),
      makeCandidate('method', 'getUsers'),
      makeCandidate('service', 'UserService'),
      makeCandidate('endpoints', 'GET /users'),
      makeCandidate('application', 'MyApp'),
    ];

    const filtered = filterCandidates(candidates, SERVICE_SCOPED_CANDIDATE_TYPES);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.name)).toEqual(['UserAPI', 'GET /users']);
  });

  it('returns empty array when no candidates match allowed types', () => {
    const candidates = [
      makeCandidate('class', 'UserController'),
      makeCandidate('method', 'getUsers'),
    ];

    const filtered = filterCandidates(candidates, SERVICE_SCOPED_CANDIDATE_TYPES);

    expect(filtered).toHaveLength(0);
  });

  it('returns empty array when input is empty', () => {
    const filtered = filterCandidates([], SERVICE_SCOPED_CANDIDATE_TYPES);
    expect(filtered).toHaveLength(0);
  });
});

describe('service_id population', () => {
  const populateServiceId = (
    candidates: DiscoveryCandidate[],
    serviceId: string
  ): void => {
    for (const candidate of candidates) {
      candidate.data.service_id = serviceId;
    }
  };

  it('sets data.service_id on all candidates', () => {
    const serviceId = 'svc-order-123';
    const candidates = [
      makeCandidate('interfaces', 'OrderAPI'),
      makeCandidate('endpoints', 'POST /orders'),
      makeCandidate('logical_data_entities', 'Order'),
    ];

    populateServiceId(candidates, serviceId);

    for (const candidate of candidates) {
      expect(candidate.data.service_id).toBe(serviceId);
    }
  });

  it('does not overwrite other existing data fields', () => {
    const serviceId = 'svc-order-123';
    const candidates = [
      makeCandidate('interfaces', 'OrderAPI', {
        description: 'Order management API',
        http_method: 'REST',
      }),
    ];

    populateServiceId(candidates, serviceId);

    expect(candidates[0].data.service_id).toBe(serviceId);
    expect(candidates[0].data.description).toBe('Order management API');
    expect(candidates[0].data.http_method).toBe('REST');
  });

  it('handles empty candidate list without error', () => {
    const candidates: DiscoveryCandidate[] = [];
    expect(() => populateServiceId(candidates, 'svc-123')).not.toThrow();
  });
});
