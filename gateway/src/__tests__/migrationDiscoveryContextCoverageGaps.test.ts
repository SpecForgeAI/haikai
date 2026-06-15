/**
 * Migration Discovery Context proxy — coverage-gate gap-code passthrough.
 *
 * Spec: 2026-05-30 Capture Coverage Gates (Spec 5) — Task Group 3 (gateway
 * proxy confirm).
 *
 * AMS Group 1 added three new advisory coverage gap codes that ride the
 * EXISTING `ReadinessAssessmentDto.gaps()` list (codes-only — no new DTO
 * metric VALUE fields). The gateway proxy `POST
 * /api/v1/projects/:projectId/migration-discovery-context` forwards the body
 * verbatim and re-emits the AMS response (status + body) byte-for-byte, so the
 * new codes must round-trip with NO gateway-side transformation and NO proxy
 * code change.
 *
 * This is a focused regression test for that passthrough — mirrors the
 * verbatim-forward pattern already covered in `migrationDiscoveryContext.test.ts`
 * (Test 5), but specifically asserts the three new gap codes survive the
 * round-trip unchanged. The three codes:
 *   - incomplete_capture_coverage          (A)
 *   - under_specified_endpoints            (B)
 *   - discovery_harness_inventory_mismatch (C)
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
import { migrationContextRouter } from '../routes/migrationContext';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';

// ---------------------------------------------------------------------------
// Helpers (match migrationDiscoveryContext.test.ts conventions)
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'coverage-gaps-test';
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
      get: (k: string) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () =>
      body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

// The three new advisory coverage gap codes added by AMS Group 1.
const CAPTURE_COVERAGE_GAP = 'incomplete_capture_coverage';
const UNDER_SPECIFIED_GAP = 'under_specified_endpoints';
const INVENTORY_MISMATCH_GAP = 'discovery_harness_inventory_mismatch';

/**
 * Minimal AMS context carrying the three new coverage gap codes (mixed with a
 * pre-existing code) on the readiness assessment's `gaps` list. We keep it lean
 * so the assertion is unambiguously about the gaps round-trip.
 */
function buildContextWithCoverageGaps(): MigrationDiscoveryContext {
  return {
    projectId: 'proj-test',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    generatedAt: '2026-05-30T12:00:00Z',
    readinessAssessment: {
      overallStatus: 'partial',
      apiReadiness: 'partial',
      dataReadiness: 'sufficient',
      infrastructureReadiness: 'partial',
      discoveryReadiness: 'partial',
      mappingReadiness: 'partial',
      baselineReadiness: 'partial',
      decisionReadiness: 'partial',
      gaps: [
        'unresolved_discovery_decisions',
        CAPTURE_COVERAGE_GAP,
        UNDER_SPECIFIED_GAP,
        INVENTORY_MISMATCH_GAP,
      ],
    },
  } as MigrationDiscoveryContext;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test: new coverage gap codes round-trip byte-for-byte through the proxy
// ---------------------------------------------------------------------------

test('proxy re-emits the new coverage gap codes byte-for-byte with no transformation', async () => {
  const sample = buildContextWithCoverageGaps();
  mockFetch.mockResolvedValueOnce(jsonResponse(200, sample));

  const app = createTestApp();
  const res = await request(app)
    .post('/api/v1/projects/proj-test/migration-discovery-context')
    .send({ currentArchitectureId: 'arch-current' });

  // Status forwarded verbatim.
  expect(res.status).toBe(200);

  // Whole body re-emitted byte-for-byte (deep equality) -- no field dropped,
  // renamed, re-cased, or reordered in a way that changes the JSON value.
  expect(res.body).toEqual(sample);

  // The three new coverage gap codes survive the round-trip, untransformed,
  // on the readiness assessment's existing `gaps` list.
  const gaps = res.body.readinessAssessment?.gaps as string[];
  expect(gaps).toEqual([
    'unresolved_discovery_decisions',
    CAPTURE_COVERAGE_GAP,
    UNDER_SPECIFIED_GAP,
    INVENTORY_MISMATCH_GAP,
  ]);
  expect(gaps).toContain(CAPTURE_COVERAGE_GAP);
  expect(gaps).toContain(UNDER_SPECIFIED_GAP);
  expect(gaps).toContain(INVENTORY_MISMATCH_GAP);

  // Upstream AMS aggregation endpoint hit exactly once, body forwarded verbatim.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
    string,
    RequestInit,
  ];
  expect(calledUrl).toBe(
    'http://localhost:8080/api/projects/proj-test/migration-discovery-context'
  );
  expect(calledInit.method).toBe('POST');
  const forwarded = JSON.parse(calledInit.body as string);
  expect(forwarded).toEqual({ currentArchitectureId: 'arch-current' });
});
