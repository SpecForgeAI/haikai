/**
 * Tests for expansion-time scaffold feature+story injection (Spec 2026-06-26
 * Book-of-Work Scaffold + Reference Names — Task Group 3).
 *
 * THE KEY REGRESSION: an epic expansion SUCCEEDS for a book with a confirmed
 * target manifest present — the exact scenario that fails today on the orphan
 * `parentId:null` seed story. Plus: exactly one "Scaffold & build foundation"
 * feature (parent = host epic, sequenced first) + one scaffold story (parent =
 * that feature); the scaffold story does not trip the coverage check; and NO
 * injection when no confirmed manifest exists at expansion time.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://ams.test',
    migrationPlanLlmConcurrency: 1,
    migrationPlanExpansionBatchSize: 12,
  }),
  resetConfig: jest.fn(),
}));

import {
  AppendItemsFn,
  AppendItemsRequestBody,
  FetchBookFn,
  FetchedBookOfWork,
  InventoryWorkItem,
  SCAFFOLD_FEATURE_TITLE,
  expandMigrationBookOfWorkEpic,
  resetActiveExpansionsForTests,
} from '../services/migrationBookOfWorkExpansionHandler';
import {
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';
import { TargetManifestArtifactWire } from '../services/targetManifestArtifactsClient';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';

const STREAM = 'target_service_api_implementation';
const EPIC_ID = `${STREAM}:E1`;
const FEATURE_ID = `${STREAM}:F1`;

function makeItem(overrides: Partial<MigrationBookOfWorkItem>): MigrationBookOfWorkItem {
  return {
    id: 'X',
    type: 'feature',
    parentId: null,
    title: 'title',
    description: 'description',
    acceptanceCriteria: [],
    workstream: STREAM as MigrationBookOfWorkItem['workstream'],
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

function makeSkeletonBook(): FetchedBookOfWork {
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
      }),
      makeItem({ id: FEATURE_ID, type: 'feature', parentId: EPIC_ID, sequenceOrder: 3 }),
    ],
  };
}

function makeEndpoint(n: number): InventoryWorkItem {
  return {
    id: `ep-${String(n).padStart(3, '0')}`,
    name: `GET /customers/${n}`,
    kind: 'api_endpoint',
    method: 'GET',
    path: `/customers/${n}`,
    baselineId: `baseline-${n}`,
    attachedFindingIds: [],
    readiness: 'ready_for_spec',
  };
}

function makeBatchResponse(batch: InventoryWorkItem[]) {
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
      classification: 'standard',
      workType: 'api_endpoint',
      parentFeatureId: FEATURE_ID,
    })),
    bespokeStories: [],
  };
}

function manifest(overrides: Partial<TargetManifestArtifactWire> = {}): TargetManifestArtifactWire {
  return {
    id: 'row-1',
    project_id: 'p',
    target_architecture_id: 'arch-target',
    tag: 'orders-service',
    kind: 'pom',
    ecosystem: 'maven',
    manifest_path: 'orders-service/pom.xml',
    content: '<project/>',
    package_lock_content: null,
    resolved_dependencies: [],
    target_service_element_id: 'svc-el-1',
    is_latest: true,
    created_at: '2026-06-26T00:00:00Z',
    ...overrides,
  };
}

function makeInMemoryAms(initialItems: MigrationBookOfWorkItem[]): {
  store: { items: MigrationBookOfWorkItem[] };
  fetchBook: FetchBookFn;
  appendItems: AppendItemsFn;
  appendCalls: AppendItemsRequestBody[];
} {
  const store = { items: initialItems.map((i) => ({ ...i })) };
  const appendCalls: AppendItemsRequestBody[] = [];
  const fetchBook: FetchBookFn = async (_projectId, requestedBookId) => ({
    bookId: requestedBookId,
    status: 'draft',
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    items: store.items.map((i) => ({ ...i })),
  });
  const appendItems: AppendItemsFn = async (_projectId, _bookId, body) => {
    appendCalls.push(body);
    store.items = [
      ...store.items.map((i) =>
        i.id === body.epic_id ? { ...i, expansionState: body.expansion_state } : i
      ),
      ...body.items.map((i) => ({ ...i })),
    ];
  };
  return { store, fetchBook, appendItems, appendCalls };
}

type LlmArgs = { systemPrompt: string; userPrompt: string; projectId: string };

function makeCallLlm(inventory: InventoryWorkItem[]) {
  return jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
    if (userPrompt.includes('INVENTORY BATCH')) {
      return { content: JSON.stringify(makeBatchResponse(inventory)) };
    }
    if (userPrompt.includes('EXPANSION JUDGE')) {
      return { content: JSON.stringify({ flaggedItemIds: [] }) };
    }
    throw new Error(`unexpected prompt: ${userPrompt.slice(0, 60)}`);
  });
}

beforeEach(() => {
  resetActiveExpansionsForTests();
});

describe('Expansion-time scaffold injection (Spec 2026-06-26 FR2/FR3/FR4)', () => {
  it('KEY REGRESSION — expansion SUCCEEDS with a confirmed manifest present, and injects exactly one scaffold feature + story', async () => {
    const inventory = [makeEndpoint(1), makeEndpoint(2)];
    const ams = makeInMemoryAms(makeSkeletonBook().items);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        callLlm: makeCallLlm(inventory),
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        fetchTargetManifestArtifacts: jest.fn().mockResolvedValue([manifest()]),
        fetchScaffoldServices: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-el-1', name: 'Orders Service' }]),
      }
    );

    // The exact scenario that fails today on the orphan now SUCCEEDS.
    expect(outcome.expansionState).toBe('expanded');

    // The single story-carrying append rode feature + story + the epic stories.
    const storyAppend = ams.appendCalls.find((c) => c.expansion_state === 'expanded')!;
    expect(storyAppend).toBeDefined();
    const appended = storyAppend.items;

    // Exactly one scaffold feature, parented to the host epic, sequenced FIRST.
    const scaffoldFeatures = appended.filter(
      (i) => i.type === 'feature' && i.title === SCAFFOLD_FEATURE_TITLE
    );
    expect(scaffoldFeatures).toHaveLength(1);
    const scaffoldFeature = scaffoldFeatures[0];
    expect(scaffoldFeature.parentId).toBe(EPIC_ID);
    // First feature: below the epic's existing feature (sequenceOrder 3).
    expect(scaffoldFeature.sequenceOrder).toBeLessThan(3);

    // Exactly one scaffold story, parented to the scaffold feature.
    const scaffoldStories = appended.filter((i) => (i.tags ?? []).includes('seed_build_files'));
    expect(scaffoldStories).toHaveLength(1);
    const scaffoldStory = scaffoldStories[0];
    expect(scaffoldStory.type).toBe('story');
    expect(scaffoldStory.parentId).toBe(scaffoldFeature.id);
    expect(scaffoldStory.readiness).toBe('ready_for_spec');
    expect(scaffoldStory.confidence).toBe('high');
    // FR3 seed sentence with the resolved service name + manifest filename.
    expect(scaffoldStory.title).toBe(
      'Scaffold the Orders Service app and reproduce pom.xml exactly as confirmed, dependency-for-dependency.'
    );
    // FR5 traceability: the resolved service id rides the story.
    expect(scaffoldStory.architectureReferences).toEqual(['svc-el-1']);

    // The inventory stories are still all present (coverage check did NOT trip).
    const inventoryStories = appended.filter((i) => (i.tags ?? []).some((t) => t.startsWith('inventory:')));
    expect(inventoryStories).toHaveLength(2);

    // The full persisted document is hierarchy-legal by construction.
    expect(validateBookOfWorkHierarchy(ams.store.items).ok).toBe(true);
  });

  it('injects NOTHING when no confirmed manifest exists at expansion time (expands normally)', async () => {
    const inventory = [makeEndpoint(1), makeEndpoint(2)];
    const ams = makeInMemoryAms(makeSkeletonBook().items);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        callLlm: makeCallLlm(inventory),
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        fetchTargetManifestArtifacts: jest.fn().mockResolvedValue([]),
        fetchScaffoldServices: jest.fn(),
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    const appended = ams.appendCalls.find((c) => c.expansion_state === 'expanded')!.items;
    expect(appended.some((i) => i.title === SCAFFOLD_FEATURE_TITLE)).toBe(false);
    expect(appended.some((i) => (i.tags ?? []).includes('seed_build_files'))).toBe(false);
    // No need to resolve services when there is no manifest gate hit.
    expect((outcome as { error?: string }).error).toBeUndefined();
  });

  it('injects NOTHING when the epic being expanded is NOT the scaffold host', async () => {
    // Two service-api epics; the LOWER-sequence one is the host. Expanding the
    // HIGHER one must not inject (works regardless of click order).
    const book = makeSkeletonBook();
    const hostEpic = makeItem({
      id: `${STREAM}:E0`,
      type: 'epic',
      parentId: `${STREAM}:I1`,
      sequenceOrder: 1, // lower than EPIC_ID (sequenceOrder 2) -> the host
      expansionState: 'not_expanded',
    });
    const hostFeature = makeItem({
      id: `${STREAM}:F0`,
      type: 'feature',
      parentId: `${STREAM}:E0`,
      sequenceOrder: 1,
    });
    const ams = makeInMemoryAms([...book.items, hostEpic, hostFeature]);
    const inventory = [makeEndpoint(1)];

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: EPIC_ID },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        callLlm: makeCallLlm(inventory),
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        fetchTargetManifestArtifacts: jest.fn().mockResolvedValue([manifest()]),
        fetchScaffoldServices: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-el-1', name: 'Orders Service' }]),
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    const appended = ams.appendCalls.find((c) => c.expansion_state === 'expanded')!.items;
    expect(appended.some((i) => i.title === SCAFFOLD_FEATURE_TITLE)).toBe(false);
  });
});
