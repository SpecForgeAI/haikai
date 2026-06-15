import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';

/**
 * Tool: `sample_db_values`
 *
 * Sample distinct values from a single column via `DbAdapter.sampleValues`.
 * Row + timeout limits come from the session config (defaults 100 rows / 5s
 * if unset). The DbAdapter handles identifier quoting; the SELECT-only
 * guard fires inside `runReadonlySelect` which `sampleValues` calls
 * internally.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const DEFAULT_SAMPLE_ROWS = 100;
const DEFAULT_TIMEOUT_SECONDS = 5;

const handler: ToolHandler = async (args, ctx) => {
  if (!ctx.dbAdapter) {
    throw new ToolValidationError(
      'sample_db_values',
      'no_db_configured',
      'No DB adapter is configured for this capture session.',
    );
  }
  const table = typeof args.table === 'string' ? args.table : null;
  const column = typeof args.column === 'string' ? args.column : null;
  const schema = typeof args.schema === 'string' ? args.schema : null;
  if (!table || !column) {
    throw new ToolValidationError(
      'sample_db_values',
      'missing_args',
      '`table` and `column` are required.',
    );
  }

  // Allowlist enforcement -- table must appear in session allowlistTables
  // when set. Schema same. Empty allowlists are treated as "no constraint"
  // (the wizard would not have collected DB config in that case).
  const sessionDbConfig = ctx.session.dbConfigRedactedJson;
  const allowedTables = sessionDbConfig?.allowlistTables ?? null;
  const allowedSchemas = sessionDbConfig?.allowlistSchemas ?? null;
  if (allowedTables && allowedTables.length > 0 && !allowedTables.includes(table)) {
    throw new ToolValidationError(
      'sample_db_values',
      'table_not_in_allowlist',
      `Table '${table}' is not in the session allowlist.`,
    );
  }
  if (schema && allowedSchemas && allowedSchemas.length > 0 && !allowedSchemas.includes(schema)) {
    throw new ToolValidationError(
      'sample_db_values',
      'schema_not_in_allowlist',
      `Schema '${schema}' is not in the session allowlist.`,
    );
  }

  const limits = {
    maxRows: sessionDbConfig?.maxRowsPerQuery ?? DEFAULT_SAMPLE_ROWS,
    timeoutSeconds: sessionDbConfig?.queryTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
  };

  const result = await ctx.dbAdapter.sampleValues({
    schema,
    table,
    column,
    limits,
  });
  return {
    schema,
    table,
    column,
    rowCount: result.rowCount,
    truncated: result.truncated,
    rows: result.rows,
  };
};

export const sampleDbValuesTool: ToolRegistryEntry = {
  name: 'sample_db_values',
  description:
    'Return up to N distinct values from a single column. Bounded by the session allowlist + row/timeout limits. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      schema: { type: 'string', description: 'Optional DB schema name.' },
      table: { type: 'string', description: 'Table name (must be in session allowlist if set).' },
      column: { type: 'string', description: 'Column name to sample.' },
    },
    required: ['table', 'column'],
    additionalProperties: false,
  },
  handler,
};
