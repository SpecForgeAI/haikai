/**
 * PostmanImportStaging tests
 *
 * Spec 2026-06-23 Import a Postman Collection into Capture -- Task Group 3.1.
 *
 * Focused coverage of the staging table's critical behaviours:
 *
 *   (a) renders per-item resolved method/path + the mapped session operation
 *       (or "no match");
 *   (b) maps an imported item to a session operation by `(method, path)`;
 *   (c) renders the `InventoryReconciliationResponse` VERBATIM (the coverage
 *       figures come straight off the payload, not re-derived);
 *   (d) an item whose mapped operation is in `operations_without_model_endpoint`
 *       is flagged `unmatched`, and an item mapping to no operation is flagged
 *       `no-operation` -- both surfaced (never silently runnable) and emitted to
 *       the parent via `onFlaggedChange` for the Group 4 step;
 *   (e) a matched, supported item is `runnable`.
 *
 * The CSS module is proxied so class names equal their keys (mirrors the
 * BatchResolveConflictsModal test), letting selectors stay testid-based.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./PostmanImportStaging.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { PostmanImportStaging } from './PostmanImportStaging';
import type { StagedImportItem } from './postmanImportStagingSupport';
import type {
  ApiBehaviourOperationDto,
  InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import type { ImportedRequest } from '../../utils/postmanImport';

function imported(
  partial: Partial<ImportedRequest> & Pick<ImportedRequest, 'method' | 'path'>,
): ImportedRequest {
  return {
    query: {},
    headers: {},
    body: null,
    sourceItemName: 'Imported request',
    ...partial,
  };
}

function operation(
  partial: Partial<ApiBehaviourOperationDto> &
    Pick<ApiBehaviourOperationDto, 'id' | 'method' | 'path'>,
): ApiBehaviourOperationDto {
  return {
    session_id: 'session-1',
    operation_id: null,
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
    ...partial,
  };
}

function reconciliation(
  overrides: Partial<InventoryReconciliationResponse> = {},
): InventoryReconciliationResponse {
  return {
    in_scope_unaccounted_endpoints: [],
    operations_without_model_endpoint: [],
    excluded_by_scope_endpoints: [],
    in_scope_coverage_pct: 75,
    in_scope_accounted_count: 3,
    in_scope_total_count: 4,
    architecture_coverage_pct: 60,
    architecture_accounted_count: 3,
    architecture_total_count: 5,
    ...overrides,
  };
}

describe('PostmanImportStaging -- per-item mapping + status', () => {
  it('renders per-item method/path and the mapped operation (or "no match"), keyed by (method, path)', () => {
    const importedRequests = [
      imported({ method: 'GET', path: '/orders', sourceItemName: 'List orders' }),
      imported({ method: 'POST', path: '/unknown', sourceItemName: 'Mystery' }),
    ];
    const operations = [
      operation({ id: 'op-1', method: 'GET', path: '/orders' }),
    ];

    render(
      <PostmanImportStaging
        importedRequests={importedRequests}
        operations={operations}
        reconciliation={reconciliation()}
      />,
    );

    // (a) resolved method/path render verbatim.
    const row0 = screen.getByTestId('postman-import-staging-item-0');
    expect(row0.textContent).toContain('GET');
    expect(row0.textContent).toContain('/orders');
    expect(row0.textContent).toContain('List orders');

    // (b) item 0 maps to the matching operation by (method, path).
    expect(
      screen.getByTestId('postman-import-staging-item-0-operation').textContent,
    ).toContain('/orders');

    // item 1 maps to NO operation -> explicit "no match".
    expect(
      screen.getByTestId('postman-import-staging-item-1-no-match').textContent,
    ).toContain('no match');
  });

  it('renders the reconciliation payload VERBATIM (coverage figures not re-derived)', () => {
    render(
      <PostmanImportStaging
        importedRequests={[imported({ method: 'GET', path: '/orders' })]}
        operations={[operation({ id: 'op-1', method: 'GET', path: '/orders' })]}
        reconciliation={reconciliation({
          in_scope_coverage_pct: 42,
          architecture_coverage_pct: 17,
        })}
      />,
    );

    expect(
      screen.getByTestId('postman-import-staging-coverage-scope').textContent,
    ).toBe('42%');
    expect(
      screen.getByTestId('postman-import-staging-coverage-architecture')
        .textContent,
    ).toBe('17%');
  });

  it('flags an operation in operations_without_model_endpoint as "unmatched" and surfaces it', () => {
    const onFlaggedChange = vi.fn();
    const op = operation({ id: 'op-gap', method: 'GET', path: '/orders' });

    render(
      <PostmanImportStaging
        importedRequests={[imported({ method: 'GET', path: '/orders' })]}
        operations={[op]}
        reconciliation={reconciliation({
          operations_without_model_endpoint: [
            {
              operation_row_id: 'op-gap',
              operation_id: null,
              method: 'GET',
              path: '/orders',
              key: 'GET /orders',
            },
          ],
        })}
        onFlaggedChange={onFlaggedChange}
      />,
    );

    const row = screen.getByTestId('postman-import-staging-item-0');
    expect(row.getAttribute('data-arch-status')).toBe('unmatched');
    // Never silently runnable.
    expect(row.getAttribute('data-runnable')).toBe('false');
    expect(
      screen.getByTestId('postman-import-staging-item-0-status').textContent,
    ).toContain('Needs architecture');

    // Surfaced to the parent for the Group 4 step.
    const flagged = onFlaggedChange.mock.calls[onFlaggedChange.mock.calls.length - 1]?.[0] as StagedImportItem[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0].archStatus).toBe('unmatched');
  });

  it('flags an item mapping to NO operation as "no-operation" and emits it as flagged', () => {
    const onFlaggedChange = vi.fn();

    render(
      <PostmanImportStaging
        importedRequests={[imported({ method: 'DELETE', path: '/ghost' })]}
        operations={[operation({ id: 'op-1', method: 'GET', path: '/orders' })]}
        reconciliation={reconciliation()}
        onFlaggedChange={onFlaggedChange}
      />,
    );

    const row = screen.getByTestId('postman-import-staging-item-0');
    expect(row.getAttribute('data-arch-status')).toBe('no-operation');
    expect(row.getAttribute('data-runnable')).toBe('false');

    const flagged = onFlaggedChange.mock.calls[onFlaggedChange.mock.calls.length - 1]?.[0] as StagedImportItem[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0].archStatus).toBe('no-operation');
  });

  it('marks a matched + supported item runnable and does NOT flag it', () => {
    const onFlaggedChange = vi.fn();

    render(
      <PostmanImportStaging
        importedRequests={[imported({ method: 'GET', path: '/orders' })]}
        operations={[operation({ id: 'op-1', method: 'GET', path: '/orders' })]}
        reconciliation={reconciliation()}
        onFlaggedChange={onFlaggedChange}
      />,
    );

    const row = screen.getByTestId('postman-import-staging-item-0');
    expect(row.getAttribute('data-arch-status')).toBe('matched');
    expect(row.getAttribute('data-runnable')).toBe('true');

    const flagged = onFlaggedChange.mock.calls[onFlaggedChange.mock.calls.length - 1]?.[0] as StagedImportItem[];
    expect(flagged).toHaveLength(0);
  });

  it('flags a matched item with an unsupported body as not runnable and shows the reason', () => {
    render(
      <PostmanImportStaging
        importedRequests={[
          imported({
            method: 'GET',
            path: '/orders',
            unsupportedReason: 'Unsupported body content type',
          }),
        ]}
        operations={[operation({ id: 'op-1', method: 'GET', path: '/orders' })]}
        reconciliation={reconciliation()}
      />,
    );

    const row = screen.getByTestId('postman-import-staging-item-0');
    // Architecture is matched but the unsupported body makes it non-runnable.
    expect(row.getAttribute('data-arch-status')).toBe('matched');
    expect(row.getAttribute('data-runnable')).toBe('false');
    expect(
      screen.getByTestId('postman-import-staging-item-0-unsupported').textContent,
    ).toContain('Unsupported body');
  });
});
