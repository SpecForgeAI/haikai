import type { ToolHandler, ToolRegistryEntry } from './toolTypes';

/**
 * Tool: `list_oas_operations`
 *
 * Pure in-memory read of the parsed OAS inventory. The LLM uses this to get
 * a top-level list of operations available for capture (with `included` /
 * `safe_to_execute` flags pulled from the corresponding AMS operation row).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const handler: ToolHandler = async (_args, ctx) => {
  const rows = ctx.oasInventory.operations.map((op) => {
    const persisted = ctx.operationsByOasId.get(op.operationId);
    return {
      operationId: op.operationId,
      method: op.method.toUpperCase(),
      path: op.path,
      summary: op.summary,
      included: persisted?.included ?? null,
      safe_to_execute: persisted?.safe_to_execute ?? null,
    };
  });
  return {
    title: ctx.oasInventory.title,
    version: ctx.oasInventory.version,
    operationCount: rows.length,
    operations: rows,
  };
};

export const listOasOperationsTool: ToolRegistryEntry = {
  name: 'list_oas_operations',
  description:
    'Return the in-memory OAS operation inventory for this capture session. Pure read, no I/O.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  handler,
  research: true,
};
