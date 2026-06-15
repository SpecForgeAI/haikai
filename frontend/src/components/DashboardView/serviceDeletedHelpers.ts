/**
 * Service-deleted chip predicate.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2.
 *
 * A discovery run becomes "orphaned" when its `service_id` FK is null
 * (the referenced service row was deleted; the FK was nulled by the
 * `ON DELETE SET NULL` action from Liquibase changeset 126).
 *
 * The frontend renders a warning-amber "Service deleted" chip on orphan
 * rows. When the run's `config_snapshot.serviceIdentitySnapshot` is
 * present (runs created post-snapshot-capture), the chip is accompanied
 * by the original service name. Legacy orphans (no snapshot) render the
 * chip alone -- the FK value is unrecoverable once SET NULL fires.
 *
 * Non-orphaned runs (FK still resolves) render nothing extra.
 *
 * Pure JS so the predicate is unit-testable without spinning up React.
 */

import type { DiscoveryRunDto } from '../../api/discoveryApi';

/**
 * The three exhaustive states for the chip predicate. Render switches on
 * `kind` so legacy orphans (no snapshot) gracefully degrade to a chip-only
 * presentation without crashing on a missing `serviceName`.
 */
export type ServiceDeletedState =
  | { kind: 'not-deleted' }
  | { kind: 'deleted-with-snapshot'; serviceName: string }
  | { kind: 'deleted-without-snapshot' };

/**
 * Compute the chip state for a single run.
 *
 * - `not-deleted`: `service_id` resolves (truthy, non-empty string) -- no chip.
 * - `deleted-with-snapshot`: `service_id` is null/missing AND the snapshot has
 *   a `serviceName`. Render the name plus the amber chip.
 * - `deleted-without-snapshot`: `service_id` is null/missing AND the snapshot
 *   is absent or carries no name. Render the chip alone.
 *
 * Bug fix (2026-05-17): database-discovery runs (`discovery_kind ===
 * 'database'`) are project-scoped and intentionally have `service_id ===
 * null` -- the run was never bound to a service, so it isn't an orphan.
 * These short-circuit to `not-deleted` BEFORE the orphan check fires.
 */
export function computeServiceDeletedState(run: DiscoveryRunDto): ServiceDeletedState {
  // Database-kind runs are project-scoped and never had a service_id to
  // begin with; the "Service deleted" predicate doesn't apply to them.
  if (run.discovery_kind === 'database') {
    return { kind: 'not-deleted' };
  }

  // Treat any truthy non-empty string as "still bound to a service". Null,
  // undefined, and "" all read as orphan-eligible.
  const serviceId = run.service_id;
  if (typeof serviceId === 'string' && serviceId.length > 0) {
    return { kind: 'not-deleted' };
  }

  // Pull the snapshot defensively -- config_snapshot may be null, the key may
  // be missing, the nested object may not be an object, the name may be empty.
  const snapshotRaw =
    run.config_snapshot && typeof run.config_snapshot === 'object'
      ? (run.config_snapshot as Record<string, unknown>).serviceIdentitySnapshot
      : undefined;

  const serviceName =
    snapshotRaw && typeof snapshotRaw === 'object'
      ? ((snapshotRaw as Record<string, unknown>).serviceName ??
          (snapshotRaw as Record<string, unknown>).service_name)
      : undefined;

  if (typeof serviceName === 'string' && serviceName.length > 0) {
    return { kind: 'deleted-with-snapshot', serviceName };
  }

  return { kind: 'deleted-without-snapshot' };
}
