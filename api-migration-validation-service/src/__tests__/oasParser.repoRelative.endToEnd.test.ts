/**
 * Phase 3 Task Group 7 -- end-to-end fixture acceptance test (Workstream C
 * half: AMVS source-endpoint round-trip).
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Acceptance criterion (raw idea, restated verbatim): "Project containing
 * `src/main/resources/openapi.yaml` with paths matching an existing REST
 * controller -> ONE interface candidate with `spec_link` set to the
 * repo-relative file path -> AMVS's `parseOasFromFile` can resolve via
 * Phase 2 source endpoint -> operations available for Step 4."
 *
 * The Workstream A half of this E2E (the linker actually setting
 * `spec_link` to `src/main/resources/openapi.yaml`) lives in
 * `discovery-service/src/__tests__/specFileLinkerEndToEndFixture.test.ts`.
 * This file picks up the round-trip exactly where the linker handed off
 * to AMS storage: it consumes the same spec_link value, mocks the
 * Phase 2 discovery-service source endpoint to return the YAML fixture's
 * verbatim bytes, and asserts the parsed inventory contains the
 * fixture's operations.
 *
 * Splitting across two files is required because each service ships its
 * own ts-jest config with `rootDir: ./src` -- a single test file cannot
 * import from both packages at compile time.
 *
 * Cross-reference: the discovery-service half asserts that the linker
 * produces `spec_link === 'src/main/resources/openapi.yaml'`; this file
 * assumes that hand-off succeeded and verifies the downstream parse.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseOasFromFile,
  type ParseOasFromFileCtx,
} from '../services/oasParser';
import type {
  DiscoveryServiceClient,
  FetchSourceResult,
} from '../services/discoveryServiceClient';

// ----------------------------------------------------------------------------
// Fixtures + helpers
// ----------------------------------------------------------------------------

const RUN_CONTEXT = {
  runId: 'run-e2e-fixture-001',
  projectId: 'proj-e2e-fixture-001',
  architectureId: 'arch-e2e-fixture-001',
};

const PHASE3_VISUALS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-spec-file-auto-linking-phase-3',
  'planning',
  'visuals',
);

const YAML_FIXTURE_ABS = path.join(
  PHASE3_VISUALS,
  'reference-springdoc-petstore.yaml',
);

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
  next: (args: StubCallArgs) => Promise<FetchSourceResult>,
): DiscoveryServiceClientStub {
  const calls: StubCallArgs[] = [];
  const stub: DiscoveryServiceClientStub = {
    calls,
    fetchSourceFile: async (args) => {
      calls.push({ ...args });
      return next(args);
    },
  };
  return stub;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Phase 3 Task Group 7 -- end-to-end fixture acceptance (Workstream C round-trip)', () => {
  // ===========================================================================
  // Cross-service smoke: round-trip discovery -> AMS-stored spec_link ->
  // AMVS source-endpoint fetch -> OAS parse.
  //
  // Acceptance signal per the spec.md raw-idea wording:
  //   "Project containing `src/main/resources/openapi.yaml` with paths
  //   matching an existing REST controller -> ONE interface candidate with
  //   `spec_link` set to the repo-relative file path -> AMVS's
  //   `parseOasFromFile` can resolve via Phase 2 source endpoint ->
  //   operations available for Step 4."
  // ===========================================================================
  it('parseOasFromFile resolves the linker-produced spec_link via the Phase 2 source endpoint and yields the fixture operations', async () => {
    // The YAML fixture bytes are what the discovery-service cached clone
    // would have served at this run id. We read them off disk in the test
    // and hand them back from the mocked source endpoint verbatim.
    expect(fs.existsSync(YAML_FIXTURE_ABS)).toBe(true);
    const yamlBody = fs.readFileSync(YAML_FIXTURE_ABS, 'utf-8');

    const stub = buildClientStub(async () => ({ kind: 'ok', content: yamlBody }));

    // This is the same repo-relative spec_link value that the Workstream A
    // half of the E2E asserts the linker sets on the PetStoreApi candidate.
    // `parseOasFromFile` MUST branch on `path.isAbsolute()` (= false here)
    // and fetch via `ctx.discoveryServiceClient` instead of touching the
    // local filesystem.
    const SPEC_LINK = 'src/main/resources/openapi.yaml';

    const ctx: ParseOasFromFileCtx = {
      discoveryRunId: RUN_CONTEXT.runId,
      projectId: RUN_CONTEXT.projectId,
      architectureId: RUN_CONTEXT.architectureId,
      discoveryServiceClient: stub,
    };

    const inventory = await parseOasFromFile(SPEC_LINK, ctx);

    // The fetch was invoked exactly once with the linker-produced
    // spec_link + the ctx-supplied run / project / architecture ids.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toEqual({
      projectId: RUN_CONTEXT.projectId,
      architectureId: RUN_CONTEXT.architectureId,
      runId: RUN_CONTEXT.runId,
      repoPath: SPEC_LINK,
    });

    // Parsed inventory carries the fixture's documented title + version.
    expect(inventory.title).toBe('PetStoreApi');
    expect(inventory.version).toBe('1.0.0');

    // Operations available for Step 4 -- the YAML fixture declares
    // GET /api/v1/pets, POST /api/v1/pets, GET /api/v1/pets/{petId},
    // and GET /api/v1/pets/{petId}/photos. The smoke check needs at least
    // the first two to prove the round-trip end-to-end.
    const opKeys = inventory.operations.map((o) => `${o.method} ${o.path}`);
    expect(opKeys).toEqual(
      expect.arrayContaining([
        'get /api/v1/pets',
        'post /api/v1/pets',
      ]),
    );
  });
});
