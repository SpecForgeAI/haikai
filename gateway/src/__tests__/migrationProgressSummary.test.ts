/**
 * Stakeholder progress summary aggregation (2026-08-16).
 *
 * Pure-DI tests: every read is injected, nothing hits the network. Covers the
 * mid-execution state (sections populated, buckets partition exactly), the
 * pre-execution state (current facts only, target/buckets null => TBC cells),
 * and the empty-book scope default.
 */

import {
  LatestDataMigrationReport,
  LatestDataParityReportRow,
  ProgressSummaryDeps,
  ServiceInventory,
  computeMigrationProgressSummary,
} from '../services/migrationProgressSummary';
import type { MigrationExecutionRun } from '../services/migrationExecutionRunClient';
import type { MigrationReconciliationBreak } from '../services/migrationReconciliationBreakClient';
import type { PackView } from '../services/migrationDbPackPlanner';
import type { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import type { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

const PROJECT = 'proj-1';
const CURRENT_ARCH = 'arch-current';
const TARGET_ARCH = 'arch-target';
const BOOK = 'book-1';

function baseBook() {
  return {
    id: BOOK,
    project_id: PROJECT,
    current_architecture_id: CURRENT_ARCH,
    target_architecture_id: TARGET_ARCH,
    status: 'saved',
    book_of_work_json: {
      items: [
        {
          id: 'i-db1',
          type: 'story',
          title: 'Schema cluster 1',
          workItemId: 'w-db1',
          workstream: 'target_database_schema_implementation',
        },
        {
          id: 'i-s1',
          type: 'story',
          title: 'Orders API',
          workItemId: 'w-s1',
          tags: ['stream:api_migration'],
          apiEndpointIds: ['ep1', 'ep2'],
        },
        {
          id: 'i-s2',
          type: 'story',
          title: 'Billing API',
          workItemId: 'w-s2',
          tags: ['stream:api_migration'],
          apiEndpointIds: ['ep3'],
        },
        {
          id: 'i-m1',
          type: 'story',
          title: 'Manual parity sign-off',
          workItemId: 'w-m1',
          tags: ['execution:manual', 'stream:api_migration'],
        },
      ],
    },
  };
}

function baseContext(): MigrationDiscoveryContext {
  return {
    projectId: PROJECT,
    currentArchitectureId: CURRENT_ARCH,
    targetArchitectureId: TARGET_ARCH,
    generatedAt: '2026-08-16T00:00:00Z',
    currentArchitectureSummary: {
      architectureId: CURRENT_ARCH,
      name: 'Current',
      serviceCount: 1,
      interfaceCount: 2,
    },
    targetArchitectureSummary: {
      architectureId: TARGET_ARCH,
      name: 'Target',
      interfaceCount: 2,
    },
    discoveryRunsSummary: {
      totalRuns: 2,
      completedRuns: 2,
      runs: [
        {
          runId: 'r-db',
          architectureId: CURRENT_ARCH,
          status: 'COMPLETED',
          discoveryKind: 'database',
          createdAt: '',
          updatedAt: '',
        },
        {
          runId: 'r-code',
          architectureId: CURRENT_ARCH,
          status: 'COMPLETED',
          discoveryKind: 'code',
          createdAt: '',
          updatedAt: '',
        },
      ],
    },
    findingsSummary: { totalFindings: 10 },
    databaseDiscoverySummary: {
      databaseFindingCount: 4,
      hasDatabaseDiscovery: true,
      sourceEngines: ['sybase'],
    },
    apiBehaviourBaselineSummary: { totalBaselines: 1, activeBaselineCount: 1 },
  };
}

function baseDecisions(): TargetStateCapturedDecision[] {
  return [
    { decisionCode: 'db.engine', answerSummary: 'PostgreSQL 18' },
    { decisionCode: 'service.runtime', answerSummary: 'Java 21' },
    { decisionCode: 'service.framework', answerSummary: 'Spring Boot 3' },
  ] as TargetStateCapturedDecision[];
}

function basePackView(): PackView {
  return {
    packId: 'pack-1',
    status: 'generated',
    inputSnapshotHash: null,
    manifest: {
      bulk_load: { table_order: ['dbo.t1', 'dbo.t2', 'dbo.t3'] },
      structural_accounting: {
        code_objects_captured: {
          stored_procedure: 3,
          trigger: 0,
          view: 2,
          scheduled_job: 0,
        },
      },
    } as unknown as PackView['manifest'],
    decisions: [],
    translations: [
      {
        translation_key: 'view:v1',
        object_ref: 'dbo.v1',
        kind: 'view',
        disposition: 'translate',
        review_status: 'approved',
      },
      {
        translation_key: 'proc:p1',
        object_ref: 'dbo.p1',
        kind: 'stored_procedure',
        disposition: 'translate',
        review_status: 'approved',
      },
      {
        translation_key: 'proc:p2',
        object_ref: 'dbo.p2',
        kind: 'stored_procedure',
        disposition: 'translate',
        review_status: 'unreviewed',
      },
    ],
  };
}

function baseLoadReport(): LatestDataMigrationReport {
  return {
    status: 'divergent',
    migration_pair: 'sybase__postgresql',
    tables_total: 3,
    rows_loaded: 70,
    report_json: {
      tables: [
        { schema: 'dbo', table: 't1', status: 'loaded', sourceCount: 50, loadedCount: 50, targetCount: 50 },
        { schema: 'dbo', table: 't2', status: 'reconciled_mismatch', sourceCount: 30, loadedCount: 20, targetCount: 20 },
        { schema: 'dbo', table: 't3', status: 'unverifiable', sourceCount: 20, loadedCount: 0, reason: 'driver error' },
      ],
    },
  };
}

function baseParityReport(): LatestDataParityReportRow {
  return {
    status: 'divergent',
    report_json: {
      tables: [
        { schema: 'dbo', table: 't1', verdict: 'match', source_count: 50, target_count: 50 },
        {
          schema: 'dbo',
          table: 't2',
          verdict: 'divergent',
          divergence_class: 'count_mismatch',
          source_count: 30,
          target_count: 20,
        },
      ],
    },
  };
}

/**
 * Internal-aware inventory fixtures (shakedown fix 2026-08-16): the current
 * architecture carries an INTERNAL_PROCESSING interface owning ep-int — it is
 * counted in the discovery totals but excluded from every external count.
 */
function currentInventoryFixture(): ServiceInventory {
  return {
    interfacesTotal: 3, // ext-if1, ext-if2, int-if (INTERNAL_PROCESSING)
    externalInterfaces: 2,
    endpointsTotal: 4, // ep1, ep2, ep3 external + ep-int internal
    externalEndpointIds: new Set(['ep1', 'ep2', 'ep3']),
    endpointIdByKey: new Map([
      ['GET /a', 'ep1'],
      ['POST /b', 'ep2'],
      ['GET /c', 'ep3'],
    ]),
  };
}

function targetInventoryFixture(): ServiceInventory {
  return {
    interfacesTotal: 2,
    externalInterfaces: 2,
    endpointsTotal: 2,
    externalEndpointIds: new Set(['tep1', 'tep2']),
    endpointIdByKey: new Map([
      ['GET /a', 'tep1'],
      ['POST /b', 'tep2'],
    ]),
  };
}

function baselineItemsFixture() {
  return [
    { id: 'bi1', method: 'GET', path: '/a', scenario_name: 'happy' },
    { id: 'bi2', method: 'GET', path: '/a', scenario_name: 'error' },
    { id: 'bi3', method: 'POST', path: '/b', scenario_name: 'happy' },
    { id: 'bi4', method: 'POST', path: '/b', scenario_name: 'alt' },
    { id: 'bi5', method: 'GET', path: '/c', scenario_name: 'happy' },
  ];
}

function makeDeps(overrides: Partial<ProgressSummaryDeps> = {}): ProgressSummaryDeps {
  const deps: ProgressSummaryDeps = {
    fetchBookOfWork: async () => baseBook(),
    fetchSpecGenerationsForBook: async () => [
      { work_item_id: 'w-db1', status: 'generated', generation_attempt_number: 1 },
      { work_item_id: 'w-s1', status: 'generated', generation_attempt_number: 1 },
      { work_item_id: 'w-s2', status: 'generated', generation_attempt_number: 1 },
    ],
    getRunsForBook: async () => [],
    fetchDiscoveryContext: async () => baseContext(),
    fetchActiveCurrentBaseline: async () => ({ id: 'bl1', kind: 'current', status: 'active' }),
    fetchBaselineItems: async () => baselineItemsFixture(),
    fetchLatestCapturedDecisions: async () => baseDecisions(),
    fetchPackView: async () => basePackView(),
    fetchLatestDataMigrationReport: async () => null,
    fetchLatestDataParityReport: async () => null,
    getBreaksForRun: async () => [],
    listDiscoveryRuns: async () => [
      { id: 'r-db', status: 'COMPLETED', discovery_kind: 'database' },
      { id: 'r-code', status: 'COMPLETED', discovery_kind: 'code' },
    ],
    countFindingsForRun: async (_projectId, _architectureId, runId) =>
      runId === 'r-db' ? 4 : 6,
    fetchServiceInventory: async (_projectId, architectureId) =>
      architectureId === CURRENT_ARCH ? currentInventoryFixture() : targetInventoryFixture(),
    ...overrides,
  };
  return deps;
}

const ARGS = { projectId: PROJECT, architectureId: CURRENT_ARCH, bookId: BOOK };

describe('computeMigrationProgressSummary', () => {
  it('pre-execution: current facts populate, target/buckets are null (TBC), stages 5-7 not started', async () => {
    const summary = await computeMigrationProgressSummary(ARGS, makeDeps());

    expect(summary.scope).toEqual({ db: true, service: true });
    expect(summary.executed).toBe(false);

    // DB section: structure counts from the pack, rows unknown pre-load.
    expect(summary.db).not.toBeNull();
    expect(summary.db?.current).toEqual({ tables: 3, rows: null, views: 2, procs: 3 });
    expect(summary.db?.target).toBeNull();
    expect(summary.db?.buckets).toBeNull();
    expect(summary.db?.viewsNotMigrated).toBeNull();
    expect(summary.db?.procsNotMigrated).toBeNull();

    // Service section: EXTERNAL-only counts (the INTERNAL_PROCESSING
    // interface + its ep-int are excluded from the 3/4 inventory totals).
    expect(summary.service?.current).toEqual({ interfaces: 2, endpoints: 3 });
    expect(summary.service?.target).toBeNull();
    expect(summary.service?.buckets).toBeNull();
    expect(summary.service?.perOperation).toBeNull();

    const byKey = Object.fromEntries(summary.stages.map((s) => [s.key, s]));
    expect(byKey.db_discovery.status).toBe('complete');
    expect(byKey.db_discovery.facts).toEqual(['8 arch entities', '4 findings']);
    expect(byKey.code_discovery.status).toBe('complete');
    // Discovery entities count the FULL inventory (1 service + 3 interfaces
    // + 4 endpoints, internal included); findings come from the code run.
    expect(byKey.code_discovery.facts).toEqual(['8 arch entities', '6 findings']);
    expect(byKey.live_behaviour.status).toBe('complete');
    expect(byKey.live_behaviour.facts).toEqual(['3 endpoints', '5 captured behaviours']);
    expect(byKey.target_conversation.status).toBe('complete');
    expect(byKey.target_conversation.facts).toEqual(['3 questions answered']);
    expect(byKey.plan_created.status).toBe('complete');
    expect(byKey.plan_created.facts).toEqual(['1 DB specs', '2 service specs']);
    expect(byKey.plan_executed.status).toBe('not_started');
    expect(byKey.reconciliation.status).toBe('not_started');

    expect(summary.currentStateLabel).toBe('Sybase');
    expect(summary.targetStateLabel).toBe('PostgreSQL 18 / Java 21');
  });

  it('mid-execution: buckets partition the current-state totals exactly and stages reflect the run', async () => {
    const runs: MigrationExecutionRun[] = [
      {
        id: 'run-1',
        status: 'started',
        items: [
          { id: 'ri1', work_item_id: 'w-db1', status: 'deployed', sequence_position: 1 },
          { id: 'ri2', work_item_id: 'w-s1', status: 'deployed', sequence_position: 2 },
          { id: 'ri3', work_item_id: 'w-s2', status: 'failed', sequence_position: 3 },
        ],
      },
    ];
    const breaks: MigrationReconciliationBreak[] = [
      { id: 'b1', disposition_status: 'open', detail_json: { method: 'get', path: '/a' } },
      { id: 'b2', disposition_status: 'accepted', detail_json: { method: 'POST', path: '/b' } },
      { id: 'b3', disposition_status: 'fixed_confirmed', detail_json: { method: 'POST', path: '/b' } },
    ];
    const summary = await computeMigrationProgressSummary(
      ARGS,
      makeDeps({
        getRunsForBook: async () => runs,
        getBreaksForRun: async () => breaks,
        fetchLatestDataMigrationReport: async () => baseLoadReport(),
        fetchLatestDataParityReport: async () => baseParityReport(),
      }),
    );

    // DB: current rows = sum of sourceCount; target from the reports.
    expect(summary.db?.current).toEqual({ tables: 3, rows: 100, views: 2, procs: 3 });
    expect(summary.db?.target).toEqual({ tables: 2, rows: 70, views: 1, procs: 1 });
    // Worst -> best partition: t3 failed load, t2 count mismatch, t1 clean.
    expect(summary.db?.buckets).toEqual({
      failedToLoad: 1,
      rowCountMismatch: 1,
      dataMismatch: 0,
      fullyReconciled: 1,
    });
    const b = summary.db?.buckets;
    expect(
      (b?.failedToLoad ?? 0) + (b?.rowCountMismatch ?? 0) + (b?.dataMismatch ?? 0) + (b?.fullyReconciled ?? 0),
    ).toBe(summary.db?.current.tables);
    expect(summary.db?.viewsNotMigrated).toBe(1);
    expect(summary.db?.procsNotMigrated).toBe(2);

    // Service: ep3's story failed to migrate; ep1 has an open break; ep2 clean.
    expect(summary.service?.buckets).toEqual({
      failedToMigrate: 1,
      failedReconciliation: 1,
      fullyReconciled: 1,
    });
    const sb = summary.service?.buckets;
    expect(
      (sb?.failedToMigrate ?? 0) + (sb?.failedReconciliation ?? 0) + (sb?.fullyReconciled ?? 0),
    ).toBe(summary.service?.current.endpoints);
    // Per-operation rollup: 5 replayed, 3 breaks -> 2 matching; dispositions.
    expect(summary.service?.perOperation).toEqual({
      replayed: 5,
      matching: 2,
      underInvestigation: 1,
      accepted: 1,
      fixed: 1,
    });
    // Service plane not deployed -> target stays TBC.
    expect(summary.service?.target).toBeNull();
    expect(summary.executed).toBe(false);

    const byKey = Object.fromEntries(summary.stages.map((s) => [s.key, s]));
    expect(byKey.plan_executed.status).toBe('in_progress');
    expect(byKey.plan_executed.facts).toEqual(['2/3 specs']);
    expect(byKey.reconciliation.status).toBe('in_progress');
    expect(byKey.reconciliation.facts).toEqual(['in progress']);
  });

  it('deployed run marks the plane executed and unlocks the service target block', async () => {
    const runs: MigrationExecutionRun[] = [
      {
        id: 'run-2',
        status: 'deployed',
        items: [
          { id: 'ri1', work_item_id: 'w-db1', status: 'deployed', sequence_position: 1 },
          { id: 'ri2', work_item_id: 'w-s1', status: 'deployed', sequence_position: 2 },
          { id: 'ri3', work_item_id: 'w-s2', status: 'deployed', sequence_position: 3 },
        ],
      },
    ];
    const summary = await computeMigrationProgressSummary(
      ARGS,
      makeDeps({
        getRunsForBook: async () => runs,
        fetchLatestDataMigrationReport: async () => baseLoadReport(),
        fetchLatestDataParityReport: async () => baseParityReport(),
      }),
    );
    expect(summary.executed).toBe(true);
    expect(summary.service?.target).toEqual({ interfaces: 2, endpoints: 2 });
    const byKey = Object.fromEntries(summary.stages.map((s) => [s.key, s]));
    expect(byKey.plan_executed.status).toBe('complete');
    expect(byKey.plan_executed.facts).toEqual(['3/3 specs']);
    // DB divergences remain -> reconciliation still in progress, never complete.
    expect(byKey.reconciliation.status).toBe('in_progress');
  });

  it('BUG-1 regression: a completed code run evicted from the context highlights still completes the stage', async () => {
    // The discovery-context roll-up CAPS its run highlights to the most
    // recent runs — on the live system a later DB run evicted the completed
    // code run and the banner showed "not started". The runs LIST is the
    // authoritative source; the context highlights only carry the DB run here.
    const context = baseContext();
    context.discoveryRunsSummary = {
      totalRuns: 2,
      completedRuns: 1,
      runs: [
        {
          runId: 'r-db',
          architectureId: CURRENT_ARCH,
          status: 'COMPLETED',
          discoveryKind: 'database',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    const summary = await computeMigrationProgressSummary(
      ARGS,
      makeDeps({ fetchDiscoveryContext: async () => context }),
    );
    const byKey = Object.fromEntries(summary.stages.map((s) => [s.key, s]));
    expect(byKey.code_discovery.status).toBe('complete');
    expect(byKey.code_discovery.facts).toContain('6 findings');
  });

  it('empty book defaults both planes into scope with a warning', async () => {
    const summary = await computeMigrationProgressSummary(
      ARGS,
      makeDeps({
        fetchBookOfWork: async () => ({
          id: BOOK,
          target_architecture_id: TARGET_ARCH,
          book_of_work_json: { items: [] },
        }),
        fetchSpecGenerationsForBook: async () => [],
      }),
    );
    expect(summary.scope).toEqual({ db: true, service: true });
    expect(summary.warnings.some((w) => w.includes('no stories'))).toBe(true);
    const byKey = Object.fromEntries(summary.stages.map((s) => [s.key, s]));
    expect(byKey.plan_created.status).toBe('not_started');
    expect(byKey.plan_created.facts).toEqual(['not started']);
  });

  it('fails soft: every read throwing still returns a summary with warnings', async () => {
    const boom = async () => {
      throw new Error('read failed');
    };
    const summary = await computeMigrationProgressSummary(
      ARGS,
      makeDeps({
        fetchBookOfWork: boom as unknown as ProgressSummaryDeps['fetchBookOfWork'],
        fetchSpecGenerationsForBook: boom as unknown as ProgressSummaryDeps['fetchSpecGenerationsForBook'],
        getRunsForBook: boom as unknown as ProgressSummaryDeps['getRunsForBook'],
        fetchDiscoveryContext: async () => null,
        fetchActiveCurrentBaseline: boom as unknown as ProgressSummaryDeps['fetchActiveCurrentBaseline'],
        fetchLatestCapturedDecisions: boom as unknown as ProgressSummaryDeps['fetchLatestCapturedDecisions'],
        fetchPackView: boom as unknown as ProgressSummaryDeps['fetchPackView'],
        fetchLatestDataMigrationReport: boom as unknown as ProgressSummaryDeps['fetchLatestDataMigrationReport'],
        fetchLatestDataParityReport: boom as unknown as ProgressSummaryDeps['fetchLatestDataParityReport'],
        getBreaksForRun: boom as unknown as ProgressSummaryDeps['getBreaksForRun'],
        listDiscoveryRuns: boom as unknown as ProgressSummaryDeps['listDiscoveryRuns'],
        countFindingsForRun: boom as unknown as ProgressSummaryDeps['countFindingsForRun'],
        fetchServiceInventory: boom as unknown as ProgressSummaryDeps['fetchServiceInventory'],
      }),
    );
    expect(summary.stages.length).toBeGreaterThan(0);
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.db?.current.tables).toBeNull();
    expect(summary.service?.buckets).toBeNull();
  });
});
