/**
 * Tests for the `specFileLinker/index.ts` orchestrator (`runSpecFileLinker`).
 *
 * Spec: 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 3 (sub-task 3.2).
 *
 * Uses the Phase 3 fixtures from `planning/visuals/`:
 *  - `reference-springdoc-petstore.yaml` (matches by title='PetStoreApi',
 *    basePath='/api/v1/pets', openApiTag='pets')
 *  - `reference-springdoc-petstore.json` (minimal JSON; title='BillingApi')
 *
 * Coverage:
 *  1. Happy path: YAML fixture in repo + matching candidate -> `spec_link`
 *     set on the right candidate; no findings emitted.
 *  2. Pre-existing `spec_link` -> NOT overwritten; `spec_link_skipped`
 *     log line emitted (P-8).
 *  3. Ambiguous: two candidates same title -> `oas_spec_ambiguous_match`
 *     finding emitted; `spec_link` stays null on all involved candidates.
 *  4. Orphan: spec file but no candidates -> `oas_spec_orphan` finding emitted.
 *  5. Diagnostic log lines (start, per-file, done) emitted in the
 *     enumerated shape.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSpecFileLinker } from '../services/findings/packFindingScanners/specFileLinker';
import type { DiscoveryCandidate } from '../types/candidate';
import type { FindingEmitRunContext } from '../services/findings/FindingEmitter';

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

const YAML_FIXTURE = path.join(
  PHASE3_VISUALS,
  'reference-springdoc-petstore.yaml',
);
const JSON_FIXTURE = path.join(
  PHASE3_VISUALS,
  'reference-springdoc-petstore.json',
);

function makeRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-link-index-'));
}

function copyFixtureInto(
  repo: string,
  fixtureAbs: string,
  relTarget: string,
): void {
  const dest = path.join(repo, relTarget);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(fixtureAbs, dest);
}

function cleanup(repo: string): void {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function makeIface(
  id: string,
  name: string,
  data: Record<string, unknown> = {},
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'interfaces',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data,
    synthesizedAt: new Date().toISOString(),
  };
}

const RUN_CONTEXT: FindingEmitRunContext = {
  runId: 'run-1',
  projectId: 'proj-1',
  architectureId: 'arch-1',
};

describe('specFileLinker/index runSpecFileLinker', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // =========================================================================
  // Test 1: happy path -- YAML fixture + matching candidate sets spec_link.
  // =========================================================================
  it('Test 1: happy path -- YAML fixture + candidate matching by title -> spec_link set on the matched candidate; no findings', () => {
    const repo = makeRepo();
    try {
      // Make sure the fixture actually exists where we expect it.
      expect(fs.existsSync(YAML_FIXTURE)).toBe(true);
      copyFixtureInto(repo, YAML_FIXTURE, 'src/main/resources/openapi.yaml');

      const candidates: DiscoveryCandidate[] = [
        // The YAML fixture has info.title='PetStoreApi'; this candidate
        // matches by title (priority 1).
        makeIface('IF-pet', 'PetStoreApi', { basePath: '/api/v1/pets' }),
        // Distractor candidate -- should not be touched.
        makeIface('IF-other', 'OtherApi', { basePath: '/admin' }),
      ];

      const out = runSpecFileLinker({
        repoRoot: repo,
        serviceRootPath: null,
        existingInterfaceCandidates: candidates,
        runContext: RUN_CONTEXT,
      });

      const updated = out.updatedCandidates.find((c) => c.id === 'IF-pet')!;
      expect(updated.data.spec_link).toBe('src/main/resources/openapi.yaml');
      const distractor = out.updatedCandidates.find((c) => c.id === 'IF-other')!;
      expect(distractor.data.spec_link).toBeUndefined();
      expect(out.findings).toEqual([]);
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 2: pre-existing spec_link is NOT overwritten.
  // =========================================================================
  it('Test 2: pre-existing spec_link is NEVER overwritten (P-8); spec_link_skipped log line emitted', () => {
    const repo = makeRepo();
    try {
      copyFixtureInto(repo, YAML_FIXTURE, 'src/main/resources/openapi.yaml');

      const candidates: DiscoveryCandidate[] = [
        makeIface('IF-pet', 'PetStoreApi', {
          basePath: '/api/v1/pets',
          spec_link: '/legacy/manual/upload.yaml', // pre-existing absolute path
        }),
      ];

      const out = runSpecFileLinker({
        repoRoot: repo,
        serviceRootPath: null,
        existingInterfaceCandidates: candidates,
        runContext: RUN_CONTEXT,
      });

      const updated = out.updatedCandidates.find((c) => c.id === 'IF-pet')!;
      // The pre-existing absolute path must NOT be overwritten.
      expect(updated.data.spec_link).toBe('/legacy/manual/upload.yaml');
      // No findings emitted -- a skip is not an ambiguity / orphan.
      expect(out.findings).toEqual([]);
      // Assert the `spec_link_skipped` diag line was logged.
      const skipped = logSpy.mock.calls.find((call) =>
        String(call[0]).includes('spec_link_skipped'),
      );
      expect(skipped).toBeDefined();
      expect(String(skipped![0])).toContain(
        'pre_existing=/legacy/manual/upload.yaml',
      );
      expect(String(skipped![0])).toContain(
        'path=src/main/resources/openapi.yaml',
      );
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 3: ambiguous match -> oas_spec_ambiguous_match finding emitted.
  // =========================================================================
  it('Test 3: ambiguous match (two candidates same title) -> oas_spec_ambiguous_match finding; spec_link stays null', () => {
    const repo = makeRepo();
    try {
      copyFixtureInto(repo, YAML_FIXTURE, 'src/main/resources/openapi.yaml');

      const candidates: DiscoveryCandidate[] = [
        makeIface('IF-a', 'PetStoreApi'),
        makeIface('IF-b', 'PetStoreApi'),
      ];

      const out = runSpecFileLinker({
        repoRoot: repo,
        serviceRootPath: null,
        existingInterfaceCandidates: candidates,
        runContext: RUN_CONTEXT,
      });

      // Neither candidate's spec_link was set.
      const a = out.updatedCandidates.find((c) => c.id === 'IF-a')!;
      const b = out.updatedCandidates.find((c) => c.id === 'IF-b')!;
      expect(a.data.spec_link).toBeUndefined();
      expect(b.data.spec_link).toBeUndefined();

      // Exactly one ambiguous finding emitted, linking both candidate ids.
      expect(out.findings).toHaveLength(1);
      const finding = out.findings[0];
      expect(finding.findingType).toBe('evidence_gap');
      const detail = finding.detailJson as Record<string, unknown>;
      expect(detail.gapType).toBe('oas_spec_ambiguous_match');
      expect(detail.specFilePath).toBe('src/main/resources/openapi.yaml');
      expect(detail.candidateInterfaceIds).toEqual(['IF-a', 'IF-b']);

      // Diag line: result=ambiguous.
      const ambiguousLine = logSpy.mock.calls.find((call) =>
        String(call[0]).includes('result=ambiguous'),
      );
      expect(ambiguousLine).toBeDefined();
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 4: orphan -> oas_spec_orphan finding emitted.
  // =========================================================================
  it('Test 4: orphan (spec file but no candidates match) -> oas_spec_orphan finding emitted', () => {
    const repo = makeRepo();
    try {
      copyFixtureInto(repo, JSON_FIXTURE, 'src/main/resources/billing.json');
      // No candidates with name 'BillingApi' / basePath '/api/v1/invoices' / tag.
      const candidates: DiscoveryCandidate[] = [
        makeIface('IF-other', 'PetStoreApi', { basePath: '/api/v1/pets' }),
      ];

      const out = runSpecFileLinker({
        repoRoot: repo,
        serviceRootPath: null,
        existingInterfaceCandidates: candidates,
        runContext: RUN_CONTEXT,
      });

      expect(out.findings).toHaveLength(1);
      const finding = out.findings[0];
      expect(finding.findingType).toBe('evidence_gap');
      const detail = finding.detailJson as Record<string, unknown>;
      expect(detail.gapType).toBe('oas_spec_orphan');
      expect(detail.specFilePath).toBe('src/main/resources/billing.json');
      // No spec_link change on the distractor candidate.
      const other = out.updatedCandidates.find((c) => c.id === 'IF-other')!;
      expect(other.data.spec_link).toBeUndefined();
    } finally {
      cleanup(repo);
    }
  });

  // =========================================================================
  // Test 5: diagnostic log line shapes (start / per-file / done).
  // =========================================================================
  it('Test 5: emits the enumerated diagnostic log line shapes (start / per-file / done) with the [diag-pack] scanner=spec_file_linker prefix', () => {
    const repo = makeRepo();
    try {
      copyFixtureInto(repo, YAML_FIXTURE, 'src/main/resources/openapi.yaml');
      const candidates: DiscoveryCandidate[] = [
        makeIface('IF-pet', 'PetStoreApi', { basePath: '/api/v1/pets' }),
      ];

      const out = runSpecFileLinker({
        repoRoot: repo,
        serviceRootPath: null,
        existingInterfaceCandidates: candidates,
        runContext: RUN_CONTEXT,
      });

      // Sanity: scanner picked up the file and matched it.
      const updated = out.updatedCandidates.find((c) => c.id === 'IF-pet')!;
      expect(updated.data.spec_link).toBe('src/main/resources/openapi.yaml');

      // All logged messages.
      const messages = logSpy.mock.calls.map((call) => String(call[0]));

      // Every line must carry the documented prefix.
      const linkerLines = messages.filter((m) =>
        m.startsWith('[diag-pack] scanner=spec_file_linker'),
      );
      expect(linkerLines.length).toBeGreaterThan(0);

      // Start line: `start files=<N>`.
      expect(
        linkerLines.some((m) => /start files=\d+/.test(m)),
      ).toBe(true);

      // Per-file line shape: `file=<rel> kind=openapi-3 result=matched`.
      expect(
        linkerLines.some(
          (m) =>
            m.includes('file=src/main/resources/openapi.yaml') &&
            m.includes('kind=openapi-3') &&
            m.includes('result=matched'),
        ),
      ).toBe(true);

      // Done line: `done matched=1 ambiguous=0 orphan=0 skipped=0`.
      expect(
        linkerLines.some(
          (m) =>
            m.includes('done') &&
            m.includes('matched=1') &&
            m.includes('ambiguous=0') &&
            m.includes('orphan=0') &&
            m.includes('skipped=0'),
        ),
      ).toBe(true);
    } finally {
      cleanup(repo);
    }
  });
});
