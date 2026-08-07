/**
 * Tests for the carry_over completeness-gate hard-block extension + the
 * cite / dismiss / batch action wiring (Spec 2026-06-14 D4 — Carry-over
 * Completeness Gate, Task Group 3).
 *
 * The gate extends the already-built Spec-3 Migrate hard-block IN PLACE — it
 * does not fork a parallel gate. These tests drive the REAL `startMigration`
 * pre-flight with a fully-mocked dependency surface (no AMS round-trip, no live
 * LLM — the auto-answerer + every AMS read is a mock) and the action handlers
 * with mocked AMS callers:
 *
 *   (a) Migrate BLOCKS with `carry_over_not_accounted` when a behaviour-bearing
 *       capability is un-actioned;
 *   (b) it UNBLOCKS after cite (a work_item carries the source_capability_id);
 *   (c) it UNBLOCKS after dismiss (reviewStatus=dismissed + a reason);
 *   (d) an un-grouped behaviour-bearing finding gates on its own;
 *   (e) NO-REGRESSION — `story_not_spec_ready` and `missing_current_baseline`
 *       still fire unchanged and STACK with the new reason;
 *   (f) the cite + dismiss + batch handlers call AMS correctly (mandatory
 *       dismissal reason; the batch cites once per un-covered capability).
 *
 * The LLM guard is respected: no module here touches the LLM boundary.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  evaluateHardBlock,
  startMigration,
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
import {
  DiscoveryCapabilityWire,
  DiscoveryFindingWire,
} from '../services/migrationCarryOverCoverageReads';
import { computeCarryOverCoverage } from '../services/migrationCarryOverCoverage';
import {
  citeCapability,
  dismissCarryOverItem,
  generateAllCapabilityStories,
  citeFindingIntoStory,
  amendStoryForFinding,
  createStoryForFinding,
  CarryOverActionDeps,
} from '../services/migrationCarryOverActions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_ID = 'arch-1';
const BASELINE_ID = 'baseline-current-1';

function readySpec(workItemId: string, text: string, id: string): SpecGeneration {
  return {
    id,
    work_item_id: workItemId,
    status: 'generated',
    generated_spec_text: text,
    stale_reason: null,
    generation_attempt_number: 1,
    created_at: '2026-06-14T00:00:00Z',
  };
}

/** A single-story book whose ONE story is spec-ready (the spec-ready gate passes). */
function readyBook(): BookOfWork {
  return {
    id: BOOK_ID,
    project_id: PROJECT_ID,
    current_architecture_id: ARCH_ID,
    status: 'draft',
    book_of_work_json: {
      items: [
        { id: 's1', parentId: null, type: 'story', title: 'Story 1', sequenceOrder: 0, workItemId: 'wi-1' },
      ],
    },
  };
}

function readySpecs(): SpecGeneration[] {
  return [readySpec('wi-1', '/agent-os:shape-spec Story 1 body', 'sg-1')];
}

function passingAutoAnswerer(): ShapeSpecAutoAnswerer {
  return {
    driveAndAnswer: jest.fn().mockResolvedValue({
      ok: true,
      specName: '2026-06-14-some-spec-folder',
      sessionId: 'sess-1',
      decisionLog: [],
    }),
  };
}

/** A behaviour-bearing capability wire row. */
function capWire(over: Partial<DiscoveryCapabilityWire> & { id: string }): DiscoveryCapabilityWire {
  return {
    run_id: 'run-1',
    review_status: 'approved',
    detail_json: { behaviourBearing: true },
    members: [],
    ...over,
  };
}

/** A behaviour-bearing finding wire row. */
function findWire(over: Partial<DiscoveryFindingWire> & { id: string }): DiscoveryFindingWire {
  return {
    review_status: 'approved',
    reviewer_notes: null,
    detail_json: { behaviourBearing: true },
    ...over,
  };
}

/**
 * The mock Driver deps. By default: the spec-ready gate + baseline both pass, and
 * the carry_over reads return ONE un-actioned behaviour-bearing capability (so
 * the carry_over gate blocks unless a test overrides the reads / work items).
 */
function mockDeps(over: Partial<MigrationDriverDeps> = {}): MigrationDriverDeps {
  const created: { run?: MigrationExecutionRun } = {};
  return {
    fetchBookOfWork: jest.fn().mockResolvedValue(readyBook()),
    fetchSpecGenerationsForBook: jest.fn().mockResolvedValue(readySpecs()),
    fetchWorkItems: jest.fn().mockResolvedValue([{ id: 'wi-1', type: 'STORY', deferred: false }]),
    fetchActiveCurrentBaseline: jest.fn().mockResolvedValue({ id: BASELINE_ID, kind: 'current', status: 'active' }),
    createMigrationExecutionRun: jest.fn().mockImplementation(
      async (_p: string, req: { run: MigrationExecutionRun; items: MigrationExecutionRunItem[] }) => {
        const run: MigrationExecutionRun = {
          ...req.run,
          id: 'run-1',
          items: req.items.map((it, idx) => ({ ...it, id: `ri-${idx}`, run_id: 'run-1' })),
        };
        created.run = run;
        return run;
      }
    ),
    getMigrationExecutionRun: jest.fn().mockImplementation(async () => created.run ?? null),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRunItem: jest.fn().mockResolvedValue({}),
    findMigrationRunItemByJobId: jest.fn().mockResolvedValue(null),
    submitOrchestration: jest.fn().mockResolvedValue({ ok: true, jobId: 'job-1', status: 'queued' }),
    recordWorkItemImplementationError: jest.fn().mockResolvedValue(undefined),
    autoAnswerer: passingAutoAnswerer(),
    buildResultsCallbackUrl: 'http://gw/api/implementation/build-results',
    // Carry_over coverage reads: one un-actioned behaviour-bearing capability.
    carryOverCoverageReads: {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([capWire({ id: 'capA' })]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
    },
    // Fail-closed seams (2026-08-07): chain-base + plane-precedence reads
    // must RESOLVE in tests (unreadable = blocked in production).
    fetchLatestMigrationExecutionRunForBook: jest.fn().mockResolvedValue(null),
    fetchMigrationExecutionRunsForBook: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const scope: MigrateScope = { projectId: PROJECT_ID, bookId: BOOK_ID, company: 'acme', project: 'order-mig' };

// ===========================================================================
// evaluateHardBlock — the new reason composes with the existing reasons
// ===========================================================================

describe('evaluateHardBlock — carry_over_not_accounted', () => {
  it('pushes one carry_over_not_accounted reason per un-accounted item (capabilities AND findings, identically)', () => {
    const coverage = computeCarryOverCoverage({
      capabilities: [
        { id: 'capA', behaviourBearing: true, reviewStatus: 'approved', reviewerNotes: null, memberFindingIds: [] },
      ],
      findings: [
        { id: 'fLoose', behaviourBearing: true, reviewStatus: 'approved', reviewerNotes: null },
      ],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    const result = evaluateHardBlock({
      items: readyBook().book_of_work_json!.items!,
      specGens: readySpecs(),
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
      carryOverCoverage: coverage,
    });
    const carryReasons = result.reasons.filter((r) => r.code === 'carry_over_not_accounted');
    expect(carryReasons).toHaveLength(2); // one capability + one finding, same list
    expect(result.ok).toBe(false);
  });

  it('emits NO carry_over reason when the coverage result is ok', () => {
    const coverage = computeCarryOverCoverage({
      capabilities: [
        { id: 'capA', behaviourBearing: true, reviewStatus: 'dismissed', reviewerNotes: 'out of scope', memberFindingIds: [] },
      ],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    const result = evaluateHardBlock({
      items: readyBook().book_of_work_json!.items!,
      specGens: readySpecs(),
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: true,
      carryOverCoverage: coverage,
    });
    expect(result.reasons.some((r) => r.code === 'carry_over_not_accounted')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('NO-REGRESSION: story_not_spec_ready + missing_current_baseline still fire and STACK with carry_over', () => {
    const book = readyBook();
    const coverage = computeCarryOverCoverage({
      capabilities: [
        { id: 'capA', behaviourBearing: true, reviewStatus: 'approved', reviewerNotes: null, memberFindingIds: [] },
      ],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    const result = evaluateHardBlock({
      items: book.book_of_work_json!.items!,
      specGens: [], // wi-1 has no spec -> story_not_spec_ready
      deferredWorkItemIds: new Set(),
      hasActiveCurrentBaseline: false, // -> missing_current_baseline
      carryOverCoverage: coverage,
    });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain('story_not_spec_ready');
    expect(codes).toContain('missing_current_baseline');
    expect(codes).toContain('carry_over_not_accounted');
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// startMigration pre-flight — server-side carry_over gate
// ===========================================================================

describe('startMigration — carry_over gate', () => {
  it('BLOCKS (no run created) when a behaviour-bearing capability is un-actioned', async () => {
    const deps = mockDeps();
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'carry_over_not_accounted')).toBe(true);
    }
    expect(deps.createMigrationExecutionRun).not.toHaveBeenCalled();
  });

  it('UNBLOCKS after CITE: a work_item carrying the source_capability_id covers the capability', async () => {
    const deps = mockDeps({
      // wi-1 still spec-ready; an additional work item cites capA.
      fetchWorkItems: jest.fn().mockResolvedValue([
        { id: 'wi-1', type: 'STORY', deferred: false },
        { id: 'wi-cap', type: 'STORY', deferred: false, source_capability_id: 'capA' },
      ]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('started');
    expect(deps.createMigrationExecutionRun).toHaveBeenCalledTimes(1);
  });

  it('UNBLOCKS after DISMISS: reviewStatus=dismissed + a reason covers the capability', async () => {
    const deps = mockDeps({
      carryOverCoverageReads: {
        fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([
          capWire({ id: 'capA', review_status: 'dismissed', detail_json: { behaviourBearing: true, reviewerNotes: 'dead code retired' } }),
        ]),
        fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('started');
  });

  it('an UN-GROUPED behaviour-bearing finding gates on its own', async () => {
    const deps = mockDeps({
      carryOverCoverageReads: {
        // No capabilities; ONE loose behaviour-bearing finding in run-1.
        fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([capWire({ id: 'capCovered' })]),
        fetchFindingsForRun: jest.fn().mockResolvedValue([findWire({ id: 'fLoose' })]),
      },
      // Cover the capability so ONLY the loose finding gates.
      fetchWorkItems: jest.fn().mockResolvedValue([
        { id: 'wi-1', type: 'STORY', deferred: false },
        { id: 'wi-cap', type: 'STORY', deferred: false, source_capability_id: 'capCovered' },
      ]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      const carry = result.reasons.filter((r) => r.code === 'carry_over_not_accounted');
      expect(carry).toHaveLength(1);
      expect(carry[0].message).toContain('fLoose');
    }
  });

  it('NO-REGRESSION via startMigration: an un-ready story still blocks with story_not_spec_ready', async () => {
    const deps = mockDeps({
      fetchSpecGenerationsForBook: jest.fn().mockResolvedValue([]), // wi-1 not spec-ready
      // Cover the capability so the carry_over dimension is satisfied.
      fetchWorkItems: jest.fn().mockResolvedValue([
        { id: 'wi-1', type: 'STORY', deferred: false },
        { id: 'wi-cap', type: 'STORY', deferred: false, source_capability_id: 'capA' },
      ]),
    });
    const result = await startMigration(scope, deps);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reasons.some((r) => r.code === 'story_not_spec_ready')).toBe(true);
      expect(result.reasons.some((r) => r.code === 'carry_over_not_accounted')).toBe(false);
    }
  });
});

// ===========================================================================
// Cite / dismiss / batch handlers
// ===========================================================================

describe('carry_over actions', () => {
  function actionDeps(over: Partial<CarryOverActionDeps> = {}): CarryOverActionDeps {
    return {
      appendCapabilityStory: jest.fn().mockResolvedValue({
        work_item_id: 'wi-new',
        book_item_id: 'bi-new',
        source_capability_id: 'capA',
        message: 'ok',
      }),
      patchCapabilityReview: jest.fn().mockResolvedValue({}),
      patchFindingReview: jest.fn().mockResolvedValue({}),
      citeFindingOnStory: jest.fn().mockResolvedValue({
        book_item_id: 'bi-1',
        finding_id: 'fX',
        already_cited: false,
        message: 'ok',
      }),
      amendStoryItem: jest.fn().mockResolvedValue({
        book_item_id: 'bi-1',
        work_item_id: 'wi-1',
        finding_id: 'fX',
        specs_marked_stale: 1,
        message: 'ok',
      }),
      addManualStoryItem: jest.fn().mockResolvedValue({
        work_item_id: 'wi-new',
        book_item_id: 'manual-new',
        provenance: 'carry_over',
        kind: 'operational',
        message: 'ok',
      }),
      ...over,
    };
  }

  it('citeCapability calls append-capability-story with the capability id + title', async () => {
    const deps = actionDeps();
    const result = await citeCapability(
      { projectId: PROJECT_ID, bookId: BOOK_ID, capabilityId: 'capA', title: 'Daily Risk Load' },
      deps
    );
    expect(result.ok).toBe(true);
    expect(deps.appendCapabilityStory).toHaveBeenCalledWith(
      PROJECT_ID,
      BOOK_ID,
      expect.objectContaining({ source_capability_id: 'capA', title: 'Daily Risk Load' })
    );
  });

  it('dismissCarryOverItem REJECTS an empty reason (the gate is not satisfied without a reason)', async () => {
    const deps = actionDeps();
    const result = await dismissCarryOverItem(
      { projectId: PROJECT_ID, architectureId: ARCH_ID, kind: 'capability', id: 'capA', reason: '   ' },
      deps
    );
    expect(result.ok).toBe(false);
    expect(deps.patchCapabilityReview).not.toHaveBeenCalled();
  });

  it('dismissCarryOverItem PATCHes a capability review_status=dismissed + the reason', async () => {
    const deps = actionDeps();
    const result = await dismissCarryOverItem(
      { projectId: PROJECT_ID, architectureId: ARCH_ID, kind: 'capability', id: 'capA', reason: 'dead code retired' },
      deps
    );
    expect(result.ok).toBe(true);
    expect(deps.patchCapabilityReview).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      'capA',
      expect.objectContaining({ review_status: 'dismissed', reviewer_notes: 'dead code retired' })
    );
  });

  it('dismissCarryOverItem PATCHes a finding review_status=dismissed + reason (run-scoped)', async () => {
    const deps = actionDeps();
    const result = await dismissCarryOverItem(
      { projectId: PROJECT_ID, architectureId: ARCH_ID, kind: 'finding', id: 'fX', runId: 'run-1', reason: 'out of scope' },
      deps
    );
    expect(result.ok).toBe(true);
    expect(deps.patchFindingReview).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      'run-1',
      'fX',
      expect.objectContaining({ review_status: 'dismissed', reviewer_notes: 'out of scope' })
    );
  });

  it('generateAllCapabilityStories cites ONCE per un-covered approved behaviour-bearing capability (skips covered + non-bb + non-approved)', async () => {
    const deps = actionDeps();
    const result = await generateAllCapabilityStories(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        capabilities: [
          // un-covered approved behaviour-bearing -> cited
          { id: 'capA', title: 'A', reviewStatus: 'approved', behaviourBearing: true, alreadyCited: false },
          // already cited -> skipped
          { id: 'capB', title: 'B', reviewStatus: 'approved', behaviourBearing: true, alreadyCited: true },
          // not behaviour-bearing -> skipped
          { id: 'capC', title: 'C', reviewStatus: 'approved', behaviourBearing: false, alreadyCited: false },
          // not approved -> skipped
          { id: 'capD', title: 'D', reviewStatus: 'pending_review', behaviourBearing: true, alreadyCited: false },
        ],
      },
      deps
    );
    expect(result.citedCount).toBe(1);
    expect(deps.appendCapabilityStory).toHaveBeenCalledTimes(1);
    expect(deps.appendCapabilityStory).toHaveBeenCalledWith(
      PROJECT_ID,
      BOOK_ID,
      expect.objectContaining({ source_capability_id: 'capA' })
    );
  });
});

// ===========================================================================
// Triage-plumbing actions (2026-07-26): cite-finding / amend / new-story
// ===========================================================================

describe('carry_over triage-plumbing actions', () => {
  function actionDeps(over: Partial<CarryOverActionDeps> = {}): CarryOverActionDeps {
    return {
      appendCapabilityStory: jest.fn().mockResolvedValue({}),
      patchCapabilityReview: jest.fn().mockResolvedValue({}),
      patchFindingReview: jest.fn().mockResolvedValue({}),
      citeFindingOnStory: jest.fn().mockResolvedValue({
        book_item_id: 'bi-1',
        finding_id: 'fX',
        already_cited: false,
        message: 'ok',
      }),
      amendStoryItem: jest.fn().mockResolvedValue({
        book_item_id: 'bi-1',
        work_item_id: 'wi-1',
        finding_id: 'fX',
        specs_marked_stale: 1,
        message: 'ok',
      }),
      addManualStoryItem: jest.fn().mockResolvedValue({
        work_item_id: 'wi-new',
        book_item_id: 'manual-new',
        provenance: 'carry_over',
        kind: 'operational',
        message: 'ok',
      }),
      ...over,
    };
  }

  it('citeFindingIntoStory posts the item patch and surfaces the idempotent already-cited flag', async () => {
    const deps = actionDeps({
      citeFindingOnStory: jest
        .fn()
        .mockResolvedValue({ book_item_id: 'bi-1', finding_id: 'fX', already_cited: true }),
    });
    const result = await citeFindingIntoStory(
      { projectId: PROJECT_ID, bookId: BOOK_ID, bookItemId: 'bi-1', findingId: 'fX' },
      deps
    );
    expect(result).toEqual({ ok: true, alreadyCited: true });
    expect(deps.citeFindingOnStory).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 'bi-1', 'fX');
  });

  it('amendStoryForFinding sends description + APPEND criteria + the finding cite in ONE patch (and reports specs marked stale)', async () => {
    const deps = actionDeps();
    const result = await amendStoryForFinding(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        bookItemId: 'bi-1',
        findingId: 'fX',
        description: 'Amended description folding the finding in.',
        appendAcceptanceCriteria: ['New criterion covering the finding.', '  '],
      },
      deps
    );
    expect(result).toEqual({ ok: true, workItemId: 'wi-1', specsMarkedStale: 1 });
    expect(deps.amendStoryItem).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 'bi-1', {
      description: 'Amended description folding the finding in.',
      append_acceptance_criteria: ['New criterion covering the finding.'],
      cite_finding_id: 'fX',
      stale_reason: null,
    });
  });

  it('amendStoryForFinding REJECTS an amendment that changes nothing (that would be a cite, not an amend)', async () => {
    const deps = actionDeps();
    const result = await amendStoryForFinding(
      { projectId: PROJECT_ID, bookId: BOOK_ID, bookItemId: 'bi-1', findingId: 'fX' },
      deps
    );
    expect(result.ok).toBe(false);
    expect(deps.amendStoryItem).not.toHaveBeenCalled();
  });

  it('createStoryForFinding mints a carry_over add-item WITH the finding cited on discoveryFindingReferences', async () => {
    const deps = actionDeps();
    const result = await createStoryForFinding(
      {
        projectId: PROJECT_ID,
        bookId: BOOK_ID,
        findingId: 'fX',
        title: 'Recreate the archive purge job',
        description: 'The current system purges archived rows weekly; the target must too.',
        workstream: 'internal_processing_implementation',
        acceptanceCriteria: ['Purge runs weekly.'],
      },
      deps
    );
    expect(result.ok).toBe(true);
    expect(deps.addManualStoryItem).toHaveBeenCalledWith(
      PROJECT_ID,
      BOOK_ID,
      expect.objectContaining({
        provenance: 'carry_over',
        title: 'Recreate the archive purge job',
        workstream: 'internal_processing_implementation',
        discovery_finding_references: ['fX'],
      })
    );
  });

  it('createStoryForFinding REJECTS a blank description (the sole spec-gen grounding for a manual story)', async () => {
    const deps = actionDeps();
    const result = await createStoryForFinding(
      { projectId: PROJECT_ID, bookId: BOOK_ID, findingId: 'fX', title: 'T', description: '   ' },
      deps
    );
    expect(result.ok).toBe(false);
    expect(deps.addManualStoryItem).not.toHaveBeenCalled();
  });
});
