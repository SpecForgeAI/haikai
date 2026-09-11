/**
 * Implement-only completion (2026-09-11, start-from-work-item).
 *
 * A run created with completionMode 'implement_mr' implements, pushes and opens
 * its MR, then STOPS: the batch submit carries deploy_on_complete=false even
 * for a service-plane batch, the `implemented` callback completes the run at
 * the `implemented` status (never deployed), and the DB execution chain is
 * never kicked for a db-plane batch. Runs without the marker are unchanged.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  runBatchSegment,
  advanceRunOnBuildResult,
  runCompletionModeOf,
  DispatchDescriptor,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
} from '../services/migrationExecutionRunClient';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function deps(overrides: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue({
      id: BOOK_ID,
      book_of_work_json: {
        items: [
          { id: 's1', type: 'story', title: 'Story 1', sequenceOrder: 0, workItemId: 'wi-1', workstream: 'service_implementation' },
          { id: 's2', type: 'story', title: 'Story 2', sequenceOrder: 1, workItemId: 'wi-2', workstream: 'service_implementation' },
        ],
      },
    }),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([]),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
    fetchActiveCurrentBaseline: jest.fn().mockResolvedValue(null),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn(),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-seq', status: 'queued' }),
    submitOrchestrationBatch: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-batch', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: { driveAndAnswer: jest.fn() },
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    getTargetServeSpec: jest.fn().mockReturnValue({ command: 'mvn spring-boot:run', healthPath: '/actuator/health' }),
    runDbPlaneCompletion: jest.fn().mockResolvedValue(undefined),
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as MigrationDriverDeps;
}

const scope: MigrateScope = {
  projectId: PROJECT_ID,
  bookId: BOOK_ID,
  company: 'acme',
  project: 'order-mig',
  batchName: 'orders-feature-ab12',
};

function implementOnlyRun(status: string, itemStatus: string, workstreamPlane: 'service' | 'db' = 'service'): MigrationExecutionRun {
  return {
    id: 'run-1',
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status,
    decision_log_json: [
      { type: 'run_base_mode', mode: 'chain', at: '2026-09-11T00:00:00Z' },
      { type: 'run_completion_mode', mode: 'implement_mr', at: '2026-09-11T00:00:00Z' },
    ],
    items: [
      { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', job_id: 'job-batch', status: itemStatus, deploy_on_complete: false },
      { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-2', job_id: 'job-batch', status: itemStatus, deploy_on_complete: true },
    ],
    ...(workstreamPlane === 'db' ? {} : {}),
  };
}

function descriptorsFor(plane: 'service' | 'db'): DispatchDescriptor[] {
  const workstream = plane === 'db' ? 'target_database_schema_implementation' : 'service_implementation';
  return [0, 1].map((i) => ({
    sequencePosition: i,
    workItemId: `wi-${i + 1}`,
    specGenerationId: `sg-${i + 1}`,
    bookItemId: `s${i + 1}`,
    generatedSpecText: `/agent-os:shape-spec Story ${i + 1}`,
    title: `Story ${i + 1}`,
    deployOnComplete: i === 1,
    workstream,
    plane,
  }));
}

describe('runCompletionModeOf', () => {
  it("reads 'implement_mr' from the decision log and defaults to 'deploy'", () => {
    expect(runCompletionModeOf(implementOnlyRun(RUN_STATUS.DISPATCHING, 'pending'))).toBe('implement_mr');
    expect(runCompletionModeOf({ id: 'r', decision_log_json: [] })).toBe('deploy');
    expect(runCompletionModeOf(null)).toBe('deploy');
  });
});

describe('runBatchSegment — implement-only never asks IVS to deploy', () => {
  it('a SERVICE-plane batch submits with deploy_on_complete=false (a normal service batch deploys)', async () => {
    const d = deps();
    await runBatchSegment(scope, implementOnlyRun(RUN_STATUS.STARTED, 'pending'), implementOnlyRun(RUN_STATUS.STARTED, 'pending').items!, descriptorsFor('service'), d);
    expect(d.submitOrchestrationBatch).toHaveBeenCalledTimes(1);
    expect((d.submitOrchestrationBatch as jest.Mock).mock.calls[0][0].deployOnComplete).toBe(false);

    const plain = deps();
    const normal = { ...implementOnlyRun(RUN_STATUS.STARTED, 'pending'), decision_log_json: [] };
    await runBatchSegment(scope, normal, normal.items!, descriptorsFor('service'), plain);
    expect((plain.submitOrchestrationBatch as jest.Mock).mock.calls[0][0].deployOnComplete).toBe(true);
  });
});

describe('advanceRunOnBuildResult — implement-only completes at `implemented`', () => {
  it("marks every sibling implemented and the run 'implemented' (never deployed); no DB chain for a db-plane batch", async () => {
    for (const plane of ['service', 'db'] as const) {
      const run = implementOnlyRun(RUN_STATUS.DISPATCHING, RUN_ITEM_STATUS.SUBMITTED, plane);
      const d = deps({
        findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
        getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      });
      const decision = await advanceRunOnBuildResult(
        { company: 'acme', project: 'order-mig', jobId: 'job-batch', outcome: 'implemented', prUrl: 'https://git/mr/9' },
        d
      );
      expect(decision).toBe('advanced_run_complete');
      const implementedItems = (d.patchMigrationExecutionRunItem as jest.Mock).mock.calls
        .filter((c) => c[2]?.status === RUN_ITEM_STATUS.IMPLEMENTED)
        .map((c) => c[1])
        .sort();
      expect(implementedItems).toEqual(['ri-0', 'ri-1']);
      const runStatuses = (d.patchMigrationExecutionRun as jest.Mock).mock.calls.map((c) => c[2]?.status);
      expect(runStatuses).toContain(RUN_STATUS.IMPLEMENTED);
      expect(runStatuses).not.toContain(RUN_STATUS.DEPLOYED);
      expect(d.runDbPlaneCompletion).not.toHaveBeenCalled();
    }
  });
});
