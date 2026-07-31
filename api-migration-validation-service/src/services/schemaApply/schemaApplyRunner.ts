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

import { ParsedChangeset, parseFormattedSql, parseMasterIncludes } from './formattedSql';

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
  const byPath = new Map(files.map((f) => [normalise(f.path), f]));

  const master =
    (masterPath ? byPath.get(normalise(masterPath)) : undefined) ??
    files.find((f) => f.path.endsWith('db.changelog-master.xml'));
  if (!master) {
    return { plan: [], issues: ['no db.changelog-master.xml among the posted files'], totalParsed: 0 };
  }

  const wanted = new Set(contexts);
  const plan: ParsedChangeset[] = [];
  let totalParsed = 0;
  for (const includePath of parseMasterIncludes(master.content, normalise(master.path))) {
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

function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
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

/**
 * Execute the plan. Each changeset runs as `BEGIN; <body>; INSERT log; COMMIT`
 * so a failure rolls the changeset AND its log row back together; execution
 * stops at the first failure (the chain halts the run with the changeset id).
 */
export async function runSchemaApply(
  plan: ParsedChangeset[],
  exec: SqlExecutor
): Promise<SchemaApplyResult> {
  await exec.query(
    `CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (` +
      `changeset_id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  const already = new Set<string>(
    (await exec.query(`SELECT changeset_id FROM ${LOG_TABLE}`)).rows.map((r) =>
      String(r.changeset_id)
    )
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const cs of plan) {
    if (already.has(cs.id)) {
      skipped.push(cs.id);
      continue;
    }
    try {
      await exec.query('BEGIN');
      if (cs.body.trim() !== '') {
        await exec.query(cs.body);
      }
      await exec.query(
        `INSERT INTO ${LOG_TABLE} (changeset_id) VALUES ('${cs.id.replace(/'/g, "''")}')`
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
