/**
 * Gap-fill tests for the discovery-service architecture-scoped entity-fetch
 * end-to-end flow.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing -- Task 6.4.
 *
 * Existing Group 5 tests (`archModelClientArchitectureScoped.test.ts`) cover
 * the URL shape of the three entity-fetch helpers in isolation and the per-run
 * cache behaviour of `resolveDefaultArchitectureId`. They do not cover the
 * end-to-end wiring where a discovery caller (e.g. runManager.ts) FIRST calls
 * `resolveDefaultArchitectureId(projectId)` and then immediately threads the
 * resolved id into one of the entity-fetch helpers. This file fills that gap
 * with two integration-style tests:
 *
 *   1. `resolveDefaultArchitectureId(projectId)` -> `getService(projectId,
 *      <resolved>, serviceId)` chains: the service URL contains the resolved
 *      architecture id, NOT a hardcoded default. Proves the threading.
 *
 *   2. With cache primed, multiple entity-fetch calls share a single
 *      list-architectures HTTP request. Proves the resolver-cache integrates
 *      with the entity-fetch flow as designed.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios so axios.create returns our spy-able instance
jest.mock('axios');

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCH_ID_DEFAULT = '11111111-1111-1111-1111-111111111111';

describe('archModelClient -- resolver chain end-to-end (Task 6.4)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: resolveDefaultArchitectureId then getService end-to-end
  // ==========================================================================
  it('resolveDefaultArchitectureId(projectId) -> getService threads the resolved id into the entity URL', async () => {
    const serviceId = 'svc-uuid-007';
    const listResponse = [
      {
        id: ARCH_ID_DEFAULT,
        project_id: PROJECT_ID,
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        created_at: '2024-06-01T00:00:00Z',
        updated_at: '2024-06-01T00:00:00Z',
      },
    ];
    const serviceResponse = { id: serviceId, name: 'orders-service' };

    const axios = require('axios');
    const mockGet = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/architectures')) {
        return Promise.resolve({ data: listResponse });
      }
      if (url.includes('/entities/services/')) {
        return Promise.resolve({ data: serviceResponse });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    const mockInterceptors = { response: { use: jest.fn() } };
    axios.create = jest.fn().mockReturnValue({
      get: mockGet,
      interceptors: mockInterceptors,
    });

    const { archModelClient } = require('../services/archModelClient');

    // The end-to-end pattern used by callers (runManager / performancePostRun /
    // routes/runs.ts): resolve first, then thread the result through.
    const architectureId = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);
    const result = await archModelClient.getService(PROJECT_ID, architectureId, serviceId);

    expect(architectureId).toBe(ARCH_ID_DEFAULT);
    expect(result).toEqual(serviceResponse);

    // Two upstream calls: list-architectures, then the entity fetch.
    expect(mockGet).toHaveBeenCalledTimes(2);

    // The entity-fetch URL must embed the resolved architecture id verbatim.
    // No hardcoded default, no bypass, no silent fallback.
    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${encodeURIComponent(PROJECT_ID)}/architectures`
    );
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID_DEFAULT)}/entities/services/${encodeURIComponent(serviceId)}`
    );
  });

  // ==========================================================================
  // Test 2: cache primed across multiple entity-fetch calls
  // ==========================================================================
  it('multiple entity-fetch calls in the same run share one list-architectures HTTP request (cache wiring)', async () => {
    const serviceId = 'svc-uuid-100';
    const appId = 'app-uuid-100';
    const compId = 'comp-uuid-100';
    const listResponse = [
      {
        id: ARCH_ID_DEFAULT,
        project_id: PROJECT_ID,
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        created_at: '2024-06-01T00:00:00Z',
        updated_at: '2024-06-01T00:00:00Z',
      },
    ];

    const axios = require('axios');
    const mockGet = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/architectures')) {
        return Promise.resolve({ data: listResponse });
      }
      // All three entity calls return a minimal-but-distinct payload.
      return Promise.resolve({ data: { id: 'some-id' } });
    });
    const mockInterceptors = { response: { use: jest.fn() } };
    axios.create = jest.fn().mockReturnValue({
      get: mockGet,
      interceptors: mockInterceptors,
    });

    const { archModelClient } = require('../services/archModelClient');

    // Resolve once (primes cache), then fetch one of each entity type. The
    // resolver MUST NOT issue a second list-architectures call for the
    // remaining two fetches.
    const arch1 = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);
    await archModelClient.getService(PROJECT_ID, arch1, serviceId);

    const arch2 = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);
    await archModelClient.getApplication(PROJECT_ID, arch2, appId);

    const arch3 = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);
    await archModelClient.getAppComponent(PROJECT_ID, arch3, compId);

    expect(arch1).toBe(ARCH_ID_DEFAULT);
    expect(arch2).toBe(ARCH_ID_DEFAULT);
    expect(arch3).toBe(ARCH_ID_DEFAULT);

    // Total HTTP calls = 1 (list) + 3 (entity fetches) = 4. NOT 6.
    expect(mockGet).toHaveBeenCalledTimes(4);

    // Exactly one of those was the list-architectures call.
    const listCalls = mockGet.mock.calls.filter((c) =>
      (c[0] as string).endsWith('/architectures')
    );
    expect(listCalls).toHaveLength(1);
  });
});
