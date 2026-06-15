/**
 * OAS Export — deterministic OpenAPI contract generation tests.
 *
 * Direct build 2026-06-11 (oracle weaknesses #5). Covers:
 *   1. `assembleOasDocument` — pure deterministic assembly: schemas from
 *      logical entities (types/required/nullable/pk), paths from endpoints
 *      (operationIds, params, entity-matched request/response bodies),
 *      placeholder server tied to the SERVER_URL_MISSING gap, and the
 *      coverage guarantee (every endpoint mapped or accounted unmapped).
 *   2. `oasExportHandler` — interface listing from the elements inventory,
 *      tool-error unwrapping, and generate-all failure accounting.
 *   3. Route surface — list / generate / zip download (+ empty 404).
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    mcpBaseUrl: 'http://localhost:8090',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockListInterfaces = jest.fn();
const mockGenerateOne = jest.fn();
const mockGenerateAll = jest.fn();
jest.mock('../services/oasExport/oasExportHandler', () => {
  const actual = jest.requireActual('../services/oasExport/oasExportHandler');
  return {
    ...actual,
    listExportableInterfaces: (...args: unknown[]) => mockListInterfaces(...args),
    generateOasForInterface: (...args: unknown[]) => mockGenerateOne(...args),
    generateAllOas: (...args: unknown[]) => mockGenerateAll(...args),
  };
});

import express from 'express';
import request from 'supertest';
import {
  assembleOasDocument,
  OasCoverageError,
  slugifyFilename,
} from '../services/oasExport/assembleOasDocument';
import { InterfaceOasContext, OasGapReport } from '../services/oasExport/types';
import { oasExportRouter } from '../routes/oasExport';
import { listZipEntryPaths } from '../services/dbMigrationPack/zip';

const actualHandler = jest.requireActual('../services/oasExport/oasExportHandler');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(): InterfaceOasContext {
  return {
    interface: {
      id: 'if-1',
      name: 'Customer API',
      description: 'Manages customers.',
      interfaceType: 'REST_API',
      specLink: null,
    },
    service: { id: 'svc-1', name: 'customer-service' },
    application: { id: 'app-1', name: 'CRM' },
    endpoints: [
      {
        id: 'e1',
        name: 'List customers',
        description: null,
        endpointType: 'HTTP_REST',
        pathOrAddress: '/customers',
        protocol: 'HTTPS',
        operationVerb: 'GET',
      },
      {
        id: 'e2',
        name: 'Get customer',
        description: 'Fetch one customer.',
        endpointType: 'HTTP_REST',
        pathOrAddress: '/customers/{customerId}',
        protocol: 'HTTPS',
        operationVerb: 'GET',
      },
      {
        id: 'e3',
        name: 'Create customer',
        description: null,
        endpointType: 'HTTP_REST',
        pathOrAddress: '/customers',
        protocol: 'HTTPS',
        operationVerb: 'POST',
      },
      {
        id: 'e4',
        name: 'Delete customer',
        description: null,
        endpointType: 'HTTP_REST',
        pathOrAddress: '/customers/{customerId}',
        protocol: 'HTTPS',
        operationVerb: 'DELETE',
      },
      {
        id: 'e5',
        name: 'Legacy SOAP op',
        description: null,
        endpointType: 'SOAP',
        pathOrAddress: 'http://legacy/soap',
        protocol: 'HTTP',
        operationVerb: null,
      },
      {
        id: 'e6',
        name: 'Verbless endpoint',
        description: null,
        endpointType: 'HTTP_REST',
        pathOrAddress: '/legacy-things',
        protocol: 'HTTPS',
        operationVerb: null,
      },
    ],
    logicalEntities: [
      {
        id: 'le-1',
        name: 'Customer',
        description: 'A customer record.',
        attributes: [
          {
            id: 'a1',
            name: 'id',
            description: null,
            dataType: 'string_uuid',
            isPrimaryKey: true,
            isNullable: false,
          },
          {
            id: 'a2',
            name: 'name',
            description: 'Full name',
            dataType: 'string',
            isPrimaryKey: false,
            isNullable: false,
          },
          {
            id: 'a3',
            name: 'birthDate',
            description: null,
            dataType: 'string_date',
            isPrimaryKey: false,
            isNullable: true,
          },
          {
            id: 'a4',
            name: 'balance',
            description: null,
            dataType: 'custom_money',
            isPrimaryKey: false,
            isNullable: null,
          },
        ],
      },
    ],
    notes: { basePathCandidates: [], serverUrlCandidates: [] },
  };
}

function makeGapReport(): OasGapReport {
  return {
    interfaceId: 'if-1',
    generatedAt: '2026-06-11T00:00:00.000Z',
    gaps: [
      { code: 'SERVER_URL_MISSING', severity: 'BLOCKING', message: 'm' },
      { code: 'RESPONSES_UNDEFINED', severity: 'BLOCKING', message: 'm' },
      { code: 'PATH_PARAMS_NEED_SCHEMA', severity: 'RECOMMENDED', message: 'm' },
      { code: 'INFO_VERSION_DEFAULTED', severity: 'INFO', message: 'm' },
    ],
    defaults: [
      {
        code: 'DEFAULT_INFO_VERSION',
        value: '1.0.0',
        rationale: 'OpenAPI requires info.version.',
      },
    ],
    typeMappings: [
      { logicalType: 'custom_money', oasSchema: { type: 'string' } },
      { logicalType: 'string', oasSchema: { type: 'string' } },
      { logicalType: 'string_date', oasSchema: { type: 'string', format: 'date' } },
      { logicalType: 'string_uuid', oasSchema: { type: 'string', format: 'uuid' } },
    ],
    operationIds: [
      { endpointId: 'e1', style: 'camelCase', operationId: 'getCustomers' },
      { endpointId: 'e1', style: 'snake_case', operationId: 'get_customers' },
      { endpointId: 'e2', style: 'camelCase', operationId: 'getCustomersByCustomerId' },
      { endpointId: 'e3', style: 'camelCase', operationId: 'postCustomers' },
      { endpointId: 'e4', style: 'camelCase', operationId: 'deleteCustomersByCustomerId' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. assembleOasDocument
// ---------------------------------------------------------------------------

describe('assembleOasDocument', () => {
  test('assembles a deterministic OpenAPI 3.0 document with schemas, paths, and accounted unmapped endpoints', () => {
    const { document, summary } = assembleOasDocument(makeContext(), makeGapReport());

    expect(document.openapi).toBe('3.0.3');
    const info = document.info as Record<string, unknown>;
    expect(info.title).toBe('Customer API');
    expect(info.version).toBe('1.0.0');
    expect(String(info.description)).toContain('customer-service');

    // Placeholder server tied to the SERVER_URL_MISSING gap (no candidates).
    const servers = document.servers as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe('https://server-url-not-specified.invalid');

    // Schema from the logical entity.
    const components = document.components as {
      schemas: Record<string, Record<string, unknown>>;
    };
    const customer = components.schemas.Customer;
    expect(customer.type).toBe('object');
    const props = customer.properties as Record<string, Record<string, unknown>>;
    expect(props.id).toMatchObject({ type: 'string', format: 'uuid', 'x-primary-key': true });
    expect(props.birthDate).toMatchObject({ type: 'string', format: 'date', nullable: true });
    expect(props.balance).toMatchObject({ type: 'string' }); // unknown type → string
    expect(customer.required).toEqual(['id', 'name']);

    // Paths: collection GET → array of matched entity; by-id GET → single $ref.
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    const listOp = paths['/customers'].get;
    expect(listOp.operationId).toBe('getCustomers');
    const listResponses = listOp.responses as Record<string, unknown>;
    const list200 = listResponses['200'] as {
      content: { 'application/json': { schema: Record<string, unknown> } };
    };
    expect(list200.content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Customer' },
    });

    const getOp = paths['/customers/{customerId}'].get;
    expect(getOp.operationId).toBe('getCustomersByCustomerId');
    const getParams = getOp.parameters as Array<Record<string, unknown>>;
    expect(getParams).toHaveLength(1);
    expect(getParams[0]).toMatchObject({ name: 'customerId', in: 'path', required: true });
    const get200 = (getOp.responses as Record<string, { content: Record<string, { schema: unknown }> }>)['200'];
    expect(get200.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Customer',
    });

    // POST: required JSON request body $ref + 201.
    const postOp = paths['/customers'].post;
    const requestBody = postOp.requestBody as {
      required: boolean;
      content: Record<string, { schema: unknown }>;
    };
    expect(requestBody.required).toBe(true);
    expect(requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Customer',
    });
    expect(Object.keys(postOp.responses as object)).toContain('201');

    // DELETE → 204, no content.
    const deleteOp = paths['/customers/{customerId}'].delete;
    const delete204 = (deleteOp.responses as Record<string, Record<string, unknown>>)['204'];
    expect(delete204).toBeDefined();
    expect(delete204.content).toBeUndefined();

    // Coverage: SOAP + verbless endpoints accounted as unmapped, never dropped.
    const unmapped = document['x-haikai-unmapped-endpoints'] as Array<{
      endpointId: string;
      reason: string;
    }>;
    expect(unmapped.map((u) => u.endpointId).sort()).toEqual(['e5', 'e6']);
    expect(unmapped.find((u) => u.endpointId === 'e5')!.reason).toContain('SOAP');
    expect(summary.endpointCount).toBe(6);
    expect(summary.mappedEndpointCount).toBe(4);
    expect(summary.mappedEndpointCount + summary.unmappedEndpoints.length).toBe(6);
    expect(summary.schemaCount).toBe(1);
    expect(summary.gapCounts).toEqual({ blocking: 2, recommended: 1, info: 1 });
  });

  test('is byte-deterministic: identical input produces identical serialized output', () => {
    const a = assembleOasDocument(makeContext(), makeGapReport());
    const b = assembleOasDocument(makeContext(), makeGapReport());
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
  });

  test('uses model-provided server URL candidates (sorted) when present', () => {
    const context = makeContext();
    context.notes = {
      basePathCandidates: [],
      serverUrlCandidates: ['https://b.example.com', 'https://a.example.com'],
    };
    const { document } = assembleOasDocument(context, makeGapReport());
    expect(document.servers).toEqual([
      { url: 'https://a.example.com' },
      { url: 'https://b.example.com' },
    ]);
  });

  test('emits generic gap-annotated schemas when no entity matches the path', () => {
    const context = makeContext();
    context.logicalEntities = []; // no entities → nothing can match
    const { document } = assembleOasDocument(context, makeGapReport());
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    const postOp = paths['/customers'].post;
    const requestSchema = (postOp.requestBody as {
      content: Record<string, { schema: Record<string, unknown> }>;
    }).content['application/json'].schema;
    expect(requestSchema.type).toBe('object');
    expect(String(requestSchema.description)).toContain('REQUEST_BODY_UNDEFINED');
    expect(document.components).toBeUndefined();
  });

  test('duplicate (path, verb) endpoint rows: first wins, second accounted as unmapped', () => {
    const context = makeContext();
    context.endpoints = [
      context.endpoints[0],
      { ...context.endpoints[0], id: 'e1-dup', name: 'Duplicate list' },
    ];
    const { document, summary } = assembleOasDocument(context, makeGapReport());
    expect(summary.mappedEndpointCount).toBe(1);
    expect(summary.unmappedEndpoints).toHaveLength(1);
    expect(summary.unmappedEndpoints[0].endpointId).toBe('e1-dup');
    expect(summary.unmappedEndpoints[0].reason).toContain('Duplicate operation');
    expect(document['x-haikai-unmapped-endpoints']).toHaveLength(1);
  });

  test('slugifyFilename produces safe stable filenames', () => {
    expect(slugifyFilename('Customer API')).toBe('customer-api');
    expect(slugifyFilename('  ***  ')).toBe('interface');
  });
});

// ---------------------------------------------------------------------------
// 2. Handler (real implementation via requireActual + deps injection)
// ---------------------------------------------------------------------------

describe('oasExportHandler', () => {
  const inventory = {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Interfaces',
            entityType: 'interfaces',
            instances: [
              { id: 'if-2', name: 'Order API' },
              { id: 'if-1', name: 'Customer API' },
            ],
          },
          {
            name: 'Services',
            entityType: 'services',
            instances: [{ id: 'svc-1', name: 'customer-service' }],
          },
        ],
      },
    ],
  };

  test('listExportableInterfaces filters to interfaces and sorts by name', async () => {
    const deps = {
      fetchInventory: jest.fn().mockResolvedValue(inventory),
      runTool: jest.fn(),
    };
    const result = await actualHandler.listExportableInterfaces('p1', 'arch1', deps);
    expect(result).toEqual([
      { id: 'if-1', name: 'Customer API' },
      { id: 'if-2', name: 'Order API' },
    ]);
    expect(deps.fetchInventory).toHaveBeenCalledWith('p1', 'arch1');
  });

  test('generateOasForInterface assembles a result from the two mcp tool calls', async () => {
    const runTool = jest
      .fn()
      .mockResolvedValueOnce({ result: makeContext(), status: 200, durationMs: 1 })
      .mockResolvedValueOnce({ result: makeGapReport(), status: 200, durationMs: 1 });
    const deps = { fetchInventory: jest.fn(), runTool };

    const result = await actualHandler.generateOasForInterface('if-1', deps);
    expect(result.interfaceName).toBe('Customer API');
    expect(result.suggestedFilename).toBe('customer-api.openapi.json');
    expect(result.summary.mappedEndpointCount).toBe(4);
    expect(runTool.mock.calls[0][0]).toBe('get_interface_oas_context');
    expect(runTool.mock.calls[1][0]).toBe('compute_oas_gaps');
  });

  test('generateOasForInterface throws OasExportUpstreamError on tool failure', async () => {
    const runTool = jest.fn().mockResolvedValue({
      result: { error: 'Interface not found' },
      status: 404,
      durationMs: 1,
    });
    const deps = { fetchInventory: jest.fn(), runTool };
    await expect(actualHandler.generateOasForInterface('nope', deps)).rejects.toMatchObject({
      name: 'OasExportUpstreamError',
      status: 404,
    });
  });

  test('generateAllOas accounts every interface — failures become error entries, never silent skips', async () => {
    const runTool = jest.fn().mockImplementation(async (_tool, args) => {
      const interfaceId = (args as { interfaceId: string }).interfaceId;
      if (interfaceId === 'if-2') {
        return { result: { error: 'boom' }, status: 502, durationMs: 1 };
      }
      // Both calls for if-1 alternate context/gaps; cheat by tracking tool name.
      return _tool === 'get_interface_oas_context'
        ? { result: makeContext(), status: 200, durationMs: 1 }
        : { result: makeGapReport(), status: 200, durationMs: 1 };
    });
    const deps = {
      fetchInventory: jest.fn().mockResolvedValue(inventory),
      runTool,
    };

    const entries = await actualHandler.generateAllOas('p1', 'arch1', deps);
    expect(entries).toHaveLength(2);
    const ok = entries.find((e: { interfaceId: string }) => e.interfaceId === 'if-1');
    const failed = entries.find((e: { interfaceId: string }) => e.interfaceId === 'if-2');
    expect(ok.result).toBeDefined();
    expect(failed.result).toBeUndefined();
    expect(failed.error).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// 3. Routes
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', oasExportRouter);
  return app;
}

const ROUTE_BASE = '/api/v1/projects/p1/architectures/arch1/oas-export';

describe('oasExport routes', () => {
  beforeEach(() => {
    mockListInterfaces.mockReset();
    mockGenerateOne.mockReset();
    mockGenerateAll.mockReset();
  });

  test('GET /interfaces returns the interface list', async () => {
    mockListInterfaces.mockResolvedValue([{ id: 'if-1', name: 'Customer API' }]);
    const res = await request(createTestApp()).get(`${ROUTE_BASE}/interfaces`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ interfaces: [{ id: 'if-1', name: 'Customer API' }] });
  });

  test('POST /interfaces/:id/generate returns the result and maps upstream errors', async () => {
    const { document, summary } = assembleOasDocument(makeContext(), makeGapReport());
    mockGenerateOne.mockResolvedValue({
      interfaceId: 'if-1',
      interfaceName: 'Customer API',
      suggestedFilename: 'customer-api.openapi.json',
      document,
      gapReport: makeGapReport(),
      summary,
    });
    const ok = await request(createTestApp()).post(
      `${ROUTE_BASE}/interfaces/if-1/generate`
    );
    expect(ok.status).toBe(200);
    expect(ok.body.suggestedFilename).toBe('customer-api.openapi.json');
    expect(ok.body.document.openapi).toBe('3.0.3');

    const upstream = new (actualHandler.OasExportUpstreamError)(404, 'Interface not found');
    mockGenerateOne.mockRejectedValue(upstream);
    const notFound = await request(createTestApp()).post(
      `${ROUTE_BASE}/interfaces/nope/generate`
    );
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.message).toContain('Interface not found');
  });

  test('GET /download streams a zip with manifest + per-interface contract and gap files', async () => {
    const { document, summary } = assembleOasDocument(makeContext(), makeGapReport());
    mockGenerateAll.mockResolvedValue([
      {
        interfaceId: 'if-1',
        interfaceName: 'Customer API',
        result: {
          interfaceId: 'if-1',
          interfaceName: 'Customer API',
          suggestedFilename: 'customer-api.openapi.json',
          document,
          gapReport: makeGapReport(),
          summary,
        },
      },
      { interfaceId: 'if-2', interfaceName: 'Order API', error: 'boom' },
    ]);

    const res = await request(createTestApp())
      .get(`${ROUTE_BASE}/download`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('interface-contracts-arch1.zip');
    const paths = listZipEntryPaths(res.body as Buffer);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('customer-api.openapi.json');
    expect(paths).toContain('customer-api.gaps.json');
    // Failed interface appears in the manifest, not as a file.
    expect(paths.filter((p: string) => p.includes('order-api'))).toHaveLength(0);
  });

  test('GET /download with no interfaces returns 404', async () => {
    mockGenerateAll.mockResolvedValue([]);
    const res = await request(createTestApp()).get(`${ROUTE_BASE}/download`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('no interfaces');
  });
});
