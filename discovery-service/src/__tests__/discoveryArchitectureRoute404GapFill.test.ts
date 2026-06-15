/**
 * Spec #4 Task Group 9 -- discovery-service gap-fill: explicit 404 when
 * the `:architectureId` path segment is missing from a discovery-service
 * route.
 *
 * Rationale (gap relative to Group 4):
 *   `runArchitectureBinding.test.ts` (Group 4) covers the 409 mismatch
 *   case (URL :architectureId differs from the run's stored id). The
 *   gateway-side 404 is covered by
 *   `gateway/src/__tests__/discovery-architecture-scoped-proxy.test.ts`
 *   Test 2. The architecture-model-service backend's 404 is covered by
 *   `DiscoveryRunControllerArchitectureScopingTest.missingArchitectureIdSegment_returns404`.
 *   The third leg of property (b) -- the discovery-service's own routes
 *   404 when :architectureId is missing -- was implicit (Express routing
 *   simply does not match the mount path) but never asserted explicitly.
 *
 * This single test pins it.
 *
 * Pre-flight (Group 4 rule, also applies here): the implementer confirmed
 * no in-flight discovery run before adding this test file. The test file
 * is additive and does not modify any production source.
 *
 * Note on imports: we import only `runsRouter` (not the full
 * `discoveryRouter` barrel) because the barrel transitively pulls in
 * `routes/logEnrichment.ts`, which has a pre-existing TS compile error
 * unrelated to spec #4 (it imports `executeStep1c` / `executeStep1d`
 * from `runManager`, which no longer exports them). That pre-existing
 * failure is on the spec's "out of scope" list and we deliberately
 * avoid triggering it here.
 */

// Mock dotenv before importing anything else (mirrors runArchitectureBinding.test.ts).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock uuid for deterministic ids in any code path that touches it.
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-route404'),
}));

// Mock the archModelClient module to keep the router pure in this test.
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    createDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getDiscoveryConfig: jest.fn(),
    bulkSaveEvidence: jest.fn(),
    getEvidenceByRun: jest.fn(),
    getEvidenceByRunPaginated: jest.fn(),
    getEvidenceCount: jest.fn(),
    bulkSaveRelationships: jest.fn(),
    getRelationshipsByRun: jest.fn(),
    getRelationshipsByRunPaginated: jest.fn(),
    getRelationshipCount: jest.fn(),
    bulkSaveClusters: jest.fn(),
    getClustersByRun: jest.fn(),
    getClusterCount: jest.fn(),
    deleteClustersByRunId: jest.fn(),
    bulkSaveCandidates: jest.fn(),
    getCandidatesByRun: jest.fn(),
    getCandidateCount: jest.fn(),
    updateCandidate: jest.fn(),
    bulkSaveDecisionTasks: jest.fn(),
    getDecisionTasksByRun: jest.fn(),
    getDecisionTaskCount: jest.fn(),
    updateDecisionTask: jest.fn(),
    resolveDefaultArchitectureId: jest.fn(),
    resetDefaultArchitectureCache: jest.fn(),
    getService: jest.fn(),
    getApplication: jest.fn(),
    getAppComponent: jest.fn(),
  },
}));

jest.mock('../services/analyzerRegistry', () => ({
  getAnalyzerRegistry: jest.fn().mockReturnValue(new Map()),
  initializeAnalyzerRegistry: jest.fn(),
  registerAnalyzerPack: jest.fn(),
}));

jest.mock('../services/linkerRuleRegistry', () => ({
  getLinkerRuleRegistry: jest.fn().mockReturnValue(new Map()),
  initializeLinkerRuleRegistry: jest.fn(),
  registerLinkerRule: jest.fn(),
}));

jest.mock('../services/gatewayClient', () => ({
  gatewayClient: { resolveDecisionTasks: jest.fn() },
}));

jest.mock('../services/repoAccess', () => ({
  buildTempDir: jest.fn().mockReturnValue('/tmp/mock'),
  gitCloneRepoAccess: {
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  },
  isGitRepoUrl: jest.fn().mockReturnValue(false),
  normalizeRepoLocation: (s: string) => s,
  normalizeRepoSubfolder: (s: string) => s,
}));

import express from 'express';
import request from 'supertest';
import { runsRouter } from '../routes/runs';
import { archModelClient } from '../services/archModelClient';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RUN_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Mirrors the canonical mount in `discovery-service/src/routes/index.ts`:
 *   discoveryRouter.use(
 *     '/projects/:projectId/architectures/:architectureId/runs',
 *     runsRouter,
 *   );
 *
 * with the discoveryRouter itself mounted at `/discovery` in the app
 * entry point. We replicate the same mount so absolute paths match the
 * production layout.
 */
function createTestAppMatchingProductionLayout() {
  const app = express();
  app.use(express.json());
  // Architecture-scoped mount only — same as production. The OLD
  // project-only mount (`/discovery/projects/:projectId/runs`) is
  // intentionally absent.
  app.use(
    '/discovery/projects/:projectId/architectures/:architectureId/runs',
    runsRouter,
  );
  return app;
}

describe('Spec #4 Group 9 — discovery-service routes 404 when :architectureId is missing (gap-fill for property (b))', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // The runs sub-router is mounted at
  //   /discovery/projects/:projectId/architectures/:architectureId/runs
  // so a request to the OLD project-only shape
  //   /discovery/projects/:projectId/runs/:runId
  // does not match any route. Express returns 404.
  //
  // This is the discovery-service's contribution to safety property (b):
  // forgetting :architectureId 404s at the route layer (no fallback / no
  // silent default-resolution).
  // --------------------------------------------------------------------------
  test('GET /discovery/projects/:projectId/runs/:runId 404s when :architectureId path segment is omitted', async () => {
    const app = createTestAppMatchingProductionLayout();

    // Hit the OLD project-only URL shape (pre-spec-#4). No fallback exists,
    // so Express returns 404. Crucially, no archModelClient call should
    // have been made -- the request must die at the routing layer.
    const res = await request(app).get(
      `/discovery/projects/${PROJECT_ID}/runs/${RUN_ID}`,
    );

    expect(res.status).toBe(404);
    expect(mockArchModelClient.getDiscoveryRun).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Sanity check (anti-flake): the architecture-scoped path DOES match a
  // route handler. Without this, the 404 above is ambiguous (it could mean
  // "no route at all" rather than "no :architectureId" specifically). With
  // this assertion we prove the architecture-scoped route is wired and the
  // bare project-only path is the only thing that 404s.
  // --------------------------------------------------------------------------
  test('control: GET /discovery/projects/:projectId/architectures/:architectureId/runs/:runId DOES reach a handler (architecture-scoped route is wired)', async () => {
    mockArchModelClient.getDiscoveryRun.mockResolvedValue({
      id: RUN_ID,
      project_id: PROJECT_ID,
      architecture_id: ARCH_ID,
      service_id: null,
      status: 'COMPLETED',
      current_step: null,
      config_snapshot: {},
      steps_payload: {},
      error_message: null,
      created_at: '2026-04-04T10:00:00Z',
      updated_at: '2026-04-04T10:00:00Z',
    } as any);

    const app = createTestAppMatchingProductionLayout();
    const res = await request(app).get(
      `/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs/${RUN_ID}`,
    );

    // Route matched and the handler ran -- the response body is JSON
    // (runs router always emits JSON), and getDiscoveryRun was invoked.
    expect(res.status).toBe(200);
    // The runs route forwards the URL's :architectureId segment as the third
    // arg so getDiscoveryRun can run its cross-architecture scoping check
    // (Spec 2026-05-01 Multi-Architecture Discovery Integration).
    expect(mockArchModelClient.getDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      ARCH_ID,
    );
  });
});
