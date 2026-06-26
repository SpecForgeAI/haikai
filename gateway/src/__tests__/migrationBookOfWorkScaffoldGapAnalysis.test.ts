/**
 * Cross-tier gap-analysis tests (Spec 2026-06-26 Book-of-Work Scaffold +
 * Reference Names — Task Group 5).
 *
 * The MUST end-to-end regression (an epic expansion SUCCEEDS hierarchy-legal
 * with a confirmed manifest, producing exactly one scaffold feature + one
 * scaffold story under the host epic) is ALREADY covered green by
 * `migrationBookOfWorkScaffoldInjection.test.ts` (the KEY REGRESSION case) and
 * is intentionally NOT duplicated here.
 *
 * This file fills two genuinely untested INTEGRATION seams that the Group 1-4
 * unit/regression tests leave open:
 *
 *   1. "Expand all" homing through the real expansion pipeline: with MULTIPLE
 *      sibling service-api epics present, the scaffold lands under the HOST
 *      (lowest-`sequenceOrder`) epic and sequences FIRST among the host's own
 *      features — not under whichever sibling exists or is expanded. The
 *      injection suite only proves the single-host positive and the non-host
 *      negative; the multi-epic positive (scaffold parents to the correct host,
 *      never the sibling) is new here.
 *   2. The FR5 service-name FALLBACK (path 3, workstream label) feeding the FR3
 *      story title THROUGH the full expansion path. The injection suite only
 *      drives the FK-resolved name into the title; the fallback label reaching
 *      the title end-to-end (while expansion still SUCCEEDS) is new here.
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

function makeBatchResponse(batch: InventoryWorkItem[], parentFeatureId: string) {
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
      parentFeatureId,
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

function makeCallLlm(inventory: InventoryWorkItem[], parentFeatureId: string) {
  return jest.fn().mockImplementation(async ({ userPrompt }: LlmArgs) => {
    if (userPrompt.includes('INVENTORY BATCH')) {
      return { content: JSON.stringify(makeBatchResponse(inventory, parentFeatureId)) };
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

describe('Scaffold homing + service-name integration seams (Spec 2026-06-26 Task Group 5)', () => {
  it('"Expand all": the scaffold homes under the HOST epic among sibling service-api epics, sequenced first under the host (never the sibling)', async () => {
    // Two service-api epics under one initiative. E0 (sequenceOrder 1) is the
    // host; E1 (sequenceOrder 2) is a sibling. Each owns one feature. We expand
    // the HOST E0 -> the scaffold must parent to E0 and to E0's own feature,
    // and must NOT reference the sibling epic E1 or its feature in any way.
    const I1 = makeItem({ id: `${STREAM}:I1`, type: 'initiative', parentId: null, sequenceOrder: 1 });
    const E0 = makeItem({
      id: `${STREAM}:E0`,
      type: 'epic',
      parentId: `${STREAM}:I1`,
      sequenceOrder: 1, // lowest in the mapped workstream -> the host
      expansionState: 'not_expanded',
    });
    const F0 = makeItem({ id: `${STREAM}:F0`, type: 'feature', parentId: `${STREAM}:E0`, sequenceOrder: 3 });
    const E1 = makeItem({
      id: `${STREAM}:E1`,
      type: 'epic',
      parentId: `${STREAM}:I1`,
      sequenceOrder: 2, // higher sequence sibling -> NOT the host
      expansionState: 'not_expanded',
    });
    const F1 = makeItem({ id: `${STREAM}:F1`, type: 'feature', parentId: `${STREAM}:E1`, sequenceOrder: 1 });

    const ams = makeInMemoryAms([I1, E0, F0, E1, F1]);
    const inventory = [makeEndpoint(1), makeEndpoint(2)];

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: `${STREAM}:E0` },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        callLlm: makeCallLlm(inventory, `${STREAM}:F0`),
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

    // Exactly one scaffold feature, parented to the HOST epic (E0), not E1.
    const scaffoldFeatures = appended.filter(
      (i) => i.type === 'feature' && i.title === SCAFFOLD_FEATURE_TITLE
    );
    expect(scaffoldFeatures).toHaveLength(1);
    const scaffoldFeature = scaffoldFeatures[0];
    expect(scaffoldFeature.parentId).toBe(`${STREAM}:E0`);
    // Sequenced FIRST under the host: below E0's existing feature (seq 3).
    expect(scaffoldFeature.sequenceOrder).toBeLessThan(3);

    // Exactly one scaffold story, parented to that scaffold feature.
    const scaffoldStories = appended.filter((i) => (i.tags ?? []).includes('seed_build_files'));
    expect(scaffoldStories).toHaveLength(1);
    expect(scaffoldStories[0].parentId).toBe(scaffoldFeature.id);

    // Nothing appended this expansion parents to the sibling epic or its feature.
    for (const item of appended) {
      expect(item.parentId).not.toBe(`${STREAM}:E1`);
      expect(item.parentId).not.toBe(`${STREAM}:F1`);
    }

    // The full persisted document (both epics + scaffold) is hierarchy-legal.
    expect(validateBookOfWorkHierarchy(ams.store.items).ok).toBe(true);
  });

  it('service-name FALLBACK (no FK match, no single service) feeds the workstream label into the story title while expansion SUCCEEDS', async () => {
    // Manifest carries no Spec-4 FK and no service is resolvable -> fallback
    // path 3 (workstream label "service API") must flow into the story title.
    const I1 = makeItem({ id: `${STREAM}:I1`, type: 'initiative', parentId: null, sequenceOrder: 1 });
    const E0 = makeItem({
      id: `${STREAM}:E0`,
      type: 'epic',
      parentId: `${STREAM}:I1`,
      sequenceOrder: 1,
      expansionState: 'not_expanded',
    });
    const F0 = makeItem({ id: `${STREAM}:F0`, type: 'feature', parentId: `${STREAM}:E0`, sequenceOrder: 3 });

    const ams = makeInMemoryAms([I1, E0, F0]);
    const inventory = [makeEndpoint(1)];

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'p-1', bookId: 'book-1', epicId: `${STREAM}:E0` },
      {
        fetchBook: ams.fetchBook,
        appendItems: ams.appendItems,
        fetchEpicInventory: jest.fn().mockResolvedValue(inventory),
        callLlm: makeCallLlm(inventory, `${STREAM}:F0`),
        llmPool: new LlmConcurrencyPool(1),
        systemPromptOverride: 'SYS',
        batchSizeOverride: 12,
        // Manifest with NO bound service element id.
        fetchTargetManifestArtifacts: jest
          .fn()
          .mockResolvedValue([manifest({ target_service_element_id: null })]),
        // No services resolvable -> drops to the workstream label.
        fetchScaffoldServices: jest.fn().mockResolvedValue([]),
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    const appended = ams.appendCalls.find((c) => c.expansion_state === 'expanded')!.items;

    const scaffoldStory = appended.find((i) => (i.tags ?? []).includes('seed_build_files'))!;
    expect(scaffoldStory).toBeDefined();
    // FR5 path-3 label "service API" reaches the FR3 title through expansion.
    expect(scaffoldStory.title).toBe(
      'Scaffold the service API app and reproduce pom.xml exactly as confirmed, dependency-for-dependency.'
    );
    // Unresolved service id -> no traceability ref carried.
    expect(scaffoldStory.architectureReferences ?? []).toEqual([]);

    // Still hierarchy-legal by construction despite the unresolved name.
    expect(validateBookOfWorkHierarchy(ams.store.items).ok).toBe(true);
  });
});
