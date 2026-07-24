/**
 * Per-format capture expansion (Spec 2026-07-24).
 *
 * Pins: ONE architecture endpoint declaring 2 media types → TWO format-variant
 * operations (each steered); guards (already-split routes, ambiguous matches,
 * single-format endpoints) leave operations untouched; Java MediaType
 * constants translate to real wire media types.
 */
import {
  normaliseMediaType,
  endpointDeclaredFormats,
  expandInventoryOperationsForFormats,
} from '../services/captureFormatExpansion';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';

function op(operationId: string, method: string, path: string): ParsedOasOperation {
  return {
    operationId,
    method: method.toLowerCase() as ParsedOasOperation['method'],
    path,
    summary: `${operationId} summary`,
    description: null,
    requestSchema: null,
    responseSchema: null,
    oasOperation: { operationId, responses: {} } as never,
  };
}

function inv(operations: ParsedOasOperation[]): ParsedOasInventory {
  return { operations, title: 'T', version: '1' };
}

const DUAL_NAME =
  'POST /hierarchynodes/{grdOrgId} ' +
  '[consumes=APPLICATION_JSON,APPLICATION_XML;produces=APPLICATION_JSON,APPLICATION_XML]';

describe('normaliseMediaType', () => {
  it('translates Java MediaType constants (with or without class prefix)', () => {
    expect(normaliseMediaType('APPLICATION_JSON')).toBe('application/json');
    expect(normaliseMediaType('MediaType.APPLICATION_XML')).toBe('application/xml');
    expect(normaliseMediaType('application/JSON')).toBe('application/json');
    expect(normaliseMediaType('unknown_constant')).toBeNull();
    expect(normaliseMediaType(null)).toBeNull();
  });
});

describe('endpointDeclaredFormats', () => {
  it('parses + normalises the name-suffix declaration', () => {
    expect(endpointDeclaredFormats(DUAL_NAME)).toEqual({
      consumes: ['application/json', 'application/xml'],
      produces: ['application/json', 'application/xml'],
    });
  });

  it('plain names declare nothing', () => {
    expect(endpointDeclaredFormats('GET /things')).toEqual({ consumes: [], produces: [] });
  });
});

describe('expandInventoryOperationsForFormats', () => {
  const dualEndpoint = {
    name: DUAL_NAME,
    operation_verb: 'POST',
    path_or_address: '/hierarchynodes/{grd_org_id}', // param NAME differs — positional identity
  };

  it('ONE dual-format endpoint → TWO steered variant operations', () => {
    const out = expandInventoryOperationsForFormats(
      inv([op('getHierarchyForOrgId', 'POST', '/hierarchynodes/{grdOrgId}')]),
      [dualEndpoint],
    );
    expect(out.operations.map((o) => o.operationId)).toEqual([
      'getHierarchyForOrgId [format=application/json]',
      'getHierarchyForOrgId [format=application/xml]',
    ]);
    const xml = out.operations[1].oasOperation as unknown as Record<string, unknown>;
    expect(xml['x-amvs-content']).toEqual({
      consumes: ['application/xml'],
      produces: ['application/xml'],
    });
    expect(xml.requestBody).toEqual({ content: { 'application/xml': {} } });
    expect(xml['x-amvs-format-of']).toBe('getHierarchyForOrgId');
  });

  it('single-format endpoints and unmatched routes pass through untouched', () => {
    const single = { name: 'GET /things [produces=APPLICATION_JSON]', operation_verb: 'GET', path_or_address: '/things' };
    const ops = [op('getThings', 'GET', '/things'), op('other', 'GET', '/other')];
    const out = expandInventoryOperationsForFormats(inv(ops), [single]);
    expect(out.operations).toEqual(ops);
  });

  it('GUARD: a route the spec already splits (2 ops) is never multiplied', () => {
    const ops = [
      op('opJson', 'POST', '/hierarchynodes/{grdOrgId}'),
      op('opXml', 'POST', '/hierarchynodes/{grdOrgId}'),
    ];
    const out = expandInventoryOperationsForFormats(inv(ops), [dualEndpoint]);
    expect(out.operations).toEqual(ops);
  });

  it('GUARD: ambiguous endpoint matches (2 rows on the route) → untouched', () => {
    const out = expandInventoryOperationsForFormats(
      inv([op('x', 'POST', '/hierarchynodes/{grdOrgId}')]),
      [dualEndpoint, { ...dualEndpoint }],
    );
    expect(out.operations.map((o) => o.operationId)).toEqual(['x']);
  });
});
