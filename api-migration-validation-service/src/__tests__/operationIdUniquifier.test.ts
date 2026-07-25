/**
 * OAS operationId uniquification (2026-07-25 — duplicate-operationId collapse).
 *
 * Pins: an operationId shared by operations on DIFFERENT routes gets a
 * ` [route=...]` suffix on EVERY colliding member (order-independent);
 * unique ids and same-route duplicates are untouched; the suffix fails the
 * reconciliation discriminator grammar (bare-key matching preserved) and
 * composes with per-format expansion (variants inherit unique base ids).
 */
import { uniquifyOperationIds, routeSuffix } from '../services/operationIdUniquifier';
import { expandInventoryOperationsForFormats } from '../services/captureFormatExpansion';
import { restDiscriminator } from '../routes/addOperationSupport';
import type { ParsedOasInventory, ParsedOasOperation } from '../types/oas';

function op(operationId: string, method: string, path: string): ParsedOasOperation {
  return {
    operationId,
    method: method.toLowerCase() as ParsedOasOperation['method'],
    path,
    summary: null,
    description: null,
    requestSchema: null,
    responseSchema: null,
    oasOperation: { operationId, responses: {} } as never,
  };
}

function inv(operations: ParsedOasOperation[]): ParsedOasInventory {
  return { operations, title: 'T', version: '1' };
}

describe('uniquifyOperationIds', () => {
  it('renames EVERY member of a cross-route duplicate group (the HiFi overload shape)', () => {
    const { inventory, renamed } = uniquifyOperationIds(
      inv([
        op('getHierarchyForOrgId', 'POST', '/hierarchynodes/{grdOrgId}'),
        op('getHierarchyForOrgId', 'POST', '/hierarchy/{businessDate}/{grdOrgId}'),
        op('getView', 'GET', '/views/{viewId}'),
        op('getView', 'GET', '/views/{businessDate}/{viewId}'),
        op('listFilters', 'GET', '/filters'),
      ]),
    );
    const ids = inventory.operations.map((o) => o.operationId);
    expect(ids).toEqual([
      'getHierarchyForOrgId [route=POST /hierarchynodes/{grdOrgId}]',
      'getHierarchyForOrgId [route=POST /hierarchy/{businessDate}/{grdOrgId}]',
      'getView [route=GET /views/{viewId}]',
      'getView [route=GET /views/{businessDate}/{viewId}]',
      'listFilters', // unique — untouched
    ]);
    // No two ids collide any more.
    expect(new Set(ids).size).toBe(ids.length);
    // The rename is recorded for the parse-oas log line.
    expect(renamed.get('getView')).toEqual([
      'getView [route=GET /views/{viewId}]',
      'getView [route=GET /views/{businessDate}/{viewId}]',
    ]);
    // The embedded OAS object is kept consistent + traceable.
    const renamedOp = inventory.operations[0];
    expect((renamedOp.oasOperation as { operationId?: string }).operationId).toBe(
      renamedOp.operationId,
    );
    expect(
      (renamedOp.oasOperation as Record<string, unknown>)['x-amvs-renamed-from'],
    ).toBe('getHierarchyForOrgId');
  });

  it('no collisions -> returns the SAME inventory object (no-op)', () => {
    const input = inv([op('a', 'GET', '/a'), op('b', 'GET', '/b')]);
    const { inventory, renamed } = uniquifyOperationIds(input);
    expect(inventory).toBe(input);
    expect(renamed.size).toBe(0);
  });

  it('same-route duplicates are left untouched (renaming cannot distinguish them)', () => {
    const input = inv([op('dup', 'GET', '/same'), op('dup', 'GET', '/same')]);
    const { inventory } = uniquifyOperationIds(input);
    expect(inventory.operations.map((o) => o.operationId)).toEqual(['dup', 'dup']);
  });

  it('the [route=...] suffix fails the discriminator grammar — bare reconciliation keys preserved', () => {
    const renamedId = `getView${routeSuffix({ method: 'get', path: '/views/{businessDate}/{viewId}' })}`;
    expect(restDiscriminator(renamedId)).toBeNull();
    // ... and stays null once expansion appends its own [format=...] suffix.
    expect(restDiscriminator(`${renamedId} [format=application/xml]`)).toBeNull();
  });

  it('composes with per-format expansion: variants inherit unique base ids', () => {
    const { inventory } = uniquifyOperationIds(
      inv([
        op('getView', 'GET', '/views/{viewId}'),
        op('getView', 'GET', '/views/{businessDate}/{viewId}'),
      ]),
    );
    const endpoints = [
      {
        name:
          'GET /views/{businessDate}/{viewId} ' +
          '[consumes=APPLICATION_JSON,APPLICATION_XML;produces=APPLICATION_JSON,APPLICATION_XML]',
        operation_verb: 'GET',
        path_or_address: '/views/{businessDate}/{viewId}',
      },
    ];
    const expanded = expandInventoryOperationsForFormats(inventory, endpoints);
    const ids = expanded.operations.map((o) => o.operationId);
    expect(ids).toContain(
      'getView [route=GET /views/{businessDate}/{viewId}] [format=application/json]',
    );
    expect(ids).toContain(
      'getView [route=GET /views/{businessDate}/{viewId}] [format=application/xml]',
    );
    // The sibling route is single-format — its renamed op is untouched.
    expect(ids).toContain('getView [route=GET /views/{viewId}]');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
