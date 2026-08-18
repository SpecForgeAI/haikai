/**
 * SCL corpus-derived spec plan — book-of-work expansion integration pins
 * (SCL pipeline spec 7, 2026-08-18 design "Spec plan restructure" +
 * "Rulings round 2").
 *
 * Pins:
 *   - corpus plan PRESENT + foundations epic: the "Corpus-derived
 *     foundations" feature appears under the SAME epic as the legacy
 *     cross-cutting foundations feature, one story per non-empty layer,
 *     provenance/tags/extras correct — ADDITIVE (legacy foundation stories
 *     untouched);
 *   - corpus plan PRESENT + interfaces epic: the corpus endpoint groups
 *     REPLACE the legacy interface-cluster stories (clean-slate ruling),
 *     external groups before internal, one feature per controller;
 *   - corpus plan ABSENT (null): output BYTE-IDENTICAL to the legacy
 *     deterministic expansion;
 *   - corpus loader THROWS: legacy path + warn (fail-soft, never blocks).
 */

import {
  AppendItemsRequestBody,
  FetchedBookOfWork,
  MigrationBookOfWorkExpansionDeps,
  SCL_CORPUS_PROVENANCE_TAG,
  CORPUS_FOUNDATIONS_FEATURE_TITLE,
  expandMigrationBookOfWorkEpic,
} from '../services/migrationBookOfWorkExpansionHandler';
import {
  CodeEndpointRow,
  CodeModelView,
  buildCodeEpicStories,
  buildCodeStreamSkeleton,
} from '../services/migrationCodeStreamPlanner';
import { SclCorpusPlan } from '../services/sclCorpusPlanner';
import {
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';

const STREAM = 'api_migration';

function ep(id: string, interfaceId: string, verb: string, path: string): CodeEndpointRow {
  return {
    id,
    name: `${verb} ${path}`,
    interfaceId,
    interfaceName: `Iface ${interfaceId}`,
    interfaceType: 'REST_API',
    endpointType: 'REST',
    protocol: 'HTTP',
    verb,
    path,
    direction: 'inbound',
    hasProtocolMetadata: true,
  };
}

const ENDPOINTS = [
  ep('e-1', 'iface-1', 'GET', '/owners'),
  ep('e-2', 'iface-1', 'POST', '/owners'),
  ep('e-3', 'iface-2', 'GET', '/pets'),
];

function makeView(): CodeModelView {
  const baselineByEndpointId = new Map(ENDPOINTS.map((e) => [e.id, `baseline-${e.id}`]));
  return { endpoints: ENDPOINTS, baselineByEndpointId, findingIdsByEndpointId: new Map() };
}

function makeBook(view: CodeModelView): FetchedBookOfWork {
  const skeleton = buildCodeStreamSkeleton({ stream: STREAM, view, clusterCap: 15 });
  const items: MigrationBookOfWorkItem[] = skeleton.items.map((item) => ({
    ...item,
    id: `${STREAM}:${item.id}`,
    parentId: item.parentId === null ? null : `${STREAM}:${item.parentId}`,
    ...(item.type === 'epic' ? { expansionState: 'not_expanded' as const } : {}),
  }));
  return {
    bookId: 'book-corpus',
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
    appendItems: jest
      .fn()
      .mockImplementation(async (_p: string, _b: string, body: AppendItemsRequestBody) => {
        appends.push({ body });
      }),
  };
}

const throwingLlm = jest.fn().mockImplementation(async () => {
  throw new Error('LLM must NEVER be called for a code epic');
});

function depsWith(
  ams: ReturnType<typeof makeAms>,
  view: CodeModelView | null,
  extra: Partial<MigrationBookOfWorkExpansionDeps> = {}
): MigrationBookOfWorkExpansionDeps {
  return {
    fetchBook: ams.fetchBook,
    appendItems: ams.appendItems,
    fetchEpicInventory: jest.fn().mockResolvedValue([]),
    callLlm: throwingLlm,
    llmPool: new LlmConcurrencyPool(1),
    systemPromptOverride: 'SYS',
    batchSizeOverride: 12,
    ensurePack: jest.fn(),
    fetchPackView: jest.fn(),
    dbClusterCapOverride: 25,
    fetchCodeModelView: jest.fn().mockResolvedValue(view),
    apiClusterCapOverride: 15,
    // Keep the scaffold gate quiet + deterministic (no manifests, no network).
    fetchTargetManifestArtifacts: jest.fn().mockResolvedValue([]),
    fetchScaffoldServices: jest.fn().mockResolvedValue([]),
    ...extra,
  };
}

/** Hand-built corpus plan: 1 external controller, 1 internal job, 2 layers. */
function makePlan(): SclCorpusPlan {
  return {
    foundationStories: [
      {
        layer: 'dto-shapes',
        title: 'DTO & domain shapes',
        description: '3 shape contract(s); 1 mutated-in-flight.',
        contractKeys: ['S-ENV', 'S-ORDER', 'S-USER'],
        rowCount: 0,
        tags: ['scl', 'scl:foundation:dto-shapes'],
      },
      {
        layer: 'data-access',
        title: 'Data-access layer',
        description: '2 boundary [Q-] contract(s).',
        contractKeys: ['Q-ORD', 'Q-USR'],
        rowCount: 0,
        tags: ['scl', 'scl:foundation:data-access'],
      },
    ],
    externalEndpointGroups: [
      {
        layer: 'endpoint:external',
        title: 'Implement OrdersController (2 endpoints)',
        description: '2 external endpoint method(s) of com.app.OrdersController.',
        contractKeys: ['T-ORD-GET', 'T-ORD-VAL', 'T-ORD-LIST'],
        rowCount: 7,
        tags: ['scl', 'scl:endpoint:external'],
        controllerClass: 'com.app.OrdersController',
      },
    ],
    internalEndpointGroups: [
      {
        layer: 'endpoint:internal',
        title: 'Implement NightlyJob (1 endpoints)',
        description: '1 internal endpoint method(s) of com.app.NightlyJob.',
        contractKeys: ['T-JOB'],
        rowCount: 5,
        tags: ['scl', 'scl:endpoint:internal'],
        controllerClass: 'com.app.NightlyJob',
      },
    ],
    stats: { sharedContractCount: 2, controllerCount: 2, splitCount: 0, rowBudget: 40 },
  };
}

const INTERFACES_EPIC = `${STREAM}:${STREAM}-epic-interfaces`;
const FOUNDATIONS_EPIC = `${STREAM}:${STREAM}-epic-foundations`;

describe('Corpus plan PRESENT — interfaces epic (clean-slate replacement)', () => {
  it('replaces the legacy interface-cluster stories with corpus endpoint groups, external first', async () => {
    const book = makeBook(makeView());
    const ams = makeAms(book);
    const logSpy = jest.spyOn(console, 'log');

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-corpus', epicId: INTERFACES_EPIC },
      depsWith(ams, makeView(), { loadCorpusPlan: jest.fn().mockResolvedValue(makePlan()) })
    );

    expect(outcome.expansionState).toBe('expanded');
    expect(throwingLlm).not.toHaveBeenCalled();
    const finalAppend = ams.appends[ams.appends.length - 1].body;

    // Legacy interface-cluster stories are GONE (clean-slate replacement).
    const blobs = finalAppend.items as unknown as Array<Record<string, unknown>>;
    expect(blobs.some((i) => i.codeStoryKind === 'interface-cluster')).toBe(false);
    expect(finalAppend.items.some((i) => (i.title ?? '').includes('Iface iface-1'))).toBe(false);

    // 1 external feature + 1 story, then 1 internal feature + 1 story.
    const features = finalAppend.items.filter((i) => i.type === 'feature');
    const stories = finalAppend.items.filter((i) => i.type === 'story');
    expect(features).toHaveLength(2);
    expect(stories).toHaveLength(2);
    expect(finalAppend.items.map((i) => i.title)).toEqual([
      'OrdersController — corpus endpoint group (external)',
      'Implement OrdersController (2 endpoints)',
      'NightlyJob — corpus endpoint group (internal)',
      'Implement NightlyJob (1 endpoints)',
    ]);

    // Features parent to the interfaces epic; stories to their feature.
    for (const feature of features) expect(feature.parentId).toBe(INTERFACES_EPIC);
    expect(stories[0].parentId).toBe(features[0].id);
    expect(stories[1].parentId).toBe(features[1].id);

    // Tags + provenance + extras (item-json conventions).
    for (const item of finalAppend.items) {
      expect(item.tags).toContain('provenance:plan-deterministic');
      expect(item.tags).toContain(SCL_CORPUS_PROVENANCE_TAG);
      expect(item.tags).toContain('scl');
      expect(item.tags).toContain(`stream:${STREAM}`);
    }
    expect(stories[0].tags).toContain('scl:endpoint:external');
    expect(stories[1].tags).toContain('scl:endpoint:internal');
    const externalBlob = stories[0] as unknown as Record<string, unknown>;
    expect(externalBlob.codeStoryKind).toBe('scl-endpoint-group');
    expect(externalBlob.scl_contract_keys).toEqual(['T-ORD-GET', 'T-ORD-VAL', 'T-ORD-LIST']);
    expect(externalBlob.scl_row_count).toBe(7);
    expect(externalBlob.scl_controller_class).toBe('com.app.OrdersController');
    expect(externalBlob.apiEndpointIds).toEqual([]);

    // Loud path log + valid merged hierarchy.
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes('migration_bow_expansion corpus_plan_used stories=2')
      )
    ).toBe(true);
    const merged = validateBookOfWorkHierarchy([...book.items, ...finalAppend.items]);
    expect(merged.ok).toBe(true);
    logSpy.mockRestore();
  });
});

describe('Corpus plan PRESENT — foundations epic (additive sibling feature)', () => {
  it('adds the "Corpus-derived foundations" feature + one story per layer, legacy stories intact', async () => {
    const book = makeBook(makeView());
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-corpus', epicId: FOUNDATIONS_EPIC },
      depsWith(ams, makeView(), { loadCorpusPlan: jest.fn().mockResolvedValue(makePlan()) })
    );

    expect(outcome.expansionState).toBe('expanded');
    const finalAppend = ams.appends[ams.appends.length - 1].body;

    // Legacy deterministic foundation stories are UNTOUCHED (4 for the api
    // stream: security / serialization / environment / data-access).
    const legacyFoundationStories = finalAppend.items.filter(
      (i) => i.type === 'story' && !(i.tags ?? []).includes(SCL_CORPUS_PROVENANCE_TAG)
    );
    expect(legacyFoundationStories).toHaveLength(4);

    // The new sibling feature, under the SAME foundations epic.
    const corpusFeature = finalAppend.items.find(
      (i) => i.type === 'feature' && i.title === CORPUS_FOUNDATIONS_FEATURE_TITLE
    );
    expect(corpusFeature).toBeDefined();
    expect(corpusFeature!.parentId).toBe(FOUNDATIONS_EPIC);
    expect(corpusFeature!.tags).toContain(SCL_CORPUS_PROVENANCE_TAG);

    // One story per non-empty layer, in layer order, with the scl extras.
    const corpusStories = finalAppend.items.filter(
      (i) => i.type === 'story' && i.parentId === corpusFeature!.id
    );
    expect(corpusStories.map((s) => s.title)).toEqual([
      'DTO & domain shapes',
      'Data-access layer',
    ]);
    const dtoBlob = corpusStories[0] as unknown as Record<string, unknown>;
    expect(dtoBlob.codeStoryKind).toBe('foundation');
    expect(dtoBlob.scl_layer).toBe('dto-shapes');
    expect(dtoBlob.scl_contract_keys).toEqual(['S-ENV', 'S-ORDER', 'S-USER']);
    expect(dtoBlob.scl_row_count).toBe(0);
    expect(corpusStories[0].tags).toContain('scl:foundation:dto-shapes');
    expect(corpusStories[0].tags).toContain('provenance:plan-deterministic');

    const merged = validateBookOfWorkHierarchy([...book.items, ...finalAppend.items]);
    expect(merged.ok).toBe(true);
  });
});

describe('FAIL-SOFT — corpus absent / loader throw ⇒ legacy path byte-identical', () => {
  /** The exact legacy expansion output for an epic of the fixture book. */
  function legacyExpected(book: FetchedBookOfWork, epicId: string): MigrationBookOfWorkItem[] {
    const epic = book.items.find((i) => i.id === epicId)!;
    const features = book.items.filter((i) => i.type === 'feature' && i.parentId === epicId);
    const maxSequence = book.items.reduce((m, i) => Math.max(m, i.sequenceOrder ?? 0), 0);
    return buildCodeEpicStories({
      epic,
      features,
      stream: STREAM,
      view: makeView(),
      clusterCap: 15,
      maxSequence,
    }).map((it) => ({ ...it, expansionGenerated: true }));
  }

  it('loader resolves null ⇒ output deep-equals the legacy expansion (interfaces epic)', async () => {
    const book = makeBook(makeView());
    const ams = makeAms(book);
    const logSpy = jest.spyOn(console, 'log');

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-corpus', epicId: INTERFACES_EPIC },
      depsWith(ams, makeView(), { loadCorpusPlan: jest.fn().mockResolvedValue(null) })
    );

    expect(outcome).toMatchObject({ expansionState: 'expanded', storiesAppended: 2 });
    const finalAppend = ams.appends[ams.appends.length - 1].body;
    expect(finalAppend.items).toEqual(legacyExpected(book, INTERFACES_EPIC));
    expect(finalAppend.items.every((i) => !(i.tags ?? []).includes(SCL_CORPUS_PROVENANCE_TAG))).toBe(
      true
    );
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes('migration_bow_expansion corpus_plan_absent legacy_path')
      )
    ).toBe(true);
    logSpy.mockRestore();
  });

  it('loader THROWS ⇒ legacy path + warn (fail-soft, expansion still succeeds)', async () => {
    const book = makeBook(makeView());
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-corpus', epicId: INTERFACES_EPIC },
      depsWith(ams, makeView(), {
        loadCorpusPlan: jest.fn().mockRejectedValue(new Error('AMS unreachable')),
      })
    );

    expect(outcome).toMatchObject({ expansionState: 'expanded', storiesAppended: 2 });
    const finalAppend = ams.appends[ams.appends.length - 1].body;
    expect(finalAppend.items).toEqual(legacyExpected(book, INTERFACES_EPIC));
  });

  it('foundations epic with corpus absent stays byte-identical too', async () => {
    const book = makeBook(makeView());
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-corpus', epicId: FOUNDATIONS_EPIC },
      depsWith(ams, makeView(), { loadCorpusPlan: jest.fn().mockResolvedValue(null) })
    );

    expect(outcome.expansionState).toBe('expanded');
    const finalAppend = ams.appends[ams.appends.length - 1].body;
    expect(finalAppend.items).toEqual(legacyExpected(book, FOUNDATIONS_EPIC));
  });
});
