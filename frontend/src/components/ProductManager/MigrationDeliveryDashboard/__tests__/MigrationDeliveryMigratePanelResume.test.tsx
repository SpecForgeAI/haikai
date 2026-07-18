/**
 * MigrationDeliveryMigratePanel — phased-execution "approve & continue" (Spec W).
 *
 * When a run is PAUSED at a plane boundary (status `awaiting_approval`), the
 * panel surfaces an approve button that resumes the run (dispatching the next
 * plane). A DB-plane data-parity `blocked` result lists the divergences and
 * offers an override.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MigrationDeliveryMigratePanel } from '../MigrationDeliveryMigratePanel';
import type {
  MigrationExecutionRunDto,
  ResumeMigrationResult,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function pausedRun(): MigrationExecutionRunDto {
  return {
    id: 'run-1',
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: 'awaiting_approval',
    current_sequence_position: 0,
    items: [
      { id: 'ri-0', sequence_position: 0, spec_name: 'DB schema', status: 'deployed', outcome: 'deployed' },
      { id: 'ri-1', sequence_position: 1, spec_name: 'Customer API', status: 'pending' },
    ],
  };
}

function renderPanel(opts: {
  fetchLatestRunFn: ReturnType<typeof vi.fn>;
  resumeRunFn: ReturnType<typeof vi.fn>;
}) {
  return render(
    <MigrationDeliveryMigratePanel
      projectId={PROJECT_ID}
      bookId={BOOK_ID}
      hierarchy={[]}
      deferredWorkItemIds={new Set()}
      hasActiveCurrentBaseline
      company="acme"
      project="order-mig"
      fetchLatestRunFn={opts.fetchLatestRunFn as never}
      resumeRunFn={opts.resumeRunFn as never}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MigrationDeliveryMigratePanel — approve & continue (Spec W)', () => {
  it('shows the pause banner for an awaiting_approval run and resumes on approve', async () => {
    const fetchLatestRunFn = vi
      .fn()
      .mockResolvedValueOnce(pausedRun())
      // After the resume, loadRun re-reads: now dispatching (no longer paused).
      .mockResolvedValue({ ...pausedRun(), status: 'dispatching' });
    const resumeRunFn = vi
      .fn()
      .mockResolvedValue({ status: 'resumed', nextPlane: 'service' } as ResumeMigrationResult);

    renderPanel({ fetchLatestRunFn, resumeRunFn });

    // The pause banner + approve button appear once the run loads.
    await waitFor(() => {
      expect(screen.getByTestId('mdd-migrate-run-paused')).toBeInTheDocument();
    });
    const approve = screen.getByTestId('mdd-migrate-approve-continue');
    fireEvent.click(approve);

    await waitFor(() => {
      expect(resumeRunFn).toHaveBeenCalledWith(PROJECT_ID, 'run-1', {
        company: 'acme',
        project: 'order-mig',
        override: false,
      });
    });
    // loadRun re-fetched; the run is no longer paused.
    await waitFor(() => {
      expect(screen.queryByTestId('mdd-migrate-run-paused')).not.toBeInTheDocument();
    });
  });

  it('surfaces a DB-plane data-parity block and resumes with override', async () => {
    const fetchLatestRunFn = vi.fn().mockResolvedValue(pausedRun());
    const resumeRunFn = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'blocked',
        reasons: [{ code: 'data_parity_failed', message: 'Table dbo.orders diverges (12 rows).' }],
      } as ResumeMigrationResult)
      .mockResolvedValue({ status: 'resumed', nextPlane: 'service' } as ResumeMigrationResult);

    renderPanel({ fetchLatestRunFn, resumeRunFn });

    await waitFor(() => {
      expect(screen.getByTestId('mdd-migrate-approve-continue')).toBeInTheDocument();
    });

    // First approve -> blocked: the divergences + override affordance render.
    fireEvent.click(screen.getByTestId('mdd-migrate-approve-continue'));
    await waitFor(() => {
      expect(screen.getByTestId('mdd-migrate-approve-blocked')).toHaveTextContent(
        'Table dbo.orders diverges'
      );
    });

    // Override -> resume is called with override: true.
    fireEvent.click(screen.getByTestId('mdd-migrate-approve-override'));
    await waitFor(() => {
      expect(resumeRunFn).toHaveBeenLastCalledWith(PROJECT_ID, 'run-1', {
        company: 'acme',
        project: 'order-mig',
        override: true,
      });
    });
  });

  it('does not show the pause banner for a non-paused run', async () => {
    const fetchLatestRunFn = vi
      .fn()
      .mockResolvedValue({ ...pausedRun(), status: 'dispatching' });
    const resumeRunFn = vi.fn();

    renderPanel({ fetchLatestRunFn, resumeRunFn });

    await waitFor(() => {
      expect(screen.getByTestId('mdd-migrate-run-progress')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mdd-migrate-run-paused')).not.toBeInTheDocument();
    expect(resumeRunFn).not.toHaveBeenCalled();
  });
});
