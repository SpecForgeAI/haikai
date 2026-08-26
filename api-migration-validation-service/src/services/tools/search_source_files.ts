/**
 * `search_source_files` -- find repo-relative source file paths in the
 * discovery run's cached clone whose path contains a query substring
 * (case-insensitive).
 *
 * 2026-08-08 (Retry-uncovered budget/context fix): REST operations carry no
 * structured source provenance, so the capture/repair LLM previously had NO
 * code access outside the SOAP payload-context tool -- validation rules that
 * live only in code (required header combos, enum values absent from the
 * contract, cross-field rules) were invisible, which is exactly the 400/422
 * tail that survives deterministic replay. This tool + `get_source_file`
 * close that gap: search for the handler/validator/DTO by name fragment
 * ("OrderController", "orders", "CreateOrderRequest"), then fetch contents.
 *
 * Degrades honestly:
 *   - no discovery run bound to the session -> structured `unavailable` note;
 *   - clone evicted (410) -> structured `unavailable` note (no auto-reclone);
 *   - discovery-service error -> structured error string.
 */

import { discoveryServiceClient as defaultDiscoveryServiceClient } from '../discoveryServiceClient';
import type { ToolExecutionContext, ToolRegistryEntry } from './toolTypes';
import { ToolValidationError } from './toolTypes';

/** Result-list ceiling forwarded to discovery-service (its own cap is 200). */
const MAX_RESULTS = 100;

async function handler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (query.length < 2) {
    throw new ToolValidationError(
      'search_source_files',
      'invalid_argument',
      "'query' must be a string of at least 2 characters.",
    );
  }
  const limitRaw = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.floor(args.limit)
    : 50;
  const limit = Math.max(1, Math.min(MAX_RESULTS, limitRaw));

  const runId = ctx.discoveryRunId ?? null;
  if (!runId) {
    return {
      unavailable:
        'No discovery run is bound to this capture session, so the source ' +
        'clone cannot be searched. Rely on the contract and database tools.',
    };
  }
  const client = ctx.discoveryServiceClient ?? defaultDiscoveryServiceClient;
  const result = await client.searchSourceFiles({
    projectId: ctx.session.projectId,
    architectureId: ctx.session.architectureId,
    runId,
    query,
    limit,
  });
  if (result.kind === 'ok') {
    return { files: result.files, truncated: result.truncated };
  }
  if (result.kind === 'evicted') {
    return {
      unavailable:
        'The discovery clone for this run has been evicted from disk; source ' +
        'search is unavailable. Rely on the contract and database tools.',
    };
  }
  if (result.kind === 'not_found') {
    return { unavailable: 'The discovery run was not found; source search is unavailable.' };
  }
  return { error: `Source search failed: ${result.message}` };
}

export const searchSourceFilesTool: ToolRegistryEntry = {
  name: 'search_source_files',
  description:
    'Search the application source code (the discovery clone) for repo-relative ' +
    'file paths containing a substring, case-insensitive. Use it to locate the ' +
    'handler / controller / validator / DTO files for an operation (e.g. query ' +
    '"OrderController" or "orders"), then read them with get_source_file. ' +
    'Returns { files: string[], truncated: boolean }.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Case-insensitive substring matched against repo-relative file paths ' +
          '(minimum 2 characters).',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of paths to return (default 50, max 100).',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler,
  research: true,
};
