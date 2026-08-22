/**
 * Compensation metadata resolution (Capture-State Discipline Spec 1).
 *
 * One committed-model read supplies everything the engine needs per physical
 * table: the primary key (from `constraints_metadata.primary_key.columns`,
 * falling back to attributes flagged `is_primary_key`), every column name with
 * its verbatim `source_type`, and the `is_identity` flags (identity reseed +
 * IDENTITY_INSERT handling).
 *
 * FAIL-CLOSED: a table without a resolvable primary key is entered into the
 * map with `pkColumns: []` — the runner turns that into a `missing_pk`
 * refusal; the mutating call is never fired uncompensated. Silent inference
 * of a "probably unique" key is deliberately NOT attempted.
 */

import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../../config';
import type { CompensationColumnMeta, CompensationTableMeta } from './types';

interface RawAttribute {
  physical_entity_id?: string;
  name?: string;
  is_primary_key?: boolean;
  is_identity?: boolean;
  source_type?: string | null;
  data_type?: string | null;
  ordinal?: number | null;
}

interface RawPhysicalEntity {
  id?: string;
  name?: string;
  migration_scope?: string | null;
  scope_decision_ref?: string | null;
  constraints_metadata?: {
    primary_key?: { name?: string; columns?: string[] } | null;
    key_policy?: string | null;
  } | null;
}

interface RawModel {
  metaModel?: {
    entities?: {
      physical_data_entities?: RawPhysicalEntity[];
      physical_data_attributes?: RawAttribute[];
    };
  };
}

export interface CompensationMetadataIndex {
  /** lowercase table name -> metadata. */
  byTable: Map<string, CompensationTableMeta>;
  /** Lowercase names of `volatile`-scoped tables (Foundations Spec 3) —
   *  the S0 fingerprint tolerance list. Absent/empty when the index was
   *  built from scan-supplied specs (auto-S0 path). */
  volatileTables?: Set<string>;
}

/** Test seam: build the index from an already-fetched raw model object. */
export function buildCompensationMetadataIndex(model: unknown): CompensationMetadataIndex {
  const raw = model as RawModel;
  const entities = raw.metaModel?.entities?.physical_data_entities ?? [];
  const attributes = raw.metaModel?.entities?.physical_data_attributes ?? [];

  const attrsByEntityId = new Map<string, RawAttribute[]>();
  for (const attr of attributes) {
    if (!attr.physical_entity_id) continue;
    const list = attrsByEntityId.get(attr.physical_entity_id) ?? [];
    list.push(attr);
    attrsByEntityId.set(attr.physical_entity_id, list);
  }

  const byTable = new Map<string, CompensationTableMeta>();
  for (const entity of entities) {
    const table = entity.name ?? '';
    if (!table || !entity.id) continue;
    const attrs = (attrsByEntityId.get(entity.id) ?? [])
      .slice()
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

    const columns: CompensationColumnMeta[] = attrs
      .filter((a) => (a.name ?? '').length > 0)
      .map((a) => ({
        name: a.name as string,
        sourceType: a.source_type ?? a.data_type ?? null,
        isIdentity: a.is_identity === true,
      }));

    const declaredPk = entity.constraints_metadata?.primary_key?.columns;
    const pkColumns =
      Array.isArray(declaredPk) && declaredPk.length > 0
        ? declaredPk.filter((c): c is string => typeof c === 'string' && c.length > 0)
        : attrs
            .filter((a) => a.is_primary_key === true && (a.name ?? '').length > 0)
            .map((a) => a.name as string);

    // Foundations Spec 3 (2026-08-22): scope + key policy ride the entity —
    // a FOUNDATION-PROMOTED primary key lands in constraints_metadata and is
    // consumed here with zero special-casing (the decision materialized the
    // fact).
    const rawScope = (entity.migration_scope ?? '').toLowerCase();
    const scope =
      rawScope === 'excluded' || rawScope === 'volatile' || rawScope === 'data_only'
        ? (rawScope as 'excluded' | 'volatile' | 'data_only')
        : 'in_scope';
    const keyPolicy =
      (entity.constraints_metadata?.key_policy ?? '') === 'keyless_multiset'
        ? ('keyless_multiset' as const)
        : null;

    byTable.set(table.toLowerCase(), { table, pkColumns, columns, keyPolicy, scope });
  }
  const volatileTables = new Set<string>();
  for (const [lower, meta] of byTable) {
    if (meta.scope === 'volatile') volatileTables.add(lower);
  }
  return { byTable, volatileTables };
}

/**
 * Fetch the committed model and build the index. Returns null on any read
 * failure — callers degrade to refusal (`missing_pk` per table), never to an
 * uncompensated write.
 */
export async function fetchCompensationMetadataIndex(
  projectId: string,
  architectureId: string,
): Promise<CompensationMetadataIndex | null> {
  try {
    const response = await fetch(
      `${ARCHITECTURE_MODEL_SERVICE_BASE_URL}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    return buildCompensationMetadataIndex(await response.json());
  } catch {
    return null;
  }
}

/**
 * Build the index from SCAN-SUPPLIED table specs (CSD auto-S0, 2026-08-19):
 * the DB scan's own harvest carries tables + PKs + identity flags BEFORE the
 * model is committed, so the automatic S0 snapshot at scan completion does
 * not wait for save-back. Same fail-closed posture: a spec without PK
 * columns lands with `pkColumns: []` (count-only downstream).
 */
export interface S0TableSpec {
  table: string;
  pk_columns?: string[] | null;
  columns?: Array<{
    name?: string;
    source_type?: string | null;
    is_identity?: boolean | null;
  }> | null;
}

export function buildIndexFromTableSpecs(specs: S0TableSpec[]): CompensationMetadataIndex {
  const byTable = new Map<string, CompensationTableMeta>();
  for (const spec of specs) {
    if (!spec.table || spec.table.trim().length === 0) continue;
    const columns: CompensationColumnMeta[] = (spec.columns ?? [])
      .filter((c): c is NonNullable<typeof c> => !!c && !!c.name)
      .map((c) => ({
        name: c.name as string,
        sourceType: c.source_type ?? null,
        isIdentity: c.is_identity === true,
      }));
    const pkColumns = (spec.pk_columns ?? []).filter(
      (c): c is string => typeof c === 'string' && c.length > 0,
    );
    byTable.set(spec.table.toLowerCase(), { table: spec.table, pkColumns, columns });
  }
  return { byTable };
}

/** Lookup helper: case-insensitive, tolerant of `schema.table` callers. */
export function metadataForTable(
  index: CompensationMetadataIndex,
  table: string,
): CompensationTableMeta | null {
  const bare = table.includes('.') ? table.slice(table.lastIndexOf('.') + 1) : table;
  return index.byTable.get(bare.toLowerCase()) ?? index.byTable.get(table.toLowerCase()) ?? null;
}
