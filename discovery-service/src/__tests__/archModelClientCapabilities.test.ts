/**
 * Cross-stack wire-contract tests for the discovery-service archModelClient
 * Discovery Capability method (D2, Task Group 4).
 *
 * Pins the wire shape of `archModelClient.bulkCreateDiscoveryCapabilities`:
 * URL construction (architecture-scoped, `.../runs/{runId}/capabilities/bulk`),
 * the `{ capabilities: [...] }` wrapper, camelCase -> snake_case body mapping
 * (`detail_json` / `created_by_stage` / member `member_type` / `member_id`), the
 * snake_case -> camelCase response round-trip, and the empty-input no-op (D9).
 *
 * Mirrors `archModelClientFindings.test.ts` (axios + runArchitectureRegistry
 * mocked; no live AMS).
 */

// Mock dotenv before importing anything else (mirrors archModelClient.test.ts).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('axios');

const CAPTEST_ARCH_ID = 'arch-uuid-001';
const CAPTEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CAPTEST_RUN_ID = 'run-uuid-001';
const CAPTEST_CAP_ID = 'cap-uuid-001';

// Mock runArchitectureRegistry so _resolveArchitectureForRun returns CAPTEST_ARCH_ID.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => CAPTEST_ARCH_ID),
}));

interface AxiosLikeInstance {
  post: jest.Mock;
  patch: jest.Mock;
  get: jest.Mock;
  delete: jest.Mock;
  interceptors: { response: { use: jest.Mock } };
}

function setupAxiosMock(): AxiosLikeInstance {
  const mockAxiosInstance: AxiosLikeInstance = {
    post: jest.fn(),
    patch: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    interceptors: { response: { use: jest.fn() } },
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axios = require('axios');
  axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

  jest.mock('../services/runArchitectureRegistry', () => ({
    ...jest.requireActual('../services/runArchitectureRegistry'),
    getRunArchitectureId: jest.fn(() => CAPTEST_ARCH_ID),
  }));

  return mockAxiosInstance;
}

const bulkUrl =
  `/api/model/projects/${encodeURIComponent(CAPTEST_PROJECT_ID)}` +
  `/architectures/${encodeURIComponent(CAPTEST_ARCH_ID)}` +
  `/discovery/runs/${encodeURIComponent(CAPTEST_RUN_ID)}/capabilities/bulk`;

function backendCapabilityDto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAPTEST_CAP_ID,
    run_id: CAPTEST_RUN_ID,
    project_id: CAPTEST_PROJECT_ID,
    architecture_id: CAPTEST_ARCH_ID,
    name: 'Daily Risk Hierarchy Load Pipeline',
    kind: 'batch_pipeline',
    summary: 'A nightly batch pipeline.',
    review_status: 'pending_review',
    previous_review_status: null,
    confidence: 0.85,
    detail_json: { seedMode: 'jil_dag' },
    source: 'capability_synthesis',
    created_by_stage: 'discoveryV3Pipeline.capabilitySynthesis',
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    members: [
      {
        id: 'member-1',
        capability_id: CAPTEST_CAP_ID,
        member_type: 'discovery_candidate',
        member_id: 'cand-extract',
        created_at: '2026-06-14T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

describe('archModelClient -- bulkCreateDiscoveryCapabilities (D2, Task Group 4)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('POSTs { capabilities: [...] } to the architecture-scoped bulk URL with snake_case body', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post.mockResolvedValueOnce({ data: [backendCapabilityDto()] });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    const result = await archModelClient.bulkCreateDiscoveryCapabilities(CAPTEST_PROJECT_ID, CAPTEST_RUN_ID, [
      {
        name: 'Daily Risk Hierarchy Load Pipeline',
        kind: 'batch_pipeline',
        summary: 'A nightly batch pipeline.',
        confidence: 0.85,
        detailJson: { seedMode: 'jil_dag', invocations: [] },
        source: 'capability_synthesis',
        createdByStage: 'discoveryV3Pipeline.capabilitySynthesis',
        members: [{ memberType: 'discovery_candidate', memberId: 'cand-extract' }],
      },
    ]);

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe(bulkUrl);
    // The body is the { capabilities: [...] } wrapper with snake_case keys.
    expect(body).toEqual({
      capabilities: [
        {
          name: 'Daily Risk Hierarchy Load Pipeline',
          kind: 'batch_pipeline',
          summary: 'A nightly batch pipeline.',
          confidence: 0.85,
          detail_json: { seedMode: 'jil_dag', invocations: [] },
          source: 'capability_synthesis',
          created_by_stage: 'discoveryV3Pipeline.capabilitySynthesis',
          members: [{ member_type: 'discovery_candidate', member_id: 'cand-extract' }],
        },
      ],
    });

    // Response round-trips snake_case -> camelCase, members embedded.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(CAPTEST_CAP_ID);
    expect(result[0].createdByStage).toBe('discoveryV3Pipeline.capabilitySynthesis');
    expect(result[0].members).toHaveLength(1);
    expect(result[0].members[0].memberType).toBe('discovery_candidate');
    expect(result[0].members[0].memberId).toBe('cand-extract');
    expect(result[0].confidence).toBe(0.85);
  });

  it('is a no-op for empty input -- no HTTP call, returns [] (D9 zero-signal path)', async () => {
    const mockAxiosInstance = setupAxiosMock();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    const result = await archModelClient.bulkCreateDiscoveryCapabilities(CAPTEST_PROJECT_ID, CAPTEST_RUN_ID, []);
    expect(result).toEqual([]);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });
});
