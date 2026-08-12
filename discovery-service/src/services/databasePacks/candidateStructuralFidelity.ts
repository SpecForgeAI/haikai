/**
 * Shared structural-fidelity helpers for the DB-pack candidate emission.
 *
 * Spec: 2026-05-29 DB Structural Fidelity -- Task Group 2 (Group A candidate
 * feed). Engine-agnostic so the Postgres + Sybase packs do not diverge.
 *
 * These helpers reshape the existing introspection IR into the EXACT
 * snake_case shapes the Group-1 AMS DTOs expect:
 *   - `physical_data_attributes`: source_type / scale / precision /
 *     column_default / ordinal / is_identity.
 *   - `physical_data_entities`: constraints_metadata
 *     { primary_key, unique_constraints[], check_constraints[], indexes[] }.
 *   - `logical_data_entity_relationships`: fk_columns
 *     { join_columns[], referenced_columns[] }.
 *
 * INVARIANT (spec.md): physical entities ONLY. These helpers NEVER synthesize
 * a logical entity or a logical<->physical mapping (DEFERRED to Issue 2). They
 * only enrich the EXISTING physical candidate payloads.
 *
 * Oracle-W3 (additive): the index entries now also carry verbatim ordering /
 * clustering / partial-predicate metadata, and the FK block now also carries
 * the verbatim referential ACTIONS (on_delete / on_update). All new keys are
 * OPTIONAL and additive into the existing JSONB -- the stable keys
 * (`name`/`columns`/`is_unique`, `join_columns`/`referenced_columns`) are
 * unchanged. There is NO AMS schema / changeset change: the new keys land in
 * the existing free-form `constraints_metadata` / `fk_columns` JSONB columns.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (additive, ALONGSIDE W3): the
 * per-attribute payload now also carries `collation` (Group B) and
 * `is_generated` / `generation_expression` (Group E) -- verbatim, snake_case,
 * into the SAME free-form `physical_data_attributes` metadata. No new AMS
 * column / changeset.
 */

import type { ColumnMetadata, KeyOrIndexMetadata } from './types';

/**
 * One `indexes[]` entry in `constraints_metadata`. The first three keys are
 * the stable Spec-3 shape; the remaining keys are Oracle-W3 additive ordering /
 * clustering / partial-predicate fields (all optional, all verbatim from the
 * engine catalog -- no normalization). A key is OMITTED when the engine did not
 * report it, keeping the persisted JSONB minimal for engines that can't derive
 * it.
 */
export interface ConstraintsIndexEntry {
  name: string;
  columns: string[];
  is_unique: boolean;
  /** Verbatim index DDL (Postgres `pg_indexes.indexdef`). */
  definition?: string;
  /** Access method / index type (e.g. `btree` / `gin` / `hash`). */
  method?: string;
  /** TRUE when the index is clustered. */
  is_clustered?: boolean;
  /** Partial-index predicate (the `WHERE ...` clause), verbatim. */
  predicate?: string;
  /**
   * Per-column ordering directives, positionally aligned with `columns` --
   * e.g. `ASC` / `DESC NULLS FIRST`. Verbatim from the index DDL.
   */
  column_directions?: string[];
}

/**
 * Structured constraint/index metadata attached to a `physical_data_entities`
 * candidate (and persisted to the AMS `constraints_metadata` JSONB column).
 * snake_case keys match the AMS DTO contract verbatim.
 */
export interface ConstraintsMetadata {
  primary_key: { name: string; columns: string[] } | null;
  unique_constraints: Array<{ name: string; columns: string[] }>;
  check_constraints: Array<{ name: string; expression: string | null }>;
  indexes: ConstraintsIndexEntry[];
}

/**
 * FK column-level detail attached to a relationship candidate (and persisted
 * to the AMS `fk_columns` JSONB column). snake_case keys match the DTO.
 *
 * `on_delete` / `on_update` (Oracle-W3) are the verbatim engine referential
 * actions; they are OMITTED when the engine / sidecar did not report them so
 * the existing `{join_columns, referenced_columns}` shape round-trips
 * unchanged for engines / inferences that have no declared action.
 */
export interface FkColumnsMetadata {
  join_columns: string[];
  referenced_columns: string[];
  /** Verbatim ON DELETE referential action (e.g. `CASCADE` / `SET NULL`). */
  on_delete?: string;
  /** Verbatim ON UPDATE referential action (e.g. `CASCADE` / `NO ACTION`). */
  on_update?: string;
}

/**
 * Build the `constraints_metadata` block for one table from the
 * already-introspected key/index list. Returns null when the table has no
 * keys/indexes at all so a null/absent block round-trips cleanly through AMS.
 *
 * Foreign keys are intentionally NOT folded in here -- FK detail lives on the
 * relationship candidate's `fk_columns` (see {@link buildFkColumnsMetadata}),
 * mirroring the architecture split (a table's constraints vs. a relationship's
 * join columns).
 */
export function buildConstraintsMetadata(
  schemaName: string,
  tableName: string,
  keysAndIndexes: KeyOrIndexMetadata[],
): ConstraintsMetadata | null {
  let primaryKey: { name: string; columns: string[] } | null = null;
  const uniqueConstraints: Array<{ name: string; columns: string[] }> = [];
  const checkConstraints: Array<{ name: string; expression: string | null }> = [];
  const indexes: ConstraintsIndexEntry[] = [];

  let sawAny = false;
  for (const k of keysAndIndexes) {
    if (k.schemaName !== schemaName || k.tableName !== tableName) continue;
    switch (k.kind) {
      case 'primary_key':
        // Last writer wins if (pathologically) two PKs report; in practice one.
        primaryKey = { name: k.name, columns: k.columns ?? [] };
        sawAny = true;
        break;
      case 'unique_constraint':
        uniqueConstraints.push({ name: k.name, columns: k.columns ?? [] });
        sawAny = true;
        break;
      case 'check_constraint':
        checkConstraints.push({
          name: k.name,
          expression: k.checkExpression ?? null,
        });
        sawAny = true;
        break;
      case 'index': {
        // Stable Spec-3 keys first, then Oracle-W3 additive ordering /
        // clustering / partial-predicate keys (only set when present so the
        // persisted JSONB stays minimal). Verbatim -- no normalization.
        const entry: ConstraintsIndexEntry = {
          name: k.name,
          columns: k.columns ?? [],
          is_unique: k.isUnique === true,
        };
        if (k.indexDefinition !== undefined && k.indexDefinition !== null) {
          entry.definition = k.indexDefinition;
        }
        if (k.indexMethod !== undefined && k.indexMethod !== null) {
          entry.method = k.indexMethod;
        }
        if (k.isClustered === true) {
          entry.is_clustered = true;
        }
        if (k.indexPredicate !== undefined && k.indexPredicate !== null) {
          entry.predicate = k.indexPredicate;
        }
        if (
          k.columnDirections !== undefined &&
          k.columnDirections !== null &&
          k.columnDirections.length > 0
        ) {
          entry.column_directions = k.columnDirections;
        }
        indexes.push(entry);
        sawAny = true;
        break;
      }
      // foreign_key: skip -- carried on the relationship candidate.
      default:
        break;
    }
  }

  if (!sawAny) return null;
  return {
    primary_key: primaryKey,
    unique_constraints: uniqueConstraints,
    check_constraints: checkConstraints,
    indexes,
  };
}

/**
 * Build the `fk_columns` block for a relationship from the FK column lists on
 * each side. Returns null when there are no join columns so a null/absent
 * block round-trips cleanly.
 *
 * `referentialActions` (Oracle-W3, optional) carries the verbatim engine
 * `on_delete` / `on_update` strings. Each is added to the JSONB only when
 * present, so the existing `{join_columns, referenced_columns}` shape is
 * unchanged for callers / engines that do not supply an action.
 */
export function buildFkColumnsMetadata(
  joinColumns: string[] | null | undefined,
  referencedColumns: string[] | null | undefined,
  referentialActions?: {
    onDelete?: string | null;
    onUpdate?: string | null;
  },
): FkColumnsMetadata | null {
  const join = (joinColumns ?? []).filter((c) => typeof c === 'string' && c.length > 0);
  const referenced = (referencedColumns ?? []).filter(
    (c) => typeof c === 'string' && c.length > 0,
  );
  if (join.length === 0 && referenced.length === 0) return null;
  const out: FkColumnsMetadata = {
    join_columns: join,
    referenced_columns: referenced,
  };
  const onDelete = referentialActions?.onDelete;
  if (typeof onDelete === 'string' && onDelete.length > 0) {
    out.on_delete = onDelete;
  }
  const onUpdate = referentialActions?.onUpdate;
  if (typeof onUpdate === 'string' && onUpdate.length > 0) {
    out.on_update = onUpdate;
  }
  return out;
}

/**
 * Thread the structural-fidelity attribute fields onto a
 * `physical_data_attributes` candidate `data` payload. The keys are the
 * snake_case AMS DTO names verbatim (`source_type` / `scale` / `precision` /
 * `column_default` / `ordinal` / `is_identity`) so a future save-back can map
 * them directly. The legacy camelCase keys (`dataType` / `defaultExpression` /
 * `ordinalPosition`) are preserved by the caller for back-compat.
 *
 * NO type normalization: `source_type` is the verbatim engine `dataType`.
 *
 * Spec 2026-05-30 Data-Layer Fidelity 2 (additive, ALONGSIDE the Spec-3 / W3
 * keys): also threads `collation` (Group B) and `is_generated` /
 * `generation_expression` (Group E). Each is set verbatim from the IR and
 * defaults to null when the engine / sidecar did not report it, so a plain
 * writable column with no special collation simply carries
 * `collation: null` / `is_generated: false` / `generation_expression: null`
 * and the existing Spec-3 keys are unchanged.
 */
/**
 * Length-bearing base types whose declared width must ride INSIDE
 * `source_type` (2026-08-12): AMS attributes carry NO length column, so a
 * bare `char` + separate maxLength loses the width at save-back FOREVER —
 * the pack generator then reads bare `char` (PostgreSQL: char(1)) and the
 * live estate saw `value too long for type character(1)` load failures.
 * Composing `char` + 8 -> `char(8)` is FIDELITY (the engine's own
 * parenthesized spelling), not normalization. Numeric precision/scale
 * already ride their own AMS slots and are untouched.
 */
const LENGTH_BEARING_BASES = new Set([
  'char', 'nchar', 'varchar', 'nvarchar', 'binary', 'varbinary',
]);

/** `char` + 8 -> `char(8)`; already-parenthesized / length-less types pass through. */
export function composeSourceType(
  dataType: string,
  maxLength: number | null | undefined,
): string {
  const raw = (dataType ?? '').trim();
  if (raw.includes('(')) return raw; // engine already spelled the width
  if (
    maxLength === null ||
    maxLength === undefined ||
    !Number.isFinite(maxLength) ||
    maxLength <= 0
  ) {
    return raw;
  }
  return LENGTH_BEARING_BASES.has(raw.toLowerCase()) ? `${raw}(${maxLength})` : raw;
}

export function attributeStructuralFidelityFields(
  c: ColumnMetadata,
): Record<string, unknown> {
  return {
    source_type: composeSourceType(c.dataType, c.maxLength),
    scale: c.scale ?? null,
    precision: c.precision ?? null,
    column_default: c.defaultExpression ?? null,
    ordinal: c.ordinalPosition ?? null,
    is_identity: c.isIdentity ?? null,
    sequence_name: c.sequenceName ?? null,
    // Spec 2026-05-30 Data-Layer Fidelity 2 -- Group B (collation) + Group E
    // (computed/generated column). Verbatim; no normalization.
    collation: c.collation ?? null,
    is_generated: c.isGenerated === true,
    generation_expression: c.generationExpression ?? null,
  };
}
