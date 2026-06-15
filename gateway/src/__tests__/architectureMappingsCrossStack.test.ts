/**
 * Architecture Element Mappings -- cross-stack end-to-end gap-fill tests
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 8.3
 *
 * These tests fill the cross-stack gaps NOT covered by the per-layer tests
 * already written in Groups 1-7. Each test exercises a multi-step or
 * cross-layer property of THIS feature only:
 *
 *   1. Copy + auto-map -> GET architecture-mappings round-trip via the
 *      Gateway proxy. The per-layer tests prove the commit endpoint forwards
 *      `autoMap` and surfaces `createdMappingCount` in isolation, and that
 *      the GET endpoint honours filters in isolation -- but no test proves
 *      a wizard-shaped consumer can issue both calls back-to-back via the
 *      same proxy and observe the freshly-written rows. (Gap 8.3 a.)
 *
 *   2. Manual-add -> edit -> delete cycle via the Gateway proxy. Each verb
 *      has a dedicated test in `architectureMappingsProxy.test.ts`, but
 *      no test sequences POST then PUT then DELETE on the SAME mapping id
 *      so a Mapping Review consumer's full lifecycle through the proxy is
 *      verified end-to-end. (Gap 8.3 b.)
 *
 *   3. PUT body with `confidence: null` is forwarded byte-for-byte through
 *      the Gateway proxy. The boxed-Double regression (cf.
 *      project_primitive_double_dto_overwrite.md) guards the AMS DTO; this
 *      test guards the Gateway-layer JSON-pass-through so the null is not
 *      coerced or stripped on the wire. Without this, the AMS-side guard
 *      could be silently bypassed by a body-mangling proxy.
 *
 * Pattern: same fetch-mock + supertest scaffolding as
 * `architectureMappingsProxy.test.ts`.
 */

// ---- Mock the gateway config so the tests do not depend on env vars ----
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// ---- Mock global fetch for client-function calls (called from inside the routes) ----
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { architecturesRouter } from '../routes/architectures';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'architecture-mappings-cross-stack-test';
    next();
  });
  app.use('/api', architecturesRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  const statusText =
    status === 200 ? 'OK' : status === 201 ? 'Created' : status === 204 ? 'No Content' : 'Error';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

function noContentResponse() {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    headers: {
      get: (_k: string) => null,
    },
    json: async () => null,
    text: async () => '',
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Gap 8.3a: copy + auto-map -> GET architecture-mappings via Gateway proxy.
//
// Sequences the two HTTP calls a wizard consumer would make:
//   1. POST .../selective-copy/commit  with autoMap=true   (returns
//      copied=2, createdMappingCount=2)
//   2. GET  .../architecture-mappings  with the (source, target) pair
//      (returns 2 mapping rows with mapping_type=equivalent,
//       status=confirmed, confidence=1.0,
//       created_by_task=selective-copy-with-auto-map)
//
// Proves both calls share the same proxy + emit URL pattern AMS expects,
// and that the freshly-written rows are observable on the next GET via the
// same projectId path.
// ---------------------------------------------------------------------------
test('cross-stack: copy+autoMap then GET architecture-mappings round-trip via Gateway proxy', async () => {
  const projectId = 'proj-e2e-1';
  const sourceArchId = 'arch-source-e2e';
  const targetArchId = 'arch-target-e2e';

  // Stub 1: AMS commit response.
  const commitResponse = {
    copied: 2,
    skipped: 0,
    overwritten: 0,
    duplicated: 0,
    autoIncluded: 0,
    createdMappingCount: 2,
  };
  // Stub 2: AMS GET architecture-mappings response (the rows the auto-map path
  // would have written; verbatim copy means source id == target id).
  const mappings = [
    {
      id: 'mapping-e2e-1',
      projectId,
      sourceArchitectureId: sourceArchId,
      targetArchitectureId: targetArchId,
      sourceElementType: 'applications',
      sourceElementId: 'app-1',
      targetElementType: 'applications',
      targetElementId: 'app-1',
      mappingType: 'equivalent',
      status: 'confirmed',
      createdByTask: 'selective-copy-with-auto-map',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
      notes: null,
      confidence: 1.0,
    },
    {
      id: 'mapping-e2e-2',
      projectId,
      sourceArchitectureId: sourceArchId,
      targetArchitectureId: targetArchId,
      sourceElementType: 'applications',
      sourceElementId: 'app-2',
      targetElementType: 'applications',
      targetElementId: 'app-2',
      mappingType: 'equivalent',
      status: 'confirmed',
      createdByTask: 'selective-copy-with-auto-map',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
      notes: null,
      confidence: 1.0,
    },
  ];

  mockFetch
    .mockResolvedValueOnce(jsonResponse(200, commitResponse))
    .mockResolvedValueOnce(jsonResponse(200, mappings));

  const app = createTestApp();

  // ---- Call 1: commit with autoMap=true ----
  const commitRes = await request(app)
    .post(`/api/projects/${projectId}/architectures/${targetArchId}/selective-copy/commit`)
    .send({
      sourceArchitectureId: sourceArchId,
      elementIds: ['app-1', 'app-2'],
      resolutions: [],
      autoMap: true,
    });
  expect(commitRes.status).toBe(200);
  expect(commitRes.body.createdMappingCount).toBe(2);

  // ---- Call 2: GET mappings for the (source, target) pair ----
  const listRes = await request(app)
    .get(`/api/projects/${projectId}/architecture-mappings`)
    .query({
      sourceArchitectureId: sourceArchId,
      targetArchitectureId: targetArchId,
    });
  expect(listRes.status).toBe(200);
  expect(Array.isArray(listRes.body)).toBe(true);
  expect(listRes.body).toHaveLength(2);
  // Every row has the auto-map defaults from the spec.
  for (const row of listRes.body) {
    expect(row.mappingType).toBe('equivalent');
    expect(row.status).toBe('confirmed');
    expect(row.createdByTask).toBe('selective-copy-with-auto-map');
    expect(row.confidence).toBe(1.0);
    // Verbatim insert -> source id == target id.
    expect(row.sourceElementId).toBe(row.targetElementId);
  }

  // Both upstream calls fired against the right AMS URLs.
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[0][0]).toBe(
    `http://localhost:8080/api/projects/${projectId}/architectures/${targetArchId}/selective-copy/commit`
  );
  const listUrl = new URL(mockFetch.mock.calls[1][0] as string);
  expect(`${listUrl.origin}${listUrl.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/architecture-mappings`
  );
  expect(listUrl.searchParams.get('sourceArchitectureId')).toBe(sourceArchId);
  expect(listUrl.searchParams.get('targetArchitectureId')).toBe(targetArchId);
});

// ---------------------------------------------------------------------------
// Gap 8.3b: manual-add -> edit -> delete cycle via Gateway proxy.
//
// Issues the three Mapping Review CRUD calls in sequence on the same
// mapping id (the id returned from POST is the id used in PUT and DELETE).
// Proves the Gateway proxy forwards the id through the URL across all
// three verbs and that the bodies pass through unchanged.
// ---------------------------------------------------------------------------
test('cross-stack: manual-add -> edit -> delete cycle via Gateway proxy on the same mapping id', async () => {
  const projectId = 'proj-e2e-cycle';
  const sourceArchId = 'arch-src-cycle';
  const targetArchId = 'arch-tgt-cycle';
  const mappingId = 'mapping-cycle-1';

  const baseRow = {
    id: mappingId,
    projectId,
    sourceArchitectureId: sourceArchId,
    targetArchitectureId: targetArchId,
    sourceElementType: 'services',
    sourceElementId: 'svc-1',
    targetElementType: 'services',
    targetElementId: 'svc-1-target',
    mappingType: 'equivalent',
    status: 'proposed',
    createdByTask: 'mapping-review-modal-add',
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    notes: 'first draft',
    confidence: null,
  };

  mockFetch
    // POST 201 with the new row
    .mockResolvedValueOnce(jsonResponse(201, baseRow))
    // PUT 200 with the edited row (mapping_type bumped, created_by_task overwritten server-side)
    .mockResolvedValueOnce(
      jsonResponse(200, {
        ...baseRow,
        mappingType: 'renamed',
        status: 'needs_review',
        createdByTask: 'mapping-review-modal-edit',
        notes: 'rename rationale clarified',
        updatedAt: '2026-05-15T01:00:00Z',
      })
    )
    // DELETE 204 No Content
    .mockResolvedValueOnce(noContentResponse());

  const app = createTestApp();

  // ---- POST (manual-add) ----
  const createPayload = {
    sourceArchitectureId: sourceArchId,
    targetArchitectureId: targetArchId,
    sourceElementType: 'services',
    sourceElementId: 'svc-1',
    targetElementType: 'services',
    targetElementId: 'svc-1-target',
    mappingType: 'equivalent',
    status: 'proposed',
    notes: 'first draft',
    // Per spec: manual-add MUST default confidence to null (NOT 1.0).
    confidence: null,
  };
  const createRes = await request(app)
    .post(`/api/projects/${projectId}/architecture-mappings`)
    .send(createPayload);
  expect(createRes.status).toBe(201);
  expect(createRes.body.id).toBe(mappingId);
  expect(createRes.body.confidence).toBeNull();
  expect(createRes.body.createdByTask).toBe('mapping-review-modal-add');

  // ---- PUT (edit) ----
  const updatePayload = {
    mappingType: 'renamed',
    status: 'needs_review',
    notes: 'rename rationale clarified',
    confidence: null,
  };
  const updateRes = await request(app)
    .put(`/api/projects/${projectId}/architecture-mappings/${mappingId}`)
    .send(updatePayload);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.mappingType).toBe('renamed');
  expect(updateRes.body.status).toBe('needs_review');
  // Server overwrote createdByTask; the wire confirms that.
  expect(updateRes.body.createdByTask).toBe('mapping-review-modal-edit');

  // ---- DELETE ----
  const deleteRes = await request(app).delete(
    `/api/projects/${projectId}/architecture-mappings/${mappingId}`
  );
  expect(deleteRes.status).toBe(204);

  // All three calls hit AMS at the right URLs with the right verbs.
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(mockFetch.mock.calls[0][0]).toBe(
    `http://localhost:8080/api/projects/${projectId}/architecture-mappings`
  );
  expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('POST');

  expect(mockFetch.mock.calls[1][0]).toBe(
    `http://localhost:8080/api/projects/${projectId}/architecture-mappings/${mappingId}`
  );
  expect((mockFetch.mock.calls[1][1] as RequestInit).method).toBe('PUT');

  expect(mockFetch.mock.calls[2][0]).toBe(
    `http://localhost:8080/api/projects/${projectId}/architecture-mappings/${mappingId}`
  );
  expect((mockFetch.mock.calls[2][1] as RequestInit).method).toBe('DELETE');

  // Bodies pass-through unchanged across the chain.
  expect(JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)).toEqual(createPayload);
  expect(JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)).toEqual(updatePayload);
});

// ---------------------------------------------------------------------------
// Gap 8.3 follow-on: PUT body with `confidence: null` is forwarded byte-for-byte
// through the Gateway proxy.
//
// The AMS DTO uses boxed Double for confidence (per
// project_primitive_double_dto_overwrite.md) so JSON null deserialises to
// null on the entity. But that guard only matters end-to-end if the Gateway
// preserves the null on the wire and does not strip / coerce it. This test
// captures the byte-for-byte body the Gateway forwards to AMS and asserts
// `confidence` is the JSON literal `null` (not `0`, not `undefined`, not
// stripped from the body).
// ---------------------------------------------------------------------------
test('cross-stack: Gateway PUT proxy forwards confidence=null byte-for-byte (boxed-Double regression guard)', async () => {
  const projectId = 'proj-conf-null';
  const mappingId = 'mapping-conf-null';

  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, {
      id: mappingId,
      projectId,
      sourceArchitectureId: 'arch-s',
      targetArchitectureId: 'arch-t',
      sourceElementType: 'applications',
      sourceElementId: 'app-1',
      targetElementType: 'applications',
      targetElementId: 'app-1-target',
      mappingType: 'equivalent',
      status: 'confirmed',
      createdByTask: 'mapping-review-modal-edit',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
      notes: null,
      confidence: null,
    })
  );

  const app = createTestApp();

  // Send a body with confidence: null explicitly.
  const payload = {
    mappingType: 'equivalent',
    status: 'confirmed',
    notes: null,
    confidence: null,
  };
  const res = await request(app)
    .put(`/api/projects/${projectId}/architecture-mappings/${mappingId}`)
    .send(payload);
  expect(res.status).toBe(200);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const sentBodyRaw = (mockFetch.mock.calls[0][1] as RequestInit).body as string;
  // Inspect the raw JSON string the Gateway forwarded. The boxed-Double
  // contract requires a literal `null` -- if the proxy stripped the field
  // or coerced to 0, the AMS-side guard cannot save us.
  expect(sentBodyRaw).toContain('"confidence":null');
  expect(sentBodyRaw).not.toContain('"confidence":0');

  // Parsed shape sanity-check: the field is present and exactly null.
  const parsed = JSON.parse(sentBodyRaw);
  expect(Object.prototype.hasOwnProperty.call(parsed, 'confidence')).toBe(true);
  expect(parsed.confidence).toBeNull();
  // Round-trip on the wire matches what the wizard sent.
  expect(parsed).toEqual(payload);
});
