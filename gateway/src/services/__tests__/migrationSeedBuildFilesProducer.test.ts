/**
 * Task Group 5 tests (Spec 5 Phase 2) — real SeedBuildFilesSource producer.
 *
 * Spec: 2026-06-25-confirmed-manifest-producer-wiring, tasks 5.1 / 5.2-5.3.
 *
 * Covers ONLY the contract this group owns (per the 2-8 focused-tests budget):
 *   (a) the bundle output — confirmedArtifactsToSeedBundle produces correct
 *       per-tag `<tag>/` placement with VERBATIM content;
 *   (b) distinct tags resolve independently;
 *   (c) the NO-OP path — `targetArchitectureId` absent OR the read returns
 *       nothing -> source returns `null`;
 *   (d) FAIL-SOFT — a read hiccup (the stubbed read throws) is caught + logged
 *       and degrades to `null` (no throw into the batch).
 *
 * The AMS read is injected as a stub; no live AMS required. To confirm the
 * resolved per-module destination path, each returned manifest is run through the
 * SAME destination resolver the carriage uses.
 */

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../logger');

import {
  createProductionSeedBuildFilesSource,
  wireRowToArtifactLike,
  buildConventionServiceModuleMapping,
  type FetchLatestTargetManifestArtifacts,
} from '../migrationSeedBuildFilesProducer';
import { attachResolvedDestination } from '../seedBuildFileDestination';
import type { TargetManifestArtifactWire } from '../targetManifestArtifactsClient';

const PROJECT_ID = 'proj-1';
const TARGET_ARCH_ID = 'arch-9';
const BOOK_ID = 'book-7';

const POM = '<project>\n  <artifactId>orders</artifactId>\n</project>\n';
const PKG = '{\n  "name": "web-app"\n}\n';

function wireRow(
  tag: string,
  kind: string,
  manifestPath: string,
  content: string,
  overrides: Partial<TargetManifestArtifactWire> = {},
): TargetManifestArtifactWire {
  return {
    id: `row-${tag}`,
    project_id: PROJECT_ID,
    target_architecture_id: TARGET_ARCH_ID,
    tag,
    kind,
    ecosystem: kind === 'maven_pom' ? 'MAVEN' : 'NPM',
    manifest_path: manifestPath,
    content,
    package_lock_content: null,
    resolved_dependencies: [],
    is_latest: true,
    created_at: '2026-06-25T00:00:00Z',
    ...overrides,
  };
}

function stubRead(rows: TargetManifestArtifactWire[]): {
  fetch: FetchLatestTargetManifestArtifacts;
  calls: Array<{ projectId: string; targetArchitectureId: string }>;
} {
  const calls: Array<{ projectId: string; targetArchitectureId: string }> = [];
  const fetch: FetchLatestTargetManifestArtifacts = async (projectId, targetArchitectureId) => {
    calls.push({ projectId, targetArchitectureId });
    return rows;
  };
  return { fetch, calls };
}

beforeEach(() => {
  (logger.info as jest.Mock).mockReset();
  (logger.warn as jest.Mock).mockReset();
});

// ===========================================================================
// (a) + (b) bundle output: per-tag `<tag>/` placement, verbatim content
// ===========================================================================

test('a SINGLE confirmed artifact places its build file at the REPO ROOT (2026-08-14)', async () => {
  const { fetch, calls } = stubRead([
    wireRow('orders-service', 'maven_pom', 'pom.xml', POM),
  ]);
  const source = createProductionSeedBuildFilesSource(fetch);

  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });

  expect(calls).toEqual([{ projectId: PROJECT_ID, targetArchitectureId: TARGET_ARCH_ID }]);
  expect(bundle).not.toBeNull();
  expect(bundle!.layout).toBe('monorepo');
  expect(bundle!.manifests).toHaveLength(1);

  const m = bundle!.manifests[0];
  expect(m.fileName).toBe('pom.xml');
  expect(m.serviceTag).toBe('orders-service');
  // Verbatim content carried byte-for-byte (trailing newline preserved).
  expect(m.content).toBe(POM);

  // Single-service repo: the build file IS the application's root build file.
  // (The prior `<tag>/pom.xml` convention buried it in a subdirectory the
  // build tool never reads — the scaffolded app could not build.)
  const { destination } = attachResolvedDestination(m, bundle!.mapping, bundle!.layout);
  expect(destination.resolved).toBe(true);
  if (destination.resolved) {
    expect(destination.destinationPath).toBe('pom.xml');
  }
});

test('distinct tags resolve independently to distinct `<tag>/` paths', async () => {
  const { fetch } = stubRead([
    wireRow('orders-service', 'maven_pom', 'pom.xml', POM),
    wireRow('web-app', 'npm_package', 'package.json', PKG),
  ]);
  const source = createProductionSeedBuildFilesSource(fetch);

  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });

  expect(bundle).not.toBeNull();
  expect(bundle!.manifests).toHaveLength(2);

  const byTag = Object.fromEntries(
    bundle!.manifests.map((m) => {
      const { destination } = attachResolvedDestination(m, bundle!.mapping, bundle!.layout);
      return [m.serviceTag, destination.resolved ? destination.destinationPath : null];
    }),
  );
  expect(byTag['orders-service']).toBe('orders-service/pom.xml');
  expect(byTag['web-app']).toBe('web-app/package.json');

  // Each carries its own verbatim content.
  const pom = bundle!.manifests.find((m) => m.serviceTag === 'orders-service')!;
  const pkg = bundle!.manifests.find((m) => m.serviceTag === 'web-app')!;
  expect(pom.content).toBe(POM);
  expect(pkg.content).toBe(PKG);
});

// ===========================================================================
// (c) NO-OP path
// ===========================================================================

test('returns null when targetArchitectureId is absent (safe no-op)', async () => {
  const { fetch, calls } = stubRead([wireRow('x', 'maven_pom', 'pom.xml', POM)]);
  const source = createProductionSeedBuildFilesSource(fetch);

  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: null,
  });
  expect(bundle).toBeNull();
  // The read is not even attempted when there is no key.
  expect(calls).toHaveLength(0);
});

test('returns null when the read returns nothing (safe no-op)', async () => {
  const { fetch } = stubRead([]);
  const source = createProductionSeedBuildFilesSource(fetch);

  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });
  expect(bundle).toBeNull();
});

// ===========================================================================
// (d) FAIL-SOFT read hiccup -> null
// ===========================================================================

test('a read hiccup is caught + logged and degrades to null (no throw into the batch)', async () => {
  const fetch: FetchLatestTargetManifestArtifacts = async () => {
    throw new Error('simulated AMS manifest-artifacts read 503');
  };
  const source = createProductionSeedBuildFilesSource(fetch);

  // Must NOT throw.
  const bundle = await source({
    projectId: PROJECT_ID,
    bookOfWorkId: BOOK_ID,
    targetArchitectureId: TARGET_ARCH_ID,
  });
  expect(bundle).toBeNull();

  const failLogs = (logger.warn as jest.Mock).mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === 'string' &&
      c[0].includes('[diag-gateway]') &&
      c[0].includes('seed_producer_read_failed'),
  );
  expect(failLogs.length).toBeGreaterThanOrEqual(1);
});

// ===========================================================================
// helpers
// ===========================================================================

test('wireRowToArtifactLike maps snake_case wire fields + carries verbatim content', () => {
  const like = wireRowToArtifactLike(
    wireRow('svc', 'maven_pom', 'services/svc/pom.xml', POM, {
      resolved_dependencies: [{ name: 'a:b', versionUnknown: true } as Record<string, unknown>],
    }),
  );
  expect(like.tag).toBe('svc');
  expect(like.kind).toBe('maven_pom');
  expect(like.manifestPath).toBe('services/svc/pom.xml');
  expect(like.content).toBe(POM);
  expect(Array.isArray(like.resolvedDependencies)).toBe(true);
  expect(like.resolvedDependencies![0].versionUnknown).toBe(true);
});

test('buildConventionServiceModuleMapping maps each tag to { moduleDir: tag } and logs a blank tag', () => {
  const mapping = buildConventionServiceModuleMapping([
    { tag: 'orders-service', kind: 'maven_pom', manifestPath: 'pom.xml', content: POM },
    { tag: '  ', kind: 'npm_package', manifestPath: 'package.json', content: PKG },
  ]);
  expect(mapping['orders-service']).toEqual({ moduleDir: 'orders-service' });
  // A blank tag is left unmapped (the resolver will surface it as unresolved).
  expect(Object.keys(mapping)).toEqual(['orders-service']);

  const blankLogs = (logger.warn as jest.Mock).mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('seed_producer_blank_tag'),
  );
  expect(blankLogs.length).toBeGreaterThanOrEqual(1);
});
