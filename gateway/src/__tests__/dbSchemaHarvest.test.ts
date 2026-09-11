/**
 * Sybase schema harvest orchestration — service-level tests (Spec 3,
 * 2026-08-04).
 *
 * Covers the six-stage chain via injected deps (dbMigrationPackDrift.ts
 * convention — no HTTP in the happy/failure-path tests):
 *   1. Happy path: scan completes -> auto-approve (committed/approved rows
 *      skipped) -> MCP save-back -> in-process regenerate -> refreshed
 *      finding states joined with dispositions.
 *   2. Scan FAILED -> stage=scan_failed, nothing downstream runs.
 *   3. Poll timeout -> stage=scan_failed with last-observed status.
 *   4. Save-back failure -> stage=save_failed.
 *   5. Regenerate failure -> stage=regenerate_failed (savedBack retained).
 *   6. CREDENTIAL SAFETY: the password never appears in returned error
 *      strings, logger calls, or [diag-gateway] console output — including
 *      on the default create-run dep's HTTP failure path.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    mcpBaseUrl: 'http://localhost:8090',
  }),
  resetConfig: jest.fn(),
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../services/logger', () => ({ logger: mockLogger }));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import {
  runStructuralHarvest,
  RunStructuralHarvestArgs,
  HarvestDeps,
} from '../services/dbSchemaHarvest';
import type { GenerateDbMigrationPackResult } from '../services/dbMigrationPackHandler';

const PASSWORD = 'sekret-pw-123';

function baseArgs(overrides: Partial<RunStructuralHarvestArgs> = {}): RunStructuralHarvestArgs {
  return {
    projectId: 'p-1',
    architectureId: 'a-1',
    targetArchitectureId: 't-1',
    connection: {
      host: 'sybase.internal',
      port: 5000,
      databaseName: 'legacy_db',
      username: 'svc_reader',
      password: PASSWORD,
    },
    pollIntervalMs: 1,
    pollTimeoutMs: 5_000,
    ...overrides,
  };
}

/** A minimal-but-shaped regeneration result carrying structural findings. */
function generationResult(
  findings: Array<{ kind: string; subject: string; message: string }>
): GenerateDbMigrationPackResult {
  return {
    pack: {
      id: 'pack-1',
      project_id: 'p-1',
      architecture_id: 'a-1',
      status: 'generated',
      input_snapshot_hash: 'h',
      translated_count: 0,
      skipped_count: 0,
      flagged_count: 0,
      seed_margin: null,
      manifest_json: { structural_findings: findings },
    },
    inputSnapshotHash: 'h',
    counts: { translated: 0, skipped: 0, flagged: 0 },
    fileCount: 1,
    decisionCount: 0,
    translationSync: null,
  };
}

function happyDeps(overrides: Partial<HarvestDeps> = {}): HarvestDeps & {
  approved: string[];
} {
  const approved: string[] = [];
  const getRun = jest
    .fn()
    .mockResolvedValueOnce({ id: 'run-1', status: 'RUNNING' })
    .mockResolvedValue({ id: 'run-1', status: 'COMPLETED' });
  return {
    approved,
    createRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'RUNNING' }),
    getRun,
    listCandidates: jest.fn().mockResolvedValue([
      { id: 'c-1', review_status: 'pending' },
      { id: 'c-2', review_status: 'committed' },
      { id: 'c-3', review_status: 'pending' },
    ]),
    approveCandidate: jest.fn(async (_p, _a, _r, candidateId: string) => {
      approved.push(candidateId);
    }),
    saveApproved: jest.fn().mockResolvedValue({
      entitiesCreated: 4,
      entitiesSkipped: 2,
      candidatesCommitted: 6,
    }),
    regeneratePack: jest.fn().mockResolvedValue(
      generationResult([
        { kind: 'no_primary_keys', subject: 'dbo.orders', message: 'no PKs captured' },
      ])
    ),
    fetchDispositions: jest.fn().mockResolvedValue([]),
    sleep: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

/** Every string that went through console/logger during the test. */
function allCapturedOutput(): string {
  const pieces: string[] = [];
  for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls]) {
    pieces.push(call.map((c: unknown) => JSON.stringify(c) ?? String(c)).join(' '));
  }
  for (const fn of [mockLogger.debug, mockLogger.info, mockLogger.warn, mockLogger.error]) {
    for (const call of fn.mock.calls) {
      pieces.push(call.map((c: unknown) => JSON.stringify(c) ?? String(c)).join(' '));
    }
  }
  return pieces.join('\n');
}

describe('runStructuralHarvest — happy path', () => {
  it('chains scan -> approve -> save -> regenerate -> findings', async () => {
    const deps = happyDeps();
    const result = await runStructuralHarvest(baseArgs(), deps);

    expect(result.stage).toBe('completed');
    expect(result.runId).toBe('run-1');
    expect(result.runStatus).toBe('COMPLETED');
    expect(result.packRegenerated).toBe(true);
    expect(result.savedBack).toEqual({
      entitiesCreated: 4,
      entitiesSkipped: 2,
      candidatesCommitted: 6,
    });
    // Committed candidate skipped; only the two actionable rows approved.
    expect(deps.approved).toEqual(['c-1', 'c-3']);
    // Findings come from the REGENERATED manifest.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'no_primary_keys',
      subject: 'dbo.orders',
      open: true,
    });
    // Regeneration used the decision-binding target from the request.
    expect(deps.regeneratePack).toHaveBeenCalledWith({
      projectId: 'p-1',
      architectureId: 'a-1',
      targetArchitectureId: 't-1',
    });
    expect(result.error).toBeUndefined();
  });

  it('joins dispositions so pre-accepted findings come back closed', async () => {
    const deps = happyDeps({
      fetchDispositions: jest.fn().mockResolvedValue([
        {
          finding_key: 'no_primary_keys:dbo.orders',
          disposition: 'accepted',
          note: 'source really has none',
        },
      ]),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('completed');
    expect(result.findings[0].open).toBe(false);
    expect(result.findings[0].disposition).toBe('accepted');
  });

  it('degrades to undispositioned findings when the disposition read fails', async () => {
    const deps = happyDeps({
      fetchDispositions: jest.fn().mockRejectedValue(new Error('AMS 500')),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('completed');
    expect(result.findings[0].open).toBe(true);
  });
});

describe('runStructuralHarvest — scan failures', () => {
  it('returns scan_failed when the run reaches FAILED', async () => {
    const deps = happyDeps({
      getRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'FAILED' }),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('scan_failed');
    expect(result.runStatus).toBe('FAILED');
    expect(result.savedBack).toBeNull();
    expect(result.packRegenerated).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.error).toContain('run-1');
    // Nothing downstream ran.
    expect(deps.listCandidates).not.toHaveBeenCalled();
    expect(deps.saveApproved).not.toHaveBeenCalled();
    expect(deps.regeneratePack).not.toHaveBeenCalled();
  });

  it('returns scan_failed when run creation itself fails', async () => {
    const deps = happyDeps({
      createRun: jest.fn().mockRejectedValue(new Error('HTTP 400 missing config')),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('scan_failed');
    expect(result.runId).toBeNull();
    expect(result.error).toContain('Run creation failed');
  });

  it('returns scan_failed with last status on poll timeout', async () => {
    const deps = happyDeps({
      // Never leaves RUNNING; wall-clock deadline expires.
      getRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'RUNNING' }),
    });
    const result = await runStructuralHarvest(
      baseArgs({ pollIntervalMs: 1, pollTimeoutMs: 25 }),
      deps
    );
    expect(result.stage).toBe('scan_failed');
    expect(result.runStatus).toBe('RUNNING');
    expect(result.error).toContain('did not reach a terminal status');
    expect(deps.saveApproved).not.toHaveBeenCalled();
  });

  it('tolerates transient poll-read failures until the run completes', async () => {
    const getRun = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue({ id: 'run-1', status: 'COMPLETED' });
    const deps = happyDeps({ getRun });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('completed');
  });
});

describe('runStructuralHarvest — save-back failures', () => {
  it('returns save_failed when a candidate approval fails', async () => {
    const deps = happyDeps({
      approveCandidate: jest
        .fn()
        .mockRejectedValue(new Error('Candidate approve failed (c-1): HTTP 500')),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('save_failed');
    expect(result.savedBack).toBeNull();
    expect(result.error).toContain('Save-back failed');
    expect(deps.saveApproved).not.toHaveBeenCalled();
    expect(deps.regeneratePack).not.toHaveBeenCalled();
  });

  it('returns save_failed when the MCP save-back fails', async () => {
    const deps = happyDeps({
      saveApproved: jest
        .fn()
        .mockRejectedValue(new Error('save_approved_candidates failed: HTTP 502')),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('save_failed');
    expect(result.savedBack).toBeNull();
    expect(result.packRegenerated).toBe(false);
    expect(deps.regeneratePack).not.toHaveBeenCalled();
  });
});

describe('runStructuralHarvest — regenerate failures', () => {
  it('returns regenerate_failed but KEEPS the save-back summary', async () => {
    const deps = happyDeps({
      regeneratePack: jest.fn().mockRejectedValue(new Error('AMS persist 500')),
    });
    const result = await runStructuralHarvest(baseArgs(), deps);
    expect(result.stage).toBe('regenerate_failed');
    // The model WAS backfilled — the caller must see that even though the
    // pack refresh failed (retry = plain /regenerate, no re-scan needed).
    expect(result.savedBack).toEqual({
      entitiesCreated: 4,
      entitiesSkipped: 2,
      candidatesCommitted: 6,
    });
    expect(result.packRegenerated).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.error).toContain('Pack regeneration failed');
  });
});

describe('runStructuralHarvest — credential safety', () => {
  it('never emits the password in results or logs across failure paths', async () => {
    // Exercise every failure stage in sequence and sweep ALL captured output.
    const failures: HarvestDeps[] = [
      happyDeps({ createRun: jest.fn().mockRejectedValue(new Error('HTTP 401 auth')) }),
      happyDeps({ getRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'FAILED' }) }),
      happyDeps({ saveApproved: jest.fn().mockRejectedValue(new Error('HTTP 502')) }),
      happyDeps({ regeneratePack: jest.fn().mockRejectedValue(new Error('boom')) }),
    ];
    for (const deps of failures) {
      const result = await runStructuralHarvest(baseArgs(), deps);
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    }
    // Happy path too — diag lines must be credential-free.
    await runStructuralHarvest(baseArgs(), happyDeps());
    expect(allCapturedOutput()).not.toContain(PASSWORD);
  });

  it('default create-run dep sends the password ONLY in the request body and keeps it out of the error', async () => {
    // No createRun injected -> the real HTTP dep runs against mocked fetch.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid credentials for user svc_reader',
    });
    const result = await runStructuralHarvest(baseArgs(), {
      // Everything downstream unreachable — createRun fails first.
      sleep: jest.fn().mockResolvedValue(undefined),
      // The engine-resolution dep (2026-09-11) would otherwise make its own
      // pack-manifest fetch; stubbing it keeps this test on the ONE call it
      // is about (the create-run POST that carries the password).
      resolveSourceEngine: jest.fn().mockResolvedValue(null),
    });
    expect(result.stage).toBe('scan_failed');
    expect(result.error).toContain('HTTP 401');
    expect(result.error).not.toContain(PASSWORD);
    // The ONE place the password is allowed: the create-run POST body.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'http://localhost:8091/discovery/projects/p-1/architectures/a-1/runs'
    );
    const sent = JSON.parse((init as { body: string }).body);
    expect(sent.discovery_kind).toBe('database');
    expect(sent.database_config).toMatchObject({
      dbEngine: 'sybase',
      profilingMode: 'none',
      readOnlyConfirmed: true,
      sybaseDriver: 'auto',
    });
    expect(sent.database_credentials).toEqual({
      username: 'svc_reader',
      password: PASSWORD,
    });
    expect(allCapturedOutput()).not.toContain(PASSWORD);
  });
});
