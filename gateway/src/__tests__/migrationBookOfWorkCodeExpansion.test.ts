/**
 * Integration pins — deterministic CODE-epic expansion through the REAL
 * per-epic pipeline + execution-driver manual-gate semantics
 * (Spec 2026-07-06-g, Code-Tier Oracle Program).
 *
 * Pins:
 *   - a code epic expands with ZERO LLM calls (callLlm mock throws if touched)
 *   - stories land via ONE atomic append, merged hierarchy valid, tagged
 *     `provenance:plan-deterministic`
 *   - model drift since the skeleton fails the epic (retryable, state-only)
 *   - an unreadable model fails the epic (never a guessed expansion)
 *   - MANUAL-GATE stories are never dispatched to the implement service and
 *     never demanded spec-ready by the hard-block gate
 */

import {
  expandMigrationBookOfWorkEpic,
  AppendItemsRequestBody,
  FetchedBookOfWork,
} from '../services/migrationBookOfWorkExpansionHandler';
import {
  CodeEndpointRow,
  CodeModelView,
  MANUAL_GATE_TAG,
  buildCodeStreamSkeleton,
} from '../services/migrationCodeStreamPlanner';
import {
  MigrationBookOfWorkItem,
  validateBookOfWorkHierarchy,
} from '../services/generatedMigrationBookOfWorkSchema';
import { LlmConcurrencyPool } from '../services/llmConcurrencyPool';
import {
  buildOrderedDispatchSet,
  evaluateHardBlock,
} from '../services/migrationExecutionDriver';

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

function makeView(endpoints: CodeEndpointRow[]): CodeModelView {
  const baselineByEndpointId = new Map(endpoints.map((e) => [e.id, `baseline-${e.id}`]));
  return { endpoints, baselineByEndpointId, findingIdsByEndpointId: new Map() };
}

const ENDPOINTS = [
  ep('e-1', 'iface-1', 'GET', '/owners'),
  ep('e-2', 'iface-1', 'POST', '/owners'),
  ep('e-3', 'iface-2', 'GET', '/pets'),
];

/** Book document as phase-1 would persist it (namespaced + state-seeded). */
function makeBook(view: CodeModelView): FetchedBookOfWork {
  const skeleton = buildCodeStreamSkeleton({ stream: STREAM, view, clusterCap: 15 });
  const items: MigrationBookOfWorkItem[] = skeleton.items.map((item) => ({
    ...item,
    id: `${STREAM}:${item.id}`,
    parentId: item.parentId === null ? null : `${STREAM}:${item.parentId}`,
    ...(item.type === 'epic' ? { expansionState: 'not_expanded' as const } : {}),
  }));
  return {
    bookId: 'book-code',
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

function depsWith(ams: ReturnType<typeof makeAms>, view: CodeModelView | null) {
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
  };
}

describe('Deterministic code-epic expansion (Spec 2026-07-06-g)', () => {
  beforeEach(() => throwingLlm.mockClear());

  it('expands the interfaces epic with zero LLM calls, one atomic append, valid merged hierarchy', async () => {
    const view = makeView(ENDPOINTS);
    const book = makeBook(view);
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-interfaces` },
      depsWith(ams, view)
    );

    // 2 interfaces -> 2 cluster stories.
    expect(outcome).toMatchObject({ expansionState: 'expanded', storiesAppended: 2 });
    expect(throwingLlm).not.toHaveBeenCalled();

    expect(ams.appends).toHaveLength(2);
    expect(ams.appends[0].body).toMatchObject({ items: [], expansion_state: 'expanding' });
    const finalAppend = ams.appends[1].body;
    expect(finalAppend.expansion_state).toBe('expanded');
    expect(finalAppend.items).toHaveLength(2);
    expect(
      finalAppend.items.every((s) => (s.tags ?? []).includes('provenance:plan-deterministic'))
    ).toBe(true);

    const merged = validateBookOfWorkHierarchy([...book.items, ...finalAppend.items]);
    expect(merged.ok).toBe(true);
  });

  it('fails the epic (retryable, state-only) when the model drifted since the skeleton', async () => {
    const view = makeView(ENDPOINTS);
    const book = makeBook(view);
    const ams = makeAms(book);
    const grown = makeView([...ENDPOINTS, ep('e-new', 'iface-2', 'GET', '/pets/new')]);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-interfaces` },
      depsWith(ams, grown)
    );

    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toMatch(/regenerate the migration plan/);
    const last = ams.appends[ams.appends.length - 1].body;
    expect(last.items).toHaveLength(0);
    expect(last.expansion_state).toBe('failed');
    expect(throwingLlm).not.toHaveBeenCalled();
  });

  it('injects a confirmed MAVEN scaffold onto the deterministic foundations epic (the stream host)', async () => {
    const view = makeView(ENDPOINTS);
    const book = makeBook(view);
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-foundations` },
      {
        ...depsWith(ams, view),
        fetchTargetManifestArtifacts: jest.fn().mockResolvedValue([
          {
            id: 'row-1',
            project_id: 'proj-1',
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
          },
        ]),
        fetchScaffoldServices: jest
          .fn()
          .mockResolvedValue([{ id: 'svc-el-1', name: 'Orders Service' }]),
      }
    );

    expect(outcome.expansionState).toBe('expanded');
    expect(throwingLlm).not.toHaveBeenCalled();
    const finalAppend = ams.appends[ams.appends.length - 1].body;
    // 3 deterministic foundation stories + scaffold feature + scaffold story.
    const scaffoldStories = finalAppend.items.filter((i) =>
      (i.tags ?? []).includes('seed_build_files')
    );
    expect(scaffoldStories).toHaveLength(1);
    expect(scaffoldStories[0].title).toContain('pom.xml');
    const merged = validateBookOfWorkHierarchy([...book.items, ...finalAppend.items]);
    expect(merged.ok).toBe(true);
  });

  it('fails the epic when the committed model cannot be read (never guesses)', async () => {
    const view = makeView(ENDPOINTS);
    const book = makeBook(view);
    const ams = makeAms(book);

    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-interfaces` },
      depsWith(ams, null)
    );

    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toMatch(/could not be read/);
  });
});

describe('MANUAL-GATE PINS (execution driver)', () => {
  const manualStory = {
    id: 's-capture',
    parentId: 'f-1',
    type: 'story',
    title: 'Capture API behaviour baseline — Iface iface-1',
    sequenceOrder: 1,
    workItemId: 'wi-capture',
    tags: ['provenance:plan-deterministic', MANUAL_GATE_TAG],
  };
  const normalStory = {
    id: 's-impl',
    parentId: 'f-1',
    type: 'story',
    title: 'Implement Iface iface-1',
    sequenceOrder: 2,
    workItemId: 'wi-impl',
    tags: ['provenance:plan-deterministic'],
  };
  const specGens = [
    {
      id: 'sg-1',
      work_item_id: 'wi-impl',
      status: 'generated',
      generated_spec_text: 'SPEC BODY',
    },
    {
      id: 'sg-capture',
      work_item_id: 'wi-capture',
      status: 'generated',
      generated_spec_text: 'SHOULD NEVER DISPATCH',
    },
  ];

  it('never dispatches a manual-gate story, even when a spec row exists', () => {
    const descriptors = buildOrderedDispatchSet({
      book: { book_of_work_json: { items: [manualStory, normalStory] } },
      specGens,
      deferredWorkItemIds: new Set(),
    });
    expect(descriptors.map((d) => d.workItemId)).toEqual(['wi-impl']);
  });

  it('does not demand spec-readiness for manual-gate stories in the hard block', () => {
    const result = evaluateHardBlock({
      items: [manualStory, normalStory],
      deferredWorkItemIds: new Set(),
      specGens,
      hasActiveCurrentBaseline: true,
    });
    // wi-impl IS spec-ready; wi-capture is exempt -> no reasons at all.
    expect(result.ok).toBe(true);

    const withoutCaptureSpec = evaluateHardBlock({
      items: [manualStory, normalStory],
      deferredWorkItemIds: new Set(),
      specGens: specGens.filter((s) => s.work_item_id !== 'wi-capture'),
      hasActiveCurrentBaseline: true,
    });
    expect(withoutCaptureSpec.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dialect-affected plan wiring (Spec 2026-07-06-f §4 — Tier-1 batch 2026-07-10)
// ---------------------------------------------------------------------------

describe('Dialect-affected plan wiring (Spec 2026-07-06-f §4)', () => {
  const affectedResolver = () =>
    jest.fn().mockResolvedValue({
      affectedEndpointIds: ['e-3'],
      affectedEndpointKeys: ['GET /pets'],
      reasonsByEndpointId: new Map([['e-3', ['tsql_dialect_sql']]]),
    });

  function dialectView(): CodeModelView {
    const view = makeView(ENDPOINTS);
    view.dialectAffectedEndpointIds = new Set(['e-3']);
    return view;
  }

  it('skeleton splits the affected endpoint out; expansion recomputes the SAME set (no drift throw)', async () => {
    // Skeleton built WITH the dialect flag: e-3 (iface-2's only endpoint)
    // leaves the interface clusters and lands in the exceptional epic.
    const book = makeBook(dialectView());
    const exceptionalEpic = book.items.find((i) =>
      i.id === `${STREAM}:${STREAM}-epic-exceptional`
    );
    expect(exceptionalEpic).toBeDefined();

    // INTERFACES epic: the expansion-time view comes back WITHOUT the flag
    // (fresh model read) — the wiring must recompute it via the resolver, or
    // the drift check would false-throw on e-3.
    const ams = makeAms(book);
    const resolveAffectedConsumers = affectedResolver();
    const interfacesOutcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-interfaces` },
      { ...depsWith(ams, makeView(ENDPOINTS)), resolveAffectedConsumers }
    );
    expect(interfacesOutcome.expansionState).toBe('expanded');
    // Only iface-1 clusters (e-3's interface is fully flagged out).
    expect(interfacesOutcome.storiesAppended).toBe(1);
    expect(resolveAffectedConsumers).toHaveBeenCalled();

    // EXCEPTIONAL epic: one individual story carrying the dialect flag.
    const ams2 = makeAms(makeBook(dialectView()));
    const exceptionalOutcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-exceptional` },
      { ...depsWith(ams2, makeView(ENDPOINTS)), resolveAffectedConsumers: affectedResolver() }
    );
    expect(exceptionalOutcome.expansionState).toBe('expanded');
    const finalAppend = ams2.appends[ams2.appends.length - 1].body;
    const dialectStory = finalAppend.items.find((s) =>
      (s.title ?? '').includes('dialect_affected')
    );
    expect(dialectStory).toBeDefined();
    // Extras are flattened onto the item blob (the H-carriage marker shape).
    const blob = dialectStory as unknown as Record<string, unknown>;
    expect(blob.flagReason).toBe('dialect_affected');
    expect(blob.apiEndpointIds).toEqual(['e-3']);
  });

  it('resolver returning empty at expansion surfaces the drift throw (fail-closed, regenerate)', async () => {
    const book = makeBook(dialectView());
    const ams = makeAms(book);
    const emptyResolver = jest.fn().mockResolvedValue({
      affectedEndpointIds: [],
      affectedEndpointKeys: [],
      reasonsByEndpointId: new Map(),
    });
    const outcome = await expandMigrationBookOfWorkEpic(
      { projectId: 'proj-1', bookId: 'book-code', epicId: `${STREAM}:${STREAM}-epic-interfaces` },
      { ...depsWith(ams, makeView(ENDPOINTS)), resolveAffectedConsumers: emptyResolver }
    );
    expect(outcome.expansionState).toBe('failed');
    expect(outcome.error).toMatch(/regenerate the migration plan/);
  });
});
