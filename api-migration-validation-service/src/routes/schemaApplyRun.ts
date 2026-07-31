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

const DEFAULT_TIMEOUT_SECONDS = Number(process.env.SCHEMA_APPLY_TIMEOUT_SECONDS ?? 300);
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

export const schemaApplyRunRouter = buildSchemaApplyRunRouter();
