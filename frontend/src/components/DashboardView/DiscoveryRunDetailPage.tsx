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
import FoundationsReviewPanel from '../Discovery/foundations/FoundationsReviewPanel';
import { listFoundationDecisions } from '../../api/foundationsApi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getDiscoveryRuns,
  getDiscoveryRun,
  getDiscoveryCandidateCount,
  getDiscoveryCandidates,
  saveApprovedCandidates,
  deleteDiscoveryRun,
} from '../../api/discoveryApi';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
  SaveApprovedResult,
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
import {
  DiscoveryBreakdownChip,
  type DiscoveryBreakdownClass,
} from './DiscoveryBreakdownChip';
import { CandidateBulkFillPanel } from './CandidateBulkFillPanel';
import styles from './DiscoveryRunDetailView.module.css';

/** Pull the code run's table -> caller-less-proc-touchers map out of the
 *  step payload (shakedown fix 2, 2026-08-23). The map rides
 *  steps_payload.<codeStep>.effectCandidates.orphanProcTouchers; step key
 *  names vary, so every step value is checked. Absent -> undefined (the
 *  never-touched card keeps its generic note). */
/** Pull the corpus-wide unrooted read facts (Kiro backstop). */
function extractReadAnywhereTables(
  stepsPayload: Record<string, unknown> | null | undefined,
): string[] | undefined {
  if (!stepsPayload || typeof stepsPayload !== 'object') return undefined;
  for (const value of Object.values(stepsPayload)) {
    const effectCandidates = (value as { effectCandidates?: { readAnywhereTables?: unknown } } | null)
      ?.effectCandidates;
    const list = effectCandidates?.readAnywhereTables;
    if (Array.isArray(list) && list.length > 0) return list.map((x) => String(x).toLowerCase());
  }
  return undefined;
}

function extractOrphanProcTouchers(
  stepsPayload: Record<string, unknown> | null | undefined,
): Record<string, string[]> | undefined {
  if (!stepsPayload || typeof stepsPayload !== 'object') return undefined;
  for (const value of Object.values(stepsPayload)) {
    const effectCandidates = (value as { effectCandidates?: { orphanProcTouchers?: unknown } } | null)
      ?.effectCandidates;
    const map = effectCandidates?.orphanProcTouchers;
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const out: Record<string, string[]> = {};
      for (const [table, procs] of Object.entries(map as Record<string, unknown>)) {
        if (Array.isArray(procs)) out[table.toLowerCase()] = procs.map((p) => String(p));
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  }
  return undefined;
}

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
  /** Pretty-printed payload for the EXPANDED view. */
  pretty: string;
  /** True when the payload is long enough to warrant collapse (the phase
   *  JSON has grown large enough to dominate the page's vertical scroll). */
  collapsible: boolean;
  libraryScans?: LibraryScanRow[];
};

/** Collapsed-preview length for a phase payload. */
const PHASE_PREVIEW_CHARS = 180;

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
  if (value === 'findings') return 'findings';
  // Structural Model tab (SCL pipeline spec 6, 2026-08-18 "UI placement").
  if (value === 'structural-model') return 'structural-model';
  return 'candidates';
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
  // Phase-payload JSON collapse (2026-08-24): the database/code step
  // payloads have grown large enough to dominate the page scroll -- each
  // phase renders a one-line preview by default, expandable on demand.
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  // Refresh must also refresh the ACTIVE TAB's contents (2026-08-24 bug:
  // after a run completed, Refresh updated the run detail but the
  // already-selected Candidates tab stayed stale until the user switched
  // away and back). Candidates refetch directly; Findings/Structural Model
  // self-fetch on mount, so bumping this nonce remounts the active panel —
  // the exact mechanism the away-and-back workaround used.
  const [tabRefreshNonce, setTabRefreshNonce] = useState(0);
  const togglePhaseExpanded = useCallback((key: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const [candidates, setCandidates] = useState<DiscoveryCandidateDto[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState<boolean>(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Save All Approved state + lastSaveTimestamp (Bug 3 hotfix counter).
  // -----------------------------------------------------------------------
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  // Foundations receipts (2026-08-22): stored decisions -> per-table scope
  // map so candidate rows carry EXCLUDED/VOLATILE chips. Refreshed whenever
  // the panel applies answers or a save completes (lastSaveTimestamp bumps).
  const [scopeByEntityName, setScopeByEntityName] = useState<
    Map<string, { scope: string; decisionRef: string | null }>
  >(new Map());
  // The legacy outcome string is no longer rendered directly -- the breakdown
  // chip (TG6) reproduces the summary line from saveResult. The setter is kept
  // so the existing reset sites stay valid; the value binding is dropped to
  // satisfy noUnusedLocals.
  const [, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBackOpen, setSaveBackOpen] = useState<boolean>(false);
  const [lastSaveTimestamp, setLastSaveTimestamp] = useState<number | undefined>(
    undefined,
  );
  // -----------------------------------------------------------------------
  // Honest breakdown chip (TG6) + C1 remediation panel (TG7) state.
  // saveResult holds the FULL save-back outcome (or dry-run preview) so the
  // breakdown chip can split the opaque skip count by reason CLASS; clicking a
  // token opens the C1 panel scoped to the clicked reason class.
  // -----------------------------------------------------------------------
  const [saveResult, setSaveResult] = useState<SaveApprovedResult | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [panelReasonClass, setPanelReasonClass] =
    useState<DiscoveryBreakdownClass | null>(null);
  const handleOpenBreakdownClass = useCallback((cls: DiscoveryBreakdownClass) => {
    setPanelReasonClass(cls);
    setPanelOpen(true);
  }, []);
  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const projectId = activeProject?.id;
    const architectureId = selectedRun?.architecture_id ?? activeArchitectureId;
    if (!projectId || !architectureId) {
      setScopeByEntityName(new Map());
      return;
    }
    void listFoundationDecisions(projectId, architectureId)
      .then((decisions) => {
        if (cancelled) return;
        const map = new Map<string, { scope: string; decisionRef: string | null }>();
        for (const d of decisions) {
          if (d.stale) continue;
          const scope = (d.scope ?? '').toLowerCase();
          if (scope !== 'excluded' && scope !== 'volatile') continue;
          for (const target of d.targets_json ?? []) {
            const name = (target.entity_name ?? '').toLowerCase();
            if (name) map.set(name, { scope, decisionRef: d.decision_key });
          }
        }
        setScopeByEntityName(map);
      })
      .catch(() => {
        if (!cancelled) setScopeByEntityName(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, selectedRun?.architecture_id, activeArchitectureId, lastSaveTimestamp]);

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
      setSaveResult(null);
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
      // Active-tab content refresh: candidates are page-held state — refetch
      // them directly; the other tabs remount via the nonce below.
      if (activeTab === 'candidates') {
        void fetchCandidatesForRun(runId);
      }
    }
    setTabRefreshNonce((n) => n + 1);
  }, [
    fetchRunList,
    runId,
    selectedRun?.architecture_id,
    activeArchitectureId,
    activeTab,
    fetchCandidatesForRun,
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
  // Right-click "Delete" on the Run History rows (2026-08-19). Mirrors the
  // DiscoveryRunsList context menu exactly (same classes / testids / server
  // cascade): the AMS delete removes the run and EVERYTHING run-scoped —
  // candidates, evidence, relationships, clusters, decision tasks, findings,
  // capabilities — for code AND database scans alike. Deleting the run this
  // page is currently showing navigates back to the discovery list.
  // -----------------------------------------------------------------------
  const [runMenu, setRunMenu] = useState<{ runId: string; x: number; y: number } | null>(
    null,
  );
  const closeRunMenu = useCallback(() => setRunMenu(null), []);

  const handleRunContextMenu = useCallback(
    (e: React.MouseEvent, contextRunId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setRunMenu({ runId: contextRunId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  useEffect(() => {
    if (!runMenu) return;
    const onDismiss = () => closeRunMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRunMenu();
    };
    document.addEventListener('click', onDismiss);
    document.addEventListener('contextmenu', onDismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDismiss);
      document.removeEventListener('contextmenu', onDismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [runMenu, closeRunMenu]);

  const handleDeleteRun = useCallback(
    async (run: DiscoveryRunDto) => {
      closeRunMenu();
      if (!activeProject?.id) return;
      const runArchitectureId = run.architecture_id ?? activeArchitectureId;
      if (!runArchitectureId) return;
      const inProgress = ['RUNNING', 'PENDING'].includes(
        (run.status ?? '').toUpperCase(),
      );
      const message =
        'Delete this discovery run and all its candidates, evidence, relationships, and findings?\n\n' +
        'This cannot be undone.' +
        (inProgress
          ? '\n\nThis run is still in progress — deleting it now will stop tracking that run.'
          : '');
      if (!window.confirm(message)) return;
      try {
        await deleteDiscoveryRun(activeProject.id, runArchitectureId, run.id);
        if (run.id === runId && discoveryListUrl) {
          // The page is route-bound to the run we just deleted — go back to
          // the list rather than refetching a dead route.
          navigate(discoveryListUrl);
          return;
        }
        await fetchRunList();
      } catch (err) {
        setRunsError(
          err instanceof Error ? err.message : 'Failed to delete discovery run',
        );
      }
    },
    [
      closeRunMenu,
      activeProject?.id,
      activeArchitectureId,
      runId,
      discoveryListUrl,
      navigate,
      fetchRunList,
    ],
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
    setSaveResult(null);
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
    setSaveResult(null);
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
      // Hold the FULL outcome so the honest breakdown chip (TG6) can split the
      // opaque skip count by reason CLASS and offer the C1 remediation panel.
      setSaveResult(result);

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
  /** Collapsed one-line preview + toggle, or the full pretty JSON. Short
   *  payloads render inline with no toggle. */
  const renderPhasePayload = (entry: PhaseEntry): React.ReactNode => {
    if (!entry.collapsible) {
      return <span className={styles.phaseValue}>{entry.summary}</span>;
    }
    const expanded = expandedPhases.has(entry.key);
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <button
            type="button"
            onClick={() => togglePhaseExpanded(entry.key)}
            data-testid={`phase-json-toggle-${entry.key}`}
            style={{
              border: '1px solid #c5cae9',
              background: '#f5f6fb',
              borderRadius: 4,
              padding: '1px 8px',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {expanded ? 'Collapse' : `Expand (${entry.summary.length.toLocaleString()} chars)`}
          </button>
          {!expanded && (
            <span
              className={styles.phaseValue}
              data-testid={`phase-json-preview-${entry.key}`}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {entry.summary.slice(0, PHASE_PREVIEW_CHARS)}
            </span>
          )}
        </span>
        {expanded && (
          <pre
            data-testid={`phase-json-full-${entry.key}`}
            style={{
              margin: 0,
              padding: 8,
              background: '#f7f7f9',
              border: '1px solid #e0e0e6',
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 420,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {entry.pretty}
          </pre>
        )}
      </span>
    );
  };

  const phaseEntries: PhaseEntry[] = [];
  if (selectedRun?.steps_payload) {
    for (const [key, value] of Object.entries(selectedRun.steps_payload)) {
      const summary = typeof value === 'string' ? value : JSON.stringify(value);
      const pretty = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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
      phaseEntries.push({
        key,
        summary,
        pretty,
        collapsible: summary.length > PHASE_PREVIEW_CHARS,
        libraryScans,
      });
    }
  }

  // CSD auto-S0 (2026-08-19): the DB scan pins the S0 snapshot automatically
  // at completion and records the outcome in steps_payload.database.s0Snapshot.
  // Surface it as a readable row — "was S0 pinned?" must be answerable from
  // the scan results screen, not just the raw phase JSON.
  const s0Snapshot = ((): {
    status: string;
    snapshotId: string | null;
    tableCount: number | null;
    detail: string | null;
  } | null => {
    const db = selectedRun?.steps_payload?.['database'];
    if (!db || typeof db !== 'object') return null;
    const raw = (db as Record<string, unknown>)['s0Snapshot'];
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as Record<string, unknown>;
    return {
      status: typeof rec.status === 'string' ? rec.status : 'unknown',
      snapshotId: typeof rec.snapshotId === 'string' ? rec.snapshotId : null,
      tableCount: typeof rec.tableCount === 'number' ? rec.tableCount : null,
      detail: typeof rec.detail === 'string' ? rec.detail : null,
    };
  })();

  // Routine catalog (Stored Proc & Function Behaviour Program, Spec 1,
  // 2026-09-09): the DB scan profiles every harvested proc / function /
  // trigger and saves the catalog to AMS at completion, recording the
  // outcome in steps_payload.database.routineCatalog. Surface it as a row
  // beside S0 — "were the routines catalogued?" is answerable from the scan.
  const routineCatalog = ((): {
    status: string;
    profiled: number | null;
    unparsed: number | null;
    detail: string | null;
  } | null => {
    const db = selectedRun?.steps_payload?.['database'];
    if (!db || typeof db !== 'object') return null;
    const raw = (db as Record<string, unknown>)['routineCatalog'];
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as Record<string, unknown>;
    return {
      status: typeof rec.status === 'string' ? rec.status : 'unknown',
      profiled: typeof rec.profiled === 'number' ? rec.profiled : null,
      unparsed: typeof rec.unparsed === 'number' ? rec.unparsed : null,
      detail: typeof rec.detail === 'string' ? rec.detail : null,
    };
  })();

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

  // Reference-field typeahead suggestions for the C1 panel: names of committed
  // model entities (pick-from-existing only, v1) PLUS already-approved /
  // committed candidate names. Defensive against a partially-mocked context.
  // Typed option sources (2026-08-25 — Grid fkTarget parity for the C1
  // panel): committed entity names per collection + this run's approved/
  // committed candidates; the panel derives each registered blocking
  // field's EXACT valid choices from these.
  const typedReferenceSources = useMemo(() => {
    const modelEntitiesByCollection: Record<string, string[]> = {};
    const entities = archCtx.state?.model?.metaModel?.entities as unknown as
      | Record<string, Array<{ name?: string }>>
      | undefined;
    if (entities) {
      for (const [collection, arr] of Object.entries(entities)) {
        if (!Array.isArray(arr)) continue;
        const names = arr
          .map((e) => (e as { name?: string }).name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0);
        if (names.length > 0) modelEntitiesByCollection[collection] = names;
      }
    }
    const runCandidates = candidates
      .filter(
        (c) =>
          (c.review_status === 'approved' || c.review_status === 'committed') &&
          typeof c.name === 'string' &&
          c.name.length > 0,
      )
      .map((c) => ({ id: c.id, name: c.name, candidate_type: c.candidate_type }));
    return { modelEntitiesByCollection, runCandidates };
  }, [archCtx.state?.model, candidates]);

  const referenceSuggestions = useMemo<string[]>(() => {
    const names = new Set<string>();
    const entities = archCtx.state?.model?.metaModel?.entities as unknown as
      | Record<string, Array<{ name?: string }>>
      | undefined;
    if (entities) {
      for (const arr of Object.values(entities)) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          const n = (e as { name?: string }).name;
          if (typeof n === 'string' && n.length > 0) names.add(n);
        }
      }
    }
    for (const c of candidates) {
      if (
        (c.review_status === 'approved' || c.review_status === 'committed') &&
        typeof c.name === 'string' &&
        c.name.length > 0
      ) {
        names.add(c.name);
      }
    }
    return Array.from(names).sort();
  }, [archCtx.state, candidates]);

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
      {/* Foundations review (Spec 2, 2026-08-22): estate triage ON the
          DB-scan review — one scan, one review, one save. Questions derive
          from this run's candidates + stored decisions; applying tags model
          entities (scope + receipt) through the MCP model-write owner. */}
      {selectedRun &&
        (selectedRun.discovery_kind === 'database' || selectedRun.discovery_kind === 'code') &&
        !candidatesLoading &&
        !candidatesError &&
        activeProject?.id && (
          <FoundationsReviewPanel
            projectId={activeProject.id}
            architectureId={selectedRun.architecture_id ?? activeArchitectureId ?? ''}
            candidates={candidates}
            mode={selectedRun.discovery_kind === 'code' ? 'code' : 'database'}
            onApplied={() => setLastSaveTimestamp(Date.now())}
            modelRefreshKey={lastSaveTimestamp}
            orphanProcTouchers={extractOrphanProcTouchers(selectedRun.steps_payload)}
            readAnywhereTables={extractReadAnywhereTables(selectedRun.steps_payload)}
          />
        )}
      {/* Estate continuation (Spec 5): after the DB scan lands, guide the
          user straight into the code scan — the joint CRUD questions only
          exist once both evidence sets do. */}
      {selectedRun &&
        selectedRun.discovery_kind === 'database' &&
        (selectedRun.status ?? '').toUpperCase() === 'COMPLETED' &&
        discoveryListUrl && (
          <div
            data-testid="estate-continuation-banner"
            style={{
              border: '1px solid #cfe3cf',
              background: '#f2f9f2',
              borderRadius: 6,
              padding: '8px 12px',
              margin: '0 0 10px',
              fontSize: 13,
            }}
          >
            <strong>Estate scan — next step:</strong> review &amp; save this DB scan, then{' '}
            <a href={discoveryListUrl}>run the code scan</a>. The joint foundation questions
            (tables no code touches, write-only audit sinks, scope conflicts) appear on the
            code scan&apos;s review once both evidence sets exist.
          </div>
        )}
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
          {saveResult && (
            <DiscoveryBreakdownChip
              result={saveResult}
              onOpenClass={handleOpenBreakdownClass}
            />
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
                    onContextMenu={(e) => handleRunContextMenu(e, run.id)}
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
          {runMenu &&
            (() => {
              const run = runs.find((r) => r.id === runMenu.runId);
              if (!run) return null;
              return (
                <div
                  className={styles.runContextMenu}
                  style={{ top: runMenu.y, left: runMenu.x }}
                  data-testid="run-context-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={`${styles.runContextMenuItem} ${styles.runContextMenuItemDanger}`}
                    onClick={() => void handleDeleteRun(run)}
                    data-testid="run-context-menu-delete"
                  >
                    Delete run
                  </button>
                </div>
              );
            })()}
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

              {routineCatalog && (
                <div
                  className={styles.runDetailRow}
                  data-testid="routine-catalog-row"
                >
                  <span className={styles.runDetailLabel}>Routine catalog:</span>
                  <span
                    className={`${styles.statusBadge} ${
                      routineCatalog.status === 'saved'
                        ? routineCatalog.unparsed
                          ? styles.statusRunning
                          : styles.statusCompleted
                        : routineCatalog.status === 'failed'
                          ? styles.statusFailed
                          : styles.statusCancelled
                    }`}
                    data-testid={`routine-catalog-status-${routineCatalog.status}`}
                  >
                    {routineCatalog.status === 'saved'
                      ? `${routineCatalog.profiled ?? 0} profiled`
                      : routineCatalog.status === 'failed'
                        ? 'FAILED'
                        : 'Skipped'}
                  </span>
                  {routineCatalog.status === 'saved' &&
                    (routineCatalog.unparsed ?? 0) > 0 && (
                      <span
                        className={styles.phaseValue}
                        data-testid="routine-catalog-unparsed"
                      >
                        {routineCatalog.unparsed} signature
                        {routineCatalog.unparsed === 1 ? '' : 's'} unparsed
                      </span>
                    )}
                  {routineCatalog.status === 'failed' && routineCatalog.detail && (
                    <span
                      className={styles.phaseValue}
                      data-testid="routine-catalog-detail"
                    >
                      {routineCatalog.detail}
                    </span>
                  )}
                </div>
              )}

              {s0Snapshot && (
                <div
                  className={styles.runDetailRow}
                  data-testid="s0-snapshot-row"
                >
                  <span className={styles.runDetailLabel}>S0 snapshot:</span>
                  <span
                    className={`${styles.statusBadge} ${
                      s0Snapshot.status === 'taken'
                        ? styles.statusCompleted
                        : s0Snapshot.status === 'failed'
                          ? styles.statusFailed
                          : styles.statusCancelled
                    }`}
                    data-testid={`s0-snapshot-status-${s0Snapshot.status}`}
                  >
                    {s0Snapshot.status === 'taken'
                      ? 'Taken with this scan'
                      : s0Snapshot.status === 'failed'
                        ? 'FAILED'
                        : 'Skipped'}
                  </span>
                  {s0Snapshot.status === 'taken' &&
                    s0Snapshot.tableCount !== null && (
                      <span className={styles.phaseValue}>
                        {s0Snapshot.tableCount} table
                        {s0Snapshot.tableCount === 1 ? '' : 's'}
                      </span>
                    )}
                  {s0Snapshot.detail && (
                    <span
                      className={styles.phaseValue}
                      data-testid="s0-snapshot-detail"
                      style={
                        s0Snapshot.status === 'failed'
                          ? { color: '#c62828' }
                          : undefined
                      }
                    >
                      {s0Snapshot.detail}
                    </span>
                  )}
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
                      const { key, libraryScans } = entry;
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
                              {renderPhasePayload(entry)}
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
                          {renderPhasePayload(entry)}
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
                tabContentRefreshKey={tabRefreshNonce}
                initialFindingId={initialFindingId}
                initialReviewRoomOpen={initialReviewRoomOpen}
                candidatesTabHeader={candidatesTabHeader}
                scopeByEntityName={scopeByEntityName}
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

      <CandidateBulkFillPanel
        open={panelOpen}
        scopeClass={panelReasonClass}
        result={saveResult}
        candidates={candidates}
        referenceSuggestions={referenceSuggestions}
        typedReferenceSources={typedReferenceSources}
        projectId={activeProject.id}
        architectureId={
          selectedRun?.architecture_id ?? activeArchitectureId ?? ''
        }
        runId={runId ?? ''}
        onClose={handleClosePanel}
        onApplied={() => {
          if (runId && selectedRun?.architecture_id) {
            void fetchCandidatesForRun(runId);
            void refreshSelectedRunDetail(runId, selectedRun.architecture_id);
          }
        }}
      />

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
