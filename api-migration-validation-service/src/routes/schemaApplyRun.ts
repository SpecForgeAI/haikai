/**
 * Schema-apply run route — WS2 DB-plane execution chain (2026-07-31).
 *
 *   POST /api/schema-apply/run
 *
 * Applies the DB pack's Liquibase-formatted changesets to the live target
 * Postgres in master-changelog order, filtered by phase contexts:
 * `["structural"]` before the bulk load, `["post-load"]` after it. Applied
 * changeset ids are tracked in `haikai_schema_apply_log` on the target, so a
 * re-run skips already-applied work (Liquibase-lite idempotency).
 *
 * Credentials arrive in the request body, live in function scope for THIS
 * invocation only, are never logged and never persisted — the same posture
 * as the data-migration run route.
 *
 * Body (snake_case wire):
 * {
 *   project_id, architecture_id?,
 *   target_db: { db_type: 'postgres', host, port, database, schema?, username, password },
 *   files: [{ path, content }],       // the pack's liquibase master + changesets
 *   contexts: ['structural'] | ['post-load'] | ['structural','post-load'],
 *   master_path?,                      // default: the file ending db.changelog-master.xml
 *   timeout_seconds?                   // per-statement timeout (default 300)
 * }
 */
import { Router, Request, Response } from 'express';
import { Pool, PoolConfig } from 'pg';
import {
  buildApplyPlan,
  runSchemaApply,
  SchemaApplyFile,
} from '../services/schemaApply/schemaApplyRunner';
import { createTracer } from '../trace';

const trace = createTracer('schema-apply');

// Raised 300s -> 6h (2026-08-11): the POST-LOAD context builds indexes and
// validates FKs over fully-loaded tables — on real volumes that is hours of
// legitimate engine work, and 300s guaranteed a mid-DDL abort. The env
// valve remains for operators who want a tighter budget.
const DEFAULT_TIMEOUT_SECONDS = Number(process.env.SCHEMA_APPLY_TIMEOUT_SECONDS ?? 21_600);
const KNOWN_CONTEXTS = new Set(['structural', 'post-load']);

interface DbBlock {
  db_type?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

interface RunBody {
  project_id?: string;
  architecture_id?: string;
  target_db?: DbBlock;
  files?: Array<{ path?: string; content?: string }>;
  contexts?: string[];
  master_path?: string;
  timeout_seconds?: number;
}

function targetDbError(block: DbBlock | undefined): string | null {
  if (!block) return 'target_db is required';
  if (block.db_type !== 'postgres') return "target_db.db_type must be 'postgres'";
  for (const field of ['host', 'database', 'username', 'password'] as const) {
    if (!block[field] || typeof block[field] !== 'string') {
      return `target_db.${field} is required`;
    }
  }
  if (typeof block.port !== 'number' || !Number.isFinite(block.port)) {
    return 'target_db.port is required';
  }
  return null;
}

export function buildSchemaApplyRunRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post('/api/schema-apply/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RunBody;
    if (!body.project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }
    const dbError = targetDbError(body.target_db);
    if (dbError) return res.status(400).json({ error: dbError });

    const files: SchemaApplyFile[] = (body.files ?? [])
      .filter((f): f is { path: string; content: string } =>
        typeof f?.path === 'string' && typeof f?.content === 'string')
      .map((f) => ({ path: f.path, content: f.content }));
    if (files.length === 0) {
      return res.status(400).json({ error: 'files (the pack liquibase file set) is required' });
    }

    const contexts = (body.contexts ?? []).filter((c) => KNOWN_CONTEXTS.has(c));
    if (contexts.length === 0) {
      return res.status(400).json({
        error: "contexts is required (any of 'structural', 'post-load')",
      });
    }

    const { plan, issues, totalParsed } = buildApplyPlan(files, contexts, body.master_path);
    if (issues.length > 0) {
      // Unresolved includes = the pack is not runnable; refuse before touching
      // the database (the same class the assembly validation catches earlier).
      return res.status(422).json({ error: 'the pack file set is not runnable', issues });
    }
    if (plan.length === 0) {
      return res.status(422).json({
        error: `no changesets match contexts [${contexts.join(', ')}]`,
        total_parsed: totalParsed,
      });
    }

    const corr = { project: body.project_id, arch: body.architecture_id };
    trace.step(
      `schema apply — ${plan.length} changeset(s), contexts=${contexts.join(',')}`,
      corr
    );

    // Credentials: function scope only — never logged, never persisted.
    const db = body.target_db!;
    const poolConfig: PoolConfig = {
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.username,
      password: db.password,
      max: 1,
      application_name: 'haikai-schema-apply',
      connectionTimeoutMillis: 10000,
    };
    const pool = new Pool(poolConfig);
    const timeoutMs = Math.max(1, body.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

    try {
      const client = await pool.connect();
      try {
        await client.query(`SET statement_timeout = ${timeoutMs}`);
        const result = await runSchemaApply(plan, client);
        if (result.failed) {
          trace.fail(
            `schema apply FAILED at ${result.failed.id} (${result.failed.filePath}): ` +
              result.failed.error.slice(0, 200),
            corr
          );
          return res.status(500).json({
            error: 'schema-apply failed',
            failed_changeset: result.failed,
            summary: {
              contexts,
              planned: plan.length,
              applied: result.applied.length,
              skipped: result.skipped.length,
            },
            applied_ids: result.applied,
          });
        }
        trace.ok(
          `schema apply COMPLETED — applied=${result.applied.length} skipped=${result.skipped.length}`,
          corr
        );
        return res.status(200).json({
          summary: {
            contexts,
            planned: plan.length,
            applied: result.applied.length,
            skipped: result.skipped.length,
          },
          applied_ids: result.applied,
          skipped_ids: result.skipped,
        });
      } finally {
        client.release();
      }
    } catch (err) {
      trace.fail(
        `schema apply errored: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        corr
      );
      return res.status(500).json({
        error: 'schema-apply run failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : 'unknown',
      });
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  return router;
}

/**
 * POST /api/schema-apply/drift-check — expected-schema vs LIVE-target diff
 * (gold-standard C4, 2026-08-07). The swap-over runbook gates on "the pack's
 * expected-schema diff is green against the live target" — this is that
 * capability (it did not exist before). Reads the target catalogs and diffs:
 *   - tables + columns present (with identity flags),
 *   - primary_key / unique_constraint / foreign_key / index / check_constraint NAMES,
 *   - identity/sequence-backed columns.
 * Body: { project_id, target_db, manifest } (the pack main manifest with
 * expected_schema). Never throws; a catalog failure is a structured
 * unverifiable drift row. Credentials are function-scope only.
 */
export interface SchemaDriftRow {
  kind:
    | 'missing_table'
    | 'missing_column'
    | 'identity_mismatch'
    | 'missing_constraint'
    | 'missing_index'
    | 'unverifiable';
  table: string;
  detail: string;
}

interface DriftBody {
  project_id?: string;
  target_db?: DbBlock;
  manifest?: unknown;
}

export function buildSchemaDriftRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post('/api/schema-apply/drift-check', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as DriftBody;
    if (!body.project_id) return res.status(400).json({ error: 'project_id is required' });
    const targetError = targetDbError(body.target_db);
    if (targetError) return res.status(400).json({ error: targetError });
    const es = (body.manifest as { expected_schema?: unknown } | undefined)?.expected_schema as
      | {
          tables?: Array<{ schemaName?: string; tableName?: string }>;
          columns?: Array<{
            schemaName?: string;
            tableName?: string;
            columnName?: string;
            isIdentity?: boolean;
          }>;
          keysAndIndexes?: Array<{
            schemaName?: string;
            tableName?: string;
            kind?: string;
            name?: string;
          }>;
        }
      | undefined;
    if (!es || !Array.isArray(es.tables)) {
      return res
        .status(400)
        .json({ error: 'manifest.expected_schema (tables/columns/keysAndIndexes) is required' });
    }

    const db = body.target_db!;
    const poolConfig: PoolConfig = {
      host: db.host,
      port: db.port,
      database: db.database,
      user: db.username,
      password: db.password,
      max: 2,
      application_name: 'haikai-schema-drift-check',
      connectionTimeoutMillis: 10000,
    };
    const pool = new Pool(poolConfig);
    const drifts: SchemaDriftRow[] = [];
    try {
      const liveTables = new Set<string>(
        (
          await pool.query(
            `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE'`,
          )
        ).rows.map(
          (r: { table_schema: string; table_name: string }) => `${r.table_schema}.${r.table_name}`,
        ),
      );
      const liveColumns = new Map<string, { isIdentity: boolean }>();
      for (const r of (
        await pool.query(
          `SELECT table_schema, table_name, column_name, is_identity FROM information_schema.columns`,
        )
      ).rows as Array<{
        table_schema: string;
        table_name: string;
        column_name: string;
        is_identity: string;
      }>) {
        liveColumns.set(`${r.table_schema}.${r.table_name}.${r.column_name}`, {
          isIdentity: r.is_identity === 'YES',
        });
      }
      const liveConstraints = new Set<string>(
        (
          await pool.query(
            `SELECT n.nspname AS s, cl.relname AS t, c.conname AS n2 FROM pg_constraint c ` +
              `JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace ` +
              `WHERE c.contype IN ('p','u','c','f')`,
          )
        ).rows.map((r: { s: string; t: string; n2: string }) => `${r.s}.${r.t}.${r.n2}`),
      );
      const liveIndexes = new Set<string>(
        (
          await pool.query(`SELECT schemaname AS s, tablename AS t, indexname AS n2 FROM pg_indexes`)
        ).rows.map((r: { s: string; t: string; n2: string }) => `${r.s}.${r.t}.${r.n2}`),
      );

      for (const tbl of es.tables) {
        if (!tbl.schemaName || !tbl.tableName) continue;
        const qn = `${tbl.schemaName}.${tbl.tableName}`;
        if (!liveTables.has(qn)) {
          drifts.push({ kind: 'missing_table', table: qn, detail: `expected table ${qn} is absent` });
        }
      }
      for (const col of es.columns ?? []) {
        if (!col.schemaName || !col.tableName || !col.columnName) continue;
        const qn = `${col.schemaName}.${col.tableName}`;
        if (!liveTables.has(qn)) continue; // already reported
        const live = liveColumns.get(`${qn}.${col.columnName}`);
        if (!live) {
          drifts.push({
            kind: 'missing_column',
            table: qn,
            detail: `expected column ${col.columnName} is absent`,
          });
        } else if ((col.isIdentity === true) !== live.isIdentity) {
          drifts.push({
            kind: 'identity_mismatch',
            table: qn,
            detail:
              `column ${col.columnName}: expected isIdentity=${col.isIdentity === true} ` +
              `but the live column is ${live.isIdentity ? '' : 'NOT '}identity — sequence ` +
              `backing differs`,
          });
        }
      }
      for (const k of es.keysAndIndexes ?? []) {
        if (!k.schemaName || !k.tableName || !k.name || !k.kind) continue;
        // Foreign keys verify like every other constraint (2026-08-08 —
        // the initial skip was an unauthorised deferral): presence by name
        // in pg_constraint contype='f'.
        const qn = `${k.schemaName}.${k.tableName}`;
        if (!liveTables.has(qn)) continue;
        const ref = `${qn}.${k.name}`;
        if (k.kind === 'index') {
          if (!liveIndexes.has(ref)) {
            drifts.push({
              kind: 'missing_index',
              table: qn,
              detail: `expected index ${k.name} is absent`,
            });
          }
        } else if (!liveConstraints.has(ref) && !liveIndexes.has(ref)) {
          // pk/unique are index-backed; either catalog satisfies.
          drifts.push({
            kind: 'missing_constraint',
            table: qn,
            detail: `expected ${k.kind} '${k.name}' is absent`,
          });
        }
      }

      return res.status(200).json({
        drifts,
        summary: {
          status: drifts.length === 0 ? 'clean' : 'drift',
          drift_count: drifts.length,
          tables_checked: es.tables.length,
        },
      });
    } catch (err) {
      drifts.push({
        kind: 'unverifiable',
        table: '*',
        detail: `catalog read failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
      });
      return res.status(200).json({
        drifts,
        summary: { status: 'drift', drift_count: drifts.length, tables_checked: 0 },
      });
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  return router;
}

export const schemaDriftRouter = buildSchemaDriftRouter();

export const schemaApplyRunRouter = buildSchemaApplyRunRouter();
