/**
 * useViewIsEmpty
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 5
 *
 * Per-view "is empty" hooks that the empty-view-on-architecture-switch toast
 * trigger reads after a switch settles. The toast fires when the destination
 * view returns true.
 *
 * Each hook reuses data already fetched for that view (no extra API calls).
 *
 * Rules (per requirements decision #13 / spec section
 * "Stay-on-view-with-empty-toast on architecture switch"):
 *   - metamodel:  true when there are zero entities of any type.
 *   - diagrams:   true when there are zero persisted diagrams.
 *   - product:    true when no product summary content exists -- defined here
 *                 as having no business processes, user journeys, or
 *                 product-shaped entities (business_processes /
 *                 user_journeys / process_activities) in the model.
 *   - dashboard:  always non-empty (no hook needed -- the toast trigger
 *                 short-circuits for dashboard).
 *
 * The hooks deliberately accept the data they read as arguments rather than
 * pulling from context themselves, so the empty-view toast trigger in
 * <AppShell> can compose them off a single `useArchitecture()` read instead
 * of mounting one hook per view.
 *
 * Convenience wrappers (`useMetaModelViewIsEmpty`, `useDiagramsViewIsEmpty`,
 * `useProductViewIsEmpty`) bind to the architecture context so each view
 * component can call its own hook without plumbing.
 */

import { useArchitecture } from '../contexts/ArchitectureContext';
import type { ArchitectureModel, MetaModelEntities } from '../types/model';
import type { CurrentView } from './useCurrentView';

/**
 * True when no entities of any type exist in the metamodel.
 *
 * Pure function so the empty-view toast trigger in <AppShell> can compose
 * it without instantiating a hook per view.
 */
export function isMetaModelEmpty(model: ArchitectureModel | null | undefined): boolean {
  if (!model || !model.metaModel || !model.metaModel.entities) return true;
  const entities = model.metaModel.entities as Record<keyof MetaModelEntities, unknown[]>;
  for (const key of Object.keys(entities) as (keyof MetaModelEntities)[]) {
    const list = entities[key];
    if (Array.isArray(list) && list.length > 0) return false;
  }
  return true;
}

/**
 * True when no persisted diagrams exist in the model.
 */
export function isDiagramsEmpty(model: ArchitectureModel | null | undefined): boolean {
  if (!model || !Array.isArray(model.diagrams)) return true;
  return model.diagrams.length === 0;
}

/**
 * True when there is no product summary content in the model.
 *
 * "Product summary content" is approximated by the presence of any of the
 * product-shaped entities: business_processes, process_activities, or
 * user_journeys. These entities are populated whenever a project has a
 * non-trivial product / delivery footprint and they live in `state.model`,
 * so no extra API call is needed.
 */
export function isProductEmpty(model: ArchitectureModel | null | undefined): boolean {
  if (!model || !model.metaModel || !model.metaModel.entities) return true;
  const e = model.metaModel.entities;
  const lengths = [
    e.business_processes?.length ?? 0,
    e.process_activities?.length ?? 0,
    e.user_journeys?.length ?? 0,
  ];
  return lengths.every(len => len === 0);
}

/**
 * Compute the "empty" boolean for a given view from a single model object.
 * Dashboard is always non-empty.
 */
export function viewIsEmptyFromModel(
  view: CurrentView,
  model: ArchitectureModel | null | undefined
): boolean {
  switch (view) {
    case 'metamodel':
      return isMetaModelEmpty(model);
    case 'diagrams':
      return isDiagramsEmpty(model);
    case 'product':
      return isProductEmpty(model);
    case 'dashboard':
    default:
      return false;
  }
}

// ----------------------------------------------------------------------------
// Convenience hook wrappers per view (used inside view components if needed).
// ----------------------------------------------------------------------------

/** True when the metamodel view would render no meaningful entity content. */
export function useMetaModelViewIsEmpty(): boolean {
  const state = useArchitecture();
  return isMetaModelEmpty(state.model);
}

/** True when the diagrams view would render no persisted diagrams. */
export function useDiagramsViewIsEmpty(): boolean {
  const state = useArchitecture();
  return isDiagramsEmpty(state.model);
}

/** True when the product view would render no product summary content. */
export function useProductViewIsEmpty(): boolean {
  const state = useArchitecture();
  return isProductEmpty(state.model);
}

/**
 * Human-friendly label for a view, used in the empty-view toast message
 * "Architecture <name> has no <label> yet".
 */
export function viewLabelForToast(view: CurrentView): string {
  switch (view) {
    case 'metamodel':
      return 'entities';
    case 'diagrams':
      return 'diagrams';
    case 'product':
      return 'product content';
    case 'dashboard':
    default:
      return view;
  }
}
