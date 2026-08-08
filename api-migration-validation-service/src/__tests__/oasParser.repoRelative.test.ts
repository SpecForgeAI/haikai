/**
 * Tests for the Phase 3 (spec 2026-05-17 Spec File Auto-Linking) Task
 * Group 6 extension to {@link parseOasFromFile}: the function now branches
 * on `path.isAbsolute(specLinkPath)` so repo-relative `spec_link` values
 * set by Workstream A's `specFileLinker` scanner are fetched via Phase 2's
 * discovery-service source endpoint, while legacy absolute paths still go
 * through the local `fs.readFile` / SwaggerParser path.
 *
 * Test matrix (mirrors Group 6 sub-task 6.1 in tasks.md):
 *
 *   - Repo-relative path + ctx -> discoveryServiceClient.fetchSourceFile
 *     called with the right `{ projectId, architectureId, runId,
 *     repoPath }` shape; returned bytes parsed.
 *   - Absolute path + ctx -> local SwaggerParser code path; the
 *     discoveryServiceClient stub is NEVER called.
 *   - No `ctx` (legacy caller) + relative path -> local SwaggerParser code
 *     path (back-compat for the old call sites; the file does not exist
 *     on disk and SwaggerParser surfaces an error).
 *   - 410 Gone from `fetchSourceFile` -> throws
 *     {@link SpecLinkCloneEvictedError}; the route layer maps this to a
 *     "Source no longer cached" message in `captureSessionActions`.
 */

import path from 'path';
import {
  parseOasFromFile,
  SpecLinkCloneEvictedError,
} from '../services/oasParser';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../services/discoveryServiceClient';

// A tiny OpenAPI 3.0 document just complete enough that SwaggerParser will
// accept it without dereferencing failures. The petstore fixture under
// `__tests__/fixtures/sample-oas.json` is shaped similarly but this in-test
// constant keeps the assertions self-contained.
const SAMPLE_OAS_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'RepoRelative Sample API', version: '0.1.0' },
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  },
});

interface StubCallArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  repoPath: string;
}

interface DiscoveryServiceClientStub extends DiscoveryServiceClient {
  calls: StubCallArgs[];
}

function buildClientStub(
  next: () => Promise<FetchSourceResult>,
): DiscoveryServiceClientStub {
  const calls: StubCallArgs[] = [];
  const stub: DiscoveryServiceClientStub = {
    searchSourceFiles: async () => ({ kind: 'ok' as const, files: [], truncated: false }),
    calls,
    fetchSourceFile: async (args) => {
      calls.push({ ...args });
      return next();
    },
  };
  return stub;
}

describe('parseOasFromFile (Phase 3 -- repo-relative branch)', () => {
  it('routes repo-relative spec_link values through discoveryServiceClient.fetchSourceFile', async () => {
    const stub = buildClientStub(async () => ({ kind: 'ok', content: SAMPLE_OAS_JSON }));

    const inventory = await parseOasFromFile('src/main/resources/openapi.yaml', {
      discoveryRunId: 'run-abc',
      projectId: 'proj-1',
      architectureId: 'arch-2',
      discoveryServiceClient: stub,
    });

    // The fetch must have been invoked exactly once with the four
    // ctx-supplied IDs and the repo-relative path verbatim.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toEqual({
      projectId: 'proj-1',
      architectureId: 'arch-2',
      runId: 'run-abc',
      repoPath: 'src/main/resources/openapi.yaml',
    });

    // The returned body was parsed by the same downstream OAS pipeline as
    // the local-read branch -- exactly one operation, matching the
    // fixture.
    expect(inventory.title).toBe('RepoRelative Sample API');
    expect(inventory.version).toBe('0.1.0');
    expect(inventory.operations).toHaveLength(1);
    expect(inventory.operations[0].operationId).toBe('getHealth');
    expect(inventory.operations[0].method).toBe('get');
    expect(inventory.operations[0].path).toBe('/health');
  });

  it('routes absolute paths through the local SwaggerParser code path and does NOT call discoveryServiceClient', async () => {
    const stub = buildClientStub(async () => {
      // If this is ever called for an absolute path the back-compat
      // contract is broken; surface that immediately rather than relying
      // on the assertion below.
      throw new Error('fetchSourceFile must not be invoked for absolute paths');
    });

    // Use the existing fixture that ships with the repo so SwaggerParser
    // actually finds something on disk and produces a real inventory.
    const FIXTURE_PATH = path.join(
      __dirname,
      'fixtures',
      'sample-oas.json',
    );
    expect(path.isAbsolute(FIXTURE_PATH)).toBe(true);

    const inventory = await parseOasFromFile(FIXTURE_PATH, {
      discoveryRunId: 'run-abc',
      projectId: 'proj-1',
      architectureId: 'arch-2',
      discoveryServiceClient: stub,
    });

    // Back-compat guard: the fetch helper is NOT called for absolute paths
    // even when ctx is supplied. The local SwaggerParser parse succeeds
    // and produces the fixture inventory.
    expect(stub.calls).toHaveLength(0);
    expect(inventory.operations.length).toBeGreaterThan(0);
  });

  it('without ctx (legacy callers), relative paths flow through SwaggerParser (back-compat)', async () => {
    // The legacy contract: `parseOasFromFile('some/relative/path.yaml')`
    // (no ctx) goes straight to SwaggerParser, which resolves the path
    // against the worker's cwd. The file does not exist so SwaggerParser
    // throws; the important contract is that we did NOT take the
    // repo-relative branch (which would have required ctx fields the
    // legacy caller did not supply).
    //
    // We assert by catching the SwaggerParser error and verifying it's NOT
    // the SpecLinkCloneEvictedError or the structured ctx-missing error
    // that the new branch would have thrown. The local-read branch
    // surfaces ENOENT / "no such file or directory" / similar from
    // SwaggerParser's internal `fs` reads.
    let caught: unknown = null;
    try {
      await parseOasFromFile('does/not/exist/openapi.yaml');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught).not.toBeInstanceOf(SpecLinkCloneEvictedError);
    // The structured ctx-missing message comes from the new branch; if we
    // see it, ctx was wrongly invented. The legacy back-compat path must
    // never tunnel through `fetchRepoRelativeSpec`.
    const message = (caught as Error).message;
    expect(message).not.toMatch(/requires ctx\.projectId/);
    expect(message).not.toMatch(/requires a discoveryServiceClient/);
  });

  it('throws SpecLinkCloneEvictedError when the discovery-service source endpoint returns 410 Gone', async () => {
    const stub = buildClientStub(async () => ({ kind: 'evicted' }));

    let caught: unknown = null;
    try {
      await parseOasFromFile('src/main/resources/openapi.yaml', {
        discoveryRunId: 'run-xyz',
        projectId: 'proj-1',
        architectureId: 'arch-2',
        discoveryServiceClient: stub,
      });
    } catch (err) {
      caught = err;
    }

    expect(stub.calls).toHaveLength(1);
    expect(caught).toBeInstanceOf(SpecLinkCloneEvictedError);
    const err = caught as SpecLinkCloneEvictedError;
    expect(err.kind).toBe('spec_link_clone_evicted');
    expect(err.specLinkPath).toBe('src/main/resources/openapi.yaml');
    expect(err.discoveryRunId).toBe('run-xyz');
    // The error message must surface the wording the route layer pivots
    // off to render the wizard's "Source no longer cached" toast.
    expect(err.message).toMatch(/Source no longer cached/);
  });
});
