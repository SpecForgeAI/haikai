/**
 * ProductView Component
 *
 * Spec 2026-01-03: Task Group 3 - ProductView component with Backlog and Implement tabs
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * ProductView is now a thin LAYOUT component for the product sub-routes.
 * The component renders the persistent tab bar + (when on the roadmap tab)
 * the roadmap control row, and mounts an `<Outlet/>` where each tab body
 * (`<MissionTab/>` / `<RoadmapTab/>` / `<BacklogTab/>` / `<ImplementTab/>`)
 * renders. Tab navigation goes through React Router `<NavLink>` (the URL
 * is the source of truth); no `URLSearchParams` / `pushState` manipulation
 * remains in this file.
 *
 * Sub-routes (defined in `App.tsx` under the `product` parent):
 *   - `index`                       -> `<Navigate replace to="backlog" />`
 *   - `mission`                     -> `<MissionTab/>`
 *   - `roadmap`                     -> `<RoadmapTab/>`
 *   - `backlog`                     -> `<BacklogTab/>`
 *   - `backlog/:workItemId`         -> `<BacklogTab/>` (details panel pre-opens)
 *   - `implement/:workItemId`       -> `<ImplementTab/>`
 *
 * Per Group 4 caveat: in case the React Router `index` route's redirect
 * does not fire (e.g. a future refactor that doesn't render `<Outlet/>`),
 * we ALSO handle the bare `/.../product` redirect inline below as a
 * defence-in-depth measure -- though as written ProductView always renders
 * the `<Outlet/>`, so the index route's redirect is the actually-firing
 * mechanism in production.
 *
 * The `RoadmapControlState` lifted from `<RoadmapTab/>` via React Router's
 * `useOutletContext` keeps the legacy "control row anchored to the layout
 * chrome" UX intact -- the roadmap tab body publishes its control state up
 * to the layout, which renders the row above the outlet.
 */

import { useState, useCallback, useRef } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ProductUiStateProvider,
} from '../../contexts/ProductUiStateContext';
import { useIncludeDatabase } from '../../contexts/AppConfigContext';
// Spec 2026-05-17 PM Migration Delivery Plan -- follow-up route wiring
// (2026-06-03). The roadmap control row's "Create Migration Delivery Plan"
// launch button navigates to the architecture-scoped landing route, which
// needs the active architecture id. It is URL-derived (available even when
// useParams() would be empty) via the ArchitectureContext selector.
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { uploadBookOfWork } from '../../api/bookOfWorkApi';
import { useProductTab } from '../../hooks/useCurrentView';
import type { RoadmapControlState } from './ProductRoadmapPage';
import { formatTimestamp } from './ProductRoadmapPage';
import type { ProductOutletContext } from './RoadmapTab';
import styles from './ProductView.module.css';

/**
 * ProductViewLayout Component
 *
 * Internal component containing the actual layout chrome. Wrapped by
 * `ProductUiStateProvider` in the exported `ProductView` so the provider
 * stays mounted across tab switches (preserving expansion state).
 */
function ProductViewLayout() {
  // Spec 2026-02-12: Get includeDatabase toggle for conditional Mission tab rendering
  const includeDatabase = useIncludeDatabase();

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
  // URL-derived current tab. Used to decide whether to render the roadmap
  // control row (it only appears on the roadmap tab) and to handle the
  // bare `/.../product` -> `/.../product/backlog` redirect defence-in-depth.
  const currentTab = useProductTab();

  // Spec 2026-05-17 PM Migration Delivery Plan -- follow-up route wiring
  // (2026-06-03). Launch navigation for the "Create Migration Delivery
  // Plan" button. projectId comes from the lifted roadmap control state
  // (same source the Upload Book of Work button uses); architectureId is
  // URL-derived from the ArchitectureContext.
  const navigate = useNavigate();
  const activeArchitectureId = useActiveArchitectureId();

  // Spec 2026-01-05: Roadmap control state lifted up from RoadmapTab via
  // React Router's outlet context (see ProductOutletContext in RoadmapTab.tsx).
  const [roadmapControlState, setRoadmapControlState] = useState<RoadmapControlState | null>(null);

  // Spec 2026-01-10: Upload Book of Work state
  const [uploadingBookOfWork, setUploadingBookOfWork] = useState<boolean>(false);
  const [bookOfWorkError, setBookOfWorkError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Spec 2026-01-10: Task Group 5.2 - Handle Upload Book of Work button click
   * Opens the hidden file input to select a markdown file
   */
  const handleUploadBookOfWorkClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  /**
   * Spec 2026-01-10: Task Group 5.3 - Handle file selection and upload
   */
  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear the input so the same file can be selected again
    event.target.value = '';

    // Get project ID from roadmap control state
    const projectId = roadmapControlState?.projectId;
    if (!projectId) {
      setBookOfWorkError('No active project. Please select a project first.');
      return;
    }

    setUploadingBookOfWork(true);
    setBookOfWorkError(null);

    try {
      // Read file content using FileReader API
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });

      // Upload to backend
      await uploadBookOfWork(projectId, content);

      // Spec 2026-01-10: Task Group 5.6 - Refresh work items after successful upload
      if (roadmapControlState?.refreshWorkItems) {
        await roadmapControlState.refreshWorkItems();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setBookOfWorkError(message);
    } finally {
      setUploadingBookOfWork(false);
    }
  }, [roadmapControlState]);

  // Compute whether upload button should be disabled
  const isUploadDisabled = !roadmapControlState?.projectId || uploadingBookOfWork;

  /**
   * Spec 2026-05-17 PM Migration Delivery Plan -- follow-up route wiring
   * (2026-06-03). Navigate to the architecture-scoped Migration Delivery
   * Plan landing route, which opens the 7-stage generation wizard. Mirrors
   * how the sibling Upload Book of Work button resolves the active project
   * (from the lifted roadmap control state); the architecture id is
   * URL-derived. Disabled when either is missing.
   */
  const projectIdForLaunch = roadmapControlState?.projectId;
  const isCreateDeliveryPlanDisabled =
    !projectIdForLaunch || !activeArchitectureId;
  const handleCreateDeliveryPlanClick = useCallback(() => {
    if (!projectIdForLaunch || !activeArchitectureId) return;
    navigate(
      `/projects/${projectIdForLaunch}/architectures/${activeArchitectureId}` +
        `/migration-delivery-plan`,
    );
  }, [projectIdForLaunch, activeArchitectureId, navigate]);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
  // Defence-in-depth redirect for bare `/.../product`. The routes tree's
  // `<Route index element={<Navigate replace to="backlog"/>}/>` is the
  // primary redirect mechanism (it fires through `<Outlet/>` below). This
  // inline check exists ONLY for paranoia: if the URL contains `/product`
  // but no recognised tab token AND the index route hasn't fired yet (one
  // render gap), we render a `<Navigate>` ourselves. Relative `to="backlog"`
  // resolves against the matched parent URL (`/.../product`) so the result
  // is `/.../product/backlog`.
  if (currentTab === null && typeof window !== 'undefined') {
    const segs = window.location.pathname.split('/').filter(Boolean);
    const archIdx = segs.indexOf('architectures');
    const isBareProduct =
      archIdx >= 0 &&
      segs.length === archIdx + 3 &&
      segs[archIdx + 2] === 'product';
    if (isBareProduct) {
      return <Navigate replace to="backlog" />;
    }
  }

  /**
   * Outlet context shared with `<RoadmapTab/>` (and any other future tab
   * body that wants to lift state up to the persistent chrome). Mirrors
   * the pre-routing `onControlStateChange` callback.
   */
  const outletContext: ProductOutletContext = { setRoadmapControlState };

  return (
    <div className={styles.container} data-testid="product-view">
      {/* Tab bar with Mission (conditional) / Roadmap / Backlog / Implement tabs.
          NavLink replaces the legacy `state setter` clicks; active styling
          is provided by NavLink's `isActive` callback so it stays in sync
          with the URL automatically. */}
      <div className={styles.tabBar} data-testid="product-tab-bar">
        {includeDatabase && (
          <NavLink
            to="mission"
            className={({ isActive }) =>
              `${styles.tab} ${isActive ? styles.activeTab : ''}`
            }
            data-testid="product-tab"
          >
            Product
          </NavLink>
        )}
        <NavLink
          to="roadmap"
          className={({ isActive }) =>
            `${styles.tab} ${isActive ? styles.activeTab : ''}`
          }
          data-testid="roadmap-tab"
        >
          Roadmap
        </NavLink>
        <NavLink
          to="backlog"
          className={({ isActive }) =>
            `${styles.tab} ${isActive ? styles.activeTab : ''}`
          }
          data-testid="backlog-tab"
        >
          Backlog
        </NavLink>
        <NavLink
          to="implement"
          className={({ isActive }) =>
            `${styles.tab} ${isActive ? styles.activeTab : ''}`
          }
          data-testid="implement-tab"
        >
          Implement
        </NavLink>
      </div>

      {/* Spec 2026-01-05: Task Group 2.4 - Compact control row (Roadmap tab only) */}
      {currentTab === 'roadmap' && roadmapControlState && (
        <div className={styles.roadmapControlRow} data-testid="roadmap-control-row">
          {/* Left side: Button group */}
          <div className={styles.controlRowButtonGroup}>
            {/* Import/Refresh roadmap.md button */}
            <button
              className={roadmapControlState.isImportDisabled ? styles.controlRowButtonDisabled : styles.controlRowButton}
              onClick={roadmapControlState.handleImport}
              disabled={roadmapControlState.isImportDisabled}
              data-testid="import-refresh-button"
            >
              {roadmapControlState.importing ? 'Importing...' : 'Import/Refresh roadmap.md'}
            </button>

            {/* Spec 2026-01-10: Task Group 5.2 - Upload Book of Work button */}
            <button
              className={isUploadDisabled ? styles.controlRowButtonDisabled : styles.controlRowButtonSecondary}
              onClick={handleUploadBookOfWorkClick}
              disabled={isUploadDisabled}
              data-testid="upload-book-of-work-button"
            >
              {uploadingBookOfWork ? 'Uploading...' : 'Upload Book of Work'}
            </button>

            {/* Hidden file input for book of work upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              onChange={handleFileSelected}
              style={{ display: 'none' }}
              data-testid="book-of-work-file-input"
            />

            {/* Spec 2026-05-17 PM Migration Delivery Plan -- follow-up route
                wiring (2026-06-03). Sibling launch button next to Upload
                Book of Work. Opens the architecture-scoped Migration
                Delivery Plan landing route (the 7-stage generation wizard
                over a draft list). Does NOT replace the upload path. */}
            <button
              className={
                isCreateDeliveryPlanDisabled
                  ? styles.controlRowButtonDisabled
                  : styles.controlRowButtonSecondary
              }
              onClick={handleCreateDeliveryPlanClick}
              disabled={isCreateDeliveryPlanDisabled}
              data-testid="create-migration-delivery-plan-button"
            >
              {/* "Migration Delivery Plan" (2026-08-16): the button NAVIGATES
                  to the plan landing page — only the first visit creates; from
                  then on the plan already exists, so no "Create" verb. */}
              Migration Delivery Plan
            </button>
          </div>

          {/* Right side: Inline Last Imported status */}
          <div className={styles.inlineStatus} data-testid="inline-status">
            {roadmapControlState.loadingMetadata ? (
              <span className={styles.loadingStatus}>Loading...</span>
            ) : roadmapControlState.lastImportedMetadata ? (
              <>
                <span className={styles.revisionBadge} data-testid="inline-revision-badge">
                  Rev {roadmapControlState.lastImportedMetadata.revision}
                </span>
                <span className={styles.timestamp} data-testid="inline-timestamp">
                  {formatTimestamp(roadmapControlState.lastImportedMetadata.createdAt)}
                </span>
                <span className={styles.sourceBadge} data-testid="inline-source-badge">
                  {roadmapControlState.lastImportedMetadata.source.replace('_', ' ')}
                </span>
              </>
            ) : (
              <span className={styles.inlineStatusMuted} data-testid="not-imported-yet">
                Not imported yet
              </span>
            )}
          </div>
        </div>
      )}

      {/* Spec 2026-01-10: Task Group 5.5 - Error display for Book of Work upload */}
      {currentTab === 'roadmap' && bookOfWorkError && (
        <div className={styles.errorBanner} data-testid="book-of-work-error">
          <span className={styles.errorMessage}>{bookOfWorkError}</span>
          <button
            className={styles.dismissErrorButton}
            onClick={() => setBookOfWorkError(null)}
            data-testid="dismiss-error-button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content area driven by the active sub-route. Each tab body mounts
          here via React Router's `<Outlet/>` and receives `outletContext`
          (see RoadmapTab for the consuming side). */}
      <div className={styles.content} data-testid="product-content">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

/**
 * ProductView Component
 *
 * Renders the layout container with:
 * - Tab bar (Mission / Roadmap / Backlog / Implement) using NavLink
 * - Compact control row (Roadmap tab only) lifted from RoadmapTab via
 *   outlet context
 * - Outlet for the active tab's body component
 *
 * Spec 2026-01-07: Wrapped with ProductUiStateProvider to preserve expansion
 * state across tab switches. The provider remains mounted when tab pages
 * unmount/remount.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 * Tab state is now URL-driven via React Router child routes; no more
 * `URLSearchParams` / `window.history.pushState` manipulation in this file.
 *
 * @returns The ProductView layout component
 */
export function ProductView() {
  return (
    <ProductUiStateProvider>
      <ProductViewLayout />
    </ProductUiStateProvider>
  );
}
