/**
 * LLM gap-proposal generation (Spec 2026-08-04-4).
 *
 * For a structural finding the user chose to FIX UPSTREAM but where no live
 * source database is reachable (harvest unavailable), the LLM drafts the
 * missing structural metadata from the committed model itself — join columns
 * for relationships without `fk_columns` (naming-convention inference), and
 * primary-key candidates for tables without one. Every draft lands in a
 * REVIEW QUEUE (the pack-translation idiom): nothing touches the model until
 * a human approves the row, and approval writes the metadata back through
 * the same additive backfill the discovery save uses — after which a pack
 * REGENERATION (not this module) clears the finding. The generator is the
 * only resolution oracle.
 *
 * Hallucination guard: every table / column / relationship a proposal names
 * must exist in the committed model; invalid proposals are dropped with an
 * honest per-drop warning, never silently repaired.
 */
import type {
  CommittedPhysicalModel,
  RawPhysicalAttribute,
  RawPhysicalEntity,
} from './dbMigrationPack/inputs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GapProposalKind = 'fk_join' | 'primary_key';

export interface FkJoinPayload {
  relationship_id: string;
  from_table: string;
  join_columns: string[];
  to_table: string;
  referenced_columns: string[];
}

export interface PrimaryKeyPayload {
  table: string;
  entity_id: string;
  columns: string[];
}

/** One validated proposal, shaped for the AMS queue upsert (snake_case). */
export interface GapProposalRow {
  proposal_key: string;
  finding_key: string;
  kind: GapProposalKind;
  payload_json: FkJoinPayload | PrimaryKeyPayload;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface GapProposalGenerationResult {
  supported: boolean;
  /** Why generation is unsupported for this finding kind (harvest / accept instead). */
  unsupportedReason?: string;
  proposals: GapProposalRow[];
  /** Honest per-drop notes for invalid LLM output (hallucinated names etc.). */
  warnings: string[];
  systemPrompt?: string;
  userPrompt?: string;
}

/** Finding kinds the LLM can meaningfully draft for. */
const FK_FINDING = 'relationships_without_fk_columns';
const PK_FINDINGS = new Set(['no_primary_keys', 'constraints_metadata_absent']);

// ---------------------------------------------------------------------------
// Model summary (prompt input) — compact, deterministic ordering
// ---------------------------------------------------------------------------

interface EntityView {
  entity: RawPhysicalEntity;
  attributes: RawPhysicalAttribute[];
}

function entityViews(model: CommittedPhysicalModel): Map<string, EntityView> {
  const byId = new Map<string, EntityView>();
  for (const e of [...model.physicalDataEntities].sort((a, b) => a.name.localeCompare(b.name))) {
    byId.set(e.id, { entity: e, attributes: [] });
  }
  const sorted = [...model.physicalDataAttributes].sort(
    (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.name.localeCompare(b.name)
  );
  for (const attr of sorted) {
    byId.get(attr.physical_entity_id)?.attributes.push(attr);
  }
  return byId;
}

function describeEntity(view: EntityView): string {
  const cols = view.attributes
    .map((a) => {
      const flags = [
        a.is_primary_key === true ? 'pk' : null,
        a.is_identity === true ? 'identity' : null,
        a.is_nullable === false ? 'not null' : null,
      ]
        .filter(Boolean)
        .join(' ');
      return `    - ${a.name} ${a.data_type ?? a.source_type ?? '?'}${flags ? ` [${flags}]` : ''}`;
    })
    .join('\n');
  return `  ${view.entity.name}\n${cols}`;
}

/** Relationships that carry NO usable fk_columns join metadata. */
export function joinlessRelationships(model: CommittedPhysicalModel) {
  const pointById = new Map(model.dataEntityPoints.map((p) => [p.id, p]));
  const entityById = new Map(model.physicalDataEntities.map((e) => [e.id, e]));
  const out: Array<{
    id: string;
    fromEntity: RawPhysicalEntity;
    toEntity: RawPhysicalEntity;
  }> = [];
  for (const rel of model.dataEntityRelationships) {
    const hasJoin =
      !!rel.fk_columns &&
      Array.isArray(rel.fk_columns.join_columns) &&
      rel.fk_columns.join_columns.length > 0;
    if (hasJoin) continue;
    const fromPoint = rel.fromDataEntityPointId ? pointById.get(rel.fromDataEntityPointId) : null;
    const toPoint = rel.toDataEntityPointId ? pointById.get(rel.toDataEntityPointId) : null;
    const fromEntity = fromPoint?.physical_entity_id
      ? entityById.get(fromPoint.physical_entity_id)
      : null;
    const toEntity = toPoint?.physical_entity_id
      ? entityById.get(toPoint.physical_entity_id)
      : null;
    if (!fromEntity || !toEntity) continue;
    out.push({ id: rel.id, fromEntity, toEntity });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a database migration analyst. You infer MISSING structural metadata ' +
  'for a legacy relational schema from naming conventions and data types. You ' +
  'respond with STRICT JSON only (no prose, no markdown). You NEVER invent ' +
  'tables or columns that are not in the provided schema; when no defensible ' +
  'inference exists you omit the item rather than guessing.';

function fkUserPrompt(
  rels: ReturnType<typeof joinlessRelationships>,
  views: Map<string, EntityView>
): string {
  const relLines = rels
    .map((r) => `  - relationship_id=${r.id}: ${r.fromEntity.name} -> ${r.toEntity.name}`)
    .join('\n');
  const involved = new Set<string>();
  rels.forEach((r) => {
    involved.add(r.fromEntity.id);
    involved.add(r.toEntity.id);
  });
  const tableLines = [...involved]
    .map((id) => views.get(id))
    .filter((v): v is EntityView => !!v)
    .sort((a, b) => a.entity.name.localeCompare(b.entity.name))
    .map(describeEntity)
    .join('\n');
  return (
    'These declared relationships carry NO foreign-key join metadata. For each, ' +
    'infer the join columns from the column lists (typical conventions: ' +
    '`<table>_id`, `<singular>_id`, matching identity/pk columns, identical ' +
    'names+types). Skip a relationship rather than guess when nothing matches.\n\n' +
    `Relationships:\n${relLines}\n\nTables:\n${tableLines}\n\n` +
    'Respond with JSON: {"proposals": [{"relationship_id": "...", ' +
    '"from_table": "<name exactly as shown>", "join_columns": ["..."], ' +
    '"to_table": "<name exactly as shown>", "referenced_columns": ["..."], ' +
    '"rationale": "...", "confidence": "high|medium|low"}]}'
  );
}

function pkUserPrompt(views: Map<string, EntityView>, tablesWithoutPk: EntityView[]): string {
  const tableLines = tablesWithoutPk.map(describeEntity).join('\n');
  return (
    'These tables declare NO primary key in the captured model. For each, ' +
    'propose the most defensible primary-key column set from the columns ' +
    'shown (prefer identity columns, then `id`/`<table>_id` naming, then a ' +
    'minimal natural key). Skip a table rather than guess when nothing is ' +
    'defensible.\n\n' +
    `Tables:\n${tableLines}\n\n` +
    'Respond with JSON: {"proposals": [{"table": "<name exactly as shown>", ' +
    '"columns": ["..."], "rationale": "...", "confidence": "high|medium|low"}]}'
  );
}

// ---------------------------------------------------------------------------
// Parsing + hallucination guard
// ---------------------------------------------------------------------------

function asConfidence(raw: unknown): 'high' | 'medium' | 'low' {
  return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : 'low';
}

function extractJsonObject(content: string): Record<string, unknown> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM response contained no JSON object');
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

export function parseFkProposals(
  content: string,
  findingKey: string,
  model: CommittedPhysicalModel
): { proposals: GapProposalRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const proposals: GapProposalRow[] = [];
  const rels = new Map(joinlessRelationships(model).map((r) => [r.id, r]));
  const views = entityViews(model);
  const columnsOf = (entity: RawPhysicalEntity): Set<string> =>
    new Set((views.get(entity.id)?.attributes ?? []).map((a) => a.name.toLowerCase()));

  const raw = extractJsonObject(content);
  const list = Array.isArray(raw.proposals) ? raw.proposals : [];
  for (const item of list) {
    const p = item as Record<string, unknown>;
    const relId = typeof p.relationship_id === 'string' ? p.relationship_id : '';
    const rel = rels.get(relId);
    if (!rel) {
      warnings.push(`dropped fk proposal: unknown/already-joined relationship "${relId}"`);
      continue;
    }
    const joinColumns = Array.isArray(p.join_columns) ? p.join_columns.map(String) : [];
    const referencedColumns = Array.isArray(p.referenced_columns)
      ? p.referenced_columns.map(String)
      : [];
    if (joinColumns.length === 0 || joinColumns.length !== referencedColumns.length) {
      warnings.push(`dropped fk proposal for ${relId}: empty or mismatched column lists`);
      continue;
    }
    const fromCols = columnsOf(rel.fromEntity);
    const toCols = columnsOf(rel.toEntity);
    const badJoin = joinColumns.filter((c) => !fromCols.has(c.toLowerCase()));
    const badRef = referencedColumns.filter((c) => !toCols.has(c.toLowerCase()));
    if (badJoin.length > 0 || badRef.length > 0) {
      warnings.push(
        `dropped fk proposal for ${relId}: hallucinated column(s) ` +
          `${[...badJoin, ...badRef].join(', ')}`
      );
      continue;
    }
    proposals.push({
      proposal_key: `fk--${relId}`,
      finding_key: findingKey,
      kind: 'fk_join',
      payload_json: {
        relationship_id: relId,
        from_table: rel.fromEntity.name,
        join_columns: joinColumns,
        to_table: rel.toEntity.name,
        referenced_columns: referencedColumns,
      },
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      confidence: asConfidence(p.confidence),
    });
  }
  return { proposals, warnings };
}

export function parsePkProposals(
  content: string,
  findingKey: string,
  model: CommittedPhysicalModel
): { proposals: GapProposalRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const proposals: GapProposalRow[] = [];
  const views = entityViews(model);
  const byName = new Map(
    [...views.values()].map((v) => [v.entity.name.toLowerCase(), v] as const)
  );

  const raw = extractJsonObject(content);
  const list = Array.isArray(raw.proposals) ? raw.proposals : [];
  for (const item of list) {
    const p = item as Record<string, unknown>;
    const tableName = typeof p.table === 'string' ? p.table : '';
    const view = byName.get(tableName.toLowerCase());
    if (!view) {
      warnings.push(`dropped pk proposal: unknown table "${tableName}"`);
      continue;
    }
    const columns = Array.isArray(p.columns) ? p.columns.map(String) : [];
    const have = new Set(view.attributes.map((a) => a.name.toLowerCase()));
    const bad = columns.filter((c) => !have.has(c.toLowerCase()));
    if (columns.length === 0 || bad.length > 0) {
      warnings.push(
        `dropped pk proposal for ${tableName}: ` +
          (columns.length === 0 ? 'no columns' : `hallucinated column(s) ${bad.join(', ')}`)
      );
      continue;
    }
    proposals.push({
      proposal_key: `pk--${view.entity.name.toLowerCase()}`,
      finding_key: findingKey,
      kind: 'primary_key',
      payload_json: {
        table: view.entity.name,
        entity_id: view.entity.id,
        columns,
      },
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      confidence: asConfidence(p.confidence),
    });
  }
  return { proposals, warnings };
}

// ---------------------------------------------------------------------------
// Orchestration (pure prompt-build + parse; the LLM call is injected)
// ---------------------------------------------------------------------------

export type GapLlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
}) => Promise<{ content: string }>;

export async function runGapProposalGeneration(args: {
  projectId: string;
  findingKind: string;
  findingKey: string;
  model: CommittedPhysicalModel;
  callLlm: GapLlmCaller;
}): Promise<GapProposalGenerationResult> {
  const { projectId, findingKind, findingKey, model, callLlm } = args;
  const views = entityViews(model);

  if (findingKind === FK_FINDING) {
    const rels = joinlessRelationships(model);
    if (rels.length === 0) {
      return {
        supported: true,
        proposals: [],
        warnings: ['no join-less relationships remain in the committed model'],
      };
    }
    const userPrompt = fkUserPrompt(rels, views);
    const { content } = await callLlm({ systemPrompt: SYSTEM_PROMPT, userPrompt, projectId });
    const { proposals, warnings } = parseFkProposals(content, findingKey, model);
    return { supported: true, proposals, warnings, systemPrompt: SYSTEM_PROMPT, userPrompt };
  }

  if (PK_FINDINGS.has(findingKind)) {
    const withoutPk = [...views.values()].filter(
      (v) => !v.attributes.some((a) => a.is_primary_key === true)
    );
    if (withoutPk.length === 0) {
      return {
        supported: true,
        proposals: [],
        warnings: ['every committed table already carries a primary-key attribute'],
      };
    }
    const userPrompt = pkUserPrompt(views, withoutPk);
    const { content } = await callLlm({ systemPrompt: SYSTEM_PROMPT, userPrompt, projectId });
    const { proposals, warnings } = parsePkProposals(content, findingKey, model);
    return { supported: true, proposals, warnings, systemPrompt: SYSTEM_PROMPT, userPrompt };
  }

  return {
    supported: false,
    unsupportedReason:
      `The LLM cannot draft metadata for finding kind "${findingKind}" — it would be ` +
      'invention, not inference. Use the source-DB harvest (it reads the real catalogs) ' +
      'or disposition the finding as accepted / known gap.',
    proposals: [],
    warnings: [],
  };
}
