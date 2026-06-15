/**
 * MigrationDeliveryBulkResolveModal -- OAS/WSDL upload coverage
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 6.1.
 *
 * Eight focused tests covering the multi-file upload + preview + commit flow
 * added by Task Group 6:
 *
 *   1. Multi-file selection renders one per-file panel per selected file.
 *   2. Service-name input is editable per file (independent overrides).
 *   3. Preview button POSTs multipart via the API client with all files
 *      and their service-name overrides (commit=false).
 *   4. Per-operation status chips render the matched / already_resolved /
 *      no_match label.
 *   5. "view existing resolution" link on an already_resolved op row opens
 *      the read-only side panel populated with the matched row's audit fields.
 *   6. Apply button POSTs the same files with commit=true and fires
 *      onCommitted with the response.
 *   7. Per-file failure renders an inline error read from the response.
 *   8. Empty selection -> preview button disabled.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

// Mock the CSS module so class lookups never blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryBulkResolveModal } from '../MigrationDeliveryBulkResolveModal';
import type {
  ContractIngestResponse,
  MissingInputResolutionDto,
} from '../../../../api/missingInputResolutionsApi';

const PROJECT_ID = 'proj-bulk-upload';
const USER_ID = 'tester@example.com';

function buildIngestResponse(
  overrides: Partial<ContractIngestResponse> = {},
): ContractIngestResponse {
  return {
    files: [],
    summary: {
      totalOperations: 0,
      matched: 0,
      alreadyResolved: 0,
      noMatch: 0,
      willCreateResolutions: 0,
      affectedSpecCount: 0,
    },
    previewOnly: true,
    ...overrides,
  };
}

function makeFile(name: string, content: string = 'openapi: 3.0.3'): File {
  return new File([content], name, { type: 'application/x-yaml' });
}

describe('MigrationDeliveryBulkResolveModal -- OAS/WSDL upload (Task Group 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1) Multi-file selection renders per-file panels
  // ==========================================================================
  it('multi-file selection renders one per-file panel per file', () => {
    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={vi.fn()}
        listResolutionsFn={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      'mdd-bulk-resolve-file-input',
    ) as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.json');
    expect(input.accept).toContain('.yaml');
    expect(input.accept).toContain('.wsdl');

    fireEvent.change(input, {
      target: {
        files: [
          makeFile('orders.yaml'),
          makeFile('payments.yaml'),
          makeFile('legacy.wsdl', '<wsdl:definitions />'),
        ],
      },
    });

    expect(screen.getByTestId('mdd-bulk-resolve-file-panel-0')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-bulk-resolve-file-panel-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-bulk-resolve-file-panel-2')).toBeInTheDocument();
  });

  // ==========================================================================
  // 2) Service-name input is editable per file
  // ==========================================================================
  it('service-name input is editable per file (independent overrides)', () => {
    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={vi.fn()}
        listResolutionsFn={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: {
        files: [makeFile('orders.yaml'), makeFile('payments.yaml')],
      },
    });

    const svc0 = screen.getByTestId(
      'mdd-bulk-resolve-file-service-0',
    ) as HTMLInputElement;
    const svc1 = screen.getByTestId(
      'mdd-bulk-resolve-file-service-1',
    ) as HTMLInputElement;

    fireEvent.change(svc0, { target: { value: 'orders-svc' } });
    fireEvent.change(svc1, { target: { value: 'payments-svc' } });

    expect(svc0.value).toBe('orders-svc');
    expect(svc1.value).toBe('payments-svc');
  });

  // ==========================================================================
  // 3) Preview button POSTs multipart with all files + service-name overrides
  // ==========================================================================
  it('Preview button POSTs multipart with all files and service-name overrides (commit=false)', async () => {
    const parseFilesFn = vi.fn().mockResolvedValue(
      buildIngestResponse({
        files: [
          {
            fileName: 'orders.yaml',
            fileSize: 100,
            format: 'OAS_3_0',
            status: 'parsed',
            failureReason: null,
            suggestedServiceName: 'orders api',
            finalServiceName: 'orders-svc',
            operations: [],
          },
        ],
        summary: {
          totalOperations: 0,
          matched: 0,
          alreadyResolved: 0,
          noMatch: 0,
          willCreateResolutions: 0,
          affectedSpecCount: 0,
        },
      }),
    );

    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={parseFilesFn}
        listResolutionsFn={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: { files: [makeFile('orders.yaml'), makeFile('payments.yaml')] },
    });
    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-service-0'), {
      target: { value: 'orders-svc' },
    });

    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() => expect(parseFilesFn).toHaveBeenCalledTimes(1));
    const [projectId, files, serviceNames, commit, userId] =
      parseFilesFn.mock.calls[0];
    expect(projectId).toBe(PROJECT_ID);
    expect(files).toHaveLength(2);
    expect((files as File[])[0].name).toBe('orders.yaml');
    expect((files as File[])[1].name).toBe('payments.yaml');
    // First file has an override, second leaves it as null (use suggested).
    expect(serviceNames).toEqual(['orders-svc', null]);
    expect(commit).toBe(false);
    expect(userId).toBe(USER_ID);
  });

  // ==========================================================================
  // 4) Per-operation status chips render correctly
  // ==========================================================================
  it('per-operation status chips render matched / already_resolved / no_match labels', async () => {
    const parseFilesFn = vi.fn().mockResolvedValue(
      buildIngestResponse({
        files: [
          {
            fileName: 'orders.yaml',
            fileSize: 200,
            format: 'OAS_3_0',
            status: 'parsed',
            failureReason: null,
            suggestedServiceName: 'orders',
            finalServiceName: 'orders',
            operations: [
              {
                identifier: 'placeorder',
                missingInputKey: 'aaaaaaaaaaaaaaaa',
                status: 'matched',
                matchedSpecIds: ['spec-1', 'spec-2'],
                existingResolutionId: null,
              },
              {
                identifier: 'cancelorder',
                missingInputKey: 'bbbbbbbbbbbbbbbb',
                status: 'already_resolved',
                matchedSpecIds: ['spec-3'],
                existingResolutionId: 'res-already',
              },
              {
                identifier: 'noopop',
                missingInputKey: 'cccccccccccccccc',
                status: 'no_match',
                matchedSpecIds: [],
                existingResolutionId: null,
              },
            ],
          },
        ],
        summary: {
          totalOperations: 3,
          matched: 1,
          alreadyResolved: 1,
          noMatch: 1,
          willCreateResolutions: 1,
          affectedSpecCount: 2,
        },
      }),
    );

    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={parseFilesFn}
        listResolutionsFn={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: { files: [makeFile('orders.yaml')] },
    });
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-file-operations-0'),
      ).toBeInTheDocument(),
    );

    const row0 = screen.getByTestId('mdd-bulk-resolve-op-row-0-0');
    const row1 = screen.getByTestId('mdd-bulk-resolve-op-row-0-1');
    const row2 = screen.getByTestId('mdd-bulk-resolve-op-row-0-2');

    expect(within(row0).getByText(/matched/i)).toBeInTheDocument();
    expect(within(row1).getByText(/already.resolved/i)).toBeInTheDocument();
    expect(within(row2).getByText(/no.match/i)).toBeInTheDocument();

    // Summary banner reflects the response numbers.
    expect(
      screen.getByTestId('mdd-bulk-resolve-ingest-summary-create'),
    ).toHaveTextContent('1');
    expect(
      screen.getByTestId('mdd-bulk-resolve-ingest-summary-stories'),
    ).toHaveTextContent('2');
  });

  // ==========================================================================
  // 5) "view existing resolution" link opens side panel with read-only data
  // ==========================================================================
  it('"view existing resolution" link opens the side panel with the matched resolution row', async () => {
    const parseFilesFn = vi.fn().mockResolvedValue(
      buildIngestResponse({
        files: [
          {
            fileName: 'orders.yaml',
            fileSize: 200,
            format: 'OAS_3_0',
            status: 'parsed',
            failureReason: null,
            suggestedServiceName: 'orders',
            finalServiceName: 'orders',
            operations: [
              {
                identifier: 'cancelorder',
                missingInputKey:
                  'bbbbbbbbbbbbbbbb1111111111111111111111111111111111111111',
                status: 'already_resolved',
                matchedSpecIds: ['spec-3'],
                existingResolutionId: 'res-already',
              },
            ],
          },
        ],
        summary: {
          totalOperations: 1,
          matched: 0,
          alreadyResolved: 1,
          noMatch: 0,
          willCreateResolutions: 0,
          affectedSpecCount: 0,
        },
      }),
    );

    const existing: MissingInputResolutionDto = {
      id: 'res-already',
      projectId: PROJECT_ID,
      missingInputKey:
        'bbbbbbbbbbbbbbbb1111111111111111111111111111111111111111',
      missingInputType: 'api_contract',
      resolutionPayloadJson: { resolution_source: 'oas_wsdl_upload' },
      resolvedAt: '2026-05-20T10:00:00Z',
      resolvedBy: 'alice@example.com',
      softDeleted: false,
      softDeletedAt: null,
      softDeletedBy: null,
      createdAt: '2026-05-20T10:00:00Z',
      updatedAt: '2026-05-20T10:00:00Z',
    };
    const listResolutionsFn = vi.fn().mockResolvedValue([existing]);

    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={parseFilesFn}
        listResolutionsFn={listResolutionsFn}
      />,
    );

    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: { files: [makeFile('orders.yaml')] },
    });
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-op-view-existing-0-0'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-op-view-existing-0-0'));

    await waitFor(() =>
      expect(listResolutionsFn).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          missingInputKey:
            'bbbbbbbbbbbbbbbb1111111111111111111111111111111111111111',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-existing-resolution-side-panel'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('mdd-existing-resolution-side-panel-id'),
    ).toHaveTextContent('res-already');
    expect(
      screen.getByTestId('mdd-existing-resolution-side-panel-resolved-by'),
    ).toHaveTextContent('alice@example.com');
    expect(
      screen.getByTestId('mdd-existing-resolution-side-panel-source'),
    ).toHaveTextContent('oas_wsdl_upload');
  });

  // ==========================================================================
  // 6) Apply button posts with commit=true and fires onCommitted
  // ==========================================================================
  it('Apply button re-sends the files with commit=true and fires onCommitted', async () => {
    const previewResponse = buildIngestResponse({
      files: [
        {
          fileName: 'orders.yaml',
          fileSize: 100,
          format: 'OAS_3_0',
          status: 'parsed',
          failureReason: null,
          suggestedServiceName: 'orders',
          finalServiceName: 'orders',
          operations: [
            {
              identifier: 'placeorder',
              missingInputKey: 'aaaaaaaaaaaaaaaa',
              status: 'matched',
              matchedSpecIds: ['spec-1'],
              existingResolutionId: null,
            },
          ],
        },
      ],
      summary: {
        totalOperations: 1,
        matched: 1,
        alreadyResolved: 0,
        noMatch: 0,
        willCreateResolutions: 1,
        affectedSpecCount: 1,
      },
    });
    const commitResponse = { ...previewResponse, previewOnly: false };
    const parseFilesFn = vi
      .fn()
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce(commitResponse);
    const onCommitted = vi.fn();

    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={onCommitted}
        bulkResolveFn={vi.fn()}
        parseFilesFn={parseFilesFn}
        listResolutionsFn={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: { files: [makeFile('orders.yaml')] },
    });
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-ingest-summary'),
      ).toBeInTheDocument(),
    );
    // Commit (Apply) button is enabled now.
    expect(screen.getByTestId('mdd-bulk-resolve-commit')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-commit'));

    await waitFor(() => expect(parseFilesFn).toHaveBeenCalledTimes(2));
    // Second call carries commit=true.
    const secondCall = parseFilesFn.mock.calls[1];
    expect(secondCall[3]).toBe(true);
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(commitResponse));
  });

  // ==========================================================================
  // 7) Per-file inline error renders when the response reports a failure
  // ==========================================================================
  it('renders the per-file inline error read from the response (e.g. file_too_large)', async () => {
    const parseFilesFn = vi.fn().mockResolvedValue(
      buildIngestResponse({
        files: [
          {
            fileName: 'huge.yaml',
            fileSize: 5_000_000,
            format: null,
            status: 'failed',
            failureReason: 'file_too_large',
            suggestedServiceName: null,
            finalServiceName: null,
            operations: [],
          },
        ],
      }),
    );

    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={parseFilesFn}
        listResolutionsFn={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('mdd-bulk-resolve-file-input'), {
      target: { files: [makeFile('huge.yaml')] },
    });
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-file-error-0'),
      ).toHaveTextContent('file_too_large'),
    );
  });

  // ==========================================================================
  // 8) Empty selection -> preview button disabled
  // ==========================================================================
  it('Preview button is disabled when no files or manual entries are present', () => {
    render(
      <MigrationDeliveryBulkResolveModal
        projectId={PROJECT_ID}
        resolvedBy={USER_ID}
        onClose={() => undefined}
        onCommitted={() => undefined}
        bulkResolveFn={vi.fn()}
        parseFilesFn={vi.fn()}
        listResolutionsFn={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mdd-bulk-resolve-preview')).toBeDisabled();
    // Commit is also disabled (no preview run).
    expect(screen.getByTestId('mdd-bulk-resolve-commit')).toBeDisabled();
  });
});
