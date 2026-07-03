/**
 * Unit tests — DB migration pack ensure-fresh step (Spec 2026-07-02-a,
 * Persistence-Tier Oracle Program).
 *
 * Contract under test (all via ensureFreshDbMigrationPackWithDeps, deps
 * injected — no live AMS anywhere):
 *   - missing pack        -> generate            -> 'generated'
 *   - different binding   -> regenerate          -> 'refreshed'
 *   - same binding, stale -> regenerate          -> 'refreshed'
 *   - same binding, fresh -> NO write            -> 'fresh'
 *   - engine-gate reject  -> no throw            -> 'skipped'
 *   - any other failure   -> no throw            -> 'failed'
 */

import {
  EnsurePackDeps,
  ExistingPackRow,
  ensureFreshDbMigrationPackWithDeps,
} from '../services/dbMigrationPackEnsure';
import { UnsupportedEnginePairError } from '../services/dbMigrationPack/types';
import type {
  GenerateDbMigrationPackRequest,
  GenerateDbMigrationPackResult,
} from '../services/dbMigrationPackHandler';

const ARGS = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
};

function generateResult(packId: string): GenerateDbMigrationPackResult {
  return {
    pack: { id: packId } as GenerateDbMigrationPackResult['pack'],
    inputSnapshotHash: 'hash-new',
    counts: { translated: 1, skipped: 0, flagged: 0 },
    fileCount: 3,
    decisionCount: 0,
    translationSync: null,
  };
}

function packRow(overrides: Partial<ExistingPackRow> = {}): ExistingPackRow {
  return {
    id: 'pack-1',
    status: 'generated',
    stale_reason: null,
    input_snapshot_hash: 'hash-stored',
    manifest_json: { target_architecture_id: 'arch-target' },
    ...overrides,
  };
}

function deps(overrides: Partial<EnsurePackDeps> = {}): {
  deps: EnsurePackDeps;
  generateCalls: GenerateDbMigrationPackRequest[];
} {
  const generateCalls: GenerateDbMigrationPackRequest[] = [];
  const base: EnsurePackDeps = {
    listPacks: async () => [],
    evaluateStaleness: async () => ({
      is_stale: false,
      staleness_reason: null,
      current_input_snapshot_hash: 'hash-stored',
      staleness_check_error: null,
    }),
    generatePack: async (request) => {
      generateCalls.push(request);
      return generateResult('pack-new');
    },
    ...overrides,
  };
  return { deps: base, generateCalls };
}

describe('ensureFreshDbMigrationPackWithDeps', () => {
  it("generates when no pack exists ('generated'), binding to the plan's target", async () => {
    const { deps: d, generateCalls } = deps();
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('generated');
    expect(outcome.packId).toBe('pack-new');
    expect(outcome.inputSnapshotHash).toBe('hash-new');
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({
      projectId: 'proj-1',
      architectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
    });
  });

  it("regenerates when the existing pack is bound to a DIFFERENT target ('refreshed')", async () => {
    const { deps: d, generateCalls } = deps({
      listPacks: async () => [
        packRow({ manifest_json: { target_architecture_id: 'arch-other' } }),
      ],
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('refreshed');
    expect(outcome.reason).toContain('arch-other');
    expect(generateCalls).toHaveLength(1);
  });

  it("treats a legacy pack with NO binding as different ('refreshed')", async () => {
    const { deps: d, generateCalls } = deps({
      listPacks: async () => [packRow({ manifest_json: {} })],
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('refreshed');
    expect(generateCalls).toHaveLength(1);
  });

  it("regenerates a same-binding pack that is STALE ('refreshed')", async () => {
    const { deps: d, generateCalls } = deps({
      listPacks: async () => [packRow()],
      evaluateStaleness: async () => ({
        is_stale: true,
        staleness_reason: 'inputs changed since generation',
        current_input_snapshot_hash: 'hash-drifted',
        staleness_check_error: null,
      }),
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('refreshed');
    expect(outcome.reason).toBe('inputs changed since generation');
    expect(generateCalls).toHaveLength(1);
  });

  it("returns 'fresh' WITHOUT generating when the same-binding pack is not stale", async () => {
    const { deps: d, generateCalls } = deps({
      listPacks: async () => [packRow()],
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('fresh');
    expect(outcome.packId).toBe('pack-1');
    expect(outcome.inputSnapshotHash).toBe('hash-stored');
    expect(generateCalls).toHaveLength(0);
  });

  it("maps the engine-gate rejection to 'skipped' (never throws)", async () => {
    const { deps: d } = deps({
      generatePack: async () => {
        throw new UnsupportedEnginePairError(
          'sybase',
          'unknown',
          `No 'db.engine' captured decision found — the target engine is a mandatory input.`
        );
      },
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('skipped');
    expect(outcome.packId).toBeNull();
    expect(outcome.reason).toContain('db.engine');
  });

  it("maps any other failure to 'failed' (never throws)", async () => {
    const { deps: d } = deps({
      listPacks: async () => {
        throw new Error('AMS pack list fetch failed: HTTP 503');
      },
    });
    const outcome = await ensureFreshDbMigrationPackWithDeps(ARGS, d);
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('503');
  });
});
