/**
 * Migration Discovery Context -- gateway tests (Task Group 2, Task 2.1).
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration.
 *
 * Test inventory (focused on the task-specified properties):
 *   1. Resolver registered at key `migration-discovery-context` and listed in
 *      the known context keys array.
 *   2. Resolver resolves the active architecture via
 *      `resolveDefaultArchitectureId(projectId)` and posts the AMS aggregation
 *      endpoint with default include flags + count limits.
 *   3. Resolver bounded prompt-ready output cites durable IDs (findingId,
 *      runId, baselineId, evidenceId, taskId) and surfaces insufficient
 *      context as explicit gap entries from the readiness assessment (no
 *      invented details).
 *   4. Resolver returns a fail-soft fallback string when AMS is unreachable
 *      (network error). It does NOT throw.
 *   5. Proxy route POST /api/v1/projects/:projectId/migration-discovery-context
 *      forwards the body verbatim to AMS and returns the response verbatim.
 *   6. Proxy route propagates AMS 404 status + body byte-for-byte (architecture
 *      / project mismatch envelope).
 *   7. Proxy route propagates AMS 400 status + body byte-for-byte (validation
 *      error envelope).
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing units under test
// ---------------------------------------------------------------------------

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import {
  MigrationDiscoveryContextResolver,
  buildMigrationDiscoveryContextPromptText,
  getKnownContextKeys,
  getContextResolverRegistry,
  initializeContextResolverRegistry,
  MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS,
} from '../services/contextResolvers';
import { _resetDefaultArchitectureCache } from '../services/architectureModelClient';
import { migrationContextRouter } from '../routes/migrationContext';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'migration-discovery-context-test';
    next();
  });
  app.use('/api/v1', migrationContextRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

function listArchitecturesResponse(architectureId: string) {
  return jsonResponse(200, [
    {
      id: architectureId,
      projectId: 'proj-test',
      name: 'Default',
      description: null,
      tags: [],
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]);
}

/**
 * Build a representative AMS migration-discovery-context response with enough
 * fields populated to exercise the prompt-text transform.
 */
function buildSampleContext(overrides: Partial<MigrationDiscoveryContext> = {}): MigrationDiscoveryContext {
  return {
    projectId: 'proj-test',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    discoveryRunIds: ['run-1', 'run-2'],
    apiBehaviourBaselineIds: ['baseline-1'],
    generatedAt: '2026-05-16T12:00:00Z',
    summary: 'Migration context aggregated from 2 runs and 1 baseline.',
    currentArchitectureSummary: {
      architectureId: 'arch-current',
      name: 'Current',
      applicationCount: 3,
      serviceCount: 7,
      interfaceCount: 4,
      dataEntityCount: 12,
      dataStoreCount: 2,
      businessUserCount: 1,
      processActivityCount: 5,
      uiScreenCount: 6,
      userJourneyCount: 2,
      hasModel: true,
    },
    targetArchitectureSummary: {
      architectureId: 'arch-target',
      name: 'Target',
      applicationCount: 4,
      serviceCount: 9,
      hasModel: true,
    },
    discoveryRunsSummary: {
      totalRuns: 2,
      completedRuns: 2,
      runs: [
        {
          runId: 'run-1',
          architectureId: 'arch-current',
          status: 'completed',
          discoveryKind: 'service-scoped',
          createdAt: '2026-05-01T00:00:00Z',
          updatedAt: '2026-05-01T01:00:00Z',
        },
      ],
    },
    findingsSummary: {
      totalFindings: 42,
      // AMS keys this by the finding `review_status` vocabulary
      // (pending_review / approved / rejected / deferred) after Spec F.
      countsByStatus: { pending_review: 5, approved: 30, rejected: 4, deferred: 3 },
      countsBySeverity: { high: 4, medium: 20, low: 18 },
      countsByCategory: { migration_risk: 10, data_quality: 8, runtime_usage: 6 },
      highSeverityUnreviewedCount: 3,
      sampleDataHintCount: 2,
    },
    highPriorityFindings: [
      {
        findingId: 'finding-aaa',
        runId: 'run-1',
        findingType: 'missing_contract_detail',
        category: 'migration_risk',
        severity: 'high',
        status: 'pending_review',
        title: 'Endpoint /users/{id} missing response schema',
        summary: 'OAS for /users/{id} omits the 200 response body schema.',
        source: 'oas-pack',
        confidence: 0.92,
      },
    ],
    findingsByCategory: { migration_risk: 10, data_quality: 8 },
    evidenceHighlights: [
      {
        evidenceId: 'ev-zzz',
        runId: 'run-1',
        type: 'log_line',
        source: 'app.log',
        filePath: '/var/log/app.log',
        linkedFindingIds: ['finding-aaa'],
      },
    ],
    candidateSummary: {
      totalCandidates: 18,
      countsByType: { service: 5, interface: 3 },
      countsByStatus: { proposed: 12, accepted: 6 },
    },
    unresolvedDecisionTasks: [
      {
        taskId: 'task-qqq',
        runId: 'run-1',
        taskType: 'attribute_classification',
        status: 'pending',
        createdAt: '2026-05-02T00:00:00Z',
      },
    ],
    runtimeUsageSummary: {
      runtimeEvidenceCount: 25,
      runtimeFindingCount: 4,
      hasRuntimeEvidence: true,
    },
    databaseDiscoverySummary: {
      databaseFindingCount: 6,
      databaseRunCount: 1,
      sampleDataHintCount: 2,
      hasDatabaseDiscovery: true,
    },
    apiBehaviourBaselineSummary: {
      totalBaselines: 1,
      activeBaselineCount: 1,
      draftBaselineCount: 0,
      baselines: [
        {
          baselineId: 'baseline-1',
          architectureId: 'arch-current',
          sessionId: 'sess-1',
          name: 'Baseline #1',
          status: 'active',
          operationCount: 15,
          acceptedCaptureCount: 14,
          createdAt: '2026-05-10T00:00:00Z',
        },
      ],
    },
    architectureMappingsSummary: {
      totalMappings: 12,
      countsBySourceType: { service: 5, dataEntity: 7 },
      countsByTargetType: { service: 5, dataEntity: 7 },
      countsByMappingType: { equivalent: 10, refactor: 2 },
    },
    readinessAssessment: {
      overallStatus: 'partial',
      apiReadiness: 'partial',
      dataReadiness: 'sufficient',
      infrastructureReadiness: 'partial',
      discoveryReadiness: 'sufficient',
      mappingReadiness: 'partial',
      baselineReadiness: 'sufficient',
      decisionReadiness: 'partial',
      gaps: ['unresolved_discovery_decisions', 'missing_current_to_target_mappings'],
    },
    contextWarnings: ['Target architecture has no UI screens defined.'],
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetDefaultArchitectureCache();
  initializeContextResolverRegistry();
});

// ---------------------------------------------------------------------------
// Test 1: registry registration + KNOWN_CONTEXT_KEYS
// ---------------------------------------------------------------------------
test('migration-discovery-context resolver is registered and listed in known keys', () => {
  const registry = getContextResolverRegistry();
  expect(registry.has('migration-discovery-context')).toBe(true);
  expect(registry.get('migration-discovery-context')).toBeInstanceOf(
    MigrationDiscoveryContextResolver
  );

  const keys = getKnownContextKeys();
  expect(keys).toContain('migration-discovery-context');
});

// ---------------------------------------------------------------------------
// Test 2: resolver resolves default architecture and posts AMS with defaults
// ---------------------------------------------------------------------------
test('resolver resolves default architecture and POSTs AMS with default body shape', async () => {
  // First fetch: listArchitectures() -> default-id lookup.
  mockFetch.mockResolvedValueOnce(listArchitecturesResponse('arch-default'));
  // Second fetch: POST migration-discovery-context.
  mockFetch.mockResolvedValueOnce(jsonResponse(200, buildSampleContext()));

  const resolver = new MigrationDiscoveryContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(typeof out).toBe('string');
  expect(out.length).toBeGreaterThan(0);

  // Two upstream calls: list architectures + POST aggregation endpoint.
  expect(mockFetch).toHaveBeenCalledTimes(2);

  const [listUrl] = mockFetch.mock.calls[0];
  expect(listUrl).toBe('http://localhost:8080/api/projects/proj-test/architectures');

  const [postUrl, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
  expect(postUrl).toBe(
    'http://localhost:8080/api/projects/proj-test/migration-discovery-context'
  );
  expect(postInit.method).toBe('POST');
  expect(typeof postInit.body).toBe('string');
  const body = JSON.parse(postInit.body as string);
  // Resolver carries the resolved default architecture into the request.
  expect(body.currentArchitectureId).toBe('arch-default');
  // No explicit include flags / limits -- service layer applies defaults.
  expect(body.maxFindings).toBeUndefined();
  expect(body.maxEvidenceItems).toBeUndefined();
  expect(body.includeFindings).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Test 3: bounded prompt text cites durable IDs + surfaces explicit gaps
// ---------------------------------------------------------------------------
test('resolver prompt-ready text cites durable IDs and surfaces readiness gaps', () => {
  const ctx = buildSampleContext();
  const text = buildMigrationDiscoveryContextPromptText(ctx);

  // Bounded length per v1 char-budget rule.
  expect(text.length).toBeLessThanOrEqual(MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS);

  // Durable IDs cited so downstream callers can re-fetch.
  expect(text).toContain('finding-aaa');
  expect(text).toContain('run-1');
  expect(text).toContain('baseline-1');
  expect(text).toContain('ev-zzz');
  expect(text).toContain('task-qqq');
  expect(text).toContain('arch-current');
  expect(text).toContain('arch-target');

  // Findings summary content + high-priority finding title surfaced.
  expect(text).toContain('Findings Summary');
  expect(text).toContain('Endpoint /users/{id} missing response schema');

  // Readiness gaps surfaced as explicit codes (never invented).
  expect(text).toContain('unresolved_discovery_decisions');
  expect(text).toContain('missing_current_to_target_mappings');
  expect(text).toContain('Overall: partial');

  // Boilerplate "do not invent" instruction is appended.
  expect(text.toLowerCase()).toContain('prerequisite work');
  expect(text.toLowerCase()).toContain('inventing details');
});

// ---------------------------------------------------------------------------
// Test 4: fail-soft when AMS unreachable
// ---------------------------------------------------------------------------
test('resolver returns a graceful fallback string when AMS is unreachable (does NOT throw)', async () => {
  // listArchitectures succeeds...
  mockFetch.mockResolvedValueOnce(listArchitecturesResponse('arch-default'));
  // ...but the POST to AMS rejects with a network-style error.
  mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

  const resolver = new MigrationDiscoveryContextResolver();
  // Must NOT throw.
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(typeof out).toBe('string');
  expect(out.toLowerCase()).toContain('migration discovery context unavailable');
  expect(out).toContain('ECONNREFUSED');
});

// ---------------------------------------------------------------------------
// Test 5: proxy route forwards body verbatim to AMS and returns response verbatim
// ---------------------------------------------------------------------------
test('proxy route forwards POST body verbatim to AMS and returns AMS response verbatim', async () => {
  const sample = buildSampleContext();
  mockFetch.mockResolvedValueOnce(jsonResponse(200, sample));

  const app = createTestApp();
  const requestBody = {
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    discoveryRunIds: ['run-1'],
    apiBehaviourBaselineIds: ['baseline-1'],
    includeFindings: true,
    includeEvidence: false,
    maxFindings: 25,
    maxEvidenceItems: 50,
  };

  const res = await request(app)
    .post('/api/v1/projects/proj-test/migration-discovery-context')
    .send(requestBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(sample);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-test/migration-discovery-context'
  );
  expect(calledInit.method).toBe('POST');
  // Body is forwarded verbatim (JSON-encoded).
  const forwarded = JSON.parse(calledInit.body as string);
  expect(forwarded).toEqual(requestBody);
});

// ---------------------------------------------------------------------------
// Test 6: proxy route propagates AMS 404 status + body verbatim
// ---------------------------------------------------------------------------
test('proxy route propagates AMS 404 status + body byte-for-byte', async () => {
  const errorBody = {
    error: {
      code: 404,
      message: 'Architecture arch-bogus not found in project proj-test',
    },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(404, errorBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/v1/projects/proj-test/migration-discovery-context')
    .send({ currentArchitectureId: 'arch-bogus' });

  expect(res.status).toBe(404);
  expect(res.body).toEqual(errorBody);
});

// ---------------------------------------------------------------------------
// Test 7: proxy route propagates AMS 400 status + body verbatim
// ---------------------------------------------------------------------------
test('proxy route propagates AMS 400 status + body byte-for-byte', async () => {
  const errorBody = {
    error: {
      code: 400,
      message: 'currentArchitectureId is required',
    },
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(400, errorBody));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/v1/projects/proj-test/migration-discovery-context')
    .send({});

  expect(res.status).toBe(400);
  expect(res.body).toEqual(errorBody);
});
