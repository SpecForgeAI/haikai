/**
 * Unit tests — deterministic DB plan generation from the migration pack
 * (Spec 2026-07-02-b, Persistence-Tier Oracle Program).
 *
 * The two code guarantees under test:
 *   1. ANTI-EXPLOSION: mechanical tables land in ~(tables/cap) cluster
 *      stories, never one story per table (250 tables ≈ 10 stories).
 *   2. COVERAGE: every manifest table lands in exactly one cluster or
 *      exceptional story, or the builder THROWS (epic failed, retryable).
 */

import {
  buildDbEpicStories,
  buildDbStreamSkeleton,
  clusterMechanicalTables,
  computeTableLayers,
  estimateTableChars,
  flaggedTableSet,
  PackView,
  SEED_DB_PACK_FILES_TAG,
} from '../services/migrationDbPackPlanner';
import type { PackManifest } from '../services/dbMigrationPack/types';
import {
  MigrationBookOfWorkItem,
  validateMigrationBookOfWork,
} from '../services/generatedMigrationBookOfWorkSchema';

// ---------------------------------------------------------------------------
// Fixture manifest — 8 tables, 3 FK layers, one flagged table (dbo.orders)
// ---------------------------------------------------------------------------

function fk(child: string, parent: string) {
  const [cs, ct] = child.split('.');
  const [ps, pt] = parent.split('.');
  return {
    schemaName: cs,
    tableName: ct,
    kind: 'foreign_key' as const,
    name: `fk_${ct}_${pt}`,
    columns: ['id'],
    referencedSchema: ps,
    referencedTable: pt,
    referencedColumns: ['id'],
    onDelete: null,
    onUpdate: null,
    isUnique: false,
    columnDirections: null,
  };
}

function makeManifest(): PackManifest {
  const tables = [
    'dbo.customers',
    'dbo.products',
    'dbo.regions',
    'dbo.audit_log',
    'dbo.orders',
    'dbo.stores',
    'dbo.order_items',
    'dbo.inventory',
  ];
  return {
    manifest_version: 1,
    source_engine: 'sybase_ase',
    target_engine: 'postgresql',
    type_mapping_version: 'v1',
    seed_margin: 1000,
    seed_margin_note: '',
    phase_ordering: [],
    delete_propagation: 'none',
    coverage: {
      translated_count: 7,
      skipped_count: 0,
      flagged_count: 1,
      objects: [
        ...tables
          .filter((t) => t !== 'dbo.orders')
          .map((t) => ({
            objectType: 'table' as const,
            objectRef: t,
            disposition: 'translated' as const,
            provenance: { entityId: `ent-${t}`, findingIds: [] },
          })),
        {
          objectType: 'column' as const,
          objectRef: 'dbo.orders.legacy_ts',
          disposition: 'flagged' as const,
          decisionKeys: ['type_mapping--dbo.orders.legacy_ts'],
          provenance: { entityId: 'ent-dbo.orders', findingIds: ['fnd-ts-1'] },
        },
        {
          objectType: 'table' as const,
          objectRef: 'dbo.orders',
          disposition: 'translated' as const,
          provenance: { entityId: 'ent-dbo.orders', findingIds: [] },
        },
      ],
    },
    requires_translation_spec_2: [
      { kind: 'stored_procedure', object_ref: 'dbo.calc_totals', finding_ids: [] },
      { kind: 'stored_procedure', object_ref: 'dbo.archive_orders', finding_ids: [] },
      { kind: 'trigger', object_ref: 'dbo.trg_orders_audit', finding_ids: [] },
    ],
    manual_recreation: [
      { kind: 'scheduled_job', object_ref: 'dbo.nightly_rollup', finding_ids: [] },
    ],
    cycle_breaks: [],
    cluster_notes: [],
    collation_notes: [],
    delta_strategies: [
      { table: 'dbo.customers', strategy: 'insert_update', deltaKey: 'updated_at', source: 'timestamp_name_heuristic' },
      { table: 'dbo.orders', strategy: 'insert_only', deltaKey: 'order_id', source: 'identity_column' },
      { table: 'dbo.audit_log', strategy: 'needs_decision', deltaKey: null, source: 'none' },
      { table: 'dbo.products', strategy: 'full_reload', deltaKey: null, source: 'none' },
    ],
    bulk_load: {
      table_order: tables,
      expected_row_counts: { 'dbo.customers': 1000, 'dbo.orders': 5000 },
      cast_notes: {},
    },
    expected_schema: {
      tables: tables.map((t) => ({
        schemaName: t.split('.')[0],
        tableName: t.split('.')[1],
      })),
      columns: [],
      keysAndIndexes: [
        fk('dbo.orders', 'dbo.customers'),
        fk('dbo.order_items', 'dbo.orders'),
        fk('dbo.order_items', 'dbo.products'),
        fk('dbo.stores', 'dbo.regions'),
        fk('dbo.inventory', 'dbo.stores'),
        fk('dbo.inventory', 'dbo.products'),
      ],
      sequences: [
        { schemaName: 'dbo', sequenceName: 'orders_seq', restartWith: '6000', ownedByTable: 'orders', ownedByColumn: 'order_id' },
        { schemaName: 'dbo', sequenceName: 'audit_seq', restartWith: '901', ownedByTable: 'audit_log', ownedByColumn: 'id' },
      ],
    },
    translations: {
      approved_count: 1,
      approved_objects: [
        {
          kind: 'stored_procedure',
          object_ref: 'dbo.archive_orders',
          translation_key: 'stored_procedure--dbo.archive_orders',
          file_path: 'translations/stored_procedures/dbo.archive_orders.sql',
          changeset_id: 'cs-1',
          source_body_hash: null,
          reviewed_at: null,
        },
      ],
      note: '',
    },
  };
}

function makePackView(overrides: Partial<PackView> = {}): PackView {
  return {
    packId: 'pack-77',
    status: 'generated',
    inputSnapshotHash: 'hash-77',
    manifest: makeManifest(),
    decisions: [
      {
        decision_key: 'type_mapping--dbo.orders.legacy_ts',
        object_ref: 'dbo.orders.legacy_ts',
        category: 'type_mapping',
        status: 'open',
      },
      {
        decision_key: 'delta_key--dbo.audit_log',
        object_ref: 'dbo.audit_log',
        category: 'delta_key',
        status: 'open',
      },
    ],
    translations: [
      {
        translation_key: 'stored_procedure--dbo.calc_totals',
        object_ref: 'dbo.calc_totals',
        kind: 'stored_procedure',
        disposition: 'translate',
        review_status: 'unreviewed',
      },
      {
        translation_key: 'stored_procedure--dbo.archive_orders',
        object_ref: 'dbo.archive_orders',
        kind: 'stored_procedure',
        disposition: 'translate',
        review_status: 'approved',
      },
      {
        translation_key: 'trigger--dbo.trg_orders_audit',
        object_ref: 'dbo.trg_orders_audit',
        kind: 'trigger',
        disposition: 'rewrite_in_app',
        review_status: 'unreviewed',
      },
    ],
    ...overrides,
  };
}

const SCHEMA_STREAM = 'target_database_schema_implementation' as const;
const DATA_STREAM = 'data_migration' as const;

/** Namespace skeleton items the way assembleBookOfWork does (`<stream>:`). */
function namespaced(
  items: MigrationBookOfWorkItem[],
  stream: string
): MigrationBookOfWorkItem[] {
  return items.map((item) => ({
    ...item,
    id: `${stream}:${item.id}`,
    parentId: item.parentId === null ? null : `${stream}:${item.parentId}`,
  }));
}

function epicAndFeatures(
  items: MigrationBookOfWorkItem[],
  epicId: string
): { epic: MigrationBookOfWorkItem; features: MigrationBookOfWorkItem[] } {
  const epic = items.find((i) => i.id === epicId && i.type === 'epic')!;
  expect(epic).toBeDefined();
  const features = items.filter((i) => i.type === 'feature' && i.parentId === epicId);
  return { epic, features };
}

// ---------------------------------------------------------------------------
// Clustering (pure)
// ---------------------------------------------------------------------------

describe('FK dependency layers + clustering', () => {
  it('computes layers as 1 + max(parent layer) over forward FK edges', () => {
    const layers = computeTableLayers(makeManifest());
    expect(layers.get('dbo.customers')).toBe(1);
    expect(layers.get('dbo.products')).toBe(1);
    expect(layers.get('dbo.regions')).toBe(1);
    expect(layers.get('dbo.audit_log')).toBe(1);
    expect(layers.get('dbo.orders')).toBe(2);
    expect(layers.get('dbo.stores')).toBe(2);
    expect(layers.get('dbo.order_items')).toBe(3);
    expect(layers.get('dbo.inventory')).toBe(3);
  });

  it('flags tables via their own OR their columns’ flagged coverage entries', () => {
    expect([...flaggedTableSet(makeManifest())]).toEqual(['dbo.orders']);
  });

  it('clusters mechanical tables by layer with the cap, excluding flagged tables', () => {
    const clusters = clusterMechanicalTables(makeManifest(), 3);
    expect(clusters.map((c) => ({ layer: c.layer, tables: c.tables }))).toEqual([
      { layer: 1, tables: ['dbo.customers', 'dbo.products', 'dbo.regions'] },
      { layer: 1, tables: ['dbo.audit_log'] },
      { layer: 2, tables: ['dbo.stores'] },
      { layer: 3, tables: ['dbo.order_items', 'dbo.inventory'] },
    ]);
  });

  it('ANTI-EXPLOSION PIN: 250 mechanical tables yield ~10 cluster stories, never 250', () => {
    const tables = Array.from({ length: 250 }, (_, i) => `dbo.t${String(i).padStart(3, '0')}`);
    const manifest = {
      ...makeManifest(),
      coverage: {
        translated_count: 250,
        skipped_count: 0,
        flagged_count: 0,
        objects: tables.map((t) => ({
          objectType: 'table' as const,
          objectRef: t,
          disposition: 'translated' as const,
          provenance: { entityId: `ent-${t}`, findingIds: [] },
        })),
      },
      requires_translation_spec_2: [],
      manual_recreation: [],
      bulk_load: { table_order: tables, expected_row_counts: {}, cast_notes: {} },
      expected_schema: {
        tables: tables.map((t) => ({ schemaName: 'dbo', tableName: t.split('.')[1] })),
        columns: [],
        keysAndIndexes: [],
        sequences: [],
      },
      translations: undefined,
    } as PackManifest;
    const packView = makePackView({ manifest, decisions: [], translations: [] });

    const skeleton = buildDbStreamSkeleton({
      stream: SCHEMA_STREAM,
      packView,
      ensureOutcome: null,
      clusterCap: 25,
    });
    const items = namespaced(skeleton.items, SCHEMA_STREAM);
    const { epic, features } = epicAndFeatures(items, `${SCHEMA_STREAM}:${SCHEMA_STREAM}-epic-schema`);
    const stories = buildDbEpicStories({
      epic,
      features,
      stream: SCHEMA_STREAM,
      packView,
      ensureOutcome: null,
      clusterCap: 25,
      maxSequence: 100,
    });

    const clusterStories = stories.filter((s) => (s.tags ?? []).some((t) => t.startsWith('db_cluster:')));
    expect(clusterStories).toHaveLength(10); // 250 / 25
    expect(stories.length).toBeLessThanOrEqual(13); // foundations + 10 + constraints (+ slack)
    expect(stories.length).toBeGreaterThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// Phase-1 skeletons
// ---------------------------------------------------------------------------

describe('buildDbStreamSkeleton', () => {
  it('schema stream: initiative + schema/code epics + foundations/cluster/exceptional/constraints/translation features; validates as a book', () => {
    const skeleton = buildDbStreamSkeleton({
      stream: SCHEMA_STREAM,
      packView: makePackView(),
      ensureOutcome: null,
      clusterCap: 3,
    });
    const result = validateMigrationBookOfWork(skeleton);
    expect(result.ok).toBe(true);

    const kinds = skeleton.items
      .filter((i) => i.type === 'feature')
      .map((f) => (f as MigrationBookOfWorkItem & { dbFeatureKind?: string }).dbFeatureKind);
    expect(kinds).toEqual([
      'foundations',
      'cluster',
      'cluster',
      'cluster',
      'cluster',
      'exceptional',
      'constraints',
      'translation', // stored_procedure
      'translation', // trigger
      'translation', // scheduled_job
    ]);
    expect(skeleton.items.filter((i) => i.type === 'epic')).toHaveLength(2);
    expect(skeleton.items.filter((i) => i.type === 'story')).toHaveLength(0);
  });

  it('data stream: load + cutover epics with bulk/incremental/reconciliation/final-delta/seeding/jobs/verify features', () => {
    const skeleton = buildDbStreamSkeleton({
      stream: DATA_STREAM,
      packView: makePackView(),
      ensureOutcome: null,
      clusterCap: 3,
    });
    expect(validateMigrationBookOfWork(skeleton).ok).toBe(true);
    const kinds = skeleton.items
      .filter((i) => i.type === 'feature')
      .map((f) => (f as MigrationBookOfWorkItem & { dbFeatureKind?: string }).dbFeatureKind);
    expect(kinds).toEqual([
      'bulk',
      'incremental',
      'reconciliation',
      'final-delta',
      'seeding',
      'jobs',
      'verify',
    ]);
  });

  it('pack unavailable: prerequisite skeleton (blocked epic, no LLM guesswork), still a valid book', () => {
    const skeleton = buildDbStreamSkeleton({
      stream: SCHEMA_STREAM,
      packView: null,
      ensureOutcome: {
        status: 'skipped',
        packId: null,
        inputSnapshotHash: null,
        reason: "No 'db.engine' captured decision found",
      },
      clusterCap: 25,
    });
    expect(validateMigrationBookOfWork(skeleton).ok).toBe(true);
    const epic = skeleton.items.find((i) => i.type === 'epic')!;
    expect(epic.readiness).toBe('blocked');
    expect(epic.tags).toContain('provenance:prerequisite');
  });
});

// ---------------------------------------------------------------------------
// Phase-2 stories
// ---------------------------------------------------------------------------

function expandEpic(
  packView: PackView,
  epicLocalId: string,
  stream: string,
  clusterCap = 3
): MigrationBookOfWorkItem[] {
  const skeleton = buildDbStreamSkeleton({
    stream: stream as typeof SCHEMA_STREAM,
    packView,
    ensureOutcome: null,
    clusterCap,
  });
  const items = namespaced(skeleton.items, stream);
  const { epic, features } = epicAndFeatures(items, `${stream}:${epicLocalId}`);
  return buildDbEpicStories({
    epic,
    features,
    stream,
    packView,
    ensureOutcome: null,
    clusterCap,
    maxSequence: 50,
  });
}

describe('buildDbEpicStories — schema epic', () => {
  it('emits foundations + one story per cluster + one per flagged table + constraints, with pack file paths', () => {
    const stories = expandEpic(makePackView(), `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM);
    // 1 foundations + 4 clusters + 1 exceptional (dbo.orders) + 1 constraints
    expect(stories).toHaveLength(7);

    const foundations = stories.find((s) => s.id.endsWith('-s-foundations'))!;
    expect(foundations.tags).toContain(SEED_DB_PACK_FILES_TAG);
    expect((foundations as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths).toEqual([
      'liquibase/db.changelog-master.xml',
      'liquibase/changesets/000-schemas.sql',
      'manifest.json',
      'data/bulk-load-manifest.json',
    ]);

    const cluster0 = stories.find((s) => s.id.endsWith('-s-cluster-0'))!;
    expect((cluster0 as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths).toEqual([
      'liquibase/changesets/010-tables/dbo.customers.sql',
      'liquibase/changesets/010-tables/dbo.products.sql',
      'liquibase/changesets/010-tables/dbo.regions.sql',
    ]);

    const exceptional = stories.find((s) => (s.tags ?? []).includes('db_exceptional'))!;
    expect(exceptional.title).toContain('dbo.orders');
    expect(exceptional.readiness).toBe('needs_user_decision');
    expect(exceptional.missingInputs).toContain('type_mapping--dbo.orders.legacy_ts');
    expect(exceptional.discoveryFindingReferences).toEqual(['fnd-ts-1']);

    const constraints = stories.find((s) => s.id.endsWith('-s-constraints'))!;
    expect((constraints as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths).toEqual([
      'liquibase/changesets/020-foreign-keys.sql',
      'liquibase/changesets/030-indexes.sql',
      'liquibase/changesets/040-sequences-seed.sql',
    ]);
  });

  it('COVERAGE PIN: every manifest table lands in exactly one cluster or exceptional story', () => {
    const stories = expandEpic(makePackView(), `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM);
    const covered: string[] = [];
    for (const story of stories) {
      const clusterTables = (story as MigrationBookOfWorkItem & { dbClusterTables?: string[] })
        .dbClusterTables;
      if (clusterTables) covered.push(...clusterTables);
      if ((story.tags ?? []).includes('db_exceptional')) {
        covered.push('dbo.orders');
      }
    }
    expect(covered.sort()).toEqual(
      makeManifest().bulk_load.table_order.map((t) => t).sort()
    );
  });

  it('throws (epic failed, retryable) when the manifest cluster count no longer matches the skeleton', () => {
    const packView = makePackView();
    const skeleton = buildDbStreamSkeleton({
      stream: SCHEMA_STREAM,
      packView,
      ensureOutcome: null,
      clusterCap: 3,
    });
    const items = namespaced(skeleton.items, SCHEMA_STREAM);
    const { epic, features } = epicAndFeatures(
      items,
      `${SCHEMA_STREAM}:${SCHEMA_STREAM}-epic-schema`
    );
    // Expansion recomputes with a DIFFERENT cap → different cluster count →
    // the builder must fail loudly, never silently re-shape.
    expect(() =>
      buildDbEpicStories({
        epic,
        features,
        stream: SCHEMA_STREAM,
        packView,
        ensureOutcome: null,
        clusterCap: 100,
        maxSequence: 50,
      })
    ).toThrow(/regenerate the migration plan/i);
  });
});

describe('buildDbEpicStories — code-objects epic', () => {
  it('emits review + apply stories per kind, individual rewrite-in-app stories, and the jobs re-home story', () => {
    const stories = expandEpic(makePackView(), `${SCHEMA_STREAM}-epic-code`, SCHEMA_STREAM);

    const procReview = stories.find((s) => s.id.endsWith('-s-stored_procedure-review'))!;
    expect(procReview.readiness).toBe('needs_user_decision');
    expect(procReview.title).toContain('(1 of 2 outstanding)');

    const procApply = stories.find((s) => s.id.endsWith('-s-stored_procedure-apply'))!;
    expect(procApply.readiness).toBe('ready_for_spec');
    expect(procApply.tags).toContain(SEED_DB_PACK_FILES_TAG);
    expect((procApply as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths).toEqual([
      'translations/stored_procedures/dbo.archive_orders.sql',
    ]);

    const rewrite = stories.find((s) => (s.tags ?? []).includes('rewrite_in_app'))!;
    expect(rewrite.title).toContain('dbo.trg_orders_audit');

    const jobs = stories.find((s) => s.id.endsWith('-s-jobs-rehome'))!;
    expect(jobs.description).toContain('[decision:db.jobsRehoming]');
  });
});

describe('buildDbEpicStories — data migration + cutover epics', () => {
  it('bulk story carries totals; incremental stories group by strategy with needs_decision gated', () => {
    const stories = expandEpic(makePackView(), `${DATA_STREAM}-epic-load`, DATA_STREAM);
    const bulk = stories.find((s) => s.id.endsWith('-s-bulk-load'))!;
    expect(bulk.title).toContain('8 tables');
    // Row-count coverage honesty (2026-08-30): this fixture was ALWAYS
    // partial (8 tables, 2 captured counts) and the old title presented the
    // partial sum as if it were the total — the '8 tables' assertion above
    // never caught it. The label now names both denominators.
    expect(bulk.title).toContain(
      '~6,000 rows counted across only 2 of 8 tables — TOTAL UNKNOWN',
    );
    expect(bulk.tags).toContain(SEED_DB_PACK_FILES_TAG);

    const needsDecision = stories.find((s) => s.id.endsWith('-s-incr-needs_decision'))!;
    expect(needsDecision.readiness).toBe('needs_user_decision');
    expect(needsDecision.missingInputs).toEqual(['delta_key--dbo.audit_log']);

    // Spec 2026-07-02-d: keyed groups carry the shared sync runner + state DDL
    // alongside their per-table delta scripts.
    const insertOnly = stories.find((s) => s.id.endsWith('-s-incr-insert_only'))!;
    expect(
      (insertOnly as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths
    ).toEqual([
      'sync/000-sync-state.sql',
      'sync/run-incremental-sync.sh',
      'data/incremental/dbo.orders.sql',
    ]);

    const reconciliation = stories.find((s) => s.id.endsWith('-s-reconciliation'))!;
    expect(
      (reconciliation as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths
    ).toEqual(['reconcile/reconciliation.sql', 'reconcile/build-report.sh']);
  });

  it('bulk title: FULL row-count coverage reads as a plain total (no coverage caveat)', () => {
    const view = makePackView();
    const counts: Record<string, number> = {};
    for (const t of view.manifest.bulk_load.table_order) counts[t] = 100;
    view.manifest.bulk_load.expected_row_counts = counts;
    const stories = expandEpic(view, `${DATA_STREAM}-epic-load`, DATA_STREAM);
    const bulk = stories.find((s) => s.id.endsWith('-s-bulk-load'))!;
    expect(bulk.title).toContain('8 tables, ~800 rows');
    expect(bulk.title).not.toContain('TOTAL UNKNOWN');
    expect(bulk.title).not.toContain('NOT captured');
  });

  it('bulk title: ZERO captured counts says so — never a misleading "~0 rows"', () => {
    const view = makePackView();
    view.manifest.bulk_load.expected_row_counts = {};
    const stories = expandEpic(view, `${DATA_STREAM}-epic-load`, DATA_STREAM);
    const bulk = stories.find((s) => s.id.endsWith('-s-bulk-load'))!;
    expect(bulk.title).toContain('8 tables, source row counts NOT captured');
    expect(bulk.title).not.toContain('~0 rows');
  });

  it('cutover epic: final delta, sequence seeding at swap-over, job enablement, verification', () => {
    const stories = expandEpic(makePackView(), `${DATA_STREAM}-epic-cutover`, DATA_STREAM);
    expect(stories.map((s) => s.id.split('-s-')[1]).sort()).toEqual([
      'final-delta',
      'jobs-cutover',
      'seeding',
      'verify',
    ]);
    const seeding = stories.find((s) => s.id.endsWith('-s-seeding'))!;
    expect(seeding.title).toContain('2 sequence(s)');
    expect(
      (seeding as MigrationBookOfWorkItem & { packFilePaths?: string[] }).packFilePaths
    ).toEqual(['liquibase/changesets/040-sequences-seed.sql']);
  });
});

describe('buildDbEpicStories — prerequisite epic', () => {
  it('pack unavailable: explicit blocked prerequisite stories, never freeform', () => {
    const skeleton = buildDbStreamSkeleton({
      stream: SCHEMA_STREAM,
      packView: null,
      ensureOutcome: {
        status: 'skipped',
        packId: null,
        inputSnapshotHash: null,
        reason: "No 'db.engine' captured decision found",
      },
      clusterCap: 25,
    });
    const items = namespaced(skeleton.items, SCHEMA_STREAM);
    const { epic, features } = epicAndFeatures(
      items,
      `${SCHEMA_STREAM}:${SCHEMA_STREAM}-epic-prereq`
    );
    const stories = buildDbEpicStories({
      epic,
      features,
      stream: SCHEMA_STREAM,
      packView: null,
      ensureOutcome: {
        status: 'skipped',
        packId: null,
        inputSnapshotHash: null,
        reason: "No 'db.engine' captured decision found",
      },
      clusterCap: 25,
      maxSequence: 10,
    });
    expect(stories.length).toBeGreaterThanOrEqual(1);
    expect(stories[0].title).toBe('Generate the DB migration pack');
    expect(stories[0].readiness).toBe('blocked');
    expect(stories.every((s) => (s.tags ?? []).includes('provenance:prerequisite'))).toBe(true);
  });
});

// ===========================================================================
// WS3 P1 (2026-07-31): structural completeness — count-tied acceptance
// criteria on the constraints story + warnings become prerequisite stories.
// ===========================================================================

describe('structural completeness surfacing (WS3 P1)', () => {
  it('ties the constraints-story acceptance criteria to the source counts', () => {
    const packView = makePackView();
    (packView.manifest as PackManifest).structural_accounting = {
      tables_total: 65,
      view_entities_total: 4,
      tables_with_constraints_metadata: 65,
      tables_with_primary_key: 60,
      unique_constraints_total: 3,
      check_constraints_total: 2,
      indexes_total: 61,
      relationships_total: 5,
      relationships_with_fk_columns: 5,
      collation_hazard_columns: 0,
      generated_columns: 0,
      sequences_captured: 0,
      code_objects_captured: { stored_procedure: 29, trigger: 0, view: 4, scheduled_job: 0 },
    };
    const stories = expandEpic(packView, `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM);
    const constraints = stories.find((s) => s.id.endsWith('-s-constraints'))!;
    const criteria = constraints.acceptanceCriteria!.join(' | ');
    expect(criteria).toContain('applies 5 foreign key(s)');
    expect(criteria).toContain('applies 61 index(es)');
    expect(criteria).toContain('60 of 65 tables declare a PRIMARY KEY');
    expect(criteria).toContain('an empty changeset fails this');
  });

  it('THROWS when structural findings are undispositioned (Spec 2026-08-04-2)', () => {
    const packView = makePackView();
    (packView.manifest as PackManifest).structural_findings = [
      { kind: 'no_primary_keys', subject: 'all_tables', message: 'no PKs — target gets 0.' },
      {
        kind: 'relationships_without_fk_columns',
        subject: 'all_relationships',
        message: '5 relationship(s) carry no fk_columns — 020-foreign-keys.sql will be EMPTY.',
      },
    ];
    expect(() => expandEpic(packView, `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM)).toThrow(
      /Structural findings must be dispositioned/
    );
  });

  it('fix_upstream still blocks; accepted + known_gap unblock, known_gap emits debt items', () => {
    const packView = makePackView();
    (packView.manifest as PackManifest).structural_findings = [
      { kind: 'no_primary_keys', subject: 'all_tables', message: 'no PKs — target gets 0.' },
      { kind: 'no_indexes', subject: 'all_tables', message: 'no indexes — 030 will be EMPTY.' },
    ];
    // fix_upstream on one finding: still OPEN → throw.
    packView.structuralDispositions = [
      { finding_key: 'no_primary_keys:all_tables', disposition: 'accepted', note: 'heap tables by design' },
      { finding_key: 'no_indexes:all_tables', disposition: 'fix_upstream', note: null },
    ];
    expect(() => expandEpic(packView, `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM)).toThrow(
      /fix upstream pending/
    );

    // known_gap closes the gate and materialises a Known-gaps feature + item.
    packView.structuralDispositions = [
      { finding_key: 'no_primary_keys:all_tables', disposition: 'accepted', note: 'heap tables by design' },
      { finding_key: 'no_indexes:all_tables', disposition: 'known_gap', note: 'DBA will hand-author' },
    ];
    const stories = expandEpic(packView, `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM);
    const feature = stories.find((s) => s.id.endsWith('-f-known-gaps'));
    expect(feature).toBeDefined();
    expect(feature!.type).toBe('feature');
    const gapItems = stories.filter((s) => s.type === 'known_gap');
    expect(gapItems).toHaveLength(1);
    expect(gapItems[0].parentId).toBe(feature!.id);
    expect(gapItems[0].tags).toContain('execution:manual');
    expect(gapItems[0].description).toContain('DBA will hand-author');
    // The ACCEPTED finding leaves no trace in the plan.
    expect(stories.some((s) => (s.title ?? '').includes('no PKs'))).toBe(false);
    // Legacy structural-gap stories are GONE.
    expect(stories.filter((s) => s.id.includes('-s-structural-gap-'))).toHaveLength(0);
  });

  it('emits NO gap machinery when the pack has no findings', () => {
    const stories = expandEpic(makePackView(), `${SCHEMA_STREAM}-epic-schema`, SCHEMA_STREAM);
    expect(stories.filter((s) => s.id.includes('-s-structural-gap-'))).toHaveLength(0);
    expect(stories.filter((s) => s.type === 'known_gap')).toHaveLength(0);
  });
});

// ===========================================================================
// Adaptive cluster sizing (2026-08-04, Kiro fix 3): the cap is a TARGET —
// projected per-cluster payload decrements it by one until every cluster
// fits the budget; floor at 1 flags (logs) instead of silently oversizing.
// ===========================================================================

describe('adaptive cluster sizing (2026-08-04)', () => {
  function columnsFor(table: string, count: number) {
    const [schemaName, tableName] = table.split('.');
    return Array.from({ length: count }, (_, i) => ({
      schemaName,
      tableName,
      columnName: `col_${i}`,
      dataType: 'text',
      isNullable: true,
      isPrimaryKey: false,
      defaultExpression: null,
      isIdentity: false,
      isGenerated: false,
      generationExpression: null,
    }));
  }

  it('no adaptation when projected payloads fit (column-less fixture, default budget)', () => {
    const manifest = makeManifest();
    const atTarget = clusterMechanicalTables(manifest, 25);
    // 8 small tables — clustering identical to the pre-adaptive behaviour.
    expect(atTarget.every((c) => c.tables.length <= 25)).toBe(true);
    expect(atTarget.flatMap((c) => c.tables)).toHaveLength(7); // dbo.orders is flagged
  });

  it('decrements the cap by one until every cluster fits the budget', () => {
    const manifest = makeManifest();
    // 10 columns per table -> 400 + 10*80 = 1,200 chars each. Budget 2,500
    // fits at most TWO tables per cluster; target 8 must step down.
    manifest.expected_schema.columns = [
      'dbo.customers',
      'dbo.products',
      'dbo.regions',
      'dbo.audit_log',
      'dbo.stores',
      'dbo.order_items',
      'dbo.inventory',
    ].flatMap((t) => columnsFor(t, 10));
    const clusters = clusterMechanicalTables(manifest, 8, 2_500);
    expect(Math.max(...clusters.map((c) => c.tables.length))).toBeLessThanOrEqual(2);
    // Coverage is untouched by adaptation — every mechanical table still lands.
    expect(clusters.flatMap((c) => c.tables)).toHaveLength(7);
  });

  it('floors at 1 when a SINGLE table exceeds the budget (the de-inlining flag case)', () => {
    const manifest = makeManifest();
    manifest.expected_schema.columns = columnsFor('dbo.customers', 200); // ~16,400 chars
    const clusters = clusterMechanicalTables(manifest, 8, 5_000);
    // Every cluster is a single table; the monster is alone and over budget
    // (surfaced via the diag log — batching cannot subdivide one table).
    expect(clusters.every((c) => c.tables.length === 1)).toBe(true);
    expect(clusters.flatMap((c) => c.tables)).toHaveLength(7);
  });

  it('estimateTableChars: column counts drive estimates; unknown tables get the flat default', () => {
    const manifest = makeManifest();
    manifest.expected_schema.columns = columnsFor('dbo.customers', 10);
    const estimates = estimateTableChars(manifest);
    expect(estimates.get('dbo.customers')).toBe(400 + 10 * 80);
    expect(estimates.get('dbo.products')).toBe(1_200);
  });
});
