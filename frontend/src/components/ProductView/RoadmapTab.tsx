/**
 * RoadmapTab Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Renders the product roadmap viewer body for the `/.../product/roadmap`
 * sub-route. Wraps the existing `ProductRoadmapPage` and bridges its
 * `onNavigateToBacklog` callback into a `useNavigate('../backlog')` call,
 * and bubbles `onControlStateChange` up to the parent `<ProductView/>`
 * layout via `useOutletContext` (so the roadmap control row stays anchored
 * to the layout's tab-bar chrome and survives tab switches).
 *
 * Mounted as a child route of `<ProductView/>` via the routes tree in
 * `App.tsx`.
 */

import { useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ProductRoadmapPage } from './ProductRoadmapPage';
import type { RoadmapControlState } from './ProductRoadmapPage';

/**
 * Outlet context shape provided by `<ProductView/>` so the roadmap tab
 * body can lift its control state up to the parent layout's tab-bar
 * chrome. Mirrors the `onControlStateChange` callback used in the
 * pre-routing implementation.
 */
export interface ProductOutletContext {
  setRoadmapControlState: (state: RoadmapControlState | null) => void;
}

export function RoadmapTab() {
  const navigate = useNavigate();
  const { setRoadmapControlState } = useOutletContext<ProductOutletContext>();

  // Backlog navigation: relative `..` resolves against the matched parent
  // route URL (`/.../product/roadmap`), so `../backlog` lands on the
  // canonical `/.../product/backlog` URL.
  const handleNavigateToBacklog = useCallback(() => {
    navigate('../backlog');
  }, [navigate]);

  return (
    <ProductRoadmapPage
      onNavigateToBacklog={handleNavigateToBacklog}
      onControlStateChange={setRoadmapControlState}
    />
  );
}
