/**
 * Wiring tests — Create Migration Plan × DB-migration-pack ensure step
 * (Spec 2026-07-02-a, Persistence-Tier Oracle Program).
 *
 * Contract under test:
 *   - a DB delivery stream selected  -> ensurePack invoked ONCE with the
 *     plan's (project, current, target) BEFORE generation; outcome recorded
 *     at generationInputs.dbMigrationPack on the posted draft
 *   - 'skipped' / 'failed' outcomes  -> surfaced in result.warnings
 *   - no DB stream selected          -> ensurePack NEVER invoked, no
 *     dbMigrationPack key on generationInputs
 */

import {
  generateMigrationBookOfWork,
  MigrationBookOfWorkHandlerDeps,
} from '../services/migrationBookOfWorkHandler';
import type { EnsurePackOutcome } from '../services/dbMigrationPackEnsure';
import type { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';

const CONTEXT: MigrationDiscoveryContext = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
  generatedAt: '2026-07-02T00:00:00Z',
  summary: 'ctx',
};

function skeletonBookJson(stream: string): string {
  const base = {
    workstream: stream,
    acceptanceCriteria: [],
    tags: [],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: 'Expand.',
    traceabilitySummary: 'Traces to the migration discovery context summary.',
  };
  return JSON.stringify({
    title: 'Plan',
    summary: 'Plan summary',
    generationInputs: { options: {} },
    generationSummary: { totalItems: 3 },
    qualityAssessment: { overall: { score: 'high', rationale: 'ok' } },
    items: [
      {
        ...base,
        id: 'I1',
        type: 'initiative',
        parentId: null,
        title: 'Persistence tier migration',
        description: 'Initiative.',
        sequenceOrder: 1,
      },
      {
        ...base,
        id: 'E1',
        type: 'epic',
        parentId: 'I1',
        title: 'Data migration',
        description: 'Epic.',
        sequenceOrder: 2,
      },
      {
        ...base,
        id: 'F1',
        type: 'feature',
        parentId: 'E1',
        title: 'Bulk load',
        description: 'Feature.',
        sequenceOrder: 3,
      },
    ],
  });
}

function makeDeps(
  ensureOutcome: EnsurePackOutcome
): {
  deps: MigrationBookOfWorkHandlerDeps;
  ensureCalls: Array<Record<string, unknown>>;
  createDraftCalls: Array<Record<string, unknown>>;
} {
  const ensureCalls: Array<Record<string, unknown>> = [];
  const createDraftCalls: Array<Record<string, unknown>> = [];
  const deps: MigrationBookOfWorkHandlerDeps = {
    fetchContext: jest.fn().mockResolvedValue(CONTEXT),
    callLlm: jest
      .fn()
      .mockResolvedValue({ content: skeletonBookJson('data_migration') }),
    createDraft: jest.fn().mockImplementation(async (_projectId, body) => {
      createDraftCalls.push(body as Record<string, unknown>);
      return { draftId: 'd-1', summary: 's' };
    }),
    ensurePack: jest.fn().mockImplementation(async (args) => {
      ensureCalls.push(args as Record<string, unknown>);
      return ensureOutcome;
    }),
    systemPromptOverride: 'SYS',
  };
  return { deps, ensureCalls, createDraftCalls };
}

const INPUT = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
};

describe('Create Migration Plan × DB pack ensure wiring (Spec 2026-07-02-a)', () => {
  it('invokes ensurePack once with the plan tuple when a DB stream is selected and records the outcome on generationInputs', async () => {
    const { deps, ensureCalls, createDraftCalls } = makeDeps({
      status: 'generated',
      packId: 'pack-1',
      inputSnapshotHash: 'hash-1',
      reason: null,
    });

    const result = await generateMigrationBookOfWork(
      { ...INPUT, wizardAnswers: { deliveryStreams: ['data_migration'] } },
      deps
    );

    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0]).toEqual({
      projectId: 'proj-1',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
    });
    const posted = createDraftCalls[0] as {
      generation_inputs_json: Record<string, unknown>;
    };
    expect(posted.generation_inputs_json.dbMigrationPack).toEqual({
      status: 'generated',
      packId: 'pack-1',
      inputSnapshotHash: 'hash-1',
      reason: null,
    });
    // Healthy outcomes add NO warnings.
    expect(result.warnings ?? []).toHaveLength(0);
  });

  it("surfaces a 'skipped' outcome (engine gate) as a plan warning", async () => {
    const { deps } = makeDeps({
      status: 'skipped',
      packId: null,
      inputSnapshotHash: null,
      reason: "No 'db.engine' captured decision found",
    });
    const result = await generateMigrationBookOfWork(
      {
        ...INPUT,
        wizardAnswers: {
          deliveryStreams: ['target_database_schema_implementation'],
        },
      },
      deps
    );
    expect(result.warnings?.join(' ')).toMatch(/DB migration pack not generated/);
    expect(result.warnings?.join(' ')).toMatch(/db\.engine/);
  });

  it("surfaces a 'failed' outcome as a plan warning and generation still succeeds", async () => {
    const { deps } = makeDeps({
      status: 'failed',
      packId: null,
      inputSnapshotHash: null,
      reason: 'AMS unavailable',
    });
    const result = await generateMigrationBookOfWork(
      { ...INPUT, wizardAnswers: { deliveryStreams: ['data_migration'] } },
      deps
    );
    expect(result.draftId).toBe('d-1');
    expect(result.warnings?.join(' ')).toMatch(/DB migration pack generation failed/);
  });

  it('never invokes ensurePack when no DB stream is selected and omits the generationInputs key', async () => {
    const { deps, ensureCalls, createDraftCalls } = makeDeps({
      status: 'fresh',
      packId: 'pack-1',
      inputSnapshotHash: 'hash-1',
      reason: null,
    });
    // Non-DB stream — the LLM fixture's workstream value is irrelevant to
    // the wiring under test (schema validation accepts any known stream).
    (deps.callLlm as jest.Mock).mockResolvedValue({
      content: skeletonBookJson('target_service_api_implementation'),
    });

    await generateMigrationBookOfWork(
      {
        ...INPUT,
        wizardAnswers: { deliveryStreams: ['target_service_api_implementation'] },
      },
      deps
    );

    expect(ensureCalls).toHaveLength(0);
    const posted = createDraftCalls[0] as {
      generation_inputs_json: Record<string, unknown>;
    };
    expect(posted.generation_inputs_json).not.toHaveProperty('dbMigrationPack');
  });
});
