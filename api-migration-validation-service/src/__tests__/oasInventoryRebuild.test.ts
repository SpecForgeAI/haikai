/**
 * `rebuildInventoryFromOperations` tests (2026-08-08 — kills the
 * "Pass B unavailable, re-parse the OAS" dead end after an AMVS restart).
 *
 * Pins: lossless mapping of persisted rows back to the parsed-inventory
 * shape (including the verbatim oas_operation_json with x-amvs extensions),
 * per-field degradation on sparse rows, and the single honest unavailable
 * case (zero rows -> null).
 */

import {
  rebuildInventoryFromOperations,
  REBUILT_INVENTORY_TITLE,
} from '../services/oasInventoryRebuild';
import type { OperationDto } from '../services/archModelClient';

function row(overrides: Partial<OperationDto> = {}): OperationDto {
  return {
    id: 'row-1',
    session_id: 'session-1',
    operation_id: 'getOrder',
    method: 'GET',
    path: '/orders/{orderId}',
    summary: 'Get an order',
    description: 'Reads one order',
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: { type: 'object' },
    oas_operation_json: {
      operationId: 'getOrder',
      'x-amvs-soap': { soap_action: 'GetOrder' },
    },
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
    ...overrides,
  } as OperationDto;
}

describe('rebuildInventoryFromOperations', () => {
  it('maps persisted rows losslessly — schemas, verbatim oas_operation_json (x-amvs intact), lowercased method', () => {
    const inv = rebuildInventoryFromOperations([row()]);
    expect(inv).not.toBeNull();
    expect(inv!.title).toBe(REBUILT_INVENTORY_TITLE);
    const op = inv!.operations[0];
    expect(op.operationId).toBe('getOrder');
    expect(op.method).toBe('get');
    expect(op.path).toBe('/orders/{orderId}');
    expect(op.summary).toBe('Get an order');
    expect(op.responseSchema).toEqual({ type: 'object' });
    expect(op.requestSchema).toBeNull();
    // The SOAP extension block survives — the payload-context tool keeps working.
    expect((op.oasOperation as Record<string, unknown>)['x-amvs-soap']).toEqual({
      soap_action: 'GetOrder',
    });
  });

  it('degrades per-field on sparse rows (missing oas_operation_json -> {}, blank method -> get) — never throws', () => {
    const inv = rebuildInventoryFromOperations([
      row({
        method: '' as unknown as OperationDto['method'],
        oas_operation_json: null as unknown as OperationDto['oas_operation_json'],
        summary: null,
        description: null,
      }),
    ]);
    const op = inv!.operations[0];
    expect(op.method).toBe('get');
    expect(op.oasOperation).toEqual({});
    expect(op.summary).toBeNull();
  });

  it('returns null ONLY for zero rows — the one genuinely unavailable case', () => {
    expect(rebuildInventoryFromOperations([])).toBeNull();
    expect(rebuildInventoryFromOperations([row(), row({ id: 'row-2', operation_id: 'x' })])).not.toBeNull();
  });
});
