/**
 * manual-capture format-twin mirror tests (2026-08-02).
 *
 * A 2xx manual/Postman capture on ONE variant of a dual-format pair
 * (`[format=application/json]` / `[format=application/xml]`) must
 * deterministically close the UNCOVERED sibling too: same facts, body
 * converted between formats, Content-Type/Accept swapped, sent LIVE and
 * persisted via the identical scenario+capture sequence. Pins:
 *   1. JSON capture + uncovered XML sibling -> a SECOND live send with an
 *      XML body/headers, a second scenario+capture against the sibling row,
 *      and `mirroredSibling` on the response.
 *   2. A COVERED sibling (absent from the gate's unresolved list) -> no
 *      mirror.
 *   3. A non-variant operation -> no mirror.
 *
 * Harness mirrors captureSessionActions.manualCapture.redaction.test.ts.
 */

import express from 'express';
import request from 'supertest';

const mockRequest = jest.fn();
const mockDispose = jest.fn();
jest.mock('../services/httpExecutor', () => ({
  createSessionHttpExecutor: jest.fn(() => ({
    request: mockRequest,
    requestWithAuthOverride: jest.fn(),
    setAuth: jest.fn(),
    dispose: mockDispose,
  })),
}));

import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type {
  CaptureSessionDto,
  OperationDto,
  ScenarioDto,
  CaptureDto,
} from '../services/archModelClient';
import type { SecretsBundle } from '../types/secrets';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const JSON_ROW_ID = '00000000-0000-0000-0000-0000000000d1';
const XML_ROW_ID = '00000000-0000-0000-0000-0000000000d2';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'format-mirror',
    status: 'completed',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: false,
    started_at: null,
    completed_at: now,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as CaptureSessionDto;
}

function buildOperation(overrides: Partial<OperationDto> = {}): OperationDto {
  const now = new Date().toISOString();
  return {
    id: JSON_ROW_ID,
    session_id: SESSION_ID,
    operation_id: 'getNode [format=application/json]',
    method: 'POST',
    path: '/nodes/{orgId}',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as OperationDto;
}

interface MockArch {
  getCaptureSession: jest.Mock;
  listOperationsBySession: jest.Mock;
  createScenario: jest.Mock;
  createCapture: jest.Mock;
  patchCaptureSession: jest.Mock;
}

function buildArchClient(session: CaptureSessionDto, operations: OperationDto[]): MockArch {
  let scenarioSeq = 0;
  let captureSeq = 0;
  return {
    getCaptureSession: jest.fn(async () => session),
    listOperationsBySession: jest.fn(async () => operations),
    createScenario: jest.fn(async (_p: string, body: Record<string, unknown>): Promise<ScenarioDto> => {
      scenarioSeq += 1;
      return {
        id: `scenario-${scenarioSeq}`,
        session_id: body.session_id,
        operation_id: body.operation_id,
        scenario_name: body.scenario_name ?? null,
        scenario_type: body.scenario_type ?? null,
        status: 'draft',
        generation_source: body.generation_source ?? null,
        request_method: body.request_method ?? null,
        request_path: body.request_path ?? null,
        request_query_json: body.request_query_json ?? null,
        request_headers_redacted_json: body.request_headers_redacted_json ?? null,
        request_body_json: body.request_body_json ?? null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as unknown as ScenarioDto;
    }),
    createCapture: jest.fn(async (_p: string, body: Record<string, unknown>): Promise<CaptureDto> => {
      captureSeq += 1;
      return {
        id: `capture-${captureSeq}`,
        ...body,
        accepted: null,
        accepted_at: null,
        reviewer_notes: null,
      } as unknown as CaptureDto;
    }),
    patchCaptureSession: jest.fn(async () => ({})),
  };
}

/** A gate-ready summary: one per_endpoint row per op, happy dim unachieved. */
function closureSummary(operationIds: string[]): Record<string, unknown> {
  return {
    per_endpoint: operationIds.map((operationId) => ({
      operation_id: operationId,
      method: 'POST',
      path: '/nodes/{orgId}',
      score: 0,
      dimensions: [
        {
          type: 'happy_path',
          name: 'happy_path',
          achieved: false,
          canonical_capture_id: null,
          reason: 'no capture was recorded',
          observation: null,
        },
      ],
    })),
    dimensions_total: operationIds.length,
    dimensions_achieved: 0,
    overall_score: 0,
    auth_coverage: { achieved: false },
  };
}

function buildApp(arch: MockArch) {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(buildCaptureSessionActionsRouter({ archModelClient: arch as any }));
  return app;
}

function seedSecret(): void {
  const bundle: SecretsBundle = {
    sessionId: SESSION_ID,
    api: { type: 'bearer', bearerToken: 'live-token' },
    loadedAt: Date.now(),
  };
  secretsStore.set(bundle);
}

/** A summary whose per_endpoint rows carry NO happy dimension = unresolved. */
function summaryWithUnresolved(operationIds: string[]): Record<string, unknown> {
  return {
    per_endpoint: operationIds.map((operationId) => ({
      operation_id: operationId,
      method: 'POST',
      path: '/nodes/{orgId}',
      dimensions: [],
    })),
  };
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  mockRequest.mockReset();
  mockDispose.mockReset();
});

const SEND_BODY = {
  operationId: JSON_ROW_ID,
  method: 'POST',
  path: '/nodes/62552',
  headers: { 'Content-Type': 'application/json', 'X-Trace': 'keep-me' },
  body: { node: { orgId: 62552 } },
};

test('a 2xx JSON capture mirrors to the uncovered XML sibling: second live send + sibling scenario/capture + mirroredSibling', async () => {
  seedSecret();
  const jsonOp = buildOperation();
  const xmlOp = buildOperation({
    id: XML_ROW_ID,
    operation_id: 'getNode [format=application/xml]',
  });
  const arch = buildArchClient(
    buildSession({
      coverage_summary_json: summaryWithUnresolved([
        'getNode [format=application/xml]',
      ]) as never,
    } as Partial<CaptureSessionDto>),
    [jsonOp, xmlOp],
  );
  const app = buildApp(arch);

  mockRequest
    .mockResolvedValueOnce({ status: 200, headers: {}, data: { ok: true } })
    .mockResolvedValueOnce({ status: 200, headers: {}, data: '<node><ok>true</ok></node>' });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send(SEND_BODY);

  expect(res.status).toBe(201);
  expect(mockRequest).toHaveBeenCalledTimes(2);

  // The mirrored send carries the sibling media + a converted XML body,
  // while custom headers survive.
  const mirrorCall = mockRequest.mock.calls[1][0];
  expect(mirrorCall.headers['Content-Type']).toBe('application/xml');
  expect(mirrorCall.headers.Accept).toBe('application/xml');
  expect(mirrorCall.headers['X-Trace']).toBe('keep-me');
  expect(String(mirrorCall.data)).toContain('<node>');
  expect(String(mirrorCall.data)).toContain('<orgId>62552</orgId>');

  // Second scenario + capture landed against the SIBLING row.
  expect(arch.createScenario).toHaveBeenCalledTimes(2);
  expect(arch.createCapture).toHaveBeenCalledTimes(2);
  expect(arch.createScenario.mock.calls[1][1].operation_id).toBe(XML_ROW_ID);
  expect(arch.createCapture.mock.calls[1][1].operation_id).toBe(XML_ROW_ID);
  expect(arch.createCapture.mock.calls[1][1].response_status).toBe(200);

  expect(res.body.mirroredSibling).toMatchObject({
    operationRowId: XML_ROW_ID,
    operationId: 'getNode [format=application/xml]',
    responseStatus: 200,
  });
});

test('a COVERED sibling (not in the gate unresolved list) is NOT mirrored', async () => {
  seedSecret();
  const jsonOp = buildOperation();
  const xmlOp = buildOperation({
    id: XML_ROW_ID,
    operation_id: 'getNode [format=application/xml]',
  });
  const arch = buildArchClient(
    buildSession({
      // Summary carries only the JSON variant: the sibling is absent from
      // per_endpoint, so it is NOT unresolved -> covered -> no mirror.
      coverage_summary_json: summaryWithUnresolved([
        'getNode [format=application/json]',
      ]) as never,
    } as Partial<CaptureSessionDto>),
    [jsonOp, xmlOp],
  );
  const app = buildApp(arch);
  mockRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send(SEND_BODY);

  expect(res.status).toBe(201);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(arch.createCapture).toHaveBeenCalledTimes(1);
  expect(res.body.mirroredSibling).toBeNull();
});

test('gate recompute: genuine 2xx on both twins closes both and returns complete: true', async () => {
  seedSecret();
  const jsonOp = buildOperation();
  const xmlOp = buildOperation({
    id: XML_ROW_ID,
    operation_id: 'getNode [format=application/xml]',
  });
  const arch = buildArchClient(
    buildSession({
      coverage_summary_json: closureSummary([
        'getNode [format=application/json]',
        'getNode [format=application/xml]',
      ]) as never,
    } as Partial<CaptureSessionDto>),
    [jsonOp, xmlOp],
  );
  const app = buildApp(arch);
  mockRequest
    .mockResolvedValueOnce({ status: 200, headers: {}, data: { node: { ok: true } } })
    .mockResolvedValueOnce({ status: 200, headers: {}, data: '<node><ok>true</ok></node>' });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send(SEND_BODY);

  expect(res.status).toBe(201);
  expect(arch.patchCaptureSession).toHaveBeenCalledTimes(1);
  const patched = arch.patchCaptureSession.mock.calls[0][2].coverage_summary_json as {
    per_endpoint: Array<{ operation_id: string; dimensions: Array<{ achieved: boolean }> }>;
  };
  for (const ep of patched.per_endpoint) {
    expect(ep.dimensions.some((d) => d.achieved)).toBe(true);
  }
  expect(res.body.gate).toMatchObject({ complete: true, happy_achieved: 2 });
});

test('gate recompute: a 200-wrapped recognised error does NOT close the gate', async () => {
  seedSecret();
  const plainOp = buildOperation({ operation_id: 'createWidget', path: '/widgets' });
  const arch = buildArchClient(
    buildSession({
      coverage_summary_json: closureSummary(['createWidget']) as never,
    } as Partial<CaptureSessionDto>),
    [plainOp],
  );
  const app = buildApp(arch);
  // HTTP 200 whose body is a RECOGNISED error marker — the strict classifier
  // buckets this as not_found, never success.
  mockRequest.mockResolvedValue({
    status: 200,
    headers: {},
    data: { detail: 'record not found' },
  });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ ...SEND_BODY, path: '/widgets' });

  expect(res.status).toBe(201);
  expect(arch.patchCaptureSession).not.toHaveBeenCalled();
  expect(res.body.gate).toMatchObject({ complete: false });
});

test('a non-variant operation is NOT mirrored', async () => {
  seedSecret();
  const plainOp = buildOperation({ operation_id: 'createWidget', path: '/widgets' });
  const arch = buildArchClient(buildSession(), [plainOp]);
  const app = buildApp(arch);
  mockRequest.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });

  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/manual-capture?projectId=${PROJECT_ID}`)
    .send({ ...SEND_BODY, path: '/widgets' });

  expect(res.status).toBe(201);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(res.body.mirroredSibling).toBeNull();
});
