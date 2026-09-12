/**
 * Stage 1 reuse of a workbench target build (2026-09-12, owner ask: "it does
 * feel like we are building the target DB twice").
 *
 * The pack Translations tab builds the declared target (schema -> data ->
 * post-load) so routines can be translated and reconciled long before a plan
 * runs, and "Reconcile target" produces a persisted data-parity report. The
 * DB plane's execution chain ran the SAME build again on Stage 1. It now
 * reuses the workbench build when four facts hold, every one verifiable from
 * durable rows -- never from "it probably still is":
 *
 *   1. the latest workbench build for the pack SUCCEEDED;
 *   2. it was built from THIS pack version (input_snapshot_hash) -- a
 *      regenerated pack means new DDL, so no reuse;
 *   3. it targeted THIS run's target database (host, port, database) -- the
 *      run's registered target credentials are the truth;
 *   4. a CLEAN data-parity report exists that is NEWER than the build --
 *      proof the target still holds the source's data at S0 (the workbench
 *      translation loop fires routines at the target; a later divergent
 *      report, including Stage 1's own, means the data moved and the next
 *      run reloads).
 *
 * On reuse the chain skips the structural schema apply and the data load and
 * still runs the post-load apply (Liquibase skips applied changesets; newly
 * approved translations land) and the reconcile. Pure evaluator + a default
 * reader; the chain wires both.
 */

import type { TargetDbSecret } from './migrationTargetCredentialsStore';
import { fetchLatestTargetBuild, type TargetBuildRow } from './dbMigrationPack/procWorkbenchClients';
import { defaultDataParityGateReads, type LatestDataParityReport } from './migrationDataParityGate';

export interface WorkbenchBuildReuseInputs {
  build: TargetBuildRow | null;
  /** The pack's current input_snapshot_hash (PackView.inputSnapshotHash). */
  packVersion: string | null;
  targetDb: TargetDbSecret;
  latestParityReport: LatestDataParityReport | null;
}

export interface WorkbenchBuildReuseDecision {
  reuse: boolean;
  /** One sentence the operator can read on the trace. */
  reason: string;
  buildId: string | null;
  reportId: string | null;
}

const CLEAN_STATUSES = new Set(['clean', 'clean_sampled']);

function ts(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : String(v ?? '').trim().toLowerCase();
}

export function evaluateWorkbenchBuildReuse(inputs: WorkbenchBuildReuseInputs): WorkbenchBuildReuseDecision {
  const { build, packVersion, targetDb, latestParityReport } = inputs;
  const no = (reason: string): WorkbenchBuildReuseDecision => ({
    reuse: false,
    reason,
    buildId: build?.id ?? null,
    reportId: (latestParityReport as { id?: string } | null)?.id ?? null,
  });

  if (!build) return no('no workbench target build exists for this pack');
  if (build.status !== 'succeeded') return no(`the latest workbench build ${build.id} is ${build.status}, not succeeded`);
  if (!packVersion || !build.pack_version) {
    return no('the pack version is unknown on the build or the pack — cannot prove the build matches this pack');
  }
  if (build.pack_version !== packVersion) {
    return no(`the workbench build is from pack version ${build.pack_version}, this run uses ${packVersion} (the pack was regenerated)`);
  }
  const binding = (build.target_binding_json ?? null) as Record<string, unknown> | null;
  if (!binding) return no('the workbench build records no target binding');
  const sameTarget =
    norm(binding.host) === norm(targetDb.host) &&
    Number(binding.port) === Number(targetDb.port) &&
    norm(binding.database) === norm(targetDb.database);
  if (!sameTarget) {
    return no(
      `the workbench build targeted ${String(binding.host)}:${String(binding.port)}/${String(binding.database)}, ` +
        `this run targets ${targetDb.host}:${targetDb.port}/${targetDb.database}`,
    );
  }
  if (!latestParityReport) return no('no data-parity report exists yet — run "Reconcile target" on the Translations tab first');
  const status = latestParityReport.status ?? null;
  if (!status || !CLEAN_STATUSES.has(status)) {
    return no(`the latest data-parity report is ${status ?? 'unknown'}, not clean — the target data must be reloaded`);
  }
  const buildEnded = ts(build.ended_at) ?? ts(build.started_at);
  const reportAt = ts(latestParityReport.created_at);
  if (buildEnded === null || reportAt === null || reportAt < buildEnded) {
    return no('the latest clean data-parity report predates the workbench build — reconcile the target again first');
  }
  return {
    reuse: true,
    reason:
      `workbench build ${build.id} (pack ${packVersion}, same target, clean reconcile ` +
      `${(latestParityReport as { id?: string }).id ?? '(id unknown)'} after it)`,
    buildId: build.id,
    reportId: (latestParityReport as { id?: string }).id ?? null,
  };
}

export interface WorkbenchBuildReuseReads {
  fetchLatestTargetBuild: typeof fetchLatestTargetBuild;
  fetchLatestDataParityReport: (projectId: string, architectureId: string) => Promise<LatestDataParityReport | null>;
}

export function defaultWorkbenchBuildReuseReads(): WorkbenchBuildReuseReads {
  return {
    fetchLatestTargetBuild,
    fetchLatestDataParityReport: (p, a) => defaultDataParityGateReads().fetchLatestDataParityReport(p, a),
  };
}

/**
 * Read the durable facts and decide. Fail-soft: any read error is a
 * no-reuse decision naming the read, never a chain failure.
 */
export async function decideWorkbenchBuildReuse(
  args: { projectId: string; architectureId: string; packId: string; packVersion: string | null; targetDb: TargetDbSecret },
  reads: WorkbenchBuildReuseReads = defaultWorkbenchBuildReuseReads(),
): Promise<WorkbenchBuildReuseDecision> {
  let build: TargetBuildRow | null = null;
  let report: LatestDataParityReport | null = null;
  try {
    build = await reads.fetchLatestTargetBuild(args.projectId, args.packId);
  } catch (err) {
    return { reuse: false, reason: `workbench build unreadable: ${err instanceof Error ? err.message : String(err)}`, buildId: null, reportId: null };
  }
  try {
    report = await reads.fetchLatestDataParityReport(args.projectId, args.architectureId);
  } catch (err) {
    return { reuse: false, reason: `data-parity report unreadable: ${err instanceof Error ? err.message : String(err)}`, buildId: build?.id ?? null, reportId: null };
  }
  return evaluateWorkbenchBuildReuse({ build, packVersion: args.packVersion, targetDb: args.targetDb, latestParityReport: report });
}
