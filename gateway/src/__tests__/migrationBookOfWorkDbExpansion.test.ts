/**
 * Integration tests — deterministic DB-epic expansion through the REAL
 * per-epic pipeline (Spec 2026-07-02-b, Persistence-Tier Oracle Program).
 *
 * Pins:
 *   - a DB epic expands with ZERO LLM calls (callLlm mock throws if touched)
 *   - the ensure step re-runs at expansion time with the book's tuple
 *   - stories land via ONE atomic append with expansion_state='expanded'
 *     and the merged hierarchy stays valid
 *   - a skeleton/manifest cluster mismatch fails the epic (retryable),
 *     persists 'failed' state-only, and appends NO stories
 */

import {
  expandMigrationBookOfWorkEpic,
  AppendItemsRequestBody,
  FetchedBookOfWork,
} from '../services/migrationBookOfWorkExpansionHandler';
import {
  buildDbStreamSkeleton,
  PackView,
} from '../services/migrationDbPackPlanner';
import type { PackManifest } from '../services/dbMigrationPack/types';
import {
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';

const STREAM = 'target_database_schema_implementation';

function manifest(): PackManifest {
  const tables = ['dbo.customers', 'dbo.orders', 'dbo.order_items'];
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
      translated_count: 3,
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
    cycle_breaks: [],
    cluster_notes: [],
    collation_notes: [],
    delta_strategies: [],
    bulk_load: { table_order: tables, expected_row_counts: {}, cast_notes: {} },
    expected_schema: {
      tables: tables.map((t) => ({ schemaName: 'dbo', tableName: t.split('.')[1] })),
      columns: [],
      keysAndIndexes: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          kind: 'foreign_key',
          name: 'fk_orders_customers',
          columns: ['customer_id'],
          referencedSchema: 'dbo',
          referencedTable: 'customers',
          referencedColumns: ['id'],
          onDelete: null,
          onUpdate: null,
          isUnique: false,
          columnDirections: null,
        },
        {
          schemaName: 'dbo',
          tableName: 'order_items',
          kind: 'foreign_key',
          name: 'fk_items_orders',
          columns: ['order_id'],
          referencedSchema: 'dbo',
          referencedTable: 'orders',
          referencedColumns: ['id'],
          onDelete: null,
          onUpdate: null,
          isUnique: false,
          columnDirections: null,
        },
      ],
      sequences: [],
    },
  };
}

function packView(): PackView {
  return {
    packId: 'pack-9',
    status: 'generated',
    inputSnapshotHash: 'hash-9',
    manifest: manifest(),
    decisions: [],
    translations: [],
  };
}

/** Book document as phase-1 would persist it (namespaced + state-seeded). */
function makeBook(clusterCap: number): FetchedBookOfWork {
  const skeleton = buildDbStreamSkeleton({
    stream: STREAM,
    packView: packView(),
    ensureOutcome: null,
    clusterCap,
  });
  const items: MigrationBookOfWorkItem[] = skeleton.items.map((item) => ({
    ...item,
    id: `${STREAM}:${item.id}`,
    parentId: item.parentId === null ? null : `${STREAM}:${item.parentId}`,
    tags: [...(item.tags ?? []), `stream:${STREAM}`],
    ...(item.type === 'epic' ? { expansionState: 'not_expanded' as const } : {}),
  }));
  return {
    bookId: 'book-db',
    status: 'draft',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    items,
  };
}

function makeAms(book: FetchedBookOfWork) {
  const appends: Array<{ body: AppendItemsRequestBody }> = [];
  return {
    appends,
    fetchBook: jest.fn().mockResolvedValue(book),
    appendItems: jest.fn().mockImplementation(async (_p: string, _b: string, body: AppendItemsRequestBody) => {
      appends.push({ body });
    }),
  };
}

const throwingLlm = jest.fn().mockImplementation(async () => {
  throw new Error('LLM must NEVER be called for a DB epic');
});

describe('Deterministic DB-epic expansion (Spec 2026-07-02-b)', () => {
  it('expands the schema epic with zero LLM calls, one atomic append, valid merged hierarchy', async () => {
    const book = makeBook(2); // 3 tables, cap 2, layers 1/2/3 -> 3 clusters
    const ams = makeAms(book);
    const ensurePack = jest.fn().mockResolvedValue({
      status: 'fresh',
      packId: 'pack-9',
      inputSnapshotHash: 'hash-9',
      reason: null,
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-db', epicId: `${STREAM}:${STREAM}-epic-schema` },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        callLlm: throwingLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        ensurePack,
        fetchPackView: jest.fn().mockResolvedValue(packView()),
        dbClusterCapOverride: 2,
      }
    );

    // foundations + 3 clusters + constraints = 5 stories
    expect(outcome).toMatchObject({ expansionState: 'expanded', storiesAppended: 5 });
    expect(throwingLlm).not.toHaveBeenCalled();
    expect(ensurePack).toHaveBeenCalledWith({
      projectId: 'proj-1',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
    });

    // First append marks `expanding` (state-only); second carries the stories.
    expect(ams.appends).toHaveLength(2);
    expect(ams.appends[0].body).toMatchObject({ items: [], expansion_state: 'expanding' });
    const finalAppend = ams.appends[1].body;
    expect(finalAppend.expansion_state).toBe('expanded');
    expect(finalAppend.items).toHaveLength(5);
    expect(finalAppend.items.every((s) => s.type === 'story')).toBe(true);
    expect(finalAppend.items.every((s) => (s.tags ?? []).includes('provenance:pack'))).toBe(true);

    const merged = validateBookOfWorkHierarchy([...book.items, ...finalAppend.items]);
    expect(merged.ok).toBe(true);
  });

  it('fails the epic (retryable, state-only append) when the manifest no longer matches the skeleton clusters', async () => {
    const book = makeBook(2); // FK chain -> 3 layers -> 3 cluster features
    const ams = makeAms(book);

    // The pack was REFRESHED between plan creation and expansion and its FKs
    // vanished: all 3 tables now sit in layer 1 -> 2 clusters at cap 2,
    // mismatching the skeleton's 3 cluster features.
    const refreshedView = packView();
    refreshedView.manifest = {
      ...refreshedView.manifest,
      expected_schema: {
        ...refreshedView.manifest.expected_schema,
        keysAndIndexes: [],
      },
    };

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-db', epicId: `${STREAM}:${STREAM}-epic-schema` },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        callLlm: throwingLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        ensurePack: jest.fn().mockResolvedValue({
          status: 'refreshed',
          packId: 'pack-9',
          inputSnapshotHash: 'hash-10',
          reason: 'inputs changed since generation',
        }),
        fetchPackView: jest.fn().mockResolvedValue(refreshedView),
        dbClusterCapOverride: 2,
      }
    );

    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toMatch(/regenerate the migration plan/i);
    // expanding (state-only) then failed (state-only) — NO story-carrying append.
    expect(ams.appends).toHaveLength(2);
    expect(ams.appends[0].body).toMatchObject({ items: [], expansion_state: 'expanding' });
    expect(ams.appends[1].body).toMatchObject({ items: [], expansion_state: 'failed' });
  });

  it('pack unavailable at expansion: prerequisite epic expands into blocked prerequisite stories (no LLM)', async () => {
    // Build the book from a PREREQUISITE skeleton (pack was unavailable at
    // plan time) and keep it unavailable at expansion time too.
    const skeleton = buildDbStreamSkeleton({
      stream: STREAM,
      packView: null,
      ensureOutcome: {
        status: 'skipped',
        packId: null,
        inputSnapshotHash: null,
        reason: "No 'db.engine' captured decision found",
      },
      clusterCap: 25,
    });
    const items: MigrationBookOfWorkItem[] = skeleton.items.map((item) => ({
      ...item,
      id: `${STREAM}:${item.id}`,
      parentId: item.parentId === null ? null : `${STREAM}:${item.parentId}`,
      ...(item.type === 'epic' ? { expansionState: 'not_expanded' as const } : {}),
    }));
    const book: FetchedBookOfWork = {
      bookId: 'book-db',
      status: 'draft',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
      items,
    };
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-db', epicId: `${STREAM}:${STREAM}-epic-prereq` },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        callLlm: throwingLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        ensurePack: jest.fn().mockResolvedValue({
          status: 'skipped',
          packId: null,
          inputSnapshotHash: null,
          reason: "No 'db.engine' captured decision found",
        }),
        fetchPackView: jest.fn().mockResolvedValue(null),
        dbClusterCapOverride: 25,
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    expect(throwingLlm).not.toHaveBeenCalled();
    const finalAppend = ams.appends[1].body;
    expect(finalAppend.items.length).toBeGreaterThanOrEqual(1);
    expect(finalAppend.items[0].title).toBe('Generate the DB migration pack');
    expect(finalAppend.items[0].readiness).toBe('blocked');
  });
});
