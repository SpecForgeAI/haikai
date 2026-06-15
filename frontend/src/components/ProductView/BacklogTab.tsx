/**
 * BacklogTab Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Renders the product backlog tree body for the `/.../product/backlog` and
 * `/.../product/backlog/:workItemId` sub-routes. Wraps the existing
 * `ProductBacklogPage` and bridges its row-action callbacks into URL
 * navigations:
 *
 *   - `onWorkOnThis(itemId)`           -> navigate to `/.../product/implement/:itemId`
 *   - `onRefine(itemId)`               -> navigate to `/.../product/implement/:itemId`
 *                                          carrying refinementMode='refine'
 *                                          via `navigate(to, { state })`.
 *   - `onRefineAndImplement(itemId)`   -> same, refinementMode='refine_and_implement'
 *   - `onDefineIntegrationTests(itemId)` -> navigate to the Migration Delivery
 *                                          Dashboard (the new headless
 *                                          "Define Integration/E2E Tests" node
 *                                          action lives there). See below.
 *   - `onNavigateToRoadmap()`          -> navigate to `/.../product/roadmap`
 *
 * Refinement mode is intentionally NOT in the URL (per spec lines 113-114:
 * "Backlog refinement-mode in URL ... -- ephemeral entry choice"). It is
 * passed via React Router's `navigate(to, { state })` mechanism, which
 * `<ImplementTab>` reads via `useLocation().state` to derive the correct
 * mode for the Implementation Assistant.
 *
 * Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4) --
 * Task Group 4 (D1) re-points the `onDefineIntegrationTests` entry point.
 * Previously it navigated to `../implement/{itemId}` with
 * `state.refinementMode='holistic_only'`, dropping the user into the
 * interactive `test_planning_holistic` chat phase. That chat phase remains for
 * its other entry points, but THIS entry now routes to the Migration Delivery
 * Dashboard's per-feature/epic "Define Integration/E2E Tests" node action --
 * the new headless flow that creates first-class `TEST` work items (sibling
 * blob item + work_item row + spec row + implement-state.json). The flat
 * backlog carries no book-of-work / node context, so it navigates to the
 * architecture-scoped delivery-plan landing (`../../migration-delivery-plan`,
 * a sibling of the `product` parent route) where the user selects the book and
 * triggers the node action on the feature/epic of interest.
 *
 * Mounted as a child route of `<ProductView/>` via the routes tree in
 * `App.tsx`. Reads `:workItemId` from the URL via `useWorkItemId()` and
 * passes it through to `ProductBacklogPage` as the pre-selected item, so
 * deep-linking to `/.../product/backlog/:workItemId` opens the details
 * panel for that item.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductBacklogPage } from './ProductBacklogPage';
import { useWorkItemId } from '../../hooks/useCurrentView';

export function BacklogTab() {
  const navigate = useNavigate();
  const selectedWorkItemId = useWorkItemId();

  // The work-on / refine handlers navigate to the implement sub-route. The
  // differentiator is the refinementMode carried via navigate state -- the
  // URL itself is identical for those (per the spec's
  // refinement-mode-NOT-in-URL decision).
  const handleWorkOnThis = useCallback(
    (itemId: string) => {
      navigate(`../implement/${itemId}`, { state: { refinementMode: 'standard' } });
    },
    [navigate]
  );

  const handleRefine = useCallback(
    (itemId: string) => {
      navigate(`../implement/${itemId}`, { state: { refinementMode: 'refine' } });
    },
    [navigate]
  );

  const handleRefineAndImplement = useCallback(
    (itemId: string) => {
      navigate(`../implement/${itemId}`, {
        state: { refinementMode: 'refine_and_implement' },
      });
    },
    [navigate]
  );

  // Re-pointed (Spec 2026-06-14, Task Group 4 / D1): route to the Migration
  // Delivery Dashboard's per-feature/epic "Define Integration/E2E Tests" node
  // action instead of the old interactive `holistic_only` chat phase. The flat
  // backlog has no book/node context, so we navigate to the architecture-scoped
  // delivery-plan landing (sibling of the `product` parent route) where the
  // user picks the book and triggers the node-scoped headless flow.
  const handleDefineIntegrationTests = useCallback(
    (_itemId: string) => {
      navigate('../../migration-delivery-plan');
    },
    [navigate]
  );

  const handleNavigateToRoadmap = useCallback(() => {
    navigate('../roadmap');
  }, [navigate]);

  return (
    <ProductBacklogPage
      onWorkOnThis={handleWorkOnThis}
      onRefine={handleRefine}
      onRefineAndImplement={handleRefineAndImplement}
      onDefineIntegrationTests={handleDefineIntegrationTests}
      onNavigateToRoadmap={handleNavigateToRoadmap}
      initialSelectedId={selectedWorkItemId}
      onSelectionChange={(id) => {
        // Closing the details panel (id === null) navigates back to the
        // bare backlog URL; selecting a row navigates to the deep-link
        // URL for that row. We use `replace: true` so the back-button
        // history isn't polluted by every row click -- only inter-tab
        // navigations populate history.
        if (id) {
          navigate(`../backlog/${id}`, { replace: true });
        } else {
          navigate('../backlog', { replace: true });
        }
      }}
    />
  );
}
