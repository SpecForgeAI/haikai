/**
 * ImplementTab Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
 *
 * Renders the Implementation Assistant body for the
 * `/.../product/implement/:workItemId` sub-route. Wraps the existing
 * `ProductImplementPage` and reads:
 *   - `:workItemId` from the URL via `useWorkItemId()`.
 *   - `refinementMode` from the navigation state via `useLocation().state`
 *     (set by `<BacklogTab/>` when the user clicks Refine / Refine and
 *     Implement / Define Integration Tests on a feature row).
 *
 * Refinement mode is INTENTIONALLY not in the URL (per spec lines 113-114
 * "Backlog refinement-mode in URL -- ephemeral entry choice"). Defaults to
 * 'standard' when the user lands on the URL via deep-link / refresh, since
 * navigation state is lost across hard reloads.
 *
 * Mounted as a child route of `<ProductView/>` via the routes tree in
 * `App.tsx`.
 */

import { useLocation } from 'react-router-dom';
import { ProductImplementPage } from './ProductImplementPage';
import { useWorkItemId } from '../../hooks/useCurrentView';
// Spec 2026-06-12: Implementation-Service Init and Integration Repair --
// the Implement flow is gated on the project's workspace registration
// (implementationInitSuccess); pre-init the gate auto-opens the Edit-project
// modal and shows an error state instead of the screen.
import { ImplementationInitGate } from './ImplementationInitGate';

type RefinementMode = 'standard' | 'refine' | 'refine_and_implement' | 'holistic_only';

interface ImplementTabState {
  refinementMode?: RefinementMode;
}

function isRefinementMode(value: unknown): value is RefinementMode {
  return (
    value === 'standard' ||
    value === 'refine' ||
    value === 'refine_and_implement' ||
    value === 'holistic_only'
  );
}

export function ImplementTab() {
  const workItemId = useWorkItemId();
  const location = useLocation();

  const navState = (location.state ?? {}) as ImplementTabState;
  const refinementMode: RefinementMode = isRefinementMode(navState.refinementMode)
    ? navState.refinementMode
    : 'standard';

  return (
    <ImplementationInitGate>
      <ProductImplementPage
        workItemId={workItemId}
        refinementMode={refinementMode}
      />
    </ImplementationInitGate>
  );
}
