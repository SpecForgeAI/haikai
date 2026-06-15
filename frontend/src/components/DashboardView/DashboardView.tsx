/**
 * DashboardView Component
 *
 * Spec 2026-02-17: Dashboard Increment 1 -- Task Group 2 (original placeholder)
 * Spec 2026-02-18: Dashboard Increment 3 -- Task Group 2 (full layout rewrite)
 * Spec 2026-02-18: Dashboard Increment 4 -- Task Group 3 (scope selector + skeleton loading)
 * Spec 2026-02-18: Dashboard Increment 5 -- Task Group 4 (wire card actions to open persona panel)
 * Spec 2026-02-18: Dashboard Increment 6 -- (full-page skeleton, scope-error resilience, error polish)
 * Spec 2026-02-18: Dashboard Increment 7 -- (section containers, persona gutter, header redesign)
 * Spec 2026-02-28: Unified Chat Panel v1 -- Task Group 7.5 (render UnifiedChatPanel when activeProject is not null)
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed openPanel wiring; card buttons navigate only (UnifiedChatPanel unmounts on navigation); side-panel wiring deferred to Increments 8-9
 * Spec 2026-02-28: Hub Bootstrap 1 -- Task Group 7.12 (pass onArtifactSaved and missionExists to UnifiedChatPanel)
 * Spec 2026-03-01: Hub Bootstrap 2 -- Task Group 7.4 (pass artifactExists record to UnifiedChatPanel)
 * Spec 2026-03-01: Hub Bootstrap 3 -- Task Group 5.2 (add architecture key to artifactExists record)
 * Spec 2026-03-01: Hub Bootstrap 4 -- Task Group 6.2 (add techStack and testStrategy keys to artifactExists record)
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.2 (pass defaultOpen={true})
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 9, Task 9.1: Pass selectedScope to UnifiedChatPanel
 * - Passes selectedScope={{ type: selectedScope }} so the panel can thread it into picker search calls
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 2
 * - Strategic Foundation sub-sections (Product / Technical)
 * - Test Strategy card added to Technical sub-section
 * - Test Engineer persona added to Strategic Foundation gutter
 * - Product Definition / Roadmap state metric removed
 * - Standards card uses renderMetric() directly (no inline workaround)
 * - Implementation card renders three metrics from ImplementationMetrics
 * - Summary Insight card enabled with inline text
 * - Header AI summary text updated
 * - artifactExists derivation updated for new value types
 * - renderMetric updated to handle boolean values via String() conversion
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 3
 * - Wrapped success-branch content in .dashboardLayout flex parent
 * - Passes layout="inline" to UnifiedChatPanel for side-by-side layout
 * - Early-return branches (loading, error, empty) remain unchanged (option a)
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 5 (Task 5.5)
 * - Fixed TypeScript errors in artifactExists derivation: use Number() cast
 *   for roadmap and architecture values before > 0 comparison, since
 *   MetricCard.value is now number | boolean | string.
 *
 * Spec 2026-03-06: Dashboard Real Data -- Task Group 3 (Task 3.2)
 * - Changed default scope from 'NEXT_5_EPICS' to 'ENTIRE_PRODUCT'
 *
 * Spec 2026-04-05: Discovery Results Visibility -- Task Group 4
 * - Added discovery summary data fetching (non-blocking, parallel with dashboard fetch)
 * - Added Discovery Summary card to Technical sub-section (after Test Strategy)
 * - Disabled/empty state when no discovery runs exist
 *
 * Spec 2026-05-04: Comprehensive Frontend Routing -- Task Group 8
 * - Removed `showDiscoveryDetail` boolean state.
 * - Removed inline `<DiscoveryRunDetailView/>` mount.
 * - Removed `sessionStorage.pendingDiscoveryDetail` consumer (Group 7 already
 *   removed the writer; the reader is dead code).
 * - Discovery card "Open" button now navigates to `/.../discovery` (the
 *   first-class list route added in Group 7).
 *
 * Renders a 3-section dashboard layout:
 * - Section 1: Header Summary bar (persona icon, project name, LLM summary placeholder, last updated chip)
 * - Section 2: Strategic Foundation (bordered container, persona gutter, Product + Technical sub-groups)
 * - Section 3: Detailed Definition & Delivery (bordered container, persona gutter, Definition + Delivery sub-groups)
 *
 * Data is fetched from GET /api/dashboard/summary via getDashboardSummary().
 * Navigation uses `useNavigate` (react-router) following TopBar and ProductView patterns.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { User } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useArchitectureDispatch, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useNavigate replaces SET_VIEW dispatch + window.history.pushState for
// the dashboard card-action navigation flow.
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary } from '../../api/dashboardApi';
import { getDiscoveryRunSummary } from '../../api/discoveryApi';
import type { DiscoveryRunSummaryDto } from '../../api/discoveryApi';
import { loadModelByProjectId } from '../../api/modelApi';
import type { DashboardSummaryDto, MetricCard, ScopeType } from '../../types/dashboard';
import { DashboardSkeleton } from './DashboardSkeleton';
import { UnifiedChatPanel } from '../UnifiedChat';
import type { ThreadKey } from '../../api/chatV2Api';
import styles from './DashboardView.module.css';

/** Module-level cache: persists across mounts/unmounts, clears on page reload */
const dashboardCache = new Map<string, DashboardSummaryDto>();

// ============================================================================
// Navigation Helper
// ============================================================================

/**
 * Navigate to a specific view and optional tab.
 *
 * Follows the exact patterns from TopBar.tsx (SET_VIEW dispatch) and
 * ProductView.tsx (pushState with ?tab= query params).
 *
 * @param dispatch - Architecture context dispatch function
 * @param view - Target view ('product' or 'metamodel')
 * @param tab - Optional tab name for Product & Delivery tabs
 */
/**
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Navigate to a card-action target on the canonical architecture-scoped
 * URL. Replaces the previous SET_VIEW dispatch + history.pushState pair
 * AND the legacy `?tab=...` query-param pattern (Group 6 promoted product
 * tabs to first-class child routes).
 *
 * Tab token -> sub-path mapping for the product view:
 *   - 'product'   -> 'mission'   (legacy 2026-02-12 tab; same body)
 *   - 'mission'   -> 'mission'
 *   - 'roadmap'   -> 'roadmap'
 *   - 'backlog'   -> 'backlog'
 *   - 'implement' -> 'implement' (note: ImplementTab requires a
 *     workItemId path segment; callers that pass `implement` without a
 *     workItemId land on `/.../product/implement` which has no matching
 *     route and falls through to the 404 catch-all. Existing dashboard
 *     callers pass `implement` from cards that do not have a specific
 *     work item; they previously rendered an empty Implement tab via
 *     `?tab=implement`. Until those cards are reworked to embed a
 *     workItemId, we keep the legacy behaviour by routing to `backlog`
 *     which is the default tab the user can navigate from.)
 *
 * Silently no-ops when projectId or architectureId is missing -- in
 * practice the dashboard cards are never visible without an active
 * project + architecture, so this branch is defensive only.
 */
function navigateTo(
  navigate: (path: string) => void,
  projectId: string | undefined,
  architectureId: string | null,
  view: 'product' | 'metamodel',
  tab?: string
): void {
  if (!projectId || !architectureId) return;
  const base = `/projects/${projectId}/architectures/${architectureId}/${view}`;
  if (view !== 'product' || !tab) {
    navigate(base);
    return;
  }
  // Map legacy tab token to canonical sub-path
  let subPath: string;
  switch (tab) {
    case 'product':
    case 'mission':
      subPath = 'mission';
      break;
    case 'roadmap':
      subPath = 'roadmap';
      break;
    case 'implement':
      // Implement requires a workItemId; without one, fall back to
      // backlog so the user lands on a useful screen rather than the
      // 404 page.
      subPath = 'backlog';
      break;
    case 'backlog':
    default:
      subPath = 'backlog';
      break;
  }
  navigate(`${base}/${subPath}`);
}

// ============================================================================
// Metric Rendering Helper
// ============================================================================

/**
 * Render a MetricCard as a compact pill-style label:value pair.
 *
 * React does not render boolean primitives (true/false) as text, so we
 * convert the value to a string when it is a boolean. Numbers and strings
 * are rendered directly via JSX string coercion.
 */
function renderMetric(metric: MetricCard): React.ReactNode {
  const displayValue = typeof metric.value === 'boolean' ? String(metric.value) : metric.value;
  return (
    <span className={styles.metricPill} key={metric.label}>
      {metric.label}: {displayValue}
    </span>
  );
}

// ============================================================================
// Persona Icon Helper
// ============================================================================

const PERSONA_COLORS: Record<string, string> = {
  'Assistant': '#5C6BC0',
  'Product Manager': '#C62828',
  'Architect': '#7B1FA2',
  'UX Designer': '#F57C00',
  'Test Engineer': '#2E7D32',
  'Software Developer': '#455A64',
};

function PersonaIcon({ name }: { name: string }): React.ReactElement {
  const bg = PERSONA_COLORS[name] ?? '#757575';
  return (
    <div className={styles.personaIcon}>
      <div className={styles.personaIconCircle} style={{ background: bg }}>
        <User size={18} />
      </div>
      <span className={styles.personaIconLabel}>{name}</span>
    </div>
  );
}

// ============================================================================
// Skeleton Card Helper (avoid repeating markup)
// ============================================================================

function SkeletonCardBlock(): React.ReactElement {
  return (
    <div className={styles.skeletonCard}>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarTitle}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric1}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric2}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric3}`}></div>
    </div>
  );
}

// ============================================================================
// DashboardView Component
// ============================================================================

export const DashboardView: React.FC = () => {
  const activeProject = useProject();
  const dispatch = useArchitectureDispatch();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  const navigate = useNavigate();
  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
  const activeArchitectureId = useActiveArchitectureId();

  const [data, setData] = useState<DashboardSummaryDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<ScopeType>('ENTIRE_PRODUCT');
  const [scopeLoading, setScopeLoading] = useState<boolean>(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<boolean>(false);

  /**
   * Spec 2026-04-05: Discovery Results Visibility -- Task Group 4 (Task 4.2)
   * Discovery summary data fetched in parallel with dashboard data.
   * Null when no data, fetch failed, or no discovery runs exist.
   */
  const [discoveryData, setDiscoveryData] = useState<DiscoveryRunSummaryDto | null>(null);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 8
  // The previous `showDiscoveryDetail` boolean and `sessionStorage.pendingDiscoveryDetail`
  // consumer have been removed. Discovery is now reached via the first-class
  // routes `/discovery` and `/discovery/runs/:runId` (Task Group 7); the
  // discovery card's Open button below navigates to the list page directly.

  /**
   * Fetch dashboard summary data from the API.
   * Defined as a useCallback so the Retry button can call it.
   *
   * Spec 2026-04-05: Discovery Results Visibility -- Task Group 4 (Task 4.2)
   * Also fetches discovery summary data in parallel (non-blocking).
   */
  const fetchData = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch dashboard summary and discovery summary in parallel.
      // Discovery fetch is non-blocking: errors are caught and result in null.
      // Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
      //   getDiscoveryRunSummary now requires architectureId. Skip the
      //   discovery summary fetch if the URL has not yet resolved an
      //   architecture (mid-redirect) -- the dashboard layout still renders.
      const discoveryPromise = activeArchitectureId
        ? getDiscoveryRunSummary(activeProject.id, activeArchitectureId).catch(() => null)
        : Promise.resolve(null);
      const [dashboardResult, discoveryResult] = await Promise.all([
        getDashboardSummary(activeProject.id),
        discoveryPromise,
      ]);
      setData(dashboardResult);
      dashboardCache.set(activeProject.id, dashboardResult);
      setDiscoveryData(discoveryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeProject, activeArchitectureId]);

  /**
   * Callback for onArtifactSaved: re-fetch dashboard AND reload the architecture
   * model so that navigating to Architecture & Design shows fresh data without
   * requiring a browser reload.
   */
  const handleArtifactSaved = useCallback(async (info?: { artifactType?: string; epicId?: string }) => {
    await fetchData();
    if (!activeProject) return;
    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
    // Skip the model reload if architectureId hasn't been resolved yet (best-effort).
    if (!activeArchitectureId) {
      // Continue with the rest of the flow (navigation), just skip model reload.
    } else {
      try {
        const model = await loadModelByProjectId(activeProject.id, activeArchitectureId);
        dispatch({
          type: 'LOAD_MODEL',
          payload: model,
          fileName: activeProject.name,
        });
      } catch {
        // Model reload is best-effort; dashboard re-fetch already succeeded
      }
    }
    // Navigate to Product Backlog tab and auto-expand the saved epic
    // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
    // Replace SET_VIEW dispatch + history.pushState with a single navigation
    // to the canonical architecture-scoped product URL with the same query.
    if (info?.artifactType === 'backlog' && info.epicId && activeProject?.id && activeArchitectureId) {
      // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
      // Product backlog tab is now a first-class child route. The
      // `expandEpicId` query param remains as an in-component scroll/expand
      // hint (locked NOT-routable per requirements).
      navigate(
        `/projects/${activeProject.id}/architectures/${activeArchitectureId}/product/backlog?expandEpicId=${info.epicId}`
      );
    }
  }, [activeProject, activeArchitectureId, fetchData, dispatch, navigate]);

  /**
   * Handle scope selection change.
   * Sets scopeLoading, re-fetches data with the new scope, then updates state.
   */
  const handleScopeChange = useCallback(async (newScope: ScopeType) => {
    setSelectedScope(newScope);
    setScopeLoading(true);
    setScopeError(null);
    try {
      const result = await getDashboardSummary(activeProject!.id, newScope);
      setData(result);
      dashboardCache.set(activeProject!.id, result);
      setScopeLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
      setScopeError(message);
      setScopeLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    if (activeProject) {
      // Load cached data immediately (if available) so the user sees
      // the previous snapshot while fresh data loads in the background.
      const cached = dashboardCache.get(activeProject.id);
      setData(cached ?? null);
      setSelectedScope('ENTIRE_PRODUCT');
      setDiscoveryData(null);
      fetchData();
    }
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Empty state: no project selected ----
  if (!activeProject) {
    return (
      <div className={styles.container} data-testid="dashboard-view">
        <div className={styles.placeholder}>
          Select a project to view the dashboard.
        </div>
      </div>
    );
  }

  // ---- Loading state ----
  if (loading && !data) {
    return (
      <div className={styles.container} data-testid="dashboard-view">
        <DashboardSkeleton />
      </div>
    );
  }

  // ---- Error state ----
  if (error && !data) {
    return (
      <div className={styles.container} data-testid="dashboard-view">
        <div className={styles.errorState}>
          <span style={{ fontSize: '16px' }}>{'\u26A0'}</span>
          <span>{error}</span>
          <button
            onClick={async () => { setRetrying(true); try { await fetchData(); } finally { setRetrying(false); } }}
            disabled={retrying}
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // ---- No data (shouldn't happen normally but guard anyway) ----
  if (!data) {
    return (
      <div className={styles.container} data-testid="dashboard-view">
        <div className={styles.placeholder}>No dashboard data available.</div>
      </div>
    );
  }

  // ---- Success: render full dashboard ----
  const { header, strategicFoundation, detailedDefinitionAndDelivery } = data;
  const { preCoding, postCoding } = detailedDefinitionAndDelivery;

  // Spec 2026-02-28: Build threadKey for UnifiedChatPanel when activeProject is present
  const chatThreadKey: ThreadKey = { type: 'hub', projectId: activeProject.id };

  /**
   * Spec 2026-04-05: Discovery Results Visibility -- Task Group 4 (Task 4.4)
   * Determine whether discovery card should be in disabled state:
   * - discoveryData is null (fetch failed or not yet loaded)
   * - OR latestRunId is null (no discovery runs exist for the project)
   */
  const discoveryDisabled = !discoveryData || !discoveryData.latest_run_id;

  return (
    <div className={styles.dashboardLayout} data-testid="dashboard-layout">
      <div className={styles.container} data-testid="dashboard-view">

        {/* ================================================================
         * Section 1: Header Summary Bar
         * ================================================================ */}
        <div className={styles.headerSummary} data-testid="header-summary">
          <PersonaIcon name="Assistant" />
          <h2>{activeProject.name}</h2>
          <span className={styles.modeBadge}>{header.mode}</span>
          {header.headerInsight && (
            <span className={styles.headerSummaryText}>
              {header.headerInsight}
            </span>
          )}
          <span className={styles.lastUpdatedChip}>
            <span className={styles.lastUpdatedLabel}>
              Last updated:
              {loading && <span className={styles.refreshSpinner} />}
            </span>
            <span>{header.lastUpdatedLabel}</span>
          </span>
        </div>

        {/* ================================================================
         * Section 2: Strategic Foundation (bordered container)
         * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 2
         * Split into Product and Technical sub-sections
         * ================================================================ */}
        <div className={styles.sectionContainer}>
          <h3 className={styles.sectionHeading}>Strategic Foundation</h3>
          <div className={styles.sectionBody}>
            <div className={styles.personaGutter}>
              <PersonaIcon name="Product Manager" />
              <PersonaIcon name="Architect" />
              <PersonaIcon name="UX Designer" />
              <PersonaIcon name="Test Engineer" />
            </div>
            <div className={styles.sectionContent}>

              {/* Product Sub-Group (blue dashed border) */}
              <div className={styles.subSectionGroup}>
                <span className={styles.subSectionGroupLabel}>Product</span>
                <div className={styles.detailGrid}>

                  {/* Product Definition Card */}
                  <div className={styles.card} data-testid="card-product-definition">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDCCB'}</span>
                      <span className={styles.cardTitle}>Product Definition</span>
                      <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'product'); }}>Open</button>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.productDefinition.missionExists)}
                      {renderMetric(strategicFoundation.productDefinition.lastUpdatedLabel)}
                    </div>
                  </div>

                  {/* Users & Interactions Card */}
                  <div className={styles.card} data-testid="card-users-interactions">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDC65'}</span>
                      <span className={styles.cardTitle}>Users & Interactions</span>
                      <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'metamodel'); }}>Open</button>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.usersAndInteractions.userRoles)}
                      {renderMetric(strategicFoundation.usersAndInteractions.businessActivities)}
                      {renderMetric(strategicFoundation.usersAndInteractions.uiScreens)}
                    </div>
                  </div>

                  {/* Roadmap Card */}
                  <div className={styles.card} data-testid="card-roadmap">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDDFA\uFE0F'}</span>
                      <span className={styles.cardTitle}>Roadmap</span>
                      <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'roadmap'); }}>Open</button>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.roadmap.initiativesCount)}
                      {renderMetric(strategicFoundation.roadmap.epics)}
                      {renderMetric(strategicFoundation.roadmap.completed)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Technical Sub-Group (blue dashed border) */}
              <div className={styles.subSectionGroup}>
                <span className={styles.subSectionGroupLabel}>Technical</span>
                <div className={styles.detailGrid}>

                  {/* Standards Card */}
                  <div className={styles.card} data-testid="card-standards">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDEE1\uFE0F'}</span>
                      <span className={styles.cardTitle}>Standards</span>
                      <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'product'); }}>Open</button>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.standards.orgTechStack)}
                      {renderMetric(strategicFoundation.standards.productTechStack)}
                    </div>
                  </div>

                  {/* High-Level Architecture Card */}
                  <div className={styles.card} data-testid="card-hla">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83C\uDFD7\uFE0F'}</span>
                      <span className={styles.cardTitle}>High-Level Architecture</span>
                      <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'metamodel'); }}>Open</button>
                      <button
                        className={styles.cardAction}
                        onClick={() => {
                          if (!activeProject?.id || !activeArchitectureId) return;
                          // Navigate directly to the new Target State sub-route (Spec 4-spec hardening pass, Item 2).
                          // Spec 1's `<Navigate replace>` redirect from the legacy `/target-architecture` URL still exists
                          // as a safety net for any remaining stale callers / bookmarks, but this call site no longer
                          // relies on it.
                          navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/architecture-design/target-state`);
                        }}
                        data-testid="card-hla-author-target-button"
                      >
                        Author target
                      </button>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.highLevelArchitecture.applications)}
                      {renderMetric(strategicFoundation.highLevelArchitecture.services)}
                      {renderMetric(strategicFoundation.highLevelArchitecture.dataStores)}
                    </div>
                  </div>

                  {/* Test Strategy Card */}
                  <div className={styles.card} data-testid="card-test-strategy">
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDEE1\uFE0F'}</span>
                      <span className={styles.cardTitle}>Test Strategy</span>
                    </div>
                    <div className={styles.cardMetrics}>
                      {renderMetric(strategicFoundation.testStrategy.exists)}
                      {renderMetric(strategicFoundation.testStrategy.lastUpdated)}
                    </div>
                  </div>

                  {/* ================================================================
                   * Discovery Summary Card
                   * Spec 2026-04-05: Discovery Results Visibility -- Task Group 4
                   * Tasks 4.3, 4.4, 4.5
                   *
                   * Placed after the Test Strategy card within the Technical subSectionGroup.
                   * Shows discovery run summary metrics when data is available,
                   * or a disabled/empty state when no discovery runs exist.
                   *
                   * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 8
                   * Open navigates to the first-class /discovery list route.
                   * The previous in-dashboard `setShowDiscoveryDetail(true)`
                   * toggle and inline DiscoveryRunDetailView mount are gone.
                   * ================================================================ */}
                  <div
                    className={discoveryDisabled ? `${styles.card} ${styles.cardDisabled}` : styles.card}
                    data-testid="card-discovery-summary"
                  >
                    <div className={styles.cardHeader}>
                      <span className={styles.cardIcon}>{'\uD83D\uDD0D'}</span>
                      <span className={styles.cardTitle}>Discovery</span>
                      {!discoveryDisabled && (
                        <button
                          className={styles.cardAction}
                          onClick={() => {
                            // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7/8
                            // Navigate to the first-class /discovery list (the
                            // user can drill into a specific run from there).
                            if (activeProject?.id && activeArchitectureId) {
                              navigate(
                                `/projects/${activeProject.id}/architectures/${activeArchitectureId}/discovery`
                              );
                            }
                          }}
                        >
                          Open
                        </button>
                      )}
                    </div>
                    {discoveryDisabled ? (
                      <div className={styles.disabledText}>Discovery results coming soon</div>
                    ) : (
                      <div className={styles.cardMetrics}>
                        {renderMetric({ label: 'Status', value: discoveryData!.latest_run_status! })}
                        {renderMetric({ label: 'Candidates', value: discoveryData!.total_candidates })}
                        {renderMetric({ label: 'Entities Saved', value: discoveryData!.entities_saved })}
                        {renderMetric({ label: 'Coverage', value: `${discoveryData!.entity_type_coverage} types` })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ================================================================
         * Section 3: Detailed Definition & Delivery (bordered container)
         * ================================================================ */}
        <div className={styles.sectionContainer}>
          <div className={styles.sectionHeadingRow}>
            <h3 className={styles.sectionHeading}>Detailed Definition & Delivery</h3>

            {/* Scope Control Bar (inline with heading) */}
            <div className={styles.scopeControlBar} data-testid="scope-control-bar">
            <span className={styles.scopeControlBarLabel}>Scope:</span>
            <select
              className={`${styles.scopeSelector}${scopeLoading ? ' ' + styles.scopeSelectorDisabled : ''}`}
              value={selectedScope}
              onChange={(e) => handleScopeChange(e.target.value as ScopeType)}
              disabled={scopeLoading}
              data-testid="scope-selector"
            >
              <option value="ENTIRE_PRODUCT">Entire Product</option>
              <option value="NEXT_5_EPICS">Next 5 Epics</option>
              <option value="QTR">This Quarter</option>
              <option value="CUSTOM">Custom</option>
            </select>
            {selectedScope === 'CUSTOM' && (
              <span className={styles.customScopePlaceholder}>
                (custom scope not yet configurable)
              </span>
            )}
          </div>
          </div>

          <div className={styles.sectionBody}>
            <div className={styles.personaGutter}>
              <PersonaIcon name="Product Manager" />
              <PersonaIcon name="Architect" />
              <PersonaIcon name="UX Designer" />
              <PersonaIcon name="Test Engineer" />
              <PersonaIcon name="Software Developer" />
            </div>
            <div className={styles.sectionContent}>

              {scopeError ? (
                <div className={styles.scopeErrorBanner} data-testid="scope-error-banner">
                  <span style={{ fontSize: '16px' }}>{'\u26A0'}</span>
                  <span>{scopeError}</span>
                  <button
                    onClick={() => handleScopeChange(selectedScope)}
                    disabled={scopeLoading}
                  >
                    {scopeLoading ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              ) : (
                <>
                  {/* Definition Sub-Group (blue dashed border) */}
                  <div className={styles.subSectionGroup}>
                    <span className={styles.subSectionGroupLabel}>Definition</span>
                    {scopeLoading ? (
                      <div className={styles.detailGrid}>
                        <SkeletonCardBlock />
                        <SkeletonCardBlock />
                        <SkeletonCardBlock />
                      </div>
                    ) : (
                      <div className={styles.detailGrid}>
                        {/* Backlog Card */}
                        <div className={styles.card} data-testid="card-backlog">
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\uD83D\uDCDD'}</span>
                            <span className={styles.cardTitle}>Backlog</span>
                            <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'backlog'); }}>Open</button>
                          </div>
                          <div className={styles.cardMetrics}>
                            {renderMetric(preCoding.backlog.epicsInScope)}
                            {renderMetric(preCoding.backlog.featuresCount)}
                            {renderMetric(preCoding.backlog.storiesCount)}
                            {renderMetric(preCoding.backlog.storiesWithAcceptanceCriteriaCount)}
                          </div>
                        </div>

                        {/* Detailed Architecture Card */}
                        <div className={styles.card} data-testid="card-detailed-architecture">
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\uD83D\uDCD0'}</span>
                            <span className={styles.cardTitle}>Detailed Architecture</span>
                            <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'metamodel'); }}>Open</button>
                          </div>
                          <div className={styles.cardMetrics}>
                            {renderMetric(preCoding.detailedArchitecture.processActivities)}
                            {renderMetric(preCoding.detailedArchitecture.interfaceEndpoints)}
                            {renderMetric(preCoding.detailedArchitecture.logicalDataEntities)}
                            {renderMetric(preCoding.detailedArchitecture.physicalDataEntities)}
                          </div>
                        </div>

                        {/* Testing Suite Card */}
                        <div className={styles.card} data-testid="card-testing-suite">
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\uD83E\uDDEA'}</span>
                            <span className={styles.cardTitle}>Testing Suite</span>
                            <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'implement'); }}>Open</button>
                          </div>
                          <div className={styles.cardMetrics}>
                            {renderMetric(preCoding.testingSuite.functionalTestCount)}
                            {renderMetric(preCoding.testingSuite.endToEndTestCount)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Delivery Sub-Group (blue dashed border) */}
                  <div className={styles.subSectionGroup}>
                    <span className={styles.subSectionGroupLabel}>Delivery</span>
                    {scopeLoading ? (
                      <div className={styles.detailGrid}>
                        <SkeletonCardBlock />
                        <SkeletonCardBlock />
                        <SkeletonCardBlock />
                      </div>
                    ) : (
                      <div className={styles.detailGrid}>
                        {/* Implementation Card */}
                        <div className={styles.card} data-testid="card-implementation">
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\uD83D\uDE80'}</span>
                            <span className={styles.cardTitle}>Implementation</span>
                            <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'implement'); }}>Open</button>
                          </div>
                          <div className={styles.cardMetrics}>
                            {renderMetric(postCoding.implementation.featuresInProgress)}
                            {renderMetric(postCoding.implementation.storiesInProgress)}
                            {renderMetric(postCoding.implementation.storiesComplete)}
                          </div>
                        </div>

                        {/* Verification Card */}
                        <div className={styles.card} data-testid="card-verification">
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\u2705'}</span>
                            <span className={styles.cardTitle}>Verification</span>
                            <button className={styles.cardAction} onClick={() => { navigateTo(navigate, activeProject?.id, activeArchitectureId, 'product', 'implement'); }}>Open</button>
                          </div>
                          <div className={styles.cardMetrics}>
                            {renderMetric(postCoding.verification.pendingReviewCount)}
                            {renderMetric(postCoding.verification.storiesVerifiedCount)}
                          </div>
                        </div>

                        {/* Summary Insight Card */}
                        <div
                          className={postCoding.summaryInsight.enabled && postCoding.summaryInsight.message ? styles.card : `${styles.card} ${styles.cardDisabled}`}
                          data-testid="card-summary-insight"
                        >
                          <div className={styles.cardHeader}>
                            <span className={styles.cardIcon}>{'\uD83D\uDCA1'}</span>
                            <span className={styles.cardTitle}>Summary Insight</span>
                          </div>
                          {postCoding.summaryInsight.enabled && postCoding.summaryInsight.message ? (
                            <div className={styles.insightText}>{postCoding.summaryInsight.message}</div>
                          ) : (
                            <div className={styles.disabledText}>AI insights coming soon</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================
       * Spec 2026-02-28: Unified Chat Panel v1 -- Task Group 7.5
       * Render UnifiedChatPanel when activeProject is present.
       *
       * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 3 (Task 3.6)
       * Passes layout="inline" for side-by-side layout within .dashboardLayout
       * flex parent. Panel uses position: relative instead of fixed.
       *
       * Spec 2026-02-28: Hub Bootstrap 1 -- Task Group 7.12
       * Pass onArtifactSaved={fetchData} to trigger dashboard re-fetch after
       * successful artifact save.
       *
       * Spec 2026-03-01: Hub Bootstrap 2 -- Task Group 7.4
       * Pass artifactExists record derived from dashboard data instead of
       * the single missionExists boolean. Includes mission and roadmap
       * existence flags.
       *
       * Spec 2026-03-01: Hub Bootstrap 3 -- Task Group 5.2
       * Add architecture key to artifactExists record, derived from
       * highLevelArchitecture.overall.value > 0.
       *
       * Spec 2026-03-01: Hub Bootstrap 4 -- Task Group 6.2
       * Add techStack and testStrategy keys to artifactExists record,
       * derived from standards.orgTechStack and testStrategy.exists.
       *
       * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.2
       * Pass defaultOpen={true} so the hub panel starts expanded when no
       * persisted collapse state exists in localStorage.
       *
       * Spec 2026-03-04: What's Next v1-C -- Work Item Picker -- Task Group 9.1
       * Pass selectedScope={{ type: selectedScope }} so the panel can thread
       * it into picker search calls for work item ranking.
       *
       * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 2 (Task 2.12)
       * Updated artifactExists derivation for new value types:
       * - mission: boolean true check (was === 1)
       * - roadmap: initiativesCount > 0 (was state reference)
       * - techStack: orgTechStack string truthy check (was companyStandards)
       * - testStrategy: testStrategy.exists.value === true (was productStandards)
       *
       * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 5 (Task 5.5)
       * Fixed TypeScript errors: use Number() cast for roadmap and architecture
       * value comparisons since MetricCard.value is now number | boolean | string.
       * ================================================================ */}
      {activeProject && (
        <UnifiedChatPanel
          threadKey={chatThreadKey}
          initialPersonaId="assistant"
          defaultOpen={true}
          layout="inline"
          onArtifactSaved={handleArtifactSaved}
          artifactExists={{
            mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === true,
            roadmap: Number(data?.strategicFoundation?.roadmap?.initiativesCount?.value ?? 0) > 0,
            architecture: Number(data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0,
            usersAndInteractions: Number(data?.strategicFoundation?.usersAndInteractions?.userRoles?.value ?? 0) > 0,
            techStack: !!(data?.strategicFoundation?.standards?.orgTechStack?.value),
            testStrategy: data?.strategicFoundation?.testStrategy?.exists?.value === true,
          }}
          selectedScope={{ type: selectedScope }}
        />
      )}
    </div>
  );
};
