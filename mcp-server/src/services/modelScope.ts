/**
 * Migration-scope accessors (Foundations & Scope program, Spec 1,
 * 2026-08-22) — THE mandatory read surface for the model's
 * physical-data-entity collection.
 *
 * Option (a) of the persistence ruling: ONE collection
 * (`physical_data_entities`) + `migration_scope` / `scope_decision_ref`
 * fields on each entity. Exclusion is a TAG, never a deletion — current
 * state keeps excluded entities (factual record; the S0 fingerprint
 * verifier resolves table metadata from the model), while TARGET-side
 * stages read through {@link inScopeEntities}.
 *
 * The per-service guard test (modelScopeGuard) fails the build when a NEW
 * file touches the raw collection outside this module — existing readers
 * are frozen in the guard's baseline allowlist and migrate as later specs
 * touch them (the ratchet pattern).
 */

export type MigrationScope = 'in_scope' | 'excluded' | 'volatile' | 'data_only';

export interface ScopedEntityLike {
  id?: string;
  name?: string;
  migration_scope?: string | null;
  scope_decision_ref?: string | null;
  [key: string]: unknown;
}

interface ModelLike {
  metaModel?: {
    entities?: {
      physical_data_entities?: unknown[] | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/** Normalized scope of one entity — absent/unknown values mean `in_scope`
 *  (decisions never block; safe default). */
export function entityScope(entity: ScopedEntityLike | null | undefined): MigrationScope {
  const raw = (entity?.migration_scope ?? '').toString().toLowerCase();
  if (raw === 'excluded' || raw === 'volatile' || raw === 'data_only') return raw;
  return 'in_scope';
}

/** The foundation decision key ('F-1') that set the scope, or null. */
export function scopeDecisionRef(entity: ScopedEntityLike | null | undefined): string | null {
  const raw = entity?.scope_decision_ref;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** EVERY physical entity, scope-blind — current-state readers (S0
 *  metadata, structural model UI, conflict checks). */
export function allEntities(model: ModelLike | null | undefined): ScopedEntityLike[] {
  const list = model?.metaModel?.entities?.physical_data_entities;
  return Array.isArray(list) ? (list as ScopedEntityLike[]) : [];
}

/** TARGET-side read: excludes `excluded` and `volatile` entities.
 *  `data_only` stays in (target gets schema + data; behaviour-level
 *  consumers refine via {@link entityScope}). */
export function inScopeEntities(model: ModelLike | null | undefined): ScopedEntityLike[] {
  return allEntities(model).filter((e) => {
    const scope = entityScope(e);
    return scope === 'in_scope' || scope === 'data_only';
  });
}

/** Lower-cased names of `volatile` entities — the S0 fingerprint tolerance
 *  list (churn tables the app writes during normal operation). */
export function volatileEntityNames(model: ModelLike | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of allEntities(model)) {
    if (entityScope(e) === 'volatile' && typeof e.name === 'string') {
      out.add(e.name.toLowerCase());
    }
  }
  return out;
}

/** Lower-cased names of `excluded` entities (receipt rendering + conflict
 *  checks). */
export function excludedEntityNames(model: ModelLike | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of allEntities(model)) {
    if (entityScope(e) === 'excluded' && typeof e.name === 'string') {
      out.add(e.name.toLowerCase());
    }
  }
  return out;
}
