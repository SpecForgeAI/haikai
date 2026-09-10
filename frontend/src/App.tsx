import { useEffect, useRef, useState } from 'react';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// View selection is now URL-driven. The catch-all `<Route path="*" element={<AppContent/>} />`
// from Group 1 is gone; every route either lands on an architecture-scoped
// view (rendered inside `<AppShell>`) or on `<RootRoute>` for the bare `/`
// (which renders the existing landing/loading shell with no view body).
//
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
// AppShell now renders an `<Outlet/>` so nested architecture-scoped child
// routes mount inside the shell. The four top-level views (`dashboard`,
// `metamodel`, `diagrams`, `product`) move from sibling flat routes to
// children of a single AppShell parent route. The bare `/projects/:p/architectures/:a`
// URL redirects to `dashboard` via an index `<Navigate replace/>`.
//
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3
// `<AppContent>` is extracted from `<App>` so the test infrastructure helper
// (`renderWithFullApp` in `__tests__/routing/testUtils.tsx`) can wrap the
// inner provider tree + routes with `<MemoryRouter initialEntries=...>`
// instead of `<BrowserRouter>`. Production `<App>` still mounts
// `<BrowserRouter><AppContent/></BrowserRouter>`. This is the standard
// React Router v6 pattern for routable test harnesses.
//
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
// Metamodel becomes a parent route with a default-domain index redirect
// and a `:domain` child route. The MetaModelView component itself is the
// layout (it reads useParams().domain via the useMetaModelDomain hook and
// renders the active-domain body inline). The `:domain` child element is
// `null` -- it exists purely so that the URL matches; MetaModelView reads
// the param.
import { BrowserRouter, Routes, Route, useNavigate, Outlet, Navigate } from 'react-router-dom';
import {
  ArchitectureProvider,
  useArchitecture,
  useArchitectureDispatch,
  useActiveArchitectureId,
  useArchitectureContext,
} from './contexts/ArchitectureContext';
import type { ArchitectureModel } from './types/model';
// Spec 2026-01-05: Import ProjectProvider for active project state
import { ProjectProvider } from './contexts/ProjectContext';
// Spec 2026-01-19: Import AppConfigProvider and useIncludeDelivery for runtime configuration and view gating
import { AppConfigProvider, useIncludeDelivery, useIncludeDatabase } from './contexts/AppConfigContext';
import { useProject, useProjectLoading } from './contexts/ProjectContext';
import { loadModelByProjectId } from './api/modelApi';
// Spec 2026-02-28: Hub Chat MVP v1 - Removed PersonaPanelProvider (replaced by UnifiedChatPanel)
import { TopBar } from './components/TopBar/TopBar';
import { LandingPage } from './components/LandingPage/LandingPage';
import { MetaModelView } from './components/MetaModelView/MetaModelView';
import { DiagramsView } from './components/DiagramsView/DiagramsView';
// Spec 2026-01-03: Task Group 4 - Import ProductView component
import { ProductView } from './components/ProductView/ProductView';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
// Product sub-route tab body components. Each is mounted as a child route
// of the `product` parent; ProductView is the persistent layout/chrome.
import { MissionTab } from './components/ProductView/MissionTab';
import { RoadmapTab } from './components/ProductView/RoadmapTab';
import { BacklogTab } from './components/ProductView/BacklogTab';
import { ImplementTab } from './components/ProductView/ImplementTab';
// Spec 2026-06-12: bare implement tab landing (init gate)
import { ImplementGateLanding } from './components/ProductView/ImplementationInitGate';
// Spec 2026-02-17: Dashboard Increment 1 - Import DashboardView component
import { DashboardView } from './components/DashboardView/DashboardView';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
// Discovery is promoted to first-class routes:
//   `/discovery`              -> DiscoveryListPage (V1 stripped-down list)
//   `/discovery/runs/:runId`  -> DiscoveryRunDetailPage (deep-linkable detail)
import { DiscoveryListPage } from './components/DashboardView/DiscoveryListPage';
import { DiscoveryRunDetailPage } from './components/DashboardView/DiscoveryRunDetailPage';
// Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
// Sibling page for capture sessions and saved baselines. Mirrors the
// Discovery first-class route pattern above.
//   `/api-behaviour`                       -> ApiBaselinesListPage
//   `/api-behaviour/sessions/:sessionId`   -> CaptureSessionDetailPage
//   `/api-behaviour/baselines/:baselineId` -> BaselineDetailPage
import { ApiBaselinesListPage } from './components/DashboardView/ApiBaselinesListPage';
import { CaptureSessionDetailPage } from './components/DashboardView/CaptureSessionDetailPage';
import { BaselineDetailPage } from './components/DashboardView/BaselineDetailPage';
// Stored Proc & Function Behaviour Program, Spec 3 (2026-09-09). Second
// behaviour-baseline kind; sibling detail routes under `/proc-behaviour`.
//   `/proc-behaviour/capture-sessions/:sessionId` -> ProcCaptureSessionDetailPage
//   `/proc-behaviour/baselines/:baselineId`       -> ProcBaselineDetailPage
import { ProcCaptureSessionDetailPage } from './components/ProcBehaviour/ProcCaptureSessionDetailPage';
import { ProcBaselineDetailPage } from './components/ProcBehaviour/ProcBaselineDetailPage';
// Spec 2026-06-24 Vulnerability store + manual capture + current-state view
// -- Task Group 5. New top-level "Security" tab (peer of discovery /
// api-behaviour). Mounted architecture-scoped under <AppShell> so it
// inherits the TopBar + providers and survives ProjectLayout's
// missing-architecture redirect via the `security` KNOWN_VIEW_SEGMENTS entry.
import { SecurityView } from './components/SecurityView/SecurityView';
// Security health dashboard (2026-07-19, Spec 3 of 3): the tabbed Security
// area -- Overview (generated Security Summary diagram + severity overlays),
// Findings Register (flattened detail), with the legacy scan screen re-homed.
import { SecurityLayout } from './components/SecurityOverview/SecurityLayout';
import { SecurityOverview } from './components/SecurityOverview/SecurityOverview';
import { FindingsRegister } from './components/SecurityOverview/FindingsRegister';
// Spec 2026-05-19 PM Migration Shape-Spec Batch Generation -- follow-up route wiring
// Workspace surface for batch-generated shape-specs, drill-into from the
// WorkItem Implement tab's `ImplementTabShapeSpecCard`.
// Spec 2026-05-19 Migration Delivery Progress and Evidence Tracking -- Task Group 13
// Route registration + AppShell wiring (Q-10). The dashboard surface is
// architecture-scoped (mirrors the SpecGenerationWorkspaceRoute precedent
// above) so it inherits TopBar + providers from <AppShell> and so
// <ProjectLayout>'s missing-architecture redirect does not bounce a deep
// link away.
import { MigrationDeliveryDashboardRoute } from './components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryDashboardRoute';
// Stakeholder progress report (2026-08-16): the deterministic, single-screen
// reconciliation summary for one book of work. Same architecture-scoped
// rationale as the delivery dashboard route above.
import { MigrationProgressReportRoute } from './components/ProductManager/MigrationProgressReport/MigrationProgressReportRoute';
// Spec 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
// -- follow-up route wiring (2026-06-03). The generation wizard, draft list,
// and review workspace were built + unit-tested but never mounted behind a
// production route. These two architecture-scoped wrappers mount them so a PM
// can launch discovery->backlog auto-build end-to-end. Same architecture-scoped
// rationale as SpecGenerationWorkspaceRoute / MigrationDeliveryDashboardRoute
// above (inherit <AppShell> chrome; avoid ProjectLayout's missing-arch bounce).
import { MigrationDeliveryPlanRoute } from './components/ProductManager/MigrationDeliveryPlan/MigrationDeliveryPlanRoute';
import { MigrationBookOfWorkReviewRoute } from './components/ProductManager/MigrationDeliveryPlan/MigrationBookOfWorkReviewRoute';
// Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.2
// Architecture & Design page Target State sub-tab layout. Wraps the existing
// <TargetArchitectureWorkspace /> with the shared <ArchitectureDesignSubTabs />
// strip and mounts under the canonical sub-route
//   /projects/:p/architectures/:a/architecture-design/target-state.
// The legacy top-level /target-architecture route is now a <Navigate replace>
// redirect to this URL so existing bookmarks continue to land in the workspace.
import { ArchitectureDesignTargetStatePage } from './components/Architecture/ArchitectureDesignTargetStatePage';
// Spec 2026-01-31: Import CreateOrganisationModal for global modal
import { CreateOrganisationModal } from './components/Organisation/CreateOrganisationModal';
// Spec 2026-03-04: Assistant "What's Next" v1 - Import PendingActionProvider for cross-screen action handoff
import { PendingActionProvider } from './contexts/PendingActionContext';
// Spec 2026-03-26: Temporary Diagram Context for external activation of temporary diagram mode
import { TemporaryDiagramProvider } from './contexts/TemporaryDiagramContext';
// Spec 2026-04-03: User Journey Review Context for ephemeral multi-journey review session
import { UserJourneyReviewProvider } from './contexts/UserJourneyReviewContext';
// Spec 2026-04-07: User Journey Overview Review Context for single overview diagram review
import { UserJourneyOverviewReviewProvider } from './contexts/UserJourneyOverviewReviewContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 1
// Route-level layout that handles the missing-`:architectureId` redirect.
import { ProjectLayout } from './components/Layout/ProjectLayout';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
// 404 page mounted by the routes-tree catch-all.
import { NotFoundPage } from './components/Layout/NotFoundPage';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useCurrentView replaces the removed `state.currentView` reducer field.
import { useCurrentView } from './hooks/useCurrentView';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
// Default URL token for the metamodel index redirect.
import { DEFAULT_META_MODEL_DOMAIN_URL } from './hooks/useCurrentView';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
// useEmptyArchitectureToast fires the empty-view info toast when the user
// switches to an architecture whose current view would be empty.
import { useEmptyArchitectureToast } from './hooks/useEmptyArchitectureToast';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 6
// ToastProvider hosts the global toast slot used by ProjectLayout's redirect
// (and reusable by Group 5's empty-view-on-switch hint).
import { ToastProvider } from './contexts/ToastContext';
import './App.css';

/**
 * Helper to check if an element is contenteditable.
 * Uses both isContentEditable property and attribute check for broader compatibility.
 *
 * Spec 2026-01-31: Used by keyboard shortcut to skip when focus is on editable elements
 */
function isContentEditable(element: Element): boolean {
  // Check the isContentEditable property first (standard)
  if ((element as HTMLElement).isContentEditable) {
    return true;
  }
  // Fallback: check the contenteditable attribute (for edge cases)
  const attr = element.getAttribute('contenteditable');
  return attr === 'true' || attr === '';
}

/**
 * Spec 2026-01-31: Global keyboard shortcut for opening the Create Organisation
 * modal (Ctrl/Cmd+Shift+M). Extracted into a hook so both `<RootRoute>` and
 * `<AppShell>` can register it without duplicating logic.
 */
function useCreateOrganisationShortcut(
  isCreateOrgModalOpen: boolean,
  setIsCreateOrgModalOpen: (open: boolean) => void
): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        const activeElement = document.activeElement;
        if (activeElement) {
          const tagName = activeElement.tagName.toLowerCase();
          if (
            tagName === 'input' ||
            tagName === 'textarea' ||
            isContentEditable(activeElement)
          ) {
            return;
          }
        }
        e.preventDefault();
        if (!isCreateOrgModalOpen) {
          setIsCreateOrgModalOpen(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCreateOrgModalOpen, setIsCreateOrgModalOpen]);
}

/**
 * AppShell
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 *
 * Wraps a single architecture-scoped view in the full TopBar shell. Mounted
 * by every architecture-scoped route as the parent layout; nested child
 * routes (`dashboard`, `metamodel`, `diagrams`, `product`, `discovery`)
 * render their bodies into the `<Outlet/>` slot below.
 *
 * The view itself is determined by the URL (via `useCurrentView()`); the
 * outlet renders whichever child route matched.
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles -- the
 * Product & Delivery view is gated behind `includeDelivery`. When the toggle
 * is off and the user lands on `/.../product`, we redirect to `/.../metamodel`
 * via `useNavigate`. This replaces the previous SET_VIEW dispatch from
 * `AppContent`.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   The auto-load-model-on-refresh effect (originally in `<AppContent>`) lives
 *   here so that opening any architecture-scoped URL eagerly populates
 *   `state.model` for Save / Save As / model-aware UI. Skipped when no
 *   architectureId or active project is available, when database mode is off,
 *   or when a model is already loaded.
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
 *   useEmptyArchitectureToast watches activeArchitectureId. When the user
 *   switches to a different architecture and the destination view is empty
 *   (per useViewIsEmpty rules), it fires an info toast through ToastProvider.
 *   Skipped on initial mount and for the dashboard view.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
 *   The `view: React.ReactNode` prop is gone -- the shell now renders
 *   `<Outlet/>` so each architecture-scoped child route (one per top-level
 *   view) can mount its body inside the shell. This makes the shell stable
 *   across in-shell route transitions (no remount of TopBar / providers /
 *   modal mount points) and lays the parent-route plumbing that Groups 4-7
 *   extend with sub-routes.
 *
 * Spec 2026-05-01 Cross-Architecture Model Reload Bug Fix
 *   The previous boolean `initialModelLoaded` only fired the load on first
 *   mount. When the user switched to another architecture via the selector,
 *   `activeArchitectureId` flipped from A to B, but the boolean was already
 *   true AND `state.loadedFileName` was still set from A's load. The effect
 *   bailed, leaving the in-memory model as A's data while the URL claimed
 *   to show B. Subsequent edits saved to whichever architecture's model
 *   happened to be in memory, producing cross-architecture pollution.
 *
 *   The fix tracks the architectureId the model was loaded for via a ref.
 *   When activeArchitectureId differs from the loaded id, the effect
 *   dispatches RESET_MODEL (clearing stale A data) and re-issues
 *   loadModelByProjectId for the new id. The ref (not state) is used to
 *   avoid an extra render cycle and the resulting transient empty UI flash
 *   beyond the unavoidable RESET_MODEL frame.
 *
 * Hotfix 2026-05-01 Per-Architecture In-Memory Cache (Bug 1)
 *   The cross-architecture reload fix introduced a regression: when the user
 *   makes unsaved changes on architecture A, swaps to B (which dispatches
 *   RESET_MODEL + fetches B), and then swaps back to A, the unsaved A changes
 *   are lost because we re-fetch A from the server.
 *
 *   This hotfix adds a per-architecture in-memory cache (Map<archId, {model,
 *   loadedFileName}>) that lives in a useRef so it survives re-renders. The
 *   cache is:
 *     - Updated whenever LOAD_MODEL has placed a settled model in state for
 *       the active architecture (via an effect that mirrors state.model into
 *       the cache for the currently-loaded arch). This naturally captures
 *       initial loads, post-save LOAD_MODEL dispatches, AND user edits
 *       (since edits update state.model in place).
 *     - Read on architecture swap: if the new arch is in the cache, dispatch
 *       LOAD_MODEL with the cached model (no DB fetch) so the user sees their
 *       prior in-memory state (saved or unsaved).
 *     - Cleared on project change so cross-project state cannot leak.
 *
 *   Caveats:
 *     - Memory grows linearly with the number of distinct architectures the
 *       user has visited within the current project session. For typical
 *       projects (low single-digit architectures), this is negligible. Cleared
 *       on project change.
 *     - The cache stores the FULL ArchitectureModel (entities, relationships,
 *       diagrams). For very large models this could be a concern, but the
 *       same model already lives in state.model so the marginal cost is one
 *       extra reference per parked architecture (the object itself is shared
 *       until the user mutates it on a swap-back).
 *     - When restoring from cache we dispatch LOAD_MODEL, which re-runs the
 *       reducer's reconciliation pipeline (idempotent) and resets
 *       selectedDiagramId to the first diagram. This matches existing
 *       initial-load behaviour and is preferable to introducing a new
 *       reducer action just for cache restore.
 */
function AppShell() {
  const includeDelivery = useIncludeDelivery();
  const includeDatabase = useIncludeDatabase();
  const navigate = useNavigate();
  const currentView = useCurrentView();

  const dispatch = useArchitectureDispatch();
  const state = useArchitecture();
  const activeProject = useProject();
  const projectLoading = useProjectLoading();
  const activeArchitectureId = useActiveArchitectureId();

  // Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
  //
  // Pull the cache-invalidator registration setter off the architecture
  // context. The provider holds the registered callback in a ref and routes
  // public `invalidateArchitectureModelCache(id)` calls through it; we wire
  // up our `cacheRef.delete(id)` implementation in an effect below.
  const { setArchitectureModelCacheInvalidator } = useArchitectureContext();

  // Spec 2026-05-01 Cross-Architecture Model Reload Bug Fix
  // Track the (projectId, architectureId) pair the in-memory model was loaded
  // for. We compare BOTH because the same architectureId could in principle
  // appear under different projects (it does not, but defensive comparison
  // prevents future regressions). A null entry means "not loaded yet".
  const loadedForRef = useRef<{ projectId: string; architectureId: string } | null>(null);

  // Hotfix 2026-05-01 Per-Architecture In-Memory Cache (Bug 1)
  // Map<architectureId, {model, loadedFileName}> for the active project.
  // Lives across renders (useRef) and is cleared on project change.
  const cacheRef = useRef<Map<string, { model: ArchitectureModel; loadedFileName: string | null }>>(
    new Map()
  );
  // Track the project id the cache currently belongs to so we can clear on
  // project change without depending on referential equality of the project
  // object (which can change without the id changing across re-renders).
  const cacheProjectIdRef = useRef<string | null>(null);

  // Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
  //
  // Register a stable cache-invalidator with the ArchitectureProvider so the
  // selective-copy wizard (and any other backend write that bypasses the
  // dispatch path) can flush a stale entry from `cacheRef`. The callback
  // closes over the (stable across renders) `cacheRef` ref object, so it
  // does not need to re-register when state changes -- the empty dep array
  // is intentional. Clearing on unmount prevents the provider from holding
  // a callback that points at an unmounted AppShell's cache.
  useEffect(() => {
    setArchitectureModelCacheInvalidator((architectureId: string) => {
      cacheRef.current.delete(architectureId);
    });
    return () => {
      setArchitectureModelCacheInvalidator(null);
    };
  }, [setArchitectureModelCacheInvalidator]);

  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);
  useCreateOrganisationShortcut(isCreateOrgModalOpen, setIsCreateOrgModalOpen);

  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
  // Empty-view-on-switch toast trigger. Mounted here because <AppShell> is
  // the lowest component that has access to both the active architecture id
  // (via context) and is stable across architecture switches (Group 4
  // safety property e). The hook itself is a pure side-effect; it does not
  // render anything. The toast slot is owned by <ToastProvider> at the app
  // root.
  useEmptyArchitectureToast();

  // Spec 2026-01-19: Task Group 3 -- View Navigation Guard
  // If the user lands on the `product` view while delivery is gated off,
  // bounce them to `metamodel` on the same architecture-scoped URL. The
  // pre-routing implementation dispatched SET_VIEW; the URL-driven
  // implementation rewrites only the trailing view segment.
  useEffect(() => {
    if (!includeDelivery && currentView === 'product') {
      const segments = window.location.pathname.split('/').filter(Boolean);
      const archIdx = segments.indexOf('architectures');
      if (archIdx >= 0 && segments.length > archIdx + 2) {
        const projectId = segments[archIdx - 1];
        const architectureId = segments[archIdx + 1];
        navigate(`/projects/${projectId}/architectures/${architectureId}/metamodel`, { replace: true });
      }
    }
  }, [includeDelivery, currentView, navigate]);

  // Hotfix 2026-05-01 Per-Architecture In-Memory Cache (Bug 1)
  //
  // Mirror state.model into the cache whenever the model in state corresponds
  // to the active architecture (i.e. loadedForRef has caught up to
  // activeArchitectureId AND state.loadedFileName is non-null, indicating
  // we are NOT in the post-RESET_MODEL interstitial). This single effect
  // covers:
  //   - Initial load completion (LOAD_MODEL fires after the first fetch).
  //   - User edits (any reducer action that mutates state.model).
  //   - Post-save LOAD_MODEL dispatched by saveModelToBackend.
  //   - Cache restoration LOAD_MODEL (idempotent re-write).
  //
  // We deliberately do NOT write while state.loadedFileName is null because
  // RESET_MODEL puts an empty model in state during the swap interstitial,
  // and overwriting the cache with that empty model would lose any in-flight
  // unsaved data for the architecture being swapped FROM (in the rare case
  // the swap-out park step in the next effect did not run synchronously).
  useEffect(() => {
    if (!activeArchitectureId) return;
    const loaded = loadedForRef.current;
    if (!loaded || loaded.architectureId !== activeArchitectureId) return;
    if (state.loadedFileName === null) return;
    cacheRef.current.set(activeArchitectureId, {
      model: state.model,
      loadedFileName: state.loadedFileName,
    });
  }, [activeArchitectureId, state.model, state.loadedFileName]);

  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
  // Spec 2026-05-01 Cross-Architecture Model Reload Bug Fix
  // Hotfix 2026-05-01 Per-Architecture In-Memory Cache (Bug 1)
  //
  // Auto-load the model when an active project + architectureId are present.
  // The original implementation gated on a one-shot boolean, which prevented
  // re-load when the user switched architectures via the selector and the
  // URL changed from /architectures/A/... to /architectures/B/... -- the
  // in-memory model stayed as A's data while the UI claimed to show B,
  // causing edits to be persisted to the wrong architecture on the next save.
  //
  // The current gate uses a ref tracking (projectId, architectureId) of the
  // currently loaded model. When the active pair differs (initial mount,
  // architecture switch, or project switch), we:
  //   0. (Hotfix Bug 1) If project changed: clear the cache.
  //   1. (Hotfix Bug 1) Park the current state.model into cacheRef under the
  //      previous architectureId so a swap-back can restore it without a
  //      DB fetch. Skip if state.loadedFileName is null (interstitial state).
  //   2. Update loadedForRef synchronously to the new pair so a fast re-render
  //      from RESET_MODEL doesn't re-fire the load.
  //   3. (Hotfix Bug 1) If the new architectureId is in the cache, dispatch
  //      LOAD_MODEL with the cached model -- no DB fetch -- and return.
  //   4. Otherwise dispatch RESET_MODEL to clear stale entity data immediately.
  //   5. Issue loadModelByProjectId for the new architecture-scoped endpoint.
  //   6. On success, dispatch LOAD_MODEL to replace the empty model with the
  //      newly fetched one.
  //   7. On failure, log a warning AND clear the ref so a subsequent retry
  //      (e.g. via React strict-mode double-effect or user action) re-attempts.
  useEffect(() => {
    if (!includeDatabase || projectLoading || !activeProject) return;
    if (!activeArchitectureId) return;

    const desired = { projectId: activeProject.id, architectureId: activeArchitectureId };
    const loaded = loadedForRef.current;
    if (
      loaded &&
      loaded.projectId === desired.projectId &&
      loaded.architectureId === desired.architectureId
    ) {
      // Already loaded for this exact (project, architecture) pair.
      return;
    }

    // Hotfix Bug 1: clear cache on project change.
    if (cacheProjectIdRef.current !== null && cacheProjectIdRef.current !== desired.projectId) {
      cacheRef.current.clear();
    }
    cacheProjectIdRef.current = desired.projectId;

    // Hotfix Bug 1: park the current state.model into the cache under the
    // PREVIOUS architectureId before we lose it. The mirror effect above
    // typically keeps the cache in sync continuously, but doing this
    // synchronously here closes a theoretical race window where a state
    // update and an arch swap occur in the same render commit.
    if (
      loaded &&
      loaded.projectId === desired.projectId &&
      loaded.architectureId !== desired.architectureId &&
      state.loadedFileName !== null
    ) {
      cacheRef.current.set(loaded.architectureId, {
        model: state.model,
        loadedFileName: state.loadedFileName,
      });
    }

    // Mark as loading-for so a re-render doesn't re-fire the load.
    loadedForRef.current = desired;

    // Hotfix Bug 1: cache hit -> restore in-memory state without a DB fetch.
    const cached = cacheRef.current.get(desired.architectureId);
    if (cached) {
      dispatch({
        type: 'LOAD_MODEL',
        payload: cached.model,
        fileName: cached.loadedFileName ?? activeProject.name,
      });
      return;
    }

    // Clear stale entity / diagram / relationship data BEFORE the new load so
    // edits cannot land on the previous architecture's in-memory model in the
    // window between architecture switch and load completion.
    dispatch({ type: 'RESET_MODEL' });

    loadModelByProjectId(desired.projectId, desired.architectureId)
      .then(model => {
        // Guard against an out-of-order resolution: if the user switched
        // architectures while this fetch was in flight, a later effect run
        // already updated `loadedForRef`; ignore this stale response.
        const currentRef = loadedForRef.current;
        if (
          !currentRef ||
          currentRef.projectId !== desired.projectId ||
          currentRef.architectureId !== desired.architectureId
        ) {
          return;
        }
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: activeProject.name });
      })
      .catch(err => {
        console.warn('Could not auto-load model for active project:', err);
        // Clear the ref so a subsequent prop change can retry the load.
        const currentRef = loadedForRef.current;
        if (
          currentRef &&
          currentRef.projectId === desired.projectId &&
          currentRef.architectureId === desired.architectureId
        ) {
          loadedForRef.current = null;
        }
      });
    // `state.loadedFileName` is intentionally NOT in the dependency array --
    // it would re-fire the effect once LOAD_MODEL lands and create a loop.
    // The ref is the single source of truth for "have we loaded for this
    // (project, architecture) pair yet". `state.model` is also intentionally
    // omitted -- the park step reads it via the ref-tracked loadedForRef
    // comparison; including it would re-fire the effect on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDatabase, projectLoading, activeProject, activeArchitectureId, dispatch]);

  return (
    <div className="app">
      {/* Spec 2026-01-22: Pass main content as children to TopBar for ImportActionsProvider wrapping */}
      <TopBar>
        <main className="main-content">
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
            The active child route's element renders here. For Group 2 the
            child elements are still the four flat top-level views; Groups
            4-7 extend each into its own sub-route tree.
          */}
          <Outlet />
        </main>
      </TopBar>

      {/* Spec 2026-01-31: Create Organisation Modal -- mounted at App root for global access */}
      <CreateOrganisationModal
        isOpen={isCreateOrgModalOpen}
        onClose={() => setIsCreateOrgModalOpen(false)}
      />
    </div>
  );
}

/**
 * RootRoute
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
 *
 * Renders the bare-shell view at `/` -- this is what the user sees before any
 * project is open.
 *
 * Behaviour (post 2026-05-04 cleanup): three terminal states only --
 *   (a) DB mode + no active project (or File mode + no active project) ->
 *       <LandingPage> with the "Create Organisation" entry point.
 *   (b) Loading state -> spinner.
 *   (c) Hydrated active project -> imperative navigate to
 *       `/projects/:projectId`, which <ProjectLayout> then chains to the
 *       canonical `/projects/:p/architectures/:a/dashboard` URL.
 *
 * The legacy "TopBar with empty <main>" else-branch that used to render in
 * File mode (or in the transient window between hydration and navigation) is
 * GONE -- it caused the regression where opening the app would briefly show
 * an empty shell with non-functional TopBar buttons. The auto-navigate effect
 * eliminates that window entirely.
 *
 * The navigation is performed via `useEffect` + `useNavigate` rather than
 * declarative `<Navigate replace/>` so that the effect deps make the intent
 * explicit (re-fire on activeProject hydration, not on every render) and
 * leave the loading-state branch unaffected. `replace: true` keeps `/` out
 * of the back-button history so a press of Back from the dashboard does NOT
 * land back here and immediately bounce forward again.
 */
function RootRoute() {
  const includeDatabase = useIncludeDatabase();
  const activeProject = useProject();
  const projectLoading = useProjectLoading();
  const navigate = useNavigate();

  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);
  useCreateOrganisationShortcut(isCreateOrgModalOpen, setIsCreateOrgModalOpen);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 1
  // Auto-navigate to the active project's `/projects/:projectId` URL when
  // we have a hydrated project on bare `/`. <ProjectLayout> then resolves
  // the canonical `/projects/:p/architectures/:a/dashboard` form.
  useEffect(() => {
    if (projectLoading) return;
    if (!activeProject?.id) return;
    navigate(`/projects/${activeProject.id}`, { replace: true });
  }, [activeProject, projectLoading, navigate]);

  // Loading state -> show spinner.
  if (includeDatabase && projectLoading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  // No active project (DB mode or File mode without a session project) ->
  // landing page. The "auto-navigate to project" effect above handles the
  // case where activeProject is set; this branch is reached only when the
  // user genuinely has no project to land in.
  if (!activeProject) {
    return (
      <>
        <LandingPage onCreateOrganisation={() => setIsCreateOrgModalOpen(true)} />
        <CreateOrganisationModal
          isOpen={isCreateOrgModalOpen}
          onClose={() => setIsCreateOrgModalOpen(false)}
        />
      </>
    );
  }

  // Hydrated active project but the auto-navigate effect has not yet fired
  // (one render gap on first mount). Render a spinner rather than the old
  // empty TopBar shell -- consistent with the "never render empty <main>"
  // requirement of spec 2026-05-04.
  return (
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p>Loading...</p>
    </div>
  );
}

/**
 * Routes tree.
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
 *
 * Architecture-scoped routes mount inside a single `<AppShell/>` parent
 * route (which renders the TopBar + `<Outlet/>` shell). Each top-level view
 * is a child route under that parent; the bare
 * `/projects/:p/architectures/:a` URL redirects to `dashboard` via an index
 * route. Groups 4-7 extend each top-level child with its own sub-routes
 * (e.g. `metamodel/:domain`, `diagrams/:diagramId`, `product/backlog/:workItemId`,
 * `discovery/runs/:runId`).
 *
 * The 404 catch-all `<Route path="*" element={<NotFoundPage/>} />` lives at
 * the very end of the tree; the bare `/` is matched explicitly by
 * `<RootRoute/>`. Every other unmatched URL falls through to the 404 page.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
 *
 * Metamodel becomes a parent route. The `<MetaModelView/>` element acts as
 * its own layout: it reads the `:domain` URL segment via the
 * `useMetaModelDomain` hook (NOT via `useParams()` -- the hook is the
 * authoritative URL parser, and is robust to remounts because it uses
 * `useLocation`) and renders the matching domain body inline. The two
 * children below are bookkeeping-only:
 *
 *   - `index` -> redirect bare `/.../metamodel` to the default
 *     `/.../metamodel/application` URL (canonical default per the locked
 *     URL list).
 *   - `:domain` -> empty element. Exists ONLY so React Router considers
 *     the URL matched and keeps rendering the parent `<MetaModelView/>`
 *     element. The actual body comes from MetaModelView reading the
 *     param.
 *
 * Invalid `:domain` tokens (e.g. `/.../metamodel/bogus`) match the
 * `:domain` child here, but MetaModelView's internal logic re-routes them
 * to the default-domain URL via a `<Navigate replace/>` render so the URL
 * stays canonical.
 */
function AppRoutes() {
  return (
    <Routes>
      {/*
        `<ProjectLayout>` matches both with-architecture and
        without-architecture URLs. When `:architectureId` is missing it
        performs the silent redirect to the canonical URL using the oldest
        non-archived architecture from `listArchitectures(projectId)`.
        When `:architectureId` is present it renders <Outlet> so the
        architecture-scoped child routes mount unchanged.
      */}
      <Route path="/projects/:projectId" element={<ProjectLayout />}>
        <Route path="architectures/:architectureId" element={<AppShell />}>
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2.3
            Bare `/projects/:p/architectures/:a` -> redirect to dashboard.
            `<Navigate replace/>` keeps the bare URL out of the back-button
            history so Back from the dashboard does not bounce back here.
          */}
          <Route index element={<Navigate replace to="dashboard" />} />
          <Route path="dashboard" element={<DashboardView />} />
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
            Metamodel parent + sub-routes. The MetaModelView component is
            the layout (reads useMetaModelDomain() and renders the active
            domain body). Bare `/.../metamodel` redirects to the default
            domain via the index route; `:domain` is a placeholder match
            so React Router keeps rendering the parent element when a
            domain segment is present.
          */}
          <Route path="metamodel" element={<MetaModelView />}>
            <Route
              index
              element={<Navigate replace to={DEFAULT_META_MODEL_DOMAIN_URL} />}
            />
            <Route path=":domain" element={null} />
          </Route>
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
            Diagrams parent route. The DiagramsView component is the
            layout: it reads the `:diagramId` URL segment via the
            `useSelectedDiagramId` hook and renders the canvas inline
            when an id is present, the diagram list otherwise. The
            children below are bookkeeping-only:
              - `index` -> matches bare `/.../diagrams` (no id; list view).
              - `:diagramId` -> placeholder so React Router keeps
                rendering the parent DiagramsView when an id segment
                is present; the body comes from DiagramsView reading
                the param.
            Per spec, an unknown `:diagramId` does NOT redirect -- the
            canvas shows an empty/loading state and the user sees the
            URL they navigated to.
          */}
          <Route path="diagrams" element={<DiagramsView />}>
            <Route index element={null} />
            <Route path=":diagramId" element={null} />
          </Route>
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
            Product parent route. The ProductView component is the
            layout: it renders the persistent tab bar + (when on the
            roadmap tab) the lifted control row + an `<Outlet/>` where
            each tab body mounts. Sub-routes:
              - `index`                 -> redirect to default tab (`backlog`)
              - `mission`               -> Product mission editor
              - `roadmap`               -> Roadmap viewer
              - `backlog`               -> Backlog tree (no selection)
              - `backlog/:workItemId`   -> Backlog tree with details panel pre-opened
              - `implement/:workItemId` -> Implementation Assistant for a work item
            The `expandEpicId` query param remains an in-component scroll
            hint and is intentionally NOT routable.
          */}
          <Route path="product" element={<ProductView />}>
            <Route index element={<Navigate replace to="backlog" />} />
            <Route path="mission" element={<MissionTab />} />
            <Route path="roadmap" element={<RoadmapTab />} />
            <Route path="backlog" element={<BacklogTab />} />
            <Route path="backlog/:workItemId" element={<BacklogTab />} />
            {/* Spec 2026-06-12: bare implement tab landing. Pre-init the
                ImplementationInitGate auto-opens the Edit-project modal /
                shows the error state; post-init it hints to the Backlog.
                Previously the bare path rendered nothing in the Outlet. */}
            <Route path="implement" element={<ImplementGateLanding />} />
            <Route path="implement/:workItemId" element={<ImplementTab />} />
          </Route>
          {/*
            Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
            Discovery promotion. The previous in-dashboard `showDiscoveryDetail`
            toggle is replaced by two first-class routes:
              - `/discovery`             -> DiscoveryListPage (V1 stripped-down
                runs list; no filters / sort / preview).
              - `/discovery/runs/:runId` -> DiscoveryRunDetailPage (thin route
                wrapper around the existing DiscoveryRunDetailView, parameterised
                on the URL :runId via useDiscoveryRunId()).
            Deep-linkable per spec safety property (f). The parent path has no
            shared chrome of its own so we omit a layout wrapper -- both
            children render at the `<Outlet/>` slot of `<AppShell>` directly.
          */}
          <Route path="discovery">
            <Route index element={<DiscoveryListPage />} />
            <Route path="runs/:runId" element={<DiscoveryRunDetailPage />} />
          </Route>
          {/*
            Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task
            Group 8. Sibling page mirroring the Discovery route shape above:
              - `/api-behaviour`                       -> list page (capture
                sessions + saved baselines).
              - `/api-behaviour/sessions/:sessionId`   -> capture-session
                detail (2-3s polling while status='running').
              - `/api-behaviour/baselines/:baselineId` -> baseline detail
                (read-only).
            Deep-linkable; both children render at the `<Outlet/>` slot of
            `<AppShell>` directly so no extra layout wrapper is needed.
          */}
          <Route path="api-behaviour">
            <Route index element={<ApiBaselinesListPage />} />
            <Route
              path="sessions/:sessionId"
              element={<CaptureSessionDetailPage />}
            />
            <Route
              path="baselines/:baselineId"
              element={<BaselineDetailPage />}
            />
          </Route>
          {/*
            Stored Proc & Function Behaviour Program, Spec 3 (2026-09-09).
            The SECOND behaviour-baseline kind, DB-native and independent of
            the API capture path. Sibling routes beside the api-behaviour
            ones; the list surface itself is the "Stored procs and functions"
            tab on `ApiBaselinesListPage`, so there is no index route here.
              - `/proc-behaviour/capture-sessions/:sessionId` -> proc capture
                session detail (polls /status every 3s while in flight).
              - `/proc-behaviour/baselines/:baselineId`       -> proc baseline
                detail (read-only + Pin).
          */}
          <Route path="proc-behaviour">
            <Route
              path="capture-sessions/:sessionId"
              element={<ProcCaptureSessionDetailPage />}
            />
            <Route
              path="baselines/:baselineId"
              element={<ProcBaselineDetailPage />}
            />
          </Route>
          {/*
            Spec 2026-06-24 Vulnerability store + manual capture + current-state
            view -- Task Group 5. The new top-level "Security" tab. Mounted as a
            flat child of <AppShell> (peer of discovery / api-behaviour) so it
            renders at the shell's <Outlet/> slot and survives ProjectLayout's
            missing-architecture redirect (the `security` segment is registered
            in KNOWN_VIEW_SEGMENTS). The view reads the active project +
            architecture from context and lists the latest report's
            vulnerabilities via vulnerabilitiesApi.ts.
          */}
          {/*
            Spec 2026-07-19 Security health dashboard (Spec 3 of 3). The
            Security tab grows into a small tabbed AREA: Overview (the
            department health dashboard with the generated Security Summary
            diagram + severity overlays, the landing tab), the Findings
            Register (flattened detail over the structured security store,
            deep-linked from Overview clicks), and the pre-existing
            migration-workflow screen re-homed UNTOUCHED at security/scan.
            Old /security bookmarks land on Overview via the index redirect.
          */}
          <Route path="security" element={<SecurityLayout />}>
            <Route index element={<Navigate replace to="overview" />} />
            <Route path="overview" element={<SecurityOverview />} />
            <Route path="register" element={<FindingsRegister />} />
            <Route path="scan" element={<SecurityView />} />
          </Route>
          {/*
            Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.3
            Legacy top-level Target Architecture route. The view has been
            re-homed as a sub-tab under Architecture & Design (mounted below
            at /architecture-design/target-state). The element here is a
            <Navigate replace> redirect to the new canonical URL so existing
            bookmarks ("/projects/:p/architectures/:a/target-architecture")
            keep working. Both path params survive the redirect because the
            relative target preserves the matched architectures/:architectureId
            segment via the '..' prefix.
          */}
          <Route
            path="target-architecture"
            element={<Navigate replace to="../architecture-design/target-state" />}
          />
          {/*
            Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.2
            Target State sub-tab of the Architecture & Design page. The page
            layout renders the shared sub-tab strip ("Current State" /
            "Target State") with "Target State" marked active above the
            existing <TargetArchitectureWorkspace />. Mounted as a flat child
            of <AppShell> rather than a nested sibling of the metamodel
            sub-tree so that the URL token ("architecture-design") differs
            cleanly from the legacy "metamodel" segment without disturbing
            the metamodel route's URL contract.
          */}
          <Route
            path="architecture-design/target-state"
            element={<ArchitectureDesignTargetStatePage />}
          />
          {/* Phase 1c (2026-07-20): the standalone spec-generation workspace
              route is GONE — the plan review screen owns the spec lifecycle.
              Deep links with ?workItemId land on .../review, which auto-selects
              the story. */}
          {/*
            Spec 2026-05-19 Migration Delivery Progress and Evidence Tracking -- Task Group 13
            Read-only delivery-dashboard surface for a single saved
            GeneratedMigrationBookOfWork. Architecture-scoped per Q-10 so the
            page inherits the TopBar / provider chrome from <AppShell> and
            so ProjectLayout's missing-architecture redirect does not bounce
            a deep link away. The thin <MigrationDeliveryDashboardRoute>
            wrapper reads route params + useNavigate and forwards them to
            the presentational <MigrationDeliveryDashboard> component (which
            owns no routing of its own).
          */}
          <Route
            path="migration-books-of-work/:bookId/delivery"
            element={<MigrationDeliveryDashboardRoute />}
          />
          {/*
            Stakeholder progress report (2026-08-16). Deterministic, no-detail
            reconciliation summary: banner (identity + 7-stage pipeline), the
            DATABASE and SERVICE (API) reconciliation sections. Reads only
            persisted report data via the gateway progress-summary aggregation.
          */}
          <Route
            path="migration-books-of-work/:bookId/progress"
            element={<MigrationProgressReportRoute />}
          />
          {/*
            Spec 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work
            Generation -- follow-up route wiring (2026-06-03). Two
            architecture-scoped surfaces that mount the previously-unrouted
            generation wizard + review workspace:
              - `/.../migration-delivery-plan` -> landing route. Renders the
                7-stage <MigrationDeliveryPlanWizard> (open) over a draft
                list of existing plans. On Generate the wizard returns a
                draftId and the route navigates to the review URL below.
              - `/.../migration-books-of-work/:bookId/review` -> review
                route. Renders <MigrationBookOfWorkReviewWorkspace> for the
                draft (hierarchy tree + select + save-to-backlog).
            Architecture-scoped (mirrors the spec-generation + delivery
            routes above) so they inherit <AppShell>'s TopBar/providers and
            ProjectLayout's missing-architecture redirect does not bounce a
            deep link away. The wizard's launch button lives in the Product
            view roadmap control row.
          */}
          <Route
            path="migration-delivery-plan"
            element={<MigrationDeliveryPlanRoute />}
          />
          <Route
            path="migration-books-of-work/:bookId/review"
            element={<MigrationBookOfWorkReviewRoute />}
          />
        </Route>
        {/*
          Legacy / shortcut paths without `:architectureId`. These match the
          parent ProjectLayout (which has no `:architectureId` param) and
          trigger the silent redirect.
        */}
        <Route path="*" element={null} />
      </Route>
      {/*
        Bare `/` URL renders the LandingPage / loading shell via
        `<RootRoute/>`. Note: the path is `/` (NOT `*`) so the catch-all
        below can handle every unmatched URL with the 404 page.
      */}
      <Route path="/" element={<RootRoute />} />
      {/*
        Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2.5
        404 catch-all. MUST be last in the routes tree so all preceding
        more-specific routes win. Mounted outside the project-scoped tree
        so it does not require `:projectId` / `:architectureId` to render.
      */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * AppContent
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3
 *
 * The inner provider tree + routes tree, extracted from `<App>` so the test
 * helper `renderWithFullApp` (`__tests__/routing/testUtils.tsx`) can mount
 * the full app under a `<MemoryRouter initialEntries=...>` instead of the
 * production `<BrowserRouter>`. Production `<App>` mounts
 * `<BrowserRouter><AppContent/></BrowserRouter>`; the helper mounts
 * `<MemoryRouter initialEntries={[initialUrl]}><AppContent/></MemoryRouter>`.
 *
 * IMPORTANT: this component MUST be rendered inside SOME router (either
 * `<BrowserRouter>` for production or `<MemoryRouter>` for tests). It does
 * NOT mount its own router; nesting two routers is a React Router error.
 *
 * `<AppConfigProvider>` and `<ToastProvider>` stay outside the router in
 * production so the toast slot survives route transitions and the bootstrap
 * fetch is independent of routing. The test helper preserves this ordering.
 */
export function AppContent() {
  return (
    // Spec 2026-01-19: AppConfigProvider is outermost provider for runtime configuration
    <AppConfigProvider>
      {/* Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5/6
          ToastProvider sits above the router so its rendered <Toast/> slot
          survives route transitions. Group 5's empty-view-on-switch hint
          and Group 6's missing-architecture redirect both fire toasts via
          this provider. */}
      <ToastProvider>
        {/* Spec 2026-01-05: Wrap with ProjectProvider for active project state */}
        <ProjectProvider>
          <ArchitectureProvider>
            {/* Spec 2026-03-04: Assistant "What's Next" v1 - PendingActionProvider for cross-screen action handoff */}
            <PendingActionProvider>
              {/* Spec 2026-03-26: TemporaryDiagramProvider for external activation of temporary diagram mode */}
              <TemporaryDiagramProvider>
                {/* Spec 2026-04-03: UserJourneyReviewProvider for ephemeral multi-journey review session */}
                <UserJourneyReviewProvider>
                  {/* Spec 2026-04-07: UserJourneyOverviewReviewProvider for single overview diagram review */}
                  <UserJourneyOverviewReviewProvider>
                    <AppRoutes />
                  </UserJourneyOverviewReviewProvider>
                </UserJourneyReviewProvider>
              </TemporaryDiagramProvider>
            </PendingActionProvider>
          </ArchitectureProvider>
        </ProjectProvider>
      </ToastProvider>
    </AppConfigProvider>
  );
}

function App() {
  return (
    // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
    // BrowserRouter wraps the entire app shell. View selection is URL-driven;
    // there is no longer a state-driven fallback.
    //
    // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 3
    // The inner tree is `<AppContent>` (extracted) so `renderWithFullApp` can
    // swap `BrowserRouter` for `MemoryRouter` at test time without
    // duplicating the provider hierarchy.
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
