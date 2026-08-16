/**
 * MigrationProgressReport render tests (2026-08-16).
 *
 * Coverage (the load-bearing behaviours only):
 *   1. POPULATED: banner identity + stage cells (status -> icon/background
 *      class), facts panel with Matching? verdicts, bucket cells with the
 *      right condition tiers + inline percentages, views/procs cells, the
 *      per-operation strip.
 *   2. TBC (pre-execution): target / Matching? / bucket cells render the grey
 *      `[TBC - execute migration plan]` treatment while current-state facts
 *      populate; unstarted stages carry the error treatment (banner is never
 *      grey).
 *   3. Scope: a DB-only summary renders no service section.
 *
 * Conventions mirror MigrationDeliveryReconciliationPanel.test.tsx: vi.mock
 * the CSS module via a Proxy; the summary fetch is injected via the
 * `fetchSummaryFn` test seam so the render is deterministic + offline.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationProgressReport.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationProgressReport } from '../MigrationProgressReport';
import type { MigrationProgressSummaryDto } from '../../../../api/migrationProgressReportApi';

function populatedSummary(): MigrationProgressSummaryDto {
  return {
    productName: null,
    currentStateLabel: 'Sybase',
    targetStateLabel: 'PostgreSQL 18 / Java 21',
    scope: { db: true, service: true },
    executed: false,
    stages: [
      { key: 'db_discovery', label: 'DB discovery', status: 'complete', facts: ['172 arch entities', '214 findings'] },
      { key: 'code_discovery', label: 'Code/logs discovery', status: 'complete', facts: ['112 arch entities', '389 findings'] },
      { key: 'live_behaviour', label: 'Live behaviour', status: 'complete', facts: ['45 endpoints', '417 captured behaviours'] },
      { key: 'target_conversation', label: 'Target conversation', status: 'complete', facts: ['47 questions answered'] },
      { key: 'plan_created', label: 'Migration Plan Created', status: 'complete', facts: ['12 DB specs', '20 service specs'] },
      { key: 'plan_executed', label: 'Migration Plan Executed', status: 'in_progress', facts: ['31/32 specs'] },
      { key: 'reconciliation', label: 'Reconciliation', status: 'in_progress', facts: ['in progress'] },
    ],
    db: {
      current: { tables: 120, rows: 4213882, views: 14, procs: 38 },
      target: { tables: 120, rows: 4198441, views: 12, procs: 31 },
      buckets: { failedToLoad: 2, rowCountMismatch: 3, dataMismatch: 1, fullyReconciled: 114 },
      viewsMigrated: 12,
      procsMigrated: 31,
    },
    service: {
      current: { interfaces: 6, endpoints: 45 },
      target: null,
      buckets: { failedToMigrate: 1, failedReconciliation: 3, fullyReconciled: 41 },
      perOperation: { replayed: 417, matching: 402, underInvestigation: 9, accepted: 4, fixed: 2 },
    },
    warnings: [],
  };
}

function tbcSummary(): MigrationProgressSummaryDto {
  const base = populatedSummary();
  return {
    ...base,
    stages: base.stages.map((s) =>
      s.key === 'plan_created' || s.key === 'plan_executed' || s.key === 'reconciliation'
        ? { ...s, status: 'not_started', facts: ['not started'] }
        : s,
    ),
    db: {
      current: { tables: 120, rows: null, views: 14, procs: 38 },
      target: null,
      buckets: null,
      viewsMigrated: null,
      procsMigrated: null,
    },
    service: {
      current: { interfaces: 6, endpoints: 45 },
      target: null,
      buckets: null,
      perOperation: null,
    },
  };
}

function renderReport(dto: MigrationProgressSummaryDto) {
  const fetchSummaryFn = vi.fn().mockResolvedValue(dto);
  render(
    <MigrationProgressReport
      projectId="proj-1"
      architectureId="arch-1"
      bookId="book-1"
      productName="HiFi Migration"
      fetchSummaryFn={fetchSummaryFn}
    />,
  );
  return fetchSummaryFn;
}

describe('MigrationProgressReport', () => {
  it('renders the banner identity, stage statuses, tiers and the per-operation strip', async () => {
    const fetchSummaryFn = renderReport(populatedSummary());
    await waitFor(() => expect(screen.getByTestId('mpr-page')).toBeTruthy());
    expect(fetchSummaryFn).toHaveBeenCalledWith('proj-1', 'arch-1', 'book-1');

    // Identity line.
    expect(screen.getByText('HiFi Migration')).toBeTruthy();
    expect(screen.getByText('Sybase')).toBeTruthy();
    expect(screen.getByText('PostgreSQL 18 / Java 21')).toBeTruthy();

    // Stage cells carry status (drives icon + background class).
    expect(screen.getByTestId('mpr-stage-db_discovery').getAttribute('data-status')).toBe('complete');
    expect(screen.getByTestId('mpr-stage-plan_executed').getAttribute('data-status')).toBe('in_progress');
    expect(screen.getByText('31/32 specs')).toBeTruthy();
    expect(screen.getByText('417 captured behaviours')).toBeTruthy();

    // DB facts + Matching? verdicts: tables equal -> true, rows differ -> false.
    expect(screen.getByTestId('mpr-db-tables-matching').textContent).toBe('true');
    expect(screen.getByTestId('mpr-db-rows-matching').textContent).toBe('false');

    // Bucket tiers + the one consistent `X of Y (Z%)` format (2026-08-16).
    const failedLoad = screen.getByTestId('mpr-db-bucket-failed-load');
    expect(failedLoad.getAttribute('data-tier')).toBe('yellow');
    expect(failedLoad.textContent).toContain('2 of 120 (1.7%)');
    expect(screen.getByTestId('mpr-db-bucket-reconciled').getAttribute('data-tier')).toBe('light-green'); // 114/120 = 95%
    expect(screen.getByTestId('mpr-db-bucket-reconciled').textContent).toContain('114 of 120 (95%)');
    // Positive MIGRATED cells on the desired (fully-reconciled) ladder.
    expect(screen.getByTestId('mpr-db-views-migrated').getAttribute('data-tier')).toBe('yellow'); // 12 of 14 = 86%
    expect(screen.getByTestId('mpr-db-views-migrated').textContent).toContain('Views migrated');
    expect(screen.getByTestId('mpr-db-views-migrated').textContent).toContain('12 of 14 (86%)');
    expect(screen.getByTestId('mpr-db-procs-migrated').getAttribute('data-tier')).toBe('light-orange'); // 31 of 38 = 82%

    // Service buckets partition the 45 endpoints; strip renders the rollup.
    expect(screen.getByTestId('mpr-service-bucket-reconciled').textContent).toContain('41 of 45 (91%)');
    expect(screen.getByTestId('mpr-per-operation').textContent).toContain('Replayed 417 operations:');
    expect(screen.getByTestId('mpr-per-operation').textContent).toContain('9 under investigation');

    // Service plane not deployed -> its target cells are TBC even mid-run.
    expect(screen.getByTestId('mpr-service-endpoints-target').textContent).toContain('TBC - execute migration plan');
  });

  it('pre-execution: sections render grey TBC cells while the banner keeps full stage treatment', async () => {
    renderReport(tbcSummary());
    await waitFor(() => expect(screen.getByTestId('mpr-page')).toBeTruthy());

    // Banner: unstarted stages carry the error treatment, never grey.
    expect(screen.getByTestId('mpr-stage-plan_executed').getAttribute('data-status')).toBe('not_started');
    expect(screen.getByTestId('mpr-stage-reconciliation').getAttribute('data-status')).toBe('not_started');

    // Current facts populate; current rows is the one TBC current cell.
    expect(screen.getByTestId('mpr-db-tables-current').textContent).toContain('120');
    expect(screen.getByTestId('mpr-db-rows-current').textContent).toContain('TBC - execute migration plan');

    // Target + Matching? + buckets are all TBC.
    expect(screen.getByTestId('mpr-db-tables-target').textContent).toContain('TBC - execute migration plan');
    expect(screen.getByTestId('mpr-db-tables-matching').textContent).toBe('[TBC]');
    expect(screen.getByTestId('mpr-db-bucket-failed-load').textContent).toContain('[TBC]');
    expect(screen.getByTestId('mpr-service-bucket-reconciled').textContent).toContain('[TBC]');
    expect(screen.getByTestId('mpr-per-operation').textContent).toContain('TBC - execute migration plan');
  });

  it('opens the run-reconciliation modal from the banner button', async () => {
    renderReport(populatedSummary());
    await waitFor(() => expect(screen.getByTestId('mpr-page')).toBeTruthy());
    expect(screen.queryByTestId('rrm-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('mpr-run-reconciliation'));
    expect(screen.getByTestId('rrm-modal')).toBeTruthy();
    // Both recs are in scope -> both field groups offered.
    expect(screen.getByTestId('rrm-db-fields')).toBeTruthy();
    expect(screen.getByTestId('rrm-api-fields')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rrm-cancel'));
    expect(screen.queryByTestId('rrm-modal')).toBeNull();
  });

  it('renders only the DB section for a DB-only scope', async () => {
    const dto = populatedSummary();
    dto.scope = { db: true, service: false };
    dto.service = null;
    dto.stages = dto.stages.filter(
      (s) => s.key !== 'code_discovery' && s.key !== 'live_behaviour',
    );
    renderReport(dto);
    await waitFor(() => expect(screen.getByTestId('mpr-page')).toBeTruthy());
    expect(screen.getByTestId('mpr-db-section')).toBeTruthy();
    expect(screen.queryByTestId('mpr-service-section')).toBeNull();
    expect(screen.queryByTestId('mpr-stage-live_behaviour')).toBeNull();
  });
});
