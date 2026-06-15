/**
 * DiscoveryRunDetailPage Component
 *
 * Canonical owner of the `/projects/:p/architectures/:a/discovery/runs/:runId`
 * route. Owns all data fetching (runs list, selected run, candidate count,
 * candidates), the save-back flow (modal + AppShell cache invalidation +
 * lastSaveTimestamp), and the run-level chrome (back button, run history
 * list, warnings banner, run-detail panel with architecture chip / service
 * deleted chip / status / tier / phases). Mounts `<DiscoveryRunDetailView>`
 * for the Candidates / Findings tab strip and passes the Save All Approved
 * block via the `candidatesTabHeader` slot so candidate-specific chrome stays
 * scoped to the Candidates tab.
 *
 * The active tab is persisted in the `?tab=` URL search param so refresh +
 * deep-link survive the choice (`candidates` is the default and omitted from
 * the URL for tidiness).
 *
 * Replaces the previous thin pass-through to the legacy
 * `DashboardView/DiscoveryRunDetailView` (deleted in the same change). The
 * `DiscoveryRunDetailView.module.css` module is retained because many sibling
 * components (DiscoveryRunsList, CandidateDetailsPanel, DiscoveryListPage,
 * DiscoveryCandidateTable, etc) still consume its shared status / chrome
 * classes.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getDiscoveryRuns,
  getDiscoveryRun,
  getDiscoveryCandidateCount,
  getDiscoveryCandidates,
  saveApprovedCandidates,
} from '../../api/discoveryApi';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
} from '../../api/discoveryApi';
import {
  useActiveArchitectureId,
  useArchitectureContext,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { useProject } from '../../contexts/ProjectContext';
import { useDiscoveryRunId } from '../../hooks/useCurrentView';
import {
  DiscoveryRunDetailView,
  type DiscoveryRunDetailTabId,
} from '../Discovery/DiscoveryRunDetailView';
import { SaveBackConfirmModal } from '../Discovery/SaveBackConfirmModal';
import { TierBadge } from './TierBadge';
import { DiscoveryRunKindBadge } from '../Discovery/DiscoveryRunKindBadge';
import {
  computeLogAttachWarningState,
  logAttachWarningLabel,
} from '../Discovery/runInputArtifactsHelpers';
import {
  computeServiceDeletedState,
  type ServiceDeletedState,
} from './serviceDeletedHelpers';
import styles from './DiscoveryRunDetailView.module.css';

const VALID_STEPS = ['1a', '1b', '1c', '1d'] as const;

function formatProgressIndicator(currentStep: string): string {
  return `Running step ${currentStep} of ${VALID_STEPS.length}...`;
}

function getStatusClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return styles.statusCompleted;
    case 'FAILED':
      return styles.statusFailed;
    case 'RUNNING':
      return styles.statusRunning;
    case 'PENDING':
      return styles.statusPending;
    case 'CANCELLED':
      return styles.statusCancelled;
    default:
      return styles.statusPending;
  }
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

type LibraryScanRow = {
  library_id?: string;
  library_name?: string;
  depth?: number;
  status?:
    | 'pending'
    | 'running'
    | 'completed'
    | 'skipped-cycle'
    | 'skipped-depth-cap';
  files_analyzed?: number;
  candidate_count?: number;
  error?: string;
};

type PhaseEntry = {
  key: string;
  summary: string;
  libraryScans?: LibraryScanRow[];
};

const TAB_QUERY_PARAM = 'tab';

/**
 * Spec 2026-06-11 Findings Coverage + Gap Wayfinding -- Task Group 3.
 * Two additional query params on this EXISTING route (no new routes):
 *   - `?findingId=<id>` -- fetches that single finding and opens the
 *     existing FindingDetailDrawer on the Findings tab (used by the
 *     per-finding "unaddressed findings" deep links). With no explicit
 *     `?tab=`, its presence makes `findings` the active tab.
 *   - `?room=open` -- opens the Discovery Review Room (Architecture Room)
 *     on load. `open` is the ONLY recognized value; anything else is
 *     ignored (garbage-tolerant, never throws).
 */
const FINDING_ID_QUERY_PARAM = 'findingId';
const ROOM_QUERY_PARAM = 'room';

function parseTabParam(value: string | null): DiscoveryRunDetailTabId {
  return value === 'findings' ? 'findings' : 'candidates';
}

function parseFindingIdParam(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const DiscoveryRunDetailPage: React.FC = () => {
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();
  const archCtx = useArchitectureContext();
  const archDispatch = useArchitectureDispatch();
  const runId = useDiscoveryRunId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // -----------------------------------------------------------------------
  // Tab state -- driven by the `?tab=` URL search param so it survives
  // refresh and is shareable. `candidates` is the default and is omitted
  // from the URL for tidiness.
  // -----------------------------------------------------------------------
  // `?findingId=` / `?room=open` (Spec 2026-06-11, Task Group 3) -- read via
  // the same useSearchParams idiom as `?tab=`. Both tolerate garbage values:
  // an empty findingId is ignored and any room value other than `open` is
  // ignored.
  const initialFindingId = useMemo<string | null>(
    () => parseFindingIdParam(searchParams.get(FINDING_ID_QUERY_PARAM)),
    [searchParams],
  );
  const initialReviewRoomOpen = useMemo<boolean>(
    () => searchParams.get(ROOM_QUERY_PARAM) === 'open',
    [searchParams],
  );
  const activeTab = useMemo<DiscoveryRunDetailTabId>(() => {
    const rawTab = searchParams.get(TAB_QUERY_PARAM);
    // `findingId` present with NO explicit tab param -> the Findings tab is
    // the active tab (the deep link targets the finding drawer).
    if (rawTab === null && initialFindingId) return 'findings';
    return parseTabParam(rawTab);
  }, [searchParams, initialFindingId]);
  const handleTabChange = useCallback(
    (next: DiscoveryRunDetailTabId) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === 'candidates') {
            updated.delete(TAB_QUERY_PARAM);
          } else {
            updated.set(TAB_QUERY_PARAM, next);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // -----------------------------------------------------------------------
  // Runs list -- filtered by URL active architecture (safety property (c)).
  // -----------------------------------------------------------------------
  const [runs, setRuns] = useState<DiscoveryRunDto[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Selected run + its candidates.
  // -----------------------------------------------------------------------
  const [selectedRun, setSelectedRun] = useState<DiscoveryRunDto | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<DiscoveryCandidateDto[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState<boolean>(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Save All Approved state + lastSaveTimestamp (Bug 3 hotfix counter).
  // -----------------------------------------------------------------------
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBackOpen, setSaveBackOpen] = useState<boolean>(false);
  const [lastSaveTimestamp, setLastSaveTimestamp] = useState<number | undefined>(
    undefined,
  );

  const discoveryListUrl = useMemo(() => {
    if (!activeProject?.id || !activeArchitectureId) return null;
    return `/projects/${activeProject.id}/architectures/${activeArchitectureId}/discovery`;
  }, [activeProject?.id, activeArchitectureId]);

  const handleClose = useCallback(() => {
    if (discoveryListUrl) navigate(discoveryListUrl);
  }, [discoveryListUrl, navigate]);

  // -----------------------------------------------------------------------
  // Run list fetcher (shared by mount-effect + refresh button + post-save).
  // -----------------------------------------------------------------------
  const fetchRunList = useCallback(async () => {
    if (!activeProject?.id || !activeArchitectureId) {
      setRuns([]);
      setRunsLoading(false);
      return;
    }
    setRunsLoading(true);
    setRunsError(null);
    try {
      const result = await getDiscoveryRuns(
        activeProject.id,
        activeArchitectureId,
      );
      setRuns(result);
    } catch (err) {
      setRunsError(
        err instanceof Error ? err.message : 'Failed to load discovery runs',
      );
    } finally {
      setRunsLoading(false);
    }
  }, [activeProject?.id, activeArchitectureId]);

  useEffect(() => {
    if (!activeProject?.id || !activeArchitectureId) {
      setRuns([]);
      setRunsLoading(false);
      return;
    }
    let cancelled = false;
    async function doFetch() {
      setRunsLoading(true);
      setRunsError(null);
      try {
        const result = await getDiscoveryRuns(
          activeProject!.id,
          activeArchitectureId!,
        );
        if (!cancelled) setRuns(result);
      } catch (err) {
        if (!cancelled) {
          setRunsError(
            err instanceof Error ? err.message : 'Failed to load discovery runs',
          );
        }
      } finally {
        if (!cancelled) setRunsLoading(false);
      }
    }
    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, activeArchitectureId]);

  // -----------------------------------------------------------------------
  // Selected-run + candidate-count fetcher driven by the URL :runId.
  // -----------------------------------------------------------------------
  const loadRunDetail = useCallback(
    async (targetRunId: string) => {
      if (!activeProject?.id || !activeArchitectureId) {
        setSelectedRun(null);
        setCandidateCount(null);
        return;
      }
      setDetailLoading(true);
      setSaveSuccess(null);
      setSaveError(null);
      try {
        const [runDetail, countResult] = await Promise.all([
          getDiscoveryRun(activeProject.id, activeArchitectureId, targetRunId),
          getDiscoveryCandidateCount(
            activeProject.id,
            activeArchitectureId,
            targetRunId,
          ).catch(() => ({ count: 0 })),
        ]);
        setSelectedRun(runDetail);
        setCandidateCount(countResult.count);
      } catch {
        setSelectedRun(null);
        setCandidateCount(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [activeProject?.id, activeArchitectureId],
  );

  useEffect(() => {
    if (!runId) {
      setSelectedRun(null);
      setCandidateCount(null);
      setCandidates([]);
      return;
    }
    void loadRunDetail(runId);
  }, [runId, loadRunDetail]);

  // -----------------------------------------------------------------------
  // Candidate fetch -- runs when the Candidates tab is active and a run is
  // selected. The legacy view fetched candidates only after the user clicked
  // "View Candidates"; this version pre-fetches when the Candidates tab is
  // active (which is the default) so the table renders immediately. Tab
  // switching back to Candidates re-uses any candidates already loaded.
  // -----------------------------------------------------------------------
  const fetchCandidatesForRun = useCallback(
    async (targetRunId: string) => {
      if (!activeProject?.id || !activeArchitectureId) return;
      setCandidatesLoading(true);
      setCandidatesError(null);
      try {
        const result = await getDiscoveryCandidates(
          activeProject.id,
          activeArchitectureId,
          targetRunId,
        );
        setCandidates(result);
      } catch (err) {
        setCandidatesError(
          err instanceof Error ? err.message : 'Failed to load candidates',
        );
      } finally {
        setCandidatesLoading(false);
      }
    },
    [activeProject?.id, activeArchitectureId],
  );

  useEffect(() => {
    if (!selectedRun || !runId) return;
    if (activeTab !== 'candidates') return;
    if (candidates.length > 0) return;
    if (candidatesLoading) return;
    void fetchCandidatesForRun(runId);
    // We intentionally do not refetch on every candidate-list mutation --
    // only when the selection or active tab changes and no candidates are
    // loaded yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun?.id, runId, activeTab]);

  // -----------------------------------------------------------------------
  // Refresh button on the run-list panel: refetches the list AND the
  // currently-selected run's detail so a stale `selectedRun` cannot trip
  // chip predicates (Bug 2 hotfix).
  // -----------------------------------------------------------------------
  const refreshSelectedRunDetail = useCallback(
    async (targetRunId: string, runArchitectureId: string) => {
      if (!activeProject?.id) return;
      try {
        const [runDetail, countResult] = await Promise.all([
          getDiscoveryRun(activeProject.id, runArchitectureId, targetRunId),
          getDiscoveryCandidateCount(
            activeProject.id,
            runArchitectureId,
            targetRunId,
          ).catch(() => ({ count: 0 })),
        ]);
        setSelectedRun(runDetail);
        setCandidateCount(countResult.count);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[SaveBack] post-save selected-run refresh failed', {
          runId: targetRunId,
        });
      }
    },
    [activeProject?.id],
  );

  const handleRefresh = useCallback(() => {
    void fetchRunList();
    if (runId) {
      const runArchitectureId =
        selectedRun?.architecture_id ?? activeArchitectureId;
      if (runArchitectureId) {
        void refreshSelectedRunDetail(runId, runArchitectureId);
      }
    }
  }, [
    fetchRunList,
    runId,
    selectedRun?.architecture_id,
    activeArchitectureId,
    refreshSelectedRunDetail,
  ]);

  const handleSelectRun = useCallback(
    (newRunId: string) => {
      if (!activeProject?.id || !activeArchitectureId) return;
      // Reset per-run state immediately so we never flash the prior run's
      // candidates while the new run's detail is loading.
      setCandidates([]);
      setCandidatesError(null);
      navigate(
        `/projects/${activeProject.id}/architectures/${activeArchitectureId}/discovery/runs/${newRunId}`,
      );
    },
    [activeProject?.id, activeArchitectureId, navigate],
  );

  // -----------------------------------------------------------------------
  // Save All Approved -- modal-gated. Uses the run's BOUND architecture_id
  // (safety property (d)) so cross-arch saves still go to the right place.
  // -----------------------------------------------------------------------
  const approvedCount = useMemo(
    () => candidates.filter((c) => c.review_status === 'approved').length,
    [candidates],
  );
  const hasApprovedCandidates = approvedCount > 0;
  const hasCommittedCandidates = useMemo(
    () => candidates.some((c) => c.review_status === 'committed'),
    [candidates],
  );

  const handleSaveApprovedClick = useCallback(() => {
    if (!runId || !selectedRun) return;
    setSaveSuccess(null);
    setSaveError(null);
    setSaveBackOpen(true);
  }, [runId, selectedRun]);

  const handleSaveApprovedConfirmed = useCallback(async () => {
    if (!activeProject?.id) return;
    if (!runId) return;
    if (!selectedRun?.architecture_id) {
      throw new Error('Run is missing architecture_id; cannot save back.');
    }

    if (
      activeArchitectureId &&
      selectedRun.architecture_id !== activeArchitectureId
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        '[SaveBack] URL active architecture differs from run bound architecture',
        {
          urlActiveArchitectureId: activeArchitectureId,
          runArchitectureId: selectedRun.architecture_id,
          runId,
        },
      );
    }

    setSaveLoading(true);
    setSaveSuccess(null);
    setSaveError(null);

    const runArchitectureId = selectedRun.architecture_id;
    const runIdAtSave = runId;

    try {
      const result = await saveApprovedCandidates(
        activeProject.id,
        runArchitectureId,
        runIdAtSave,
      );
      // Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) -- Task Group 6.
      // Surface the below-auto-accept-gate count on the existing save-back
      // outcome line. `belowGateCount` rides on the MCP `SaveBackResult` (TG5)
      // and flows verbatim through the gateway save-approved proxy onto this
      // result, so the run-detail page shows it the SAME way the other counts
      // are shown. A whole Tier-C `llm-solo` run scores 0.4 and sits entirely
      // below the gate -- those candidates are recorded as reviewable (NOT
      // auto-applied, NOT dropped), and this count makes that visible. Absent /
      // zero -> the suffix is omitted (back-compat with pre-Spec-#3 responses).
      const belowGateCount = result.belowGateCount ?? 0;
      const belowGateSuffix =
        belowGateCount > 0
          ? `, ${belowGateCount} below auto-accept (reviewable)`
          : '';
      setSaveSuccess(
        `Saved: ${result.entitiesCreated} created, ${result.entitiesSkipped} skipped, ${result.candidatesCommitted} committed${belowGateSuffix}`,
      );

      await Promise.all([
        fetchCandidatesForRun(runIdAtSave),
        refreshSelectedRunDetail(runIdAtSave, runArchitectureId),
        fetchRunList(),
      ]);

      setLastSaveTimestamp(Date.now());

      // AppShell model cache: refresh same-arch, invalidate cross-arch (per
      // project_appshell_model_cache.md). Findings don't need this --
      // they live outside the architecture model.
      if (
        activeProject.id &&
        activeArchitectureId &&
        activeArchitectureId === runArchitectureId
      ) {
        try {
          const freshModel = await loadModelByProjectId(
            activeProject.id,
            runArchitectureId,
          );
          archDispatch({
            type: 'LOAD_MODEL',
            payload: freshModel,
            fileName: activeProject.name,
          });
        } catch (modelErr) {
          // eslint-disable-next-line no-console
          console.warn('[SaveBack] post-save model reload failed', modelErr);
        }
      } else if (
        activeArchitectureId &&
        activeArchitectureId !== runArchitectureId
      ) {
        try {
          archCtx.invalidateArchitectureModelCache(runArchitectureId);
        } catch (cacheErr) {
          // eslint-disable-next-line no-console
          console.warn(
            '[SaveBack] cross-arch cache invalidation failed',
            cacheErr,
          );
        }
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to save approved candidates';
      setSaveError(message);
      throw err;
    } finally {
      setSaveLoading(false);
    }
  }, [
    activeProject,
    activeArchitectureId,
    runId,
    selectedRun,
    fetchCandidatesForRun,
    refreshSelectedRunDetail,
    fetchRunList,
    archDispatch,
    archCtx,
  ]);

  // -----------------------------------------------------------------------
  // Derived render values.
  // -----------------------------------------------------------------------
  const phaseEntries: PhaseEntry[] = [];
  if (selectedRun?.steps_payload) {
    for (const [key, value] of Object.entries(selectedRun.steps_payload)) {
      const summary = typeof value === 'string' ? value : JSON.stringify(value);
      let libraryScans: LibraryScanRow[] | undefined;
      if (
        value !== null &&
        typeof value === 'object' &&
        Array.isArray((value as Record<string, unknown>)['library-scans'])
      ) {
        libraryScans = (value as Record<string, unknown>)[
          'library-scans'
        ] as LibraryScanRow[];
      }
      phaseEntries.push({ key, summary, libraryScans });
    }
  }

  const selectedTier = selectedRun?.tier ?? null;
  const showWarningsBanner =
    (selectedTier === 'B' || selectedTier === 'C') &&
    Array.isArray(selectedRun?.warnings) &&
    (selectedRun?.warnings?.length ?? 0) > 0;
  const bannerTierClass =
    selectedTier === 'C'
      ? styles.warningsBannerTierC
      : styles.warningsBannerTierB;

  const runArchitecture = useMemo(() => {
    if (!selectedRun?.architecture_id) return null;
    const list = archCtx.architectures ?? [];
    return list.find((a) => a.id === selectedRun.architecture_id) ?? null;
  }, [selectedRun?.architecture_id, archCtx.architectures]);

  // -----------------------------------------------------------------------
  // Render: page wrapper without a project is the only short-circuit.
  // -----------------------------------------------------------------------
  if (!activeProject) {
    return (
      <div
        className={styles.detailContainer}
        data-testid="discovery-run-detail-page"
      >
        <div className={styles.emptyMessage}>
          Select a project to view discovery runs.
        </div>
      </div>
    );
  }

  const candidatesTabHeader = (
    <>
      {candidatesLoading && (
        <div
          className={styles.loadingState}
          data-testid="candidate-table-loading"
        >
          Loading candidates...
        </div>
      )}
      {candidatesError && (
        <div
          className={styles.errorMessage}
          data-testid="candidate-table-error"
        >
          {candidatesError}
        </div>
      )}
      {selectedRun && hasApprovedCandidates && (
        <div
          className={styles.saveApprovedSection}
          data-testid="save-approved-section"
        >
          <button
            className={`${styles.saveApprovedButton}${
              saveLoading ? ` ${styles.actionButtonDisabled}` : ''
            }`}
            onClick={handleSaveApprovedClick}
            disabled={saveLoading}
            data-testid="save-approved-button"
          >
            {saveLoading
              ? 'Saving...'
              : hasCommittedCandidates
                ? 'Save Remaining Approved'
                : 'Save All Approved'}
          </button>
          {saveSuccess && (
            <span
              className={styles.saveApprovedSuccess}
              data-testid="save-approved-success"
            >
              {saveSuccess}
            </span>
          )}
          {saveError && (
            <span
              className={styles.errorMessage}
              data-testid="save-approved-error"
            >
              {saveError}
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      data-testid="discovery-run-detail-page"
      data-route-run-id={runId ?? ''}
    >
      <div
        className={styles.detailContainer}
        data-testid="discovery-run-detail-view"
      >
        {/* Header */}
        <div className={styles.detailHeader}>
          <button
            className={styles.backButton}
            onClick={handleClose}
            data-testid="back-to-dashboard-button"
          >
            Back to Discovery
          </button>
          <h2>Discovery Runs</h2>
        </div>

        {/* Run history */}
        <div className={styles.runListSection}>
          <div className={styles.runListHeader}>
            <h3>Run History</h3>
            <button
              className={styles.refreshButton}
              onClick={handleRefresh}
              disabled={runsLoading}
              data-testid="refresh-runs-button"
            >
              Refresh
            </button>
          </div>
          {runsLoading && (
            <div className={styles.loadingState}>Loading runs...</div>
          )}
          {runsError && (
            <div className={styles.errorMessage}>{runsError}</div>
          )}
          {!runsLoading && !runsError && runs.length === 0 && (
            <div
              className={styles.emptyMessage}
              data-testid="empty-runs-message"
            >
              No discovery runs found for this project. Start a new run to
              begin analyzing your codebase.
            </div>
          )}
          {!runsLoading && !runsError && runs.length > 0 && (
            <ul className={styles.runList} data-testid="run-list">
              {runs.map((run) => {
                const warningState = computeLogAttachWarningState(
                  run.config_snapshot,
                );
                const warningLabel = logAttachWarningLabel(warningState);
                return (
                  <li
                    key={run.id}
                    className={`${styles.runListItem}${
                      runId === run.id ? ` ${styles.runListItemSelected}` : ''
                    }`}
                    onClick={() => handleSelectRun(run.id)}
                    data-testid="run-list-item"
                  >
                    <span
                      className={`${styles.statusBadge} ${getStatusClass(
                        run.status,
                      )}`}
                    >
                      {run.status}
                    </span>
                    {warningLabel && (
                      <span
                        className={`${styles.logsAttachWarningChip} ${
                          warningState === 'failed'
                            ? styles.logsAttachWarningChipFailed
                            : styles.logsAttachWarningChipPartial
                        }`}
                        data-testid="run-list-logs-attach-warning-chip"
                        data-warning-state={warningState}
                      >
                        {warningLabel}
                      </span>
                    )}
                    {run.tier && (
                      <span className={styles.runListItemTier}>
                        <TierBadge
                          tier={run.tier}
                          data-testid="run-list-tier-badge"
                        />
                      </span>
                    )}
                    <DiscoveryRunKindBadge kind={run.discovery_kind} />
                    <span className={styles.runListItemDate}>
                      {formatDate(run.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Run detail panel */}
        {detailLoading && (
          <div className={styles.loadingState}>Loading run details...</div>
        )}

        {selectedRun && !detailLoading && (
          <>
            {showWarningsBanner && (
              <div
                className={`${styles.warningsBanner} ${bannerTierClass}`}
                role="alert"
                data-testid="run-warnings-banner"
                data-tier={selectedTier}
              >
                {(selectedRun.warnings ?? []).length === 1 ? (
                  <span>{(selectedRun.warnings ?? [])[0]}</span>
                ) : (
                  <ul className={styles.warningsBannerList}>
                    {(selectedRun.warnings ?? []).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className={styles.runDetailPanel} data-testid="run-detail-panel">
              <h3>Run Detail</h3>

              {selectedRun.architecture_id && (
                <div
                  className={styles.architectureChip}
                  data-testid="run-detail-architecture-chip"
                  title={runArchitecture?.name ?? selectedRun.architecture_id}
                >
                  <span className={styles.architectureChipLabel}>
                    Architecture: {runArchitecture?.name ?? '...'}
                  </span>
                  {runArchitecture?.archived && (
                    <span
                      className={styles.architectureChipArchived}
                      data-testid="run-detail-architecture-chip-archived"
                    >
                      (archived)
                    </span>
                  )}
                </div>
              )}

              {(() => {
                const serviceDeletedState: ServiceDeletedState =
                  computeServiceDeletedState(selectedRun);
                if (serviceDeletedState.kind === 'deleted-with-snapshot') {
                  return (
                    <div
                      className={styles.runDetailRow}
                      data-testid="run-detail-service-deleted-row"
                    >
                      <span className={styles.runDetailLabel}>Service:</span>
                      <span
                        className={styles.serviceNameLabel}
                        data-testid="run-detail-service-name-label"
                      >
                        {serviceDeletedState.serviceName}
                      </span>
                      <span
                        className={styles.serviceDeletedChip}
                        data-testid="run-detail-service-deleted-chip"
                      >
                        Service deleted
                      </span>
                    </div>
                  );
                }
                if (serviceDeletedState.kind === 'deleted-without-snapshot') {
                  return (
                    <div
                      className={styles.runDetailRow}
                      data-testid="run-detail-service-deleted-row"
                    >
                      <span className={styles.runDetailLabel}>Service:</span>
                      <span
                        className={styles.serviceDeletedChip}
                        data-testid="run-detail-service-deleted-chip"
                      >
                        Service deleted
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              <div className={styles.runDetailRow}>
                <span className={styles.runDetailLabel}>Status:</span>
                <span
                  className={`${styles.statusBadge} ${getStatusClass(
                    selectedRun.status,
                  )}`}
                >
                  {selectedRun.status}
                </span>
              </div>

              {selectedRun.tier && (
                <div className={styles.runDetailRow}>
                  <span className={styles.runDetailLabel}>Tier:</span>
                  <TierBadge
                    tier={selectedRun.tier}
                    data-testid="run-detail-tier-badge"
                  />
                  {selectedRun.mode && (
                    <span style={{ marginLeft: 6, color: '#666' }}>
                      ({selectedRun.mode})
                    </span>
                  )}
                </div>
              )}

              {selectedRun.status === 'RUNNING' && selectedRun.current_step && (
                <div
                  className={styles.runDetailRow}
                  data-testid="running-progress-indicator"
                >
                  <span className={styles.runDetailLabel}>Progress:</span>
                  <span className={styles.progressText}>
                    {formatProgressIndicator(selectedRun.current_step)}
                  </span>
                </div>
              )}

              {selectedRun.status !== 'RUNNING' && selectedRun.current_step && (
                <div className={styles.runDetailRow}>
                  <span className={styles.runDetailLabel}>Current Step:</span>
                  <span data-testid="run-current-step">
                    {selectedRun.current_step}
                  </span>
                </div>
              )}

              <div className={styles.runDetailRow}>
                <span className={styles.runDetailLabel}>Created:</span>
                <span>{formatDate(selectedRun.created_at)}</span>
              </div>

              {candidateCount !== null && (
                <div className={styles.runDetailRow}>
                  <span className={styles.runDetailLabel}>Candidates:</span>
                  <span data-testid="run-candidate-count">
                    {candidateCount}
                  </span>
                </div>
              )}

              {selectedRun.status === 'FAILED' && selectedRun.error_message && (
                <div
                  className={styles.errorMessage}
                  data-testid="run-error-message"
                >
                  {selectedRun.error_message}
                </div>
              )}

              {phaseEntries.length > 0 && (
                <>
                  <div className={styles.runDetailRow}>
                    <span className={styles.runDetailLabel}>Phases:</span>
                  </div>
                  <ul className={styles.phaseList} data-testid="phase-list">
                    {phaseEntries.map((entry) => {
                      const { key, summary, libraryScans } = entry;
                      if (libraryScans && libraryScans.length > 0) {
                        const pending = libraryScans.filter(
                          (r) => r.status === 'pending' || r.status === 'running',
                        ).length;
                        return (
                          <li
                            key={key}
                            className={styles.phaseItem}
                            data-testid="phase-item-with-library-scans"
                            style={{
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                              }}
                            >
                              <span className={styles.phaseKey}>{key}:</span>
                              <span className={styles.phaseValue}>
                                {summary}
                              </span>
                              <span
                                className={`${styles.statusBadge} ${styles.statusPending}`}
                                data-testid="library-scans-pending-counter"
                              >
                                Pending libraries: {pending}
                              </span>
                            </div>
                            <ul
                              className={styles.phaseList}
                              data-testid="library-scans-sublist"
                              style={{ marginTop: 6, paddingLeft: 18 }}
                            >
                              {libraryScans.map((row, idx) => {
                                const status = row.status ?? 'pending';
                                const badgeClass = (() => {
                                  switch (status) {
                                    case 'completed':
                                      return styles.statusCompleted;
                                    case 'running':
                                      return styles.statusRunning;
                                    case 'pending':
                                      return styles.statusPending;
                                    case 'skipped-cycle':
                                    case 'skipped-depth-cap':
                                      return styles.statusCancelled;
                                    default:
                                      return styles.statusPending;
                                  }
                                })();
                                return (
                                  <li
                                    key={`${row.library_id ?? row.library_name ?? idx}`}
                                    className={styles.phaseItem}
                                    data-testid="library-scan-row"
                                  >
                                    <span className={styles.phaseKey}>
                                      {row.library_name ?? row.library_id ?? '(unnamed)'}
                                    </span>
                                    {typeof row.depth === 'number' && (
                                      <span className={styles.phaseValue}>
                                        depth {row.depth}
                                      </span>
                                    )}
                                    <span
                                      className={`${styles.statusBadge} ${badgeClass}`}
                                      data-testid={`library-scan-status-${status}`}
                                    >
                                      {status}
                                    </span>
                                    {typeof row.files_analyzed === 'number' && (
                                      <span className={styles.phaseValue}>
                                        files {row.files_analyzed}
                                      </span>
                                    )}
                                    {typeof row.candidate_count === 'number' && (
                                      <span className={styles.phaseValue}>
                                        candidates {row.candidate_count}
                                      </span>
                                    )}
                                    {row.error && (
                                      <span
                                        className={styles.phaseValue}
                                        data-testid="library-scan-error"
                                        style={{ color: '#c62828' }}
                                      >
                                        {row.error}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </li>
                        );
                      }
                      return (
                        <li key={key} className={styles.phaseItem}>
                          <span className={styles.phaseKey}>{key}:</span>
                          <span className={styles.phaseValue}>{summary}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {/* Tab strip + active tab panel. While candidates are
                  loading or errored, pass `null` so the canonical view's
                  built-in empty-state placeholder stays in place; the
                  loading / error messages render via candidatesTabHeader
                  above it. */}
              <DiscoveryRunDetailView
                projectId={activeProject.id}
                architectureId={
                  selectedRun.architecture_id ?? activeArchitectureId ?? ''
                }
                selectedRun={selectedRun}
                candidates={
                  candidatesLoading || candidatesError ? null : candidates
                }
                onCandidatesChange={setCandidates}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                initialFindingId={initialFindingId}
                initialReviewRoomOpen={initialReviewRoomOpen}
                candidatesTabHeader={candidatesTabHeader}
                lastSaveTimestamp={lastSaveTimestamp}
                onBulkSave={handleSaveApprovedClick}
                bulkSaveInFlight={saveLoading}
                bulkSaveLabel={
                  hasCommittedCandidates
                    ? 'Save Remaining Approved'
                    : 'Save All Approved'
                }
                hasApprovedToSave={hasApprovedCandidates}
              />
            </div>
          </>
        )}
      </div>

      <SaveBackConfirmModal
        open={saveBackOpen}
        onClose={() => setSaveBackOpen(false)}
        onConfirm={handleSaveApprovedConfirmed}
        candidateCount={approvedCount}
        architectureName={
          runArchitecture?.name ?? selectedRun?.architecture_id ?? ''
        }
        architectureArchived={runArchitecture?.archived ?? false}
      />
    </div>
  );
};
