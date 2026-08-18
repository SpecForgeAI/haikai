/**
 * Unit pins — SCL execution integration (spec 10 of 10, 2026-08-18).
 *
 *   - basePackage: confirmed maven_pom coordinates (parent block never wins
 *     over the project's own groupId); no pom / no groupId → null.
 *   - buildSclInitialCommit: suite files + scl-suite-manifest.json (manifest
 *     JSON carries the generator stats) + the pinned first-commit message;
 *     fail-soft basePackage default with a warning; hard failures THROW
 *     (missing keys / unresolvable contracts) — the driver owns fail-soft.
 *   - evaluateSclSuiteIntegrity: not_scl / skipped (fail-soft) / intact /
 *     SCL_SUITE_MODIFIED detection / per-spec + run-level quarantine
 *     thresholds with decision-log accounting.
 */

import { createHash } from 'node:crypto';
import {
  SCL_DEFAULT_BASE_PACKAGE,
  SCL_INITIAL_COMMIT_MESSAGE,
  SCL_SUITE_MANIFEST_PATH,
  buildSclInitialCommit,
  deriveBasePackageFromManifests,
  evaluateSclSuiteIntegrity,
} from '../migrationSclExecution';
import { SclContractDto } from '../sclCorpusPlanner';
import { TargetManifestArtifactWire } from '../targetManifestArtifactsClient';
import { JobFileHashesResult } from '../migrationOrchestrationSubmit';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';

function contracts(): SclContractDto[] {
  return [
    {
      contract_key: 'T-GET',
      kind: 'behaviour_table',
      source_path: 'src/com/app/OrdersController.java',
      source_symbol: GET_ORDER,
      fan_in: 1,
      roots_json: { roots: [GET_ORDER] },
      body_json: {
        symbol: GET_ORDER,
        annotations: ['@GET', '@Path("/orders/{id}")'],
        rows: [
          {
            index: 0,
            kind: 'branch',
            conditionVerbatim: 'if (id == null)',
            conditionRef: { path: 'src/com/app/OrdersController.java', line: 42 },
            outcome: {
              type: 'terminal',
              verbatim: 'throw new BadRequestException("id required")',
              outcomeLabel: 'throws:BadRequestException',
            },
          },
        ],
        references: [],
      },
    },
  ];
}

function pomArtifact(content: string): TargetManifestArtifactWire {
  return {
    id: 'a-1',
    project_id: 'proj-001',
    target_architecture_id: 'arch-target-001',
    tag: 'service',
    kind: 'maven_pom',
    ecosystem: 'maven',
    manifest_path: 'pom.xml',
    content,
    package_lock_content: null,
    resolved_dependencies: [],
    is_latest: true,
    created_at: '2026-08-18T00:00:00Z',
  };
}

const POM = `<?xml version="1.0"?>
<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.0</version>
  </parent>
  <groupId>com.legacy.hier</groupId>
  <artifactId>hier-service</artifactId>
  <version>0.0.1-SNAPSHOT</version>
</project>
`;

function story() {
  return {
    title: 'Implement OrdersController (1 endpoints)',
    tags: ['provenance:scl_corpus', 'scl', 'scl:endpoint:external'],
    sclContractKeys: ['T-GET'],
    sclLayer: 'endpoint:external',
    sclControllerClass: 'com.app.OrdersController',
  };
}

// ---------------------------------------------------------------------------
// basePackage derivation
// ---------------------------------------------------------------------------

describe('deriveBasePackageFromManifests', () => {
  it('derives groupId.artifactId from the confirmed maven pom (parent block never wins)', () => {
    expect(deriveBasePackageFromManifests([pomArtifact(POM)])).toBe(
      'com.legacy.hier.hierservice'
    );
  });

  it('falls back to the parent groupId only when the project inherits it (own artifactId still wins)', () => {
    const inheriting = POM.replace('<groupId>com.legacy.hier</groupId>\n', '');
    expect(deriveBasePackageFromManifests([pomArtifact(inheriting)])).toBe(
      'org.springframework.boot.hierservice'
    );
  });

  it('null when no maven pom / no groupId resolves', () => {
    expect(deriveBasePackageFromManifests([])).toBeNull();
    expect(
      deriveBasePackageFromManifests([pomArtifact('<project><artifactId>x</artifactId></project>')])
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSclInitialCommit
// ---------------------------------------------------------------------------

describe('buildSclInitialCommit', () => {
  it('returns the suite files + the manifest sidecar with stats, the pinned message, and the manifest-derived basePackage', async () => {
    const result = await buildSclInitialCommit({
      projectId: 'proj-001',
      currentArchitectureId: 'arch-current-001',
      targetArchitectureId: 'arch-target-001',
      story: story(),
      deps: {
        fetchSclContracts: async () => contracts(),
        fetchManifestArtifacts: async () => [pomArtifact(POM)],
      },
    });
    expect(result.message).toBe(SCL_INITIAL_COMMIT_MESSAGE);
    expect(result.basePackage).toBe('com.legacy.hier.hierservice');
    expect(result.warnings).toEqual([]);
    expect(result.suiteTestCount).toBeGreaterThan(0);

    const manifestFile = result.files.find((f) => f.path === SCL_SUITE_MANIFEST_PATH);
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as {
      files: Array<{ path: string; sha256: string }>;
      stats: { rowTests: number; goldenPaths: number; fixtureBuilders: number };
    };
    // The manifest accounts for every suite file (all files except itself).
    const suitePaths = result.files
      .filter((f) => f.path !== SCL_SUITE_MANIFEST_PATH)
      .map((f) => f.path)
      .sort();
    expect(manifest.files.map((f) => f.path).sort()).toEqual(suitePaths);
    expect(manifest.stats.rowTests + manifest.stats.goldenPaths).toBe(
      result.suiteTestCount
    );
    // Generated Java lands under the derived base package.
    expect(
      suitePaths.some((p) => p.startsWith('src/test/java/com/legacy/hier/hierservice/'))
    ).toBe(true);
  });

  it('fail-soft basePackage: manifest read failure → default package + warning (the suite still builds)', async () => {
    const result = await buildSclInitialCommit({
      projectId: 'proj-001',
      currentArchitectureId: 'arch-current-001',
      targetArchitectureId: 'arch-target-001',
      story: story(),
      deps: {
        fetchSclContracts: async () => contracts(),
        fetchManifestArtifacts: async () => {
          throw new Error('AMS down');
        },
      },
    });
    expect(result.basePackage).toBe(SCL_DEFAULT_BASE_PACKAGE);
    expect(result.warnings.some((w) => w.includes('AMS down'))).toBe(true);
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('THROWS on hard failures (no scan / unresolvable keys) — the driver owns fail-soft', async () => {
    await expect(
      buildSclInitialCommit({
        projectId: 'proj-001',
        currentArchitectureId: 'arch-current-001',
        targetArchitectureId: 'arch-target-001',
        story: story(),
        deps: {
          fetchSclContracts: async () => null,
          fetchManifestArtifacts: async () => [],
        },
      })
    ).rejects.toThrow('no SCL scan');

    await expect(
      buildSclInitialCommit({
        projectId: 'proj-001',
        currentArchitectureId: 'arch-current-001',
        targetArchitectureId: 'arch-target-001',
        story: { ...story(), sclContractKeys: ['T-MISSING'] },
        deps: {
          fetchSclContracts: async () => contracts(),
          fetchManifestArtifacts: async () => [],
        },
      })
    ).rejects.toThrow("'T-MISSING'");
  });
});

// ---------------------------------------------------------------------------
// evaluateSclSuiteIntegrity
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const TEST_PATH = 'src/test/java/com/example/app/behaviour/Foo_barBehaviourTest.java';
const TEST_CONTENT = 'class Foo_barBehaviourTest {}\n';

function manifestJson(args?: { rowTests?: number; goldenPaths?: number }): string {
  return JSON.stringify({
    generated_at_note: 'static',
    files: [{ path: TEST_PATH, sha256: sha256(TEST_CONTENT) }],
    contract_keys: ['T-GET'],
    story_title: 'Implement OrdersController (1 endpoints)',
    stats: {
      fixtureBuilders: 0,
      rowTests: args?.rowTests ?? 10,
      goldenPaths: args?.goldenPaths ?? 0,
    },
  });
}

function hashesResult(overrides: Partial<JobFileHashesResult>): JobFileHashesResult {
  return {
    ok: true,
    branch: 'feature/spec-1',
    hashes: [{ path: TEST_PATH, sha256: sha256(TEST_CONTENT) }],
    manifest: manifestJson(),
    quarantine: null,
    ...overrides,
  };
}

function quarantineJson(count: number): string {
  return JSON.stringify({
    version: 1,
    entries: Array.from({ length: count }, (_, i) => ({
      test_path: TEST_PATH,
      test_method: `row${i}_case`,
      contract_key: 'T-GET',
      row_index: i,
      contest_evidence: 'the row misreads the source',
      verdict: 'upheld',
      arbitrated_at: '2026-08-18T00:00:00Z',
    })),
  });
}

describe('evaluateSclSuiteIntegrity', () => {
  it('non-SCL story → not_scl without any IVS read (zero behaviour change)', async () => {
    const fetchFileHashes = jest.fn();
    const verdict = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['stream:api_migration'],
      runDecisionLog: [],
      deps: { fetchFileHashes },
    });
    expect(verdict).toEqual({ kind: 'not_scl' });
    expect(fetchFileHashes).not.toHaveBeenCalled();
  });

  it('fail-soft: IVS read failure / missing manifest → skipped with the reason', async () => {
    const failed = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: {
        fetchFileHashes: async () => hashesResult({ ok: false, error: 'HTTP 409' }),
      },
    });
    expect(failed.kind).toBe('skipped');

    const noManifest = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: { fetchFileHashes: async () => hashesResult({ manifest: null }) },
    });
    expect(noManifest.kind).toBe('skipped');
  });

  it('intact suite, no quarantines → checked verdict with a decision-log entry and no halts', async () => {
    const verdict = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: { fetchFileHashes: async () => hashesResult({}) },
    });
    expect(verdict.kind).toBe('checked');
    if (verdict.kind !== 'checked') return;
    expect(verdict.intact).toBe(true);
    expect(verdict.haltSpec).toBe(false);
    expect(verdict.haltRun).toBe(false);
    expect(verdict.decisionEntry).toMatchObject({
      type: 'scl_suite_verdict',
      run_item_id: 'ri-1',
      suite_tests: 10,
      quarantined: 0,
    });
  });

  it('a modified / missing shipped file → SCL_SUITE_MODIFIED facts on the verdict', async () => {
    const verdict = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: {
        fetchFileHashes: async () =>
          hashesResult({
            hashes: [{ path: TEST_PATH, sha256: sha256('tampered!\n') }],
          }),
      },
    });
    expect(verdict.kind).toBe('checked');
    if (verdict.kind !== 'checked') return;
    expect(verdict.intact).toBe(false);
    expect(verdict.modified).toEqual([TEST_PATH]);

    const gone = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: { fetchFileHashes: async () => hashesResult({ hashes: [] }) },
    });
    expect(gone.kind).toBe('checked');
    if (gone.kind !== 'checked') return;
    expect(gone.missing).toEqual([TEST_PATH]);
  });

  it('per-spec quarantine rate over the threshold → haltSpec (3/10 > 20%)', async () => {
    const verdict = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-1',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [],
      deps: {
        fetchFileHashes: async () =>
          hashesResult({ quarantine: quarantineJson(3) }),
      },
    });
    expect(verdict.kind).toBe('checked');
    if (verdict.kind !== 'checked') return;
    expect(verdict.quarantined).toBe(3);
    expect(verdict.haltSpec).toBe(true);
  });

  it('run-level aggregate rate over the threshold → haltRun (prior decision-log entries feed the totals)', async () => {
    // This spec: 1/10 quarantined (10% — under the 20% spec threshold), but
    // the RUN has 190 prior tests with 11 prior quarantines → aggregate
    // 12/200 = 6% > the 5% run threshold.
    const verdict = await evaluateSclSuiteIntegrity({
      jobId: 'job-1',
      runItemId: 'ri-2',
      storyTags: ['provenance:scl_corpus'],
      runDecisionLog: [
        { type: 'scl_suite_verdict', run_item_id: 'ri-1', suite_tests: 190, quarantined: 11 },
        // An entry for the CURRENT item (a retry) is excluded from the totals.
        { type: 'scl_suite_verdict', run_item_id: 'ri-2', suite_tests: 999, quarantined: 999 },
      ],
      deps: {
        fetchFileHashes: async () =>
          hashesResult({ quarantine: quarantineJson(1) }),
      },
    });
    expect(verdict.kind).toBe('checked');
    if (verdict.kind !== 'checked') return;
    expect(verdict.haltSpec).toBe(false);
    expect(verdict.haltRun).toBe(true);
    expect(verdict.runRate).toBeCloseTo(12 / 200);
  });
});
