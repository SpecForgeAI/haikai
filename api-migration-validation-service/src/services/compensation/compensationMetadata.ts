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
  constraints_metadata?: {
    primary_key?: { name?: string; columns?: string[] } | null;
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

    byTable.set(table.toLowerCase(), { table, pkColumns, columns });
  }
  return { byTable };
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

/** Lookup helper: case-insensitive, tolerant of `schema.table` callers. */
export function metadataForTable(
  index: CompensationMetadataIndex,
  table: string,
): CompensationTableMeta | null {
  const bare = table.includes('.') ? table.slice(table.lastIndexOf('.') + 1) : table;
  return index.byTable.get(bare.toLowerCase()) ?? index.byTable.get(table.toLowerCase()) ?? null;
}
