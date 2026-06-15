/**
 * Holistic Integration/E2E TEST Work Items (Spec 2026-06-14, Spec 2 of 4).
 *
 * Groups 1 + 2: the generalized holistic prompt + the headless
 * holistic-review handler that creates ONE TEST work item per generated test
 * (blob item + work_item row + spec row + implement-state.json), with
 * ALLOW-WITH-WARNING gating and per-item failure isolation.
 *
 * All LLM calls are injected via the `callLlm` dep (the llmGuard.setup.ts
 * live-LLM guard is active; no real model is reached). The AMS-client surface
 * (`fetchProjectFolder`) is mocked via the shared architectureModelClientMock
 * helper; every other AMS interaction is injected via the handler's DI seams.
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
  partitionChildrenBySpecStatus,
  computeTestSequenceBase,
  assembleHolisticTestSpecBody,
  buildValidatedHolisticSpecResponse,
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
import {
  assertSpecGenerationResponse,
  SPEC_TEXT_REQUIRED_PREFIX,
} from '../services/specGenerationResponseValidator';
import { ImplementStatePutBody } from '../services/migrationImplementReadyState';

const PROJECT_ID = 'proj-holistic-1';
const BOOK_ID = 'book-holistic-1';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    nodeTitle: 'Customer Onboarding',
    nodeDescription: 'Onboard a new customer end to end.',
    level: 'feature',
    children,
  };
}

function epicNode(children: LoadedHolisticChild[]): LoadedHolisticNode {
  return {
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    nodeBookItemId: 'E1',
    nodeWorkItemId: 'wi-E1',
    nodeTitle: 'Billing Domain',
    nodeDescription: 'The billing epic.',
    level: 'epic',
    children,
  };
}

function specRow(workItemId: string, status: string): MigrationStorySpecGenerationDto {
  return {
    projectId: PROJECT_ID,
    workItemId,
    bookOfWorkId: BOOK_ID,
    status: status as MigrationStorySpecGenerationDto['status'],
    generatedSpecText: `/agent-os:shape-spec ${workItemId}\n\nSome generated body for ${workItemId}.`,
    structuredTestsJson: [{ title: `unit ${workItemId}`, description: 'd', type: 'unit' }],
  };
}

function llmPlan(tests: Array<{ title: string; description: string; type: string }>): string {
  return JSON.stringify({
    schemaVersion: '1.0',
    message: 'holistic review',
    testPlan: tests,
    openQuestions: [],
  });
}

interface Harness {
  deps: HolisticTestDefinitionDeps;
  createCalls: Array<Parameters<TestItemCreator>[0]>;
  persistCalls: Array<{ rows: MigrationStorySpecGenerationDto[] }>;
  putCalls: ImplementStatePutBody[];
}

function buildHarness(opts: {
  node: LoadedHolisticNode;
  specRows: MigrationStorySpecGenerationDto[];
  llmContent: string;
  createTestItem?: TestItemCreator;
  persistSpecRow?: PersistBatchFn;
  resolveProjectFolder?: ProjectFolderResolver;
}): Harness {
  const createCalls: Array<Parameters<TestItemCreator>[0]> = [];
  const persistCalls: Array<{ rows: MigrationStorySpecGenerationDto[] }> = [];
  const putCalls: ImplementStatePutBody[] = [];

  let createSeq = 0;
  const createTestItem: TestItemCreator =
    opts.createTestItem ??
    (async (input) => {
      createCalls.push(input);
      createSeq += 1;
      return { workItemId: `wi-test-${createSeq}`, bookItemId: `T${createSeq}` };
    });

  const persistSpecRow: PersistBatchFn =
    opts.persistSpecRow ??
    (async (_p, _b, rows) => {
      persistCalls.push({ rows: [...rows] });
      return {
        persistedCount: rows.length,
        resultsCouldNotPersist: 0,
        perStoryResults: rows.map((r, i) => ({ ...r, id: r.id ?? `spec-${i + 1}` })),
      };
    });

  const putImplementState: ImplementStatePutter = async (body) => {
    putCalls.push(body);
    return { success: true };
  };

  const loadNode: HolisticNodeLoader = async () => opts.node;
  const loadSpecRows: SpecRowsLoader = async () => opts.specRows;
  const readTestStrategy: TestStrategyReader = async () => '# Test Strategy\nUse JUnit + Testcontainers.';
  const callLlm: HolisticLlmCaller = async () => ({ content: opts.llmContent });

  return {
    deps: {
      loadNode,
      loadSpecRows,
      readTestStrategy,
      callLlm,
      createTestItem,
      persistSpecRow,
      putImplementState,
      resolveProjectFolder: opts.resolveProjectFolder ?? (async () => '/abs/project-parent'),
    },
    createCalls,
    persistCalls,
    putCalls,
  };
}

// ---------------------------------------------------------------------------
// Group 1.2 -- prompt generalization (level-relative nouns + headings)
// ---------------------------------------------------------------------------

describe('Group 1 -- buildHolisticTestPlanningPrompt level generalization', () => {
  const ctx = {
    workItem: { id: 'n1', title: 'Billing', type: 'epic', description: 'desc' },
  } as ChatContext;
  const specs: StorySpecSummary[] = [
    { storyTitle: 'Invoice generation' },
    { storyTitle: 'Payment capture' },
  ];

  it('emits FEATURE-relative nouns + "### Story N" headings at feature level', () => {
    const prompt = buildHolisticTestPlanningPrompt(ctx, specs, null, 'feature');
    expect(prompt).toContain('holistic review of a feature and all its stories');
    expect(prompt).toContain('## FEATURE CONTEXT');
    expect(prompt).toContain('### Story 1: Invoice generation');
    expect(prompt).toContain('### Story 2: Payment capture');
    expect(prompt).not.toContain('### Feature 1:');
    // Output contract preserved: integration|e2e only, never unit/functional.
    expect(prompt).toContain('"type" must be "integration" or "e2e"');
    expect(prompt).toContain('do NOT use "unit" or "functional"');
  });

  it('emits EPIC-relative nouns + "### Feature N" headings at epic level', () => {
    const prompt = buildHolisticTestPlanningPrompt(ctx, specs, null, 'epic');
    expect(prompt).toContain('holistic review of an epic and all its features');
    expect(prompt).toContain('## EPIC CONTEXT');
    expect(prompt).toContain('### Feature 1: Invoice generation');
    expect(prompt).toContain('### Feature 2: Payment capture');
    expect(prompt).not.toContain('### Story 1:');
    // Verbatim output contract retained at epic level too.
    expect(prompt).toContain('"type" must be "integration" or "e2e"');
  });

  it('defaults to feature level when no level arg is passed (back-compat)', () => {
    const prompt = buildHolisticTestPlanningPrompt(ctx, specs, null);
    expect(prompt).toContain('## FEATURE CONTEXT');
    expect(prompt).toContain('### Story 1: Invoice generation');
  });
});

// ---------------------------------------------------------------------------
// Group 1.3/1.4 -- handler: gather spec-complete children, parse, gate
// ---------------------------------------------------------------------------

describe('Group 1 -- headless handler gather + parse + ALLOW-WITH-WARNING', () => {
  it('gathers spec-complete children, calls the LLM, and returns parsed testPlan[]', async () => {
    const children = [child({ bookItemId: 'S1' }), child({ bookItemId: 'S2', sequenceOrder: 2 })];
    const node = featureNode(children);
    const rows = [specRow('wi-S1', 'generated'), specRow('wi-S2', 'generated_with_warnings')];
    let capturedSystemPrompt = '';
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 'Onboarding journey E2E', description: 'spans S1 + S2', type: 'e2e' },
      ]),
    });
    h.deps.callLlm = async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      return {
        content: llmPlan([
          { title: 'Onboarding journey E2E', description: 'spans S1 + S2', type: 'e2e' },
        ]),
      };
    };

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    expect(result.testPlan).toHaveLength(1);
    expect(result.testPlan[0]).toMatchObject({ type: 'e2e', title: 'Onboarding journey E2E' });
    expect(result.specCompleteChildCount).toBe(2);
    expect(result.skippedChildren).toHaveLength(0);
    // Both spec-complete children were fed into the prompt as "### Story N".
    expect(capturedSystemPrompt).toContain('### Story 1: Story S1');
    expect(capturedSystemPrompt).toContain('### Story 2: Story S2');
  });

  it('ALLOW-WITH-WARNING: skips insufficient/not-generated children, never blocks', async () => {
    const children = [
      child({ bookItemId: 'S1' }), // generated -> reviewed
      child({ bookItemId: 'S2', sequenceOrder: 2 }), // insufficient_context -> skipped
      child({ bookItemId: 'S3', sequenceOrder: 3, workItemId: null }), // not saved -> skipped
    ];
    const node = featureNode(children);
    const rows = [specRow('wi-S1', 'generated'), specRow('wi-S2', 'insufficient_context')];
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 'X-cutting integration', description: 'covers S1 paths', type: 'integration' },
      ]),
    });

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    // The review still runs (1 spec-complete child) and creates the item.
    expect(result.specCompleteChildCount).toBe(1);
    expect(result.createdTestItems).toHaveLength(1);
    // Two children were skipped + listed with reasons (never blocked).
    const reasons = result.skippedChildren.reduce<Record<string, string>>((acc, s) => {
      acc[s.bookItemId] = s.reason;
      return acc;
    }, {});
    expect(reasons.S2).toBe('insufficient_context');
    expect(reasons.S3).toBe('not_generated');
  });

  it('per-item failure isolation: one create failure does not abort the batch', async () => {
    const node = featureNode([child({ bookItemId: 'S1' })]);
    const rows = [specRow('wi-S1', 'generated')];
    let n = 0;
    const createTestItem: TestItemCreator = async (input) => {
      n += 1;
      if (n === 1) throw new Error('boom on first create');
      return { workItemId: `wi-test-${n}`, bookItemId: `T${n}` };
    };
    const h = buildHarness({
      node,
      specRows: rows,
      createTestItem,
      llmContent: llmPlan([
        { title: 'first', description: 'd1', type: 'integration' },
        { title: 'second', description: 'd2', type: 'e2e' },
      ]),
    });

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    expect(result.failedTestItems).toHaveLength(1);
    expect(result.failedTestItems[0]).toMatchObject({ index: 0, title: 'first' });
    expect(result.createdTestItems).toHaveLength(1);
    expect(result.createdTestItems[0].title).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// Group 2 -- TEST-item creation (both representations) + spec row + state
// ---------------------------------------------------------------------------

describe('Group 2 -- one TEST item per test + spec row + implement-state', () => {
  it('creates ONE TEST item per generated test (N tests -> N items, never a bundle)', async () => {
    const node = featureNode([
      child({ bookItemId: 'S1', sequenceOrder: 1 }),
      child({ bookItemId: 'S2', sequenceOrder: 2 }),
    ]);
    const rows = [specRow('wi-S1', 'generated'), specRow('wi-S2', 'generated')];
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 't-a', description: 'da', type: 'integration' },
        { title: 't-b', description: 'db', type: 'e2e' },
        { title: 't-c', description: 'dc', type: 'integration' },
      ]),
    });

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    expect(result.createdTestItems).toHaveLength(3);
    expect(h.createCalls).toHaveLength(3);
    // sequenceOrder = max child order (2) + 1 = 3, incrementing per item.
    expect(result.createdTestItems.map((c) => c.sequenceOrder)).toEqual([3, 4, 5]);
    expect(h.createCalls.map((c) => c.sequenceOrder)).toEqual([3, 4, 5]);
    // Each create parents to the FEATURE node (sibling to stories).
    for (const call of h.createCalls) {
      expect(call.parentBookItemId).toBe('F1');
      expect(call.parentWorkItemId).toBe('wi-F1');
    }
  });

  it('persists a /agent-os:shape-spec spec row keyed on the TEST item workItemId + writes implement-state', async () => {
    const node = featureNode([child({ bookItemId: 'S1', sequenceOrder: 1 })]);
    const rows = [specRow('wi-S1', 'generated')];
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 'cross-cut integration', description: 'verifies S1<->S2 contract', type: 'integration' },
      ]),
    });

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    expect(result.createdTestItems).toHaveLength(1);
    const created = result.createdTestItems[0];
    expect(created.specPersisted).toBe(true);
    expect(created.implementStateWritten).toBe(true);

    // Spec row keyed on the TEST item's work_item_id, validator-passing body.
    expect(h.persistCalls).toHaveLength(1);
    const persistedRow = h.persistCalls[0].rows[0];
    expect(persistedRow.workItemId).toBe('wi-test-1');
    expect(persistedRow.generatedSpecText?.startsWith(SPEC_TEXT_REQUIRED_PREFIX)).toBe(true);
    expect(assertSpecGenerationResponse({
      status: 'generated',
      confidence: 'high',
      specText: persistedRow.generatedSpecText,
      warnings: [],
      evidenceRefs: [],
      assumptions: [],
      tests: [],
      affectedAreas: [],
      coveredEndpointIds: [],
    }).ok).toBe(true);
    // structured_tests_json carries the integration/E2E definition.
    expect(persistedRow.structuredTestsJson).toEqual([
      { title: 'cross-cut integration', description: 'verifies S1<->S2 contract', type: 'integration' },
    ]);

    // implement-state: scope + Test Pack + flags for the TEST item.
    expect(h.putCalls).toHaveLength(1);
    const putBody = h.putCalls[0];
    expect(putBody.featureId).toBe('wi-test-1');
    expect(putBody.state.hasTestPlan).toBe(true);
    expect(putBody.state.latestPlannerResponse?.plannerReadyForSpec).toBe(true);
    expect(putBody.state.latestPlannerResponse?.scope.in).toContain('write these integration/E2E tests');
    expect(putBody.state.latestTestPlannerResponse?.testPlan).toEqual([
      { title: 'cross-cut integration', description: 'verifies S1<->S2 contract', type: 'integration' },
    ]);
  });

  it('epic-level run reviews features and creates TEST siblings of the features', async () => {
    const node = epicNode([
      child({ bookItemId: 'FA', title: 'Feature A', sequenceOrder: 1, workItemId: 'wi-FA' }),
      child({ bookItemId: 'FB', title: 'Feature B', sequenceOrder: 2, workItemId: 'wi-FB' }),
    ]);
    const rows = [specRow('wi-FA', 'generated'), specRow('wi-FB', 'generated')];
    let capturedSystemPrompt = '';
    const h = buildHarness({
      node,
      specRows: rows,
      llmContent: llmPlan([
        { title: 'epic E2E journey', description: 'spans Feature A + B', type: 'e2e' },
      ]),
    });
    h.deps.callLlm = async ({ systemPrompt }) => {
      capturedSystemPrompt = systemPrompt;
      return {
        content: llmPlan([
          { title: 'epic E2E journey', description: 'spans Feature A + B', type: 'e2e' },
        ]),
      };
    };

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'E1' },
      h.deps,
    );

    expect(result.level).toBe('epic');
    expect(capturedSystemPrompt).toContain('## EPIC CONTEXT');
    expect(capturedSystemPrompt).toContain('### Feature 1: Feature A');
    expect(result.createdTestItems).toHaveLength(1);
    // TEST item parents to the EPIC node (sibling to features), seq after features.
    expect(h.createCalls[0].parentBookItemId).toBe('E1');
    expect(h.createCalls[0].sequenceOrder).toBe(3);
  });

  it('empty testPlan creates NO items / spec rows / implement-state', async () => {
    const node = featureNode([child({ bookItemId: 'S1' })]);
    const rows = [specRow('wi-S1', 'generated')];
    const h = buildHarness({ node, specRows: rows, llmContent: llmPlan([]) });

    const result = await runHolisticTestDefinitions(
      { projectId: PROJECT_ID, bookOfWorkId: BOOK_ID, nodeBookItemId: 'F1' },
      h.deps,
    );

    expect(result.emptyPlan).toBe(true);
    expect(result.createdTestItems).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
    expect(h.persistCalls).toHaveLength(0);
    expect(h.putCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pure-helper unit checks (sequencing + gating + assembler validity)
// ---------------------------------------------------------------------------

describe('Group 2 -- pure helpers', () => {
  it('computeTestSequenceBase = max child sequenceOrder + 1', () => {
    expect(
      computeTestSequenceBase([
        child({ bookItemId: 'a', sequenceOrder: 3 }),
        child({ bookItemId: 'b', sequenceOrder: 7 }),
        child({ bookItemId: 'c', sequenceOrder: 5 }),
      ]),
    ).toBe(8);
    expect(computeTestSequenceBase([])).toBe(1);
  });

  it('partitionChildrenBySpecStatus splits complete vs skipped', () => {
    const children = [
      child({ bookItemId: 'a', workItemId: 'wa' }),
      child({ bookItemId: 'b', workItemId: 'wb' }),
      child({ bookItemId: 'c', workItemId: null }),
    ];
    const { specComplete, skipped } = partitionChildrenBySpecStatus(children, [
      specRow('wa', 'generated_with_warnings'),
      specRow('wb', 'failed'),
    ]);
    expect(specComplete.map((c) => c.bookItemId)).toEqual(['a']);
    expect(skipped.map((s) => `${s.bookItemId}:${s.reason}`)).toEqual([
      'b:failed',
      'c:not_generated',
    ]);
  });

  it('assembleHolisticTestSpecBody yields a validator-passing /agent-os:shape-spec body', () => {
    const body = assembleHolisticTestSpecBody(
      { title: 'Cross-service contract test', description: 'verifies A->B contract', type: 'integration' },
      'Billing',
      'feature',
      '# Strategy\nUse JUnit.',
    );
    expect(body.startsWith(SPEC_TEXT_REQUIRED_PREFIX)).toBe(true);
    expect(body.length).toBeGreaterThan(200);
    // The wrapped response validates clean.
    expect(() => buildValidatedHolisticSpecResponse(body)).not.toThrow();
  });
});
