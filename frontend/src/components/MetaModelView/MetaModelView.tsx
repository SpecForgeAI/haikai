/**
 * MetaModelView Component
 *
 * Task Group 4: Updated to include DomainSelector and filter entity tabs by selected domain.
 * Entity tabs are filtered to show only those belonging to the selected architecture domain.
 * Relationship tabs are dynamically filtered based on centralized derivation logic.
 *
 * Spec 2026-01-08: Domain-Derived Relationship Visibility
 * - Removed fkTarget/cellType column inspection logic
 * - Now uses centralized getOrderedRelationshipDisplayNamesForDomain from relationshipDefinitions.ts
 * - Ensures relationship visibility is derived from explicit endpoint entity metadata
 *
 * Spec 2026-01-03: Meta-Model UI Domain Tab
 * - Hide Relationships row when UI domain is selected (UI domain has no relationships)
 *
 * Spec 2026-01-06: Package Sets Screen
 * - Added conditional rendering of PackageSetsView when 'Package Sets' tab is selected
 * - PackageSetsView provides a read-only master-detail view for Package Sets and Packages
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 3: Remove Forced Import Empty-State
 * - Removed NoProjectEmptyState block - backend now auto-initializes blank project
 * - Views render blank workspace directly in File Mode
 *
 * Spec 2026-03-01: Side Panel v1 on Architecture/MetaModel Screen (Increment 8)
 * Task Group 3: Wire UnifiedChatPanel into MetaModelView
 * - Added UnifiedChatPanel as fixed-position right-anchored overlay
 * - Uses PanelThreadKey { type: 'panel', projectId, screen: 'metamodel' }
 * - Restricts personas to Architect, UX Designer, Test Engineer
 * - Existing ChatPanel (legacy OAS) remains untouched on the left side
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.5
 * - Added onArtifactSaved callback that reloads the architecture model via
 *   loadModelByProjectId + LOAD_MODEL dispatch
 * - Does NOT pass artifactExists (per spec: omit for MetaModel)
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
 * - The component is now its OWN route layout. The metamodel parent route in
 *   `App.tsx` mounts `<MetaModelView/>` as the layout element and has a
 *   placeholder `:domain` child whose element is `null` (the URL match is
 *   the only thing that matters; the body comes from this view reading the
 *   URL param). The route also has an `index` child whose element is a
 *   `<Navigate>` to the default URL -- but because MetaModelView does not
 *   render an `<Outlet/>`, that index element never gets a chance to mount.
 *   We therefore ALSO handle the bare `/metamodel` redirect inline below
 *   (the index route is left in place as defensive belt-and-braces -- if
 *   a future refactor adds an `<Outlet/>` here, the index route will start
 *   firing the same redirect via the router instead).
 * - Domain selection migrates from a reducer-state field (`SET_DOMAIN`) to
 *   the URL `:domain` segment. The URL is the source of truth; an effect
 *   below syncs URL -> reducer (`SET_DOMAIN` dispatch) on mount and on
 *   every URL change so that all existing grid / palette / relationship
 *   consumers (which still read `state.selectedDomain` and
 *   `state.selectedTab`) work without modification.
 * - When the URL has an invalid `:domain` token (e.g. `/metamodel/bogus`),
 *   the component renders a `<Navigate replace/>` (with an ABSOLUTE path
 *   built from the active project + architecture ids) to the default URL,
 *   keeping the canonical URL set tight. We use an absolute path because
 *   relative `<Navigate>` from a layout element rendered above an
 *   `<Outlet/>` resolves against the layout's matched URL (here:
 *   `/metamodel`) rather than the full pathname, and a `..` segment can
 *   land us outside the architecture-scoped tree where ProjectLayout's
 *   missing-architecture redirect re-fires.
 * - Package Sets remains accessible via the tab bar inside the Application
 *   domain (selectedTab='Package Sets'). It is intentionally NOT a URL
 *   token — a previous `package-sets` URL was supported but broke
 *   intra-tab navigation, so it was removed.
 *
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.1
 * - Renders the new <ArchitectureDesignSubTabs /> strip at the top of the
 *   Architecture & Design surface. This view is the "Current State" sub-tab;
 *   the "Target State" sub-tab is mounted under a sibling top-level route at
 *   /projects/:p/architectures/:a/architecture-design/target-state.
 */

import { useCallback, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useArchitecture, useArchitectureDispatch, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { useDiscoveryOrigins } from '../../hooks/useDiscoveryOrigins';
import {
  DEFAULT_META_MODEL_DOMAIN_URL,
  isMetaModelDomainUrlValue,
  urlDomainToInternal,
} from '../../hooks/useCurrentView';
import { Grid } from '../Grid/Grid';
import { RelationshipGrid } from '../Grid/RelationshipGrid';
import { UnifiedChatPanel } from '../UnifiedChat';
import { DomainSelector } from './DomainSelector';
import { PackageSetsView } from './PackageSetsView';
// Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.1
import { ArchitectureDesignSubTabs } from '../Architecture/ArchitectureDesignSubTabs';
import { tabToEntityType, relationshipTabToType, domainGroupings } from '../../config/gridConfigs';
import { getOrderedRelationshipDisplayNamesForDomain } from '../../config/relationshipDefinitions';
import { EntityType, RelationshipType } from '../../types/model';
import type { ThreadKey } from '../../api/chatV2Api';
import styles from './MetaModelView.module.css';

export function MetaModelView() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const activeProject = useProject();
  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
  const activeArchitectureId = useActiveArchitectureId();

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
  // Read the `:domain` URL token from the matched route. `useParams` is safe
  // at this call site because MetaModelView is mounted INSIDE a `<Route>`
  // element (not above it like ArchitectureProvider in Group 1). The pure
  // parser variant lives in `useCurrentView.ts` for tests and out-of-route
  // consumers.
  const { domain: rawDomainParam } = useParams<{ domain?: string }>();
  const navigate = useNavigate();

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
  // URL -> internal domain mapping. When the URL token is invalid we fall
  // back to the default URL's internal domain to keep grid consumers from
  // rendering a transient blank state during the redirect render.
  const validUrlToken = isMetaModelDomainUrlValue(rawDomainParam ?? null) ? rawDomainParam : null;
  const internalDomain =
    urlDomainToInternal(validUrlToken ?? DEFAULT_META_MODEL_DOMAIN_URL) ??
    urlDomainToInternal(DEFAULT_META_MODEL_DOMAIN_URL)!;

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
  // URL -> reducer sync. Keeps `state.selectedDomain` in sync with the URL
  // on mount and on every URL change. Existing consumers that read this
  // reducer field (Grid, RelationshipGrid, downstream palette code, etc.)
  // keep working without modification.
  useEffect(() => {
    if (!validUrlToken) return; // invalid URL is handled by the redirect render below
    if (state.selectedDomain !== internalDomain) {
      dispatch({ type: 'SET_DOMAIN', payload: internalDomain });
    }
  }, [validUrlToken, internalDomain, state.selectedDomain, dispatch]);

  // Spec: Discovery Results Visibility (Increment 12) - Task Group 6
  // Fetch discovery origin data for badge rendering in the Grid
  // Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7
  // Pass both projectId and architectureId so the entity-origin badges
  // reflect only the active architecture's discovery runs.
  const discoveryOrigins = useDiscoveryOrigins(activeProject?.id, activeArchitectureId);

  // Spec 2026-01-22: File Mode Blank Start UX
  // REMOVED: NoProjectEmptyState block
  // Backend now auto-initializes blank project, so activeProject is never null in File Mode

  // Spec 2026-03-01: Construct PanelThreadKey for UnifiedChatPanel
  const panelThreadKey: ThreadKey | null = activeProject
    ? { type: 'panel', projectId: activeProject.id, screen: 'metamodel' }
    : null;

  /**
   * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.5
   * Callback for onArtifactSaved: reload the architecture model from the backend
   * and dispatch LOAD_MODEL to update the in-memory state.
   * Uses the same loadModelByProjectId + LOAD_MODEL dispatch pattern as TopBar.tsx.
   */
  const handleArtifactSaved = useCallback(async () => {
    if (!activeProject) return;
    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
    // Skip the reload if architectureId hasn't been resolved yet (best-effort).
    if (!activeArchitectureId) return;
    try {
      const model = await loadModelByProjectId(activeProject.id, activeArchitectureId);
      dispatch({
        type: 'LOAD_MODEL',
        payload: model,
        fileName: state.loadedFileName || activeProject.name,
      });
    } catch (err) {
      // Silently fail - the model reload is best-effort after artifact save
      console.warn('Failed to reload model after artifact save:', err);
    }
  }, [activeProject, activeArchitectureId, dispatch, state.loadedFileName]);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
  // Redirect-to-default render path. Two URL shapes land here:
  //
  //   (a) Bare `/metamodel` (rawDomainParam === undefined). The route
  //       tree's index `<Navigate replace to="application" />` would
  //       handle this if MetaModelView rendered an `<Outlet/>`, but we
  //       don't (the body is rendered inline). So we handle it here too.
  //
  //   (b) Invalid `:domain` token like `/metamodel/bogus`
  //       (rawDomainParam defined but not in the legal set). Same
  //       redirect.
  //
  // We build an ABSOLUTE path (not a relative `../application` form) to
  // avoid React Router resolving the path against the layout's matched URL
  // and accidentally landing outside the architecture-scoped tree -- which
  // would re-fire ProjectLayout's missing-architecture redirect and bounce
  // the user to `/dashboard`. We fall back to a relative `.` form only
  // when activeProject / activeArchitectureId have not yet hydrated; in
  // that window the redirect target is still inside the metamodel sub-tree
  // so the relative form is safe.
  const needsDefaultRedirect = rawDomainParam === undefined || !validUrlToken;
  if (needsDefaultRedirect) {
    if (activeProject?.id && activeArchitectureId) {
      return (
        <Navigate
          replace
          to={`/projects/${activeProject.id}/architectures/${activeArchitectureId}/metamodel/${DEFAULT_META_MODEL_DOMAIN_URL}`}
        />
      );
    }
    // Hydration window: render nothing for this tick. The next render
    // (after activeArchitectureId resolves) will hit the absolute-path
    // branch above. We avoid `<Navigate>` here because a relative path
    // can resolve outside the architecture-scoped tree.
    return null;
  }

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
  // Tab-click handler: existing reducer dispatch preserved (the tab bar is
  // not URL-driven in V1 -- only the domain segment is). The dispatch
  // remains the source of truth for selectedTab.
  const handleTabClick = (tabName: string) => {
    dispatch({ type: 'SELECT_TAB', payload: tabName });
  };

  // Spec 2026-01-06: Check if Package Sets tab is selected (special handling)
  // We rely on the reducer (kept in sync via the URL-driven effect above).
  const isPackageSetsTab = state.selectedTab === 'Package Sets';

  // Check if current tab is an entity or relationship (excluding Package Sets which has custom rendering)
  const isEntityTab = state.selectedTab in tabToEntityType && !isPackageSetsTab;
  const isRelationshipTab = state.selectedTab in relationshipTabToType;

  // Get the tabs for the currently selected domain
  // Read `internalDomain` (URL-derived) instead of `state.selectedDomain`
  // so the rendering is consistent with the URL even on the first render
  // before the sync effect has fired.
  const currentDomainTabs = domainGroupings[internalDomain] || [];

  // Spec 2026-01-08: Get filtered relationship tabs using centralized derivation
  const filteredRelationshipTabs = getOrderedRelationshipDisplayNamesForDomain(internalDomain);

  // Spec 2026-01-03: Determine if Relationships row should be visible
  // Hide for UI domain since it has no relationships
  const showRelationshipsRow = filteredRelationshipTabs.length > 0;

  // Render a tab button
  const renderTab = (tabName: string) => (
    <button
      key={tabName}
      className={`${styles.tab} ${state.selectedTab === tabName ? styles.activeTab : ''}`}
      onClick={() => handleTabClick(tabName)}
    >
      {tabName}
    </button>
  );

  // Render a separator between tabs
  const renderSeparator = (key: string) => (
    <span key={key} className={styles.domainSeparator}>|</span>
  );

  // Render tabs with separators between them
  const renderTabsWithSeparators = (tabs: string[]) => {
    const elements: React.ReactNode[] = [];
    tabs.forEach((tabName, index) => {
      if (index > 0) {
        elements.push(renderSeparator(`sep-${index}`));
      }
      elements.push(renderTab(tabName));
    });
    return elements;
  };

  // Reference `navigate` so the linter does not complain in the rare case
  // the DomainSelector ends up un-imported during a refactor (it is the
  // canonical writer for URL-driven domain changes). The actual navigate
  // call lives inside DomainSelector itself.
  void navigate;

  return (
    <>
      <div className={styles.container}>
        {/* Main Content */}
        <div className={styles.mainContent}>
          {/*
            Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.1
            Architecture & Design sub-tab strip. This view is the "Current
            State" sub-tab; the peer "Target State" tab navigates to the
            sibling top-level route /architecture-design/target-state which
            mounts <TargetArchitectureWorkspace />.
          */}
          <ArchitectureDesignSubTabs active="current-state" />

          {/* Domain Selector row */}
          <div className={styles.domainRow}>
            <DomainSelector />
          </div>

          {/* Entities header row - filtered by selected domain */}
          <div className={styles.headerRow}>
            <span className={styles.headerLabel}>Entities:</span>
            <div className={styles.tabsContainer}>
              {renderTabsWithSeparators(currentDomainTabs)}
            </div>
          </div>

          {/* Relationships header row - filtered by domain using centralized derivation */}
          {/* Spec 2026-01-03: Hide when UI domain is selected (no relationships) */}
          {showRelationshipsRow && (
            <div className={styles.headerRow}>
              <span className={styles.headerLabel}>Relationships:</span>
              <div className={styles.tabsContainer}>
                {renderTabsWithSeparators(filteredRelationshipTabs)}
              </div>
            </div>
          )}

          {/* Grid container */}
          <div className={styles.gridContainer}>
            {/* Spec 2026-01-06: Render PackageSetsView for Package Sets tab */}
            {isPackageSetsTab && <PackageSetsView />}

            {/* Render standard Grid for other entity tabs */}
            {isEntityTab && (
              <Grid entityType={tabToEntityType[state.selectedTab] as EntityType} discoveryOrigins={discoveryOrigins} />
            )}

            {/* Render RelationshipGrid for relationship tabs */}
            {isRelationshipTab && (
              <RelationshipGrid relationshipType={relationshipTabToType[state.selectedTab] as RelationshipType} />
            )}
          </div>
        </div>
      </div>

      {/* ================================================================
       * Spec 2026-03-01: Side Panel v1 on Architecture/MetaModel Screen
       * Task Group 3: Render UnifiedChatPanel as fixed-position overlay
       * Panel is fixed-position right-anchored (same as DashboardView).
       *
       * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.5
       * Added onArtifactSaved={handleArtifactSaved} to reload the architecture
       * model after a successful artifact save. Does NOT pass artifactExists
       * (per spec: omit for MetaModel).
       * ================================================================ */}
      {panelThreadKey && (
        <UnifiedChatPanel
          threadKey={panelThreadKey}
          initialPersonaId="architect"
          allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}
          onArtifactSaved={handleArtifactSaved}
        />
      )}
    </>
  );
}
