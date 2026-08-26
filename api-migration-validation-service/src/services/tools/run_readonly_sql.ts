import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { assertReadonlySelect, SqlGuardError } from '../db/sqlGuard';

/**
 * Tool: `run_readonly_sql`
 *
 * Run a single ad-hoc SELECT against the session DB. Statement parsing is
 * done UP-FRONT here (cheap reject, gives the LLM a clean error before we
 * reach the adapter), and AGAIN inside `DbAdapter.runReadonlySelect`
 * (defence in depth -- direct adapter callers bypass this tool).
 *
 * The spec's regex literal -- `INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|
 * TRUNCATE|EXEC|CALL|GRANT|REVOKE|CREATE|;.*;` -- is implemented by
 * `assertReadonlySelect` (FORBIDDEN_KEYWORDS list + multi-statement check).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_TIMEOUT_SECONDS = 5;

const handler: ToolHandler = async (args, ctx) => {
  if (!ctx.dbAdapter) {
    throw new ToolValidationError(
      'run_readonly_sql',
      'no_db_configured',
      'No DB adapter is configured for this capture session.',
    );
  }
  const sql = typeof args.sql === 'string' ? args.sql : null;
  if (!sql) {
    throw new ToolValidationError(
      'run_readonly_sql',
      'missing_sql',
      '`sql` is required and must be a string.',
    );
  }
  const params = Array.isArray(args.params) ? (args.params as unknown[]) : [];

  // Up-front guard so non-SELECT input is rejected cleanly without ever
  // touching the DB adapter (the adapter will also reject -- defence in
  // depth -- but doing it here means we don't spin up a connection only
  // to throw).
  try {
    assertReadonlySelect(sql);
  } catch (err) {
    if (err instanceof SqlGuardError) {
      throw new ToolValidationError(
        'run_readonly_sql',
        err.reason,
        err.message,
      );
    }
    throw err;
  }

  const sessionDbConfig = ctx.session.dbConfigRedactedJson;
  const limits = {
    maxRows: sessionDbConfig?.maxRowsPerQuery ?? DEFAULT_MAX_ROWS,
    timeoutSeconds: sessionDbConfig?.queryTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
  };

  const result = await ctx.dbAdapter.runReadonlySelect(sql, params, limits);
  return {
    rowCount: result.rowCount,
    truncated: result.truncated,
    rows: result.rows,
  };
};

export const runReadonlySqlTool: ToolRegistryEntry = {
  name: 'run_readonly_sql',
  description:
    'Run a single SELECT (or WITH ... SELECT) statement bounded by the session row/timeout limits. Multi-statement input and any non-SELECT keyword is rejected.',
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'A single SELECT statement. WITH/CTE prefix allowed; everything else rejected.',
      },
      params: {
        type: 'array',
        items: {},
        description: 'Optional positional parameters for the SELECT.',
      },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  handler,
  research: true,
};
