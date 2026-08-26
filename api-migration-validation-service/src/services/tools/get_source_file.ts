/**
 * `get_source_file` -- fetch ONE repo-relative source file from the discovery
 * run's cached clone (the sibling of `search_source_files`, 2026-08-08
 * Retry-uncovered budget/context fix).
 *
 * Gives the capture/repair LLM direct read access to the application code for
 * REST operations (SOAP already had DTO source via
 * `get_operation_payload_context`): handler methods, bean/validator classes,
 * and DTOs frequently encode happy-path requirements the contract never
 * states. Content is capped so a single file cannot flood the conversation;
 * truncation is explicit.
 *
 * Degrades honestly (no run bound / clone evicted / not found / error) with
 * structured notes, mirroring `search_source_files`.
 */

import { discoveryServiceClient as defaultDiscoveryServiceClient } from '../discoveryServiceClient';
import type { ToolExecutionContext, ToolRegistryEntry } from './toolTypes';
import { ToolValidationError } from './toolTypes';

/**
 * Per-file content cap fed back to the LLM. Matches the order of magnitude of
 * the SOAP payload-context per-file cap; large files return their head with a
 * loud truncation marker.
 */
export const MAX_SOURCE_CONTENT_CHARS = 60_000;

async function handler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<unknown> {
  const repoPath = typeof args.path === 'string' ? args.path.trim() : '';
  if (repoPath.length === 0) {
    throw new ToolValidationError('get_source_file', 'invalid_argument', "'path' must be a non-empty string.");
  }
  if (repoPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(repoPath) || repoPath.includes('..')) {
    throw new ToolValidationError(
      'get_source_file',
      'invalid_argument',
      "'path' must be repo-relative (no leading slash, drive letter, or '..').",
    );
  }

  const runId = ctx.discoveryRunId ?? null;
  if (!runId) {
    return {
      unavailable:
        'No discovery run is bound to this capture session, so source files ' +
        'cannot be fetched. Rely on the contract and database tools.',
    };
  }
  const client = ctx.discoveryServiceClient ?? defaultDiscoveryServiceClient;
  const result = await client.fetchSourceFile({
    projectId: ctx.session.projectId,
    architectureId: ctx.session.architectureId,
    runId,
    repoPath,
  });
  if (result.kind === 'ok') {
    const truncated = result.content.length > MAX_SOURCE_CONTENT_CHARS;
    return {
      path: repoPath,
      content: truncated
        ? result.content.slice(0, MAX_SOURCE_CONTENT_CHARS)
        : result.content,
      truncated,
      ...(truncated
        ? {
            note: `Content truncated at ${MAX_SOURCE_CONTENT_CHARS} characters (file is larger).`,
          }
        : {}),
    };
  }
  if (result.kind === 'evicted') {
    return {
      unavailable:
        'The discovery clone for this run has been evicted from disk; source ' +
        'files are unavailable. Rely on the contract and database tools.',
    };
  }
  if (result.kind === 'not_found') {
    return {
      error: `No file at repo-relative path '${repoPath}' in the discovery clone. Use search_source_files to find the right path.`,
    };
  }
  return { error: `Source fetch failed: ${result.message}` };
}

export const getSourceFileTool: ToolRegistryEntry = {
  name: 'get_source_file',
  description:
    'Read ONE application source file from the discovery clone by its ' +
    'repo-relative path (as returned by search_source_files). Use it to read ' +
    'handler / validator / DTO code when the contract does not explain a ' +
    'rejection. Returns { path, content, truncated }.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Repo-relative file path (e.g. 'src/main/java/com/acme/OrderController.java').",
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  handler,
  research: true,
};
