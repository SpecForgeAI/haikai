/**
 * Side-by-side sync + reconciliation + swap-over artifacts
 * (Spec 2026-07-02-d — Persistence-Tier Oracle Program).
 *
 * The user's operating model (program decision record): weekend bulk load,
 * then the CURRENT and TARGET databases run side by side with a ONE-WAY daily
 * incremental sync into the shadow target until confidence is reached, then
 * swap-over. That makes the daily sync an OPERABLE, RERUNNABLE capability
 * with a per-run reconciliation report — not a one-off script — and it moves
 * sequence/identity seeding to SWAP-OVER (the source keeps advancing during
 * side-by-side running).
 *
 * Emitted files (all deterministic; NO LLM):
 *   sync/000-sync-state.sql        (sync_runner)          — high-water state DDL
 *   sync/run-incremental-sync.sh   (sync_runner)          — the rerunnable daily runner
 *   reconcile/reconciliation.sql   (reconciliation_script)— per-table count/high-water queries
 *   reconcile/build-report.sh      (reconciliation_script)— CSV merge -> markdown drift report
 *   cutover/swap-over-runbook.md   (cutover_runbook)      — ordered swap-over checklist
 *
 * NO dual-write anywhere — one-way source -> target only.
 */

import type { DeltaStrategy, IrSequence } from './types';
import { SEQUENCES_SEED_CHANGESET_PATH, quoteIdent } from './liquibase';

export const SYNC_STATE_TABLE = 'haikai_sync_state';
export const SYNC_STATE_PATH = 'sync/000-sync-state.sql';
export const SYNC_RUNNER_PATH = 'sync/run-incremental-sync.sh';
export const RECONCILIATION_SQL_PATH = 'reconcile/reconciliation.sql';
export const RECONCILIATION_REPORT_PATH = 'reconcile/build-report.sh';
export const SWAP_OVER_RUNBOOK_PATH = 'cutover/swap-over-runbook.md';

/** The manifest's `sync` section (Spec 2026-07-02-d). */
export interface SyncManifestSection {
  cadence_default: 'daily';
  state_table: string;
  runner_path: string;
  state_ddl_path: string;
  reconciliation_paths: string[];
  runbook_path: string;
  /** Per-table sync posture, mirroring delta_strategies for quick reads. */
  tables: Array<{ table: string; strategy: DeltaStrategy['strategy']; delta_key: string | null }>;
}

export function buildSyncManifestSection(
  strategies: DeltaStrategy[]
): SyncManifestSection {
  return {
    cadence_default: 'daily',
    state_table: SYNC_STATE_TABLE,
    runner_path: SYNC_RUNNER_PATH,
    state_ddl_path: SYNC_STATE_PATH,
    reconciliation_paths: [RECONCILIATION_SQL_PATH, RECONCILIATION_REPORT_PATH],
    runbook_path: SWAP_OVER_RUNBOOK_PATH,
    tables: strategies.map((s) => ({
      table: s.table,
      strategy: s.strategy,
      delta_key: s.deltaKey,
    })),
  };
}

// ---------------------------------------------------------------------------
// sync/000-sync-state.sql
// ---------------------------------------------------------------------------

export function emitSyncStateDdl(): string {
  return [
    `-- ${SYNC_STATE_PATH}`,
    '-- High-water state for the DAILY one-way incremental sync (side-by-side',
    '-- running until swap-over). One row per synced table; the runner reads',
    "-- the stored high-water, applies the table's incremental script with",
    '-- :last_high_water bound to it, and advances the row on success.',
    '-- Idempotence: re-running with no source changes applies nothing.',
    '',
    `CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (`,
    '  table_name   text PRIMARY KEY,',
    '  high_water   text,          -- bigint-safe verbatim high-water (identity or timestamp)',
    '  last_run_at  timestamptz,',
    '  last_status  text           -- ok | drift | error',
    ');',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// sync/run-incremental-sync.sh
// ---------------------------------------------------------------------------

export function emitSyncRunner(args: { strategies: DeltaStrategy[] }): string {
  const synced = args.strategies.filter(
    (s) => s.strategy === 'insert_only' || s.strategy === 'insert_update'
  );
  const fullReload = args.strategies.filter((s) => s.strategy === 'full_reload');
  const pending = args.strategies.filter((s) => s.strategy === 'needs_decision');
  const lines: string[] = [];
  lines.push('#!/usr/bin/env bash');
  lines.push(`# ${SYNC_RUNNER_PATH} — DAILY one-way incremental sync (source -> shadow target).`);
  lines.push('#');
  lines.push('# Side-by-side operating model: after the initial weekend bulk load the');
  lines.push('# target runs as a SHADOW. This runner tops it up once a day until');
  lines.push('# swap-over. ONE-WAY only — never write back to the source.');
  lines.push('#');
  lines.push('# EXECUTION MODEL (2026-08-07 — replaces the old comment-stub runner that');
  lines.push('# executed NOTHING): the sync is AMVS-DRIVEN. The gateway endpoint below');
  lines.push('# dispatches the real capability — keyed keyset deltas STRICTLY ABOVE the');
  lines.push(`# stored high-water (${SYNC_STATE_TABLE} on the TARGET) are UPSERTed`);
  lines.push('# (insert_only -> ON CONFLICT DO NOTHING; insert_update -> DO UPDATE),');
  lines.push('# full_reload tables truncate+reload, and pk-diff delete propagation is a');
  lines.push('# bounded per-table opt-in (delete_modes in the request body). Credentials');
  lines.push("# come from the gateway's registered stores — NEVER from this script.");
  lines.push('#');
  lines.push('# Environment (set all before running):');
  lines.push('#   GATEWAY_BASE_URL — e.g. http://localhost:8081');
  lines.push('#   PROJECT_ID       — the workspace project UUID');
  lines.push('#   RUN_ID           — the migration execution run whose registered');
  lines.push('#                      source/target DB credentials the gateway holds');
  lines.push('#                      (register at Migrate confirm / baseline drift watch)');
  lines.push('#');
  lines.push('# Exit codes: 0 = sync clean; 2 = attention (errors / open decisions /');
  lines.push('#             dispatch refused) — inspect the printed report.');
  lines.push('');
  lines.push('set -euo pipefail');
  lines.push(': "${GATEWAY_BASE_URL:?GATEWAY_BASE_URL must be set}"');
  lines.push(': "${PROJECT_ID:?PROJECT_ID must be set}"');
  lines.push(': "${RUN_ID:?RUN_ID must be set}"');
  lines.push('');
  lines.push('resp="$(curl -sS -X POST \\');
  lines.push(
    '  "${GATEWAY_BASE_URL}/api/v1/projects/${PROJECT_ID}/migration-execution-runs/${RUN_ID}/run-incremental-sync" \\'
  );
  lines.push("  -H 'Content-Type: application/json' -d '{}')\"");
  lines.push('echo "${resp}"');
  lines.push('status="$(printf \'%s\' "${resp}" | sed -n \'s/.*"status":"\\([a-z_]*\\)".*/\\1/p\' | head -1)"');
  lines.push('if [ "${status}" = "clean" ]; then');
  lines.push('  echo "sync CLEAN"');
  lines.push('  exit 0');
  lines.push('fi');
  lines.push('echo "sync ATTENTION (status=${status:-unknown}) — see the report above"');
  lines.push('exit 2');
  lines.push('');
  lines.push('# ---------------------------------------------------------------------');
  lines.push('# Per-table posture at pack-generation time (the LIVE truth is the');
  lines.push("# manifest's sync.tables section + the run report):");
  if (synced.length === 0) {
    lines.push('#   (no keyed tables)');
  } else {
    lines.push(`#   keyed tables (${synced.length}):`);
    for (const s of synced) {
      lines.push(`#     ${s.table}  key=${s.deltaKey ?? '?'}  ${s.strategy}`);
    }
  }
  if (fullReload.length > 0) {
    lines.push(`#   full-reload tables (${fullReload.length}) — the delete-catching mechanism:`);
    for (const s of fullReload) lines.push(`#     ${s.table}`);
  }
  if (pending.length > 0) {
    lines.push(`#   BLOCKED (${pending.length}) — open delta-key decision, NOT synced until resolved:`);
    for (const s of pending) {
      lines.push(`#     ${s.table}  (resolve delta_key--${s.table} in the pack decision queue)`);
    }
  }
  lines.push('#');
  lines.push(`# Reference SQL for a manual audit: ${RECONCILIATION_SQL_PATH} +`);
  lines.push(`# ${RECONCILIATION_REPORT_PATH}; the state table DDL is ${SYNC_STATE_PATH}`);
  lines.push('# (the AMVS runner creates it automatically when absent).');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// reconcile/reconciliation.sql
// ---------------------------------------------------------------------------

export function emitReconciliationSql(args: {
  tableOrder: string[];
  strategies: DeltaStrategy[];
}): string {
  const keyByTable = new Map(args.strategies.map((s) => [s.table, s.deltaKey]));
  const lines: string[] = [];
  lines.push(`-- ${RECONCILIATION_SQL_PATH}`);
  lines.push('-- Per-run reconciliation queries. Run the PostgreSQL section on the');
  lines.push('-- TARGET and the Sybase section on the SOURCE; feed both CSV outputs to');
  lines.push(`-- ${RECONCILIATION_REPORT_PATH} to produce the drift report.`);
  lines.push('-- v1 compares per-table ROW COUNTS plus max(delta_key) where a key');
  lines.push('-- exists; value checksums are a manual escalation (engine hash functions');
  lines.push('-- are not cross-comparable without a canonicalisation step).');
  lines.push('');
  lines.push('-- ===== PostgreSQL (TARGET) — psql -qAt -F, ===== ');
  for (const qn of args.tableOrder) {
    const key = keyByTable.get(qn) ?? null;
    // Target-side statements QUOTE every identifier (source case preserved),
    // matching the quoted DDL (2026-08-07): the unquoted form silently
    // lower-cased mixed-case tables/columns and the reconciliation query
    // failed — or worse, hit a different relation.
    const quotedQn = qn
      .split('.')
      .map((part) => quoteIdent(part))
      .join('.');
    const maxExpr = key ? `max(${quoteIdent(key)})::text` : 'NULL';
    lines.push(
      `SELECT '${qn}', count(*)::text, ${maxExpr} FROM ${quotedQn};`
    );
  }
  lines.push('');
  lines.push('-- ===== Sybase ASE (SOURCE) — isql, same column order =====');
  for (const qn of args.tableOrder) {
    const key = keyByTable.get(qn) ?? null;
    const maxExpr = key ? `convert(varchar(40), max(${key}))` : 'NULL';
    lines.push(`SELECT '${qn}', convert(varchar(20), count(*)), ${maxExpr} FROM ${qn}`);
    lines.push('go');
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// reconcile/build-report.sh
// ---------------------------------------------------------------------------

export function emitReconciliationReportBuilder(): string {
  return [
    '#!/usr/bin/env bash',
    `# ${RECONCILIATION_REPORT_PATH} — merge the source/target reconciliation CSVs`,
    '# into a per-run markdown drift report. Usage:',
    '#   build-report.sh <staging_dir> <run_stamp>',
    '# Expects <staging_dir>/source-counts.csv and <staging_dir>/target-counts.csv',
    '# (table,count,max_key per line — the reconciliation.sql output).',
    '# Exit 0 = zero drift; exit 2 = drift found (gate your cutover on this).',
    '',
    'set -euo pipefail',
    'STAGING_DIR="${1:?staging dir}"; RUN_STAMP="${2:?run stamp}"',
    'SRC="${STAGING_DIR}/source-counts.csv"; TGT="${STAGING_DIR}/target-counts.csv"',
    'OUT="${STAGING_DIR}/reconciliation-${RUN_STAMP}.md"',
    'drift=0',
    '{',
    '  echo "# Reconciliation report ${RUN_STAMP}"',
    '  echo',
    '  echo "| table | source rows | target rows | source max key | target max key | status |"',
    '  echo "|---|---|---|---|---|---|"',
    '  while IFS=, read -r table s_count s_max; do',
    '    t_line="$(grep -m1 "^${table}," "${TGT}" || true)"',
    '    t_count="$(echo "${t_line}" | cut -d, -f2)"',
    '    t_max="$(echo "${t_line}" | cut -d, -f3)"',
    '    status="ok"',
    '    if [ "${s_count}" != "${t_count}" ] || [ "${s_max}" != "${t_max}" ]; then',
    '      status="DRIFT"; drift=1',
    '    fi',
    '    echo "| ${table} | ${s_count} | ${t_count:-<missing>} | ${s_max} | ${t_max:-<missing>} | ${status} |"',
    '  done < "${SRC}"',
    '} > "${OUT}"',
    'echo "report: ${OUT}"',
    'if [ "${drift}" -ne 0 ]; then echo "DRIFT FOUND"; exit 2; fi',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// cutover/swap-over-runbook.md
// ---------------------------------------------------------------------------

export function emitSwapOverRunbook(args: {
  sourceEngine: string;
  targetEngine: string;
  sequences: IrSequence[];
  scheduledJobs: string[];
  pendingDecisionTables: string[];
}): string {
  const lines: string[] = [];
  lines.push('# Swap-over runbook (persistence tier)');
  lines.push('');
  lines.push(
    `One-way side-by-side migration ${args.sourceEngine} → ${args.targetEngine}. ` +
      'Run this ordered checklist inside the agreed cutover window. Every gate is ' +
      'mechanical — do not proceed past a failed gate.'
  );
  lines.push('');
  if (args.pendingDecisionTables.length > 0) {
    lines.push(
      `> **BLOCKED**: ${args.pendingDecisionTables.length} table(s) still await a ` +
        `delta-key decision and are NOT covered by the daily sync: ` +
        `${args.pendingDecisionTables.join(', ')}. Resolve + regenerate before scheduling swap-over.`
    );
    lines.push('');
  }
  lines.push('1. **Freeze source writes** (application maintenance mode / revoke app logins).');
  lines.push(
    `2. **Final delta**: run \`${SYNC_RUNNER_PATH}\` one last time inside the window.`
  );
  lines.push(
    `3. **Zero-drift gate**: \`${RECONCILIATION_REPORT_PATH}\` must exit 0. A DRIFT exit blocks the swap.`
  );
  lines.push(
    `4. **Seed sequences/identities**: apply the post-load Liquibase context (\`${SEQUENCES_SEED_CHANGESET_PATH}\`) ` +
      `NOW — not at bulk load; the source high-water advanced during side-by-side running` +
      (args.sequences.length > 0
        ? ` (${args.sequences.length} sequence(s)/identities recorded in the pack).`
        : '.')
  );
  if (args.scheduledJobs.length > 0) {
    lines.push(
      `5. **Re-home scheduled jobs** ([decision:db.jobsRehoming]): enable on the target, disable the source originals — no job may run twice: ${args.scheduledJobs.join(', ')}.`
    );
  } else {
    lines.push('5. **Scheduled jobs**: none recorded in the pack manifest.');
  }
  lines.push('6. **Switch connection strings** to the target and lift maintenance mode.');
  lines.push(
    "7. **Verify**: the pack's expected-schema diff is green against the live target; " +
      'run one more reconciliation pass (should be trivially clean with the source frozen); ' +
      'smoke the API reconciliation loop.'
  );
  lines.push(
    '8. **Keep the source read-only** for the agreed fallback period before decommission planning.'
  );
  lines.push('');
  return lines.join('\n');
}
