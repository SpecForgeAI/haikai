/**
 * Cross-layer strategic tests for the MigrationDeliveryBulkResolveModal
 * upload flow.
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 8.
 *
 * Two tests filling genuine cross-layer gaps NOT covered by the eight
 * focused tests in Task Group 6:
 *
 *   1. Multi-file mixed-format preview: OAS + WSDL + failed sibling renders
 *      THREE per-file panels with the correct per-file statuses AND the
 *      summary banner aggregates the across-file counts. This proves the
 *      sibling-file isolation contract holds end-to-end through the UI
 *      (failed file rendered alongside parsed files, summary still correct).
 *
 *   2. End-to-end preview -> commit with the summary banner reflecting the
 *      summary returned by the commit response (not the preview response).
 *      The dashboard depends on the post-commit `willCreateResolutions = 0`
 *      to know to refresh the ready-to-retry count -- this verifies the
 *      modal hands the COMMIT-stage response (not the preview-stage one)
 *      to onCommitted so the dashboard parent can refresh accurately.
 */

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
import type { ContractIngestResponse } from '../../../../api/missingInputResolutionsApi';

const PROJECT_ID = 'proj-cross-layer';
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

describe('MigrationDeliveryBulkResolveModal -- cross-layer (Task Group 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1) Multi-file mixed-format preview: OAS + WSDL + failed
  // ==========================================================================
  it('renders 3 per-file panels for OAS+WSDL+failed and the summary banner sums across files', async () => {
    // Response carries:
    //   - file 0: OAS 3.0, parsed, one matched op (spec-1)
    //   - file 1: WSDL 1.1, parsed, one matched op (spec-2)
    //   - file 2: malformed, failed with unrecognised_contract_format
    // Summary: 2 matched, 2 will-create, 2 affected specs.
    const parseFilesFn = vi.fn().mockResolvedValue(
      buildIngestResponse({
        files: [
          {
            fileName: 'orders.yaml',
            fileSize: 200,
            format: 'OAS_3_0',
            status: 'parsed',
            failureReason: null,
            suggestedServiceName: 'orders api',
            finalServiceName: 'orders api',
            operations: [
              {
                identifier: 'placeorder',
                missingInputKey: 'a1b2c3d4e5f60718',
                status: 'matched',
                matchedSpecIds: ['spec-1'],
                existingResolutionId: null,
              },
            ],
          },
          {
            fileName: 'payments.wsdl',
            fileSize: 400,
            format: 'WSDL_1_1',
            status: 'parsed',
            failureReason: null,
            suggestedServiceName: 'paymentsservice',
            finalServiceName: 'paymentsservice',
            operations: [
              {
                identifier: 'cancelorder',
                missingInputKey: 'b2c3d4e5f6071829',
                status: 'matched',
                matchedSpecIds: ['spec-2'],
                existingResolutionId: null,
              },
            ],
          },
          {
            fileName: 'garbage.txt',
            fileSize: 50,
            format: null,
            status: 'failed',
            failureReason: 'unrecognised_contract_format',
            suggestedServiceName: null,
            finalServiceName: null,
            operations: [],
          },
        ],
        summary: {
          totalOperations: 2,
          matched: 2,
          alreadyResolved: 0,
          noMatch: 0,
          willCreateResolutions: 2,
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
      target: {
        files: [
          makeFile('orders.yaml'),
          makeFile('payments.wsdl', '<wsdl:definitions/>'),
          makeFile('garbage.txt', 'plain'),
        ],
      },
    });
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));

    // All three panels render.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-bulk-resolve-file-panel-0'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('mdd-bulk-resolve-file-panel-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('mdd-bulk-resolve-file-panel-2'),
      ).toBeInTheDocument();
    });

    // File 0 -- OAS parsed, one matched op.
    const panel0 = screen.getByTestId('mdd-bulk-resolve-file-panel-0');
    expect(within(panel0).getByText(/orders\.yaml/)).toBeInTheDocument();
    const op0 = screen.getByTestId('mdd-bulk-resolve-op-row-0-0');
    expect(within(op0).getByText(/matched/i)).toBeInTheDocument();

    // File 1 -- WSDL parsed, one matched op (sibling-isolated from the
    // failed file).
    const panel1 = screen.getByTestId('mdd-bulk-resolve-file-panel-1');
    expect(within(panel1).getByText(/payments\.wsdl/)).toBeInTheDocument();
    const op1 = screen.getByTestId('mdd-bulk-resolve-op-row-1-0');
    expect(within(op1).getByText(/matched/i)).toBeInTheDocument();

    // File 2 -- failed file renders the failure-reason inline error.
    expect(
      screen.getByTestId('mdd-bulk-resolve-file-error-2'),
    ).toHaveTextContent('unrecognised_contract_format');

    // Summary banner sums across files: 2 new resolutions across 2 stories.
    expect(
      screen.getByTestId('mdd-bulk-resolve-ingest-summary-create'),
    ).toHaveTextContent('2');
    expect(
      screen.getByTestId('mdd-bulk-resolve-ingest-summary-stories'),
    ).toHaveTextContent('2');
  });

  // ==========================================================================
  // 2) End-to-end preview -> commit hands the COMMIT response to onCommitted
  // ==========================================================================
  it('end-to-end preview -> commit hands the COMMIT-stage response to onCommitted (not the preview one)', async () => {
    // The dashboard relies on this distinction: preview returns
    // willCreateResolutions = 2; commit (with the side effect of creating
    // them) returns willCreateResolutions = 0 because the resolutions are
    // now persisted. If the modal handed the preview response to
    // onCommitted, the dashboard would mis-stamp the ready-to-retry count.
    const previewResponse = buildIngestResponse({
      files: [
        {
          fileName: 'orders.yaml',
          fileSize: 200,
          format: 'OAS_3_0',
          status: 'parsed',
          failureReason: null,
          suggestedServiceName: 'orders api',
          finalServiceName: 'orders api',
          operations: [
            {
              identifier: 'placeorder',
              missingInputKey: 'a1b2c3d4e5f60718',
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
      previewOnly: true,
    });

    // After commit, the SAME op is now classified as already_resolved
    // (the resolution row exists). willCreateResolutions == 0 -- this is
    // the value the dashboard uses to decide whether to refresh the
    // ready-to-retry counter.
    const commitResponse: ContractIngestResponse = {
      files: [
        {
          fileName: 'orders.yaml',
          fileSize: 200,
          format: 'OAS_3_0',
          status: 'parsed',
          failureReason: null,
          suggestedServiceName: 'orders api',
          finalServiceName: 'orders api',
          operations: [
            {
              identifier: 'placeorder',
              missingInputKey: 'a1b2c3d4e5f60718',
              status: 'already_resolved',
              matchedSpecIds: [],
              existingResolutionId: 'res-just-created',
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
      previewOnly: false,
    };

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

    // Preview first.
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-preview'));
    await waitFor(() => expect(parseFilesFn).toHaveBeenCalledTimes(1));
    const previewCall = parseFilesFn.mock.calls[0];
    expect(previewCall[3]).toBe(false); // commit=false on preview

    // Summary now shows 1 new resolution from the preview response.
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-bulk-resolve-ingest-summary-create'),
      ).toHaveTextContent('1'),
    );

    // Now Apply -- the second call must carry commit=true and the
    // onCommitted callback must receive the COMMIT response (with
    // willCreateResolutions = 0), NOT the preview response.
    fireEvent.click(screen.getByTestId('mdd-bulk-resolve-commit'));

    await waitFor(() => expect(parseFilesFn).toHaveBeenCalledTimes(2));
    const commitCall = parseFilesFn.mock.calls[1];
    expect(commitCall[3]).toBe(true);

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
    const handed = onCommitted.mock.calls[0][0];
    expect(handed).toBe(commitResponse);
    // Critical: the handed response carries the post-commit numbers, so
    // the dashboard parent can refresh its ready-to-retry counter on the
    // ALREADY_RESOLVED outcome and avoid double-counting.
    expect((handed as ContractIngestResponse).summary.willCreateResolutions).toBe(0);
    expect((handed as ContractIngestResponse).previewOnly).toBe(false);
  });
});
