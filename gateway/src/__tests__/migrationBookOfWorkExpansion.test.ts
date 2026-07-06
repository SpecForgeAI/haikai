/**
 * Tests for the phase-2 epic-expansion pipeline.
 *
 * Spec: 2026-06-11 Two-Phase Migration Delivery Plan Generation
 * (Skeleton → Expand) — Task Group 4 (4.1) + Task Group 6 (6.3 strategic
 * end-to-end gap coverage).
 *
 * Focused coverage (LLM + AMS + inventory all injected via deps):
 *   1. Deterministic batching — 30 items, batch size 12 → [12, 12, 6] in
 *      stable id/path order, identical across runs and input shuffles.
 *   2. Stamping coverage + atomic append — every inventory item ends with
 *      exactly ONE story; standard items get `provenance:stamped` +
 *      templated acceptance criteria with real model facts substituted;
 *      LLM-exceptional items get `provenance:generated`; exactly ONE
 *      story-carrying append with expansion_state='expanded'.
 *   3. Layer-2 hard-wired override — an item with an attached finding is
 *      routed bespoke regardless of the LLM's `standard` classification.
 *   4. Judge failure after one retry → epic `failed`; NO story append ever
 *      issued (state-only `failed` merge only).
 *   5. Flagged-item bespoke-rewrite failure after one retry → epic `failed`;
 *      NO story append.
 *   6. Expand-all — only `not_expanded` / `failed` / stale-`expanding` epics
 *      expand (here via the non-inventory single-call path); `expanded`
 *      epics are skipped.
 *
 * Task Group 6 strategic additions (end-to-end flows the per-group tests
 * left uncovered):
 *   7. Phase-1 skeleton → phase-2 expand-one-epic → partially-expanded draft
 *      round trip (the REAL `generateMigrationBookOfWork` skeleton feeds the
 *      REAL expansion pipeline through a simulated AMS merge document).
 *   8. "Expand all" under a limit-1 pool: fully SERIAL LLM execution (the
 *      MIGRATION_PLAN_LLM_CONCURRENCY=1 hard requirement, exercised through
 *      the real fan-out) with one mid-flight failure leaving the other
 *      epics `expanded` (per-epic atomicity in the persisted document).
 *   9. failed → retry: re-running ONLY the failed epic succeeds without
 *      touching the expanded epic's stories; `expanded` refuses
 *      re-expansion (409 precondition).
 *  10. Coverage guarantee — a batch response that DROPS an inventory item
 *      ("item 73 of 100") never lands: the epic fails retryably.
 *  11. Route-level end-to-end: POST expand on the REAL router drives the
 *      REAL handler through the DEFAULT snake_case AMS wire deps
 *      (defaultFetchBook / defaultAppendItems, global fetch mocked) and the
 *      GET re-read shows a partially expanded draft.
 */

// ---------------------------------------------------------------------------
// Mocks (Task Group 6 route-level e2e) — declared before importing the units
// under test. The config mock only affects code paths that omit the explicit
// deps overrides (i.e. the route-level test); every pre-existing test in this
// file injects its own pool/batch-size and never reads config.
// ---------------------------------------------------------------------------

const mockSendChatRequest = jest.fn();

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://ams.test',
    migrationPlanLlmConcurrency: 1,
    migrationPlanExpansionBatchSize: 12,
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import {
  AppendItemsFn,
  AppendItemsRequestBody,
  AmsRoundTripError,
  FetchBookFn,
  FetchedBookOfWork,
  InventoryWorkItem,
  expandAllMigrationBookOfWorkEpics,
  expandMigrationBookOfWorkEpic,
  partitionInventory,
  resetActiveExpansionsForTests,
  selectExpandableEpics,
} from '../services/migrationBookOfWorkExpansionHandler';
import {
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';
import { generateMigrationBookOfWork } from '../services/migrationBookOfWorkHandler';
import { migrationBookOfWorkRouter } from '../routes/migrationBookOfWork';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';

// NOTE (Spec 2026-07-06-g): the API streams expand DETERMINISTICALLY now
// (migrationCodeStreamPlanner) — these suites pin the GENERIC LLM
// batching/judge/bespoke machinery, so they run on a stream that still takes
// the LLM path. The injected `fetchEpicInventory` keeps the api_endpoint-kind
// fixtures meaningful regardless of the stream name.
const STREAM = 'target_frontend_implementation';
const EPIC_ID = `${STREAM}:E1`;
const FEATURE_ID = `${STREAM}:F1`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<MigrationBookOfWorkItem>): MigrationBookOfWorkItem {
  return {
    id: 'X',
    type: 'feature',
    parentId: null,
    title: 'title',
    description: 'description',
    acceptanceCriteria: [],
    workstream: STREAM,
    sequenceOrder: 1,
    tags: [`stream:${STREAM}`],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: 'next',
    traceabilitySummary: 'trace',
    ...overrides,
  } as MigrationBookOfWorkItem;
}

function makeSkeletonBook(
  epicOverrides: Partial<MigrationBookOfWorkItem> = {}
): FetchedBookOfWork {
  return {
    bookId: 'book-1',
    status: 'draft',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    items: [
      makeItem({ id: `${STREAM}:I1`, type: 'initiative', parentId: null, sequenceOrder: 1 }),
      makeItem({
        id: EPIC_ID,
        type: 'epic',
        parentId: `${STREAM}:I1`,
        sequenceOrder: 2,
        expansionState: 'not_expanded',
        ...epicOverrides,
      }),
      makeItem({ id: FEATURE_ID, type: 'feature', parentId: EPIC_ID, sequenceOrder: 3 }),
    ],
  };
}

function makeEndpoint(n: number, overrides: Partial<InventoryWorkItem> = {}): InventoryWorkItem {
  return {
    id: `ep-${String(n).padStart(3, '0')}`,
    name: `GET /customers/${n}`,
    kind: 'api_endpoint',
    method: 'GET',
    path: `/customers/${n}`,
    baselineId: `baseline-${n}`,
    attachedFindingIds: [],
    readiness: 'ready_for_spec',
    ...overrides,
  };
}

function makeStory(parentId: string, id = 'bespoke-1'): MigrationBookOfWorkItem {
  return makeItem({
    id,
    type: 'story',
    parentId,
    title: 'Bespoke story',
    description: 'Bespoke implementation story.',
    acceptanceCriteria: ['Bespoke acceptance criterion.'],
  });
}

/** A compliant batch response: standard classifications for every item except `exceptionalIds`. */
function makeBatchResponse(batch: InventoryWorkItem[], exceptionalIds: string[] = []) {
  return {
    templates: [
      {
        workType: 'api_endpoint',
        titleTemplate: 'Implement {METHOD} {path} in the target service',
        descriptionTemplate: 'Re-implement {METHOD} {path} with behavioural parity.',
        acceptanceCriteriaTemplates: [
          'Behavioural parity with baseline {baselineId} for {METHOD} {path}',
        ],
      },
    ],
    classifications: batch.map((item) => ({
      itemId: item.id,
      classification: exceptionalIds.includes(item.id) ? 'exceptional' : 'standard',
      workType: 'api_endpoint',
      parentFeatureId: FEATURE_ID,
    })),
    bespokeStories: exceptionalIds.map((itemId) => ({
      itemId,
      story: makeStory(FEATURE_ID, `bespoke-${itemId}`),
    })),
  };
}

/**
 * Simulated AMS draft document with the server-side merge semantics of the
 * real `items/append` endpoint (Task Group 2): validate the epic, merge the
 * appended items, stamp the epic's expansion state — always against the
 * CURRENT stored JSON, never a client read-modify-write.
 */
function makeInMemoryAms(initialItems: MigrationBookOfWorkItem[]): {
  store: { items: MigrationBookOfWorkItem[] };
  fetchBook: FetchBookFn;
  appendItems: AppendItemsFn;
} {
  const store = { items: initialItems.map((i) => ({ ...i })) };
  const fetchBook: FetchBookFn = async (_projectId, requestedBookId) => ({
    bookId: requestedBookId,
    status: 'draft',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    items: store.items.map((i) => ({ ...i })),
  });
  const appendItems: AppendItemsFn = async (_projectId, _bookId, body) => {
    if (!store.items.some((i) => i.id === body.epic_id && i.type === 'epic')) {
      throw new AmsRoundTripError(400, `Unknown epic id ${body.epic_id}`);
    }
    store.items = [
      ...store.items.map((i) =>
        i.id === body.epic_id ? { ...i, expansionState: body.expansion_state } : i
      ),
      ...body.items.map((i) => ({ ...i })),
    ];
  };
  return { store, fetchBook, appendItems };
}

type LlmArgs = { systemPrompt: string; userPrompt: string; projectId: string };

beforeEach(() => {
  resetActiveExpansionsForTests();
});

// ---------------------------------------------------------------------------
// 1. Deterministic batching
// ---------------------------------------------------------------------------

describe('partitionInventory — deterministic predictive batching', () => {
  it('30 items at batch size 12 yield [12, 12, 6] in stable order, identical across runs and input shuffles', () => {
    const items = Array.from({ length: 30 }, (_, i) => makeEndpoint(i + 1));
    const shuffled = [...items].reverse();

    const first = partitionInventory(items, 12);
    const second = partitionInventory(items, 12);
    const fromShuffled = partitionInventory(shuffled, 12);

    expect(first.map((b) => b.length)).toEqual([12, 12, 6]);
    // Identical across runs AND independent of input order.
    expect(second).toEqual(first);
    expect(fromShuffled).toEqual(first);
    // Stable ordering by path (the deterministic sort key for endpoints).
    const flatIds = first.flat().map((i) => i.id);
    const expectedOrder = [...items]
      .sort((a, b) => (a.path! < b.path! ? -1 : a.path! > b.path! ? 1 : 0))
      .map((i) => i.id);
    expect(flatIds).toEqual(expectedOrder);
  });
});

// ---------------------------------------------------------------------------
// 2 – 5. Per-epic pipeline
// ---------------------------------------------------------------------------

describe('expandMigrationBookOfWorkEpic — per-epic pipeline', () => {
  it('stamps every standard item in code (provenance:stamped + facts in acceptance criteria), keeps LLM exceptions bespoke, and issues exactly ONE story-carrying append with expanded state', async () => {
    const book = makeSkeletonBook();
    const inventory = [makeEndpoint(1), makeEndpoint(2), makeEndpoint(3)];
    const fetchBook = jest.fn().mockResolvedValue(book);
    const fetchEpicInventory = jest.fn().mockResolvedValue(inventory);
    const appendCalls: AppendItemsRequestBody[] = [];
    const appendItems = jest.fn().mockImplementation(async (_p, _b, body) => {
      appendCalls.push(body);
    });
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('INVENTORY BATCH')) {
        // ep-003 is the LLM-declared exception; ep-001 / ep-002 are standard.
        return { content: JSON.stringify(makeBatchResponse(inventory, ['ep-003'])) };
      }
      if (userPrompt.includes('EXPANSION JUDGE')) {
        return { content: JSON.stringify({ flaggedItemIds: [] }) };
      }
      throw new Error(`unexpected prompt: ${userPrompt.slice(0, 60)}`);
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook,
        fetchEpicInventory,
        appendItems,
        callLlm,
        llmPool: new LlmConcurrencyPool(2),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    expect(outcome).toMatchObject({ epicId: EPIC_ID, expansionState: 'expanded', storiesAppended: 3 });

    // State machine: `expanding` (state-only) first, then ONE story append
    // carrying `expanded` — exactly two appends in total.
    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[0]).toMatchObject({ epic_id: EPIC_ID, items: [], expansion_state: 'expanding' });
    expect(appendCalls[1].expansion_state).toBe('expanded');
    const stories = appendCalls[1].items;

    // Coverage: EXACTLY one story per inventory item.
    expect(stories).toHaveLength(3);
    const byInventoryTag = new Map(
      stories.map((s) => [s.tags.find((t) => t.startsWith('inventory:'))!.slice('inventory:'.length), s])
    );
    expect([...byInventoryTag.keys()].sort()).toEqual(['ep-001', 'ep-002', 'ep-003']);

    // Standard items: stamped in code with real model facts substituted.
    for (const id of ['ep-001', 'ep-002']) {
      const story = byInventoryTag.get(id)!;
      expect(story.tags).toContain('provenance:stamped');
      expect(story.tags).toContain(`stream:${STREAM}`);
      const n = Number(id.slice(-1));
      expect(story.title).toContain(`GET /customers/${n}`);
      expect(
        story.acceptanceCriteria.some((ac) =>
          ac.includes(`Behavioural parity with baseline baseline-${n} for GET /customers/${n}`)
        )
      ).toBe(true);
      expect(story.apiBaselineReferences).toEqual([`baseline-${n}`]);
    }

    // The LLM-declared exception stays bespoke.
    const bespoke = byInventoryTag.get('ep-003')!;
    expect(bespoke.tags).toContain('provenance:generated');
    expect(bespoke.tags).not.toContain('provenance:stamped');

    // One batch call + one judge call (per stamped batch); no rewrites needed.
    const prompts = callLlm.mock.calls.map((c) => (c[0] as LlmArgs).userPrompt);
    expect(prompts.filter((p) => p.includes('INVENTORY BATCH'))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes('EXPANSION JUDGE'))).toHaveLength(1);
  });

  it('layer-2 hard override — an item with an attached finding goes bespoke even when the LLM classifies it standard', async () => {
    const book = makeSkeletonBook();
    const inventory = [
      makeEndpoint(1),
      makeEndpoint(2, { attachedFindingIds: ['finding-9'] }),
    ];
    const appendCalls: AppendItemsRequestBody[] = [];
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('INVENTORY BATCH')) {
        // LLM (wrongly) classifies EVERYTHING standard.
        return { content: JSON.stringify(makeBatchResponse(inventory)) };
      }
      if (userPrompt.includes('EXPANSION JUDGE')) {
        return { content: JSON.stringify({ flaggedItemIds: [] }) };
      }
      if (userPrompt.includes('BESPOKE STORY')) {
        return { content: JSON.stringify({ story: makeStory(FEATURE_ID) }) };
      }
      throw new Error('unexpected prompt');
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: jest.fn().mockResolvedValue(book),
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        appendItems: jest.fn().mockImplementation(async (_p, _b, body) => {
          appendCalls.push(body);
        }),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    const stories = appendCalls[1].items;
    expect(stories).toHaveLength(2);
    const overridden = stories.find((s) => s.tags.includes('inventory:ep-002'))!;
    // The override routed ep-002 through the bespoke rewrite path.
    expect(overridden.tags).toContain('provenance:generated');
    const rewritePrompts = callLlm.mock.calls
      .map((c) => (c[0] as LlmArgs).userPrompt)
      .filter((p) => p.includes('BESPOKE STORY'));
    expect(rewritePrompts).toHaveLength(1);
    expect(rewritePrompts[0]).toContain('attached_finding');
    // The clean item still stamped.
    const clean = stories.find((s) => s.tags.includes('inventory:ep-001'))!;
    expect(clean.tags).toContain('provenance:stamped');
  });

  it('judge failure after one retry → epic failed (retryable); NO story append ever issued', async () => {
    const book = makeSkeletonBook();
    const inventory = [makeEndpoint(1), makeEndpoint(2)];
    const appendCalls: AppendItemsRequestBody[] = [];
    let judgeAttempts = 0;
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('INVENTORY BATCH')) {
        return { content: JSON.stringify(makeBatchResponse(inventory)) };
      }
      if (userPrompt.includes('EXPANSION JUDGE')) {
        judgeAttempts += 1;
        throw new Error('HTTP 504 - Endpoint request timed out');
      }
      throw new Error('unexpected prompt');
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: jest.fn().mockResolvedValue(book),
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        appendItems: jest.fn().mockImplementation(async (_p, _b, body) => {
          appendCalls.push(body);
        }),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toContain('Judge');
    expect(judgeAttempts).toBe(2); // one retry, then fail
    // Unverified stamped content NEVER lands: only state-only merges happened.
    expect(appendCalls.every((c) => c.items.length === 0)).toBe(true);
    expect(appendCalls.map((c) => c.expansion_state)).toEqual(['expanding', 'failed']);
  });

  it('flagged-item bespoke-rewrite failure after one retry → epic failed; NO story append', async () => {
    const book = makeSkeletonBook();
    const inventory = [makeEndpoint(1)];
    const appendCalls: AppendItemsRequestBody[] = [];
    let rewriteAttempts = 0;
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('INVENTORY BATCH')) {
        return { content: JSON.stringify(makeBatchResponse(inventory)) };
      }
      if (userPrompt.includes('EXPANSION JUDGE')) {
        return { content: JSON.stringify({ flaggedItemIds: ['ep-001'] }) };
      }
      if (userPrompt.includes('BESPOKE STORY')) {
        rewriteAttempts += 1;
        throw new Error('relay blew up');
      }
      throw new Error('unexpected prompt');
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: jest.fn().mockResolvedValue(book),
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        appendItems: jest.fn().mockImplementation(async (_p, _b, body) => {
          appendCalls.push(body);
        }),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    expect(outcome.expansionState).toBe('failed');
    expect(rewriteAttempts).toBe(2); // one retry, then fail
    expect(appendCalls.every((c) => c.items.length === 0)).toBe(true);
    expect(appendCalls.map((c) => c.expansion_state)).toEqual(['expanding', 'failed']);
  });
});

// ---------------------------------------------------------------------------
// 6. Expand-all selection (incl. the non-inventory single-call path)
// ---------------------------------------------------------------------------

describe('expandAllMigrationBookOfWorkEpics — state-machine selection', () => {
  it('expands not_expanded / failed / stale-expanding epics (single non-inventory call each) and skips expanded ones', async () => {
    const items: MigrationBookOfWorkItem[] = [
      makeItem({ id: 'cut:I1', type: 'initiative', parentId: null, sequenceOrder: 1 }),
    ];
    const epicStates: Array<[string, 'not_expanded' | 'expanded' | 'failed' | 'expanding']> = [
      ['cut:E1', 'not_expanded'],
      ['cut:E2', 'expanded'],
      ['cut:E3', 'failed'],
      ['cut:E4', 'expanding'], // stale — no live pipeline in this process
    ];
    let seq = 2;
    for (const [epicId, state] of epicStates) {
      items.push(
        makeItem({
          id: epicId,
          type: 'epic',
          parentId: 'cut:I1',
          sequenceOrder: seq++,
          expansionState: state,
          workstream: 'cutover_rollback_decommission',
          tags: ['stream:cutover_rollback_decommission'],
        })
      );
      items.push(
        makeItem({
          id: `${epicId}-F`,
          type: 'feature',
          parentId: epicId,
          sequenceOrder: seq++,
          workstream: 'cutover_rollback_decommission',
        })
      );
    }
    const book: FetchedBookOfWork = {
      bookId: 'book-2',
      status: 'draft',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
      items,
    };

    const appendCalls: Array<{ body: AppendItemsRequestBody }> = [];
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('NON-INVENTORY EPIC')) {
        const epicId = epicStates.map(([id]) => id).find((id) => userPrompt.includes(`Epic id: ${id}\n`))!;
        return {
          content: JSON.stringify({
            stories: [makeStory(`${epicId}-F`, `story-for-${epicId}`)],
          }),
        };
      }
      throw new Error('unexpected prompt');
    });

    const outcome = await expandAllMigrationBookOfWorkEpics(
      { projectId: 'p-1', bookId: 'book-2' },
      {
        fetchBook: jest.fn().mockResolvedValue(book),
        // No inventory mapping → every epic takes the single-call path.
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        appendItems: jest.fn().mockImplementation(async (_p, _b, body) => {
          appendCalls.push({ body });
        }),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    // Exactly the three expandable epics ran; the expanded one was skipped.
    expect(outcome.results.map((r) => r.epicId).sort()).toEqual(['cut:E1', 'cut:E3', 'cut:E4']);
    expect(outcome.results.every((r) => r.expansionState === 'expanded')).toBe(true);
    expect(outcome.skipped).toEqual([
      expect.objectContaining({ epicId: 'cut:E2', reason: expect.stringContaining('expanded') }),
    ]);

    // ONE single whole-epic LLM call per expanded epic (no batching machinery).
    expect(callLlm).toHaveBeenCalledTimes(3);

    // One story-carrying append per expanded epic; never for cut:E2.
    const storyAppends = appendCalls.filter((c) => c.body.items.length > 0);
    expect(storyAppends.map((c) => c.body.epic_id).sort()).toEqual(['cut:E1', 'cut:E3', 'cut:E4']);
    expect(storyAppends.every((c) => c.body.expansion_state === 'expanded')).toBe(true);
    expect(appendCalls.some((c) => c.body.epic_id === 'cut:E2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7 – 10. Task Group 6 — strategic end-to-end gap coverage
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-pm-migration-delivery-plan-book-of-work-draft',
  'planning',
  'visuals',
  'fixture-migration-delivery-plan-scenario.json'
);

describe('Two-phase end-to-end flows (Spec 2026-06-11, Task Group 6)', () => {
  it('skeleton (phase 1) → expand one epic (phase 2) → partially-expanded draft round trip; the expanded epic becomes terminal', async () => {
    // ----- Phase 1: the REAL skeleton generator persists the draft -----
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as {
      projectId: string;
      currentArchitectureId: string;
      targetArchitectureId?: string;
    };
    const skeletonJson = JSON.stringify({
      title: 'Skeleton plan',
      summary: 'Phase-1 skeleton awaiting expansion.',
      generationInputs: {
        productDefinitionRefs: ['p1'],
        currentArchitectureRefs: ['curr-1'],
        targetArchitectureRefs: ['tgt-1'],
      },
      generationSummary: {
        totalItems: 3,
        countsByType: { initiative: 1, epic: 1, feature: 1 },
      },
      qualityAssessment: { overallScore: 'high', overallRationale: 'ok' },
      items: [
        // No stream tags here — a real LLM skeleton response carries none;
        // the per-stream assembler stamps `stream:<name>` itself.
        makeItem({ id: 'I1', type: 'initiative', parentId: null, sequenceOrder: 1, tags: [] }),
        makeItem({ id: 'E1', type: 'epic', parentId: 'I1', sequenceOrder: 2, tags: [] }),
        makeItem({ id: 'F1', type: 'feature', parentId: 'E1', sequenceOrder: 3, tags: [] }),
      ],
    });
    const createDraft = jest.fn().mockResolvedValue({ draftId: 'book-rt', summary: 'ok' });
    await generateMigrationBookOfWork(
      {
        projectId: fixture.projectId,
        currentArchitectureId: fixture.currentArchitectureId,
        targetArchitectureId: fixture.targetArchitectureId ?? '',
        wizardAnswers: {
          deliveryStreams: ['cutover_rollback_decommission', 'reconciliation_reporting'],
        },
      },
      {
        fetchContext: jest.fn().mockResolvedValue(fixture),
        callLlm: jest.fn().mockResolvedValue({ content: skeletonJson }),
        createDraft,
        systemPromptOverride: 'SYS',
        llmPool: new LlmConcurrencyPool(1),
      }
    );

    // The persisted phase-1 skeleton IS the simulated AMS document phase 2
    // reads — the cross-phase contract this test exists to pin.
    const [, postedBody] = createDraft.mock.calls[0];
    // AMS wire shape is snake_case `book_of_work_json: { items }` (the
    // 2026-06-23 fix); the old camelCase `bookOfWork` read was a stale
    // pre-existing failure repaired by Spec 2026-07-02-b.
    const ams = makeInMemoryAms(
      (postedBody.book_of_work_json as { items: MigrationBookOfWorkItem[] }).items
    );
    const cutoverEpicId = 'cutover_rollback_decommission:E1';
    const reconEpicId = 'reconciliation_reporting:E1';
    const seededStates = ams.store.items
      .filter((i) => i.type === 'epic')
      .map((i) => i.expansionState);
    expect(seededStates).toEqual(['not_expanded', 'not_expanded']);

    // ----- Phase 2: expand ONE epic against the same document -----
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('NON-INVENTORY EPIC')) {
        return {
          content: JSON.stringify({
            stories: [
              makeStory('cutover_rollback_decommission:F1', 'rt-1'),
              makeStory('cutover_rollback_decommission:F1', 'rt-2'),
            ],
          }),
        };
      }
      throw new Error('unexpected prompt');
    });
    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: fixture.projectId, bookId: 'book-rt', epicId: cutoverEpicId },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );
    expect(outcome).toMatchObject({ expansionState: 'expanded', storiesAppended: 2 });

    // ----- Draft re-read: a PARTIALLY expanded, hierarchy-valid document -----
    const byId = new Map(ams.store.items.map((i) => [i.id, i]));
    expect(byId.get(cutoverEpicId)!.expansionState).toBe('expanded');
    expect(byId.get(reconEpicId)!.expansionState).toBe('not_expanded');
    const stories = ams.store.items.filter((i) => i.type === 'story');
    expect(stories.map((s) => s.id).sort()).toEqual([
      `${cutoverEpicId}-s-1`,
      `${cutoverEpicId}-s-2`,
    ]);
    for (const story of stories) {
      expect(story.parentId).toBe('cutover_rollback_decommission:F1');
      expect(story.tags).toEqual(
        expect.arrayContaining(['provenance:generated', 'stream:cutover_rollback_decommission'])
      );
    }
    expect(validateBookOfWorkHierarchy(ams.store.items).ok).toBe(true);

    // The state machine now treats the expanded epic as terminal: a follow-up
    // "Expand all" would pick ONLY the still-unexpanded epic.
    const selection = selectExpandableEpics('book-rt', ams.store.items);
    expect(selection.expandable.map((e) => e.epicId)).toEqual([reconEpicId]);
    expect(selection.skipped).toEqual([
      expect.objectContaining({ epicId: cutoverEpicId, reason: expect.stringContaining('expanded') }),
    ]);
  });

  it('expand-all under a limit-1 pool runs FULLY SERIALLY; one epic failing after retry leaves the others expanded (per-epic atomicity)', async () => {
    const items: MigrationBookOfWorkItem[] = [
      makeItem({ id: 'cut:I1', type: 'initiative', parentId: null, sequenceOrder: 1 }),
    ];
    let seq = 2;
    for (const epicId of ['cut:E1', 'cut:E2', 'cut:E3']) {
      items.push(
        makeItem({
          id: epicId,
          type: 'epic',
          parentId: 'cut:I1',
          sequenceOrder: seq++,
          expansionState: 'not_expanded',
          workstream: 'cutover_rollback_decommission',
          tags: ['stream:cutover_rollback_decommission'],
        })
      );
      items.push(
        makeItem({
          id: `${epicId}-F`,
          type: 'feature',
          parentId: epicId,
          sequenceOrder: seq++,
          workstream: 'cutover_rollback_decommission',
        })
      );
    }
    const ams = makeInMemoryAms(items);

    let inFlight = 0;
    let maxInFlight = 0;
    let e2Attempts = 0;
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (userPrompt.includes('Epic id: cut:E2\n')) {
          e2Attempts += 1;
          throw new Error('HTTP 504 - Endpoint request timed out');
        }
        const epicId = ['cut:E1', 'cut:E3'].find((id) => userPrompt.includes(`Epic id: ${id}\n`))!;
        return {
          content: JSON.stringify({ stories: [makeStory(`${epicId}-F`, `s-${epicId}`)] }),
        };
      } finally {
        inFlight -= 1;
      }
    });

    const outcome = await expandAllMigrationBookOfWorkEpics(
      { projectId: 'p-ser', bookId: 'book-ser' },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue([]),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    // MIGRATION_PLAN_LLM_CONCURRENCY=1 semantics: NEVER more than one
    // in-flight LLM call across the whole multi-epic fan-out.
    expect(maxInFlight).toBe(1);
    expect(e2Attempts).toBe(2); // one retry, then the epic fails

    const byEpic = new Map(outcome.results.map((r) => [r.epicId, r]));
    expect(byEpic.get('cut:E1')).toMatchObject({ expansionState: 'expanded', storiesAppended: 1 });
    expect(byEpic.get('cut:E3')).toMatchObject({ expansionState: 'expanded', storiesAppended: 1 });
    expect(byEpic.get('cut:E2')).toMatchObject({ expansionState: 'failed', storiesAppended: 0 });

    // The persisted document holds the partial progress: the two successful
    // epics' stories landed and the failed epic is retryable with NO stories.
    const byId = new Map(ams.store.items.map((i) => [i.id, i]));
    expect(byId.get('cut:E1')!.expansionState).toBe('expanded');
    expect(byId.get('cut:E3')!.expansionState).toBe('expanded');
    expect(byId.get('cut:E2')!.expansionState).toBe('failed');
    const storyParents = ams.store.items.filter((i) => i.type === 'story').map((i) => i.parentId);
    expect(storyParents.sort()).toEqual(['cut:E1-F', 'cut:E3-F']);
  });

  it("failed → retry: re-running ONLY the failed epic succeeds without touching the expanded epic's stories; expanded refuses re-expansion (409)", async () => {
    const items: MigrationBookOfWorkItem[] = [
      makeItem({ id: 'cut:I1', type: 'initiative', parentId: null, sequenceOrder: 1 }),
      makeItem({
        id: 'cut:E1',
        type: 'epic',
        parentId: 'cut:I1',
        sequenceOrder: 2,
        expansionState: 'failed',
        workstream: 'cutover_rollback_decommission',
        tags: ['stream:cutover_rollback_decommission'],
      }),
      makeItem({ id: 'cut:E1-F', type: 'feature', parentId: 'cut:E1', sequenceOrder: 3 }),
      makeItem({
        id: 'cut:E2',
        type: 'epic',
        parentId: 'cut:I1',
        sequenceOrder: 4,
        expansionState: 'expanded',
        workstream: 'cutover_rollback_decommission',
        tags: ['stream:cutover_rollback_decommission'],
      }),
      makeItem({ id: 'cut:E2-F', type: 'feature', parentId: 'cut:E2', sequenceOrder: 5 }),
      { ...makeStory('cut:E2-F', 'cut:E2-s-1'), sequenceOrder: 6 },
    ];
    const ams = makeInMemoryAms(items);
    const appendSpy = jest.fn(ams.appendItems);
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('NON-INVENTORY EPIC') && userPrompt.includes('Epic id: cut:E1\n')) {
        return { content: JSON.stringify({ stories: [makeStory('cut:E1-F', 'retry-1')] }) };
      }
      throw new Error('unexpected prompt');
    });
    const deps = {
      fetchBook: ams.fetchBook,
      appendItems: appendSpy as AppendItemsFn,
      fetchEpicInventory: jest.fn().mockResolvedValue([]),
      callLlm,
      llmPool: new LlmConcurrencyPool(1),
      systemPromptOverride: 'SYS',
      batchSizeOverride: 12,
    };

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-retry', bookId: 'book-retry', epicId: 'cut:E1' },
      deps
    );
    expect(outcome).toMatchObject({ epicId: 'cut:E1', expansionState: 'expanded', storiesAppended: 1 });

    // EVERY write targeted the retried epic ONLY.
    expect(appendSpy.mock.calls.length).toBeGreaterThan(0);
    expect(
      appendSpy.mock.calls.every((c) => (c[2] as AppendItemsRequestBody).epic_id === 'cut:E1')
    ).toBe(true);

    // The previously expanded epic's stories and state are untouched.
    const byId = new Map(ams.store.items.map((i) => [i.id, i]));
    expect(byId.get('cut:E2-s-1')).toMatchObject({ parentId: 'cut:E2-F' });
    expect(byId.get('cut:E2')!.expansionState).toBe('expanded');
    expect(byId.get('cut:E1')!.expansionState).toBe('expanded');
    expect(byId.get('cut:E1-s-1')).toBeDefined();

    // `expanded` is terminal: re-expansion is refused as a 409 precondition.
    await expect(
      expandMigrationBookOfWorkEpic(
        { projectId: 'p-retry', bookId: 'book-retry', epicId: 'cut:E2' },
        deps
      )
    ).rejects.toMatchObject({ name: 'ExpansionPreconditionError', statusCode: 409 });
  });

  it('coverage guarantee — a batch response that DROPS an inventory item never lands: the epic fails retryably with no story append', async () => {
    const book = makeSkeletonBook();
    const inventory = [makeEndpoint(1), makeEndpoint(2), makeEndpoint(3)];
    const appendCalls: AppendItemsRequestBody[] = [];
    let batchAttempts = 0;
    const callLlm = jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
      if (userPrompt.includes('INVENTORY BATCH')) {
        batchAttempts += 1;
        const response = makeBatchResponse(inventory);
        // The LLM silently drops item 2 of 3 — "item 73 of 100".
        response.classifications = response.classifications.filter((c) => c.itemId !== 'ep-002');
        return { content: JSON.stringify(response) };
      }
      throw new Error('unexpected prompt');
    });

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-cov', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: jest.fn().mockResolvedValue(book),
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        appendItems: jest.fn().mockImplementation(async (_p, _b, body) => {
          appendCalls.push(body);
        }),
        callLlm,
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
      }
    );

    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toContain('was not classified');
    expect(batchAttempts).toBe(2); // the validation failure consumes the one retry
    // No story-carrying append: only the expanding → failed state merges.
    expect(appendCalls.map((c) => c.expansion_state)).toEqual(['expanding', 'failed']);
    expect(appendCalls.every((c) => c.items.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Route-level end-to-end (Task Group 6) — the REAL router + REAL handler
// over the DEFAULT deps: defaultFetchBook / defaultAppendItems against a
// simulated snake_case AMS wire (global fetch mocked) and the LLM client
// mocked at the llmClient seam. This is the only test that exercises the
// production wire-format contract (`book_of_work_json.items`,
// `current_architecture_id`, snake_case append body) end to end.
// ---------------------------------------------------------------------------

describe('Gateway expansion routes end-to-end (real handler + default snake_case AMS wire)', () => {
  const originalFetch = (global as unknown as { fetch: unknown }).fetch;
  const mockFetch = jest.fn();
  let amsWireItems: MigrationBookOfWorkItem[] = [];

  function httpResponse(status: number, body: string) {
    return {
      ok: status < 400,
      status,
      statusText: String(status),
      headers: {
        get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  }

  beforeEach(() => {
    (global as unknown as { fetch: unknown }).fetch = mockFetch;
    mockFetch.mockReset();
    mockSendChatRequest.mockReset();
    amsWireItems = [
      makeItem({
        id: 'cutover_rollback_decommission:I1',
        type: 'initiative',
        parentId: null,
        sequenceOrder: 1,
      }),
      makeItem({
        id: 'cutover_rollback_decommission:E1',
        type: 'epic',
        parentId: 'cutover_rollback_decommission:I1',
        sequenceOrder: 2,
        expansionState: 'not_expanded',
        tags: ['stream:cutover_rollback_decommission'],
      }),
      makeItem({
        id: 'cutover_rollback_decommission:F1',
        type: 'feature',
        parentId: 'cutover_rollback_decommission:E1',
        sequenceOrder: 3,
      }),
      makeItem({
        id: 'reconciliation_reporting:E1',
        type: 'epic',
        parentId: 'cutover_rollback_decommission:I1',
        sequenceOrder: 4,
        expansionState: 'not_expanded',
        tags: ['stream:reconciliation_reporting'],
      }),
      makeItem({
        id: 'reconciliation_reporting:F1',
        type: 'feature',
        parentId: 'reconciliation_reporting:E1',
        sequenceOrder: 5,
      }),
    ];
    mockFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (String(url).endsWith('/items/append') && init?.method === 'POST') {
        // Simulated AMS server-side merge (snake_case wire, per the AMS DTO).
        const body = JSON.parse(init.body!) as AppendItemsRequestBody;
        if (!amsWireItems.some((i) => i.id === body.epic_id && i.type === 'epic')) {
          return httpResponse(400, JSON.stringify({ error: `Unknown epic id ${body.epic_id}` }));
        }
        amsWireItems = [
          ...amsWireItems.map((i) =>
            i.id === body.epic_id ? { ...i, expansionState: body.expansion_state } : i
          ),
          ...(body.items ?? []),
        ];
        return httpResponse(200, JSON.stringify({ epicId: body.epic_id }));
      }
      // GET book — the AMS DTO speaks snake_case on the wire (repo default).
      return httpResponse(
        200,
        JSON.stringify({
          id: 'book-77',
          status: 'draft',
          current_architecture_id: 'arch-current',
          target_architecture_id: 'arch-target',
          book_of_work_json: { items: amsWireItems },
        })
      );
    });
  });

  afterAll(() => {
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  it('POST expand drives the real pipeline over the default AMS wire; the GET re-read shows a partially expanded draft', async () => {
    mockSendChatRequest.mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        const userPrompt = messages[1]?.content ?? '';
        if (userPrompt.includes('NON-INVENTORY EPIC')) {
          return {
            content: JSON.stringify({
              stories: [
                makeStory('cutover_rollback_decommission:F1', 'wire-1'),
                makeStory('cutover_rollback_decommission:F1', 'wire-2'),
              ],
            }),
          };
        }
        throw new Error(`unexpected prompt: ${userPrompt.slice(0, 60)}`);
      }
    );

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/v1', migrationBookOfWorkRouter);

    const expandRes = await request(app).post(
      '/api/v1/projects/p-77/migration-books-of-work/book-77/epics/cutover_rollback_decommission:E1/expand'
    );
    expect(expandRes.status).toBe(200);
    expect(expandRes.body).toMatchObject({
      epicId: 'cutover_rollback_decommission:E1',
      expansionState: 'expanded',
      storiesAppended: 2,
    });

    // The appends hit the AMS endpoint with the snake_case wire body
    // (expanding state-only merge first, then ONE story-carrying append).
    expect(
      mockFetch.mock.calls.some(
        ([url]) =>
          String(url) === 'http://ams.test/api/projects/p-77/migration-books-of-work/book-77/items/append'
      )
    ).toBe(true);
    const appendBodies = mockFetch.mock.calls
      .filter(([url]) => String(url).endsWith('/items/append'))
      .map(([, init]) => JSON.parse((init as { body: string }).body) as AppendItemsRequestBody);
    expect(appendBodies.map((b) => b.expansion_state)).toEqual(['expanding', 'expanded']);
    expect(appendBodies[1].epic_id).toBe('cutover_rollback_decommission:E1');
    expect(appendBodies[1].items).toHaveLength(2);

    // Draft re-read through the GET proxy: a partially expanded document the
    // frontend's draft-state-driven badges render from.
    const readRes = await request(app).get(
      '/api/v1/projects/p-77/migration-books-of-work/book-77'
    );
    expect(readRes.status).toBe(200);
    const items = readRes.body.book_of_work_json.items as MigrationBookOfWorkItem[];
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get('cutover_rollback_decommission:E1')!.expansionState).toBe('expanded');
    expect(byId.get('reconciliation_reporting:E1')!.expansionState).toBe('not_expanded');
    expect(
      items
        .filter((i) => i.type === 'story')
        .map((i) => i.id)
        .sort()
    ).toEqual([
      'cutover_rollback_decommission:E1-s-1',
      'cutover_rollback_decommission:E1-s-2',
    ]);
  });
});
