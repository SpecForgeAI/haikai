/**
 * Holistic effect-test steering for operational / non-API stories
 * (Spec 2026-06-14, Non-Reconciling Work at Reconcile Time / D6, Task Group 4).
 *
 * Reconciliation is API-only, so it cannot verify operational / batch / non-API
 * work. D6 steers the BUILT holistic TEST mechanism so that when a reviewed
 * child is operational / non-API (recognised via the `provenance` marker + the
 * operational marker: `source_capability_id` present and/or `kind=operational`),
 * the reviewer is steered to emit EFFECT-asserting tests (run the pipeline ->
 * assert DB tables / downstream message / snapshot) -- the only way to verify
 * the batch tier the diff cannot touch.
 *
 * The emitted TEST item type STAYS `integration|e2e` -- only the content/guidance
 * changes (NO new type). All LLM calls are injected (`callLlm`); the live-LLM
 * guard is active and the architectureModelClient surface is mocked.
 */

const mockFetchProjectFolder = jest.fn(async (_projectId: string) => '/abs/project-parent');

jest.mock('../services/architectureModelClient', () => {
  const { buildArchitectureModelClientMock } = jest.requireActual(
    '../testSetup/architectureModelClientMock',
  );
  return buildArchitectureModelClientMock({
    fetchProjectFolder: (...args: unknown[]) => mockFetchProjectFolder(...(args as [string])),
  });
});

import {
  buildHolisticTestPlanningPrompt,
  StorySpecSummary,
} from '../services/holisticTestPlanningPrompt';
import { ChatContext } from '../types';
import {
  runHolisticTestDefinitions,
  assembleHolisticTestSpecBody,
  buildStorySpecSummary,
  isOperationalChild,
  HolisticNodeLoader,
  SpecRowsLoader,
  TestStrategyReader,
  HolisticLlmCaller,
  TestItemCreator,
  ProjectFolderResolver,
  LoadedHolisticNode,
  LoadedHolisticChild,
  HolisticTestDefinitionDeps,
} from '../services/holisticTestDefinitionHandler';
import {
  PersistBatchFn,
  ImplementStatePutter,
  MigrationStorySpecGenerationDto,
} from '../services/migrationShapeSpecGenerationHandler';
import { ImplementStatePutBody } from '../services/migrationImplementReadyState';

const PROJECT_ID = 'proj-eff-1';
const BOOK_ID = 'book-eff-1';

function child(
  over: Partial<LoadedHolisticChild> & { bookItemId: string },
): LoadedHolisticChild {
  return {
    workItemId: `wi-${over.bookItemId}`,
    title: `Story ${over.bookItemId}`,
    description: null,
    sequenceOrder: 1,
    ...over,
  };
}

function featureNode(children: LoadedHolisticChild[]): LoadedHolisticNode {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    nodeBookItemId: 'F1',
    nodeWorkItemId: 'wi-F1',
    nodeTitle: 'Nightly Settlement',
    nodeDescription: 'The nightly settlement batch.',
    level: 'feature',
    children,
  };
}

function specRow(workItemId: string, status: string): MigrationStorySpecGenerationDto {
  return {
    projectId: PROJECT_ID,
    workItemId,
    bookOfWorkId: BOOK_ID,
    status: status as MigrationStorySpecGenerationDto['status'],
    generatedSpecText: `/agent-os:shape-spec ${workItemId}\n\nBody for ${workItemId}.`,
    structuredTestsJson: [{ title: `unit ${workItemId}`, description: 'd', type: 'unit' }],
  };
}

function llmPlan(tests: Array<{ title: string; description: string; type: string }>): string {
  return JSON.stringify({ schemaVersion: '1.0', message: 'review', testPlan: tests, openQuestions: [] });
}

interface Harness {
  deps: HolisticTestDefinitionDeps;
  persistCalls: Array<{ rows: MigrationStorySpecGenerationDto[] }>;
}

function buildHarness(opts: {
  node: LoadedHolisticNode;
  specRows: MigrationStorySpecGenerationDto[];
  llmContent: string;
}): Harness {
  const persistCalls: Array<{ rows: MigrationStorySpecGenerationDto[] }> = [];
  let createSeq = 0;
  const createTestItem: TestItemCreator = async () => {
    createSeq += 1;
    return { workItemId: `wi-test-${createSeq}`, bookItemId: `T${createSeq}` };
  };
  const persistSpecRow: PersistBatchFn = async (_p, _b, rows) => {
    persistCalls.push({ rows: [...rows] });
    return {
      persistedCount: rows.length,
      resultsCouldNotPersist: 0,
      perStoryResults: rows.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` })),
    };
  };
  const putImplementState: ImplementStatePutter = async (_body: ImplementStatePutBody) => ({ success: true });
  const loadNode: HolisticNodeLoader = async () => opts.node;
  const loadSpecRows: SpecRowsLoader = async () => opts.specRows;
  const readTestStrategy: TestStrategyReader = async () => '# Test Strategy\nUse JUnit + Testcontainers.';
  const callLlm: HolisticLlmCaller = async () => ({ content: opts.llmContent });
  const resolveProjectFolder: ProjectFolderResolver = async () => '/abs/project-parent';

  return {
    deps: {
      loadNode,
      loadSpecRows,
      readTestStrategy,
      callLlm,
      createTestItem,
      persistSpecRow,
      putImplementState,
      resolveProjectFolder,
    },
    persistCalls,
  };
}

// ---------------------------------------------------------------------------
// 4.2 -- operational recognition off the blob signals
// ---------------------------------------------------------------------------

describe('isOperationalChild (D6 operational marker)', () => {
  it('recognises a child with a source_capability_id (D3 discovered operational capability)', () => {
    expect(isOperationalChild(child({ bookItemId: 'S1', sourceCapabilityId: 'cap-1' }))).toBe(true);
  });
  it('recognises a manual net_new operational add (kind=operational)', () => {
    expect(
      isOperationalChild(child({ bookItemId: 'S2', provenance: 'net_new', kind: 'operational' })),
    ).toBe(true);
  });
  it('does NOT flag a plain API story (no capability, kind=api)', () => {
    expect(
      isOperationalChild(child({ bookItemId: 'S3', provenance: 'net_new', kind: 'api' })),
    ).toBe(false);
  });
  it('does NOT flag an ordinary discovered API story (no markers)', () => {
    expect(isOperationalChild(child({ bookItemId: 'S4' }))).toBe(false);
  });
});

describe('buildStorySpecSummary carries the operational flag', () => {
  it('sets operational=true for an operational child', () => {
    const summary = buildStorySpecSummary(child({ bookItemId: 'S1', sourceCapabilityId: 'cap-1' }), undefined);
    expect(summary.operational).toBe(true);
  });
  it('sets operational=false for a plain API child', () => {
    const summary = buildStorySpecSummary(child({ bookItemId: 'S2', kind: 'api' }), undefined);
    expect(summary.operational).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4.3 -- prompt steering clause (conditional on an operational child)
// ---------------------------------------------------------------------------

describe('buildHolisticTestPlanningPrompt effect-test steering', () => {
  const ctx = {
    workItem: { id: 'n1', title: 'Nightly Settlement', type: 'feature', description: 'batch' },
  } as ChatContext;

  it('adds EFFECT-assertion steering when at least one reviewed child is operational', () => {
    const specs: StorySpecSummary[] = [
      { storyTitle: 'Settlement batch', operational: true },
      { storyTitle: 'Plain API', operational: false },
    ];
    const prompt = buildHolisticTestPlanningPrompt(ctx, specs, null, 'feature');
    // The steering instructs effect assertions (run the pipeline -> assert DB /
    // message / snapshot) and names WHY (reconciliation cannot diff non-API work).
    expect(prompt).toMatch(/operational\s*\/\s*non-API/i);
    expect(prompt).toMatch(/effect/i);
    expect(prompt).toMatch(/run the pipeline/i);
    expect(prompt).toMatch(/database tables|DB tables|downstream message|snapshot/i);
    expect(prompt).toMatch(/reconciliation cannot|cannot be reconciled|API-only/i);
    // The operational child is flagged in its per-child block.
    expect(prompt).toMatch(/Settlement batch/);
  });

  it('does NOT add the effect-only steering when every reviewed child is a plain API story', () => {
    const specs: StorySpecSummary[] = [
      { storyTitle: 'Create order', operational: false },
      { storyTitle: 'Cancel order' },
    ];
    const prompt = buildHolisticTestPlanningPrompt(ctx, specs, null, 'feature');
    expect(prompt).not.toMatch(/run the pipeline and assert/i);
    expect(prompt).not.toMatch(/EFFECT-ASSERTING TESTS/);
    // The integration|e2e output contract is still present (unchanged).
    expect(prompt).toContain('"type" must be "integration" or "e2e"');
  });
});

// ---------------------------------------------------------------------------
// 4.4 -- spec-body clause + type unchanged
// ---------------------------------------------------------------------------

describe('assembleHolisticTestSpecBody effect-assertion guidance', () => {
  it('adds effect-assertion guidance for an operational story; type stays integration', () => {
    const body = assembleHolisticTestSpecBody(
      { title: 'Settlement effect', description: 'verify the nightly batch', type: 'integration' },
      'Nightly Settlement',
      'feature',
      null,
      true, // operational
    );
    expect(body).toMatch(/effect/i);
    expect(body).toMatch(/run the pipeline/i);
    expect(body).toMatch(/database tables|DB tables|downstream message|snapshot/i);
    // The header/type is still an Integration test (no new type).
    expect(body).toContain('# Integration Test:');
  });

  it('omits the effect-only guidance for a non-operational (plain API) story', () => {
    const body = assembleHolisticTestSpecBody(
      { title: 'Order journey', description: 'spans two stories', type: 'e2e' },
      'Orders',
      'feature',
      null,
      false,
    );
    expect(body).not.toMatch(/run the pipeline and assert/i);
    expect(body).toContain('# End-to-End Test:');
  });
});

// ---------------------------------------------------------------------------
// 4.2-4.4 -- end-to-end through runHolisticTestDefinitions (mock LLM)
// ---------------------------------------------------------------------------

describe('runHolisticTestDefinitions threads operational steering end-to-end', () => {
  it('an operational story produces effect-assertion guidance in the prompt AND the persisted spec body; type stays integration|e2e', async () => {
    const children = [
      child({ bookItemId: 'S1', sourceCapabilityId: 'cap-settlement' }), // operational
      child({ bookItemId: 'S2', sequenceOrder: 2, kind: 'api' }), // plain API
    ];
    const node = featureNode(children);
    const rows = [specRow('wi-S1', 'generated'), specRow('wi-S2', 'generated')];

    let capturedSystemPrompt = '';
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 'Settlement pipeline effect', description: 'assert ledger rows after the batch', type: 'integration' },
      ]),
    });
    h.deps.callLlm = async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      return {
        content: llmPlan([
          { title: 'Settlement pipeline effect', description: 'assert ledger rows after the batch', type: 'integration' },
        ]),
      };
    };

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    // The prompt carried the effect-test steering (one child is operational).
    expect(capturedSystemPrompt).toMatch(/run the pipeline/i);
    expect(capturedSystemPrompt).toMatch(/operational\s*\/\s*non-API/i);

    // The created TEST item's persisted spec body carries the effect guidance,
    // and the emitted type is unchanged (integration).
    expect(result.createdTestItems).toHaveLength(1);
    expect(result.createdTestItems[0].type).toBe('integration');
    const persistedRow = h.persistCalls[0].rows[0];
    expect(persistedRow.generatedSpecText).toMatch(/run the pipeline/i);
    // The free-form structured tests still record the integration|e2e definition.
    expect((persistedRow.structuredTestsJson ?? [])[0]).toMatchObject({ type: 'integration' });
  });

  it('a feature whose children are ALL plain API does NOT get effect-only steering', async () => {
    const children = [child({ bookItemId: 'S1', kind: 'api' }), child({ bookItemId: 'S2', sequenceOrder: 2 })];
    const node = featureNode(children);
    const rows = [specRow('wi-S1', 'generated'), specRow('wi-S2', 'generated')];

    let capturedSystemPrompt = '';
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([{ title: 'Order E2E', description: 'spans S1 + S2', type: 'e2e' }]),
    });
    h.deps.callLlm = async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      return { content: llmPlan([{ title: 'Order E2E', description: 'spans S1 + S2', type: 'e2e' }]) };
    };

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );
    expect(capturedSystemPrompt).not.toMatch(/run the pipeline and assert/i);
    const persistedRow = h.persistCalls[0].rows[0];
    expect(persistedRow.generatedSpecText).not.toMatch(/run the pipeline and assert/i);
    expect(result.createdTestItems[0].type).toBe('e2e');
  });
});
