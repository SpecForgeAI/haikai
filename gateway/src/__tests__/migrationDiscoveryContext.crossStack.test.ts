/**
 * Migration Discovery Context -- Group 6 cross-stack test (gateway slice).
 *
 * Spec: 2026-05-16 Migration Discovery Context Integration (Task Group 6).
 *
 * Strategic gap: each layer is unit-tested in isolation, but no test wires the
 * wizard-style request body through the gateway proxy and asserts that AMS
 * receives the exact field set the wizard sends. This proves the
 * "forward verbatim" contract that the proxy promises is preserved against
 * field-name drift in either direction.
 *
 * Specifically: the frontend wizard's submission shape
 * (`discoveryRunIds[]`, `apiBehaviourBaselineIds[]`, `maxFindings`,
 * `maxEvidenceItems`, include flags) is the same shape callers like
 * `api-migration-validation-service` and future PM workflows will send. This
 * test pins that contract at the gateway boundary so a rename or flag drop
 * in either DTO will fail loudly.
 */

// ---------------------------------------------------------------------------
// Mocks
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
// Imports
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { migrationContextRouter } from '../routes/migrationContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'cross-stack-test';
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

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Cross-stack test: wizard-style payload survives the proxy boundary verbatim
// ---------------------------------------------------------------------------
test(
  'gateway proxy preserves the wizard-style payload (run IDs, baseline IDs, include flags, ' +
    'count caps) byte-for-byte when forwarding to AMS',
  async () => {
    // Pretend AMS returns a small valid envelope -- the content is irrelevant
    // for this contract test; only the request shape matters.
    const amsResponse = {
      projectId: 'proj-cross-stack',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
      discoveryRunIds: ['run-a', 'run-b'],
      apiBehaviourBaselineIds: ['baseline-x'],
      generatedAt: '2026-05-16T13:00:00Z',
      summary: 'cross-stack-ok',
      readinessAssessment: { overallStatus: 'partial', gaps: [] },
      contextWarnings: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, amsResponse));

    // This is the exact shape the frontend wizard + future PM workflows send.
    // We use uncommon but valid integer caps (75, 60) to prove no clamp /
    // default substitution happens at the gateway layer.
    const wizardPayload = {
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
      discoveryRunIds: ['run-a', 'run-b'],
      apiBehaviourBaselineIds: ['baseline-x'],
      includeFindings: true,
      includeEvidence: true,
      includeRuntimeEvidence: false,
      includeDbFindings: true,
      includeMappings: true,
      maxFindings: 75,
      maxEvidenceItems: 60,
    };

    const app = createTestApp();
    const res = await request(app)
      .post('/api/v1/projects/proj-cross-stack/migration-discovery-context')
      .send(wizardPayload);

    // --- Response is passed through cleanly ---
    expect(res.status).toBe(200);
    expect(res.body).toEqual(amsResponse);

    // --- AMS received the body field-for-field verbatim ---
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'http://localhost:8080/api/projects/proj-cross-stack/migration-discovery-context'
    );
    expect(calledInit.method).toBe('POST');

    const forwarded = JSON.parse(calledInit.body as string);
    // Use `toEqual` so the test fails if any field is added, dropped, renamed,
    // or substituted at the gateway boundary.
    expect(forwarded).toEqual(wizardPayload);

    // --- Limits are forwarded verbatim, not clamped to 100/100 defaults ---
    expect(forwarded.maxFindings).toBe(75);
    expect(forwarded.maxEvidenceItems).toBe(60);
    // --- Boolean false survives JSON round-trip ---
    expect(forwarded.includeRuntimeEvidence).toBe(false);
  }
);
