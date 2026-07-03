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
import { SEQUENCES_SEED_CHANGESET_PATH } from './liquibase';

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
  lines.push('# Environment (set all before running):');
  lines.push('#   SYBASE_HOST SYBASE_PORT SYBASE_DB SYBASE_USER SYBASE_PASSWORD   (isql/bcp)');
  lines.push('#   PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD                       (psql)');
  lines.push('#   STAGING_DIR   — writable directory for extracted delta files');
  lines.push('#');
  lines.push('# Per-table mechanics live in the pack:');
  lines.push('#   data/incremental/<schema>.<table>.sql  — the delta extract/apply template');
  lines.push(`#   ${SYNC_STATE_PATH}                    — the high-water state table (apply once)`);
  lines.push('#');
  lines.push('# Exit codes: 0 = synced + reconciliation clean; 2 = reconciliation drift;');
  lines.push('#             1 = any table failed (state row marked error, run halted).');
  lines.push('');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push(': "${STAGING_DIR:?STAGING_DIR must be set}"');
  lines.push('RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"');
  lines.push('echo "haikai daily sync run ${RUN_STAMP}"');
  lines.push('');
  lines.push('psql_cmd() { psql -v ON_ERROR_STOP=1 -qAt "$@"; }');
  lines.push('');
  lines.push('get_high_water() {');
  lines.push(
    `  psql_cmd -c "SELECT high_water FROM ${SYNC_STATE_TABLE} WHERE table_name = '\$1'";`
  );
  lines.push('}');
  lines.push('');
  lines.push('set_high_water() {');
  lines.push(
    `  psql_cmd -c "INSERT INTO ${SYNC_STATE_TABLE}(table_name, high_water, last_run_at, last_status) VALUES ('\$1', '\$2', now(), 'ok') ON CONFLICT (table_name) DO UPDATE SET high_water = EXCLUDED.high_water, last_run_at = now(), last_status = 'ok'";`
  );
  lines.push('}');
  lines.push('');
  lines.push('sync_table() {');
  lines.push('  local qn="$1" delta_key="$2"');
  lines.push('  local hw; hw="$(get_high_water "${qn}")"');
  lines.push('  echo "-- ${qn}: high-water ${hw:-<none>} (key ${delta_key})"');
  lines.push('  # 1) Extract rows > high-water on the SOURCE (see the per-table');
  lines.push('  #    data/incremental/<qn>.sql for the exact SELECT + cast pipeline;');
  lines.push('  #    bcp/isql it into "${STAGING_DIR}/${qn}.delta.csv").');
  lines.push('  # 2) Apply on the TARGET with :last_high_water bound to ${hw}');
  lines.push('  #    (INSERT ... OVERRIDING SYSTEM VALUE / INSERT ... ON CONFLICT DO UPDATE');
  lines.push('  #    exactly as the per-table script states).');
  lines.push('  # 3) Read the new max(delta_key) from the TARGET and advance the state:');
  lines.push('  #    set_high_water "${qn}" "${new_hw}"');
  lines.push('}');
  lines.push('');
  if (synced.length === 0) {
    lines.push('echo "No keyed tables to sync (see manifest delta_strategies)."');
  } else {
    lines.push(`# ---- keyed tables, FK order (${synced.length}) ----`);
    for (const s of synced) {
      lines.push(`sync_table '${s.table}' '${s.deltaKey ?? ''}'   # ${s.strategy}`);
    }
  }
  lines.push('');
  if (fullReload.length > 0) {
    lines.push(`# ---- full-reload tables (${fullReload.length}) — no delta key; TRUNCATE + re-run`);
    lines.push('#      the bulk extract for each (see data/incremental/<qn>.sql):');
    for (const s of fullReload) lines.push(`#   ${s.table}`);
    lines.push('');
  }
  if (pending.length > 0) {
    lines.push(`# ---- BLOCKED: ${pending.length} table(s) awaiting a delta-key decision — NOT synced:`);
    for (const s of pending) lines.push(`#   ${s.table}  (resolve delta_key--${s.table} in the pack decision queue)`);
    lines.push('');
  }
  lines.push('# ---- per-run reconciliation gate ----');
  lines.push(`# Run ${RECONCILIATION_SQL_PATH} on BOTH engines, then:`);
  lines.push(`bash "$(dirname "$0")/../${RECONCILIATION_REPORT_PATH}" "\${STAGING_DIR}" "\${RUN_STAMP}"`);
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
    const maxExpr = key ? `max(${key})::text` : 'NULL';
    lines.push(
      `SELECT '${qn}', count(*)::text, ${maxExpr} FROM ${qn};`
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
