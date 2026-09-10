/**
 * DbMigrationPackView (+ decision queue, epic picker, drawer chip) tests
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Task 6.1).
 *
 * Focused coverage ONLY (per the task limits):
 *   (a) the pack view renders the file tree + coverage summary
 *       (translated / skipped / flagged counts) from a mocked pack payload;
 *   (b) the decision queue lists open decisions, filters by category, and a
 *       bulk-resolve posts the shared resolution and surfaces the stale
 *       state + an enabled Regenerate — WITHOUT any auto-regenerate call;
 *   (c) the staleness banner renders when `is_stale` and nothing
 *       auto-regenerates;
 *   (d) the epic picker PATCHes `work_item_id`, and
 *       `MigrationBookOfWorkItemDrawer` shows the pack chip with a download
 *       action on the attached epic.
 *
 * The drift tab has its own sibling suite
 * (`DbMigrationPackDriftReports.test.tsx`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROJECT_ID = 'proj-pack-1';
const ARCH_ID = 'arch-pack-1';
const PACK_ID = 'pack-1';

// --- Mock CSS modules --------------------------------------------------------
vi.mock('../DbMigrationPack.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock the pack API module ------------------------------------------------
const mockListPacks = vi.fn();
const mockGetPack = vi.fn();
const mockListFiles = vi.fn();
const mockListDecisions = vi.fn();
const mockResolveDecision = vi.fn();
const mockBulkResolve = vi.fn();
const mockAttachWorkItem = vi.fn();
const mockGenerate = vi.fn();
const mockRegenerate = vi.fn();
const mockListDriftReports = vi.fn();
const mockListStructuralFindings = vi.fn();

vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPacks: (...args: unknown[]) => mockListPacks(...args),
    getDbMigrationPack: (...args: unknown[]) => mockGetPack(...args),
    listDbMigrationPackFiles: (...args: unknown[]) => mockListFiles(...args),
    listDbMigrationPackDecisions: (...args: unknown[]) =>
      mockListDecisions(...args),
    resolveDbMigrationPackDecision: (...args: unknown[]) =>
      mockResolveDecision(...args),
    bulkResolveDbMigrationPackDecisions: (...args: unknown[]) =>
      mockBulkResolve(...args),
    attachDbMigrationPackWorkItem: (...args: unknown[]) =>
      mockAttachWorkItem(...args),
    generateDbMigrationPack: (...args: unknown[]) => mockGenerate(...args),
    regenerateDbMigrationPack: (...args: unknown[]) => mockRegenerate(...args),
    listDbMigrationPackDriftReports: (...args: unknown[]) =>
      mockListDriftReports(...args),
    listDbMigrationPackStructuralFindings: (...args: unknown[]) =>
      mockListStructuralFindings(...args),
  };
});

// --- Mock the book-of-work API (epic picker source) --------------------------
const mockListBooks = vi.fn();
vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    listMigrationBookOfWorks: (...args: unknown[]) => mockListBooks(...args),
  };
});

// --- Mock the target-id lookups (decision-binding resolution, 2026-09-02) ----
const mockGetActiveTarget = vi.fn();
const mockGetSavedTarget = vi.fn();
vi.mock('../../../../api/architectConversationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architectConversationApi')
  >('../../../../api/architectConversationApi');
  return {
    ...actual,
    getActiveTargetArchitectureId: (...args: unknown[]) =>
      mockGetActiveTarget(...args),
    getSavedTargetArchitectureId: (...args: unknown[]) =>
      mockGetSavedTarget(...args),
  };
});

import { DbMigrationPackView } from '../DbMigrationPackView';
import MigrationBookOfWorkItemDrawer from '../MigrationBookOfWorkItemDrawer';
import type {
  DbMigrationPackDecisionDto,
  DbMigrationPackFileDto,
  DbMigrationPackManifest,
  DbMigrationPackWithStaleness,
} from '../../../../api/dbMigrationPackApi';
import type { MigrationBookOfWorkItem } from '../../../../api/migrationBookOfWorkApi';

// --- Fixtures -----------------------------------------------------------------

const MANIFEST: DbMigrationPackManifest = {
  manifest_version: 1,
  source_engine: 'sybase_ase',
  target_engine: 'postgresql',
  type_mapping_version: 'v1',
  seed_margin: 1000,
  seed_margin_note: 'Identity restart = captured high-water + margin 1000.',
  phase_ordering: [
    'Apply structural changesets (tables/PKs/constraints; no FKs, no non-PK indexes)',
    'Bulk load all tables',
    'Apply FK constraints + non-PK indexes once',
    'Reseed sequences/identities',
    'Incremental runs execute with FKs and indexes enforced',
  ],
  delete_propagation:
    'DELETE propagation is OUT OF SCOPE for incremental v1; full-reload tables catch deletes.',
  coverage: {
    translated_count: 2,
    skipped_count: 1,
    flagged_count: 1,
    objects: [
      {
        objectType: 'table',
        objectRef: 'dbo.orders',
        disposition: 'translated',
        provenance: { entityId: 'ent-1', findingIds: [] },
      },
      {
        objectType: 'column',
        objectRef: 'dbo.orders.row_ver',
        disposition: 'flagged',
        decisionKeys: ['type_mapping--dbo.orders.row_ver'],
        provenance: { entityId: 'ent-1', attributeId: 'attr-9', findingIds: ['f-1'] },
      },
    ],
  },
  requires_translation_spec_2: [
    { kind: 'stored_procedure', object_ref: 'dbo.sp_calc', finding_ids: ['f-2'] },
  ],
  manual_recreation: [],
  cycle_breaks: [],
  cluster_notes: [],
  collation_notes: [],
  delta_strategies: [
    {
      table: 'dbo.orders',
      strategy: 'insert_only',
      deltaKey: 'order_id',
      source: 'identity_column',
    },
  ],
  bulk_load: {
    table_order: ['dbo.orders'],
    expected_row_counts: { 'dbo.orders': 120 },
    cast_notes: {},
  },
  expected_schema: {},
};

function buildPack(
  overrides: Partial<DbMigrationPackWithStaleness> = {},
): DbMigrationPackWithStaleness {
  return {
    id: PACK_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    status: 'generated',
    stale_reason: null,
    input_snapshot_hash: 'hash-1',
    generated_at: '2026-06-11T10:00:00Z',
    work_item_id: null,
    translated_count: 2,
    skipped_count: 1,
    flagged_count: 1,
    seed_margin: 1000,
    manifest_json: MANIFEST,
    created_at: '2026-06-11T10:00:00Z',
    updated_at: '2026-06-11T10:00:00Z',
    is_stale: false,
    staleness_reason: null,
    ...overrides,
  };
}

const FILES: DbMigrationPackFileDto[] = [
  {
    id: 'file-1',
    pack_id: PACK_ID,
    file_path: 'liquibase/db.changelog-master.xml',
    file_kind: 'liquibase_master',
    content: '<databaseChangeLog/>',
    sort_order: 0,
  },
  {
    id: 'file-2',
    pack_id: PACK_ID,
    file_path: 'liquibase/changesets/010-tables/dbo.orders.sql',
    file_kind: 'liquibase_changeset',
    content: '--liquibase formatted sql\nCREATE TABLE dbo.orders (...);',
    sort_order: 1,
  },
  {
    id: 'file-3',
    pack_id: PACK_ID,
    file_path: 'manifest.json',
    file_kind: 'manifest',
    content: '{}',
    sort_order: 2,
  },
];

function buildDecision(
  overrides: Partial<DbMigrationPackDecisionDto> = {},
): DbMigrationPackDecisionDto {
  return {
    id: 'dec-1',
    pack_id: PACK_ID,
    decision_key: 'type_mapping--dbo.orders.row_ver',
    object_ref: 'dbo.orders.row_ver',
    category: 'type_mapping',
    question: 'Sybase timestamp (rowversion) has no deterministic mapping.',
    options_json: ['bytea', 'drop_column', 'application_managed'],
    resolution_json: null,
    status: 'open',
    resolved_at: null,
    created_at: '2026-06-11T10:00:00Z',
    updated_at: '2026-06-11T10:00:00Z',
    ...overrides,
  };
}

function renderView() {
  return render(
    <DbMigrationPackView projectId={PROJECT_ID} architectureId={ARCH_ID} />,
  );
}

beforeEach(() => {
  mockListPacks.mockReset();
  mockGetPack.mockReset();
  mockListFiles.mockReset();
  mockListDecisions.mockReset();
  mockResolveDecision.mockReset();
  mockBulkResolve.mockReset();
  mockAttachWorkItem.mockReset();
  mockGenerate.mockReset();
  mockRegenerate.mockReset();
  mockListDriftReports.mockReset();
  mockListBooks.mockReset();
  mockListBooks.mockResolvedValue([]);
  mockGetActiveTarget.mockReset();
  mockGetSavedTarget.mockReset();
  // Default: no target resolvable — existing tests exercise the unbound path.
  mockGetActiveTarget.mockResolvedValue(null);
  mockGetSavedTarget.mockResolvedValue(null);
  mockListStructuralFindings.mockReset();
  // Default: no findings — the panel resolves deterministically (it renders
  // null until its list call settles).
  mockListStructuralFindings.mockResolvedValue({ findings: [] });
});

describe('DbMigrationPackView (Task 6.1)', () => {
  it('renders the file tree + coverage summary from the pack payload', async () => {
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);

    renderView();

    // Coverage summary chips (translated / skipped / flagged counts).
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-coverage-summary')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-coverage-translated')).toHaveTextContent(
      '2 translated',
    );
    expect(screen.getByTestId('db-pack-coverage-skipped')).toHaveTextContent(
      '1 skipped',
    );
    expect(screen.getByTestId('db-pack-coverage-flagged')).toHaveTextContent(
      '1 flagged',
    );

    // File tree lists every persisted file row.
    expect(
      screen.getByTestId('db-pack-file-liquibase/db.changelog-master.xml'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        'db-pack-file-liquibase/changesets/010-tables/dbo.orders.sql',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('db-pack-file-manifest.json')).toBeInTheDocument();

    // Clicking a file previews its content.
    fireEvent.click(
      screen.getByTestId(
        'db-pack-file-liquibase/changesets/010-tables/dbo.orders.sql',
      ),
    );
    expect(screen.getByTestId('db-pack-file-preview')).toHaveTextContent(
      'CREATE TABLE dbo.orders',
    );

    // Manifest highlights: phase ordering + delta strategy + disposition.
    expect(screen.getByTestId('db-pack-phase-ordering')).toHaveTextContent(
      'Bulk load all tables',
    );
    expect(screen.getByTestId('db-pack-delta-dbo.orders')).toHaveTextContent(
      'order_id',
    );
    expect(
      screen.getByTestId('db-pack-disposition-dbo.orders.row_ver'),
    ).toHaveTextContent('flagged');

    // No stale banner when the pack is fresh.
    expect(screen.queryByTestId('db-pack-stale-banner')).not.toBeInTheDocument();
  });

  it('decision queue lists open decisions, filters by category, and bulk-resolve surfaces the stale state + enabled Regenerate', async () => {
    const freshPack = buildPack();
    const stalePack = buildPack({
      status: 'stale',
      is_stale: true,
      staleness_reason: 'decision_resolved: 2 pack decisions resolved since generation',
    });
    mockListPacks.mockResolvedValue([freshPack]);
    // First GET (initial load) is fresh; every later GET (post-resolve
    // refresh) reports stale.
    mockGetPack.mockResolvedValueOnce(freshPack).mockResolvedValue(stalePack);
    mockListFiles.mockResolvedValue(FILES);

    const decisions = [
      buildDecision(),
      buildDecision({
        id: 'dec-2',
        decision_key: 'type_mapping--dbo.orders.legacy_flag',
        object_ref: 'dbo.orders.legacy_flag',
      }),
    ];
    mockListDecisions
      .mockResolvedValueOnce(decisions)
      .mockResolvedValue(
        decisions.map((d) => ({
          ...d,
          status: 'resolved',
          resolution_json: { option: 'bytea' },
        })),
      );
    mockBulkResolve.mockResolvedValue([]);

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-section-decisions')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('db-pack-section-decisions'));

    // Both open decisions render.
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-decision-row-dec-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-decision-row-dec-2')).toBeInTheDocument();

    // Category filter: nothing matches `collation`, everything matches
    // `type_mapping` again after switching back.
    fireEvent.change(screen.getByTestId('db-pack-decisions-category-filter'), {
      target: { value: 'collation' },
    });
    expect(screen.getByTestId('db-pack-decisions-empty')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('db-pack-decisions-category-filter'), {
      target: { value: 'type_mapping' },
    });
    expect(screen.getByTestId('db-pack-decision-row-dec-1')).toBeInTheDocument();

    // Status filter exists and narrows by status.
    fireEvent.change(screen.getByTestId('db-pack-decisions-status-filter'), {
      target: { value: 'resolved' },
    });
    expect(screen.getByTestId('db-pack-decisions-empty')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('db-pack-decisions-status-filter'), {
      target: { value: 'open' },
    });

    // Bulk: select all open + shared option -> one atomic resolve-bulk call.
    fireEvent.click(screen.getByTestId('db-pack-decisions-select-all'));
    fireEvent.change(screen.getByTestId('db-pack-decisions-bulk-option'), {
      target: { value: 'bytea' },
    });
    fireEvent.click(screen.getByTestId('db-pack-decisions-bulk-resolve'));

    await waitFor(() =>
      expect(mockBulkResolve).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        ['dec-1', 'dec-2'],
        { option: 'bytea' },
      ),
    );

    // Resolving marks the pack stale -> banner + ENABLED Regenerate.
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-stale-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-regenerate-button')).toBeEnabled();

    // NEVER auto-regenerate: the explicit button was not clicked.
    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('renders the staleness banner when is_stale with NO auto-regenerate call', async () => {
    const stalePack = buildPack({
      status: 'stale',
      is_stale: true,
      staleness_reason: 'input_snapshot_hash mismatch',
    });
    mockListPacks.mockResolvedValue([stalePack]);
    mockGetPack.mockResolvedValue(stalePack);
    mockListFiles.mockResolvedValue(FILES);

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-stale-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-stale-banner')).toHaveTextContent(
      'Stale — inputs changed since generation',
    );
    // Regenerate is enabled but EXPLICIT only — nothing fired it.
    expect(screen.getByTestId('db-pack-regenerate-button')).toBeEnabled();
    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // --- decision-binding target threading (2026-09-02) -----------------------
  // The generated manifest used to persist `target_architecture_id: null`
  // because this client omitted the target entirely; the plan's
  // ensureFreshDbMigrationPack then saw "different binding" and regenerated
  // the pack needlessly. Generate/Regenerate now resolve active → saved and
  // thread the id; resolution failure is fail-soft (never blocks the action).

  it('Generate resolves the binding target (saved fallback) and threads it to the API call', async () => {
    mockListPacks.mockResolvedValue([]); // empty state -> Generate button
    mockGetActiveTarget.mockResolvedValue(null);
    mockGetSavedTarget.mockResolvedValue('target-saved-1');
    mockGenerate.mockResolvedValue({
      pack: buildPack(),
      input_snapshot_hash: 'hash-2',
      counts: { translated_count: 2, skipped_count: 1, flagged_count: 1 },
      file_count: 3,
      decision_count: 0,
    });
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);

    renderView();

    const generate = await screen.findByTestId('db-pack-generate-button');
    fireEvent.click(generate);

    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID,
        undefined,
        'target-saved-1',
      ),
    );
    expect(mockGetActiveTarget).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockGetSavedTarget).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('Regenerate binds to the ACTIVE target when one exists (saved never consulted)', async () => {
    const stalePack = buildPack({
      status: 'stale',
      is_stale: true,
      staleness_reason: 'inputs changed since generation',
    });
    mockListPacks.mockResolvedValue([stalePack]);
    mockGetPack.mockResolvedValue(stalePack);
    mockListFiles.mockResolvedValue(FILES);
    mockGetActiveTarget.mockResolvedValue('target-active-1');
    mockRegenerate.mockResolvedValue({
      pack: buildPack(),
      input_snapshot_hash: 'hash-3',
      counts: { translated_count: 2, skipped_count: 1, flagged_count: 1 },
      file_count: 3,
      decision_count: 0,
    });

    renderView();

    const regenerate = await screen.findByTestId('db-pack-regenerate-button');
    fireEvent.click(regenerate);

    await waitFor(() =>
      expect(mockRegenerate).toHaveBeenCalledWith(
        PROJECT_ID,
        ARCH_ID,
        undefined,
        'target-active-1',
      ),
    );
    expect(mockGetSavedTarget).not.toHaveBeenCalled();
  });

  it('target resolution failure is FAIL-SOFT: generation still fires, unbound', async () => {
    mockListPacks.mockResolvedValue([]);
    mockGetActiveTarget.mockRejectedValue(new Error('lookup down'));
    mockGenerate.mockResolvedValue({
      pack: buildPack(),
      input_snapshot_hash: 'hash-2',
      counts: { translated_count: 2, skipped_count: 1, flagged_count: 1 },
      file_count: 3,
      decision_count: 0,
    });
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);

    renderView();

    fireEvent.click(await screen.findByTestId('db-pack-generate-button'));

    // The action proceeds with a null binding — the gateway reader resolves
    // server-side and the manifest still records the actual binding.
    await waitFor(() =>
      expect(mockGenerate).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, undefined, null),
    );
  });

  it('epic picker attaches the chosen book-of-work epic via PATCH work_item_id', async () => {
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);
    mockListBooks.mockResolvedValue([
      {
        id: 'draft-1',
        title: 'Migration plan',
        bookOfWork: {
          items: [
            { id: 'epic-db-1', type: 'epic', title: 'DB schema migration epic' },
            { id: 'story-1', type: 'story', title: 'Some story' },
          ],
        },
      },
    ]);
    mockAttachWorkItem.mockResolvedValue({
      ...buildPack(),
      work_item_id: 'epic-db-1',
    });

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-epic-picker-select')).toBeInTheDocument(),
    );
    // Only EPIC items are offered.
    await waitFor(() =>
      expect(
        screen.getByRole('option', {
          name: 'DB schema migration epic (Migration plan)',
        }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('option', { name: /Some story/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('db-pack-epic-picker-select'), {
      target: { value: 'epic-db-1' },
    });
    fireEvent.click(screen.getByTestId('db-pack-epic-picker-attach'));

    await waitFor(() =>
      expect(mockAttachWorkItem).toHaveBeenCalledWith(
        PROJECT_ID,
        PACK_ID,
        'epic-db-1',
      ),
    );
    // The attached chip replaces the picker.
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-attached-epic-chip')).toHaveTextContent(
        'epic-db-1',
      ),
    );
  });

  it('MigrationBookOfWorkItemDrawer shows the pack chip with a download action on the attached epic', () => {
    const epicItem: MigrationBookOfWorkItem = {
      id: 'epic-db-1',
      type: 'epic',
      parentId: null,
      title: 'DB schema migration epic',
      description: 'Migrate the schema.',
      acceptanceCriteria: [],
      workstream: 'target_database_schema_implementation',
      sequenceOrder: 1,
      tags: [],
      confidence: 'high',
      readiness: 'ready_for_spec',
      readinessReasons: [],
      missingInputs: [],
      recommendedNextAction: '',
      traceabilitySummary: '',
      evidenceReferences: [],
      architectureReferences: [],
      apiBaselineReferences: [],
      discoveryFindingReferences: [],
      mappingReferences: [],
      sourceContextRefs: [],
    };
    const onDownload = vi.fn();

    render(
      <MigrationBookOfWorkItemDrawer
        item={epicItem}
        dbMigrationPack={{ packId: PACK_ID, workItemId: 'epic-db-1' }}
        onDownloadDbMigrationPack={onDownload}
      />,
    );

    expect(
      screen.getByTestId('item-drawer-db-migration-pack-chip'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('item-drawer-db-migration-pack-download'),
    );
    expect(onDownload).toHaveBeenCalledWith(PACK_ID);
  });
  it('Regenerate stays ENABLED on a non-stale pack (2026-08-09 — staleness is a signal, never a lock)', async () => {
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);

    renderView();

    await waitFor(() =>
      expect(screen.getByTestId('db-pack-regenerate-button')).toBeInTheDocument(),
    );
    // buildPack() is is_stale: false — the button is enabled regardless; the
    // stale BANNER (absent here) is the change signal, not button state.
    expect(screen.getByTestId('db-pack-regenerate-button')).toBeEnabled();
    expect(screen.queryByTestId('db-pack-stale-banner')).toBeNull();
    expect(mockRegenerate).not.toHaveBeenCalled();
  });
});


describe('untranslated-block key uniqueness (2026-08-30 duplicate-key bug)', () => {
  it('an object in BOTH lists plus a repeated ref renders without React key collisions', async () => {
    // Pre-fix both sibling lists keyed `${kind}-${object_ref}`; an object in
    // both (or repeated in one) collided and React duplicated whole sibling
    // subtrees on the next re-render — the thrice-rendered findings panel.
    const manifest = {
      ...MANIFEST,
      requires_translation_spec_2: [
        { kind: 'stored_procedure', object_ref: 'dbo.sp_calc', finding_ids: [] },
        { kind: 'stored_procedure', object_ref: 'dbo.sp_calc', finding_ids: [] },
      ],
      manual_recreation: [
        { kind: 'stored_procedure', object_ref: 'dbo.sp_calc', finding_ids: [] },
      ],
    };
    mockListPacks.mockResolvedValue([buildPack({ manifest_json: manifest })]);
    mockGetPack.mockResolvedValue(buildPack({ manifest_json: manifest }));
    mockListFiles.mockResolvedValue(FILES);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderView();
      await waitFor(() =>
        expect(screen.getByTestId('db-pack-untranslated')).toBeInTheDocument(),
      );
      const keyWarnings = errorSpy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes('two children with the same key'),
      );
      expect(keyWarnings).toEqual([]);
      // Every entry renders exactly once (2 requires-translation + 1 manual).
      const section = screen.getByTestId('db-pack-untranslated');
      expect(section.querySelectorAll('p').length).toBe(3);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('the structural-findings panel renders exactly ONCE across sub-tab switches (2026-09-02 sibling-key collision)', async () => {
    // Pre-fix the always-mounted findings panel and the conditionally-mounted
    // decision queue were SIBLINGS carrying the identical remount key
    // `${pack.id}-${pack.generated_at}`. Mounting the queue (Decisions
    // sub-tab) collided with the panel's key, reconciliation lost track of
    // which child was which, and a duplicated "Structural findings" section
    // stuck around across the Drift-reports / Translations switches. The keys
    // are now role-namespaced; this drives the exact click path.
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);
    mockListDecisions.mockResolvedValue([]);
    mockListDriftReports.mockResolvedValue([]);
    // One open finding so the panel actually renders its section.
    mockListStructuralFindings.mockResolvedValue({
      findings: [
        {
          key: 'missing_fk_columns:all_relationships',
          kind: 'missing_fk_columns',
          subject: 'all_relationships',
          message:
            '28 relationship(s) carry no fk_columns join metadata — 020-foreign-keys.sql will be EMPTY.',
          disposition: null,
          note: null,
          open: true,
        },
      ],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderView();
      await waitFor(() =>
        expect(screen.getAllByTestId('db-pack-structural-findings')).toHaveLength(1),
      );

      // The collision fired on the queue MOUNT and the duplicate persisted
      // across later switches — walk the reported path.
      for (const section of ['decisions', 'contents', 'drift', 'decisions'] as const) {
        fireEvent.click(screen.getByTestId(`db-pack-section-${section}`));
        // Exactly one findings section after EVERY switch — the duplicate
        // panel was visible immediately, so a plain length assert catches it.
        await waitFor(() =>
          expect(screen.getAllByTestId('db-pack-structural-findings')).toHaveLength(1),
        );
      }

      const keyWarnings = errorSpy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes('two children with the same key'),
      );
      expect(keyWarnings).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('stored proc call-site compatibility (Spec 2, 2026-09-09)', () => {
  it('renders the counts and the needs-change rows when the manifest carries the section', async () => {
    const manifest = {
      ...MANIFEST,
      call_site_compatibility: {
        compatible: 3,
        needs_change: 1,
        unknown: 2,
        rule_id: 'SYBPG.PROC.CALLSITE.001',
        undescribed_routines: [],
        sites: [
          {
            endpoint_id: 'ep-1',
            routine: 'upd_ledger_roll',
            pattern: 'jdbc_call_return',
            verdict: 'needs_change',
            reason: 'a set-returning function has no return value; drop the ? = and read the result set',
            shape: 'single_result_set',
          },
          {
            endpoint_id: 'ep-2',
            routine: 'upd_ledger_roll',
            pattern: 'jdbc_call',
            verdict: 'compatible',
            reason: null,
            shape: 'single_result_set',
          },
        ],
      },
    } as unknown as DbMigrationPackManifest;
    mockListPacks.mockResolvedValue([buildPack({ manifest_json: manifest })]);
    mockGetPack.mockResolvedValue(buildPack({ manifest_json: manifest }));
    mockListFiles.mockResolvedValue(FILES);

    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-call-site-compatibility')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('db-pack-call-site-counts')).toHaveTextContent('3 compatible');
    expect(screen.getByTestId('db-pack-call-site-counts')).toHaveTextContent('1 need a change');
    expect(screen.getByTestId('db-pack-call-site-counts')).toHaveTextContent('2 unknown');
    const section = screen.getByTestId('db-pack-call-site-compatibility');
    expect(section.querySelectorAll('tbody tr').length).toBe(1);
    expect(section).toHaveTextContent('drop the ? = and read the result set');
  });

  it('renders nothing for a pre-catalog manifest without the section', async () => {
    mockListPacks.mockResolvedValue([buildPack()]);
    mockGetPack.mockResolvedValue(buildPack());
    mockListFiles.mockResolvedValue(FILES);
    renderView();
    await waitFor(() =>
      expect(screen.getByTestId('db-pack-coverage-summary')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('db-pack-call-site-compatibility')).toBeNull();
  });
});
