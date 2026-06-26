/**
 * Tests for the batch / subset migrate path (2026-06-26): select N work items ->
 * ONE job -> one `feature/<batchName>` branch + one MR. Fully-mocked deps (no AMS
 * round-trip, no live LLM -- the auto-answerer is a mock).
 *
 * Covers:
 *  - buildOrderedDispatchSet restricts to the selected work items;
 *  - evaluateHardBlock gates ONLY the selected stories (unselected are out of scope);
 *  - runBatchSegment auto-answers EVERY selected spec then submits ONE batch with
 *    all spec_intents + the batchName, correlating the single job_id onto ALL items;
 *  - advanceRunOnBuildResult completes the WHOLE batch on the single callback.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  buildOrderedDispatchSet,
  evaluateHardBlock,
  runBatchSegment,
  advanceRunOnBuildResult,
  DispatchDescriptor,
  MigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  RUN_STATUS,
  RUN_ITEM_STATUS,
  MigrationExecutionRun,
  MigrationExecutionRunItem,
} from '../services/migrationExecutionRunClient';
import { BookOfWork, SpecGeneration } from '../services/migrationDriverAmsReads';
import { ShapeSpecAutoAnswerer } from '../services/shapeSpecAutoAnswererSeam';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function readySpec(workItemId: string, text: string, id: string): SpecGeneration {
  return {
    id,
    work_item_id: workItemId,
    status: 'generated',
    generated_spec_text: text,
    stale_reason: null,
    generation_attempt_number: 1,
    created_at: '2026-06-26T00:00:00Z',
  };
}

function threeStoryBook(): BookOfWork {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: 'arch-1',
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 'f1', parentId: null, type: 'feature', title: 'Feature 1', sequenceOrder: 0 },
        { id: 's1', parentId: 'f1', type: 'story', title: 'Story 1', sequenceOrder: 0, workItemId: 'wi-1' },
        { id: 's2', parentId: 'f1', type: 'story', title: 'Story 2', sequenceOrder: 1, workItemId: 'wi-2' },
        { id: 's3', parentId: 'f1', type: 'story', title: 'Story 3', sequenceOrder: 2, workItemId: 'wi-3' },
      ],
    },
  };
}

function threeStorySpecs(): SpecGeneration[] {
  return [
    readySpec('wi-1', 'shape-spec Story 1', 'sg-1'),
    readySpec('wi-2', 'shape-spec Story 2', 'sg-2'),
    readySpec('wi-3', 'shape-spec Story 3', 'sg-3'),
  ];
}

let answerCounter = 0;
function passingAutoAnswerer(): ShapeSpecAutoAnswerer {
  return {
    driveAndAnswer: jest.fn().mockImplementation(async () => {
      answerCounter += 1;
      return {
        ok: true,
        specName: `2026-06-26-folder-${answerCounter}`,
        sessionId: `sess-${answerCounter}`,
        decisionLog: [],
      };
    }),
  };
}

function mockDeps(overrides: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(threeStoryBook()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(threeStorySpecs()),
    fetchWorkItems: jest.fn().mockResolvedValue([]),
    fetchActiveCurrentBaseline: jest
      .fn()
      .mockResolvedValue({ id: 'baseline-1', kind: 'current', status: 'active' }),
    createMigrationExecutionRun: jest.fn(),
    getMigrationExecutionRun: jest.fn(),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-seq', status: 'queued' }),
    submitOrchestrationBatch: jest
      .fn()
      .mockResolvedValue({ ok: true, jobId: 'job-batch', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: passingAutoAnswerer(),
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    ...overrides,
  };
}

const scope: MigrateScope = {
  projectId: PROJECT_ID,
  bookId: BOOK_ID,
  company: 'acme',
  project: 'order-mig',
  selectedWorkItemIds: ['wi-1', 'wi-3'],
  batchName: 'checkout-revamp',
};

beforeEach(() => {
  answerCounter = 0;
  jest.clearAllMocks();
});

describe('buildOrderedDispatchSet — selection filter', () => {
  it('dispatches ONLY the selected work items', () => {
    const set = buildOrderedDispatchSet({
      book: threeStoryBook(),
      specGens: threeStorySpecs(),
      deferredWorkItemIds: new Set(),
      selectedWorkItemIds: new Set(['wi-1', 'wi-3']),
    });
    expect(set.map((d) => d.workItemId)).toEqual(['wi-1', 'wi-3']);
  });

  it('dispatches the whole book when no selection is given (unchanged behaviour)', () => {
    const set = buildOrderedDispatchSet({
      book: threeStoryBook(),
      specGens: threeStorySpecs(),
      deferredWorkItemIds: new Set(),
    });
    expect(set.map((d) => d.workItemId)).toEqual(['wi-1', 'wi-2', 'wi-3']);
  });
});

describe('evaluateHardBlock — selection scoping', () => {
  it('does NOT block on an UNSELECTED unready story', () => {
    const book = threeStoryBook();
    // wi-2 has no spec row -> unready, but it is NOT selected, so must not block.
    const specs = [readySpec('wi-1', 'x', 'sg-1'), readySpec('wi-3', 'x', 'sg-3')];
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: specs,
      deferredWorkItemIds: new Set(),
      selectedWorkItemIds: new Set(['wi-1', 'wi-3']),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(true);
  });

  it('DOES block on a SELECTED unready story', () => {
    const book = threeStoryBook();
    const specs = [readySpec('wi-1', 'x', 'sg-1')]; // wi-3 unready
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: specs,
      deferredWorkItemIds: new Set(),
      selectedWorkItemIds: new Set(['wi-1', 'wi-3']),
      hasActiveCurrentBaseline: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.workItemId === 'wi-3')).toBe(true);
  });
});

describe('runBatchSegment — one job for N specs', () => {
  const descriptors: DispatchDescriptor[] = [
    { sequencePosition: 0, workItemId: 'wi-1', specGenerationId: 'sg-1', bookItemId: 's1', generatedSpecText: 'a', title: 'Story 1', deployOnComplete: false },
    { sequencePosition: 1, workItemId: 'wi-3', specGenerationId: 'sg-3', bookItemId: 's3', generatedSpecText: 'b', title: 'Story 3', deployOnComplete: true },
  ];

  function batchRun(): MigrationExecutionRun {
    return {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', status: RUN_ITEM_STATUS.PENDING },
        { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-3', status: RUN_ITEM_STATUS.PENDING },
      ],
    };
  }

  it('auto-answers every item then submits ONE batch with all spec_intents + batchName', async () => {
    const deps = mockDeps();
    const run = batchRun();

    await runBatchSegment(scope, run, run.items!, descriptors, deps);

    // Auto-answered BOTH specs.
    expect((deps.autoAnswerer.driveAndAnswer as jest.Mock)).toHaveBeenCalledTimes(2);
    // ONE batched submit, with both specs + the batch name + deploy.
    expect(deps.submitOrchestrationBatch).toHaveBeenCalledTimes(1);
    const arg = (deps.submitOrchestrationBatch as jest.Mock).mock.calls[0][0];
    expect(arg.specs).toHaveLength(2);
    expect(arg.batchName).toBe('checkout-revamp');
    expect(arg.deployOnComplete).toBe(true);
    // The single per-spec submit is NOT used.
    expect(deps.submitOrchestration).not.toHaveBeenCalled();
    // BOTH items correlated to the SAME job_id.
    const jobIdPatches = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls.filter(
      (c) => c[2]?.job_id !== undefined,
    );
    expect(jobIdPatches.map((c) => c[2].job_id)).toEqual(['job-batch', 'job-batch']);
  });

  it('halts the run (NO submit) if any spec fails to auto-answer', async () => {
    const failing: ShapeSpecAutoAnswerer = {
      driveAndAnswer: jest.fn().mockResolvedValue({ ok: false, specName: null, error: 'no folder' }),
    };
    const deps = mockDeps({ autoAnswerer: failing });
    const run = batchRun();

    await runBatchSegment(scope, run, run.items!, descriptors, deps);

    expect(deps.submitOrchestrationBatch).not.toHaveBeenCalled();
  });
});

describe('advanceRunOnBuildResult — batch completion on one callback', () => {
  it('completes ALL siblings sharing the job_id and deploys the run', async () => {
    const run: MigrationExecutionRun = {
      id: 'run-1',
      project_id: PROJECT_ID,
      book_of_work_id: BOOK_ID,
      status: RUN_STATUS.DISPATCHING,
      items: [
        { id: 'ri-0', run_id: 'run-1', sequence_position: 0, work_item_id: 'wi-1', job_id: 'job-batch', status: RUN_ITEM_STATUS.SUBMITTED },
        { id: 'ri-1', run_id: 'run-1', sequence_position: 1, work_item_id: 'wi-3', job_id: 'job-batch', status: RUN_ITEM_STATUS.SUBMITTED },
      ],
    };
    const deps = mockDeps({
      findMigrationRunItemByJobId: jest.fn().mockResolvedValue(run.items![0]),
      getMigrationExecutionRun: jest.fn().mockResolvedValue(run),
      triggerReconcile: jest.fn().mockResolvedValue(undefined),
    });

    const decision = await advanceRunOnBuildResult(
      {
        company: 'acme',
        project: 'order-mig',
        jobId: 'job-batch',
        outcome: 'deployed',
        targetBaseUrl: 'http://target',
      },
      deps,
    );

    expect(decision).toBe('deployed_recorded');
    // BOTH siblings marked deployed.
    const deployedItems = (deps.patchMigrationExecutionRunItem as jest.Mock).mock.calls
      .filter((c) => c[2]?.outcome === 'deployed')
      .map((c) => c[1])
      .sort();
    expect(deployedItems).toEqual(['ri-0', 'ri-1']);
    // Run marked deployed.
    const runDeployed = (deps.patchMigrationExecutionRun as jest.Mock).mock.calls.some(
      (c) => c[2]?.status === RUN_STATUS.DEPLOYED,
    );
    expect(runDeployed).toBe(true);
  });
});
