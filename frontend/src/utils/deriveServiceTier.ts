/**
 * `deriveServiceTier` -- the pure run -> service -> technology-tier resolver.
 *
 * Spec: 2026-06-05-per-service-scan-selection (Half A, Task Group 1), shared
 * with 2026-06-05-architect-tier-gating (Half B). Both surfaces derive the tier
 * client-side from the AppShell's already-loaded per-(project, architecture)
 * model cache, so this helper lives once in a neutral `utils/` location and is
 * imported unchanged by each (Discovery Review Room + target-state Architect
 * conversation). RELOCATED here from `components/Discovery/` by Half B so the
 * target-state surface no longer cross-imports from a Discovery component.
 * There is NO runtime data handoff between the specs; this is a code-sharing
 * point only.
 *
 * DISAMBIGUATION -- "tier" is dangerously overloaded in this codebase:
 *  - The V3 discovery CONFIDENCE tier (`'A' | 'B' | 'C'` on
 *    `DiscoveryRunDto.tier`) is the pack-confidence ladder. This helper has
 *    NOTHING to do with it.
 *  - This helper resolves the architectural TECHNOLOGY tier from an
 *    {@link ApplicationComponent}'s `tech_type` (`'UI Tier' | 'Service Tier' |
 *    'Persistence Tier' | 'Other'`). That is what `ServiceTier` below means.
 *
 * The traversal is a TWO-hop meta-model walk, and BOTH hops are nullable
 * (plus the `service` argument itself may be undefined when a run's
 * `service_id` doesn't resolve to a cached service):
 *
 *   service.app_component_id  ->  appComponentsById[id].tech_type
 *
 * Any miss along the way -- a missing/undefined `service`, a NULL/absent
 * `app_component_id`, a component id absent from the map, or a `tech_type` of
 * `'Other'` / unset / unrecognised -- resolves to `'Unknown'`. The function is
 * PURE (no I/O), NEVER throws, and NEVER blocks: `'Unknown'` is a valid,
 * fully-selectable label, not an error.
 */

import type { ApplicationComponent, Service, TechType } from '../types/model';

/**
 * The resolved technology tier. `'Unknown'` is the graceful catch-all for every
 * nullable-hop miss (it is NOT an error state). NOT the V3 confidence tier.
 */
export type ServiceTier = 'UI' | 'Service' | 'Persistence' | 'Unknown';

/**
 * Maps a raw `tech_type` literal to its short {@link ServiceTier}. `'Other'`,
 * `undefined`, and any unrecognised string all fall through to `'Unknown'`.
 */
function tierFromTechType(techType: TechType | undefined): ServiceTier {
  switch (techType) {
    case 'UI Tier':
      return 'UI';
    case 'Service Tier':
      return 'Service';
    case 'Persistence Tier':
      return 'Persistence';
    // 'Other' / undefined / unrecognised -> Unknown (graceful, never throws).
    default:
      return 'Unknown';
  }
}

/**
 * Resolve a service's architectural technology tier from the cached model.
 *
 * @param service           The {@link Service} for the run's `service_id`, or
 *                          `undefined`/`null` when the run is orphaned or the
 *                          id doesn't resolve to a cached service.
 * @param appComponentsById A lookup of cached {@link ApplicationComponent}s by
 *                          id (built from the AppShell model cache).
 * @returns The short technology tier, or `'Unknown'` on any nullable-hop miss.
 */
export function deriveServiceTier(
  service: Service | null | undefined,
  appComponentsById: ReadonlyMap<string, ApplicationComponent>,
): ServiceTier {
  // Hop 0: the service itself may not have resolved.
  if (!service) return 'Unknown';

  // Hop 1: service -> app_component_id (nullable / absent).
  const componentId = service.app_component_id;
  if (!componentId) return 'Unknown';

  // Hop 2: app_component_id -> ApplicationComponent (may be absent from the map).
  const component = appComponentsById.get(componentId);
  if (!component) return 'Unknown';

  // Hop 3: component.tech_type -> short tier ('Other'/unset -> 'Unknown').
  return tierFromTechType(component.tech_type);
}
