/**
 * DbMigrationPackDriftReports tests
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.1, drift piece — DriftReportTab conventions).
 *
 * Focused coverage ONLY: the drift tab renders the persisted run-history
 * list with per-run summary chips (match/missing/mismatch) and opens the
 * expected-vs-actual detail drawer for a mismatch row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-drift-1';
const PACK_ID = 'pack-drift-1';

vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockListDriftReports = vi.fn();
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPackDriftReports: (...args: unknown[]) =>
      mockListDriftReports(...args),
  };
});

import { DbMigrationPackDriftReports } from '../DbMigrationPackDriftReports';
import type { DbMigrationPackDriftReportDto } from '../../../../api/dbMigrationPackApi';

const NEWEST_RUN: DbMigrationPackDriftReportDto = {
  id: 'run-2',
  pack_id: PACK_ID,
  scan_scope_json: { schemas: ['dbo'] },
  match_count: 5,
  missing_count: 1,
  mismatch_count: 1,
  report_json: {
    classification_version: 1,
    objects: [
      {
        object_type: 'table',
        object_ref: 'dbo.orders',
        classification: 'match',
      },
      {
        object_type: 'table',
        object_ref: 'dbo.audit_log',
        classification: 'missing',
      },
      {
        object_type: 'column',
        object_ref: 'dbo.orders.total',
        classification: 'mismatch',
        details: [
          { property: 'data_type', expected: 'numeric(19,4)', actual: 'numeric(10,2)' },
          { property: 'is_nullable', expected: 'false', actual: 'true' },
        ],
      },
    ],
    unexpected_in_target: [
      { object_type: 'table', object_ref: 'dbo.scratch_tmp', detail: null },
    ],
    summary: {
      match_count: 5,
      missing_count: 1,
      mismatch_count: 1,
      unexpected_count: 1,
    },
  },
  source: 'in_tool',
  created_at: '2026-06-11T12:00:00Z',
};

const OLDER_RUN: DbMigrationPackDriftReportDto = {
  ...NEWEST_RUN,
  id: 'run-1',
  scan_scope_json: null,
  match_count: 7,
  missing_count: 0,
  mismatch_count: 0,
  created_at: '2026-06-10T09:00:00Z',
};

beforeEach(() => {
  mockListDriftReports.mockReset();
});

describe('DbMigrationPackDriftReports (Task 6.1)', () => {
  it('renders the run-history list with summary chips and opens the mismatch detail drawer', async () => {
    mockListDriftReports.mockResolvedValue([OLDER_RUN, NEWEST_RUN]);

    render(
      <DbMigrationPackDriftReports projectId={PROJECT_ID} packId={PACK_ID} />,
    );

    // Both persisted runs render in the history (append-only audit trail).
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-drift-run-run-2')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-drift-run-run-1')).toBeInTheDocument();

    // Per-run summary chips carry the match/missing/mismatch counts.
    expect(screen.getByTestId('db-pack-drift-run-run-2-match')).toHaveTextContent(
      '5 match',
    );
    expect(
      screen.getByTestId('db-pack-drift-run-run-2-missing'),
    ).toHaveTextContent('1 missing');
    expect(
      screen.getByTestId('db-pack-drift-run-run-2-mismatch'),
    ).toHaveTextContent('1 mismatch');

    // The newest run is selected by default; its object table renders the
    // classification badges, incl. the informational unexpected section.
    const rows = screen.getAllByTestId('db-pack-drift-object-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId('db-pack-drift-unexpected')).toHaveTextContent(
      'dbo.scratch_tmp',
    );

    // Opening the mismatch detail drawer shows the structured
    // expected-vs-actual property diff.
    fireEvent.click(
      screen.getByTestId('db-pack-drift-view-detail-dbo.orders.total'),
    );
    expect(
      screen.getByTestId('db-pack-drift-detail-drawer'),
    ).toBeInTheDocument();
    const detailRows = screen.getAllByTestId('db-pack-drift-detail-row');
    expect(detailRows).toHaveLength(2);
    expect(detailRows[0]).toHaveTextContent('data_type');
    expect(detailRows[0]).toHaveTextContent('numeric(19,4)');
    expect(detailRows[0]).toHaveTextContent('numeric(10,2)');

    fireEvent.click(screen.getByTestId('db-pack-drift-detail-close'));
    expect(
      screen.queryByTestId('db-pack-drift-detail-drawer'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty state when no verification runs exist yet', async () => {
    mockListDriftReports.mockResolvedValue([]);

    render(
      <DbMigrationPackDriftReports projectId={PROJECT_ID} packId={PACK_ID} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-drift-empty')).toBeInTheDocument(),
    );
  });
});
