/**
 * Tests for SOAP-aware Step 4 pre-population via
 * `synthesiseInventoryFromEndpoints` inside the `/parse-oas` route.
 *
 * Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17), Group 11.
 *
 * Group 11 extends the existing Phase A pre-population helper so that when
 * the parent interface has `interface_type='SOAP_API'`, the seven SOAP fields
 * sitting on the endpoint row's `protocol_metadata_json` blob (written there
 * by Group 10's `candidateSaveBackService` change) flow into the wizard's
 * Step 4 operation row.
 *
 * Field mapping (must match the contract enumeration in spec.md):
 *   soap_action            -> operation name (summary / operation_id)
 *   request_root_element   -> request shape preview (oas_operation_json stub)
 *   request_namespace      -> XML namespace badge (description)
 *   response_root_element  -> response shape preview (oas_operation_json stub)
 *   request_dto_class      -> "open in IDE" affordance (oas_operation_json stub)
 *   response_dto_class     -> "open in IDE" affordance (oas_operation_json stub)
 *   wsdl_source            -> "Source: <repo-relative path>" footer
 *                            (oas_operation_json stub)
 *
 * Tests (per Group 11 task spec, 11.1):
 *   1. Full SOAP metadata -- Step 4 row carries all seven mapped values.
 *   2. Back-compat (REST, no `protocol_metadata_json`) -- row produced
 *      exactly as before, no regression.
 *   3. Partial SOAP fields -- only present keys render; absent keys do NOT
 *      produce `undefined` / `null` string artefacts.
 */

import express from 'express';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type { CaptureSessionDto, InterfaceDto, OperationDto } from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'test-soap-session',
    status: 'configured',
    env_name: 'non-prod',
    api_base_url: 'https://api.example.test',
    auth_type: 'bearer',
    auth_config_redacted_json: null,
    default_headers_redacted_json: null,
    oas_spec_refs_json: null,
    db_config_redacted_json: null,
    mutating_calls_confirmed: true,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * The interfaces wire payload from `metaModel.entities.interfaces` carries
 * more fields than the narrow TypeScript `InterfaceDto`. Notably for these
 * tests, `interface_type` (snake_case JSON property) is what the helper
 * keys on, so we hand-shape the mock to include it.
 */
type WireInterface = InterfaceDto & { interface_type?: string };

function buildArchModelClientMock(opts: {
  session?: CaptureSessionDto;
  interfaces?: WireInterface[];
  endpointsByInterface?: Record<string, Array<Record<string, unknown>>>;
}) {
  const session = opts.session ?? buildSession();
  const operationsCreated: Array<{ projectId: string; body: any }> = [];
  const sessionPatches: Array<{ projectId: string; sessionId: string; body: any }> = [];

  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => (opts.interfaces ?? []) as InterfaceDto[]),
    listEndpointsForInterface: jest.fn(
      async (_projectId: string, _archId: string, interfaceId: string) =>
        opts.endpointsByInterface?.[interfaceId] ?? [],
    ),
    listOperationsBySession: jest.fn(async () => []),
    createOperation: jest.fn(async (projectId: string, body: any) => {
      operationsCreated.push({ projectId, body });
      return {
        id: `op-${operationsCreated.length}`,
        session_id: body.session_id,
        operation_id: body.operation_id,
        method: body.method,
        path: body.path,
        summary: body.summary ?? null,
        description: body.description ?? null,
        included: body.included ?? null,
        safe_to_execute: body.safe_to_execute ?? null,
        request_schema_json: body.request_schema_json ?? null,
        response_schema_json: body.response_schema_json ?? null,
        oas_operation_json: body.oas_operation_json ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as OperationDto;
    }),
    patchCaptureSession: jest.fn(async (projectId: string, sessionId: string, body: any) => {
      sessionPatches.push({ projectId, sessionId, body });
      return { ...session, ...body, id: sessionId, project_id: projectId } as CaptureSessionDto;
    }),
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
  return { mock, operationsCreated, sessionPatches };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Test 1: Full SOAP metadata -- the Step 4 row carries all seven mapped
// values. `soap_action` drives summary/operation_id; `request_namespace`
// surfaces in `description`; the remaining four (`request_root_element`,
// `response_root_element`, `request_dto_class`, `response_dto_class`,
// `wsdl_source`) ride inside `oas_operation_json.x-amvs-soap`.
// ---------------------------------------------------------------------------
test('SOAP endpoint with full protocol_metadata_json maps all seven fields into the Step 4 row', async () => {
  const soapInterface: WireInterface = {
    id: 'iface-soap-1',
    name: 'GreetingsService',
    spec_link: null,
    architecture_id: ARCH_ID,
    interface_type: 'SOAP_API',
  };

  const soapEndpoint: Record<string, unknown> = {
    id: 'ep-soap-1',
    interface_id: 'iface-soap-1',
    name: 'greet', // entity-level name -- soap_action should override
    description: 'Greet operation', // entity-level desc -- namespace appended
    operation_verb: 'POST',
    path_or_address: '/document-literal-wrapped/GreetingsService',
    protocol_metadata_json: {
      soap_action: 'http://example.com/greetings/greet',
      request_root_element: 'greet',
      request_namespace: 'http://example.com/greetings',
      response_root_element: 'greetResponse',
      request_dto_class: 'com.example.greetings.Greet',
      response_dto_class: 'com.example.greetings.GreetResponse',
      wsdl_source: 'src/main/resources/wsdl/greetings.wsdl',
    },
  };

  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [soapInterface],
    endpointsByInterface: { 'iface-soap-1': [soapEndpoint] },
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-soap-1'] });

  expect(res.status).toBe(200);
  expect(res.body.skippedInterfaceCount).toBe(1);
  expect(res.body.operationCount).toBe(1);

  // The single synthesised operation row must carry the SOAP mappings.
  expect(operationsCreated).toHaveLength(1);
  const op = operationsCreated[0].body;

  // Operation name column (`summary` / `operation_id`) <- soap_action.
  expect(op.summary).toBe('http://example.com/greetings/greet');
  expect(op.operation_id).toBe('http://example.com/greetings/greet');

  // Method is always POST for SOAP (operation_verb already POST on entity).
  expect(op.method).toBe('POST');
  expect(op.path).toBe('/document-literal-wrapped/GreetingsService');

  // Namespace badge surfaces via `description` (appended to the entity desc).
  expect(typeof op.description).toBe('string');
  expect(op.description).toContain('http://example.com/greetings');

  // Remaining five SOAP fields live in the OAS stub under `x-amvs-soap`.
  const stub = op.oas_operation_json as Record<string, unknown>;
  expect(stub).toBeDefined();
  const soapBlock = stub['x-amvs-soap'] as Record<string, string>;
  expect(soapBlock).toBeDefined();
  expect(soapBlock.soap_action).toBe('http://example.com/greetings/greet');
  expect(soapBlock.request_root_element).toBe('greet');
  expect(soapBlock.request_namespace).toBe('http://example.com/greetings');
  expect(soapBlock.response_root_element).toBe('greetResponse');
  expect(soapBlock.request_dto_class).toBe('com.example.greetings.Greet');
  expect(soapBlock.response_dto_class).toBe('com.example.greetings.GreetResponse');
  expect(soapBlock.wsdl_source).toBe('src/main/resources/wsdl/greetings.wsdl');

  // Source marker identifies SOAP-derived rows for downstream tooling.
  expect(stub['x-amvs-source']).toBe('discovery-endpoint-candidate-soap');
});

// ---------------------------------------------------------------------------
// Test 2: Back-compat -- a REST endpoint with no `protocol_metadata_json`
// renders exactly as before. Verifies that the existing non-SOAP code path
// is untouched: no `x-amvs-soap` block, original entity fields preserved.
// ---------------------------------------------------------------------------
test('REST endpoint without protocol_metadata_json renders as before (back-compat)', async () => {
  const restInterface: WireInterface = {
    id: 'iface-rest-1',
    name: 'OrdersAPI',
    spec_link: null, // forces the pre-population path even for REST
    architecture_id: ARCH_ID,
    interface_type: 'REST_API',
  };

  const restEndpoint: Record<string, unknown> = {
    id: 'ep-rest-1',
    interface_id: 'iface-rest-1',
    name: 'createOrder',
    description: 'Creates a new order',
    operation_verb: 'POST',
    path_or_address: '/api/orders',
    // No protocol_metadata_json -- pure REST entity.
  };

  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [restInterface],
    endpointsByInterface: { 'iface-rest-1': [restEndpoint] },
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-rest-1'] });

  expect(res.status).toBe(200);
  expect(res.body.operationCount).toBe(1);

  expect(operationsCreated).toHaveLength(1);
  const op = operationsCreated[0].body;

  // Entity-level name flows through unchanged (no soap_action override).
  expect(op.summary).toBe('createOrder');
  expect(op.operation_id).toBe('createOrder');
  expect(op.method).toBe('POST');
  expect(op.path).toBe('/api/orders');

  // Description is the entity's own description -- no namespace appended.
  expect(op.description).toBe('Creates a new order');

  // OAS stub is present but carries NO SOAP block and uses the non-SOAP
  // source marker.
  const stub = op.oas_operation_json as Record<string, unknown>;
  expect(stub).toBeDefined();
  expect(stub['x-amvs-soap']).toBeUndefined();
  expect(stub['x-amvs-source']).toBe('discovery-endpoint-candidate');
});

// ---------------------------------------------------------------------------
// Test 3: Partial SOAP fields -- only `soap_action` and `wsdl_source` are
// populated on the endpoint's `protocol_metadata_json`. The Step 4 row must
// render the present keys cleanly and MUST NOT introduce `undefined` /
// `null` string artefacts for the absent ones (mirrors Group 10 Test 3's
// absent-key semantics on the save-back side).
// ---------------------------------------------------------------------------
test('partial SOAP metadata renders only present keys (no undefined string artefacts)', async () => {
  const soapInterface: WireInterface = {
    id: 'iface-soap-partial',
    name: 'PartialService',
    spec_link: null,
    architecture_id: ARCH_ID,
    interface_type: 'SOAP_API',
  };

  const partialEndpoint: Record<string, unknown> = {
    id: 'ep-soap-partial',
    interface_id: 'iface-soap-partial',
    name: 'fallbackName', // soap_action present so will override
    description: null, // no entity description; no namespace either -> null
    operation_verb: 'POST',
    path_or_address: '/svc/partial',
    protocol_metadata_json: {
      soap_action: 'http://example.com/partial/op',
      wsdl_source: 'src/main/resources/wsdl/partial.wsdl',
      // The other five SOAP keys are absent (not null, not empty string).
    },
  };

  const { mock, operationsCreated } = buildArchModelClientMock({
    interfaces: [soapInterface],
    endpointsByInterface: { 'iface-soap-partial': [partialEndpoint] },
  });

  const app = buildApp({ archModelClient: mock as any });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`)
    .send({ interfaceIds: ['iface-soap-partial'] });

  expect(res.status).toBe(200);
  expect(res.body.operationCount).toBe(1);

  expect(operationsCreated).toHaveLength(1);
  const op = operationsCreated[0].body;

  // soap_action drives the operation name column.
  expect(op.summary).toBe('http://example.com/partial/op');
  expect(op.operation_id).toBe('http://example.com/partial/op');

  // No request_namespace -> description stays at the entity's own null.
  // CRITICAL: must NOT be the string 'undefined' or 'null'.
  expect(op.description).toBeNull();

  const stub = op.oas_operation_json as Record<string, unknown>;
  expect(stub).toBeDefined();
  const soapBlock = stub['x-amvs-soap'] as Record<string, string> | undefined;
  expect(soapBlock).toBeDefined();

  // ONLY soap_action and wsdl_source are in the block -- absent keys are
  // absent KEYS, not `undefined` / `null` values.
  const blobKeys = Object.keys(soapBlock!);
  expect(blobKeys).toHaveLength(2);
  expect(blobKeys).toContain('soap_action');
  expect(blobKeys).toContain('wsdl_source');
  expect(blobKeys).not.toContain('request_root_element');
  expect(blobKeys).not.toContain('request_namespace');
  expect(blobKeys).not.toContain('response_root_element');
  expect(blobKeys).not.toContain('request_dto_class');
  expect(blobKeys).not.toContain('response_dto_class');

  // Sanity-check the actual values too.
  expect(soapBlock!.soap_action).toBe('http://example.com/partial/op');
  expect(soapBlock!.wsdl_source).toBe('src/main/resources/wsdl/partial.wsdl');

  // No stray 'undefined' strings appearing as values anywhere in the row.
  const opJson = JSON.stringify(op);
  expect(opJson).not.toContain('"undefined"');
  expect(opJson).not.toMatch(/"description":\s*"undefined"/);
});
