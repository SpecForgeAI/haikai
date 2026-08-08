/**
 * `search_source_files` + `get_source_file` tool tests (2026-08-08
 * Retry-uncovered budget/context fix — REST code access for the capture
 * repair loop).
 *
 * Pins: happy search + fetch through the injected discovery client, the
 * content cap with a loud truncation marker, argument validation, and the
 * honest degradations (no bound run / evicted clone) that must NEVER throw.
 */

import { searchSourceFilesTool } from '../services/tools/search_source_files';
import { getSourceFileTool } from '../services/tools/get_source_file';
import { MAX_SOURCE_CONTENT_CHARS } from '../services/tools/get_source_file';
import type { ToolExecutionContext } from '../services/tools';
import { ToolValidationError } from '../services/tools';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
  SearchSourceResult,
} from '../services/discoveryServiceClient';

function buildContext(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    session: {
      id: 'session-1',
      projectId: 'proj-1',
      architectureId: 'arch-1',
    },
    oasInventory: { title: 'T', version: '1', operations: [] },
    operationsByOasId: new Map(),
    secrets: { sessionId: 'session-1', api: { type: 'none' }, loadedAt: 0 },
    httpExecutor: null,
    dbAdapter: null,
    archModelClient: {
      createScenario: jest.fn(),
      createDiagnostic: jest.fn(),
      createCapture: jest.fn(),
    },
    currentScenarioId: null,
    discoveryRunId: 'run-1',
    ...overrides,
  } as unknown as ToolExecutionContext;
}

function fakeClient(
  search: SearchSourceResult,
  fetch: FetchSourceResult,
): DiscoveryServiceClient & { searchArgs: unknown[]; fetchArgs: unknown[] } {
  const searchArgs: unknown[] = [];
  const fetchArgs: unknown[] = [];
  return {
    searchArgs,
    fetchArgs,
    searchSourceFiles: async (args) => {
      searchArgs.push(args);
      return search;
    },
    fetchSourceFile: async (args) => {
      fetchArgs.push(args);
      return fetch;
    },
  };
}

describe('search_source_files', () => {
  it('searches via the discovery client with the session scope + bound run id', async () => {
    const client = fakeClient(
      { kind: 'ok', files: ['src/main/java/com/acme/OrderController.java'], truncated: false },
      { kind: 'not_found' },
    );
    const result = (await searchSourceFilesTool.handler(
      { query: 'OrderController' },
      buildContext({ discoveryServiceClient: client }),
    )) as { files: string[]; truncated: boolean };
    expect(result.files).toEqual(['src/main/java/com/acme/OrderController.java']);
    expect(result.truncated).toBe(false);
    expect(client.searchArgs[0]).toEqual({
      projectId: 'proj-1',
      architectureId: 'arch-1',
      runId: 'run-1',
      query: 'OrderController',
      limit: 50,
    });
  });

  it('degrades with a structured note when no run is bound or the clone was evicted — never throws', async () => {
    const noRun = (await searchSourceFilesTool.handler(
      { query: 'orders' },
      buildContext({ discoveryRunId: null }),
    )) as { unavailable?: string };
    expect(noRun.unavailable).toContain('No discovery run');

    const evicted = (await searchSourceFilesTool.handler(
      { query: 'orders' },
      buildContext({
        discoveryServiceClient: fakeClient({ kind: 'evicted' }, { kind: 'evicted' }),
      }),
    )) as { unavailable?: string };
    expect(evicted.unavailable).toContain('evicted');
  });

  it('rejects a sub-2-character query with a ToolValidationError', async () => {
    await expect(
      searchSourceFilesTool.handler({ query: 'x' }, buildContext()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

describe('get_source_file', () => {
  it('fetches a repo-relative file and caps oversized content with a loud marker', async () => {
    const small = (await getSourceFileTool.handler(
      { path: 'src/A.java' },
      buildContext({
        discoveryServiceClient: fakeClient(
          { kind: 'not_found' },
          { kind: 'ok', content: 'class A {}' },
        ),
      }),
    )) as { path: string; content: string; truncated: boolean };
    expect(small).toEqual({ path: 'src/A.java', content: 'class A {}', truncated: false });

    const big = (await getSourceFileTool.handler(
      { path: 'src/B.java' },
      buildContext({
        discoveryServiceClient: fakeClient(
          { kind: 'not_found' },
          { kind: 'ok', content: 'x'.repeat(MAX_SOURCE_CONTENT_CHARS + 10) },
        ),
      }),
    )) as { content: string; truncated: boolean; note?: string };
    expect(big.truncated).toBe(true);
    expect(big.content).toHaveLength(MAX_SOURCE_CONTENT_CHARS);
    expect(big.note).toContain('truncated');
  });

  it('rejects absolute and traversal paths; not_found points back to search', async () => {
    await expect(
      getSourceFileTool.handler({ path: '/etc/passwd' }, buildContext()),
    ).rejects.toBeInstanceOf(ToolValidationError);
    await expect(
      getSourceFileTool.handler({ path: 'a/../b' }, buildContext()),
    ).rejects.toBeInstanceOf(ToolValidationError);

    const missing = (await getSourceFileTool.handler(
      { path: 'src/Missing.java' },
      buildContext({
        discoveryServiceClient: fakeClient({ kind: 'not_found' }, { kind: 'not_found' }),
      }),
    )) as { error?: string };
    expect(missing.error).toContain('search_source_files');
  });
});
