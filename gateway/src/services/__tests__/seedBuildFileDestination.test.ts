/**
 * Task Group 2 tests — Destination-path resolver (service→module mapping).
 *
 * Spec: 2026-06-24-confirmed-manifest-to-target-codebase (Spec 5), task 2.1.
 *
 * Scope (2-8 focused tests) — ONLY the load-bearing behaviours:
 *   (a) monorepo default — a service tag resolves to its per-service MODULE
 *       directory + the build-file filename;
 *   (b) multi-repo — resolves to the per-repo ROOT;
 *   (c) MULTIPLE manifests route to distinct, correct paths;
 *   (d) a manifest whose tag has NO resolvable mapping is surfaced explicitly
 *       (logged, not silently dropped) and never guessed;
 *   (e) the resolved path feeds back into the Group 1 write-block (2.3).
 *
 * Exhaustive layout permutations are intentionally NOT covered.
 */

import { logger } from '../logger';
import {
  attachResolvedDestination,
  attachResolvedDestinations,
  isResolvedSeedDestination,
  resolveSeedFileDestination,
  ServiceModuleMapping,
} from '../seedBuildFileDestination';
import { SeedFileManifest, isRejectedSeedFile } from '../seedBuildFileWriteBlock';

jest.mock('../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const MAPPING: ServiceModuleMapping = {
  'orders-service': { moduleDir: 'services/orders-service', repoRoot: 'orders-service' },
  'web-ui': { moduleDir: 'apps/web-ui', repoRoot: 'web-ui' },
  // a placement that relies only on the layout-agnostic `dir` fallback:
  'billing-service': { dir: 'services/billing-service' },
};

function pomManifest(tag: string): SeedFileManifest {
  return { fileName: 'pom.xml', content: '<project/>', serviceTag: tag };
}
function pkgManifest(tag: string): SeedFileManifest {
  return { fileName: 'package.json', content: '{}', serviceTag: tag };
}

describe('resolveSeedFileDestination — service→module mapping (Spec 5, Group 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(a) monorepo default → <module-dir>/<fileName>', () => {
    const r = resolveSeedFileDestination(pomManifest('orders-service'), MAPPING);
    expect(isResolvedSeedDestination(r)).toBe(true);
    if (isResolvedSeedDestination(r)) {
      expect(r.layout).toBe('monorepo');
      expect(r.destinationPath).toBe('services/orders-service/pom.xml');
    }
    // The layout-agnostic `dir` fallback also resolves under monorepo.
    const billing = resolveSeedFileDestination(pomManifest('billing-service'), MAPPING);
    expect(isResolvedSeedDestination(billing) && billing.destinationPath).toBe(
      'services/billing-service/pom.xml',
    );
  });

  it('(b) multi-repo → <repo-root>/<fileName>', () => {
    const r = resolveSeedFileDestination(
      pkgManifest('web-ui'),
      MAPPING,
      'multi-repo',
    );
    expect(isResolvedSeedDestination(r)).toBe(true);
    if (isResolvedSeedDestination(r)) {
      expect(r.layout).toBe('multi-repo');
      expect(r.destinationPath).toBe('web-ui/package.json');
    }
  });

  it('(c) MULTIPLE manifests route to distinct, correct paths', () => {
    const results = attachResolvedDestinations(
      [pomManifest('orders-service'), pkgManifest('web-ui')],
      MAPPING,
    );
    expect(results).toHaveLength(2);
    const paths = results.map((x) =>
      isResolvedSeedDestination(x.destination) ? x.destination.destinationPath : null,
    );
    expect(paths).toEqual([
      'services/orders-service/pom.xml',
      'apps/web-ui/package.json',
    ]);
    // distinct
    expect(new Set(paths).size).toBe(2);
  });

  it('(d) an unmapped tag is surfaced + logged (no silent drop, no guess)', () => {
    const r = resolveSeedFileDestination(pomManifest('ghost-service'), MAPPING);
    expect(r.resolved).toBe(false);
    if (!isResolvedSeedDestination(r)) {
      expect(r.serviceTag).toBe('ghost-service');
      expect(r.reason).toMatch(/refusing to guess a path/i);
      // It must NOT have produced any path field.
      expect((r as unknown as { destinationPath?: string }).destinationPath).toBeUndefined();
    }
    const warnCalls = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(
      warnCalls.some((m) => m.includes('seed_destination_unresolved')),
    ).toBe(true);
  });

  it('(e) resolved path feeds back into the manifest + into the write-block (2.3)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildSeedFileWriteBlock } = require('../seedBuildFileWriteBlock');
    const { manifest, destination } = attachResolvedDestination(
      pkgManifest('web-ui'),
      MAPPING,
    );
    expect(isResolvedSeedDestination(destination)).toBe(true);
    expect(manifest.destinationPath).toBe('apps/web-ui/package.json');

    const block = buildSeedFileWriteBlock(manifest);
    expect(isRejectedSeedFile(block)).toBe(false);
    expect(block as string).toContain(
      'Destination path (write the file at EXACTLY this path): apps/web-ui/package.json',
    );

    // Unresolved feeds back as null so the block renders its UNRESOLVED notice.
    const ghost = attachResolvedDestination(pomManifest('ghost-service'), MAPPING);
    expect(ghost.manifest.destinationPath).toBeNull();
    expect(buildSeedFileWriteBlock(ghost.manifest) as string).toMatch(
      /Destination path: UNRESOLVED/,
    );
  });
});
