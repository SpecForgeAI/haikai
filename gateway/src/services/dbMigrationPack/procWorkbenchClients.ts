/**
 * Downstream clients for the translation workbench (Spec 4, 2026-09-09).
 *
 *   AMVS: proc parity replay (`/api/proc-parity/run`), routine apply
 *         (`/api/routine-apply/run`).
 *   AMS:  translation attempts, target builds, proc parity reports
 *         (latest-by-routine), comparison waivers (scope `proc-parity`).
 *
 * Credentials travel request-scoped in bodies; nothing here logs them.
 */

import { getConfig } from '../../config';
import { logger } from '../logger';
import { longRunningPostJson } from '../longRunningFetch';
import type { TargetDbSecret } from '../migrationTargetCredentialsStore';
import type { RoutineDescriptor } from './routineInvocationDescriptor';
import type { FailingScenarioEvidence } from './evidenceLadder';

function amsBase(): string {
  return getConfig().architectureModelServiceBaseUrl;
}
function amvsBase(): string {
  return getConfig().apiMigrationValidationServiceBaseUrl;
}

async function amsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`AMS ${init?.method ?? 'GET'} ${url.replace(amsBase(), '')} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function dbBlock(db: TargetDbSecret): Record<string, unknown> {
  return { db_type: db.dbType, host: db.host, port: db.port, database: db.database, schema: db.schema ?? null, username: db.username, password: db.password };
}

// ---------------------------------------------------------------------------
// AMVS
// ---------------------------------------------------------------------------

export interface RoutineApplyOutcome {
  ok: boolean;
  error: { sqlstate: string | null; message: string; position: number | null; detail: string | null } | null;
}

export async function applyRoutineViaAmvs(args: {
  projectId: string;
  architectureId: string;
  targetDb: TargetDbSecret;
  descriptor: RoutineDescriptor;
  draftSql: string;
}): Promise<RoutineApplyOutcome> {
  const url = `${amvsBase()}/api-migration-validation/api/routine-apply/run`;
  const resp = await longRunningPostJson(url, {
    project_id: args.projectId,
    architecture_id: args.architectureId,
    target_db: dbBlock(args.targetDb),
    descriptor: args.descriptor,
    draft_sql: args.draftSql,
    drop_first: true,
  });
  const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: RoutineApplyOutcome['error'] | string };
  if (!resp.ok) {
    return { ok: false, error: { sqlstate: null, message: typeof json.error === 'string' ? json.error : `HTTP ${resp.status}`, position: null, detail: null } };
  }
  return { ok: json.ok === true, error: json.ok ? null : (typeof json.error === 'object' && json.error ? json.error : { sqlstate: null, message: 'apply failed', position: null, detail: null }) };
}

export interface ProcParityRunOutcome {
  baselineId: string | null;
  reports: Array<{
    routine_id: string;
    routine_name: string;
    report_id: string | null;
    summary: {
      status: 'clean' | 'clean_with_waivers' | 'divergent' | 'unverifiable';
      divergent: number;
      unverifiable: number;
      scenarios: number;
      signatures: Array<{ signature: string; count: number; scenario_names: string[] }>;
      unverifiable_reason?: string | null;
    };
  }>;
  skipped: Array<{ routine_id: string; reason: string }>;
  error: string | null;
}

export async function runProcParityViaAmvs(args: {
  projectId: string;
  architectureId: string;
  targetDb: TargetDbSecret;
  routineIds: string[];
  descriptors: Record<string, RoutineDescriptor>;
  purpose: 'workbench' | 'execution' | 'manual';
  packId?: string | null;
  translationAttemptId?: string | null;
  waivers?: Array<{ scope: 'routine' | 'scenario'; routine: string; scenario?: string | null; reason: string }>;
  upstreamDivergentTables?: string[];
}): Promise<ProcParityRunOutcome> {
  const url = `${amvsBase()}/api-migration-validation/api/proc-parity/run`;
  const resp = await longRunningPostJson(url, {
    project_id: args.projectId,
    architecture_id: args.architectureId,
    target_db: dbBlock(args.targetDb),
    routine_ids: args.routineIds,
    descriptors: args.descriptors,
    purpose: args.purpose,
    pack_id: args.packId ?? null,
    translation_attempt_id: args.translationAttemptId ?? null,
    waivers: args.waivers ?? [],
    upstream_divergent_tables: args.upstreamDivergentTables ?? [],
  });
  const json = (await resp.json().catch(() => ({}))) as { baseline_id?: string; reports?: ProcParityRunOutcome['reports']; skipped?: ProcParityRunOutcome['skipped']; error?: string; code?: string };
  if (!resp.ok) {
    return { baselineId: null, reports: [], skipped: [], error: json.error ? `${json.error}${json.code ? ` (${json.code})` : ''}` : `HTTP ${resp.status}` };
  }
  return { baselineId: json.baseline_id ?? null, reports: json.reports ?? [], skipped: json.skipped ?? [], error: null };
}

// ---------------------------------------------------------------------------
// AMS
// ---------------------------------------------------------------------------

export interface ProcParityReportRow {
  id: string;
  routine_id: string;
  baseline_id?: string | null;
  purpose: string;
  status: string;
  summary_json?: Record<string, unknown> | null;
  report_json?: { scenarios?: Array<Record<string, unknown>>; summary?: Record<string, unknown> } | null;
  created_at?: string;
}

export async function fetchProcParityReport(projectId: string, architectureId: string, reportId: string): Promise<ProcParityReportRow | null> {
  try {
    return await amsJson<ProcParityReportRow>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/proc-parity-reports/${encodeURIComponent(reportId)}`,
      { headers: { Accept: 'application/json' } }
    );
  } catch (error) {
    logger.warn(`[diag-gateway] proc_parity report_fetch_failed id=${reportId} reason=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Latest report per routine (a map keyed by routine_id). */
export async function fetchLatestProcParityByRoutine(
  projectId: string,
  architectureId: string,
  opts: { purpose?: string; packId?: string } = {}
): Promise<Record<string, { id: string; status: string; purpose: string; created_at: string; summary_json?: Record<string, unknown> | null }>> {
  const params = new URLSearchParams();
  if (opts.purpose) params.set('purpose', opts.purpose);
  if (opts.packId) params.set('pack_id', opts.packId);
  const qs = params.toString();
  try {
    const body = await amsJson<Record<string, { id: string; status: string; purpose: string; created_at: string; summary_json?: Record<string, unknown> | null }>>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/proc-parity-reports/latest-by-routine${qs ? `?${qs}` : ''}`,
      { headers: { Accept: 'application/json' } }
    );
    return body ?? {};
  } catch (error) {
    logger.warn(`[diag-gateway] proc_parity latest_by_routine_failed reason=${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/** The failing-scenario evidence slice of one report (for the ladder). */
export function failingScenariosOf(report: ProcParityReportRow | null, inputsByScenario: Map<string, Array<{ name: string; value: unknown; is_null?: boolean }>>): FailingScenarioEvidence[] {
  const scenarios = report?.report_json?.scenarios ?? [];
  const out: FailingScenarioEvidence[] = [];
  for (const s of scenarios) {
    if (s.verdict !== 'divergent' || s.waived === true) continue;
    out.push({
      scenario_name: String(s.scenario_name ?? ''),
      scenario_type: String(s.scenario_type ?? ''),
      signature: typeof s.signature === 'string' ? s.signature : null,
      inputs: inputsByScenario.get(String(s.scenario_name ?? '')) ?? [],
      dimensions: Array.isArray(s.dimensions) ? (s.dimensions as FailingScenarioEvidence['dimensions']) : [],
    });
  }
  return out;
}

export interface TranslationAttemptRow {
  id: string;
  translation_id: string;
  attempt_no: number;
  verdict: string;
  draft_content?: string | null;
  parity_report_id?: string | null;
  evidence_rungs_json?: unknown;
  guidance_text?: string | null;
  created_at?: string;
}

export async function createTranslationAttempt(projectId: string, packId: string, translationId: string, body: Record<string, unknown>): Promise<TranslationAttemptRow | null> {
  try {
    return await amsJson<TranslationAttemptRow>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs/${encodeURIComponent(packId)}/translations/${encodeURIComponent(translationId)}/attempts`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
    );
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench attempt_persist_failed translation=${translationId} reason=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function listTranslationAttempts(projectId: string, packId: string, translationId: string): Promise<TranslationAttemptRow[]> {
  try {
    const rows = await amsJson<TranslationAttemptRow[]>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs/${encodeURIComponent(packId)}/translations/${encodeURIComponent(translationId)}/attempts`,
      { headers: { Accept: 'application/json' } }
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export interface TargetBuildRow {
  id: string;
  pack_id: string;
  status: 'running' | 'succeeded' | 'failed';
  phases_json?: Record<string, unknown> | null;
  s0_fingerprint_json?: Record<string, unknown> | null;
  pack_version?: string | null;
  rebuild?: boolean;
  error?: string | null;
  started_at?: string;
  ended_at?: string | null;
}

export async function createTargetBuild(projectId: string, packId: string, body: Record<string, unknown>): Promise<TargetBuildRow | null> {
  try {
    return await amsJson<TargetBuildRow>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs/${encodeURIComponent(packId)}/target-builds`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
    );
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench target_build_create_failed pack=${packId} reason=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function patchTargetBuild(projectId: string, packId: string, buildId: string, body: Record<string, unknown>): Promise<void> {
  try {
    await amsJson(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs/${encodeURIComponent(packId)}/target-builds/${encodeURIComponent(buildId)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
    );
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench target_build_patch_failed build=${buildId} reason=${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function fetchLatestTargetBuild(projectId: string, packId: string): Promise<TargetBuildRow | null> {
  try {
    return await amsJson<TargetBuildRow>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs/${encodeURIComponent(packId)}/target-builds/latest`,
      { headers: { Accept: 'application/json' } }
    );
  } catch {
    return null;
  }
}

/**
 * Proc-parity waivers ride the generic comparison-waiver table with
 * `dimension = 'proc-parity'` (the create request has no scope field) and
 * `target = '<routine>'` or `'<routine>::<scenario>'`; provenance `workbench`.
 */
export const PROC_PARITY_WAIVER_DIMENSION = 'proc-parity';

export interface ProcParityWaiverRow {
  id?: string;
  dimension: string | null;
  target: string;
  reason: string;
  author?: string | null;
  provenance?: string | null;
}

export async function listProcParityWaivers(projectId: string): Promise<ProcParityWaiverRow[]> {
  try {
    const rows = await amsJson<ProcParityWaiverRow[]>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/api-behaviour/comparison-waivers`,
      { headers: { Accept: 'application/json' } }
    );
    return Array.isArray(rows) ? rows.filter((r) => r.dimension === PROC_PARITY_WAIVER_DIMENSION) : [];
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench waivers_fetch_failed reason=${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function createProcParityWaiver(projectId: string, body: { target: string; reason: string; author?: string | null }): Promise<ProcParityWaiverRow | null> {
  try {
    return await amsJson<ProcParityWaiverRow>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/api-behaviour/comparison-waivers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ dimension: PROC_PARITY_WAIVER_DIMENSION, target: body.target, reason: body.reason, author: body.author ?? 'reviewer', provenance: 'workbench' }),
      }
    );
  } catch (error) {
    logger.warn(`[diag-gateway] proc_workbench waiver_create_failed reason=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Waiver rows → the runner's waiver shape: target `<routine>` or `<routine>::<scenario>`. */
export function toRunnerWaivers(rows: ProcParityWaiverRow[]): Array<{ scope: 'routine' | 'scenario'; routine: string; scenario?: string | null; reason: string }> {
  return rows.map((r) => {
    const [routine, scenario] = r.target.split('::');
    const bare = (routine.split('.').pop() ?? routine).toLowerCase();
    return scenario ? { scope: 'scenario', routine: bare, scenario, reason: r.reason } : { scope: 'routine', routine: bare, reason: r.reason };
  });
}
