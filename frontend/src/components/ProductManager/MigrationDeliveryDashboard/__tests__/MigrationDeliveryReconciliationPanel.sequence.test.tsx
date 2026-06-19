/**
 * MigrationDeliveryReconciliationPanel -- stateful-sequence surfacing
 * (Spec D, 2026-06-18, Task Group 4).
 *
 * A sequence break is the sequence's ACT step fully diffed, so it pairs +
 * classifies like a single-shot break; the panel additionally surfaces, read
 * defensively off the break detail:
 *   - that the break came from a sequence act step
 *   - the residual-pollution / cleanup-failed flags
 *   - the sequence diagnostics (skipped / setup-failed / cleanup-failed /
 *     residual-pollution)
 * A break with NO sequence fields (every single-shot break) renders unchanged.
 *
 * Conventions mirror MigrationDeliveryReconciliationPanel.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

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
    detail_json: {
      method: 'POST',
      path: '/filters/submitForReview',
      summary: 'body drift on act step',
    },
    disposition_status: reconApi.BREAK_DISPOSITION.OPEN,
    bug_id: null,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    error_detail: null,
    ...partial,
  };
}

function renderPanel() {
  return render(
    <MigrationDeliveryReconciliationPanel
      projectId={PROJECT_ID}
      runId={RUN_ID}
      company="Acme"
      project="Widgets"
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryReconciliationPanel -- sequence surfacing (Spec D)', () => {
  it('surfaces a sequence act-step break with cleanup-failed + residual-pollution + the sequence diagnostics', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'b-seq',
        detail_json: {
          method: 'POST',
          path: '/filters/submitForReview',
          summary: 'body drift on act step',
          from_sequence: true,
          sequence_cleanup_failed: true,
          sequence_residual_pollution: true,
          sequence_diagnostics: [
            {
              diagnostic_type: 'sequence_cleanup_failed',
              message: 'DELETE /filters/42 returned 500',
            },
            {
              diagnostic_type: 'sequence_residual_pollution',
              message: 'created 1 resource with no cleanup endpoint',
            },
          ],
        },
      }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-recon-break-sequence-b-seq'),
      ).toBeInTheDocument(),
    );

    // "From sequence act step" badge.
    expect(
      screen.getByTestId('mdd-recon-break-sequence-badge-b-seq'),
    ).toBeInTheDocument();

    // Cleanup-failed + residual-pollution flags.
    expect(
      screen.getByTestId('mdd-recon-break-sequence-cleanup-failed-b-seq'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-recon-break-sequence-residual-pollution-b-seq'),
    ).toBeInTheDocument();

    // The sequence diagnostics list with both entries + their messages.
    const diagList = screen.getByTestId(
      'mdd-recon-break-sequence-diagnostics-b-seq',
    );
    expect(diagList).toHaveTextContent('Sequence cleanup failed');
    expect(diagList).toHaveTextContent('DELETE /filters/42 returned 500');
    expect(diagList).toHaveTextContent('Residual pollution');
    expect(
      screen.getByTestId(
        'mdd-recon-break-sequence-diagnostic-b-seq-sequence_cleanup_failed',
      ),
    ).toBeInTheDocument();
  });

  it('renders a single-shot break unchanged (no sequence block)', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({ id: 'b-plain' }),
    ]);

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-recon-break-row-b-plain'),
      ).toBeInTheDocument(),
    );

    // The single-shot break carries no sequence signals -> no sequence block.
    expect(
      screen.queryByTestId('mdd-recon-break-sequence-b-plain'),
    ).not.toBeInTheDocument();
  });
});
