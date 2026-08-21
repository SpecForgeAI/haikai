import { effectiveDbAllowlist } from '../../types/captureSession';
import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';

/**
 * Tool: `list_db_metadata`
 *
 * Read `information_schema` (or engine-equivalent) via the per-session
 * `DbAdapter`. Bounded by the allowlist configured at session-create time
 * (`db_config_redacted_json.allowlistSchemas` / `allowlistTables`); falls
 * back to the LLM-supplied filter only as a refinement, never to widen the
 * allowlist.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const handler: ToolHandler = async (args, ctx) => {
  if (!ctx.dbAdapter) {
    throw new ToolValidationError(
      'list_db_metadata',
      'no_db_configured',
      'No DB adapter is configured for this capture session. DB sampling is optional in the wizard.',
    );
  }

  // Allowlist comes from session config -- the LLM cannot widen it. The tool
  // args may NARROW the request (e.g. ask for one schema out of three).
  // Wire-key tolerant read (2026-08-21): the wizard's legacy `allowlist` key
  // and the `schema` connection field count — previously they were ignored,
  // so the allowlist was ALWAYS empty here and this tool fail-closed to
  // schemaCount=0/tableCount=0 on every session.
  const sessionAllowlist = effectiveDbAllowlist(ctx.session.dbConfigRedactedJson);
  const sessionSchemas = sessionAllowlist.schemas;
  const sessionTables = sessionAllowlist.tables;

  const requestedSchemas = Array.isArray(args.schemas) ? (args.schemas as unknown[]).filter((s): s is string => typeof s === 'string') : null;
  const requestedTables = Array.isArray(args.tables) ? (args.tables as unknown[]).filter((s): s is string => typeof s === 'string') : null;

  const finalSchemas = sessionSchemas
    ? (requestedSchemas
        ? sessionSchemas.filter((s) => requestedSchemas.includes(s))
        : sessionSchemas)
    : (requestedSchemas ?? null);
  const finalTables = sessionTables
    ? (requestedTables
        ? sessionTables.filter((t) => requestedTables.includes(t))
        : sessionTables)
    : (requestedTables ?? null);

  const metadata = await ctx.dbAdapter.listMetadata({
    schemas: finalSchemas,
    tables: finalTables,
  });
  return {
    schemaCount: new Set(metadata.map((t) => t.schema)).size,
    tableCount: metadata.length,
    metadata,
  };
};

export const listDbMetadataTool: ToolRegistryEntry = {
  name: 'list_db_metadata',
  description:
    'Return information_schema metadata (tables + columns) for the session DB, bounded by the session allowlist. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      schemas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional schema names to narrow within the session allowlist.',
      },
      tables: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional table names to narrow within the session allowlist.',
      },
    },
    additionalProperties: false,
  },
  handler,
};
