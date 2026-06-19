/**
 * Focused unit tests for the Phase-2 capture-time OAS enrichment from AMS
 * `request_contract.param_formats[]` code evidence.
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 6
 * (R1 = iii; R3 provenance; fix #1 date format).
 *
 * Phase-2 goal: a code-scanned `param_formats[]` entry OVERRIDES the matching
 * OAS param's `schema.pattern`/`schema.format` -- beating a misleading WADL/XSD
 * `xsd:date` (typed as `format: 'date'` -> ISO) so the capture LLM sees the real
 * `dd-MMM-yyyy` on its first request. The override is provenance-tagged
 * `x-amvs-source: code-scan` at the param schema level (R3); where the scan is
 * silent for a param the contract value stands (precedence: code > contract);
 * an unresolvable body-field format is skipped without throwing (fail-soft).
 *
 * Scope (NOT exhaustive param-location permutations):
 *   (a) a `param_formats` entry overrides a query param's misleading
 *       `xsd:date`/`format:'date'` schema with `pattern: 'dd-MMM-yyyy'`,
 *       provenance-tagged at the param schema level.
 *   (b) a param NOT in `param_formats` is left untouched and UNMARKED.
 *   (c) a body-field format overrides the requestBody schema property's
 *       format/pattern; an UNRESOLVABLE body field is a graceful no-op.
 *   (d) the override is visible via the same `extractOasParams` read site the
 *       orchestrator uses (`oasOperation.parameters[].schema`).
 */

import { enrichInventoryWithRequestContracts } from '../services/requestContractEnrichment';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import type { OpenAPIV3 } from 'openapi-types';

function buildOp(
  overrides: Omit<Partial<ParsedOasOperation>, 'oasOperation'> & {
    oasOperation?: Record<string, unknown>;
  } = {},
): ParsedOasOperation {
  const oasOperation = (overrides.oasOperation ?? {
    operationId: overrides.operationId ?? 'op',
    responses: {},
  }) as unknown as OpenAPIV3.OperationObject;
  return {
    operationId: overrides.operationId ?? 'op',
    method: overrides.method ?? 'get',
    path: overrides.path ?? '/views',
    summary: overrides.summary ?? null,
    description: overrides.description ?? null,
    requestSchema: overrides.requestSchema ?? null,
    responseSchema: overrides.responseSchema ?? null,
    oasOperation,
  };
}

function buildInventory(ops: ParsedOasOperation[]): ParsedOasInventory {
  return { operations: ops, title: 'T', version: '1.0.0' };
}

/**
 * The orchestrator's `extractOasParams` reads `oasOperation.parameters[].schema`
 * (`captureSessionOrchestrator.ts:909-931`). We mirror that read shape here so
 * the test asserts the SAME projection the orchestrator + the LLM-facing
 * `get_oas_operation_detail` see (it returns `op.oasOperation` wholesale).
 */
function readParamSchemas(
  oasOperation: Record<string, unknown>,
): Array<{ name: string; in: string; pattern?: unknown; format?: unknown; source?: unknown }> {
  const raw = oasOperation.parameters;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => {
      const schema = (p.schema ?? {}) as Record<string, unknown>;
      return {
        name: String(p.name),
        in: String(p.in),
        pattern: schema.pattern,
        format: schema.format,
        source: schema['x-amvs-source'],
      };
    });
}

describe('enrichInventoryWithRequestContracts -- param_formats override (a)', () => {
  it('overrides a query param misleading xsd:date (format:date) with the scanned dd-MMM-yyyy pattern, provenance-tagged at the schema level', () => {
    // The contract types businessDate as an ISO date -- the misleading
    // WADL/XSD xsd:date the LLM would otherwise trust.
    const op = buildOp({
      operationId: 'listViews',
      method: 'get',
      path: '/views',
      oasOperation: {
        operationId: 'listViews',
        parameters: [
          {
            name: 'businessDate',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
          },
        ],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);

    const endpoints = [
      {
        operation_verb: 'GET',
        path_or_address: '/views',
        request_contract: {
          schema_version: 'request_contract.v1',
          param_formats: [
            {
              name: 'businessDate',
              location: 'query',
              format: 'dd-MMM-yyyy',
              pattern: 'dd-MMM-yyyy',
              source: 'DateTimeFormat',
            },
          ],
        },
      },
    ];

    const out = enrichInventoryWithRequestContracts(inventory, endpoints);
    expect(out).toBe(inventory);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const params = oasOp.parameters as Array<Record<string, unknown>>;
    const bd = params.find((p) => p.name === 'businessDate')!;
    const schema = bd.schema as Record<string, unknown>;
    // pattern is preferred and present -> overrides; the misleading ISO
    // `format: 'date'` is replaced with the concrete code-scanned format.
    expect(schema.pattern).toBe('dd-MMM-yyyy');
    expect(schema.format).toBe('dd-MMM-yyyy');
    // Param-schema-level provenance stamp.
    expect(schema['x-amvs-source']).toBe('code-scan');
    // Operation-level stamp also present because something was overridden.
    expect(oasOp['x-amvs-source']).toBe('code-scan');
  });

  it('synthesises a schema for a param when the contract carried none, so the format still reaches the LLM', () => {
    const op = buildOp({
      operationId: 'listViews',
      method: 'get',
      path: '/views',
      oasOperation: {
        operationId: 'listViews',
        parameters: [{ name: 'asOf', in: 'query', required: true }],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'GET',
        path_or_address: '/views',
        request_contract: {
          param_formats: [{ name: 'asOf', location: 'query', format: 'dd-MMM-yyyy', pattern: 'dd-MMM-yyyy' }],
        },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const schemas = readParamSchemas(op.oasOperation as unknown as Record<string, unknown>);
    const asOf = schemas.find((s) => s.name === 'asOf')!;
    expect(asOf.pattern).toBe('dd-MMM-yyyy');
    expect(asOf.source).toBe('code-scan');
  });
});

describe('enrichInventoryWithRequestContracts -- param silent in scan untouched (b)', () => {
  it('leaves a param NOT present in param_formats untouched and UNMARKED (contract stands where code is silent)', () => {
    const op = buildOp({
      operationId: 'listViews',
      method: 'get',
      path: '/views',
      oasOperation: {
        operationId: 'listViews',
        parameters: [
          { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          // No param_formats entry for `region` -> the contract value stands.
          { name: 'region', in: 'query', required: false, schema: { type: 'string', enum: ['EU', 'US'] } },
        ],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'GET',
        path_or_address: '/views',
        request_contract: {
          param_formats: [{ name: 'businessDate', location: 'query', format: 'dd-MMM-yyyy', pattern: 'dd-MMM-yyyy' }],
        },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const params = oasOp.parameters as Array<Record<string, unknown>>;
    const region = params.find((p) => p.name === 'region')!;
    const regionSchema = region.schema as Record<string, unknown>;
    // Untouched: enum preserved, no format/pattern added, UNMARKED.
    expect(regionSchema.enum).toEqual(['EU', 'US']);
    expect(regionSchema.pattern).toBeUndefined();
    expect(regionSchema.format).toBeUndefined();
    expect(regionSchema['x-amvs-source']).toBeUndefined();
    // The overridden businessDate IS marked (sanity that the loop ran).
    const bd = params.find((p) => p.name === 'businessDate')!;
    expect((bd.schema as Record<string, unknown>)['x-amvs-source']).toBe('code-scan');
  });
});

describe('enrichInventoryWithRequestContracts -- body-field formats + fail-soft (c)', () => {
  it('overrides a requestBody schema property format/pattern for a location:body entry', () => {
    const op = buildOp({
      operationId: 'createOrder',
      method: 'post',
      path: '/orders',
      oasOperation: {
        operationId: 'createOrder',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tradeDate: { type: 'string', format: 'date' },
                  amount: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/orders',
        request_contract: {
          param_formats: [{ name: 'tradeDate', location: 'body', format: 'dd-MMM-yyyy', pattern: 'dd-MMM-yyyy' }],
        },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const content = (oasOp.requestBody as { content: Record<string, unknown> }).content;
    const schema = (content['application/json'] as { schema: Record<string, unknown> }).schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.tradeDate.pattern).toBe('dd-MMM-yyyy');
    expect(props.tradeDate.format).toBe('dd-MMM-yyyy');
    expect(props.tradeDate['x-amvs-source']).toBe('code-scan');
    // The sibling `amount` property is untouched.
    expect(props.amount.pattern).toBeUndefined();
    expect(props.amount['x-amvs-source']).toBeUndefined();
    expect(oasOp['x-amvs-source']).toBe('code-scan');
  });

  it('is a graceful no-op (no throw, no mark) when a body-field format is unresolvable', () => {
    // No requestBody at all on the operation -> a body-field entry cannot be
    // resolved; the helper must skip it without throwing.
    const op = buildOp({
      operationId: 'createOrder',
      method: 'post',
      path: '/orders',
      oasOperation: { operationId: 'createOrder', responses: {} },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/orders',
        request_contract: {
          param_formats: [{ name: 'tradeDate', location: 'body', format: 'dd-MMM-yyyy', pattern: 'dd-MMM-yyyy' }],
        },
      },
    ];

    expect(() => enrichInventoryWithRequestContracts(inventory, endpoints)).not.toThrow();

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    // Nothing resolvable -> no requestBody synthesised, no provenance mark.
    expect(oasOp.requestBody).toBeUndefined();
    expect(oasOp['x-amvs-source']).toBeUndefined();
  });
});

describe('enrichInventoryWithRequestContracts -- visible via extractOasParams read shape (d)', () => {
  it('exposes the dd-MMM-yyyy override on oasOperation.parameters[].schema (the extractOasParams / get_oas_operation_detail read site)', () => {
    const op = buildOp({
      operationId: 'listViews',
      method: 'get',
      path: '/views/{id}',
      oasOperation: {
        operationId: 'listViews',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'GET',
        path_or_address: '/views/{id}',
        request_contract: {
          param_formats: [
            // location null -> name-only match still finds the query param.
            { name: 'businessDate', location: null, format: 'dd-MMM-yyyy', pattern: 'dd-MMM-yyyy' },
          ],
        },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const schemas = readParamSchemas(op.oasOperation as unknown as Record<string, unknown>);
    const bd = schemas.find((s) => s.name === 'businessDate')!;
    expect(bd.pattern).toBe('dd-MMM-yyyy');
    expect(bd.source).toBe('code-scan');
    // The path `id` param carries no format override and stays unmarked.
    const id = schemas.find((s) => s.name === 'id')!;
    expect(id.pattern).toBeUndefined();
    expect(id.source).toBeUndefined();
  });
});
