/**
 * MigrationDeliveryReconciliationPanel -- per-dimension break-type badges
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types --
 * Task Group 4 (frontend surfacing). The lower layers (AMS header_classification
 * + body_ordering_drift, the validation-service header/ordering diff + break_type
 * derivation, and the gateway break registration + detail_json carry +
 * header-value auto-disposition) are covered in their own layers. The
 * genuinely-uncovered FRONTEND seams covered here:
 *
 *   1. A break carrying a MULTI-dimension break_type set
 *      (e.g. ['headers', 'body-value']) renders a distinct badge per dimension.
 *   2. A status-only break renders just the single status badge.
 *   3. A volatile-disposed header break shows the tolerated header NAMES in the
 *      volatility detail (the same way volatile body paths are shown).
 *   4. A LEGACY break with NO break_types degrades gracefully -- no crash, the
 *      existing drift-summary rendering stands alone, no badge row.
 *
 * Conventions mirror MigrationDeliveryReconciliationVolatile.test.tsx: the CSS
 * module is mocked via a Proxy; the reconciliation api module is mocked so the
 * render is deterministic + offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the reconciliation api module (the HARD rule: mock the api module).
vi.mock('../../../../api/migrationReconciliationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationReconciliationApi')
  >('../../../../api/migrationReconciliationApi');
  return {
    ...actual,
    getReconciliationBreaks: vi.fn(),
    sendReconciliationBreaksAsBugs: vi.fn(),
    disposeReconciliationBreaks: vi.fn(),
    declareVolatilePaths: vi.fn(),
    registerTargetCredentials: vi.fn(),
  };
});

import { MigrationDeliveryReconciliationPanel } from '../MigrationDeliveryReconciliationPanel';
import * as reconApi from '../../../../api/migrationReconciliationApi';
import type { MigrationReconciliationBreakDto } from '../../../../api/migrationReconciliationApi';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';

function makeBreak(
  partial: Partial<MigrationReconciliationBreakDto> &
    Pick<MigrationReconciliationBreakDto, 'id'>,
): MigrationReconciliationBreakDto {
  return {
    run_id: RUN_ID,
    pinned_baseline_id: 'baseline-1',
    source_baseline_item_id: `sbi-${partial.id}`,
    diff_item_id: `diff-${partial.id}`,
    disposition_status: reconApi.BREAK_DISPOSITION.OPEN,
    bug_id: null,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    error_detail: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

function renderPanel() {
  render(
    <MigrationDeliveryReconciliationPanel
      projectId={PROJECT_ID}
      runId={RUN_ID}
      runStatus="reconciled"
      company="acme"
      project="billing"
    />,
  );
}

describe('MigrationDeliveryReconciliationPanel -- per-dimension break-type badges', () => {
  it('renders a distinct badge per dimension for a multi-dimension break_type set (headers + body-value)', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'm1',
        detail_json: {
          method: 'GET',
          path: '/widgets',
          operation: 'GET /widgets',
          summary: 'header + body value drift',
          status_classification: 'status_match',
          header_classification: 'header_value_drift',
          body_classification: 'body_value_drift',
          break_types: ['headers', 'body-value'],
        },
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-m1')).toBeInTheDocument(),
    );

    const badgeRow = screen.getByTestId('mdd-recon-break-types-m1');
    const headersBadge = within(badgeRow).getByTestId(
      'mdd-recon-break-type-m1-headers',
    );
    const bodyValueBadge = within(badgeRow).getByTestId(
      'mdd-recon-break-type-m1-body-value',
    );
    expect(headersBadge).toHaveAttribute('data-break-type', 'headers');
    expect(headersBadge).toHaveTextContent('Headers');
    expect(bodyValueBadge).toHaveAttribute('data-break-type', 'body-value');
    expect(bodyValueBadge).toHaveTextContent('Body value');

    // No status / body-shape / ordering badge for this set.
    expect(
      within(badgeRow).queryByTestId('mdd-recon-break-type-m1-status'),
    ).not.toBeInTheDocument();
    expect(
      within(badgeRow).queryByTestId('mdd-recon-break-type-m1-ordering'),
    ).not.toBeInTheDocument();
  });

  it('renders just the single status badge for a status-only break', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 's1',
        detail_json: {
          method: 'GET',
          path: '/widgets',
          operation: 'GET /widgets',
          summary: '200 -> 404',
          status_classification: 'status_drift',
          body_classification: 'body_match',
          break_types: ['status'],
        },
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-s1')).toBeInTheDocument(),
    );

    const badgeRow = screen.getByTestId('mdd-recon-break-types-s1');
    expect(
      within(badgeRow).getByTestId('mdd-recon-break-type-s1-status'),
    ).toHaveTextContent('Status');
    // Exactly one badge -- status only.
    expect(
      within(badgeRow).queryByTestId('mdd-recon-break-type-s1-headers'),
    ).not.toBeInTheDocument();
    expect(
      within(badgeRow).queryByTestId('mdd-recon-break-type-s1-body-value'),
    ).not.toBeInTheDocument();
  });

  it('renders an ordering badge for a body_ordering_drift break', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'ord1',
        detail_json: {
          method: 'GET',
          path: '/collection',
          operation: 'GET /collection',
          summary: 'array reordered',
          body_classification: 'body_ordering_drift',
          break_types: ['ordering'],
        },
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-ord1')).toBeInTheDocument(),
    );

    expect(
      screen.getByTestId('mdd-recon-break-type-ord1-ordering'),
    ).toHaveTextContent('Ordering');
  });

  it('shows the tolerated header names in the volatility detail for a volatile-disposed header break', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'hv1',
        detail_json: {
          method: 'GET',
          path: '/widgets',
          operation: 'GET /widgets',
          summary: 'allowlisted header value drift',
          header_classification: 'header_value_drift',
          break_types: ['headers'],
          // The gateway expected_volatile audit note carries the tolerated
          // allowlisted header NAMES.
          volatility_match: {
            outcome: 'expected_volatile',
            sources: ['probed'],
            paths: ['header:Date'],
            tolerated_header_names: ['Date'],
          },
        },
        disposition_status: reconApi.BREAK_DISPOSITION.EXPECTED_VOLATILE,
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-hv1')).toBeInTheDocument(),
    );

    // The headers badge renders.
    expect(
      screen.getByTestId('mdd-recon-break-type-hv1-headers'),
    ).toHaveTextContent('Headers');

    // The tolerated header NAMES surface in the volatility detail.
    const toleratedBlock = screen.getByTestId(
      'mdd-recon-break-tolerated-headers-hv1',
    );
    expect(
      within(toleratedBlock).getByTestId(
        'mdd-recon-break-tolerated-header-hv1-Date',
      ),
    ).toHaveTextContent('Date');
  });

  it('degrades gracefully for a LEGACY break with no break_types (no badge row, no crash, summary still renders)', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'legacy1',
        detail_json: {
          method: 'GET',
          path: '/widgets',
          operation: 'GET /widgets',
          summary: 'legacy drift summary',
          status_classification: 'status_drift',
          body_classification: 'body_value_drift',
          // NO break_types / header_classification (pre-2026-06-17 break).
        },
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-recon-break-row-legacy1'),
      ).toBeInTheDocument(),
    );

    // No badge row at all -- graceful degrade.
    expect(
      screen.queryByTestId('mdd-recon-break-types-legacy1'),
    ).not.toBeInTheDocument();
    // The existing drift summary still renders.
    expect(screen.getByTestId('mdd-recon-break-row-legacy1')).toHaveTextContent(
      'legacy drift summary',
    );
  });
});
