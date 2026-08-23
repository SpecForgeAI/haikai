/**
 * StructuralModelTab
 *
 * 2026-08-18 SCL pipeline design (spec 6 of 10), "UI placement" ruling: the
 * mined SCL corpus is REVIEWABLE-NOT-READABLE — a third Architecture tab
 * (after "Candidates" and "Findings") hosting:
 *
 *   1. the scan status card — status badge, created_at, key corpus stats
 *      (roots external/internal, contracts reachable/total, unreachable
 *      classes, unresolved calls), the annotation summary when present, and
 *      LOUD amber completeness warnings (parse errors / unresolved calls —
 *      never hidden);
 *   2. the CONTRACT BROWSER — search (q) + kind filter + "shared only"
 *      (min_fan_in=2) toolbar over a bodiless contract listing; clicking a
 *      row opens the `ContractDetailPanel` (full contract fetch, per-kind
 *      rendering, call-link navigation, the "Explain" LLM affordance);
 *   3. the REACHABILITY report (collapsible) — the class-level worklist with
 *      generic signal chips and a triage-disposition select wired to the AMS
 *      PATCH (optimistic update, error rollback);
 *   4. FINDINGS (collapsible) — `stats_json.findings` (slice/assembly) +
 *      `stats_json.scl_annotation.contradictions` as one flat list.
 *
 * Never-scanned (AMS 404 on /scans/latest) renders the quiet "No structural
 * scan yet" banner. All AMS reads go DIRECT (vite catch-all → AMS) via
 * `api/sclCorpusApi`; only "Explain" goes through the gateway.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getLatestScan as defaultGetLatestScan,
  listContracts as defaultListContracts,
  listReachability as defaultListReachability,
  normalizeSignals,
  patchReachabilityDisposition as defaultPatchReachabilityDisposition,
  type SclContract,
  type SclContractKind,
  type SclReachabilityDisposition,
  type SclReachabilityItem,
  type SclScan,
} from '../../../api/sclCorpusApi';
import { ContractDetailPanel } from './ContractDetailPanel';
import styles from './StructuralModelTab.module.css';

export interface StructuralModelTabProps {
  projectId: string;
  /** The SCANNED architecture id (the SCL corpus is architecture-scoped). */
  architectureId: string;
}

type KindFilter = 'all' | SclContractKind;

const KIND_CHIP_CLASS: Record<string, string> = {
  behaviour_table: styles.kindBehaviourTable,
  shape: styles.kindShape,
  boundary: styles.kindBoundary,
};

const DISPOSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'open' },
  { value: 'dead_code', label: 'dead_code' },
  { value: 'missed_entrypoint', label: 'missed_entrypoint' },
  { value: 'framework_invoked', label: 'framework_invoked' },
];

export const StructuralModelTab: React.FC<StructuralModelTabProps> = ({
  projectId,
  architectureId,
}) => {
  // --- Scan -----------------------------------------------------------------
  const [scanLoading, setScanLoading] = useState(true);
  const [scan, setScan] = useState<SclScan | null>(null);
  const [neverScanned, setNeverScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // --- Contract browser -----------------------------------------------------
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sharedOnly, setSharedOnly] = useState(false);
  const [contracts, setContracts] = useState<SclContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [selectedContractKey, setSelectedContractKey] = useState<string | null>(null);

  // --- Reachability ---------------------------------------------------------
  const [reachabilityOpen, setReachabilityOpen] = useState(false);
  const [reachability, setReachability] = useState<SclReachabilityItem[]>([]);
  const [reachabilityError, setReachabilityError] = useState<string | null>(null);
  const [dispositionErrors, setDispositionErrors] = useState<Record<string, string>>({});

  // --- Findings -------------------------------------------------------------
  const [findingsOpen, setFindingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScanLoading(true);
    setNeverScanned(false);
    setScanError(null);
    defaultGetLatestScan(projectId, architectureId)
      .then((data) => {
        if (cancelled) return;
        if (data === null) setNeverScanned(true);
        else setScan(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setScanError(err instanceof Error ? err.message : 'Failed to load the structural scan');
        }
      })
      .finally(() => {
        if (!cancelled) setScanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  const scanId = scan?.id ?? null;

  // Contract listing — bodiless, refetched on any toolbar change.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setContractsLoading(true);
    setContractsError(null);
    defaultListContracts(projectId, architectureId, scanId, {
      kind: kindFilter === 'all' ? undefined : kindFilter,
      q: q.trim() ? q.trim() : undefined,
      minFanIn: sharedOnly ? 2 : undefined,
      includeBody: false,
    })
      .then((rows) => {
        if (!cancelled) setContracts(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setContractsError(err instanceof Error ? err.message : 'Failed to list contracts');
        }
      })
      .finally(() => {
        if (!cancelled) setContractsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, scanId, q, kindFilter, sharedOnly]);

  // Reachability worklist — loaded with the scan so the headline count is
  // honest even while the section is collapsed.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setReachabilityError(null);
    defaultListReachability(projectId, architectureId, scanId)
      .then((rows) => {
        if (!cancelled) setReachability(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setReachabilityError(
            err instanceof Error ? err.message : 'Failed to load the reachability report',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, scanId]);

  // Disposition PATCH — optimistic, with rollback on failure.
  const handleDispositionChange = useCallback(
    (itemId: string, raw: string) => {
      const next = (raw === '' ? null : raw) as SclReachabilityDisposition | null;
      const previous = reachability.find((item) => item.id === itemId)?.disposition ?? null;
      setReachability((items) =>
        items.map((item) => (item.id === itemId ? { ...item, disposition: next } : item)),
      );
      setDispositionErrors((errors) => {
        const rest = { ...errors };
        delete rest[itemId];
        return rest;
      });
      defaultPatchReachabilityDisposition(projectId, architectureId, itemId, next).catch((err) => {
        // Rollback the optimistic update and surface the failure inline.
        setReachability((items) =>
          items.map((item) => (item.id === itemId ? { ...item, disposition: previous } : item)),
        );
        setDispositionErrors((errors) => ({
          ...errors,
          [itemId]: err instanceof Error ? err.message : 'Failed to update the disposition',
        }));
      });
    },
    [projectId, architectureId, reachability],
  );

  // --- Derived scan facts ---------------------------------------------------
  const stats = scan?.stats_json ?? null;
  const annotation = stats?.scl_annotation ?? null;
  const parseErrorCount = Array.isArray(stats?.parseErrors) ? stats.parseErrors.length : 0;
  const unresolvedCallCount = stats?.unresolvedCallCount ?? 0;

  const findings = useMemo(() => {
    const flat: Array<{ kind: string; detail: string; symbol: string | null }> = [];
    for (const f of stats?.findings ?? []) {
      flat.push({ kind: f.kind, detail: f.detail, symbol: f.symbol ?? null });
    }
    for (const c of annotation?.contradictions ?? []) {
      flat.push({ kind: c.kind, detail: c.detail, symbol: c.symbol ?? c.contract_key ?? null });
    }
    return flat;
  }, [stats, annotation]);

  // --- Render ---------------------------------------------------------------

  if (scanLoading) {
    return (
      <div className={styles.container}>
        <p className={styles.quietBanner} data-testid="structural-model-loading">
          Loading structural scan…
        </p>
      </div>
    );
  }

  if (neverScanned) {
    return (
      <div className={styles.container}>
        <p className={styles.quietBanner} data-testid="structural-model-no-scan">
          No structural scan yet.
        </p>
      </div>
    );
  }

  if (scanError || !scan) {
    return (
      <div className={styles.container}>
        <p className={styles.errorBanner} data-testid="structural-model-scan-error">
          {scanError ?? 'Failed to load the structural scan'}
        </p>
      </div>
    );
  }

  const statusClass =
    scan.status === 'completed'
      ? styles.statusCompleted
      : scan.status === 'failed'
        ? styles.statusFailed
        : '';

  return (
    <div className={styles.container} data-testid="structural-model-tab">
      {/* --- Scan status card --------------------------------------------- */}
      <div className={styles.statusCard} data-testid="structural-model-status-card">
        <div className={styles.statusHeaderRow}>
          <h3 className={styles.heading}>Structural model</h3>
          <span
            className={`${styles.statusBadge}${statusClass ? ` ${statusClass}` : ''}`}
            data-testid="structural-model-status-badge"
          >
            {scan.status ?? 'unknown'}
          </span>
          {scan.created_at && (
            <span className={styles.scanMeta} data-testid="structural-model-created-at">
              scanned {scan.created_at}
            </span>
          )}
        </div>
        <div className={styles.statsRow}>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Roots</span>
            <span className={styles.statValue} data-testid="stat-roots">
              {stats?.externalRootCount ?? 0} external / {stats?.internalRootCount ?? 0} internal
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Contracts</span>
            <span className={styles.statValue} data-testid="stat-contracts">
              {stats?.reachableContractCount ?? 0} / {stats?.contractCount ?? 0} reachable
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Unreachable classes</span>
            <span className={styles.statValue} data-testid="stat-unreachable-classes">
              {stats?.unreachableClassCount ?? 0}
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Unresolved calls</span>
            <span className={styles.statValue} data-testid="stat-unresolved-calls">
              {unresolvedCallCount}
            </span>
          </div>
        </div>
        {/* Shakedown fix 3b (2026-08-23): the live-vs-repo proc merge counts
            were persisted but rendered NOWHERE. Drift between repo and live
            proc bodies is migration-load-bearing — say it here, loudly. */}
        {stats?.procMerge && (
          <p className={styles.annotationSummary} data-testid="structural-model-proc-merge">
            Proc catalog (live-merged): {stats.procMerge.mergedCount ?? 0} procs ·{' '}
            {stats.procMerge.repoCount ?? 0} repo · {stats.procMerge.liveCount ?? 0} live ·{' '}
            {stats.procMerge.driftCount ?? 0} drift · {stats.procMerge.liveOnlyCount ?? 0} live-only ·{' '}
            {stats.procMerge.repoOnlyCount ?? 0} repo-only ·{' '}
            {stats.procMerge.repoDuplicateCount ?? 0} repo-duplicate
          </p>
        )}
        {stats && !stats.procMerge && scan.status === 'completed' && (
          <p className={styles.annotationSummary} data-testid="structural-model-proc-merge-absent">
            Proc catalog: repo-only (no completed database scan supplied live proc sources)
          </p>
        )}
        {annotation && (
          <p className={styles.annotationSummary} data-testid="structural-model-annotation-summary">
            Annotation: {annotation.annotated ?? 0} annotated ·{' '}
            {annotation.skipped_already_glossed ?? 0} already glossed ·{' '}
            {annotation.rejected ?? 0} rejected · {annotation.guard_rejections ?? 0} guard
            rejections · {(annotation.contradictions ?? []).length} contradictions
          </p>
        )}
        {/* Explicit pending state (2026-08-20): a completed scan with no
            merged annotation summary must SAY so — silence here previously
            made "annotation pending" indistinguishable from "never ran". */}
        {!annotation && scan.status === 'completed' && (
          <p
            className={styles.annotationSummary}
            data-testid="structural-model-annotation-pending"
          >
            Annotation: not yet merged — the pass starts automatically with the
            code scan and its summary appears here when it completes. If it
            never arrives, the code scan run's structural-scan outcome records
            whether the annotation request failed.
          </p>
        )}
        {/* LOUD completeness warnings — the corpus is a construction input;
            an incomplete corpus must never look complete. */}
        {parseErrorCount > 0 && (
          <p className={styles.warningBanner} role="alert" data-testid="warning-parse-errors">
            {parseErrorCount} file{parseErrorCount === 1 ? '' : 's'} failed to parse — the
            structural corpus is INCOMPLETE.
          </p>
        )}
        {unresolvedCallCount > 0 && (
          <p className={styles.warningBanner} role="alert" data-testid="warning-unresolved-calls">
            {unresolvedCallCount} unresolved call{unresolvedCallCount === 1 ? '' : 's'} — some
            call rows have no target contract.
          </p>
        )}
      </div>

      {/* --- Contract browser --------------------------------------------- */}
      <div className={styles.section} data-testid="contract-browser">
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionHeading}>
            Contract browser
            <span className={styles.sectionCount}>{contracts.length} shown</span>
          </h3>
        </div>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search contracts (key, symbol, path)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="contract-browser-search"
          />
          <select
            className={styles.kindSelect}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            aria-label="Contract kind filter"
            data-testid="contract-browser-kind-filter"
          >
            <option value="all">all kinds</option>
            <option value="behaviour_table">behaviour_table</option>
            <option value="shape">shape</option>
            <option value="boundary">boundary</option>
          </select>
          <label className={styles.sharedToggle}>
            <input
              type="checkbox"
              checked={sharedOnly}
              onChange={(e) => setSharedOnly(e.target.checked)}
              data-testid="contract-browser-shared-only"
            />
            shared only (fan-in ≥ 2)
          </label>
        </div>
        {contractsError && <p className={styles.errorBanner}>{contractsError}</p>}
        <div className={styles.browserLayout}>
          <div className={styles.browserListPane}>
            {contractsLoading ? (
              <p className={styles.emptyMessage}>Loading contracts…</p>
            ) : contracts.length === 0 ? (
              <p className={styles.emptyMessage} data-testid="contract-browser-empty">
                No contracts match.
              </p>
            ) : (
              <ul className={styles.contractList}>
                {contracts.map((contract) => {
                  const reachable = contract.roots_json?.reachable !== false;
                  const selected = contract.contract_key === selectedContractKey;
                  return (
                    <li key={contract.contract_key}>
                      <button
                        type="button"
                        className={[
                          styles.contractRow,
                          selected ? styles.contractRowSelected : '',
                          reachable ? '' : styles.contractRowUnreachable,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelectedContractKey(contract.contract_key)}
                        data-testid={`contract-row-${contract.contract_key}`}
                      >
                        <span className={styles.contractKey}>{contract.contract_key}</span>
                        <span
                          className={`${styles.kindChip}${
                            KIND_CHIP_CLASS[contract.kind] ? ` ${KIND_CHIP_CLASS[contract.kind]}` : ''
                          }`}
                        >
                          {contract.kind}
                        </span>
                        <span className={styles.symbolCell}>{contract.source_symbol ?? ''}</span>
                        <span className={styles.fanInBadge}>fan-in {contract.fan_in ?? 0}</span>
                        {!reachable && <span className={styles.unreachableTag}>unreachable</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {selectedContractKey && scanId && (
            <div className={styles.detailPane}>
              <ContractDetailPanel
                projectId={projectId}
                architectureId={architectureId}
                scanId={scanId}
                contractKey={selectedContractKey}
                onNavigate={setSelectedContractKey}
              />
            </div>
          )}
        </div>
      </div>

      {/* --- Reachability report ------------------------------------------ */}
      <div className={styles.section} data-testid="reachability-section">
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionHeading}>
            Reachability report
            <span className={styles.sectionCount} data-testid="reachability-count">
              {reachability.length} item{reachability.length === 1 ? '' : 's'}
            </span>
          </h3>
          <button
            type="button"
            className={styles.toggleButton}
            onClick={() => setReachabilityOpen((o) => !o)}
            data-testid="reachability-toggle"
          >
            {reachabilityOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {reachabilityError && <p className={styles.errorBanner}>{reachabilityError}</p>}
        {reachabilityOpen &&
          (reachability.length === 0 ? (
            <p className={styles.emptyMessage} data-testid="reachability-empty">
              Every scanned class is inside the corpus closure.
            </p>
          ) : (
            <table className={styles.detailTable} data-testid="reachability-table">
              <thead>
                <tr>
                  <th>Source path</th>
                  <th>Symbol</th>
                  <th>Signals</th>
                  <th>Disposition</th>
                </tr>
              </thead>
              <tbody>
                {reachability.map((item) => (
                  <tr key={item.id} data-testid={`reachability-row-${item.id}`}>
                    <td className={styles.detailMeta}>{item.source_path ?? ''}</td>
                    <td className={styles.code}>{item.symbol ?? ''}</td>
                    <td>
                      {normalizeSignals(item.signals_json).map((signal) => (
                        <span key={signal} className={styles.signalChip}>
                          {signal}
                        </span>
                      ))}
                    </td>
                    <td>
                      <select
                        className={styles.dispositionSelect}
                        value={item.disposition ?? ''}
                        onChange={(e) => handleDispositionChange(item.id, e.target.value)}
                        aria-label={`Disposition for ${item.symbol ?? item.id}`}
                        data-testid={`disposition-select-${item.id}`}
                      >
                        {DISPOSITION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {dispositionErrors[item.id] && (
                        <p className={styles.rowError} data-testid={`disposition-error-${item.id}`}>
                          {dispositionErrors[item.id]}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>

      {/* --- Findings ----------------------------------------------------- */}
      <div className={styles.section} data-testid="findings-section">
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionHeading}>
            Findings
            <span className={styles.sectionCount} data-testid="findings-count">
              {findings.length}
            </span>
          </h3>
          <button
            type="button"
            className={styles.toggleButton}
            onClick={() => setFindingsOpen((o) => !o)}
            data-testid="findings-toggle"
          >
            {findingsOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {findingsOpen &&
          (findings.length === 0 ? (
            <p className={styles.emptyMessage} data-testid="findings-empty">
              No findings.
            </p>
          ) : (
            <ul className={styles.findingList} data-testid="findings-list">
              {findings.map((finding, idx) => (
                <li key={idx} className={styles.findingItem} data-testid="finding-item">
                  <span className={styles.kindChip}>{finding.kind}</span>
                  <span>{finding.detail}</span>
                  {finding.symbol && <span className={styles.findingSymbol}>{finding.symbol}</span>}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
};
