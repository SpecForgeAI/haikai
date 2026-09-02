/**
 * db.* decision-read target binding (2026-09-02).
 *
 * Field bug: `defaultFetchDbDecisions` fell back to the ACTIVE target only.
 * Closing the target-state conversation stamps `conversation_saved_at` but
 * does NOT make the target "active", so on a normally-completed conversation
 * the active id was null, the reader returned ZERO db.* decisions, and the
 * engine gate reported the misleading "No 'db.engine' captured decision
 * found" — the decisions were captured, the reader just looked in the wrong
 * place. Same bug class Spec 2026-06-26 FR4 fixed everywhere else (cf.
 * sclModernizationReview.resolveTargetArchitectureId: active THEN
 * most-recent-saved).
 *
 * Pins:
 *   - explicit binding: a supplied target id is used verbatim, no resolver
 *     round-trips;
 *   - active precedence: the active target wins when present (saved never
 *     consulted);
 *   - saved fallback (the fix): active null -> most-recent-saved binds the
 *     read;
 *   - both-null: empty decisions + null resolved id, no decision fetch;
 *   - the read carries its provenance (`resolvedTargetArchitectureId`) and
 *     `fetchGenerationInputs` threads it through (reader-resolved preferred,
 *     requested id as fallback for inert doubles);
 *   - the provenance field is EXCLUDED from the input snapshot hash (no
 *     false staleness on existing packs);
 *   - the full engine gate passes against the real `{framework, version}`
 *     JSON-envelope answer read via the saved fallback, and still rejects
 *     loudly when the project truly has no db.engine decision.
 */

jest.mock('../services/targetStateCapturedDecisionsClient', () => ({
  fetchActiveTargetArchitectureId: jest.fn(),
  fetchMostRecentSavedTargetArchitectureId: jest.fn(),
  fetchLatestCapturedDecisions: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  fetchActiveTargetArchitectureId,
  fetchMostRecentSavedTargetArchitectureId,
  fetchLatestCapturedDecisions,
  type TargetStateCapturedDecision,
} from '../services/targetStateCapturedDecisionsClient';
import {
  assertSupportedEnginePair,
  computeInputSnapshotHash,
  defaultFetchDbDecisions,
  fetchGenerationInputs,
  GenerationInputs,
  InputFetchDeps,
} from '../services/dbMigrationPack/inputs';
import {
  generateDbMigrationPack,
  UpsertPackBody,
} from '../services/dbMigrationPackHandler';
import { UnsupportedEnginePairError } from '../services/dbMigrationPack/types';

const PROJECT_ID = 'project-binding-1';
const ACTIVE_TARGET_ID = 'target-active-1';
const SAVED_TARGET_ID = 'target-saved-1';

/** The real AMS answer envelope for db.engine (a JSON string on the wire). */
const ENGINE_ENVELOPE = JSON.stringify({ framework: 'postgresql', version: '18' });

const mockActive = fetchActiveTargetArchitectureId as jest.MockedFunction<
  typeof fetchActiveTargetArchitectureId
>;
const mockSaved = fetchMostRecentSavedTargetArchitectureId as jest.MockedFunction<
  typeof fetchMostRecentSavedTargetArchitectureId
>;
const mockDecisions = fetchLatestCapturedDecisions as jest.MockedFunction<
  typeof fetchLatestCapturedDecisions
>;

function capturedDecision(
  targetArchitectureId: string,
  decisionCode: string,
  answerValue: string
): TargetStateCapturedDecision {
  return {
    decisionId: `dec-${decisionCode}`,
    projectId: PROJECT_ID,
    targetArchitectureId,
    decisionCode,
    scopeKind: 'architecture',
    answerValue,
    createdAt: '2026-09-02T00:00:00Z',
    createdByTask: 'target_state_conversation',
  } as TargetStateCapturedDecision;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActive.mockResolvedValue({ activeTargetArchitectureId: null });
  mockSaved.mockResolvedValue({ savedTargetArchitectureId: null } as never);
  mockDecisions.mockResolvedValue([]);
});

describe('defaultFetchDbDecisions target binding', () => {
  it('binds to the EXPLICIT target verbatim — no resolver round-trips', async () => {
    mockDecisions.mockResolvedValue([
      capturedDecision('target-explicit-1', 'db.engine', ENGINE_ENVELOPE),
    ]);

    const read = await defaultFetchDbDecisions(PROJECT_ID, 'target-explicit-1');

    expect(mockActive).not.toHaveBeenCalled();
    expect(mockSaved).not.toHaveBeenCalled();
    expect(mockDecisions).toHaveBeenCalledWith(PROJECT_ID, 'target-explicit-1');
    expect(read.resolvedTargetArchitectureId).toBe('target-explicit-1');
    expect(read.decisions).toEqual([{ decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE }]);
  });

  it('the ACTIVE target takes precedence when present (saved never consulted)', async () => {
    mockActive.mockResolvedValue({ activeTargetArchitectureId: ACTIVE_TARGET_ID });
    mockDecisions.mockResolvedValue([
      capturedDecision(ACTIVE_TARGET_ID, 'db.engine', ENGINE_ENVELOPE),
    ]);

    const read = await defaultFetchDbDecisions(PROJECT_ID);

    expect(mockSaved).not.toHaveBeenCalled();
    expect(mockDecisions).toHaveBeenCalledWith(PROJECT_ID, ACTIVE_TARGET_ID);
    expect(read.resolvedTargetArchitectureId).toBe(ACTIVE_TARGET_ID);
  });

  it('FALLS BACK to the most-recent-saved target when no target is active (the fix)', async () => {
    // The field shape: closing the conversation stamped saved, never active.
    mockActive.mockResolvedValue({ activeTargetArchitectureId: null });
    mockSaved.mockResolvedValue({ savedTargetArchitectureId: SAVED_TARGET_ID } as never);
    mockDecisions.mockResolvedValue([
      capturedDecision(SAVED_TARGET_ID, 'db.engine', ENGINE_ENVELOPE),
      capturedDecision(SAVED_TARGET_ID, 'db.schema_conversion', 'per_table'),
      capturedDecision(SAVED_TARGET_ID, 'api.style', 'rest'), // non-db.* — filtered out
    ]);

    const read = await defaultFetchDbDecisions(PROJECT_ID);

    expect(mockActive).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockSaved).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockDecisions).toHaveBeenCalledWith(PROJECT_ID, SAVED_TARGET_ID);
    expect(read.resolvedTargetArchitectureId).toBe(SAVED_TARGET_ID);
    expect(read.decisions.map((d) => d.decisionCode)).toEqual([
      'db.engine',
      'db.schema_conversion',
    ]);
  });

  it('returns empty + null provenance when NEITHER an active nor a saved target exists', async () => {
    const read = await defaultFetchDbDecisions(PROJECT_ID);

    expect(read).toEqual({ decisions: [], resolvedTargetArchitectureId: null });
    expect(mockDecisions).not.toHaveBeenCalled();
  });
});

describe('fetchGenerationInputs provenance threading', () => {
  const emptyModel: GenerationInputs['model'] = {
    physicalDataEntities: [],
    physicalDataAttributes: [],
    dataEntityPoints: [],
    dataEntityRelationships: [],
  };

  function depsWith(read: {
    decisions: GenerationInputs['dbDecisions'];
    resolvedTargetArchitectureId: string | null;
  }): InputFetchDeps {
    return {
      fetchModel: async () => emptyModel,
      fetchFindings: async () => [],
      fetchDbDecisions: async () => read,
      fetchResolvedPackDecisions: async () => [],
    };
  }

  it('records the target the reader ACTUALLY bound to, not the requested one', async () => {
    const inputs = await fetchGenerationInputs(
      PROJECT_ID,
      'arch-current-1',
      depsWith({
        decisions: [{ decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE }],
        resolvedTargetArchitectureId: SAVED_TARGET_ID,
      })
      // no requested target — the frontend Generate button omits it
    );

    expect(inputs.dbDecisions).toEqual([
      { decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE },
    ]);
    expect(inputs.resolvedTargetArchitectureId).toBe(SAVED_TARGET_ID);
  });

  it('falls back to the REQUESTED id when an injected double reports no binding', async () => {
    const inputs = await fetchGenerationInputs(
      PROJECT_ID,
      'arch-current-1',
      depsWith({ decisions: [], resolvedTargetArchitectureId: null }),
      'target-requested-1'
    );

    expect(inputs.resolvedTargetArchitectureId).toBe('target-requested-1');
  });

  it('the provenance field is EXCLUDED from the input snapshot hash (no false staleness)', async () => {
    const base: GenerationInputs = {
      model: emptyModel,
      findings: [],
      dbDecisions: [{ decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE }],
      resolvedPackDecisions: [],
    };
    const withProvenance: GenerationInputs = {
      ...base,
      resolvedTargetArchitectureId: SAVED_TARGET_ID,
    };

    expect(computeInputSnapshotHash(withProvenance)).toBe(computeInputSnapshotHash(base));
  });
});

describe('engine gate over the saved-fallback read (end-to-end)', () => {
  const emptyModel: GenerationInputs['model'] = {
    physicalDataEntities: [],
    physicalDataAttributes: [],
    dataEntityPoints: [],
    dataEntityRelationships: [],
  };

  async function inputsViaDefaultReader(): Promise<GenerationInputs> {
    return fetchGenerationInputs(PROJECT_ID, 'arch-current-1', {
      fetchModel: async () => emptyModel,
      fetchFindings: async () => [],
      fetchDbDecisions: defaultFetchDbDecisions,
      fetchResolvedPackDecisions: async () => [],
    });
  }

  it('PASSES against the real {framework, version} envelope read from the saved target', async () => {
    mockSaved.mockResolvedValue({ savedTargetArchitectureId: SAVED_TARGET_ID } as never);
    mockDecisions.mockResolvedValue([
      capturedDecision(SAVED_TARGET_ID, 'db.engine', ENGINE_ENVELOPE),
    ]);

    const inputs = await inputsViaDefaultReader();

    expect(assertSupportedEnginePair(inputs)).toEqual({
      sourceEngine: 'sybase_ase',
      targetEngine: 'postgresql',
    });
    expect(inputs.resolvedTargetArchitectureId).toBe(SAVED_TARGET_ID);
  });

  it('still rejects LOUDLY when the project truly has no db.engine decision anywhere', async () => {
    // Both resolvers empty — nothing captured on any target.
    const inputs = await inputsViaDefaultReader();

    expect(() => assertSupportedEnginePair(inputs)).toThrow(UnsupportedEnginePairError);
    expect(() => assertSupportedEnginePair(inputs)).toThrow(/No 'db\.engine' captured decision/);
  });

  it('rejects a non-postgres target envelope (the gate still gates)', async () => {
    mockSaved.mockResolvedValue({ savedTargetArchitectureId: SAVED_TARGET_ID } as never);
    mockDecisions.mockResolvedValue([
      capturedDecision(
        SAVED_TARGET_ID,
        'db.engine',
        JSON.stringify({ framework: 'oracle', version: '21c' })
      ),
    ]);

    const inputs = await inputsViaDefaultReader();

    expect(() => assertSupportedEnginePair(inputs)).toThrow(UnsupportedEnginePairError);
  });
});

describe('manifest binding receipt (generateDbMigrationPack, 2026-09-02)', () => {
  // The persisted manifest used to echo the REQUEST target id — null whenever
  // the caller omitted it (the frontend Generate button did) — and
  // `ensureFreshDbMigrationPack` then treated the unbound pack as a different
  // binding on the next plan run and regenerated it needlessly. The receipt
  // now records the target the db.* decisions were ACTUALLY read from.

  /** Minimal viable model: one PK'd table (mirrors the routes-suite fixture). */
  const VIABLE_MODEL: GenerationInputs['model'] = {
    physicalDataEntities: [
      {
        id: 'pe-1',
        name: 'dbo.orders',
        physical_type: 'table',
        constraints_metadata: {
          primary_key: { name: 'pk_orders', columns: ['order_id'] },
        },
      },
    ],
    physicalDataAttributes: [
      {
        id: 'pa-1',
        name: 'order_id',
        physical_entity_id: 'pe-1',
        source_type: 'int',
        is_primary_key: true,
        is_nullable: false,
        ordinal: 1,
        is_identity: true,
      },
    ],
    dataEntityPoints: [],
    dataEntityRelationships: [],
  };

  function handlerDeps(read: {
    decisions: GenerationInputs['dbDecisions'];
    resolvedTargetArchitectureId: string | null;
  }): { deps: Record<string, unknown>; persisted: UpsertPackBody[] } {
    const persisted: UpsertPackBody[] = [];
    return {
      persisted,
      deps: {
        translationHook: async () => null,
        fetchModel: async () => VIABLE_MODEL,
        fetchFindings: async () => [],
        fetchDbDecisions: async () => read,
        fetchResolvedPackDecisions: async () => [],
        persistPack: async (_projectId: string, body: UpsertPackBody) => {
          persisted.push(body);
          return {
            id: 'pack-1',
            project_id: PROJECT_ID,
            architecture_id: 'arch-current-1',
            status: 'generated',
            input_snapshot_hash: body.input_snapshot_hash,
            translated_count: body.translated_count,
            skipped_count: body.skipped_count,
            flagged_count: body.flagged_count,
            seed_margin: body.seed_margin,
          };
        },
      },
    };
  }

  it('records the target the reader ACTUALLY bound to when the request omits one', async () => {
    const { deps, persisted } = handlerDeps({
      decisions: [{ decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE }],
      resolvedTargetArchitectureId: SAVED_TARGET_ID,
    });

    await generateDbMigrationPack(
      { projectId: PROJECT_ID, architectureId: 'arch-current-1' }, // no target
      deps
    );

    expect(persisted).toHaveLength(1);
    expect(
      (persisted[0].manifest_json as Record<string, unknown>).target_architecture_id
    ).toBe(SAVED_TARGET_ID);
  });

  it('keeps the explicit request binding when an injected reader reports none', async () => {
    const { deps, persisted } = handlerDeps({
      decisions: [{ decisionCode: 'db.engine', answerValue: ENGINE_ENVELOPE }],
      resolvedTargetArchitectureId: null,
    });

    await generateDbMigrationPack(
      {
        projectId: PROJECT_ID,
        architectureId: 'arch-current-1',
        targetArchitectureId: 'target-explicit-1',
      },
      deps
    );

    expect(
      (persisted[0].manifest_json as Record<string, unknown>).target_architecture_id
    ).toBe('target-explicit-1');
  });
});
