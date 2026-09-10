/**
 * MigrationProgressReport (2026-08-16)
 *
 * The stakeholder-facing, single-screen migration progress report:
 *
 *   /projects/:projectId/architectures/:architectureId
 *     /migration-books-of-work/:bookId/progress
 *
 * Three areas, ALL deterministic (the gateway aggregation reads persisted
 * report data only — no LLM, no credentials, recomputed on every load):
 *
 *   1. BANNER — one identity line (product / current state / target state)
 *      plus the 7-cell pipeline stepper. The banner ALWAYS renders every
 *      in-scope stage: complete = tick on light green, in progress = warning
 *      on light yellow, not started / failed = error X on very light red.
 *      It never greys out.
 *   2. DATABASE RECONCILIATION — current vs target facts (40/40/20 with the
 *      Matching? column), the worst->best table buckets, views/procs rows.
 *   3. SERVICE (API) RECONCILIATION — interfaces/endpoints facts, the
 *      worst->best endpoint buckets, the per-operation break rollup.
 *
 * Grey `[TBC - execute migration plan]` cells appear ONLY in the two
 * reconciliation sections: every target / Matching? / bucket cell stays TBC
 * until the plan execution produced the underlying report data; current-state
 * facts populate as soon as their source stage completes (current Total rows
 * is the one exception — row counts only enter the system via the load
 * report). Sections render only for planes in the book's scope.
 *
 * Colour rules live in `progressReportColours.ts` (pure, unit-tested); this
 * component only maps tiers to CSS-module classes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getMigrationProgressSummary,
  startManualReconciliation,
  type DbSectionDto,
  type MigrationProgressSummaryDto,
  type ProgressStageDto,
  type ServiceSectionDto,
} from '../../../api/migrationProgressReportApi';
import { RunReconciliationModal } from './RunReconciliationModal';
import {
  formatCountOfTotal,
  matchingTier,
  reconciledTier,
  undesiredTier,
  type ConditionTier,
} from './progressReportColours';
import styles from './MigrationProgressReport.module.css';

export const TBC_LABEL = 'TBC - execute migration plan';

const TIER_CLASS: Record<ConditionTier, keyof typeof styles> = {
  'medium-green': 'tierMediumGreen',
  'light-green': 'tierLightGreen',
  yellow: 'tierYellow',
  'light-orange': 'tierLightOrange',
  'medium-orange': 'tierMediumOrange',
  'medium-red': 'tierMediumRed',
};

function tierClass(tier: ConditionTier): string {
  return styles[TIER_CLASS[tier]];
}

const STAGE_ICON: Record<ProgressStageDto['status'], string> = {
  complete: '✓', // ✓
  in_progress: '⚠', // ⚠
  not_started: '✗', // ✗
  failed: '✗', // ✗
};

const STAGE_CELL_CLASS: Record<ProgressStageDto['status'], keyof typeof styles> = {
  complete: 'stageComplete',
  in_progress: 'stageInProgress',
  not_started: 'stageNotStarted',
  failed: 'stageNotStarted',
};

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export interface MigrationProgressReportProps {
  projectId: string;
  architectureId: string;
  bookId: string;
  /** The product/project display name for the identity line. */
  productName: string;
  /** Test seam: the summary fetch (defaults to the real client). */
  fetchSummaryFn?: typeof getMigrationProgressSummary;
  /** Test seam: the manual reconciliation trigger (defaults to the real client). */
  startReconciliationFn?: typeof startManualReconciliation;
}

export function MigrationProgressReport({
  projectId,
  architectureId,
  bookId,
  productName,
  fetchSummaryFn = getMigrationProgressSummary,
  startReconciliationFn = startManualReconciliation,
}: MigrationProgressReportProps) {
  const [summary, setSummary] = useState<MigrationProgressSummaryDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciliationOpen, setReconciliationOpen] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dto = await fetchSummaryFn(projectId, architectureId, bookId);
      setSummary(dto);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the progress report');
    } finally {
      setLoading(false);
    }
  }, [projectId, architectureId, bookId, fetchSummaryFn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className={styles.page} data-testid="mpr-loading">
        Loading migration progress…
      </div>
    );
  }
  if (error || !summary) {
    return (
      <div className={styles.page} data-testid="mpr-error">
        <div className={styles.errorBox}>
          <span>{error ?? 'The progress report could not be loaded.'}</span>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // DB-ONLY (Spec 5, 2026-09-09): a book with no service plane must render as
  // a complete report, not a half-empty one. `.page` is a single-column flex,
  // so an absent service section leaves NO blank column or gap — the DB
  // section spans the full width on its own. `data-layout` states which shape
  // rendered so the layout is asserted, never assumed.
  const serviceSectionRenders = summary.service !== null && summary.scope.service;

  return (
    <div
      className={styles.page}
      data-testid="mpr-page"
      data-layout={serviceSectionRenders ? 'db-and-service' : 'db-only'}
    >
      <Banner
        summary={summary}
        productName={productName}
        onRunReconciliation={() => setReconciliationOpen(true)}
      />
      {summary.db && summary.scope.db && <DbSectionView db={summary.db} />}
      {serviceSectionRenders && summary.service && (
        <ServiceSectionView service={summary.service} />
      )}
      {summary.warnings.length > 0 && (
        <div className={styles.warnings} data-testid="mpr-warnings">
          {summary.warnings.join(' ')}
        </div>
      )}
      {reconciliationOpen && (
        <RunReconciliationModal
          projectId={projectId}
          architectureId={architectureId}
          bookId={bookId}
          scope={summary.scope}
          startFn={startReconciliationFn}
          onClose={(ranAny) => {
            setReconciliationOpen(false);
            if (ranAny) void load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Banner
// ============================================================================

function Banner({
  summary,
  productName,
  onRunReconciliation,
}: {
  summary: MigrationProgressSummaryDto;
  productName: string;
  onRunReconciliation: () => void;
}) {
  const stages = summary.stages;
  return (
    <div className={styles.banner} data-testid="mpr-banner">
      <div className={styles.identityLine}>
        <span className={styles.identityItem}>
          <span className={styles.identityLabel}>Product name:</span> {productName || '—'}
        </span>
        <span className={styles.identityItem}>
          <span className={styles.identityLabel}>Current state:</span>{' '}
          {summary.currentStateLabel ?? '—'}
        </span>
        <span className={styles.identityArrow}>{'→'}</span>
        <span className={styles.identityItem}>
          <span className={styles.identityLabel}>Target state:</span>{' '}
          {summary.targetStateLabel ?? '—'}
        </span>
        <button
          type="button"
          className={styles.runRecButton}
          data-testid="mpr-run-reconciliation"
          onClick={onRunReconciliation}
        >
          Run reconciliation…
        </button>
      </div>
      <div
        className={styles.stepper}
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        data-testid="mpr-stepper"
      >
        {stages.map((stage) => (
          <div
            key={stage.key}
            className={`${styles.stageCell} ${styles[STAGE_CELL_CLASS[stage.status]]}`}
            data-testid={`mpr-stage-${stage.key}`}
            data-status={stage.status}
          >
            <div className={styles.stageName}>
              {stage.label}{' '}
              <span className={styles.stageIcon} aria-hidden="true">
                {STAGE_ICON[stage.status]}
              </span>
            </div>
            <div className={styles.stageFact}>{stage.facts[0] ?? ' '}</div>
            <div className={styles.stageFact}>{stage.facts[1] ?? ' '}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Shared facts panel (current 40% | target 40% | Matching? 20%)
// ============================================================================

interface FactRow {
  key: string;
  label: string;
  current: number | null;
  /** Null when the whole target block is TBC OR the single field is unknown. */
  target: number | null;
  targetBlockTbc: boolean;
}

function FactsPanel({ rows, testIdPrefix }: { rows: FactRow[]; testIdPrefix: string }) {
  return (
    <div className={styles.factsGrid}>
      <div className={`${styles.factsCell} ${styles.factsHeader}`}>CURRENT STATE</div>
      <div className={`${styles.factsCell} ${styles.factsHeader}`}>TARGET STATE</div>
      <div className={`${styles.factsCell} ${styles.factsHeader}`}>MATCHING?</div>
      {rows.map((row) => {
        const currentKnown = row.current !== null;
        const targetKnown = !row.targetBlockTbc && row.target !== null;
        const matchKnown = currentKnown && targetKnown;
        const matches = matchKnown && row.current === row.target;
        return (
          <FactsPanelRow
            key={row.key}
            row={row}
            currentKnown={currentKnown}
            targetKnown={targetKnown}
            matchKnown={matchKnown}
            matches={matches}
            testIdPrefix={testIdPrefix}
          />
        );
      })}
    </div>
  );
}

function FactsPanelRow({
  row,
  currentKnown,
  targetKnown,
  matchKnown,
  matches,
  testIdPrefix,
}: {
  row: FactRow;
  currentKnown: boolean;
  targetKnown: boolean;
  matchKnown: boolean;
  matches: boolean;
  testIdPrefix: string;
}) {
  return (
    <>
      <div
        className={`${styles.factsCell} ${currentKnown ? '' : styles.tbcCell}`}
        data-testid={`${testIdPrefix}-${row.key}-current`}
      >
        <span className={styles.factsLabel}>{row.label}</span>
        <span className={styles.factsValue}>
          {currentKnown ? formatNumber(row.current as number) : `[${TBC_LABEL}]`}
        </span>
      </div>
      <div
        className={`${styles.factsCell} ${targetKnown ? '' : styles.tbcCell}`}
        data-testid={`${testIdPrefix}-${row.key}-target`}
      >
        <span className={styles.factsLabel}>{row.label}</span>
        <span className={styles.factsValue}>
          {targetKnown ? formatNumber(row.target as number) : `[${TBC_LABEL}]`}
        </span>
      </div>
      <div
        className={`${styles.factsCell} ${styles.matchCell} ${
          matchKnown ? tierClass(matchingTier(matches)) : styles.tbcCell
        }`}
        data-testid={`${testIdPrefix}-${row.key}-matching`}
      >
        {matchKnown ? String(matches) : '[TBC]'}
      </div>
    </>
  );
}

// ============================================================================
// Bucket cells (worst -> best strips)
// ============================================================================

/** `82%` / `1.7%` — the same one-decimal-below-10 convention the cells use. */
function formatPercent(pct: number): string {
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function BucketCell({
  label,
  value,
  total,
  kind,
  testId,
  pct,
  pctTestId,
}: {
  label: string;
  value: number | null;
  total: number | null;
  kind: 'undesired' | 'reconciled';
  testId: string;
  /**
   * Spec 5 (2026-09-09): a server-PRE-COMPUTED percentage. When `pctTestId` is
   * given the value renders in the same `X of Y (Z%)` shape but the `(Z%)`
   * half is its own addressable span — so the cell shows the server's number
   * (the authority on the denominator) rather than a second derivation.
   */
  pct?: number | null;
  pctTestId?: string;
}) {
  if (value === null) {
    return (
      <div className={`${styles.bucketCell} ${styles.tbcCell}`} data-testid={testId}>
        <span className={styles.bucketLabel}>{label}:</span>
        <span className={styles.bucketValue}>[TBC]</span>
      </div>
    );
  }
  const tier = kind === 'undesired' ? undesiredTier(value, total) : reconciledTier(value, total);
  const hasDenominator = total !== null && total > 0;
  return (
    <div className={`${styles.bucketCell} ${tierClass(tier)}`} data-testid={testId} data-tier={tier}>
      <span className={styles.bucketLabel}>{label}:</span>
      {pctTestId ? (
        <span className={styles.bucketValue}>
          {hasDenominator
            ? `${value.toLocaleString()} of ${(total as number).toLocaleString()} `
            : `${value.toLocaleString()} `}
          <span className={styles.bucketPct} data-testid={pctTestId}>
            {pct !== null && pct !== undefined
              ? `(${formatPercent(pct)})`
              : hasDenominator
                ? `(${formatPercent((value / (total as number)) * 100)})`
                : '(n/a)'}
          </span>
        </span>
      ) : (
        <span className={styles.bucketValue}>{formatCountOfTotal(value, total)}</span>
      )}
    </div>
  );
}

// ============================================================================
// DATABASE RECONCILIATION
// ============================================================================

function DbSectionView({ db }: { db: DbSectionDto }) {
  const targetTbc = db.target === null;
  const rows: FactRow[] = [
    { key: 'tables', label: 'Total tables', current: db.current.tables, target: db.target?.tables ?? null, targetBlockTbc: targetTbc },
    { key: 'rows', label: 'Total rows', current: db.current.rows, target: db.target?.rows ?? null, targetBlockTbc: targetTbc },
    { key: 'views', label: 'Total views', current: db.current.views, target: db.target?.views ?? null, targetBlockTbc: targetTbc },
    { key: 'procs', label: 'Total stored procs', current: db.current.procs, target: db.target?.procs ?? null, targetBlockTbc: targetTbc },
    // Spec 5 (2026-09-09): the CATALOG routine count. Target = the RECONCILED
    // routines, so Matching? reads "every routine the target owes is proven".
    { key: 'routines', label: 'Stored procs & functions (catalog)', current: db.current.routines ?? null, target: db.target?.routines ?? null, targetBlockTbc: targetTbc },
  ];
  const total = db.current.tables;
  // Spec 5: RECONCILED is the bar, not "migrated". The old `procsMigrated` /
  // `current.procs` pair is the one-release fallback for an older gateway.
  const procRec = db.procsMigratedReconciled ?? null;
  const procValue = procRec ? procRec.reconciled : db.procsMigrated;
  const procTotal = procRec ? procRec.total : db.current.procs;
  const procBuckets = db.procBuckets ?? null;
  const outOfScope = procBuckets
    ? { movedToCode: procBuckets.movedToCode, dropped: procBuckets.dropped }
    : null;
  return (
    <section className={styles.section} data-testid="mpr-db-section">
      <div className={styles.sectionTitle}>DATABASE RECONCILIATION</div>
      {/* Foundations Spec 4 (2026-08-22): excluded tables are an EXPLICIT
          slice — counted in neither numerator nor denominator, never
          silently absent. */}
      {db.scope_receipt &&
        (db.scope_receipt.excluded_count > 0 || db.scope_receipt.volatile_count > 0) && (
          <div
            data-testid="mpr-db-scope-receipt"
            style={{ color: '#555', fontSize: 13, margin: '2px 0 6px' }}
          >
            {db.scope_receipt.note}
          </div>
        )}
      <FactsPanel rows={rows} testIdPrefix="mpr-db" />
      <div className={styles.stripTitle}>
        Tables — worst to best{total !== null ? ` (sums to the ${formatNumber(total)} current-state tables)` : ''}
      </div>
      <div className={`${styles.bucketRow} ${styles.bucketRow4}`}>
        <BucketCell label="Failed to load" value={db.buckets?.failedToLoad ?? null} total={total} kind="undesired" testId="mpr-db-bucket-failed-load" />
        <BucketCell label="Row-count mismatch" value={db.buckets?.rowCountMismatch ?? null} total={total} kind="undesired" testId="mpr-db-bucket-count-mismatch" />
        <BucketCell label="Data mismatches" value={db.buckets?.dataMismatch ?? null} total={total} kind="undesired" testId="mpr-db-bucket-data-mismatch" />
        <BucketCell label="Fully reconciled" value={db.buckets?.fullyReconciled ?? null} total={total} kind="reconciled" testId="mpr-db-bucket-reconciled" />
      </div>
      {/* Positive phrasing (2026-08-16): MIGRATED counts on the desired
          (fully-reconciled) colour ladder — 100% is medium green. */}
      <div className={`${styles.bucketRow} ${styles.bucketRow2}`}>
        <BucketCell label="Views migrated" value={db.viewsMigrated} total={db.current.views} kind="reconciled" testId="mpr-db-views-migrated" />
        <BucketCell
          label={procRec ? 'Stored procs migrated/reconciled' : 'Stored procs migrated'}
          value={procValue}
          total={procTotal}
          kind="reconciled"
          testId="mpr-db-procs-migrated"
          pct={procRec ? procRec.pct : undefined}
          pctTestId="mpr-db-procs-reconciled-pct"
        />
      </div>
      {/* Stored procs & functions, worst -> best (Spec 5, 2026-09-09). The six
          in-scope buckets partition the same denominator as the cell above;
          dispositioned routines (moved to code / dropped) sit OUTSIDE it as a
          named aside so nothing goes silently missing. */}
      {procBuckets && (
        <>
          <div className={styles.stripTitle}>
            Stored procs — worst to best
            {procTotal !== null ? ` (sums to the ${formatNumber(procTotal)} in-scope routines)` : ''}
          </div>
          <div className={`${styles.bucketRow} ${styles.bucketRow6}`}>
            <BucketCell label="Not captured" value={procBuckets.notCaptured} total={procTotal} kind="undesired" testId="mpr-db-proc-bucket-not-captured" />
            <BucketCell label="Divergent" value={procBuckets.divergent} total={procTotal} kind="undesired" testId="mpr-db-proc-bucket-divergent" />
            <BucketCell label="Unverified" value={procBuckets.unverified} total={procTotal} kind="undesired" testId="mpr-db-proc-bucket-unverified" />
            <BucketCell label="Not migrated" value={procBuckets.notMigrated} total={procTotal} kind="undesired" testId="mpr-db-proc-bucket-not-migrated" />
            <BucketCell label="Reconciled with waivers" value={procBuckets.reconciledWithWaivers} total={procTotal} kind="reconciled" testId="mpr-db-proc-bucket-waived" />
            <BucketCell label="Fully reconciled" value={procBuckets.fullyReconciled} total={procTotal} kind="reconciled" testId="mpr-db-proc-bucket-reconciled" />
          </div>
          {outOfScope && (outOfScope.movedToCode > 0 || outOfScope.dropped > 0) && (
            <div className={styles.outOfScopeLine} data-testid="mpr-db-proc-out-of-scope">
              {`Moved to code: ${formatNumber(outOfScope.movedToCode)} · Dropped: ${formatNumber(outOfScope.dropped)}`}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ============================================================================
// SERVICE (API) RECONCILIATION
// ============================================================================

function ServiceSectionView({ service }: { service: ServiceSectionDto }) {
  const targetTbc = service.target === null;
  const rows: FactRow[] = [
    { key: 'interfaces', label: 'Total interfaces', current: service.current.interfaces, target: service.target?.interfaces ?? null, targetBlockTbc: targetTbc },
    { key: 'endpoints', label: 'Total endpoints', current: service.current.endpoints, target: service.target?.endpoints ?? null, targetBlockTbc: targetTbc },
  ];
  const total = service.current.endpoints;
  const perOp = service.perOperation;
  return (
    <section className={styles.section} data-testid="mpr-service-section">
      <div className={styles.sectionTitle}>SERVICE (API) RECONCILIATION</div>
      <FactsPanel rows={rows} testIdPrefix="mpr-service" />
      <div className={styles.stripTitle}>
        Endpoints — worst to best{total !== null ? ` (sums to the ${formatNumber(total)} current-state endpoints)` : ''}
      </div>
      <div className={`${styles.bucketRow} ${styles.bucketRow3}`}>
        <BucketCell label="Failed to migrate" value={service.buckets?.failedToMigrate ?? null} total={total} kind="undesired" testId="mpr-service-bucket-failed-migrate" />
        <BucketCell label="Failed reconciliation" value={service.buckets?.failedReconciliation ?? null} total={total} kind="undesired" testId="mpr-service-bucket-failed-recon" />
        <BucketCell label="Fully reconciled" value={service.buckets?.fullyReconciled ?? null} total={total} kind="reconciled" testId="mpr-service-bucket-reconciled" />
      </div>
      <div className={styles.stripTitle}>Per-operation reconciliation (latest run)</div>
      {perOp ? (
        <div className={styles.perOpStrip} data-testid="mpr-per-operation">
          {`Replayed ${formatNumber(perOp.replayed)} operations:`}
          <span className={styles.perOpItem}>{`${formatNumber(perOp.matching)} matching`}</span>
          <span className={styles.perOpItem}>{`${formatNumber(perOp.underInvestigation)} under investigation`}</span>
          <span className={styles.perOpItem}>{`${formatNumber(perOp.accepted)} accepted`}</span>
          <span className={styles.perOpItem}>{`${formatNumber(perOp.fixed)} fixed`}</span>
        </div>
      ) : (
        <div className={`${styles.perOpStrip} ${styles.tbcCell}`} data-testid="mpr-per-operation">
          [{TBC_LABEL}]
        </div>
      )}
    </section>
  );
}

export default MigrationProgressReport;
