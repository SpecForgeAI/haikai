/**
 * Focused unit tests for the capture-time OAS enrichment from AMS
 * `request_contract` code evidence.
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 3
 * (R1 = iii; R3 provenance; R5 headers are Phase 1).
 *
 * Scope (NOT exhaustive content-type / header-shape permutations):
 *   (a) `request_contract.content_type` OVERRIDES the matching operation's
 *       `requestBody.content` media type, matched by method+path, and the
 *       request body schema survives the re-key.
 *   (b) `required_headers[]` become `in: header, required: true` params on
 *       `oasOperation`, provenance-tagged at the param level.
 *   (c) the override is provenance-tagged `x-amvs-source: code-scan` at the
 *       operation level; a non-overridden (un-mentioned) operation stays
 *       untouched and UNMARKED.
 *   (d) fail-soft -- a malformed endpoint set / unmatched endpoint leaves the
 *       inventory unchanged (the helper is total and never throws).
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
    method: overrides.method ?? 'post',
    path: overrides.path ?? '/things',
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

describe('enrichInventoryWithRequestContracts -- content-type override (a)', () => {
  it('overrides the operation request media type from request_contract.content_type, matched by method+path, preserving the schema', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const op = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: {
        operationId: 'createThing',
        requestBody: { content: { 'application/json': { schema } } },
        responses: {},
      },
    });
    const inventory = buildInventory([op]);

    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/things',
        request_contract: { content_type: 'application/xml', schema_version: 'request_contract.v1' },
      },
    ];

    const out = enrichInventoryWithRequestContracts(inventory, endpoints);

    // Same reference mutated in place.
    expect(out).toBe(inventory);
    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const content = (oasOp.requestBody as { content: Record<string, unknown> }).content;
    expect(Object.keys(content)).toEqual(['application/xml']);
    // The contract schema body survives the media-type re-key.
    expect((content['application/xml'] as { schema?: unknown }).schema).toEqual(schema);
    // Operation-level provenance stamp.
    expect(oasOp['x-amvs-source']).toBe('code-scan');
  });

  it('reads the request media type from consumes[] when content_type is absent', () => {
    const op = buildOp({
      operationId: 'putThing',
      method: 'put',
      path: '/things/{id}',
      oasOperation: { operationId: 'putThing', responses: {} },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'PUT',
        path_or_address: '/things/{id}',
        request_contract: { consumes: ['application/x-www-form-urlencoded'] },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const content = (oasOp.requestBody as { content: Record<string, unknown> }).content;
    expect(Object.keys(content)).toEqual(['application/x-www-form-urlencoded']);
    expect(oasOp['x-amvs-source']).toBe('code-scan');
  });
});

describe('enrichInventoryWithRequestContracts -- required headers (b)', () => {
  it('adds in:header required:true params for each required_header, provenance-tagged at the param level', () => {
    const op = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: {
        operationId: 'createThing',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/things',
        request_contract: {
          required_headers: [
            { name: 'X-Tenant-Id', source: 'controller' },
            'X-Correlation-Id',
          ],
        },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const params = oasOp.parameters as Array<Record<string, unknown>>;
    const headerParams = params.filter((p) => p.in === 'header');
    expect(headerParams.map((p) => p.name).sort()).toEqual(
      ['X-Correlation-Id', 'X-Tenant-Id'],
    );
    for (const hp of headerParams) {
      expect(hp.required).toBe(true);
      expect(hp['x-amvs-source']).toBe('code-scan');
    }
    // The pre-existing path param is untouched and UNMARKED.
    const pathParam = params.find((p) => p.in === 'path');
    expect(pathParam).toBeDefined();
    expect(pathParam!['x-amvs-source']).toBeUndefined();
    // Operation-level stamp present because we added headers.
    expect(oasOp['x-amvs-source']).toBe('code-scan');
  });

  it('does not duplicate a required header already present (case-insensitive)', () => {
    const op = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: {
        operationId: 'createThing',
        parameters: [{ name: 'X-Tenant-Id', in: 'header', required: true, schema: { type: 'string' } }],
        responses: {},
      },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/things',
        request_contract: { required_headers: [{ name: 'x-tenant-id', source: 'controller' }] },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    const params = oasOp.parameters as Array<Record<string, unknown>>;
    const tenantParams = params.filter((p) => String(p.name).toLowerCase() === 'x-tenant-id');
    expect(tenantParams).toHaveLength(1);
    // Nothing was added -> the operation stays UNMARKED.
    expect(oasOp['x-amvs-source']).toBeUndefined();
  });
});

describe('enrichInventoryWithRequestContracts -- un-mentioned ops + provenance (c)', () => {
  it('leaves an operation with no matching endpoint untouched and unmarked', () => {
    const matched = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: { operationId: 'createThing', responses: {} },
    });
    const untouched = buildOp({
      operationId: 'getThing',
      method: 'get',
      path: '/things/{id}',
      oasOperation: {
        operationId: 'getThing',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {},
      },
    });
    const inventory = buildInventory([matched, untouched]);
    const endpoints = [
      {
        operation_verb: 'POST',
        path_or_address: '/things',
        request_contract: { content_type: 'application/xml' },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    // Matched -> overridden + marked.
    const matchedOas = matched.oasOperation as unknown as Record<string, unknown>;
    expect(matchedOas['x-amvs-source']).toBe('code-scan');

    // Un-mentioned GET op -> contract media type untouched, no provenance mark.
    const untouchedOas = untouched.oasOperation as unknown as Record<string, unknown>;
    const content = (untouchedOas.requestBody as { content: Record<string, unknown> }).content;
    expect(Object.keys(content)).toEqual(['application/json']);
    expect(untouchedOas['x-amvs-source']).toBeUndefined();
  });
});

describe('enrichInventoryWithRequestContracts -- fail-soft (d)', () => {
  it('returns the inventory unchanged when the endpoints argument is malformed', () => {
    const op = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: { operationId: 'createThing', responses: {} },
    });
    const inventory = buildInventory([op]);

    // A bogus endpoints shape (simulating a degraded AMS fetch) must not throw.
    const out = enrichInventoryWithRequestContracts(
      inventory,
      [null, 42, 'nope'] as unknown as Array<Record<string, unknown>>,
    );

    expect(out).toBe(inventory);
    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    expect(oasOp.requestBody).toBeUndefined();
    expect(oasOp['x-amvs-source']).toBeUndefined();
  });

  it('is a no-op when no endpoint matches by method+path', () => {
    const op = buildOp({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      oasOperation: { operationId: 'createThing', responses: {} },
    });
    const inventory = buildInventory([op]);
    const endpoints = [
      // method matches but path differs -> no match.
      {
        operation_verb: 'POST',
        path_or_address: '/other',
        request_contract: { content_type: 'application/xml' },
      },
    ];

    enrichInventoryWithRequestContracts(inventory, endpoints);

    const oasOp = op.oasOperation as unknown as Record<string, unknown>;
    expect(oasOp.requestBody).toBeUndefined();
    expect(oasOp['x-amvs-source']).toBeUndefined();
  });
});
