import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';

/**
 * Tool: `get_oas_operation_detail`
 *
 * Pure in-memory read of a single OAS operation, returning the dereferenced
 * request schema, response schema, and full OAS operation object so the LLM
 * can plan a request body. No I/O.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const handler: ToolHandler = async (args, ctx) => {
  const operationId = typeof args.operationId === 'string' ? args.operationId : null;
  if (!operationId) {
    throw new ToolValidationError(
      'get_oas_operation_detail',
      'missing_operation_id',
      '`operationId` is required and must be a string.',
    );
  }
  const op = ctx.oasInventory.operations.find((o) => o.operationId === operationId);
  if (!op) {
    return {
      found: false,
      operationId,
      message: `No operation in the parsed inventory matched operationId='${operationId}'.`,
    };
  }
  const persisted = ctx.operationsByOasId.get(operationId);
  return {
    found: true,
    operationId: op.operationId,
    method: op.method.toUpperCase(),
    path: op.path,
    summary: op.summary,
    description: op.description,
    requestSchema: op.requestSchema,
    responseSchema: op.responseSchema,
    oasOperation: op.oasOperation,
    included: persisted?.included ?? null,
    safe_to_execute: persisted?.safe_to_execute ?? null,
  };
};

export const getOasOperationDetailTool: ToolRegistryEntry = {
  name: 'get_oas_operation_detail',
  description:
    'Return the dereferenced OAS operation detail (request + response schema, full operation object) for one operationId. Pure read, no I/O.',
  parameters: {
    type: 'object',
    properties: {
      operationId: { type: 'string', description: 'The OAS operationId to fetch.' },
    },
    required: ['operationId'],
    additionalProperties: false,
  },
  handler,
};
