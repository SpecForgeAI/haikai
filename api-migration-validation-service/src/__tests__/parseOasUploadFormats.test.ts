/**
 * Contract-format acceptance tests for the `/parse-oas` multipart upload path.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Groups 1-3 (+ tests Group 4).
 *
 * The wizard step-1 source upload used to accept ONLY a single `.json` OAS file
 * (parsed with a hardcoded `JSON.parse`). This suite pins the extended
 * acceptance surface:
 *
 *   (a) YAML OAS upload                  -> operations parsed (method + path).
 *   (b) WADL + sibling XSD upload         -> REST operations with method + path
 *                                            AND request/response schemas
 *                                            populated from the XSD field-walk.
 *   (c) WADL with an UNRESOLVED grammar   -> a clear 400 naming the missing XSD.
 *   (d) `.wsdl` / SOAP-content upload     -> the "SOAP not supported yet" 400.
 *   (e) lone `.xsd` (no WADL)             -> the "upload the WADL too" 400.
 *
 * Each operation that parses is persisted via `createOperation`; we assert on
 * the captured `request_schema_json` / `response_schema_json` so the test also
 * proves the XSD-derived JSON Schema reaches the persisted operation row (the
 * same column the LLM reads via `get_oas_operation_detail` before combining it
 * with Sybase-sampled rows).
 *
 * Harness mirrors `captureSessionActions.soapPrepop.test.ts`: an in-memory
 * Express app over `buildCaptureSessionActionsRouter`, a captured AMS surface,
 * and `supertest` `.attach(...)` for the multipart parts.
 */

import express from 'express';
import request from 'supertest';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { oasInventoryStore } from '../services/oasInventoryStore';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'test-upload-formats-session',
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

function buildArchModelClientMock(session = buildSession()) {
  const operationsCreated: Array<{ projectId: string; body: any }> = [];
  const mock = {
    getCaptureSession: jest.fn(async () => session),
    listInterfacesForArchitecture: jest.fn(async () => []),
    listEndpointsForInterface: jest.fn(async () => []),
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
    patchCaptureSession: jest.fn(
      async (projectId: string, sessionId: string, body: any) =>
        ({ ...session, ...body, id: sessionId, project_id: projectId }) as CaptureSessionDto,
    ),
    createCaptureSession: jest.fn(),
    listCaptureSessionsByStatus: jest.fn(async () => []),
    listAllCaptureSessionsByStatus: jest.fn(async () => []),
    createScenario: jest.fn(),
    createCapture: jest.fn(),
    createDiagnostic: jest.fn(),
    createBaseline: jest.fn(),
    createBaselineItem: jest.fn(),
  };
  return { mock, operationsCreated };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

const PARSE_URL = `/api/capture-sessions/${SESSION_ID}/parse-oas?projectId=${PROJECT_ID}`;

beforeEach(() => {
  secretsStore.clearAll();
  oasInventoryStore.clearAll();
  if (runManager.has(SESSION_ID)) runManager.end(SESSION_ID);
});

// ---------------------------------------------------------------------------
// (a) YAML OAS upload -> operations
// ---------------------------------------------------------------------------
const YAML_OAS = `openapi: 3.0.0
info:
  title: HiFi YAML Sample
  version: 2.1.0
paths:
  /widgets:
    get:
      operationId: listWidgets
      summary: List widgets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: string
  /widgets/{id}:
    post:
      operationId: createWidget
      summary: Create a widget
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
      responses:
        '201':
          description: created
`;

test('(a) YAML OAS upload parses into operations with method + path', async () => {
  const { mock, operationsCreated } = buildArchModelClientMock();
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(PARSE_URL)
    .attach('file', Buffer.from(YAML_OAS, 'utf8'), 'hifi.yaml');

  expect(res.status).toBe(200);
  expect(res.body.title).toBe('HiFi YAML Sample');
  expect(res.body.version).toBe('2.1.0');
  expect(res.body.operationCount).toBe(2);

  const byOpId = new Map(operationsCreated.map((o) => [o.body.operation_id, o.body]));
  const list = byOpId.get('listWidgets');
  expect(list).toBeDefined();
  expect(list.method).toBe('GET');
  expect(list.path).toBe('/widgets');

  const create = byOpId.get('createWidget');
  expect(create).toBeDefined();
  expect(create.method).toBe('POST');
  expect(create.path).toBe('/widgets/{id}');
  // The YAML request body schema reached the persisted operation row.
  expect(create.request_schema_json).toMatchObject({ type: 'object' });
  expect(create.request_schema_json.required).toContain('name');
});

// ---------------------------------------------------------------------------
// (b) WADL + sibling XSD -> typed REST operations
// ---------------------------------------------------------------------------
const HIFI_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://hifi.example.com/types"
           targetNamespace="http://hifi.example.com/types"
           elementFormDefault="qualified">
  <xs:element name="createOrderRequest" type="tns:OrderRequest"/>
  <xs:element name="createOrderResponse" type="tns:OrderResponse"/>
  <xs:complexType name="OrderRequest">
    <xs:sequence>
      <xs:element name="customerId" type="xs:string"/>
      <xs:element name="quantity" type="xs:int"/>
      <xs:element name="note" type="xs:string" minOccurs="0"/>
      <xs:element name="priority" minOccurs="0">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:enumeration value="LOW"/>
            <xs:enumeration value="HIGH"/>
          </xs:restriction>
        </xs:simpleType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="OrderResponse">
    <xs:sequence>
      <xs:element name="orderId" type="xs:string"/>
      <xs:element name="accepted" type="xs:boolean"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
`;

const HIFI_WADL = `<?xml version="1.0" encoding="UTF-8"?>
<application xmlns="http://wadl.dev.java.net/2009/02"
             xmlns:tns="http://hifi.example.com/types">
  <doc title="HiFi Orders API" version="3.0.0"/>
  <grammars>
    <include href="hifi-types.xsd"/>
  </grammars>
  <resources base="https://api.hifi.example.com/">
    <resource path="/orders">
      <method name="POST" id="createOrder">
        <doc>Create an order</doc>
        <request>
          <representation mediaType="application/json" element="tns:createOrderRequest"/>
        </request>
        <response>
          <representation mediaType="application/json" element="tns:createOrderResponse"/>
        </response>
      </method>
    </resource>
    <resource path="/orders/{orderId}">
      <param name="orderId" style="template" type="xs:string" required="true"/>
      <method name="GET" id="getOrder">
        <doc>Fetch an order</doc>
        <response>
          <representation mediaType="application/json" element="tns:createOrderResponse"/>
        </response>
      </method>
    </resource>
  </resources>
</application>
`;

test('(b) WADL + XSD upload yields REST operations with method/path AND XSD-derived request/response schemas', async () => {
  const { mock, operationsCreated } = buildArchModelClientMock();
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(PARSE_URL)
    .attach('file', Buffer.from(HIFI_WADL, 'utf8'), 'hifi.wadl')
    .attach('file', Buffer.from(HIFI_XSD, 'utf8'), 'hifi-types.xsd');

  expect(res.status).toBe(200);
  expect(res.body.title).toBe('HiFi Orders API');
  expect(res.body.version).toBe('3.0.0');
  expect(res.body.operationCount).toBe(2);

  const byOpId = new Map(operationsCreated.map((o) => [o.body.operation_id, o.body]));

  // --- POST /orders -> createOrder ---
  const createOrder = byOpId.get('createOrder');
  expect(createOrder).toBeDefined();
  expect(createOrder.method).toBe('POST');
  expect(createOrder.path).toBe('/orders');

  // Request schema field-walked from the XSD complex type behind the element.
  const reqSchema = createOrder.request_schema_json;
  expect(reqSchema).toMatchObject({ type: 'object' });
  expect(reqSchema.properties.customerId).toMatchObject({ type: 'string' });
  expect(reqSchema.properties.quantity).toMatchObject({ type: 'integer' });
  // `minOccurs=0` optional fields are NOT in `required`; mandatory ones are.
  expect(reqSchema.required).toContain('customerId');
  expect(reqSchema.required).toContain('quantity');
  expect(reqSchema.required).not.toContain('note');
  // The inline-restricted `priority` field carries its enum.
  expect(reqSchema.properties.priority.enum).toEqual(['LOW', 'HIGH']);

  // Response schema field-walked too.
  const respSchema = createOrder.response_schema_json;
  expect(respSchema).toMatchObject({ type: 'object' });
  expect(respSchema.properties.orderId).toMatchObject({ type: 'string' });
  expect(respSchema.properties.accepted).toMatchObject({ type: 'boolean' });

  // --- GET /orders/{orderId} -> getOrder ---
  const getOrder = byOpId.get('getOrder');
  expect(getOrder).toBeDefined();
  expect(getOrder.method).toBe('GET');
  expect(getOrder.path).toBe('/orders/{orderId}');
  // GET has no request body element -> null request schema; response present.
  expect(getOrder.request_schema_json).toBeNull();
  expect(getOrder.response_schema_json).toMatchObject({ type: 'object' });
});

// ---------------------------------------------------------------------------
// (c) WADL with an unresolved grammar -> the missingGrammars 400
// ---------------------------------------------------------------------------
test('(c) WADL whose grammar XSD was NOT uploaded returns a 400 naming the missing grammar', async () => {
  const { mock, operationsCreated } = buildArchModelClientMock();
  const app = buildApp({ archModelClient: mock as any });

  // Upload the WADL ONLY -- omit hifi-types.xsd.
  const res = await request(app)
    .post(PARSE_URL)
    .attach('file', Buffer.from(HIFI_WADL, 'utf8'), 'hifi.wadl');

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('WADL_MISSING_GRAMMARS');
  expect(res.body.error.message).toContain('hifi-types.xsd');
  expect(res.body.error.missingGrammars).toContain('hifi-types.xsd');
  // No operations were persisted on the guard path.
  expect(operationsCreated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// (d) WSDL / SOAP content -> "not supported yet" 400
// ---------------------------------------------------------------------------
const SOAP_WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                  targetNamespace="http://hifi.example.com/soap">
  <wsdl:portType name="OrdersPort">
    <wsdl:operation name="createOrder"/>
  </wsdl:portType>
</wsdl:definitions>
`;

test('(d) WSDL/SOAP upload returns the clear "SOAP not supported yet" 400', async () => {
  const { mock, operationsCreated } = buildArchModelClientMock();
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(PARSE_URL)
    .attach('file', Buffer.from(SOAP_WSDL, 'utf8'), 'orders.wsdl');

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('SOAP_NOT_SUPPORTED');
  expect(res.body.error.message).toContain("SOAP/WSDL services aren't supported");
  expect(res.body.error.message).toContain('WADL+XSD');
  expect(operationsCreated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// (e) lone XSD (no WADL) -> "upload the WADL too" 400
// ---------------------------------------------------------------------------
test('(e) a lone XSD upload (no WADL) returns the friendly "upload the WADL too" 400', async () => {
  const { mock, operationsCreated } = buildArchModelClientMock();
  const app = buildApp({ archModelClient: mock as any });

  const res = await request(app)
    .post(PARSE_URL)
    .attach('file', Buffer.from(HIFI_XSD, 'utf8'), 'hifi-types.xsd');

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('XSD_WITHOUT_WADL');
  expect(res.body.error.message).toContain('upload the WADL too');
  expect(operationsCreated).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// (f) spec-link WADL path: an Interface whose `spec_link` ends `.wadl` is
//     fetched from the discovery cached clone together with its sibling XSD
//     grammar, then adapted to typed REST operations.
//     (spec 2026-06-03, Task Group 3 -- spec-link path)
// ---------------------------------------------------------------------------
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../services/discoveryServiceClient';

const RUN_ID = '00000000-0000-0000-0000-0000000000dd';

/**
 * Build a discovery-service client stub serving a repoPath -> content map.
 * Unmapped paths return `{ kind: 'not_found' }`.
 */
function buildDiscoveryStub(files: Record<string, string>): DiscoveryServiceClient & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async fetchSourceFile(args: {
      projectId: string;
      architectureId: string;
      runId: string;
      repoPath: string;
    }): Promise<FetchSourceResult> {
      calls.push(args.repoPath);
      const content = files[args.repoPath];
      if (content == null) return { kind: 'not_found' };
      return { kind: 'ok', content };
    },
  };
}

test('(f) WADL spec_link is fetched with its sibling XSD from the cached clone and adapted to REST operations', async () => {
  const wadlPath = 'src/main/resources/hifi.wadl';
  // The WADL's grammar href is relative (`hifi-types.xsd`) -> resolves to the
  // sibling repo path next to the WADL.
  const xsdPath = 'src/main/resources/hifi-types.xsd';

  const iface = {
    id: 'iface-wadl-1',
    name: 'HiFi Orders (WADL)',
    spec_link: wadlPath,
    architecture_id: ARCH_ID,
  };

  const session = buildSession();
  const { mock, operationsCreated } = buildArchModelClientMock(session);
  mock.listInterfacesForArchitecture = jest.fn(async () => [iface]) as any;

  const discoveryServiceClient = buildDiscoveryStub({
    [wadlPath]: HIFI_WADL,
    [xsdPath]: HIFI_XSD,
  });

  const app = buildApp({ archModelClient: mock as any, discoveryServiceClient });

  const res = await request(app)
    .post(PARSE_URL)
    .send({
      interfaceIds: ['iface-wadl-1'],
      architectureId: ARCH_ID,
      discoveryRunId: RUN_ID,
    });

  expect(res.status).toBe(200);
  expect(res.body.operationCount).toBe(2);

  // The WADL + the resolved sibling XSD were both fetched from the clone.
  expect(discoveryServiceClient.calls).toContain(wadlPath);
  expect(discoveryServiceClient.calls).toContain(xsdPath);

  const byOpId = new Map(operationsCreated.map((o) => [o.body.operation_id, o.body]));
  const createOrder = byOpId.get('createOrder');
  expect(createOrder).toBeDefined();
  expect(createOrder.method).toBe('POST');
  expect(createOrder.path).toBe('/orders');
  // Request schema field-walked from the XSD fetched alongside the WADL.
  expect(createOrder.request_schema_json).toMatchObject({ type: 'object' });
  expect(createOrder.request_schema_json.properties.customerId).toMatchObject({
    type: 'string',
  });
});

test('(f2) WADL spec_link whose grammar XSD is missing from the clone returns the missing-grammar 400', async () => {
  const wadlPath = 'src/main/resources/hifi.wadl';

  const iface = {
    id: 'iface-wadl-2',
    name: 'HiFi Orders (WADL, no grammar)',
    spec_link: wadlPath,
    architecture_id: ARCH_ID,
  };

  const session = buildSession();
  const { mock, operationsCreated } = buildArchModelClientMock(session);
  mock.listInterfacesForArchitecture = jest.fn(async () => [iface]) as any;

  // Only the WADL is in the clone -- the XSD grammar is absent.
  const discoveryServiceClient = buildDiscoveryStub({ [wadlPath]: HIFI_WADL });

  const app = buildApp({ archModelClient: mock as any, discoveryServiceClient });

  const res = await request(app)
    .post(PARSE_URL)
    .send({
      interfaceIds: ['iface-wadl-2'],
      architectureId: ARCH_ID,
      discoveryRunId: RUN_ID,
    });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('WADL_MISSING_GRAMMARS');
  expect(res.body.error.missingGrammars).toContain('hifi-types.xsd');
  expect(operationsCreated).toHaveLength(0);
});
