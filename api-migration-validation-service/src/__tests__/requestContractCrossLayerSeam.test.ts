/**
 * CROSS-LAYER SEAM tests for the "Request Contract from Code Evidence" spec
 * (2026-06-19) -- Task Group 7.
 *
 * Task Groups 1-6 each unit-test ONE layer against a HAND-WRITTEN `request_contract`
 * blob. None of them prove that the blob the discovery SCANNER emits is the exact
 * shape the amvs ENRICHMENT consumes and the EXECUTOR reads. Those seams are
 * loosely-typed (`Record<string, unknown>`), so a single key drift (e.g.
 * `param_formats` vs `paramFormats`, `content_type` vs `contentType`, the literal
 * `location: 'body'`) would pass every layer's own unit test yet silently break
 * the end-to-end #1/#3 fixes. THIS file pins that seam.
 *
 * The fixture blobs below are the EXACT shape the discovery
 * `requestContractScanner.RequestContract` interface emits (snake_case keys,
 * internal `schema_version`, boxed `confidence`, `provenance: 'code-scan'` +
 * `provenance_detail`, `param_formats[].location: 'body'|'query'|'path'`). The
 * scanner output rides verbatim through the mcp-server save-back (TG2), is stored
 * as AMS `endpoints.request_contract` JSONB (TG1, snake_case wire), and arrives at
 * `enrichInventoryWithRequestContracts` as a row off
 * `archModelClient.listEndpointsForArchitecture` (`operation_verb` +
 * `path_or_address` + `request_contract`). We feed that real row shape in and
 * assert the override reaches BOTH downstream read sites:
 *   - the executor Content-Type seam (`resolveOperationContentType` reads
 *     `oasOperation.requestBody.content` -- the first media-type key);
 *   - the LLM-facing param-format seam (`extractOasParams` /
 *     `get_oas_operation_detail` read `oasOperation.parameters[].schema`).
 *
 * Invariants asserted (this spec only, NOT whole-app coverage):
 *   (e) #1 end-to-end-ish: a `@JsonFormat(pattern="dd-MMM-yyyy")` request-field /
 *       `@DateTimeFormat` param fact -- as the scanner blob -- reaches the LLM as
 *       `pattern: 'dd-MMM-yyyy'`, beating the contract's misleading `format:'date'`.
 *   (a) code-evidence OVERRIDES the contract content-type, tagged `code-scan`.
 *   (d) the enriched content-type is exactly the value the executor's
 *       `resolveOperationContentType` reads (the seam the #3 default consumes).
 *   (b)/(c) the contract value + the runtime accepted-value lever (`schema.enum`)
 *       stand untouched where the scan is silent (no regression to runtime reuse).
 *   (f) no regression: a row carrying NO `request_contract` (the additive /
 *       absent-key save-back outcome for a fact-less endpoint, and the A/B/C/D
 *       endpoints) leaves the contract OAS untouched and UNMARKED.
 */

import { enrichInventoryWithRequestContracts } from '../services/requestContractEnrichment';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';
import type { OpenAPIV3 } from 'openapi-types';

// ---------------------------------------------------------------------------
// Seam fixture: the EXACT scanner-emitted `RequestContract` shape (discovery
// `requestContractScanner.ts` -> AMS JSONB -> the `listEndpointsForArchitecture`
// row). Field names here are load-bearing -- they ARE the seam contract.
// ---------------------------------------------------------------------------

/**
 * A complete scanner blob for `POST /views/run`, mirroring the discovery
 * `requestContractScanner` `RequestContract` interface 1:1: a request-body
 * `@JsonFormat` field (`location: 'body'`), a content-type off `consumes`, a
 * required header, request validation, the boxed confidence, the internal
 * schema_version, and `provenance: 'code-scan'` + `provenance_detail`.
 */
const SCANNER_BLOB_POST = {
  schema_version: 'request_contract.v1',
  content_type: 'application/json',
  consumes: ['application/json'],
  required_headers: [{ name: 'X-Api-Version', source: 'mapping-header' }],
  params: [],
  param_formats: [
    {
      name: 'businessDate',
      location: 'body',
      format: 'dd-MMM-yyyy',
      pattern: 'dd-MMM-yyyy',
      source: '@JsonFormat',
    },
  ],
  request_validation: [
    { field: 'businessDate', constraint: '@NotNull', failure_status: 400, message: 'businessDate is required' },
  ],
  provenance: 'code-scan',
  provenance_detail: {
    source_files: ['ViewController.java', 'ViewRequest.java'],
    method_id: 'com.foo.web.ViewController#run(ViewRequest)',
  },
  confidence: 0.9,
};

/**
 * A query-param `@DateTimeFormat(pattern=)` blob for `GET /views`, again the
 * exact scanner shape (`param_formats[].location: 'query'`, no content-type).
 */
const SCANNER_BLOB_GET = {
  schema_version: 'request_contract.v1',
  content_type: null,
  consumes: [],
  required_headers: [],
  params: [{ name: 'region', type: 'String', required: false }],
  param_formats: [
    {
      name: 'businessDate',
      location: 'query',
      format: 'dd-MMM-yyyy',
      pattern: 'dd-MMM-yyyy',
      source: '@DateTimeFormat',
    },
  ],
  request_validation: [],
  provenance: 'code-scan',
  provenance_detail: { source_files: ['ViewController.java'], method_id: null },
  confidence: 0.9,
};

// ---------------------------------------------------------------------------
// Helpers: build the in-memory OAS + the AMS endpoint-row shape, and mirror the
// two real downstream read sites verbatim.
// ---------------------------------------------------------------------------

function buildOp(
  method: string,
  path: string,
  oasOperation: Record<string, unknown>,
): ParsedOasOperation {
  return {
    operationId: String(oasOperation.operationId ?? 'op'),
    method: method as ParsedOasOperation['method'],
    path,
    summary: null,
    description: null,
    requestSchema: null,
    responseSchema: null,
    oasOperation: oasOperation as unknown as OpenAPIV3.OperationObject,
  };
}

function buildInventory(ops: ParsedOasOperation[]): ParsedOasInventory {
  return { operations: ops, title: 'T', version: '1.0.0' };
}

/**
 * Build the row shape `archModelClient.listEndpointsForArchitecture` returns
 * (the AMS `EndpointDto`): snake_case `operation_verb` / `path_or_address` /
 * `request_contract`. This is exactly what `captureSessionActions.ts:1730-1734`
 * hands to `enrichInventoryWithRequestContracts`.
 */
function amsEndpointRow(
  verb: string,
  path: string,
  requestContract: Record<string, unknown> | null,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    operation_verb: verb,
    path_or_address: path,
  };
  if (requestContract !== null) row.request_contract = requestContract;
  return row;
}

/**
 * Mirror of the executor's `resolveOperationContentType`
 * (`execute_http_request.ts:109-129`): the FIRST `requestBody.content` media-type
 * key. This is the value the #3 Content-Type default uses. We replicate it here
 * (rather than import the private fn) so the seam between enrichment output and
 * executor read is asserted by SHAPE, not by re-running the whole tool.
 */
function executorContentTypeSeam(oasOperation: Record<string, unknown>): string | null {
  const reqBody = (oasOperation as { requestBody?: unknown }).requestBody;
  if (!reqBody || typeof reqBody !== 'object') return null;
  const content = (reqBody as { content?: unknown }).content;
  if (!content || typeof content !== 'object') return null;
  for (const k of Object.keys(content as Record<string, unknown>)) {
    if (typeof k === 'string' && k.trim().length > 0) return k;
  }
  return null;
}

/**
 * Mirror of the orchestrator's `extractOasParams`
 * (`captureSessionOrchestrator.ts:909-931`) read shape + the body-schema
 * property read (`get_oas_operation_detail` returns `oasOperation` wholesale),
 * so the test asserts the SAME projection the LLM ultimately sees.
 */
function llmParamFormat(
  oasOperation: Record<string, unknown>,
  paramName: string,
): { pattern?: unknown; format?: unknown; source?: unknown; enum?: unknown } | null {
  const params = oasOperation.parameters;
  if (Array.isArray(params)) {
    for (const p of params) {
      if (p && typeof p === 'object' && (p as Record<string, unknown>).name === paramName) {
        const schema = ((p as Record<string, unknown>).schema ?? {}) as Record<string, unknown>;
        return { pattern: schema.pattern, format: schema.format, source: schema['x-amvs-source'], enum: schema.enum };
      }
    }
  }
  const reqBody = (oasOperation as { requestBody?: unknown }).requestBody;
  const content = reqBody && typeof reqBody === 'object' ? (reqBody as { content?: unknown }).content : undefined;
  if (content && typeof content === 'object') {
    for (const media of Object.values(content as Record<string, unknown>)) {
      const schema = media && typeof media === 'object' ? (media as { schema?: unknown }).schema : undefined;
      const props = schema && typeof schema === 'object' ? (schema as { properties?: unknown }).properties : undefined;
      if (props && typeof props === 'object') {
        const prop = (props as Record<string, unknown>)[paramName];
        if (prop && typeof prop === 'object') {
          const s = prop as Record<string, unknown>;
          return { pattern: s.pattern, format: s.format, source: s['x-amvs-source'], enum: s.enum };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// (e) + (a) + (d): the scanner blob's content-type + body date-format reach the
// executor seam AND the LLM seam, beating the contract's misleading format:date.
// ---------------------------------------------------------------------------

describe('request_contract cross-layer seam -- scanner blob reaches executor + LLM read sites', () => {
  it('a body @JsonFormat(dd-MMM-yyyy) + content_type, as the scanner blob, override the contract and reach BOTH read seams', () => {
    // The CONTRACT (WADL/XSD/uploaded-OAS) types businessDate as an ISO date and
    // declares an XML body -- both of which the code evidence contradicts.
    const op = buildOp('post', '/views/run', {
      operationId: 'runViews',
      requestBody: {
        content: {
          'application/xml': {
            schema: {
              type: 'object',
              properties: {
                businessDate: { type: 'string', format: 'date' },
                note: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {},
    });
    const inventory = buildInventory([op]);

    // The exact AMS row shape the enrichment is handed at /start.
    const endpoints = [amsEndpointRow('POST', '/views/run', SCANNER_BLOB_POST)];

    const out = enrichInventoryWithRequestContracts(inventory, endpoints);
    expect(out).toBe(inventory); // same reference mutated in place

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;

    // (a)+(d) content-type seam: code-evidence application/json beat the
    // contract application/xml, and it is EXACTLY what the executor reads.
    expect(executorContentTypeSeam(oasOp)).toBe('application/json');
    // operation-level provenance stamp present (something overrode).
    expect(oasOp['x-amvs-source']).toBe('code-scan');

    // (e) #1: the dd-MMM-yyyy body format reaches the LLM read seam, beating
    // the contract's misleading format:'date'. The schema body survived the
    // media-type re-key (note: still present).
    const bd = llmParamFormat(oasOp, 'businessDate')!;
    expect(bd.pattern).toBe('dd-MMM-yyyy');
    expect(bd.format).toBe('dd-MMM-yyyy');
    expect(bd.source).toBe('code-scan');
    const note = llmParamFormat(oasOp, 'note')!;
    expect(note.pattern).toBeUndefined();
    expect(note.source).toBeUndefined();
  });

  it('a query @DateTimeFormat(dd-MMM-yyyy), as the scanner blob, reaches the extractOasParams seam beating xsd:date', () => {
    const op = buildOp('get', '/views', {
      operationId: 'listViews',
      parameters: [
        // Contract: misleading ISO date the LLM would otherwise trust.
        { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
        // A param the scan is SILENT about, carrying a runtime accepted-value
        // lever (enum) -- it MUST survive untouched (b)/(c).
        { name: 'region', in: 'query', required: false, schema: { type: 'string', enum: ['EU', 'US'] } },
      ],
      responses: {},
    });
    const inventory = buildInventory([op]);
    const endpoints = [amsEndpointRow('GET', '/views', SCANNER_BLOB_GET)];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;

    // (e) the dd-MMM-yyyy query format reaches the LLM/extractOasParams seam.
    const bd = llmParamFormat(oasOp, 'businessDate')!;
    expect(bd.pattern).toBe('dd-MMM-yyyy');
    expect(bd.source).toBe('code-scan');

    // (b)+(c) the silent `region` param is untouched: enum (the runtime
    // accepted-value lever) preserved, no format added, UNMARKED.
    const region = llmParamFormat(oasOp, 'region')!;
    expect(region.enum).toEqual(['EU', 'US']);
    expect(region.pattern).toBeUndefined();
    expect(region.format).toBeUndefined();
    expect(region.source).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (f) no-regression: a fact-less endpoint (absent-key save-back outcome) and the
// A/B/C/D endpoints carrying NO request_contract leave the contract OAS untouched.
// ---------------------------------------------------------------------------

describe('request_contract cross-layer seam -- no-regression for rows without a request_contract', () => {
  it('leaves the contract OAS untouched + UNMARKED for endpoint rows that carry no request_contract', () => {
    // Two ops the scan never produced a fact for: e.g. the captured-decisions /
    // selective-copy (A/B/C/D) endpoints. Their AMS rows carry NO request_contract
    // (the absent-key save-back outcome), so enrichment must be a pure no-op.
    const abcd1 = buildOp('post', '/captured-decisions', {
      operationId: 'captureDecision',
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: {},
    });
    const abcd2 = buildOp('put', '/selective-copy/{id}', {
      operationId: 'selectiveCopy',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {},
    });
    const inventory = buildInventory([abcd1, abcd2]);

    const endpoints = [
      // request_contract === null -> ABSENT key on the row (the save-back
      // additive/absent-key outcome for a fact-less endpoint).
      amsEndpointRow('POST', '/captured-decisions', null),
      amsEndpointRow('PUT', '/selective-copy/{id}', null),
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oas1 = abcd1.oasOperation as unknown as Record<string, unknown>;
    const content1 = (oas1.requestBody as { content: Record<string, unknown> }).content;
    expect(Object.keys(content1)).toEqual(['application/json']); // contract media type stands
    expect(oas1['x-amvs-source']).toBeUndefined();

    const oas2 = abcd2.oasOperation as unknown as Record<string, unknown>;
    const idParam = (oas2.parameters as Array<Record<string, unknown>>).find((p) => p.name === 'id')!;
    expect((idParam.schema as Record<string, unknown>).pattern).toBeUndefined();
    expect(oas2['x-amvs-source']).toBeUndefined();
  });
});
