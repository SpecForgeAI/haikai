/**
 * Wiring tests — Create Migration Plan × DB-migration-pack ensure step +
 * deterministic DB skeletons (Specs 2026-07-02-a and -b, Persistence-Tier
 * Oracle Program).
 *
 * Contract under test:
 *   - a DB delivery stream selected  -> ensurePack invoked ONCE with the
 *     plan's (project, current, target) BEFORE generation; outcome recorded
 *     at generationInputs.dbMigrationPack on the posted draft
 *   - the DB stream's skeleton is DETERMINISTIC (no LLM call for it): pack
 *     available -> pack-derived initiative/epics; pack unavailable ->
 *     prerequisite skeleton (never freeform)
 *   - 'skipped' / 'failed' outcomes  -> surfaced in result.warnings
 *   - no DB stream selected          -> ensurePack + fetchPackView NEVER
 *     invoked; no dbMigrationPack key on generationInputs
 */

import {
  generateMigrationBookOfWork,
  MigrationBookOfWorkHandlerDeps,
} from '../services/migrationBookOfWorkHandler';
import type { EnsurePackOutcome } from '../services/dbMigrationPackEnsure';
import type { PackView } from '../services/migrationDbPackPlanner';
import type { PackManifest } from '../services/dbMigrationPack/types';
import type { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import type { MigrationBookOfWorkItem } from '../services/generatedMigrationBookOfWorkSchema';

const CONTEXT: MigrationDiscoveryContext = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
  generatedAt: '2026-07-02T00:00:00Z',
  summary: 'ctx',
};

function minimalPackView(): PackView {
  return {
    packId: 'pack-1',
    status: 'generated',
    inputSnapshotHash: 'hash-1',
    manifest: {
      manifest_version: 1,
      source_engine: 'sybase_ase',
      target_engine: 'postgresql',
      type_mapping_version: 'v1',
      seed_margin: 1000,
      seed_margin_note: '',
      phase_ordering: [],
      delete_propagation: 'none',
      coverage: {
        translated_count: 1,
        skipped_count: 0,
        flagged_count: 0,
        objects: [
          {
            objectType: 'table',
            objectRef: 'dbo.t1',
            disposition: 'translated',
            provenance: { entityId: 'e1', findingIds: [] },
          },
        ],
      },
      requires_translation_spec_2: [],
      manual_recreation: [],
      cycle_breaks: [],
      cluster_notes: [],
      collation_notes: [],
      delta_strategies: [
        { table: 'dbo.t1', strategy: 'insert_only', deltaKey: 'id', source: 'identity_column' },
      ],
      bulk_load: { table_order: ['dbo.t1'], expected_row_counts: {}, cast_notes: {} },
      expected_schema: {
        tables: [{ schemaName: 'dbo', tableName: 't1' }],
        columns: [],
        keysAndIndexes: [],
        sequences: [],
      },
    } as PackManifest,
    decisions: [],
    translations: [],
  };
}

function llmSkeletonJson(stream: string): string {
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
      { ...base, id: 'I1', type: 'initiative', parentId: null, title: 'API migration', description: 'Initiative.', sequenceOrder: 1 },
      { ...base, id: 'E1', type: 'epic', parentId: 'I1', title: 'Endpoints', description: 'Epic.', sequenceOrder: 2 },
      { ...base, id: 'F1', type: 'feature', parentId: 'E1', title: 'Batch 1', description: 'Feature.', sequenceOrder: 3 },
    ],
  });
}

function makeDeps(
  ensureOutcome: EnsurePackOutcome,
  packView: PackView | null
): {
  deps: MigrationBookOfWorkHandlerDeps;
  ensureCalls: Array<Record<string, unknown>>;
  createDraftCalls: Array<Record<string, unknown>>;
  callLlm: jest.Mock;
  fetchPackView: jest.Mock;
} {
  const ensureCalls: Array<Record<string, unknown>> = [];
  const createDraftCalls: Array<Record<string, unknown>> = [];
  const callLlm = jest
    .fn()
    .mockResolvedValue({ content: llmSkeletonJson('target_frontend_implementation') });
  const fetchPackView = jest.fn().mockResolvedValue(packView);
  const deps: MigrationBookOfWorkHandlerDeps = {
    fetchContext: jest.fn().mockResolvedValue(CONTEXT),
    callLlm,
    createDraft: jest.fn().mockImplementation(async (_projectId, body) => {
      createDraftCalls.push(body as Record<string, unknown>);
      return { draftId: 'd-1', summary: 's' };
    }),
    ensurePack: jest.fn().mockImplementation(async (args) => {
      ensureCalls.push(args as Record<string, unknown>);
      return ensureOutcome;
    }),
    fetchPackView,
    systemPromptOverride: 'SYS',
  };
  return { deps, ensureCalls, createDraftCalls, callLlm, fetchPackView };
}

function postedItems(body: Record<string, unknown>): MigrationBookOfWorkItem[] {
  return (body.book_of_work_json as { items: MigrationBookOfWorkItem[] }).items;
}

const INPUT = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
};

describe('Create Migration Plan × DB pack wiring (Specs 2026-07-02-a/-b)', () => {
  it('DB stream: ensurePack once with the plan tuple; skeleton is pack-derived and DETERMINISTIC (no LLM call); outcome on generationInputs', async () => {
    const { deps, ensureCalls, createDraftCalls, callLlm } = makeDeps(
      { status: 'generated', packId: 'pack-1', inputSnapshotHash: 'hash-1', reason: null },
      minimalPackView()
    );

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
    // The ONLY selected stream is a DB stream — deterministic, so no LLM.
    expect(callLlm).not.toHaveBeenCalled();

    const posted = createDraftCalls[0] as {
      generation_inputs_json: Record<string, unknown>;
    };
    expect(posted.generation_inputs_json.dbMigrationPack).toEqual({
      status: 'generated',
      packId: 'pack-1',
      inputSnapshotHash: 'hash-1',
      reason: null,
    });

    const items = postedItems(createDraftCalls[0]);
    expect(items.find((i) => i.id === 'data_migration:data_migration-init')).toBeDefined();
    expect(items.find((i) => i.id === 'data_migration:data_migration-epic-load')).toBeDefined();
    expect(
      items
        .filter((i) => i.type === 'epic')
        .every((i) => i.expansionState === 'not_expanded')
    ).toBe(true);
    expect(items.every((i) => (i.tags ?? []).includes('provenance:pack'))).toBe(true);

    // Healthy outcomes add NO warnings.
    expect(result.warnings ?? []).toHaveLength(0);
  });

  it("'skipped' (engine gate): warning surfaced AND the DB skeleton is the PREREQUISITE structure, never freeform", async () => {
    const { deps, createDraftCalls, callLlm } = makeDeps(
      {
        status: 'skipped',
        packId: null,
        inputSnapshotHash: null,
        reason: "No 'db.engine' captured decision found",
      },
      null
    );
    const result = await generateMigrationBookOfWork(
      {
        ...INPUT,
        wizardAnswers: { deliveryStreams: ['target_database_schema_implementation'] },
      },
      deps
    );
    expect(result.warnings?.join(' ')).toMatch(/DB migration pack not generated/);
    expect(result.warnings?.join(' ')).toMatch(/db\.engine/);
    expect(callLlm).not.toHaveBeenCalled();

    const items = postedItems(createDraftCalls[0]);
    const epic = items.find((i) => i.type === 'epic')!;
    expect(epic.readiness).toBe('blocked');
    expect(epic.tags).toContain('provenance:prerequisite');
  });

  it("'failed': warning surfaced and generation still succeeds with the prerequisite skeleton", async () => {
    const { deps } = makeDeps(
      { status: 'failed', packId: null, inputSnapshotHash: null, reason: 'AMS unavailable' },
      null
    );
    const result = await generateMigrationBookOfWork(
      { ...INPUT, wizardAnswers: { deliveryStreams: ['data_migration'] } },
      deps
    );
    expect(result.draftId).toBe('d-1');
    expect(result.warnings?.join(' ')).toMatch(/DB migration pack generation failed/);
  });

  it('mixed streams: the DB stream is deterministic while the non-DB stream still goes through the LLM', async () => {
    const { deps, createDraftCalls, callLlm } = makeDeps(
      { status: 'fresh', packId: 'pack-1', inputSnapshotHash: 'hash-1', reason: null },
      minimalPackView()
    );
    await generateMigrationBookOfWork(
      {
        ...INPUT,
        wizardAnswers: {
          deliveryStreams: ['data_migration', 'target_frontend_implementation'],
        },
      },
      deps
    );
    // Exactly ONE LLM call — the non-DB stream's skeleton.
    expect(callLlm).toHaveBeenCalledTimes(1);
    const items = postedItems(createDraftCalls[0]);
    expect(items.some((i) => i.id.startsWith('data_migration:'))).toBe(true);
    expect(items.some((i) => i.id.startsWith('target_frontend_implementation:'))).toBe(true);
  });

  it('never invokes ensurePack/fetchPackView when no DB stream is selected and omits the generationInputs key', async () => {
    const { deps, ensureCalls, createDraftCalls, fetchPackView } = makeDeps(
      { status: 'fresh', packId: 'pack-1', inputSnapshotHash: 'hash-1', reason: null },
      minimalPackView()
    );

    await generateMigrationBookOfWork(
      {
        ...INPUT,
        wizardAnswers: { deliveryStreams: ['target_frontend_implementation'] },
      },
      deps
    );

    expect(ensureCalls).toHaveLength(0);
    expect(fetchPackView).not.toHaveBeenCalled();
    const posted = createDraftCalls[0] as {
      generation_inputs_json: Record<string, unknown>;
    };
    expect(posted.generation_inputs_json).not.toHaveProperty('dbMigrationPack');
  });
});
