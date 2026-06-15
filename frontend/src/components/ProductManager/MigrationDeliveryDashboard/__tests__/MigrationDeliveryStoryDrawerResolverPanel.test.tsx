/**
 * MigrationDeliveryStoryDrawerResolverPanel tests
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 6.1
 *
 * Eight focused tests cover the resolver panel's contract:
 *
 *   1. "What to do next" banner renders from `recommendedNextAction`.
 *   2. Grouped collapsible rendering in the prescribed type order
 *      (api_contract -> mapping -> target_element -> out_of_v1).
 *   3. Default-expanded when a group contains any unresolved row;
 *      default-collapsed when fully resolved.
 *   4. Unresolved-first sort within a group, descriptor alpha as tie-break.
 *   5. "X of Y resolved" badge updates after an api_contract upload calls
 *      `createResolution`.
 *   6. Mapping inline editor calls `createResolution` with the source +
 *      target element ids; out-of-v1 row renders the read-only label and
 *      Retry button stays disabled while unresolved rows remain.
 *   7. Target-element deep-link invokes `onOpenTargetArchitecture` with the
 *      logical name.
 *   8. Reset action soft-deletes the row, the resolution flips back to
 *      unresolved, and the badge reflects the new ratio.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the CSS module so class lookups never blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the resolver API client so we can assert the calls and steer responses.
// Use `vi.importActual` spread so unrelated exports survive untouched per the
// `architectureModelClient` mocking pattern.
const mockCreateResolution = vi.fn();
const mockSoftDeleteResolution = vi.fn();
const mockRetryBatch = vi.fn();
vi.mock('../../../../api/missingInputResolutionsApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/missingInputResolutionsApi')
  >('../../../../api/missingInputResolutionsApi');
  return {
    ...actual,
    createResolution: (...args: unknown[]) => mockCreateResolution(...args),
    softDeleteResolution: (...args: unknown[]) =>
      mockSoftDeleteResolution(...args),
    retryBatch: (...args: unknown[]) => mockRetryBatch(...args),
  };
});

import {
  MigrationDeliveryStoryDrawerResolverPanel,
  type ResolverPanelRow,
} from '../MigrationDeliveryStoryDrawerResolverPanel';
import type { MissingInputResolutionDto } from '../../../../api/missingInputResolutionsApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_ID = 'arch-1';
const WORK_ITEM_ID = 'wi-1';

function makeResolution(
  overrides: Partial<MissingInputResolutionDto> = {},
): MissingInputResolutionDto {
  return {
    id: 'res-1',
    projectId: PROJECT_ID,
    missingInputKey: 'aaaaaaaaaaaaaaaa',
    missingInputType: 'api_contract',
    resolutionPayloadJson: { contractBlobId: 'blob-1' },
    resolvedAt: '2026-05-20T10:00:00Z',
    resolvedBy: 'alice',
    softDeleted: false,
    softDeletedAt: null,
    softDeletedBy: null,
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-20T10:00:00Z',
    ...overrides,
  };
}

function makeRow(
  overrides: Partial<ResolverPanelRow> = {},
): ResolverPanelRow {
  return {
    missingInputKey: 'aaaaaaaaaaaaaaaa',
    missingInputType: 'api_contract',
    descriptor: 'PaymentsService::createPayment',
    reason: 'OAS contract not found for the requested operation',
    resolution: null,
    ...overrides,
  };
}

function renderPanel(rows: ResolverPanelRow[], extras: Partial<{
  recommendedNextAction: string | null;
  onOpenTargetArchitecture: (name: string | null) => void;
  onResolutionPersisted: (input: unknown) => void;
}> = {}) {
  return render(
    <MigrationDeliveryStoryDrawerResolverPanel
      projectId={PROJECT_ID}
      bookOfWorkId={BOOK_ID}
      architectureId={ARCH_ID}
      workItemId={WORK_ITEM_ID}
      recommendedNextAction={extras.recommendedNextAction ?? null}
      rows={rows}
      resolvedBy="alice"
      onOpenTargetArchitecture={extras.onOpenTargetArchitecture}
      onResolutionPersisted={extras.onResolutionPersisted}
    />,
  );
}

beforeEach(() => {
  mockCreateResolution.mockReset();
  mockSoftDeleteResolution.mockReset();
  mockRetryBatch.mockReset();
});

// ----------------------------------------------------------------------------
// Test 1: "What to do next" banner from recommendedNextAction
// ----------------------------------------------------------------------------

describe('Resolver panel -- recommended-next-action banner', () => {
  it('renders the banner at the top of the panel when recommendedNextAction is supplied', () => {
    renderPanel(
      [makeRow()],
      { recommendedNextAction: 'Upload the Payments OAS contract.' },
    );
    const banner = screen.getByTestId('mdr-recommended-banner');
    expect(banner).toHaveTextContent(
      /What to do next: Upload the Payments OAS contract\./,
    );
  });
});

// ----------------------------------------------------------------------------
// Test 2: Grouped collapsible structure in the prescribed order +
// default-expanded / default-collapsed depending on resolved state.
// ----------------------------------------------------------------------------

describe('Resolver panel -- grouped collapsible structure', () => {
  it('renders groups in the prescribed type order with expanded/collapsed defaults', () => {
    const apiUnresolved = makeRow({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      descriptor: 'Svc::op',
    });
    const mappingResolved = makeRow({
      missingInputKey: 'k-map',
      missingInputType: 'mapping',
      descriptor: 'src-1 -> tgt-1',
      resolution: makeResolution({
        id: 'res-map',
        missingInputKey: 'k-map',
        missingInputType: 'mapping',
      }),
    });
    const targetUnresolved = makeRow({
      missingInputKey: 'k-target',
      missingInputType: 'target_element',
      descriptor: 'OrdersTopic',
    });
    const outOfV1 = makeRow({
      missingInputKey: null,
      missingInputType: 'out_of_v1',
      descriptor: 'decision-needed',
    });
    renderPanel([
      mappingResolved,
      outOfV1,
      apiUnresolved,
      targetUnresolved,
    ]);

    const groupsContainer = screen.getByTestId('mdr-groups');
    const order = Array.from(groupsContainer.children).map(
      (n) => (n as HTMLElement).getAttribute('data-testid') ?? '',
    );
    expect(order).toEqual([
      'mdr-group-api_contract',
      'mdr-group-mapping',
      'mdr-group-target_element',
      'mdr-group-out_of_v1',
    ]);

    // api_contract: has unresolved -> default-expanded -> rows visible.
    expect(
      screen.getByTestId('mdr-group-api_contract-rows'),
    ).toBeInTheDocument();
    // mapping: fully resolved (1/1) -> default-collapsed -> no rows in DOM.
    expect(
      screen.queryByTestId('mdr-group-mapping-rows'),
    ).not.toBeInTheDocument();
    // target_element: has unresolved -> default-expanded.
    expect(
      screen.getByTestId('mdr-group-target_element-rows'),
    ).toBeInTheDocument();
    // out_of_v1: always default-collapsed (no resolver actions).
    expect(
      screen.queryByTestId('mdr-group-out_of_v1-rows'),
    ).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 3: Unresolved-first sort within a group, descriptor alpha tie-break.
// ----------------------------------------------------------------------------

describe('Resolver panel -- unresolved-first sort', () => {
  it('sorts unresolved rows before resolved rows in the same group', () => {
    const rows: ResolverPanelRow[] = [
      makeRow({
        missingInputKey: 'k-zeta',
        descriptor: 'ZetaService::op',
        resolution: makeResolution({
          id: 'r-zeta',
          missingInputKey: 'k-zeta',
        }),
      }),
      makeRow({
        missingInputKey: 'k-alpha',
        descriptor: 'AlphaService::op',
        resolution: null,
      }),
      makeRow({
        missingInputKey: 'k-mike',
        descriptor: 'MikeService::op',
        resolution: null,
      }),
    ];
    renderPanel(rows);

    const groupRows = screen.getByTestId('mdr-group-api_contract-rows');
    const orderedRowKeys = Array.from(groupRows.children).map(
      (n) => (n as HTMLElement).getAttribute('data-testid') ?? '',
    );
    // Unresolved rows first (alpha order between AlphaService and MikeService),
    // then the resolved ZetaService at the end.
    expect(orderedRowKeys[0]).toBe('mdr-row-k-alpha');
    expect(orderedRowKeys[1]).toBe('mdr-row-k-mike');
    expect(orderedRowKeys[2]).toBe('mdr-row-k-zeta');
  });
});

// ----------------------------------------------------------------------------
// Test 4: api_contract upload flow calls createResolution + badge updates.
// ----------------------------------------------------------------------------

describe('Resolver panel -- api_contract resolver row', () => {
  it('submits createResolution for an api_contract row and refreshes the X-of-Y badge', async () => {
    const onResolutionPersisted = vi.fn();
    const row = makeRow({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      descriptor: 'Svc::op',
      serviceName: 'Svc',
      operationName: 'op',
    });
    mockCreateResolution.mockResolvedValueOnce({
      resolution: makeResolution({
        id: 'res-new',
        missingInputKey: 'k-api',
        missingInputType: 'api_contract',
      }),
      affectedSpecIds: ['spec-a', 'spec-b'],
    });

    renderPanel([row], { onResolutionPersisted });

    // Initial badge: 0 of 1 (only the api_contract row counts).
    expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
      /0 of 1 resolved/,
    );

    // Paste contract text and submit.
    const paste = screen.getByTestId('mdr-row-k-api-paste-text');
    fireEvent.change(paste, { target: { value: 'openapi: 3.0.0\n' } });
    fireEvent.click(screen.getByTestId('mdr-row-k-api-submit'));

    await waitFor(() => {
      expect(mockCreateResolution).toHaveBeenCalledTimes(1);
    });
    const [calledProjectId, calledReq] = mockCreateResolution.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledProjectId).toBe(PROJECT_ID);
    expect(calledReq).toMatchObject({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      serviceName: 'Svc',
      operationName: 'op',
      resolvedBy: 'alice',
    });

    // Badge flips to 1 of 1 after the resolution lands in state.
    await waitFor(() => {
      expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
        /1 of 1 resolved/,
      );
    });
    expect(onResolutionPersisted).toHaveBeenCalledTimes(1);
    expect(onResolutionPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'api_contract',
        affectedSpecIds: ['spec-a', 'spec-b'],
      }),
    );
  });
});

// ----------------------------------------------------------------------------
// Test 5: Mapping inline editor calls createResolution + Retry stays
// disabled until X equals Y. out_of_v1 row renders the read-only label.
// ----------------------------------------------------------------------------

describe('Resolver panel -- mapping editor + Retry disablement + out_of_v1', () => {
  it('submits createResolution for a mapping row, keeps Retry disabled while unresolved rows remain, and shows the out-of-v1 read-only label', async () => {
    const apiRow = makeRow({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      descriptor: 'Svc::op',
    });
    const mappingRow = makeRow({
      missingInputKey: 'k-map',
      missingInputType: 'mapping',
      descriptor: 'src-1 -> tgt-1',
    });
    const outRow = makeRow({
      missingInputKey: null,
      missingInputType: 'out_of_v1',
      descriptor: 'decision-needed',
    });
    mockCreateResolution.mockResolvedValueOnce({
      resolution: makeResolution({
        id: 'res-map',
        missingInputKey: 'k-map',
        missingInputType: 'mapping',
      }),
      affectedSpecIds: ['spec-c'],
    });

    renderPanel([apiRow, mappingRow, outRow]);

    // Retry starts disabled because the v1 denominator is 2 and 0 resolved.
    const retryBtn = screen.getByTestId('mdr-retry-button');
    expect(retryBtn).toBeDisabled();
    expect(retryBtn.getAttribute('title')).toContain(
      'All inputs must be resolved before retrying',
    );

    // Expand the out_of_v1 group so the read-only label is in the DOM.
    fireEvent.click(screen.getByTestId('mdr-group-out_of_v1-toggle'));
    const outLabel = screen.getByTestId('mdr-row-outofv1-decision-needed-out-of-v1-label');
    expect(outLabel).toHaveTextContent(
      /Resolution UI not available in v1/,
    );

    // Fill mapping editor with source + target and submit.
    fireEvent.change(screen.getByTestId('mdr-row-k-map-source-input'), {
      target: { value: 'src-1' },
    });
    fireEvent.change(screen.getByTestId('mdr-row-k-map-target-input'), {
      target: { value: 'tgt-1' },
    });
    fireEvent.click(screen.getByTestId('mdr-row-k-map-submit'));

    await waitFor(() => {
      expect(mockCreateResolution).toHaveBeenCalledTimes(1);
    });
    const [, mappingReq] = mockCreateResolution.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(mappingReq).toMatchObject({
      missingInputKey: 'k-map',
      missingInputType: 'mapping',
      sourceElementId: 'src-1',
      targetElementId: 'tgt-1',
      resolvedBy: 'alice',
    });

    // Badge now reads 1 of 2; Retry stays disabled because the api row is
    // still unresolved.
    await waitFor(() => {
      expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
        /1 of 2 resolved/,
      );
    });
    expect(screen.getByTestId('mdr-retry-button')).toBeDisabled();
  });
});

// ----------------------------------------------------------------------------
// Test 6: Target element deep-link invokes the navigate callback.
// ----------------------------------------------------------------------------

describe('Resolver panel -- target_element deep-link', () => {
  it('invokes onOpenTargetArchitecture with the logical name when the deep-link button is clicked', () => {
    const onOpenTargetArchitecture = vi.fn();
    const row = makeRow({
      missingInputKey: 'k-target',
      missingInputType: 'target_element',
      descriptor: 'OrdersTopic',
      targetElementLogicalName: 'OrdersTopic',
    });
    renderPanel([row], { onOpenTargetArchitecture });

    fireEvent.click(screen.getByTestId('mdr-row-k-target-deep-link'));
    expect(onOpenTargetArchitecture).toHaveBeenCalledTimes(1);
    expect(onOpenTargetArchitecture).toHaveBeenCalledWith('OrdersTopic');
  });
});

// ----------------------------------------------------------------------------
// Test 7: Reset action soft-deletes and updates badge.
// ----------------------------------------------------------------------------

describe('Resolver panel -- Reset action', () => {
  it('calls softDeleteResolution, flips the row back to unresolved, and updates the badge', async () => {
    const resolved = makeRow({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      descriptor: 'Svc::op',
      resolution: makeResolution({
        id: 'res-api',
        missingInputKey: 'k-api',
        missingInputType: 'api_contract',
      }),
    });
    mockSoftDeleteResolution.mockResolvedValueOnce({
      deletedResolution: makeResolution({
        id: 'res-api',
        missingInputKey: 'k-api',
        missingInputType: 'api_contract',
        softDeleted: true,
      }),
      affectedSpecCount: 1,
      affectedSpecIds: ['spec-a'],
    });

    renderPanel([resolved]);

    // Resolved badge starts at 1 of 1.
    expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
      /1 of 1 resolved/,
    );
    // The api_contract group is fully resolved so it's collapsed by default;
    // expand it so the Reset button is in the DOM.
    fireEvent.click(screen.getByTestId('mdr-group-api_contract-toggle'));
    fireEvent.click(screen.getByTestId('mdr-row-k-api-reset-button'));

    await waitFor(() => {
      expect(mockSoftDeleteResolution).toHaveBeenCalledTimes(1);
    });
    expect(mockSoftDeleteResolution).toHaveBeenCalledWith(
      PROJECT_ID,
      'res-api',
      'alice',
    );
    await waitFor(() => {
      expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
        /0 of 1 resolved/,
      );
    });
  });
});

// ----------------------------------------------------------------------------
// Test 8: Retry button enables when all v1 rows are resolved.
// ----------------------------------------------------------------------------

describe('Resolver panel -- Retry button enablement', () => {
  it('enables Retry once X equals Y (out_of_v1 rows do not count in the denominator)', () => {
    const apiResolved = makeRow({
      missingInputKey: 'k-api',
      missingInputType: 'api_contract',
      descriptor: 'Svc::op',
      resolution: makeResolution({
        id: 'r-api',
        missingInputKey: 'k-api',
      }),
    });
    const outOnly = makeRow({
      missingInputKey: null,
      missingInputType: 'out_of_v1',
      descriptor: 'decision-needed',
    });
    renderPanel([apiResolved, outOnly]);
    expect(screen.getByTestId('mdr-resolved-badge')).toHaveTextContent(
      /1 of 1 resolved/,
    );
    const retry = screen.getByTestId('mdr-retry-button');
    expect(retry).not.toBeDisabled();
  });
});
