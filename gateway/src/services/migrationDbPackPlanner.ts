/**
 * Deterministic DB-stream plan generation from the DB migration pack
 * (Spec 2026-07-02-b — Clustered DB Plan Generation, Persistence-Tier Oracle
 * Program).
 *
 * Replaces the LLM for BOTH phases of the two DB delivery streams
 * (`target_database_schema_implementation`, `data_migration`):
 *
 *   Phase 1 (skeleton): initiative -> epic -> feature structure derived from
 *   the pack manifest — schema epic (foundations / mechanical clusters /
 *   exceptional tables / constraints), DB code-objects epic (procs, triggers,
 *   views, scheduled jobs), data-migration epic (bulk / incremental /
 *   reconciliation) and persistence-cutover epic (final delta / sequence
 *   seeding / job re-homing / verification).
 *
 *   Phase 2 (expansion): the epics expand into deterministic stories — a few
 *   CLUSTER stories for mechanical tables (FK dependency layers, capped at
 *   MIGRATION_PLAN_DB_CLUSTER_MAX_TABLES per story — the anti-story-explosion
 *   guarantee: 250 tables ≈ 10 cluster stories, never 250), individual
 *   stories ONLY for flagged/exceptional objects, grouped review stories for
 *   translation drafts, strategy-grouped data-migration stories.
 *
 * NO LLM anywhere in this module. NO silent freeform fallback: when the pack
 * cannot be generated (engine gate / failure) the streams carry explicit
 * PREREQUISITE items instead (Gap #5 of the program). Coverage is a code
 * guarantee: every translated/flagged table in the manifest lands in exactly
 * one cluster or exceptional story, or the epic FAILS loudly.
 *
 * Stories that carry pack files verbatim (Spec C) are tagged
 * `seed_db_pack_files` and carry `packId` + `packFilePaths` as extra keys on
 * the item blob (the scaffold `seed_build_files` precedent: extra keys survive
 * the validators, the AMS JSON round-trip, and the items/append merge).
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  GeneratedMigrationBookOfWork,
  MigrationBookOfWorkItem,
  MigrationBookOfWorkWorkstream,
} from './generatedMigrationBookOfWorkSchema';
import type { EnsurePackOutcome } from './dbMigrationPackEnsure';
import type {
  CoverageEntry,
  DeltaStrategy,
  ExpectedSchemaKeyOrIndex,
  ExpectedSchemaSequence,
  IrTable,
  PackManifest,
} from './dbMigrationPack/types';
import {
  FOREIGN_KEYS_CHANGESET_PATH,
  INDEXES_CHANGESET_PATH,
  MASTER_CHANGELOG_PATH,
  SCHEMAS_CHANGESET_PATH,
  SEQUENCES_SEED_CHANGESET_PATH,
  tableChangesetPath,
} from './dbMigrationPack/liquibase';
import {
  RECONCILIATION_REPORT_PATH,
  RECONCILIATION_SQL_PATH,
  SWAP_OVER_RUNBOOK_PATH,
  SYNC_RUNNER_PATH,
  SYNC_STATE_PATH,
} from './dbMigrationPack/syncPack';
import { BULK_LOAD_MANIFEST_PATH } from './dbMigrationPack/dataScripts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One pack decision row (AMS snake_case wire). */
export interface PackDecisionRow {
  id?: string;
  decision_key: string;
  object_ref: string;
  category: string;
  question?: string;
  status: string;
}

/** One pack translation row slice (AMS snake_case wire). */
export interface PackTranslationRow {
  translation_key: string;
  object_ref: string;
  kind: string;
  disposition: string;
  review_status: string;
  pipeline_state?: string;
}

/** Everything the planner needs about the current pack, in one read. */
export interface PackView {
  packId: string;
  status: string | null;
  inputSnapshotHash: string | null;
  manifest: PackManifest;
  decisions: PackDecisionRow[];
  translations: PackTranslationRow[];
}

export type FetchPackViewFn = (
  projectId: string,
  currentArchitectureId: string
) => Promise<PackView | null>;

/** One mechanical-table cluster (the anti-explosion unit). */
export interface TableCluster {
  index: number;
  layer: number;
  /** Qualified `schema.table` names, in bulk-load (FK-topological) order. */
  tables: string[];
}

// ---------------------------------------------------------------------------
// Default AMS reads
// ---------------------------------------------------------------------------

async function amsGetJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS ${label} fetch failed: HTTP ${response.status} ${text}`);
  }
  return (await response.json()) as T;
}

/**
 * Default pack-view reader: pack row (with manifest_json) + decision queue +
 * translation rows. Returns null when no pack exists. Translations are
 * best-effort (an older AMS without the endpoint degrades to []).
 */
export const defaultFetchPackView: FetchPackViewFn = async (
  projectId,
  currentArchitectureId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const packsBase =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs`;
  const rows = await amsGetJson<Array<{ id: string }>>(
    `${packsBase}?architecture_id=${encodeURIComponent(currentArchitectureId)}`,
    'db migration pack list'
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const packId = rows[0].id;

  const pack = await amsGetJson<{
    id: string;
    status?: string | null;
    input_snapshot_hash?: string | null;
    manifest_json?: Record<string, unknown> | null;
  }>(`${packsBase}/${encodeURIComponent(packId)}`, 'db migration pack');

  const decisions = await amsGetJson<PackDecisionRow[]>(
    `${packsBase}/${encodeURIComponent(packId)}/decisions`,
    'db migration pack decisions'
  ).catch(() => [] as PackDecisionRow[]);

  let translations: PackTranslationRow[] = [];
  try {
    translations = await amsGetJson<PackTranslationRow[]>(
      `${packsBase}/${encodeURIComponent(packId)}/translations`,
      'db migration pack translations'
    );
  } catch (error) {
    logger.warn('Pack translations read failed; planner proceeds without translation rows', {
      projectId,
      packId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    packId,
    status: pack.status ?? null,
    inputSnapshotHash: pack.input_snapshot_hash ?? null,
    manifest: (pack.manifest_json ?? {}) as unknown as PackManifest,
    decisions: Array.isArray(decisions) ? decisions : [],
    translations: Array.isArray(translations) ? translations : [],
  };
};

// ---------------------------------------------------------------------------
// Manifest helpers (pure)
// ---------------------------------------------------------------------------

function lc(value: string): string {
  return value.toLowerCase();
}

/** All qualified tables in bulk-load (FK-topological) order. */
export function orderedTables(manifest: PackManifest): string[] {
  const order = manifest.bulk_load?.table_order ?? [];
  if (order.length > 0) return [...order];
  // Fallback (older manifests): expected-schema table list, name-sorted.
  return (manifest.expected_schema?.tables ?? [])
    .map((t) => `${t.schemaName}.${t.tableName}`)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Tables requiring individual (exceptional) treatment: any table whose own
 * coverage entry OR any of whose columns' coverage entries is `flagged`
 * (open pack decision attached), plus tables whose entry carries decision
 * keys. Keyed lowercase `schema.table`.
 */
export function flaggedTableSet(manifest: PackManifest): Set<string> {
  const flagged = new Set<string>();
  for (const entry of manifest.coverage?.objects ?? []) {
    if (entry.disposition !== 'flagged') continue;
    const ref = entry.objectRef ?? '';
    const parts = ref.split('.');
    if (entry.objectType === 'table' && parts.length >= 2) {
      flagged.add(lc(parts.slice(0, 2).join('.')));
    } else if (entry.objectType === 'column' && parts.length >= 3) {
      flagged.add(lc(parts.slice(0, 2).join('.')));
    }
  }
  return flagged;
}

/** Coverage entries (any type) grouped by their owning lowercase table ref. */
function coverageByTable(manifest: PackManifest): Map<string, CoverageEntry[]> {
  const byTable = new Map<string, CoverageEntry[]>();
  for (const entry of manifest.coverage?.objects ?? []) {
    const parts = (entry.objectRef ?? '').split('.');
    if (parts.length < 2) continue;
    const key = lc(parts.slice(0, 2).join('.'));
    const list = byTable.get(key) ?? [];
    list.push(entry);
    byTable.set(key, list);
  }
  return byTable;
}

/**
 * FK dependency layer per table: 1 + max(layer of referenced tables), computed
 * over the FK edges of the expected schema RESTRICTED to edges whose parent
 * appears EARLIER in the bulk-load order (the pack's topological order already
 * encodes its documented cycle breaks — dropping back-edges keeps this a DAG
 * deterministically). Roots are layer 1.
 */
export function computeTableLayers(manifest: PackManifest): Map<string, number> {
  const order = orderedTables(manifest).map(lc);
  const position = new Map<string, number>(order.map((t, i) => [t, i]));
  const parentsOf = new Map<string, string[]>();
  for (const key of manifest.expected_schema?.keysAndIndexes ?? []) {
    if ((key as ExpectedSchemaKeyOrIndex).kind !== 'foreign_key') continue;
    const child = lc(`${key.schemaName}.${key.tableName}`);
    const parent =
      key.referencedTable === null || key.referencedTable === undefined
        ? null
        : lc(`${key.referencedSchema ?? key.schemaName}.${key.referencedTable}`);
    if (!parent || !position.has(child) || !position.has(parent)) continue;
    if ((position.get(parent) as number) >= (position.get(child) as number)) {
      continue; // cycle-break back-edge — dropped deterministically
    }
    const list = parentsOf.get(child) ?? [];
    list.push(parent);
    parentsOf.set(child, list);
  }
  const layers = new Map<string, number>();
  for (const table of order) {
    const parents = parentsOf.get(table) ?? [];
    const parentLayers = parents.map((p) => layers.get(p) ?? 1);
    layers.set(table, parents.length === 0 ? 1 : 1 + Math.max(...parentLayers));
  }
  return layers;
}

/**
 * Mechanical tables (NOT flagged) grouped into clusters: bulk-load order,
 * grouped by FK dependency layer, each layer chunked at `cap` tables. The
 * clusters are the plan's unit of schema work — the anti-explosion guarantee.
 */
export function clusterMechanicalTables(
  manifest: PackManifest,
  cap: number
): TableCluster[] {
  const flagged = flaggedTableSet(manifest);
  const layers = computeTableLayers(manifest);
  const size = Number.isFinite(cap) && Math.floor(cap) >= 1 ? Math.floor(cap) : 25;

  const clusters: TableCluster[] = [];
  let current: TableCluster | null = null;
  let index = 0;
  for (const table of orderedTables(manifest)) {
    const key = lc(table);
    if (flagged.has(key)) continue;
    const layer = layers.get(key) ?? 1;
    if (current === null || current.layer !== layer || current.tables.length >= size) {
      current = { index, layer, tables: [] };
      clusters.push(current);
      index += 1;
    }
    current.tables.push(table);
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Item factory
// ---------------------------------------------------------------------------

interface ItemSeed {
  id: string;
  type: MigrationBookOfWorkItem['type'];
  parentId: string | null;
  title: string;
  description: string;
  workstream: MigrationBookOfWorkWorkstream;
  sequenceOrder: number;
  acceptanceCriteria?: string[];
  tags?: string[];
  confidence?: MigrationBookOfWorkItem['confidence'];
  readiness?: MigrationBookOfWorkItem['readiness'];
  readinessReasons?: string[];
  missingInputs?: string[];
  recommendedNextAction?: string;
  traceabilitySummary?: string;
  architectureReferences?: string[];
  discoveryFindingReferences?: string[];
  /** Extra non-schema keys carried on the item blob (scaffold precedent). */
  extras?: Record<string, unknown>;
}

function mkItem(seed: ItemSeed): MigrationBookOfWorkItem {
  const item: MigrationBookOfWorkItem = {
    id: seed.id,
    type: seed.type,
    parentId: seed.parentId,
    title: seed.title,
    description: seed.description,
    acceptanceCriteria: seed.acceptanceCriteria ?? [],
    workstream: seed.workstream,
    sequenceOrder: seed.sequenceOrder,
    tags: seed.tags ?? [],
    confidence: seed.confidence ?? 'high',
    readiness: seed.readiness ?? 'ready_for_spec',
    readinessReasons: seed.readinessReasons ?? [],
    missingInputs: seed.missingInputs ?? [],
    recommendedNextAction:
      seed.recommendedNextAction ?? 'Generate the focused shape-spec for this story.',
    traceabilitySummary:
      seed.traceabilitySummary ??
      'Derived deterministically from the DB migration pack manifest.',
    ...(seed.architectureReferences ? { architectureReferences: seed.architectureReferences } : {}),
    ...(seed.discoveryFindingReferences
      ? { discoveryFindingReferences: seed.discoveryFindingReferences }
      : {}),
  };
  return { ...item, ...(seed.extras ?? {}) } as MigrationBookOfWorkItem;
}

/** Bounded human list: "a, b, c (+N more)". */
function boundedList(values: string[], max = 10): string {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')} (+${values.length - max} more)`;
}

const TRANSLATION_KIND_LABELS: Record<string, string> = {
  stored_procedure: 'stored procedures',
  trigger: 'triggers',
  view: 'views',
  scheduled_job: 'scheduled jobs',
};

/** The marker tag Spec C's verbatim-carriage keys on (scaffold precedent). */
export const SEED_DB_PACK_FILES_TAG = 'seed_db_pack_files';

/** Tag carried by every deterministically pack-derived item. */
export const PACK_PROVENANCE_TAG = 'provenance:pack';

/** Tag carried by prerequisite items when the pack could not be generated. */
export const PREREQUISITE_PROVENANCE_TAG = 'provenance:prerequisite';

// ---------------------------------------------------------------------------
// Phase 1 — deterministic skeleton per DB stream
// ---------------------------------------------------------------------------

export interface BuildDbStreamSkeletonArgs {
  stream: 'target_database_schema_implementation' | 'data_migration';
  packView: PackView | null;
  /** The plan-time ensure outcome (null when the ensure step did not run). */
  ensureOutcome: EnsurePackOutcome | null;
  clusterCap: number;
}

/**
 * Build the story-less phase-1 skeleton for ONE DB stream. Self-contained
 * hierarchy (assembly namespaces ids per stream), every epic later expanding
 * deterministically. When the pack is unavailable the skeleton is a single
 * PREREQUISITE epic — never an LLM guess.
 */
export function buildDbStreamSkeleton(
  args: BuildDbStreamSkeletonArgs
): GeneratedMigrationBookOfWork {
  const { stream, packView, ensureOutcome, clusterCap } = args;
  const items: MigrationBookOfWorkItem[] = [];
  let seq = 0;
  const next = () => ++seq;
  const ws = stream as MigrationBookOfWorkWorkstream;

  const packMeta = packView
    ? {
        generationMode: 'deterministic-db-pack',
        packId: packView.packId,
        inputSnapshotHash: packView.inputSnapshotHash,
      }
    : {
        generationMode: 'deterministic-db-pack-prerequisite',
        packEnsureStatus: ensureOutcome?.status ?? 'unknown',
        packEnsureReason: ensureOutcome?.reason ?? null,
      };

  if (!packView) {
    // ----- Prerequisite skeleton: the pack could not be generated. -----
    const reason =
      ensureOutcome?.reason ??
      'DB migration pack unavailable (not generated and not generatable)';
    const initId = `${stream}-init`;
    const epicId = `${stream}-epic-prereq`;
    const featureId = `${stream}-f-prereq`;
    items.push(
      mkItem({
        id: initId,
        type: 'initiative',
        parentId: null,
        title:
          stream === 'data_migration'
            ? 'Persistence tier migration — data'
            : 'Persistence tier migration — schema & DB code',
        description: 'Blocked pending the DB migration pack prerequisites.',
        workstream: ws,
        sequenceOrder: next(),
        confidence: 'low',
        readiness: 'blocked',
        readinessReasons: [reason],
        missingInputs: [reason],
        tags: [PREREQUISITE_PROVENANCE_TAG],
        recommendedNextAction:
          'Resolve the pack prerequisites (capture db.engine in the target conversation; promote the discovered schema), then regenerate the plan.',
        traceabilitySummary: `Deterministic prerequisite skeleton — pack ensure outcome: ${ensureOutcome?.status ?? 'unknown'}.`,
      }),
      mkItem({
        id: epicId,
        type: 'epic',
        parentId: initId,
        title: 'DB migration pack prerequisites',
        description: 'Establish the inputs the deterministic pack needs.',
        workstream: ws,
        sequenceOrder: next(),
        confidence: 'low',
        readiness: 'blocked',
        readinessReasons: [reason],
        missingInputs: [reason],
        tags: [PREREQUISITE_PROVENANCE_TAG],
        extras: { dbPrereqReason: reason },
      }),
      mkItem({
        id: featureId,
        type: 'feature',
        parentId: epicId,
        title: 'Unblock pack generation',
        description: 'Prerequisite work items (expanded deterministically).',
        workstream: ws,
        sequenceOrder: next(),
        confidence: 'low',
        readiness: 'blocked',
        readinessReasons: [reason],
        tags: [PREREQUISITE_PROVENANCE_TAG],
        extras: { dbFeatureKind: 'prerequisites' },
      })
    );
    return assembleSkeleton(stream, items, packMeta, 'low');
  }

  const manifest = packView.manifest;
  const clusters = clusterMechanicalTables(manifest, clusterCap);
  const flagged = [...flaggedTableSet(manifest)].sort((a, b) => a.localeCompare(b));
  const sourceEngine = manifest.source_engine ?? 'source engine';
  const targetEngine = manifest.target_engine ?? 'target engine';
  const baseTags = [PACK_PROVENANCE_TAG, `pack:${packView.packId}`];

  if (stream === 'target_database_schema_implementation') {
    const initId = `${stream}-init`;
    items.push(
      mkItem({
        id: initId,
        type: 'initiative',
        parentId: null,
        title: `Persistence tier migration — schema & DB code (${sourceEngine} → ${targetEngine})`,
        description: `Build the ${targetEngine} schema and translate DB code objects from the deterministic migration pack.`,
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        traceabilitySummary: `Pack ${packView.packId}: ${manifest.coverage?.translated_count ?? 0} translated, ${manifest.coverage?.skipped_count ?? 0} skipped, ${manifest.coverage?.flagged_count ?? 0} flagged objects.`,
      })
    );

    // Epic 1 — build the target schema.
    const schemaEpicId = `${stream}-epic-schema`;
    items.push(
      mkItem({
        id: schemaEpicId,
        type: 'epic',
        parentId: initId,
        title: `Build target schema (${targetEngine})`,
        description: `Apply the pack's Liquibase changesets: foundations, ${clusters.length} mechanical table clusters, ${flagged.length} exceptional tables, constraints & indexes.`,
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
      }),
      mkItem({
        id: `${stream}-f-foundations`,
        type: 'feature',
        parentId: schemaEpicId,
        title: 'Schema foundations',
        description: 'Master changelog, schema creation, extensions.',
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: { dbFeatureKind: 'foundations' },
      })
    );
    for (const cluster of clusters) {
      items.push(
        mkItem({
          id: `${stream}-f-cluster-${cluster.index}`,
          type: 'feature',
          parentId: schemaEpicId,
          title: `Table cluster ${cluster.index + 1} — ${cluster.tables.length} tables (dependency layer ${cluster.layer})`,
          description: boundedList(cluster.tables),
          workstream: ws,
          sequenceOrder: next(),
          tags: baseTags,
          extras: {
            dbFeatureKind: 'cluster',
            dbClusterIndex: cluster.index,
            dbClusterLayer: cluster.layer,
            dbClusterTables: cluster.tables,
          },
        })
      );
    }
    if (flagged.length > 0) {
      items.push(
        mkItem({
          id: `${stream}-f-exceptional`,
          type: 'feature',
          parentId: schemaEpicId,
          title: `Exceptional tables (${flagged.length})`,
          description: `Tables carrying open pack decisions or hazards: ${boundedList(flagged)}.`,
          workstream: ws,
          sequenceOrder: next(),
          readiness: 'needs_user_decision',
          readinessReasons: ['Open pack decisions attach to these tables.'],
          tags: baseTags,
          extras: { dbFeatureKind: 'exceptional' },
        })
      );
    }
    items.push(
      mkItem({
        id: `${stream}-f-constraints`,
        type: 'feature',
        parentId: schemaEpicId,
        title: 'Constraints, indexes & sequence seeding changesets',
        description: 'Post-load FK/index changesets and the sequence-seed changeset.',
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: { dbFeatureKind: 'constraints' },
      })
    );

    // Epic 2 — DB code objects (only when the manifest lists any).
    const translationEntries = [
      ...(manifest.requires_translation_spec_2 ?? []),
      ...(manifest.manual_recreation ?? []),
    ];
    if (translationEntries.length > 0) {
      const codeEpicId = `${stream}-epic-code`;
      items.push(
        mkItem({
          id: codeEpicId,
          type: 'epic',
          parentId: initId,
          title: 'Translate DB code objects',
          description: `Review, approve, and apply translations for ${translationEntries.length} DB code objects (procs / triggers / views / jobs).`,
          workstream: ws,
          sequenceOrder: next(),
          tags: baseTags,
        })
      );
      const kinds = new Set(translationEntries.map((e) => e.kind));
      for (const kind of ['stored_procedure', 'trigger', 'view', 'scheduled_job']) {
        if (!kinds.has(kind)) continue;
        const count = translationEntries.filter((e) => e.kind === kind).length;
        items.push(
          mkItem({
            id: `${stream}-f-${kind}`,
            type: 'feature',
            parentId: codeEpicId,
            title: `${TRANSLATION_KIND_LABELS[kind] ?? kind} (${count})`,
            description: `Translation review + build for ${count} ${TRANSLATION_KIND_LABELS[kind] ?? kind}.`,
            workstream: ws,
            sequenceOrder: next(),
            tags: baseTags,
            extras: { dbFeatureKind: 'translation', dbTranslationKind: kind },
          })
        );
      }
    }
    return assembleSkeleton(stream, items, packMeta, 'high');
  }

  // ----- stream === 'data_migration' -----
  const initId = `${stream}-init`;
  const loadEpicId = `${stream}-epic-load`;
  const cutoverEpicId = `${stream}-epic-cutover`;
  const strategies = manifest.delta_strategies ?? [];
  const needsDecision = strategies.filter((s) => s.strategy === 'needs_decision');
  const jobs = (manifest.manual_recreation ?? []).filter((e) => e.kind === 'scheduled_job');

  items.push(
    mkItem({
      id: initId,
      type: 'initiative',
      parentId: null,
      title: `Persistence tier migration — data (${sourceEngine} → ${targetEngine})`,
      description:
        'One-way side-by-side data migration: weekend bulk load, daily incremental sync, reconciliation, then swap-over.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
    }),
    mkItem({
      id: loadEpicId,
      type: 'epic',
      parentId: initId,
      title: 'Data migration (bulk + incremental)',
      description: `Initial bulk load in FK order, per-table incremental top-ups (${strategies.length} strategies, ${needsDecision.length} needing a delta-key decision), per-run reconciliation.`,
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
    }),
    mkItem({
      id: `${stream}-f-bulk`,
      type: 'feature',
      parentId: loadEpicId,
      title: 'Initial bulk load',
      description: 'Ordered extract → COPY pipeline for all translated tables.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'bulk' },
    }),
    mkItem({
      id: `${stream}-f-incremental`,
      type: 'feature',
      parentId: loadEpicId,
      title: 'Daily incremental sync',
      description: 'Strategy-grouped delta top-ups until swap-over.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'incremental' },
    }),
    mkItem({
      id: `${stream}-f-reconciliation`,
      type: 'feature',
      parentId: loadEpicId,
      title: 'Reconciliation',
      description: 'Per-run row-count/checksum comparison and report.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'reconciliation' },
    }),
    mkItem({
      id: cutoverEpicId,
      type: 'epic',
      parentId: initId,
      title: 'Persistence cutover & seeding',
      description:
        'Final delta, sequence/identity seeding above high-water, DB job re-homing, and post-swap verification.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
    }),
    mkItem({
      id: `${stream}-f-final-delta`,
      type: 'feature',
      parentId: cutoverEpicId,
      title: 'Final delta at swap-over',
      description: 'Last incremental sync inside the cutover window.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'final-delta' },
    }),
    mkItem({
      id: `${stream}-f-seeding`,
      type: 'feature',
      parentId: cutoverEpicId,
      title: 'Sequence & identity seeding',
      description: 'Seed sequences/identities above source high-water at swap-over.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'seeding' },
    })
  );
  if (jobs.length > 0) {
    items.push(
      mkItem({
        id: `${stream}-f-jobs`,
        type: 'feature',
        parentId: cutoverEpicId,
        title: `Re-home DB-resident scheduled jobs (${jobs.length})`,
        description: boundedList(jobs.map((j) => j.object_ref)),
        workstream: ws,
        sequenceOrder: next(),
        tags: baseTags,
        extras: { dbFeatureKind: 'jobs' },
      })
    );
  }
  items.push(
    mkItem({
      id: `${stream}-f-verify`,
      type: 'feature',
      parentId: cutoverEpicId,
      title: 'Post-swap verification',
      description: 'Expected-schema diff green + final reconciliation clean.',
      workstream: ws,
      sequenceOrder: next(),
      tags: baseTags,
      extras: { dbFeatureKind: 'verify' },
    })
  );
  return assembleSkeleton(stream, items, packMeta, 'high');
}

function assembleSkeleton(
  stream: string,
  items: MigrationBookOfWorkItem[],
  generationInputs: Record<string, unknown>,
  score: 'high' | 'low'
): GeneratedMigrationBookOfWork {
  const countsByType: Record<string, number> = {};
  for (const item of items) {
    countsByType[item.type] = (countsByType[item.type] ?? 0) + 1;
  }
  return {
    title: `Deterministic DB skeleton — ${stream}`,
    summary:
      score === 'high'
        ? `Deterministic pack-derived skeleton for ${stream} (${items.length} items).`
        : `Prerequisite skeleton for ${stream} — the DB migration pack is unavailable.`,
    generationInputs,
    generationSummary: { totalItems: items.length, countsByType },
    qualityAssessment: {
      overall: {
        score,
        rationale:
          score === 'high'
            ? 'Derived deterministically from the DB migration pack manifest (no LLM).'
            : 'Pack unavailable — prerequisite structure only.',
      },
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — deterministic story expansion for DB epics
// ---------------------------------------------------------------------------

export interface BuildDbEpicStoriesArgs {
  epic: MigrationBookOfWorkItem;
  features: MigrationBookOfWorkItem[];
  stream: string;
  packView: PackView | null;
  ensureOutcome: EnsurePackOutcome | null;
  clusterCap: number;
  /** Global max sequenceOrder in the book (stories are appended after). */
  maxSequence: number;
}

type FeatureExtras = MigrationBookOfWorkItem & {
  dbFeatureKind?: string;
  dbClusterIndex?: number;
  dbClusterTables?: string[];
  dbTranslationKind?: string;
  dbPrereqReason?: string;
};

function featureOfKind(
  features: MigrationBookOfWorkItem[],
  kind: string
): FeatureExtras | null {
  return (
    (features as FeatureExtras[]).find((f) => f.dbFeatureKind === kind) ?? null
  );
}

/**
 * Expand ONE DB epic into deterministic stories. Throws (→ epic `failed`,
 * retryable) on coverage violations or a skeleton/manifest cluster mismatch
 * ("pack changed since plan creation — regenerate the plan").
 */
export function buildDbEpicStories(args: BuildDbEpicStoriesArgs): MigrationBookOfWorkItem[] {
  const { epic, features, stream, packView, ensureOutcome, clusterCap } = args;
  let seq = args.maxSequence;
  const next = () => ++seq;
  const ws = epic.workstream as MigrationBookOfWorkWorkstream;
  const stories: MigrationBookOfWorkItem[] = [];

  // ----- Prerequisite epic (pack unavailable at plan OR expansion time) -----
  const prereqFeature = featureOfKind(features, 'prerequisites');
  if (prereqFeature || !packView) {
    const parent = prereqFeature ?? (features[0] as FeatureExtras);
    if (!parent) {
      throw new Error(`DB epic ${epic.id} has no feature to parent prerequisite stories to`);
    }
    const reason =
      (prereqFeature?.dbPrereqReason as string | undefined) ??
      ensureOutcome?.reason ??
      'DB migration pack unavailable';
    const wantsEngineDecision = /db\.engine/i.test(reason);
    stories.push(
      mkItem({
        id: `${epic.id}-s-prereq-pack`,
        type: 'story',
        parentId: parent.id,
        title: 'Generate the DB migration pack',
        description: `The deterministic DB migration pack could not be generated: ${reason}. The persistence-tier plan is generated FROM the pack; unblock it and regenerate the plan.`,
        workstream: ws,
        sequenceOrder: next(),
        confidence: 'high',
        readiness: 'blocked',
        readinessReasons: [reason],
        missingInputs: [reason],
        recommendedNextAction: wantsEngineDecision
          ? 'Run the target-state architect conversation and capture db.engine (and the db.* policy questions), then regenerate the migration plan.'
          : 'Resolve the pack generation failure (see reason), then regenerate the migration plan.',
        traceabilitySummary: `Prerequisite story — pack ensure outcome ${ensureOutcome?.status ?? 'unknown'}.`,
        tags: [PREREQUISITE_PROVENANCE_TAG, `stream:${stream}`],
      })
    );
    if (wantsEngineDecision) {
      stories.push(
        mkItem({
          id: `${epic.id}-s-prereq-schema`,
          type: 'story',
          parentId: parent.id,
          title: 'Confirm the discovered schema is promoted into the Data domain',
          description:
            'The pack builds its source-schema IR from the COMMITTED physical model plus findings. Review the database discovery run and promote tables/views/columns/relationships before regenerating.',
          workstream: ws,
          sequenceOrder: next(),
          confidence: 'high',
          readiness: 'blocked',
          readinessReasons: ['Pack prerequisites unresolved.'],
          recommendedNextAction:
            'Open the database discovery run, promote the schema candidates, accept the deep-detail findings.',
          tags: [PREREQUISITE_PROVENANCE_TAG, `stream:${stream}`],
        })
      );
    }
    return stories;
  }

  const manifest = packView.manifest;
  const packTags = [PACK_PROVENANCE_TAG, `pack:${packView.packId}`, `stream:${stream}`];
  const openDecisionsByRef = new Map<string, PackDecisionRow[]>();
  for (const decision of packView.decisions) {
    if (decision.status !== 'open') continue;
    const parts = (decision.object_ref ?? '').split('.');
    const tableRef = parts.length >= 2 ? lc(parts.slice(0, 2).join('.')) : lc(decision.object_ref);
    const list = openDecisionsByRef.get(tableRef) ?? [];
    list.push(decision);
    openDecisionsByRef.set(tableRef, list);
  }

  // =========================================================================
  // Epic: Build target schema
  // =========================================================================
  if (featureOfKind(features, 'foundations') || featureOfKind(features, 'cluster')) {
    const clusters = clusterMechanicalTables(manifest, clusterCap);
    const flagged = [...flaggedTableSet(manifest)].sort((a, b) => a.localeCompare(b));
    const byTable = coverageByTable(manifest);

    // Foundations story (carries master changelog + schemas changeset).
    const foundations = featureOfKind(features, 'foundations');
    if (foundations) {
      stories.push(
        mkItem({
          id: `${epic.id}-s-foundations`,
          type: 'story',
          parentId: foundations.id,
          title: `Seed the ${manifest.target_engine ?? 'target'} schema foundations from the pack`,
          description:
            'Write the pack master changelog, schema-creation changeset, and BOTH manifests ' +
            '(manifest.json + the bulk-load manifest) verbatim into the target repo and wire ' +
            'the Liquibase run (structural context first, post-load context after the bulk load). ' +
            'The manifests are REQUIRED runtime inputs for the data-migration and parity runners.',
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            'The pack files are reproduced byte-for-byte at their pack-relative paths.',
            'manifest.json and the bulk-load manifest are committed with the changelog — the data tier cannot run without them.',
            'Liquibase applies the structural context cleanly against an empty target database.',
          ],
          tags: [...packTags, SEED_DB_PACK_FILES_TAG],
          traceabilitySummary: `Carries pack ${packView.packId} foundations files verbatim.`,
          extras: {
            packId: packView.packId,
            // 2026-07-31 (live: the data runner's required manifest.json was
            // never committed to ANY branch): the foundations story carries
            // the manifests too, not just the changelog files.
            packFilePaths: [
              MASTER_CHANGELOG_PATH,
              SCHEMAS_CHANGESET_PATH,
              'manifest.json',
              BULK_LOAD_MANIFEST_PATH,
            ],
          },
        })
      );
    }

    // One story per mechanical cluster. Skeleton/manifest drift is FAILED
    // loudly, never silently re-shaped.
    const clusterFeatures = (features as FeatureExtras[]).filter(
      (f) => f.dbFeatureKind === 'cluster'
    );
    if (clusterFeatures.length !== clusters.length) {
      throw new Error(
        `DB epic ${epic.id}: pack manifest now yields ${clusters.length} table clusters but the plan skeleton has ${clusterFeatures.length} cluster features — the pack changed since plan creation; regenerate the migration plan.`
      );
    }
    for (const cluster of clusters) {
      const feature = clusterFeatures.find(
        (f) => f.dbClusterIndex === cluster.index
      );
      if (!feature) {
        throw new Error(
          `DB epic ${epic.id}: no skeleton feature for table cluster ${cluster.index} — regenerate the migration plan.`
        );
      }
      const filePaths = cluster.tables.map((t) => {
        const [schemaName, tableName] = t.split('.');
        return tableChangesetPath({ schemaName, tableName } as IrTable);
      });
      stories.push(
        mkItem({
          id: `${epic.id}-s-cluster-${cluster.index}`,
          type: 'story',
          parentId: feature.id,
          title: `Apply schema changesets — cluster ${cluster.index + 1} (${cluster.tables.length} tables, layer ${cluster.layer})`,
          description: `Reproduce the pack's per-table changesets verbatim for: ${boundedList(cluster.tables)}.`,
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            `All ${cluster.tables.length} table changesets apply cleanly in the structural context.`,
            "The pack's expected-schema diff is green for every table in this cluster.",
          ],
          tags: [...packTags, SEED_DB_PACK_FILES_TAG, `db_cluster:${cluster.index}`],
          traceabilitySummary: `Stamped from pack ${packView.packId} manifest — mechanical (unflagged) tables, FK dependency layer ${cluster.layer}.`,
          extras: {
            packId: packView.packId,
            packFilePaths: filePaths,
            dbClusterIndex: cluster.index,
            dbClusterTables: cluster.tables,
          },
        })
      );
    }

    // One story per exceptional (flagged) table.
    const exceptional = featureOfKind(features, 'exceptional');
    if (flagged.length > 0 && !exceptional) {
      throw new Error(
        `DB epic ${epic.id}: manifest has ${flagged.length} flagged tables but the skeleton has no exceptional feature — regenerate the migration plan.`
      );
    }
    for (const table of flagged) {
      const entries = byTable.get(table) ?? [];
      const decisionKeys = [
        ...new Set(
          entries.flatMap((e) => e.decisionKeys ?? []).concat(
            (openDecisionsByRef.get(table) ?? []).map((d) => d.decision_key)
          )
        ),
      ].sort((a, b) => a.localeCompare(b));
      const findingIds = [
        ...new Set(entries.flatMap((e) => e.provenance?.findingIds ?? [])),
      ];
      const entityIds = [
        ...new Set(entries.map((e) => e.provenance?.entityId).filter((v): v is string => !!v)),
      ];
      const open = decisionKeys.length > 0;
      const [schemaName, tableName] = table.split('.');
      stories.push(
        mkItem({
          id: `${epic.id}-s-table-${table.replace(/[^a-z0-9]+/gi, '-')}`,
          type: 'story',
          parentId: (exceptional as FeatureExtras).id,
          title: `Migrate table ${table} (flagged)`,
          description: `This table carries pack decision(s): ${boundedList(decisionKeys, 6) || 'see pack decision queue'}. Resolve the decision(s), regenerate the pack, then apply its changeset verbatim.`,
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            'Every pack decision for this table is resolved and reflected in a regenerated changeset.',
            "The pack's expected-schema diff is green for this table.",
          ],
          confidence: 'high',
          readiness: open ? 'needs_user_decision' : 'needs_focused_context',
          readinessReasons: open
            ? decisionKeys.map((k) => `Open pack decision: ${k}`)
            : ['Flagged in the pack coverage ledger.'],
          missingInputs: decisionKeys,
          recommendedNextAction:
            'Resolve the pack decision(s) on the Schema migration tab, regenerate the pack, then spec this story.',
          traceabilitySummary: `Pack ${packView.packId} coverage: flagged. Decisions: ${decisionKeys.join(', ') || 'n/a'}.`,
          tags: [...packTags, SEED_DB_PACK_FILES_TAG, 'db_exceptional'],
          architectureReferences: entityIds,
          discoveryFindingReferences: findingIds,
          extras: {
            packId: packView.packId,
            packFilePaths: [tableChangesetPath({ schemaName, tableName } as IrTable)],
            packDecisionKeys: decisionKeys,
          },
        })
      );
    }

    // Constraints / indexes / sequence-seed changesets story.
    const constraints = featureOfKind(features, 'constraints');
    if (constraints) {
      stories.push(
        mkItem({
          id: `${epic.id}-s-constraints`,
          type: 'story',
          parentId: constraints.id,
          title: 'Apply post-load constraints, indexes and sequence-seed changesets',
          description:
            'Reproduce the consolidated FK, index, and sequence-seed changesets verbatim; they run in the post-load Liquibase context AFTER the bulk load.',
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            'FK + index changesets apply cleanly after a bulk load.',
            'Sequence-seed changeset seeds every sequence/identity above the recorded high-water mark.',
          ],
          tags: [...packTags, SEED_DB_PACK_FILES_TAG],
          traceabilitySummary: `Carries pack ${packView.packId} post-load changesets verbatim.`,
          extras: {
            packId: packView.packId,
            packFilePaths: [
              FOREIGN_KEYS_CHANGESET_PATH,
              INDEXES_CHANGESET_PATH,
              SEQUENCES_SEED_CHANGESET_PATH,
            ],
          },
        })
      );
    }

    // Code-guarantee: every translated/flagged manifest table landed exactly once.
    const covered = new Set<string>();
    for (const cluster of clusters) cluster.tables.forEach((t) => covered.add(lc(t)));
    flagged.forEach((t) => covered.add(lc(t)));
    const expected = new Set(orderedTables(manifest).map(lc));
    const missing = [...expected].filter((t) => !covered.has(t));
    const extras = [...covered].filter((t) => !expected.has(t));
    if (missing.length > 0 || extras.length > 0) {
      throw new Error(
        `DB schema story coverage check failed for epic ${epic.id}: ` +
          `${missing.length > 0 ? `missing [${missing.join(', ')}]` : ''}` +
          `${extras.length > 0 ? ` extra [${extras.join(', ')}]` : ''}`.trim()
      );
    }
  }

  // =========================================================================
  // Epic: Translate DB code objects
  // =========================================================================
  const translationFeatures = (features as FeatureExtras[]).filter(
    (f) => f.dbFeatureKind === 'translation'
  );
  for (const feature of translationFeatures) {
    const kind = feature.dbTranslationKind ?? 'stored_procedure';
    const label = TRANSLATION_KIND_LABELS[kind] ?? kind;
    const rows = packView.translations.filter((t) => t.kind === kind);
    const manifestEntries = [
      ...(manifest.requires_translation_spec_2 ?? []),
      ...(manifest.manual_recreation ?? []),
    ].filter((e) => e.kind === kind);
    const total = rows.length > 0 ? rows.length : manifestEntries.length;
    const unapproved = rows.filter(
      (t) =>
        t.disposition === 'translate' &&
        (t.review_status === 'unreviewed' || t.review_status === 'needs_rework')
    );
    const approved = rows.filter(
      (t) => t.disposition === 'translate' && t.review_status === 'approved'
    );
    const rewrites = rows.filter((t) => t.disposition === 'rewrite_in_app');

    if (kind === 'scheduled_job') {
      // Jobs are never SQL-translated — they re-home per db.jobsRehoming.
      stories.push(
        mkItem({
          id: `${epic.id}-s-jobs-rehome`,
          type: 'story',
          parentId: feature.id,
          title: `Re-home ${total} DB-resident scheduled job(s)`,
          description: `[decision:db.jobsRehoming] Recreate the source scheduled jobs on the target per the captured jobs re-homing decision: ${boundedList(manifestEntries.map((e) => e.object_ref))}.`,
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            'Every source job has a target home (pg_cron / external scheduler / application) or a recorded decommission decision.',
          ],
          readiness: 'needs_focused_context',
          readinessReasons: ['Job definitions live in findings; per-job schedules need review.'],
          recommendedNextAction:
            'Review each job finding and spec its target home per the db.jobsRehoming decision.',
          tags: packTags,
          traceabilitySummary: `Pack ${packView.packId} manifest lists ${total} DB-resident scheduled job(s).`,
        })
      );
      continue;
    }

    // 1) Review workload story (needs_user_decision while drafts unapproved).
    stories.push(
      mkItem({
        id: `${epic.id}-s-${kind}-review`,
        type: 'story',
        parentId: feature.id,
        title: `Review & approve ${label} translation drafts (${unapproved.length} of ${total} outstanding)`,
        description: `Work the pack's translation queue for ${label}: review each LLM-drafted ${label.replace(/s$/, '')} translation against its verbatim source body and approve, rework, or re-disposition it.`,
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          `Every ${label.replace(/s$/, '')} translation is approved, rejected with a disposition, or re-dispositioned.`,
        ],
        readiness: unapproved.length > 0 ? 'needs_user_decision' : 'ready_for_spec',
        readinessReasons:
          unapproved.length > 0
            ? [`${unapproved.length} unapproved translation draft(s).`]
            : [],
        recommendedNextAction:
          unapproved.length > 0
            ? 'Open the Schema migration tab → Translations and review the outstanding drafts.'
            : 'Generate the focused shape-spec for this story.',
        tags: packTags,
        traceabilitySummary: `Pack ${packView.packId}: ${total} ${label}, ${approved.length} approved, ${unapproved.length} outstanding.`,
      })
    );

    // 2) Apply-approved story (carries emitted translation files when present).
    const approvedFiles = (manifest.translations?.approved_objects ?? [])
      .filter((o) => o.kind === kind)
      .map((o) => o.file_path);
    stories.push(
      mkItem({
        id: `${epic.id}-s-${kind}-apply`,
        type: 'story',
        parentId: feature.id,
        title: `Apply approved ${label} translations (${approved.length} approved)`,
        description: `Reproduce the approved ${label} translation files verbatim in the target repo and wire them into the migration run.`,
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          `Every APPROVED ${label.replace(/s$/, '')} translation is applied byte-for-byte; unapproved objects are NEVER applied.`,
        ],
        // Readiness is gated on the CARRIABLE condition — emitted files present
        // (the same condition that stamps the carriage tag below), NOT on the
        // approval count. Phase 0 alignment fix (2026-07-20): approvals without
        // emitted files previously predicted ready_for_spec yet fell through to
        // the LLM resolver and surfaced as generic "insufficient context".
        readiness: approvedFiles.length > 0 ? 'ready_for_spec' : 'blocked',
        readinessReasons:
          approvedFiles.length > 0
            ? []
            : approved.length > 0
              ? [
                  `${approved.length} approved ${label} translation(s) have no emitted files yet — regenerate the pack to emit them.`,
                ]
              : [`No approved ${label} translations yet.`],
        tags: [...packTags, ...(approvedFiles.length > 0 ? [SEED_DB_PACK_FILES_TAG] : [])],
        traceabilitySummary: `Pack ${packView.packId} approved-translation emission (${approvedFiles.length} file(s)).`,
        extras: {
          packId: packView.packId,
          ...(approvedFiles.length > 0 ? { packFilePaths: approvedFiles } : {}),
        },
      })
    );

    // 3) Individual stories for rewrite-in-app objects (service-tier work).
    for (const row of rewrites) {
      stories.push(
        mkItem({
          id: `${epic.id}-s-rewrite-${row.translation_key.replace(/[^a-z0-9]+/gi, '-')}`,
          type: 'story',
          parentId: feature.id,
          title: `Rewrite ${row.object_ref} in the application`,
          description: `The ${label.replace(/s$/, '')} ${row.object_ref} was dispositioned rewrite-in-app: its logic moves into the target service tier instead of PL/pgSQL.`,
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria: [
            `${row.object_ref} behaviour is reproduced in the application layer with test coverage.`,
          ],
          readiness: 'needs_focused_context',
          readinessReasons: ['Rewrite-in-app requires source body + call-site analysis.'],
          tags: [...packTags, 'rewrite_in_app'],
          traceabilitySummary: `Pack ${packView.packId} translation ${row.translation_key} disposition=rewrite_in_app.`,
        })
      );
    }
  }

  // =========================================================================
  // Epic: Data migration (bulk + incremental + reconciliation)
  // =========================================================================
  const bulk = featureOfKind(features, 'bulk');
  if (bulk) {
    const tables = orderedTables(manifest);
    const rowCounts = manifest.bulk_load?.expected_row_counts ?? {};
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + (b ?? 0), 0);
    stories.push(
      mkItem({
        id: `${epic.id}-s-bulk-load`,
        type: 'story',
        parentId: bulk.id,
        title: `Build the initial bulk load (${tables.length} tables, ~${totalRows.toLocaleString('en-GB')} rows)`,
        description:
          'Implement the weekend bulk load from the pack scripts: FK-ordered extract from the source, staged files, COPY into the target, structural changesets before, post-load changesets after.',
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          'Bulk load completes in FK-topological order using the pack scripts verbatim.',
          'Per-table loaded row counts match the expected source counts in the bulk-load manifest.',
        ],
        tags: [...packTags, SEED_DB_PACK_FILES_TAG],
        traceabilitySummary: `Pack ${packView.packId} bulk scripts + bulk-load-manifest.json.`,
        extras: {
          packId: packView.packId,
          packFilePaths: ['data/bulk-load-manifest.json'],
          packFilePathPrefixes: ['data/bulk/'],
        },
      })
    );
  }

  const incremental = featureOfKind(features, 'incremental');
  if (incremental) {
    const strategies = manifest.delta_strategies ?? [];
    const groups: Array<{
      key: DeltaStrategy['strategy'];
      label: string;
      readiness: MigrationBookOfWorkItem['readiness'];
    }> = [
      { key: 'insert_only', label: 'insert-only (identity delta key)', readiness: 'ready_for_spec' },
      { key: 'insert_update', label: 'insert+update (timestamp delta key)', readiness: 'ready_for_spec' },
      { key: 'full_reload', label: 'full-reload (no delta key)', readiness: 'ready_for_spec' },
      { key: 'needs_decision', label: 'needing a delta-key decision', readiness: 'needs_user_decision' },
    ];
    for (const group of groups) {
      const members = strategies.filter((s) => s.strategy === group.key);
      if (members.length === 0) continue;
      const memberTables = members.map((m) => m.table);
      stories.push(
        mkItem({
          id: `${epic.id}-s-incr-${group.key}`,
          type: 'story',
          parentId: incremental.id,
          title: `Daily incremental sync — ${members.length} ${group.label} table(s)`,
          description: `Implement the daily one-way top-up for: ${boundedList(memberTables)}.`,
          workstream: ws,
          sequenceOrder: next(),
          acceptanceCriteria:
            group.key === 'needs_decision'
              ? ['Every table has a resolved delta-key decision before sync work is specced.']
              : [
                  'Each run applies only rows changed since the recorded high-water mark.',
                  'The run is idempotent — re-running with no source changes applies nothing.',
                ],
          readiness: group.readiness,
          readinessReasons:
            group.key === 'needs_decision'
              ? memberTables.map((t) => `Open delta-key decision for ${t}`)
              : [],
          missingInputs:
            group.key === 'needs_decision'
              ? members.map((m) => `delta_key--${m.table}`)
              : [],
          recommendedNextAction:
            group.key === 'needs_decision'
              ? 'Resolve the delta-key decisions on the Schema migration tab, regenerate the pack, then spec this story.'
              : 'Generate the focused shape-spec for this story.',
          tags: [...packTags, ...(group.key !== 'needs_decision' ? [SEED_DB_PACK_FILES_TAG] : [])],
          traceabilitySummary: `Pack ${packView.packId} delta strategies (${group.key}).`,
          extras: {
            packId: packView.packId,
            ...(group.key !== 'needs_decision'
              ? {
                  // Spec 2026-07-02-d: the daily sync is an OPERABLE capability —
                  // every keyed/full-reload group carries the shared runner +
                  // high-water state DDL alongside its per-table delta scripts.
                  packFilePaths: [
                    SYNC_STATE_PATH,
                    SYNC_RUNNER_PATH,
                    ...memberTables.map((t) => `data/incremental/${t}.sql`),
                  ],
                }
              : {}),
            dbDeltaTables: memberTables,
          },
        })
      );
    }
  }

  const reconciliation = featureOfKind(features, 'reconciliation');
  if (reconciliation) {
    stories.push(
      mkItem({
        id: `${epic.id}-s-reconciliation`,
        type: 'story',
        parentId: reconciliation.id,
        title: 'Build the per-run reconciliation report',
        description:
          'After every bulk/incremental run, compare per-table row counts (and max delta keys where a key exists) between source and target and produce a drift report; a drift exit gates the swap.',
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          'Every sync run emits a per-table reconciliation report.',
          'A non-zero drift is visible without opening logs and exits non-zero (gateable).',
        ],
        tags: [...packTags, SEED_DB_PACK_FILES_TAG],
        traceabilitySummary: `Carries pack ${packView.packId} reconciliation artefacts verbatim.`,
        extras: {
          packId: packView.packId,
          packFilePaths: [RECONCILIATION_SQL_PATH, RECONCILIATION_REPORT_PATH],
        },
      })
    );
  }

  // =========================================================================
  // Epic: Persistence cutover & seeding
  // =========================================================================
  const finalDelta = featureOfKind(features, 'final-delta');
  if (finalDelta) {
    stories.push(
      mkItem({
        id: `${epic.id}-s-final-delta`,
        type: 'story',
        parentId: finalDelta.id,
        title: 'Run the final delta inside the swap-over window',
        description:
          'Freeze source writes, run the last incremental sync, and verify a clean reconciliation before the swap — per the pack swap-over runbook.',
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: ['Final reconciliation shows zero drift before swap-over.'],
        tags: [...packTags, SEED_DB_PACK_FILES_TAG],
        traceabilitySummary: `Carries pack ${packView.packId} swap-over runbook verbatim.`,
        extras: {
          packId: packView.packId,
          packFilePaths: [SWAP_OVER_RUNBOOK_PATH, SYNC_RUNNER_PATH],
        },
      })
    );
  }
  const seeding = featureOfKind(features, 'seeding');
  if (seeding) {
    const sequences: ExpectedSchemaSequence[] = manifest.expected_schema?.sequences ?? [];
    stories.push(
      mkItem({
        id: `${epic.id}-s-seeding`,
        type: 'story',
        parentId: seeding.id,
        title: `Seed ${sequences.length} sequence(s)/identities above source high-water at swap-over`,
        description:
          'Apply the sequence-seed changeset at swap-over (NOT at bulk load — the source keeps advancing during side-by-side running) so the first post-swap INSERT can never collide.',
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          'Every sequence/identity restarts above the source high-water mark plus the pack seed margin.',
        ],
        tags: [...packTags, SEED_DB_PACK_FILES_TAG],
        traceabilitySummary: `Pack ${packView.packId} sequence high-water + seed margin.`,
        extras: {
          packId: packView.packId,
          packFilePaths: [SEQUENCES_SEED_CHANGESET_PATH],
        },
      })
    );
  }
  const jobsFeature = featureOfKind(features, 'jobs');
  if (jobsFeature) {
    const jobs = (manifest.manual_recreation ?? []).filter((e) => e.kind === 'scheduled_job');
    stories.push(
      mkItem({
        id: `${epic.id}-s-jobs-cutover`,
        type: 'story',
        parentId: jobsFeature.id,
        title: `Enable ${jobs.length} re-homed job(s) at swap-over`,
        description: `[decision:db.jobsRehoming] Enable the re-homed jobs on the target and disable the source originals at swap-over: ${boundedList(jobs.map((j) => j.object_ref))}.`,
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: ['No job runs twice (source + target) after swap-over.'],
        tags: packTags,
        traceabilitySummary: `Pack ${packView.packId} manual_recreation scheduled jobs.`,
      })
    );
  }
  const verify = featureOfKind(features, 'verify');
  if (verify) {
    stories.push(
      mkItem({
        id: `${epic.id}-s-verify`,
        type: 'story',
        parentId: verify.id,
        title: 'Post-swap verification: expected-schema diff green + reconciliation clean',
        description:
          "Run the pack's expected-schema diff against the live target and a final reconciliation pass; both must be clean before decommission planning starts.",
        workstream: ws,
        sequenceOrder: next(),
        acceptanceCriteria: [
          'Expected-schema diff reports zero mismatches.',
          'Final reconciliation reports zero drift.',
        ],
        tags: packTags,
        traceabilitySummary: `Pack ${packView.packId} expected_schema baseline.`,
      })
    );
  }

  if (stories.length === 0) {
    throw new Error(
      `DB epic ${epic.id} produced zero deterministic stories — the skeleton features carry no recognised dbFeatureKind markers; regenerate the migration plan.`
    );
  }
  return stories;
}
