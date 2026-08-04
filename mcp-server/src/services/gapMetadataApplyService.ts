/**
 * Gap-Metadata Apply Service (Spec 4 — LLM gap-proposal queue, 2026-08-04).
 *
 * The MODEL-WRITE half of the gap-proposal review flow. The gateway generates
 * LLM-drafted structural metadata proposals (fk join columns for relationships
 * without `fk_columns`; primary keys for tables without one), a human approves
 * a row in the AMS `db_gap_proposals` queue, and the gateway then calls
 * POST /mcp/tools/apply_gap_metadata with the approved delta. The MCP server
 * owns EVERY model write (the same reason discovery save-back lives here), so
 * the apply lands through the same GET-merge-PUT round trip as
 * `candidateSaveBackService.ts` and follows its additive doctrine:
 *
 *   - a slot that already carries a value is NEVER overwritten — the delta is
 *     SKIPPED with an honest per-delta reason (mirrors
 *     `backfillExistingRowStructure`'s "fills ONLY missing values" rule);
 *   - nothing outside the named slot is touched — a primary_key delta flags
 *     ONLY the named attributes and NEVER clears any other attribute's flag;
 *   - a delta that cannot be applied cleanly (unknown relationship/entity,
 *     column name not on the entity) is skipped WHOLE — no partial writes.
 *
 * WHY skip-not-fail: one approval batch may mix appliable and already-satisfied
 * deltas (e.g. a re-scan backfilled the fk in the meantime). Failing the whole
 * call would strand the appliable ones; silently dropping would hide the
 * collision. So the result carries `{applied, skipped: [{delta, reason}]}` and
 * the gateway surfaces the skip notes verbatim.
 */

import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// Types — the delta wire shapes the gateway builds from approved proposals
// ============================================================================

/** fk_join delta: set a relationship's missing `fk_columns` join metadata. */
export interface FkJoinDelta {
  kind: 'fk_join';
  /** `logical_data_entity_relationships` row id in the committed model. */
  relationship_id: string;
  fk_columns: {
    join_columns: string[];
    referenced_columns: string[];
    /** LLM proposals never infer referential actions — always null here. */
    on_delete: string | null;
    on_update: string | null;
  };
}

/** primary_key delta: flag pk attributes + stamp `constraints_metadata`. */
export interface PrimaryKeyDelta {
  kind: 'primary_key';
  /** `physical_data_entities` row id in the committed model. */
  entity_id: string;
  /** Attribute names (matched case-insensitively against the entity's own). */
  columns: string[];
}

export type GapMetadataDelta = FkJoinDelta | PrimaryKeyDelta;

export interface SkippedDelta {
  delta: GapMetadataDelta;
  reason: string;
}

export interface ApplyGapMetadataResult {
  applied: number;
  skipped: SkippedDelta[];
}

/**
 * The archModelClient surface this service needs — the injectable deps seam
 * (house convention) so tests drive the merge logic with a plain mock instead
 * of module-level axios mocking. Production resolves the real singleton
 * lazily (see {@link resolveDefaultClient}) so importing this module never
 * drags in axios/dotenv side effects during tests.
 */
export interface GapApplyModelClient {
  getProjectById(projectId: string): Promise<{ id: string; name: string }>;
  getModel(projectId: string, architectureId: string, filename: string): Promise<any | null>;
  putModel(projectId: string, architectureId: string, filename: string, dto: any): Promise<any>;
}

/**
 * Lazy-require the real archModelClient. WHY lazy: the singleton constructs an
 * axios instance at module load; keeping the import out of the top-level lets
 * unit tests inject a mock client without any axios/dotenv module mocks
 * (mirrors the gateway's lazy `require('../llmClient')` idiom).
 */
function resolveDefaultClient(): GapApplyModelClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { archModelClient } = require('./archModelClient');
  return archModelClient as GapApplyModelClient;
}

// ============================================================================
// Per-delta merge helpers (pure model mutation; no I/O)
// ============================================================================

/** True when a relationship already carries usable join metadata — mirrors the
 * gateway generator's `joinlessRelationships` predicate EXACTLY so "what the
 * LLM proposes for" and "what the apply refuses to overwrite" agree. */
function hasPopulatedFkColumns(rel: any): boolean {
  return (
    !!rel?.fk_columns &&
    Array.isArray(rel.fk_columns.join_columns) &&
    rel.fk_columns.join_columns.length > 0
  );
}

/**
 * Apply one fk_join delta in place. Returns null on success or the honest
 * skip reason. Additive: refuses when `fk_columns` is already populated.
 */
function applyFkJoinDelta(model: any, delta: FkJoinDelta): string | null {
  const rels: any[] =
    model?.metaModel?.relationships?.logical_data_entity_relationships ?? [];
  const rel = rels.find((r: any) => r?.id === delta.relationship_id);
  if (!rel) {
    return `relationship "${delta.relationship_id}" not found in the committed model`;
  }
  if (hasPopulatedFkColumns(rel)) {
    return (
      `relationship "${delta.relationship_id}" already carries fk_columns ` +
      '(join metadata is never overwritten — regenerate the pack instead)'
    );
  }
  const join = delta.fk_columns?.join_columns;
  const referenced = delta.fk_columns?.referenced_columns;
  if (
    !Array.isArray(join) ||
    !Array.isArray(referenced) ||
    join.length === 0 ||
    join.length !== referenced.length
  ) {
    return `relationship "${delta.relationship_id}": empty or mismatched join/referenced column lists`;
  }
  rel.fk_columns = {
    join_columns: [...join],
    referenced_columns: [...referenced],
    on_delete: delta.fk_columns.on_delete ?? null,
    on_update: delta.fk_columns.on_update ?? null,
  };
  return null;
}

/**
 * Apply one primary_key delta in place. Returns null on success or the honest
 * skip reason. Gates:
 *   - `constraints_metadata.primary_key` must be ABSENT (never overwritten);
 *   - no attribute of the entity may already be pk-flagged (a flagged pk with
 *     missing constraints_metadata means the model already knows its key —
 *     inventing a possibly-different one on top would be overwrite-by-stealth);
 *   - EVERY named column must exist on the entity (case-insensitive) or the
 *     whole delta is skipped — no partial pk is ever written.
 * On success: flags ONLY the named attributes (other attributes untouched) and
 * stamps `constraints_metadata.primary_key = { name: pk_<table>, columns }`
 * using the model's canonical attribute spellings.
 */
function applyPrimaryKeyDelta(model: any, delta: PrimaryKeyDelta): string | null {
  const entities: any[] = model?.metaModel?.entities?.physical_data_entities ?? [];
  const entity = entities.find((e: any) => e?.id === delta.entity_id);
  if (!entity) {
    return `entity "${delta.entity_id}" not found in the committed model`;
  }
  const existingPk = entity.constraints_metadata?.primary_key;
  if (existingPk !== undefined && existingPk !== null) {
    return (
      `entity "${entity.name}" already declares constraints_metadata.primary_key ` +
      '(never overwritten)'
    );
  }
  const attrs: any[] = (model?.metaModel?.entities?.physical_data_attributes ?? []).filter(
    (a: any) => a?.physical_entity_id === delta.entity_id
  );
  if (attrs.some((a: any) => a?.is_primary_key === true)) {
    return (
      `entity "${entity.name}" already carries pk-flagged attribute(s) — ` +
      'the model knows its key; refusing to stamp a drafted one on top'
    );
  }
  if (!Array.isArray(delta.columns) || delta.columns.length === 0) {
    return `entity "${entity.name}": delta names no primary-key columns`;
  }
  const attrByLowerName = new Map<string, any>(
    attrs.map((a: any) => [String(a?.name ?? '').toLowerCase(), a])
  );
  const matched: any[] = [];
  const missing: string[] = [];
  for (const col of delta.columns) {
    const attr = attrByLowerName.get(String(col).toLowerCase());
    if (attr) matched.push(attr);
    else missing.push(String(col));
  }
  if (missing.length > 0) {
    // Whole-delta skip: a partial pk is worse than no pk (wrong DDL later).
    return `entity "${entity.name}": column(s) not on the entity: ${missing.join(', ')}`;
  }
  for (const attr of matched) {
    attr.is_primary_key = true;
  }
  entity.constraints_metadata = {
    ...(entity.constraints_metadata && typeof entity.constraints_metadata === 'object'
      ? entity.constraints_metadata
      : {}),
    primary_key: {
      name: `pk_${String(entity.name ?? '').toLowerCase()}`,
      // Canonical model spellings (not the delta's casing) so the stamped
      // constraint always names real columns byte-for-byte.
      columns: matched.map((a: any) => a.name),
    },
  };
  return null;
}

// ============================================================================
// Orchestration — GET model, merge deltas additively, PUT back
// ============================================================================

export interface ApplyGapMetadataArgs {
  projectId: string;
  architectureId: string;
  deltas: GapMetadataDelta[];
}

/**
 * Apply approved gap-metadata deltas to the committed architecture model via
 * the canonical GET-merge-PUT round trip (same shape as
 * `saveDiscoveryCandidatesToModel`: filename = project name, architecture-
 * scoped model endpoints). The PUT only happens when at least one delta
 * actually changed the model — an all-skipped batch leaves the model
 * byte-for-byte untouched.
 */
export async function applyGapMetadata(
  args: ApplyGapMetadataArgs,
  client: GapApplyModelClient = resolveDefaultClient()
): Promise<ApplyGapMetadataResult> {
  const { projectId, architectureId, deltas } = args;

  // Filename derivation mirrors candidateSaveBackService step 1: the model
  // file is keyed by the PROJECT NAME, so resolve the project first.
  const project = await client.getProjectById(projectId);
  const filename = project.name;

  const model = await client.getModel(projectId, architectureId, filename);
  if (!model) {
    // No shell-creation here (unlike discovery save-back): a gap proposal is
    // BY DEFINITION drafted against an existing committed model — an absent
    // model means the caller is confused, so fail loudly.
    throw createHttpError(
      404,
      `No committed model found for project "${projectId}" / architecture "${architectureId}" — ` +
        'gap metadata can only be applied to an existing model'
    );
  }

  const skipped: SkippedDelta[] = [];
  let applied = 0;

  for (const delta of deltas) {
    const reason =
      delta.kind === 'fk_join'
        ? applyFkJoinDelta(model, delta)
        : delta.kind === 'primary_key'
          ? applyPrimaryKeyDelta(model, delta)
          : `unknown delta kind "${(delta as { kind?: string }).kind}"`;
    if (reason === null) {
      applied++;
    } else {
      skipped.push({ delta, reason });
    }
  }

  if (applied > 0) {
    await client.putModel(projectId, architectureId, filename, model);
  }

  console.log(
    `[diag-mcp] gap-metadata-apply project=${projectId} arch=${architectureId} ` +
      `deltas=${deltas.length} applied=${applied} skipped=${skipped.length} ` +
      `put=${applied > 0 ? 'yes' : 'no'}`
  );

  return { applied, skipped };
}
