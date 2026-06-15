/**
 * ProjectLayout
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 1 + 6
 *
 * Route-level layout that wraps every `/projects/:projectId/...` route.
 *
 * Behaviour:
 *   - If the matched URL has an `:architectureId` segment, render <Outlet> so
 *     the architecture-scoped child route mounts unchanged.
 *   - If the matched URL is missing `:architectureId` (legacy / shortcut form
 *     such as `/projects/abc/diagrams`), call listArchitectures(projectId),
 *     pick the oldest non-archived (the migrated `Default`), and
 *     <Navigate replace> to the canonical URL with the resolved id inserted,
 *     preserving the trailing view segment (default to `/dashboard` if no
 *     view present).
 *
 * Group 6: when the redirect resolves, fire a single info toast
 *   "Opened in architecture: <name>" so the user knows why the URL changed.
 *   The toast is owned by the global <ToastProvider> mounted above the routes
 *   tree -- this layout returns <Navigate replace> which unmounts it
 *   immediately, so a toast scoped to this component's local state would never
 *   become visible.
 *
 * Spec #1's "no silent defaults at the API layer" property is preserved -- the
 * redirect happens at the URL boundary only; every Bucket A API call still
 * receives a real `:architectureId` from `useParams`.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
 *   `KNOWN_VIEW_SEGMENTS` extended to include `discovery` so legacy
 *   `/projects/abc/discovery` URLs survive the missing-architecture redirect
 *   once Group 7 promotes Discovery to a first-class top-level view.
 */

import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { listArchitectures, type Architecture } from '../../api/architecturesApi';
import { useToast } from '../../contexts/ToastContext';

/**
 * View segments recognised on the canonical architecture-scoped URL.
 * Exported as the single source of truth — ArchitectureContext's
 * setActiveArchitecture preserves the view segment across architecture
 * switches using this same set (a stale private copy there used to bounce
 * legacy /discovery and /target-architecture deep links to /dashboard).
 */
export const KNOWN_VIEW_SEGMENTS = new Set([
  'metamodel',
  'diagrams',
  'product',
  'dashboard',
  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2.3
  // Discovery becomes a first-class top-level view in Group 7; pre-add the
  // segment here so legacy `/projects/abc/discovery` URLs round-trip
  // through the missing-architecture redirect intact when that group lands.
  'discovery',
  // Spec 2026-05-20 Target Architecture Authoring Flow -- Task Group 6
  // New peer top-level view; preserve the legacy redirect for
  // /projects/:p/target-architecture URLs.
  'target-architecture',
]);

/**
 * Parse the trailing view segment (if any) from a path of the form
 *   `/projects/:projectId/<view>?`
 * Used to preserve the view across the silent redirect when the URL is
 * missing `:architectureId`.
 */
function extractTrailingViewFromLegacyPath(
  pathname: string,
  projectId: string
): string {
  const prefix = `/projects/${projectId}`;
  const remainder = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '')
    : '';

  if (remainder.length === 0) return 'dashboard';
  // Take the first path segment after the project id; anything else is
  // ignored (no nested routes today). Validate against the known views and
  // fall back to dashboard if unknown.
  const firstSegment = remainder.split('/')[0];
  return KNOWN_VIEW_SEGMENTS.has(firstSegment) ? firstSegment : 'dashboard';
}

export function ProjectLayout() {
  const params = useParams();
  const location = useLocation();
  const { showToast } = useToast();

  const projectId = params.projectId;
  const architectureId = params.architectureId;

  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<Error | null>(null);

  // Guards the toast firing: once we have fired for a given (projectId, path)
  // pair we don't fire again on subsequent renders. A new visit to a legacy
  // URL (e.g. user clicks back) remounts the layout (state resets) so the
  // toast fires anew, matching the spec requirement: "If they navigate back
  // to a legacy URL, it fires again."
  const toastFiredRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Resolve the redirect target when :architectureId is missing.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // If we already have an architectureId or we already computed a redirect,
    // there is nothing to do.
    if (architectureId || redirectTarget || !projectId) return;

    let cancelled = false;
    const view = extractTrailingViewFromLegacyPath(location.pathname, projectId);

    listArchitectures(projectId)
      .then((architectures: Architecture[]) => {
        if (cancelled) return;
        const nonArchived = (architectures ?? []).filter(a => !a.archived);
        if (nonArchived.length === 0) {
          // Nothing we can route to. Leave the layout in its idle state -- a
          // future spec will surface a friendlier error path.
          console.warn(
            `[ProjectLayout] No non-archived architectures for project "${projectId}"; cannot resolve redirect.`
          );
          return;
        }
        const resolved = nonArchived[0];
        const canonical = `/projects/${projectId}/architectures/${resolved.id}/${view}`;
        setResolvedName(resolved.name);
        setRedirectTarget(canonical);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setRedirectError(err);
      });

    return () => {
      cancelled = true;
    };
  }, [architectureId, projectId, location.pathname, redirectTarget]);

  // ---------------------------------------------------------------------------
  // Group 6: fire the redirect toast exactly once per redirect resolution.
  //
  // Lives in its own effect so it runs after `resolvedName` and
  // `redirectTarget` have settled. The ref guard prevents double-firing if
  // React re-runs the effect (e.g. StrictMode's effect double-invocation in
  // development).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (architectureId) return; // Canonical URL -- no toast.
    if (!redirectTarget || !resolvedName) return;
    if (toastFiredRef.current) return;
    toastFiredRef.current = true;
    showToast(`Opened in architecture: ${resolvedName}`, 'info');
  }, [architectureId, redirectTarget, resolvedName, showToast]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (architectureId) {
    // Canonical URL -- render the architecture-scoped child route unchanged.
    return <Outlet />;
  }

  if (redirectTarget) {
    return <Navigate replace to={redirectTarget} />;
  }

  if (redirectError) {
    // Surface the error in a minimal way; richer UX is out of scope for
    // Group 1. The rest of the app still functions via state-driven view
    // selection in <AppContent>.
    return (
      <div role="alert" data-testid="project-layout-error">
        Failed to resolve project architecture: {redirectError.message}
      </div>
    );
  }

  // Resolving... keep the slot empty so the surrounding shell remains visible.
  return null;
}

export default ProjectLayout;
