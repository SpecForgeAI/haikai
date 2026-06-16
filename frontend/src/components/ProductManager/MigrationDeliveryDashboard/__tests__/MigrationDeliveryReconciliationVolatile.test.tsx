/**
 * MigrationDeliveryReconciliationPanel -- volatile-value handling (2026-06-16)
 *
 * Spec: Reconcile-Time Determinism & Volatile-Value Handling -- Task Group 5
 * (frontend surfacing). The lower layers (AMS column + disposition, the
 * capture-time probe, the diff-time per-path tolerance, the gateway
 * `expected_volatile` auto-disposition pass + retroactive declare + the
 * run-summary count) are covered in their own layers. The genuinely-uncovered
 * FRONTEND seams covered here:
 *
 *   1. An `expected_volatile` break renders the normalised JSON-Pointer volatile
 *      path list (read from detail_json.body_diff_json.entries[].path where the
 *      entry carries a volatilitySource) plus the plain volatility_source badge,
 *      reusing existing metadata styling -- NOT hidden.
 *   2. A LARGE path list collapses behind a toggle (the collapsible affordance is
 *      present and reveals the full list on click).
 *   3. A down-ranked-to-`info` heuristic break shows its heuristic paths +
 *      heuristic source in the same drawer area, and stays OPEN + selectable.
 *   4. The reconcile run summary DISPLAYS the expected_volatile count alongside
 *      the expected_net_new count (displayed count only).
 *   5. The in-UI "declare volatile" control calls the declare-volatile route
 *      with the operation + entered paths, then refreshes so the retroactive
 *      re-disposition shows.
 *
 * Conventions mirror MigrationDeliveryReconciliationNetNew.test.tsx: the CSS
 * module is mocked via a Proxy; the reconciliation api module is mocked so the
 * render is deterministic + offline; every client is a test-seam prop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

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

/**
 * A break carrying volatility metadata on detail_json.body_diff_json: tolerated
 * value entries are tagged volatilitySource and the distinct set is surfaced on
 * volatility_sources -- exactly the verbatim shape the gateway copies off the
 * validation-service diff_item at break-creation.
 */
function makeVolatileBreak(
  partial: Partial<MigrationReconciliationBreakDto> &
    Pick<MigrationReconciliationBreakDto, 'id'>,
): MigrationReconciliationBreakDto {
  return {
    run_id: RUN_ID,
    pinned_baseline_id: 'baseline-1',
    source_baseline_item_id: `sbi-${partial.id}`,
    diff_item_id: `diff-${partial.id}`,
    detail_json: {
      method: 'GET',
      path: '/widgets',
      operation: 'GET /widgets',
      summary: 'tolerated value drift on volatile path(s)',
      body_classification: 'body_match',
      body_diff_json: {
        entries: [
          { path: '/createdAt', kind: 'value_changed', volatilitySource: 'probed' },
          { path: '/id', kind: 'value_changed', volatilitySource: 'probed' },
        ],
        volatility_sources: ['probed'],
      },
    },
    disposition_status: reconApi.BREAK_DISPOSITION.EXPECTED_VOLATILE,
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

describe('MigrationDeliveryReconciliationPanel -- volatile path list + source badge', () => {
  it('renders the normalised JSON-Pointer path list and the volatility_source badge for an expected_volatile break', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeVolatileBreak({ id: 'v1' }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-v1')).toBeInTheDocument(),
    );

    // The disposition badge reads as the recognised volatile state.
    const badge = screen.getByTestId('mdd-recon-break-disposition-v1');
    expect(badge).toHaveAttribute('data-state', 'expected_volatile');
    expect(badge).toHaveTextContent(/Expected\s*[—-]\s*volatile/i);

    // The full normalised JSON-Pointer volatile-path list is surfaced, NOT hidden.
    const list = screen.getByTestId('mdd-recon-break-volatility-paths-v1');
    expect(within(list).getByText('/createdAt')).toBeInTheDocument();
    expect(within(list).getByText('/id')).toBeInTheDocument();

    // The plain volatility_source label/badge is present.
    const sourceBadge = screen.getByTestId(
      'mdd-recon-break-volatility-source-v1-probed',
    );
    expect(sourceBadge).toHaveAttribute('data-volatility-source', 'probed');
    expect(sourceBadge).toHaveTextContent('probed');

    // Small path list (2 entries) -> no collapse toggle.
    expect(
      screen.queryByTestId('mdd-recon-break-volatility-toggle-v1'),
    ).not.toBeInTheDocument();
  });

  it('collapses a LARGE volatile path list behind a toggle and reveals the full list on click', async () => {
    const manyPaths = Array.from({ length: 12 }, (_, i) => `/field${i}`);
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeVolatileBreak({
        id: 'big',
        detail_json: {
          method: 'GET',
          path: '/report',
          operation: 'GET /report',
          summary: 'many tolerated paths',
          body_classification: 'body_match',
          body_diff_json: {
            entries: manyPaths.map((p) => ({
              path: p,
              kind: 'value_changed',
              volatilitySource: 'probed',
            })),
            volatility_sources: ['probed'],
          },
        },
      }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-big')).toBeInTheDocument(),
    );

    // The collapsible affordance is present (12 > the 8 threshold) and the list
    // starts collapsed (the last entry is not yet shown).
    const toggle = screen.getByTestId('mdd-recon-break-volatility-toggle-big');
    expect(toggle).toHaveTextContent(/Show all 12 volatile paths/i);
    const list = screen.getByTestId('mdd-recon-break-volatility-paths-big');
    expect(within(list).queryByText('/field11')).not.toBeInTheDocument();

    // Expanding reveals the full list.
    fireEvent.click(toggle);
    expect(within(list).getByText('/field11')).toBeInTheDocument();
    expect(toggle).toHaveTextContent(/Show fewer paths/i);
  });

  it('shows a down-ranked-to-info heuristic break with its heuristic paths in the same drawer and keeps it open + selectable', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeVolatileBreak({
        id: 'h1',
        detail_json: {
          method: 'POST',
          path: '/orders',
          operation: 'POST /orders',
          summary: 'heuristic-only tolerated drift',
          // info stays OPEN; the comparator left body_match because the only
          // entries were tolerated (here by a conservative heuristic guess).
          body_classification: 'body_match',
          body_diff_json: {
            entries: [
              {
                path: '/orderedAt',
                kind: 'value_changed',
                volatilitySource: 'heuristic',
              },
            ],
            volatility_sources: ['heuristic'],
          },
        },
        disposition_status: reconApi.BREAK_DISPOSITION.INFO,
      }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-h1')).toBeInTheDocument(),
    );

    // The disposition reads as the open down-rank info marker.
    const badge = screen.getByTestId('mdd-recon-break-disposition-h1');
    expect(badge).toHaveAttribute('data-state', 'info');

    // The heuristic path + heuristic source render in the same drawer area.
    const list = screen.getByTestId('mdd-recon-break-volatility-paths-h1');
    expect(within(list).getByText('/orderedAt')).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-recon-break-volatility-source-h1-heuristic'),
    ).toHaveTextContent('heuristic');

    // info is NOT terminal -> the break stays selectable for human review.
    expect(screen.getByTestId('mdd-recon-select-h1')).not.toBeDisabled();
  });

  it('displays the expected_volatile count alongside expected_net_new in the run summary', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeVolatileBreak({ id: 'v1' }),
      makeVolatileBreak({ id: 'v2' }),
      {
        ...makeVolatileBreak({ id: 'nn1' }),
        disposition_status: reconApi.BREAK_DISPOSITION.EXPECTED_NET_NEW,
      },
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-run-summary')).toBeInTheDocument(),
    );

    expect(
      screen.getByTestId('mdd-recon-summary-expected-net-new'),
    ).toHaveTextContent('Expected — net_new: 1');
    expect(
      screen.getByTestId('mdd-recon-summary-expected-volatile'),
    ).toHaveTextContent('Expected — volatile: 2');
  });

  it('calls the declare-volatile route with the operation + entered paths and refreshes the list', async () => {
    // Open break on GET /widgets that the human will declare volatile on. It
    // carries a real (untagged) drift today; the reviewer declares /updatedAt.
    const openBreak = makeVolatileBreak({
      id: 'o1',
      detail_json: {
        method: 'GET',
        path: '/widgets',
        operation: 'GET /widgets',
        summary: 'value drift on /updatedAt',
        body_classification: 'body_value_drift',
        body_diff_json: {
          entries: [{ path: '/updatedAt', kind: 'value_changed' }],
        },
      },
      disposition_status: reconApi.BREAK_DISPOSITION.OPEN,
    });
    vi.mocked(reconApi.getReconciliationBreaks)
      .mockResolvedValueOnce([openBreak])
      // refresh after the declare -> now tolerated + auto-dispositioned.
      .mockResolvedValue([makeVolatileBreak({ id: 'o1' })]);
    vi.mocked(reconApi.declareVolatilePaths).mockResolvedValue({
      reEvaluated: 1,
      expectedVolatile: 1,
      info: 0,
    });

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-o1')).toBeInTheDocument(),
    );

    // The declare control is available on the open break (a reviewer can declare
    // a path that is NOT yet tolerated). Enter a path and submit it via the same
    // break-detail surface as the override.
    fireEvent.change(screen.getByTestId('mdd-recon-break-declare-input-o1'), {
      target: { value: '/updatedAt' },
    });
    fireEvent.click(screen.getByTestId('mdd-recon-break-declare-button-o1'));

    await waitFor(() =>
      expect(reconApi.declareVolatilePaths).toHaveBeenCalledTimes(1),
    );
    expect(reconApi.declareVolatilePaths).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      { operation: 'GET /widgets', declaredPaths: ['/updatedAt'] },
    );

    // The list refreshed (the second mock resolution) so the retroactive
    // re-disposition shows.
    await waitFor(() =>
      expect(reconApi.getReconciliationBreaks).toHaveBeenCalledTimes(2),
    );
  });
});
