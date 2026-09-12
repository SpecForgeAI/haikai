/**
 * Stage 1 reuse of a workbench build (2026-09-12): four durable facts, all
 * required; anything unprovable means a full rebuild.
 */

import { evaluateWorkbenchBuildReuse, decideWorkbenchBuildReuse } from '../services/migrationWorkbenchBuildReuse';
import type { TargetDbSecret } from '../services/migrationTargetCredentialsStore';

const target: TargetDbSecret = { dbType: 'postgres', host: 'PG.example.com', port: 5432, database: 'target', schema: null, username: 'u', password: 'p' } as TargetDbSecret;

const build = {
  id: 'b1',
  pack_id: 'k1',
  status: 'succeeded' as const,
  pack_version: 'v7',
  target_binding_json: { db_type: 'postgres', host: 'pg.example.com', port: 5432, database: 'target', schema: null },
  started_at: '2026-09-12T09:00:00Z',
  ended_at: '2026-09-12T09:20:00Z',
};
const clean = { id: 'rep-1', status: 'clean', created_at: '2026-09-12T10:00:00Z', report_json: null };

describe('evaluateWorkbenchBuildReuse', () => {
  it('reuses when the build succeeded from this pack version against this target and a clean report is newer than the build', () => {
    const d = evaluateWorkbenchBuildReuse({ build, packVersion: 'v7', targetDb: target, latestParityReport: clean });
    expect(d.reuse).toBe(true);
    expect(d.buildId).toBe('b1');
    expect(d.reportId).toBe('rep-1');
    expect(d.reason).toContain('clean reconcile rep-1 after it');
    // clean_sampled counts as clean; host comparison is case-insensitive.
    expect(evaluateWorkbenchBuildReuse({ build, packVersion: 'v7', targetDb: target, latestParityReport: { ...clean, status: 'clean_sampled' } }).reuse).toBe(true);
  });

  it('refuses, naming the fact that failed, for every unprovable case', () => {
    const cases: Array<[Parameters<typeof evaluateWorkbenchBuildReuse>[0], string]> = [
      [{ build: null, packVersion: 'v7', targetDb: target, latestParityReport: clean }, 'no workbench target build'],
      [{ build: { ...build, status: 'failed' }, packVersion: 'v7', targetDb: target, latestParityReport: clean }, 'is failed, not succeeded'],
      [{ build, packVersion: 'v8', targetDb: target, latestParityReport: clean }, 'pack version v7, this run uses v8'],
      [{ build, packVersion: null, targetDb: target, latestParityReport: clean }, 'pack version is unknown'],
      [{ build: { ...build, target_binding_json: null }, packVersion: 'v7', targetDb: target, latestParityReport: clean }, 'records no target binding'],
      [{ build, packVersion: 'v7', targetDb: { ...target, database: 'other' }, latestParityReport: clean }, 'this run targets PG.example.com:5432/other'],
      [{ build, packVersion: 'v7', targetDb: target, latestParityReport: null }, 'no data-parity report exists yet'],
      [{ build, packVersion: 'v7', targetDb: target, latestParityReport: { ...clean, status: 'divergent' } }, 'is divergent, not clean'],
      [{ build, packVersion: 'v7', targetDb: target, latestParityReport: { ...clean, created_at: '2026-09-12T09:10:00Z' } }, 'predates the workbench build'],
    ];
    for (const [inputs, expected] of cases) {
      const d = evaluateWorkbenchBuildReuse(inputs);
      expect(d.reuse).toBe(false);
      expect(d.reason).toContain(expected);
    }
  });
});

describe('decideWorkbenchBuildReuse', () => {
  it('reads both facts and decides; a read failure is a no-reuse decision, never a throw', async () => {
    const ok = await decideWorkbenchBuildReuse(
      { projectId: 'p', architectureId: 'a', packId: 'k1', packVersion: 'v7', targetDb: target },
      { fetchLatestTargetBuild: jest.fn().mockResolvedValue(build), fetchLatestDataParityReport: jest.fn().mockResolvedValue(clean) },
    );
    expect(ok.reuse).toBe(true);
    const broken = await decideWorkbenchBuildReuse(
      { projectId: 'p', architectureId: 'a', packId: 'k1', packVersion: 'v7', targetDb: target },
      { fetchLatestTargetBuild: jest.fn().mockRejectedValue(new Error('AMS down')), fetchLatestDataParityReport: jest.fn() },
    );
    expect(broken.reuse).toBe(false);
    expect(broken.reason).toContain('workbench build unreadable: AMS down');
  });
});
