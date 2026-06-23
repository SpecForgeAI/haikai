/**
 * Focused unit tests for the Spring-Classic code-format extraction passthrough +
 * OAS-override regression guard.
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 4
 * (amvs `requestContractEnrichment` `javaType` passthrough + OAS-override no-op
 * guard).
 *
 * The discovery Spring-Classic pack now emits TYPE-ONLY `param_formats[]` entries
 * carrying a `java_type` (the un-annotated Java field/param TYPE) with NO
 * `format`/`pattern`. amvs must:
 *   (a) carry `javaType` through `readRequestContractFacts` and let a type-only
 *       entry SURVIVE the line-154 drop (so it reaches the classifier code path)
 *       PURELY by virtue of `javaType` -- never by populating `format`/`pattern`;
 *   (b) NEVER let a type-only entry override an existing OAS `format: date` /
 *       `pattern` (`applyFormatToSchema` is a no-op without a concrete
 *       `format`/`pattern`) -- the regression vector once type-only entries flow.
 *
 * A concrete-`format`/`pattern` entry STILL overrides exactly as before (no
 * regression); an entry with NONE of format/pattern/javaType is still dropped.
 */

import {
  enrichInventoryWithRequestContracts,
  readRequestContractFacts,
} from '../services/requestContractEnrichment';
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

// ---------------------------------------------------------------------------
// 1. readRequestContractFacts: a javaType-only entry SURVIVES the line-154 drop
//    purely by virtue of `javaType`, and `format`/`pattern` stay null.
// ---------------------------------------------------------------------------
test('readRequestContractFacts carries a type-only entry through (javaType set, format/pattern null)', () => {
  const facts = readRequestContractFacts({
    request_contract: {
      param_formats: [
        // Type-only: a discovery `source: 'java-type'` entry. NO format/pattern.
        { name: 'businessDate', location: 'query', java_type: 'LocalDate', source: 'java-type' },
      ],
    },
  });

  expect(facts).not.toBeNull();
  expect(facts!.paramFormats).toHaveLength(1);
  const pf = facts!.paramFormats[0];
  expect(pf.name).toBe('businessDate');
  expect(pf.javaType).toBe('LocalDate');
  // The type was NEVER stuffed into format/pattern.
  expect(pf.format).toBeNull();
  expect(pf.pattern).toBeNull();
});

// ---------------------------------------------------------------------------
// 2. Snake/camel tolerance: `java_type` AND `javaType` both read.
// ---------------------------------------------------------------------------
test('readRequestContractFacts reads java_type and javaType (snake/camel tolerant)', () => {
  const snake = readRequestContractFacts({
    request_contract: {
      param_formats: [{ name: 'a', location: 'query', java_type: 'BigDecimal' }],
    },
  });
  expect(snake!.paramFormats[0].javaType).toBe('BigDecimal');

  const camel = readRequestContractFacts({
    request_contract: {
      param_formats: [{ name: 'b', location: 'query', javaType: 'UUID' }],
    },
  });
  expect(camel!.paramFormats[0].javaType).toBe('UUID');
});

// ---------------------------------------------------------------------------
// 3. An entry with NONE of format/pattern/javaType is STILL dropped at line 154
//    (nothing to carry).
// ---------------------------------------------------------------------------
test('readRequestContractFacts still drops an entry with no format, no pattern, and no javaType', () => {
  const facts = readRequestContractFacts({
    request_contract: {
      param_formats: [
        { name: 'nothingUseful', location: 'query' }, // no format/pattern/javaType
        { name: 'keep', location: 'query', javaType: 'Long' }, // survives via javaType
      ],
    },
  });
  expect(facts).not.toBeNull();
  expect(facts!.paramFormats.map((p) => p.name)).toEqual(['keep']);
});

// ---------------------------------------------------------------------------
// 4. REGRESSION GUARD (headline): a javaType-only entry reaches the enrichment
//    path but the OAS-override is a NO-OP -- it does NOT overwrite an existing
//    OAS `format: date` with a type token, and does NOT stamp provenance.
// ---------------------------------------------------------------------------
test('a javaType-only entry never overrides an OAS format:date (applyFormatToSchema no-op guard holds)', () => {
  const op = buildOp({
    operationId: 'listViews',
    method: 'get',
    path: '/views',
    oasOperation: {
      operationId: 'listViews',
      parameters: [
        { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
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
        param_formats: [
          // Type-only: NO concrete format/pattern -- just the Java type.
          { name: 'businessDate', location: 'query', java_type: 'LocalDate', source: 'java-type' },
        ],
      },
    },
  ];

  enrichInventoryWithRequestContracts(inventory, endpoints);

  const oasOp = op.oasOperation as unknown as Record<string, unknown>;
  const params = oasOp.parameters as Array<Record<string, unknown>>;
  const bd = params.find((p) => p.name === 'businessDate')!;
  const schema = bd.schema as Record<string, unknown>;
  // The real OAS `format: date` is UNTOUCHED -- a bare type token never wins here.
  expect(schema.format).toBe('date');
  expect(schema.pattern).toBeUndefined();
  // No provenance stamp at the schema OR operation level (nothing overrode).
  expect(schema['x-amvs-source']).toBeUndefined();
  expect(oasOp['x-amvs-source']).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 4b. Same guard for a requestBody PROPERTY: a type-only body entry never
//     overrides a body property's OAS `format: date`.
// ---------------------------------------------------------------------------
test('a javaType-only body entry never overrides a requestBody property format', () => {
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
              properties: { tradeDate: { type: 'string', format: 'date' } },
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
        param_formats: [{ name: 'tradeDate', location: 'body', java_type: 'LocalDate' }],
      },
    },
  ];

  enrichInventoryWithRequestContracts(inventory, endpoints);

  const oasOp = op.oasOperation as unknown as Record<string, unknown>;
  const content = (oasOp.requestBody as { content: Record<string, unknown> }).content;
  const schema = (content['application/json'] as { schema: Record<string, unknown> }).schema;
  const props = schema.properties as Record<string, Record<string, unknown>>;
  // Untouched OAS format; no provenance stamp anywhere.
  expect(props.tradeDate.format).toBe('date');
  expect(props.tradeDate.pattern).toBeUndefined();
  expect(props.tradeDate['x-amvs-source']).toBeUndefined();
  expect(oasOp['x-amvs-source']).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 5. NO REGRESSION: a concrete-format/pattern entry STILL overrides the OAS
//    schema exactly as before (even when it ALSO carries a javaType).
// ---------------------------------------------------------------------------
test('a concrete-format entry still overrides the OAS schema (no regression), even with a javaType present', () => {
  const op = buildOp({
    operationId: 'listViews',
    method: 'get',
    path: '/views',
    oasOperation: {
      operationId: 'listViews',
      parameters: [
        { name: 'businessDate', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
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
        param_formats: [
          // Concrete annotation-derived format AND a uniform javaType field.
          {
            name: 'businessDate',
            location: 'query',
            format: 'dd-MMM-yyyy',
            pattern: 'dd-MMM-yyyy',
            java_type: 'LocalDate',
            source: 'DateTimeFormat',
          },
        ],
      },
    },
  ];

  enrichInventoryWithRequestContracts(inventory, endpoints);

  const oasOp = op.oasOperation as unknown as Record<string, unknown>;
  const params = oasOp.parameters as Array<Record<string, unknown>>;
  const bd = params.find((p) => p.name === 'businessDate')!;
  const schema = bd.schema as Record<string, unknown>;
  // The concrete format still beats the misleading ISO `date` -- unchanged.
  expect(schema.pattern).toBe('dd-MMM-yyyy');
  expect(schema.format).toBe('dd-MMM-yyyy');
  expect(schema['x-amvs-source']).toBe('code-scan');
  expect(oasOp['x-amvs-source']).toBe('code-scan');
});
