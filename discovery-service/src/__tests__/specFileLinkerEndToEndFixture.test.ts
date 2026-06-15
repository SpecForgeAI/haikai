/**
 * Phase 3 Task Group 7 -- end-to-end fixture acceptance test (Workstream A
 * half: discovery-service pipeline).
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Acceptance criterion (raw idea, restated verbatim): "Project containing
 * `src/main/resources/openapi.yaml` with paths matching an existing REST
 * controller -> ONE interface candidate with `spec_link` set to the
 * repo-relative file path -> AMVS's `parseOasFromFile` can resolve via
 * Phase 2 source endpoint -> operations available for Step 4."
 *
 * This file is the gating end-to-end check for the Workstream A leg of
 * Phase 3 (the linker actually setting `spec_link` on the right interface
 * candidate). The Workstream C cross-service round-trip leg (AMVS's
 * `parseOasFromFile` fetching the same path via Phase 2's source endpoint)
 * lives in the parallel test file
 * `api-migration-validation-service/src/__tests__/oasParser.repoRelative.endToEnd.test.ts`
 * because ts-jest's per-service `rootDir` (`./src`) prevents a single test
 * file from spanning both packages.
 *
 *   Test 1 (Workstream A YAML happy path):
 *     - In-memory fixture repo with `src/main/resources/openapi.yaml` (the
 *       Group 2 `reference-springdoc-petstore.yaml` fixture, title
 *       `PetStoreApi`, paths under `/api/v1/pets`).
 *     - One pre-built interface candidate whose `name === 'PetStoreApi'`
 *       AND `data.basePath === '/api/v1/pets'`, simulating what the Spring
 *       Boot adapter would have produced for a `PetStoreApi` controller
 *       carrying `@RequestMapping('/api/v1/pets')`. Both heuristics match
 *       the YAML simultaneously -- the priority order (title first) is
 *       what locks the link.
 *     - Run the full pack-scanner pipeline; assert the candidate's
 *       `data.spec_link === 'src/main/resources/openapi.yaml'`, exactly
 *       one interface candidate is linked, and no ambiguous/orphan
 *       findings emerged.
 *
 *   Test 2 (Workstream A JSON happy path -- parallel fixture):
 *     - In-memory fixture repo with `src/main/resources/openapi.json` (the
 *       Group 2 `reference-springdoc-petstore.json` fixture, title
 *       `BillingApi`, paths under `/api/v1/invoices`).
 *     - One pre-built interface candidate whose `name === 'BillingApi'`
 *       AND `data.basePath === '/api/v1/invoices'`.
 *     - Run the full pack-scanner pipeline; assert the candidate's
 *       `data.spec_link === 'src/main/resources/openapi.json'` and no
 *       findings. Proves the `JSON.parse` branch of the signature detector
 *       reaches the same outcome as the YAML branch.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import type { FindingEmitRunContext } from '../services/findings/FindingEmitter';
import { runPackFindingScanners } from '../services/findings/packFindingScanners';

// ----------------------------------------------------------------------------
// Shared fixtures + helpers
// ----------------------------------------------------------------------------

const RUN_CONTEXT: FindingEmitRunContext = {
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

const JSON_FIXTURE_ABS = path.join(
  PHASE3_VISUALS,
  'reference-springdoc-petstore.json',
);

function makeTempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-e2e-fixture-'));
}

function cleanupRepo(repo: string): void {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function copyFixtureInto(
  repo: string,
  fixtureAbs: string,
  repoRelTarget: string,
): void {
  const dest = path.join(repo, repoRelTarget);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(fixtureAbs, dest);
}

/**
 * Pre-built interface candidate that mimics what the Spring Boot framework
 * adapter would have produced for a `@RestController` whose class name is
 * `${name}` and whose `@RequestMapping('${basePath}')` declares the base.
 *
 * The matcher uses `candidate.name === info.title` for the title heuristic
 * (P-2 priority 1) and `candidate.data.basePath === <paths common prefix>`
 * for the base-path heuristic (priority 2). Carrying matching values for
 * BOTH heuristics produces a deterministic title-first win, which is what
 * the Group 7 acceptance criterion enumerates.
 */
function makeRestInterfaceCandidate(
  id: string,
  name: string,
  basePath: string,
): DiscoveryCandidate {
  return {
    id,
    runId: RUN_CONTEXT.runId,
    candidateType: 'interfaces',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [`src/main/java/com/example/${name}.java`],
    data: {
      interface_type: 'REST_API',
      basePath,
    },
    synthesizedAt: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Phase 3 Task Group 7 -- end-to-end fixture acceptance (Workstream A)', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ===========================================================================
  // Test 1 -- Workstream A YAML happy path.
  //
  // Fixture repo carries `src/main/resources/openapi.yaml` (the Group 2 YAML
  // fixture, title `PetStoreApi`, paths under `/api/v1/pets`). One in-memory
  // interface candidate is shaped like what the Spring Boot adapter would
  // have produced for a `PetStoreApi` controller with
  // `@RequestMapping('/api/v1/pets')`. The pack-scanner pipeline runs the
  // spec-file linker stage, which mutates `data.spec_link` in place when a
  // unique match is found.
  // ===========================================================================
  it('Test 1 (YAML): fixture repo + matching candidate -> spec_link set, no findings (title heuristic wins)', () => {
    const repo = makeTempRepo();
    try {
      expect(fs.existsSync(YAML_FIXTURE_ABS)).toBe(true);
      copyFixtureInto(repo, YAML_FIXTURE_ABS, 'src/main/resources/openapi.yaml');

      const petIface = makeRestInterfaceCandidate(
        'cand-rest-iface-pet',
        'PetStoreApi', // matches OpenAPI fixture's info.title
        '/api/v1/pets', // matches OpenAPI fixture's paths common prefix
      );
      const packCandidates: DiscoveryCandidate[] = [petIface];

      const findings = runPackFindingScanners({
        runId: RUN_CONTEXT.runId,
        irFiles: new Map<string, SourceFileIR>(),
        packCandidates,
        repoRoot: repo,
        serviceRootPath: null,
        runContext: RUN_CONTEXT,
      });

      // Exactly one interface candidate has `spec_link` set to the YAML
      // fixture's repo-relative path. The matcher chose the title heuristic
      // (priority 1) because `PetStoreApi === info.title`.
      const linkedCandidates = packCandidates.filter(
        (c) => c.candidateType === 'interfaces' && (c.data.spec_link as unknown) != null,
      );
      expect(linkedCandidates).toHaveLength(1);
      expect(linkedCandidates[0].id).toBe('cand-rest-iface-pet');
      expect(petIface.data.spec_link).toBe('src/main/resources/openapi.yaml');

      // No ambiguous / orphan evidence_gap findings -- single spec file,
      // single matching candidate, clean unique match.
      const oasGapFindings = findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' ||
          d?.gapType === 'oas_spec_orphan'
        );
      });
      expect(oasGapFindings).toHaveLength(0);

      // Diagnostic-log shape: the linker emits the documented `match=`-style
      // result line per file (Group 3 / Group 4 wiring).
      const linkerLogs = logSpy.mock.calls
        .map((c) => String(c[0] ?? ''))
        .filter((s) => s.includes('scanner=spec_file_linker'));
      expect(
        linkerLogs.some((l) =>
          /file=src\/main\/resources\/openapi\.yaml .*result=matched/.test(l),
        ),
      ).toBe(true);
    } finally {
      cleanupRepo(repo);
    }
  });

  // ===========================================================================
  // Test 2 -- Workstream A JSON happy path (parallel fixture).
  //
  // Same shape as Test 1 but driven by the JSON variant (Group 2's
  // `reference-springdoc-petstore.json`, title `BillingApi`, paths under
  // `/api/v1/invoices`). Proves the `JSON.parse` branch of the signature
  // detector reaches the same `spec_link` outcome as the YAML branch.
  // ===========================================================================
  it('Test 2 (JSON): parallel fixture repo + matching candidate -> spec_link set to .json path, no findings', () => {
    const repo = makeTempRepo();
    try {
      expect(fs.existsSync(JSON_FIXTURE_ABS)).toBe(true);
      copyFixtureInto(repo, JSON_FIXTURE_ABS, 'src/main/resources/openapi.json');

      const billingIface = makeRestInterfaceCandidate(
        'cand-rest-iface-billing',
        'BillingApi', // matches JSON fixture's info.title
        '/api/v1/invoices', // matches JSON fixture's only-path-derived base
      );
      const packCandidates: DiscoveryCandidate[] = [billingIface];

      const findings = runPackFindingScanners({
        runId: RUN_CONTEXT.runId,
        irFiles: new Map<string, SourceFileIR>(),
        packCandidates,
        repoRoot: repo,
        serviceRootPath: null,
        runContext: RUN_CONTEXT,
      });

      expect(billingIface.data.spec_link).toBe(
        'src/main/resources/openapi.json',
      );

      const oasGapFindings = findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' ||
          d?.gapType === 'oas_spec_orphan'
        );
      });
      expect(oasGapFindings).toHaveLength(0);
    } finally {
      cleanupRepo(repo);
    }
  });
});
