/**
 * Schema-apply runner (WS2 DB-plane execution chain, 2026-07-31).
 *
 * Executes the DB pack's Liquibase-formatted changesets against the live
 * target Postgres, phase by phase:
 *
 *   contexts=["structural"]  — schemas + per-table CREATEs (before the load);
 *   contexts=["post-load"]  — FKs + indexes + sequence reseed (after it).
 *
 * This revisits the plane reframe's "schema-apply is deployment-level only"
 * decision (user-approved 2026-07-31): a native stage-1 run has no
 * deploy-compose boot, so the pack's schema NEVER reached the database — the
 * run "just ran the 15 specs". The runner is Liquibase-lite: the master
 * changelog's include order is the apply order, and applied changeset ids are
 * recorded in `haikai_schema_apply_log` on the TARGET so re-runs skip work
 * already done (each changeset applies inside its own transaction together
 * with its log row).
 *
 * Credentials posture (same as the data-migration route): the caller passes
 * target creds in the request; they live in function scope only, are never
 * logged and never persisted.
 */

import { createHash } from 'crypto';

import {
  ParsedChangeset,
  normalisePackPath,
  parseFormattedSql,
  parseMasterIncludes,
} from './formattedSql';

export interface SchemaApplyFile {
  path: string;
  content: string;
}

export interface SchemaApplyPlan {
  /** Changesets to execute, in master-changelog order. */
  plan: ParsedChangeset[];
  /** Structural problems (missing master, unresolved includes). */
  issues: string[];
  /** Total changesets seen before the context filter (observability). */
  totalParsed: number;
}

/**
 * Build the ordered apply plan from the posted pack files. A changeset with
 * NO declared context matches any requested phase (Liquibase semantics).
 */
export function buildApplyPlan(
  files: SchemaApplyFile[],
  contexts: string[],
  masterPath?: string
): SchemaApplyPlan {
  const issues: string[] = [];
  const byPath = new Map(files.map((f) => [normalisePackPath(f.path), f]));

  const master =
    (masterPath ? byPath.get(normalisePackPath(masterPath)) : undefined) ??
    files.find((f) => f.path.endsWith('db.changelog-master.xml'));
  if (!master) {
    return { plan: [], issues: ['no db.changelog-master.xml among the posted files'], totalParsed: 0 };
  }

  const wanted = new Set(contexts);
  const plan: ParsedChangeset[] = [];
  let totalParsed = 0;
  for (const includePath of parseMasterIncludes(master.content, master.path)) {
    const file = byPath.get(includePath);
    if (!file) {
      issues.push(`master changelog includes '${includePath}' but it is not among the posted files`);
      continue;
    }
    const changesets = parseFormattedSql(file.path, file.content);
    totalParsed += changesets.length;
    if (changesets.length === 0) {
      issues.push(`${file.path}: no --changeset headers found (not formatted SQL?)`);
      continue;
    }
    for (const cs of changesets) {
      if (cs.context === null || wanted.has(cs.context)) plan.push(cs);
    }
  }
  return { plan, issues, totalParsed };
}

/** The minimal pg-client surface the executor needs (injected in tests). */
export interface SqlExecutor {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface SchemaApplyResult {
  applied: string[];
  skipped: string[];
  failed: { id: string; filePath: string; error: string } | null;
}

const LOG_TABLE = 'haikai_schema_apply_log';

/** Body checksum recorded per applied changeset (Liquibase-style validation). */
function bodyChecksum(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Execute the plan. Each changeset runs as `BEGIN; <body>; INSERT log; COMMIT`
 * so a failure rolls the changeset AND its log row back together; execution
 * stops at the first failure (the chain halts the run with the changeset id).
 *
 * Checksum validation (gold standard 2026-08-07): the skip decision was
 * id-ONLY, so a changeset whose BODY changed under an unchanged id silently
 * skipped — the live schema and the pack drift apart with zero signal. The
 * log now records a sha256 body checksum; a skip whose stored checksum
 * differs from the current body is a LOUD failure telling the author to cut
 * a NEW changeset for the delta. Rows logged by pre-checksum runners (NULL
 * checksum) adopt the current body's checksum on first sight — id-match was
 * their era's whole trust basis, and adopting pins them from now on.
 */
export async function runSchemaApply(
  plan: ParsedChangeset[],
  exec: SqlExecutor
): Promise<SchemaApplyResult> {
  await exec.query(
    `CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (` +
      `changeset_id text PRIMARY KEY, checksum text, ` +
      `applied_at timestamptz NOT NULL DEFAULT now())`
  );
  // Legacy log tables predate the checksum column.
  await exec.query(`ALTER TABLE ${LOG_TABLE} ADD COLUMN IF NOT EXISTS checksum text`);
  const alreadyChecksum = new Map<string, string | null>(
    (await exec.query(`SELECT changeset_id, checksum FROM ${LOG_TABLE}`)).rows.map((r) => [
      String(r.changeset_id),
      r.checksum === null || r.checksum === undefined ? null : String(r.checksum),
    ])
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const cs of plan) {
    const currentChecksum = bodyChecksum(cs.body);
    if (alreadyChecksum.has(cs.id)) {
      const stored = alreadyChecksum.get(cs.id) ?? null;
      if (stored === null) {
        // Pre-checksum log row: adopt the current body as the pinned truth.
        await exec.query(
          `UPDATE ${LOG_TABLE} SET checksum = ${sqlString(currentChecksum)} ` +
            `WHERE changeset_id = ${sqlString(cs.id)} AND checksum IS NULL`
        );
        skipped.push(cs.id);
        continue;
      }
      if (stored !== currentChecksum) {
        return {
          applied,
          skipped,
          failed: {
            id: cs.id,
            filePath: cs.filePath,
            error:
              `changeset '${cs.id}' was already applied with a DIFFERENT body ` +
              `(applied checksum ${stored.slice(0, 12)}…, pack checksum ${currentChecksum.slice(0, 12)}…) — ` +
              `the pack changed under an applied changeset; author a NEW changeset id for the ` +
              `delta instead of editing an applied one`,
          },
        };
      }
      skipped.push(cs.id);
      continue;
    }
    try {
      await exec.query('BEGIN');
      if (cs.body.trim() !== '') {
        await exec.query(cs.body);
      }
      await exec.query(
        `INSERT INTO ${LOG_TABLE} (changeset_id, checksum) ` +
          `VALUES (${sqlString(cs.id)}, ${sqlString(currentChecksum)})`
      );
      await exec.query('COMMIT');
      applied.push(cs.id);
    } catch (err) {
      await exec.query('ROLLBACK').catch(() => undefined);
      return {
        applied,
        skipped,
        failed: {
          id: cs.id,
          filePath: cs.filePath,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
  return { applied, skipped, failed: null };
}
