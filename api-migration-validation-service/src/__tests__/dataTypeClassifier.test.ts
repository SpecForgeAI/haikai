/**
 * Data-type classifier + `data-type-defaults-preview` endpoint tests.
 *
 * Spec: 2026-06-20 Capture data-type format defaults -- Task Group 2,
 * sub-task 2.1. Focused on the load-bearing classification + seed behaviours.
 *
 * Test inventory:
 *   1. Signal precedence -- code-annotation format wins over the OAS
 *      type+format (a field whose contract says ISO `date` but whose code
 *      annotation says `dd-MMM-yyyy HH:mm` classifies + seeds from the code).
 *   2. Signal precedence -- OAS type+format wins over pattern + name (a field
 *      with a misleading name but a concrete OAS `format` classifies by format).
 *   3. Signal precedence -- pattern wins over name (a UUID-regex pattern beats
 *      a name that says "id").
 *   4. Signal precedence -- param-name is the LAST resort (a name-only field
 *      with no format/type evidence classifies by its name, and a misleading
 *      name NEVER overrides real format evidence -- covered by #1/#2).
 *   5. date vs datetime -- decided by the presence of a time component.
 *   6. numeric_id vs string_id -- the split is kept (integer id vs string id).
 *   7. Col-4 seed precedence -- code > contract > standard guess (three cases).
 *   8. Empty -- no classifiable data types discovered yields empty rows, both
 *      from the pure classifier and through the preview endpoint (the
 *      auto-skip signal).
 *   9. Preview endpoint -- classifies code + contract evidence into rows with
 *      the snake_case wire shape, contributing-fields transparency, and only
 *      discovered categories.
 */

import express from 'express';
import request from 'supertest';
import {
  classifyDataTypes,
  extractContractFieldFormats,
  type ClassifyInput,
} from '../services/dataTypeClassifier';
import { buildCaptureSessionActionsRouter } from '../routes/captureSessionActions';
import type { CaptureSessionDto, OperationDto } from '../services/archModelClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';

/** Build an AMS endpoint row carrying a `request_contract.param_formats[]`. */
function endpointWithParamFormats(
  paramFormats: Array<{ name: string; location?: string; format?: string; pattern?: string }>,
): Record<string, unknown> {
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    operation_verb: 'GET',
    path_or_address: '/things',
    request_contract: {
      param_formats: paramFormats.map((p) => ({
        name: p.name,
        location: p.location ?? 'query',
        format: p.format ?? null,
        pattern: p.pattern ?? null,
        source: '@DateTimeFormat',
      })),
    },
  };
}

/** Build a contract OAS operation with the given parameters. */
function oasOpWithParams(
  params: Array<{
    name: string;
    in?: string;
    type?: string;
    format?: string;
    pattern?: string;
    enum?: unknown[];
  }>,
): unknown {
  return {
    operationId: 'op',
    parameters: params.map((p) => ({
      name: p.name,
      in: p.in ?? 'query',
      schema: {
        ...(p.type ? { type: p.type } : {}),
        ...(p.format ? { format: p.format } : {}),
        ...(p.pattern ? { pattern: p.pattern } : {}),
        ...(p.enum ? { enum: p.enum } : {}),
      },
    })),
    responses: {},
  };
}

function classify(input: Partial<ClassifyInput>): ReturnType<typeof classifyDataTypes> {
  return classifyDataTypes({
    endpoints: input.endpoints ?? [],
    oasOperations: input.oasOperations ?? [],
  });
}

function rowFor(
  rows: ReturnType<typeof classifyDataTypes>,
  category: string,
): ReturnType<typeof classifyDataTypes>[number] | undefined {
  return rows.find((r) => r.category === category);
}

// ---------------------------------------------------------------------------
// 1. Signal precedence: code-annotation format > OAS type+format
// ---------------------------------------------------------------------------
test('code-annotation format outranks the OAS type+format (and seeds from code)', () => {
  // SAME field name on both sides: the contract calls it an ISO `date`, but the
  // code annotation pins `dd-MMM-yyyy HH:mm` (a datetime). The code evidence
  // must win classification (-> datetime) AND seed Col-4 (-> the code format).
  const endpoints = [endpointWithParamFormats([{ name: 'createdOn', pattern: 'dd-MMM-yyyy HH:mm' }])];
  const oasOperations = [oasOpWithParams([{ name: 'createdOn', type: 'string', format: 'date' }])];

  const rows = classify({ endpoints, oasOperations });

  // The code field classified as datetime (date + time components present).
  const datetime = rowFor(rows, 'datetime');
  expect(datetime).toBeDefined();
  expect(datetime!.codeFormats).toContain('dd-MMM-yyyy HH:mm');
  // Seed is the CODE format, not the contract's ISO date (chain (a) pos 1).
  expect(datetime!.defaultFormat).toBe('dd-MMM-yyyy HH:mm');

  // The contract side of the SAME field classified its ISO `date` as a `date`
  // row (a separate category) -- proving the contract evidence is still read,
  // just outranked for the code field's own category/seed.
  const date = rowFor(rows, 'date');
  expect(date).toBeDefined();
  expect(date!.contractFormats).toContain('date');
});

// ---------------------------------------------------------------------------
// 2. Signal precedence: OAS type+format > pattern + name
// ---------------------------------------------------------------------------
test('OAS type+format outranks pattern and a misleading param-name', () => {
  // Name says "amount" (decimal hint) but the contract types it as a `uuid`
  // format -- the format evidence (signal 2) must win over the name (signal 4).
  const oasOperations = [
    oasOpWithParams([{ name: 'amountToken', type: 'string', format: 'uuid' }]),
  ];

  const rows = classify({ oasOperations });

  expect(rowFor(rows, 'uuid')).toBeDefined();
  // The misleading "amount" name did NOT produce a decimal row.
  expect(rowFor(rows, 'decimal')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 3. Signal precedence: pattern > name
// ---------------------------------------------------------------------------
test('a UUID-shaped pattern outranks a name that says "id"', () => {
  // Name "recordId" (would be string_id by name alone) but the pattern is a
  // canonical UUID regex -> the pattern (signal 3) wins -> uuid, not string_id.
  const oasOperations = [
    oasOpWithParams([
      {
        name: 'recordId',
        type: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      },
    ]),
  ];

  const rows = classify({ oasOperations });

  expect(rowFor(rows, 'uuid')).toBeDefined();
  expect(rowFor(rows, 'string_id')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 4. Signal precedence: param-name is the LAST resort (used only when nothing
//    stronger resolves a category).
// ---------------------------------------------------------------------------
test('param-name hint is used only as the last resort', () => {
  // A field with NO type / format / pattern, only a name. The name "orderDate"
  // is the only signal -> it classifies as a date.
  const oasOperations = [oasOpWithParams([{ name: 'orderDate' }])];

  const rows = classify({ oasOperations });

  expect(rowFor(rows, 'date')).toBeDefined();

  // And a totally vague name with no other evidence yields NO row (we only
  // surface categories we have positive evidence for).
  const vague = classify({ oasOperations: [oasOpWithParams([{ name: 'note', type: 'string' }])] });
  expect(vague).toEqual([]);
});

// ---------------------------------------------------------------------------
// 5. date vs datetime -- decided by the presence of a time component.
// ---------------------------------------------------------------------------
test('date vs datetime is split by the presence of a time component', () => {
  const rows = classify({
    oasOperations: [
      oasOpWithParams([
        { name: 'effectiveDate', type: 'string', format: 'date' }, // no time -> date
        { name: 'updatedAt', type: 'string', format: 'date-time' }, // time -> datetime
      ]),
    ],
  });

  expect(rowFor(rows, 'date')).toBeDefined();
  expect(rowFor(rows, 'datetime')).toBeDefined();

  // And a code pattern carrying an HH:mm time classifies as datetime even with
  // a date component present.
  const codeRows = classify({
    endpoints: [endpointWithParamFormats([{ name: 'ts', pattern: 'yyyy-MM-dd HH:mm:ss' }])],
  });
  expect(rowFor(codeRows, 'datetime')).toBeDefined();
  expect(rowFor(codeRows, 'date')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 6. numeric_id vs string_id -- the split is kept.
// ---------------------------------------------------------------------------
test('numeric_id vs string_id split is kept', () => {
  const rows = classify({
    oasOperations: [
      oasOpWithParams([
        { name: 'customerId', in: 'path', type: 'integer', format: 'int64' }, // numeric
        { name: 'externalId', in: 'path', type: 'string' }, // string id by name
      ]),
    ],
  });

  expect(rowFor(rows, 'numeric_id')).toBeDefined();
  expect(rowFor(rows, 'string_id')).toBeDefined();
});

// ---------------------------------------------------------------------------
// 7. Col-4 seed precedence -- code > contract > standard guess.
// ---------------------------------------------------------------------------
test('Col-4 seed follows code > contract > standard guess', () => {
  // (a) code present -> code wins.
  const codeWins = classify({
    endpoints: [endpointWithParamFormats([{ name: 'd1', pattern: 'dd/MM/yyyy' }])],
    oasOperations: [oasOpWithParams([{ name: 'd1', type: 'string', format: 'date' }])],
  });
  expect(rowFor(codeWins, 'date')!.defaultFormat).toBe('dd/MM/yyyy');

  // (b) only contract -> contract value seeds.
  const contractOnly = classify({
    oasOperations: [oasOpWithParams([{ name: 'd2', type: 'string', format: 'date' }])],
  });
  // The contract concrete format label is `date` (the OAS `format`).
  expect(rowFor(contractOnly, 'date')!.defaultFormat).toBe('date');

  // (c) neither concrete -> falls to the per-category standard guess (ISO 8601
  // for dates). A name-only date field has no concrete code/contract format.
  const guess = classify({ oasOperations: [oasOpWithParams([{ name: 'someDate' }])] });
  expect(rowFor(guess, 'date')!.defaultFormat).toBe('yyyy-MM-dd');
});

// ---------------------------------------------------------------------------
// 8. Empty -- no classifiable data types -> empty rows.
// ---------------------------------------------------------------------------
test('no classifiable data types yields empty rows', () => {
  // Pure classifier with no evidence at all.
  expect(classify({})).toEqual([]);

  // Evidence present but nothing classifiable (a plain string field, no format).
  expect(classify({ oasOperations: [oasOpWithParams([{ name: 'label', type: 'string' }])] })).toEqual(
    [],
  );
});

// ---------------------------------------------------------------------------
// 8b. Contract TYPE fallback (bug fix 2026-06-22): a classified field whose
//     contract declared only a `type` (no `format`/`pattern`) now shows that
//     TYPE as its Col-3 contract-format label, instead of rendering an em-dash.
//     This is the DISPLAY label only -- the Col-4 seed is covered in 8c.
// ---------------------------------------------------------------------------
test('contract type-only classified field shows its TYPE as the contract-format label', () => {
  // `customerId`: classifies as numeric_id from `type: integer` (no format). The
  // contract-format column now carries the declared type token `integer`.
  const numericRows = classify({
    oasOperations: [oasOpWithParams([{ name: 'customerId', in: 'path', type: 'integer' }])],
  });
  const numericId = rowFor(numericRows, 'numeric_id');
  expect(numericId).toBeDefined();
  expect(numericId!.contractFormats).toContain('integer');
  // Transparency: the contributing field carries the same display label.
  expect(numericId!.contributingFields).toEqual([
    { name: 'customerId', location: 'path', codeFormat: null, contractFormat: 'integer' },
  ]);

  // A date field whose contract is merely `type: string` (no format) still
  // CLASSIFIES via its name hint, and Col-3 now shows the declared type `string`.
  const dateRows = classify({
    oasOperations: [oasOpWithParams([{ name: 'orderDate', type: 'string' }])],
  });
  const date = rowFor(dateRows, 'date');
  expect(date).toBeDefined();
  expect(date!.contractFormats).toContain('string');

  // GUARD (unchanged): a bare `type: string` field with NO id/date name hint
  // still does NOT classify -- no positive signal -> no row at all.
  expect(classify({ oasOperations: [oasOpWithParams([{ name: 'label', type: 'string' }])] })).toEqual(
    [],
  );
});

// ---------------------------------------------------------------------------
// 8c. SEED/DISPLAY split (bug fix 2026-06-22): the Col-3 type fallback must NOT
//     leak into the Col-4 SEED. A date field whose contract is only `type:
//     string` shows `string` in Col-3 but its SEED falls through to the
//     per-category standard guess (`yyyy-MM-dd`), never the bare type `string`.
//     A date field WITH a real `format: date` still seeds from that format.
// ---------------------------------------------------------------------------
test('the contract TYPE fallback is display-only and never seeds Col-4 with a bare type', () => {
  // type-only date: Col-3 shows `string`, but the SEED is the standard date
  // guess -- the type fallback must not become the seeded default.
  const typeOnly = classify({
    oasOperations: [oasOpWithParams([{ name: 'orderDate', type: 'string' }])],
  });
  const typeOnlyDate = rowFor(typeOnly, 'date');
  expect(typeOnlyDate).toBeDefined();
  expect(typeOnlyDate!.contractFormats).toContain('string');
  // Seed is the standard guess, NOT 'string'.
  expect(typeOnlyDate!.defaultFormat).toBe('yyyy-MM-dd');
  expect(typeOnlyDate!.defaultFormat).not.toBe('string');

  // A real `format: date` still seeds from that format (unchanged behaviour).
  const withFormat = classify({
    oasOperations: [oasOpWithParams([{ name: 'orderDate', type: 'string', format: 'date' }])],
  });
  const withFormatDate = rowFor(withFormat, 'date');
  expect(withFormatDate).toBeDefined();
  expect(withFormatDate!.contractFormats).toContain('date');
  expect(withFormatDate!.defaultFormat).toBe('date');
});

// ---------------------------------------------------------------------------
// extractContractFieldFormats: covers requestBody body-property projection.
// ---------------------------------------------------------------------------
test('contract extraction covers requestBody schema properties (body location)', () => {
  const op = {
    operationId: 'create',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              startDate: { type: 'string', format: 'date' },
              status: { type: 'string', enum: ['A', 'B'] },
            },
          },
        },
      },
    },
    responses: {},
  };

  const fields = extractContractFieldFormats(op);
  const start = fields.find((f) => f.name === 'startDate');
  const status = fields.find((f) => f.name === 'status');
  expect(start).toMatchObject({ name: 'startDate', location: 'body', format: 'date' });
  expect(status).toMatchObject({ name: 'status', location: 'body', hasEnum: true });

  // And classified: startDate -> date (body), status -> enum.
  const rows = classify({ oasOperations: [op] });
  expect(rowFor(rows, 'date')).toBeDefined();
  expect(rowFor(rows, 'enum')).toBeDefined();
});

// ---------------------------------------------------------------------------
// Preview endpoint tests
// ---------------------------------------------------------------------------

function buildSession(overrides: Partial<CaptureSessionDto> = {}): CaptureSessionDto {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: 'test-session',
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

function buildOperationDto(oasOperationJson: unknown): OperationDto {
  const now = new Date().toISOString();
  return {
    id: 'op-1',
    session_id: SESSION_ID,
    operation_id: 'op',
    method: 'GET',
    path: '/things',
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: oasOperationJson,
    created_at: now,
    updated_at: now,
  };
}

function buildArchModelClientMock(opts: {
  endpoints?: Array<Record<string, unknown>>;
  operations?: OperationDto[];
}) {
  return {
    getCaptureSession: jest.fn(async () => buildSession()),
    listEndpointsForArchitecture: jest.fn(async () => opts.endpoints ?? []),
    listOperationsBySession: jest.fn(async () => opts.operations ?? []),
  };
}

function buildApp(deps: Parameters<typeof buildCaptureSessionActionsRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(buildCaptureSessionActionsRouter(deps));
  return app;
}

// ---------------------------------------------------------------------------
// 9. Preview endpoint: classifies code + contract into the snake_case wire
//    shape, with contributing fields and only discovered categories.
// ---------------------------------------------------------------------------
test('preview endpoint classifies code + contract evidence into rows', async () => {
  const mock = buildArchModelClientMock({
    endpoints: [endpointWithParamFormats([{ name: 'createdOn', pattern: 'dd-MMM-yyyy' }])],
    operations: [
      buildOperationDto(oasOpWithParams([{ name: 'customerId', in: 'path', type: 'integer' }])),
    ],
  });

  const app = buildApp({ archModelClient: mock as never });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/data-type-defaults-preview?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.sessionId).toBe(SESSION_ID);
  expect(mock.listEndpointsForArchitecture).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);
  expect(mock.listOperationsBySession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID);

  const rows: Array<Record<string, unknown>> = res.body.rows;
  const date = rows.find((r) => r.category === 'date');
  const numericId = rows.find((r) => r.category === 'numeric_id');

  // Code-derived date row carries the code format + the seeded default, in the
  // snake_case wire shape, with the contributing field for transparency.
  expect(date).toBeDefined();
  expect(date!.code_formats).toContain('dd-MMM-yyyy');
  expect(date!.default_format).toBe('dd-MMM-yyyy');
  expect(date!.contributing_fields).toEqual([
    { name: 'createdOn', location: 'query', code_format: 'dd-MMM-yyyy', contract_format: null },
  ]);

  // Contract-derived numeric_id row from the integer path param. The param
  // declared only `type: integer` (no explicit `format`), so Col-3 now shows the
  // declared TYPE as the contract-format label instead of an em-dash.
  expect(numericId).toBeDefined();
  expect(numericId!.contract_formats).toContain('integer');

  // ONLY discovered categories -- never an empty one (e.g. no boolean row).
  expect(rows.find((r) => r.category === 'boolean')).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 10. Preview endpoint: no classifiable data types -> empty rows (auto-skip).
// ---------------------------------------------------------------------------
test('preview endpoint returns empty rows when nothing is classifiable', async () => {
  const mock = buildArchModelClientMock({
    endpoints: [],
    operations: [buildOperationDto(oasOpWithParams([{ name: 'label', type: 'string' }]))],
  });

  const app = buildApp({ archModelClient: mock as never });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/data-type-defaults-preview?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.rows).toEqual([]);
});

// ===========================================================================
// TG7 strategic gap-fill (spec 2026-06-20) -- preview-endpoint integration over
// the REAL classifier. The existing endpoint tests (#9/#10) put code + contract
// on DIFFERENT fields; these three exercise the headline seams through the HTTP
// boundary: (11) code + contract on the SAME field -> code wins seed + BOTH
// evidence columns populated on one row; (12) fail-soft when the endpoints load
// throws -> still 200 with contract-classified rows (never 500 the wizard);
// (13) contract-only seed (chain (a) position 2) through the endpoint.
// ===========================================================================

// ---------------------------------------------------------------------------
// 11. Preview endpoint: code + contract evidence on the SAME field name -> the
//     row carries BOTH Col-2 (code) and Col-3 (contract) formats, the seed is
//     the CODE format (chain (a) pos 1 through the real HTTP path), and both
//     contributing-field rows surface for transparency.
// ---------------------------------------------------------------------------
test('preview endpoint: code + contract on the same field seeds Col-4 from code and shows both evidence columns', async () => {
  // SAME field "effectiveOn" on both sides: the contract declares an ISO
  // `date`, the code annotation pins `dd-MMM-yyyy`. Code must win the seed; the
  // date row must carry the code format in Col-2 and the contract label in Col-3.
  const mock = buildArchModelClientMock({
    endpoints: [endpointWithParamFormats([{ name: 'effectiveOn', pattern: 'dd-MMM-yyyy' }])],
    operations: [
      buildOperationDto(oasOpWithParams([{ name: 'effectiveOn', type: 'string', format: 'date' }])),
    ],
  });

  const app = buildApp({ archModelClient: mock as never });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/data-type-defaults-preview?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  const rows: Array<Record<string, unknown>> = res.body.rows;
  const date = rows.find((r) => r.category === 'date');
  expect(date).toBeDefined();

  // Both evidence columns populated on the one row.
  expect(date!.code_formats).toContain('dd-MMM-yyyy');
  expect(date!.contract_formats).toContain('date');
  // Seed = the CODE format, NOT the contract ISO date (code > contract > guess).
  expect(date!.default_format).toBe('dd-MMM-yyyy');

  // Transparency lists BOTH contributing fields (one code-side, one contract-side).
  const contributing = date!.contributing_fields as Array<Record<string, unknown>>;
  expect(contributing).toEqual(
    expect.arrayContaining([
      { name: 'effectiveOn', location: 'query', code_format: 'dd-MMM-yyyy', contract_format: null },
      { name: 'effectiveOn', location: 'query', code_format: null, contract_format: 'date' },
    ]),
  );
});

// ---------------------------------------------------------------------------
// 12. Preview endpoint FAIL-SOFT: when the endpoints (code) load throws, the
//     handler downgrades that side to empty and STILL returns 200 with the
//     contract-classified rows -- it must never 500 and block the wizard.
// ---------------------------------------------------------------------------
test('preview endpoint is fail-soft when the endpoints load throws (still 200 with contract rows)', async () => {
  const mock = buildArchModelClientMock({
    operations: [
      buildOperationDto(oasOpWithParams([{ name: 'orderDate', type: 'string', format: 'date' }])),
    ],
  });
  // Make ONLY the code-evidence load fail; contract evidence is intact.
  mock.listEndpointsForArchitecture = jest.fn(async () => {
    throw new Error('AMS endpoints unavailable');
  });

  const app = buildApp({ archModelClient: mock as never });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/data-type-defaults-preview?projectId=${PROJECT_ID}`)
    .send({});

  // Did NOT 500 -- the wizard is never blocked by a half-available AMS.
  expect(res.status).toBe(200);
  const rows: Array<Record<string, unknown>> = res.body.rows;
  const date = rows.find((r) => r.category === 'date');
  expect(date).toBeDefined();
  // No code evidence (that side failed) but the contract row is intact + seeded
  // from the contract (chain (a) pos 2 -- the only concrete evidence present).
  expect(date!.code_formats).toEqual([]);
  expect(date!.contract_formats).toContain('date');
  expect(date!.default_format).toBe('date');
});

// ---------------------------------------------------------------------------
// 13. Preview endpoint: contract-only field seeds Col-4 from the contract
//     (chain (a) position 2) through the real HTTP path -- the seed is NOT the
//     per-category standard guess when a concrete contract format exists.
// ---------------------------------------------------------------------------
test('preview endpoint seeds Col-4 from the contract when only contract evidence exists', async () => {
  const mock = buildArchModelClientMock({
    endpoints: [],
    operations: [
      buildOperationDto(oasOpWithParams([{ name: 'bornAt', type: 'string', format: 'date-time' }])),
    ],
  });

  const app = buildApp({ archModelClient: mock as never });
  const res = await request(app)
    .post(`/api/capture-sessions/${SESSION_ID}/data-type-defaults-preview?projectId=${PROJECT_ID}`)
    .send({});

  expect(res.status).toBe(200);
  const rows: Array<Record<string, unknown>> = res.body.rows;
  const datetime = rows.find((r) => r.category === 'datetime');
  expect(datetime).toBeDefined();
  expect(datetime!.code_formats).toEqual([]);
  // Seed is the contract format label, NOT the datetime standard guess.
  expect(datetime!.default_format).toBe('date-time');
});
