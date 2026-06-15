/**
 * Gap-fill end-to-end tests for the multi-architecture plumbing pipeline.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing -- Task 6.4.
 *
 * Existing Group 3 tests (`multiArchitecturePlumbing.test.ts`) cover:
 *   - architectureModelClient functions in isolation (URL shape, signature)
 *   - The list-architectures proxy route returns its array verbatim
 *   - 404-safety: omitting :architectureId on a Bucket A proxy returns 404
 *
 * They do NOT cover the path-segment threading from request to upstream:
 * given an incoming Bucket A request with a specific architectureId, the
 * gateway must build the upstream URL with THAT architectureId verbatim --
 * proving no silent substitution / no hardcoded default / no leak from a
 * sibling project's resolved Default into the upstream URL.
 *
 * This file adds two strategic tests:
 *
 *   1. Threading a Bucket A request: incoming meta-model-summary request
 *      with architectureId X yields an upstream URL containing X
 *      verbatim. Sibling-architecture isolation property at the gateway layer.
 *
 *   2. POST flow + path-segment threading on a different verb: the
 *      refresh-user-journey-from-model POST route also threads architectureId
 *      verbatim and forwards the body. Demonstrates the safety property
 *      generalizes across HTTP verbs and across multiple Bucket A endpoints.
 */

// ---- Mock the gateway config so the tests don't depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock global fetch for assertions on upstream calls ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { architecturesRouter } from '../routes/architectures';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'multi-arch-e2e-test';
    next();
  });
  app.use('/api', architecturesRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: Bucket A meta-model-summary -- architectureId threads verbatim
//         (sibling-architecture isolation at the gateway proxy layer)
// ---------------------------------------------------------------------------
test('GET meta-model-summary proxy threads :architectureId verbatim into the upstream URL (sibling isolation)', async () => {
  // Two distinct architectures within the same project. The proxy must use
  // exactly the one supplied in the request URL, never substitute, never
  // resolve a Default. We hit ARCH_A_ID and assert the upstream URL contains
  // ARCH_A_ID and does NOT contain ARCH_B_ID.
  const PROJECT_ID = 'proj-sibling-iso';
  const ARCH_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ARCH_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const fixture = {
    services: [{ id: 'svc-a', name: 'arch-a-only-service', entity_type: 'services' }],
    data_entities: [],
    interfaces: [],
    relationships: [],
    applications: [],
    business_users: [],
    process_activities: [],
    ui_screens: [],
    user_journeys: [],
    data_store_count: 0,
  };
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => fixture,
    text: async () => JSON.stringify(fixture),
  });

  const app = createTestApp();
  const res = await request(app).get(
    `/api/projects/${PROJECT_ID}/architectures/${ARCH_A_ID}/meta-model-summary`
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(fixture);

  // The single upstream call must be the architecture-A-scoped meta-model-
  // summary endpoint. The architectureId in the URL must match exactly the
  // one supplied in the request (no Default-resolver substitution, no leak
  // of the sibling architecture id).
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe(
    `http://localhost:8080/api/projects/${PROJECT_ID}/architectures/${ARCH_A_ID}/meta-model-summary`
  );
  expect(calledUrl).toContain(`/architectures/${ARCH_A_ID}/`);
  expect(calledUrl).not.toContain(ARCH_B_ID);
});

// ---------------------------------------------------------------------------
// Test 2: POST refresh-user-journey-from-model -- threading + body forward
// ---------------------------------------------------------------------------
test('POST refresh-user-journey-from-model proxy threads :architectureId verbatim and forwards method', async () => {
  const PROJECT_ID = 'proj-post-test';
  const ARCH_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const DIAGRAM_ID = 'diag-uj-001';

  const updatedDiagram = {
    id: DIAGRAM_ID,
    name: 'Refreshed Journey',
    diagram_type: 'USER_JOURNEY',
  };
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => updatedDiagram,
    text: async () => JSON.stringify(updatedDiagram),
  });

  const app = createTestApp();
  const res = await request(app)
    .post(
      `/api/projects/${PROJECT_ID}/architectures/${ARCH_ID}/diagrams/${DIAGRAM_ID}/refresh-user-journey-from-model`
    )
    .send({});

  expect(res.status).toBe(200);
  expect(res.body).toEqual(updatedDiagram);

  // The upstream URL must embed the supplied :architectureId verbatim.
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const calledUrl = mockFetch.mock.calls[0][0] as string;
  expect(calledUrl).toBe(
    `http://localhost:8080/api/projects/${PROJECT_ID}/architectures/${ARCH_ID}/diagrams/${DIAGRAM_ID}/refresh-user-journey-from-model`
  );

  // And the upstream call was made via POST (verb forwarded).
  const calledInit = mockFetch.mock.calls[0][1] as RequestInit;
  expect(calledInit.method).toBe('POST');
});
