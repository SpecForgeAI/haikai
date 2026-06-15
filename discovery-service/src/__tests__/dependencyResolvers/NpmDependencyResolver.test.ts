/**
 * NpmDependencyResolver tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 */

import * as path from 'path';
import { NpmDependencyResolver } from '../../services/dependencyResolvers/npm/NpmDependencyResolver';

const FIX_ROOT = path.join(
  __dirname,
  '..',
  'fixtures',
  'dependencyResolvers',
);

describe('NpmDependencyResolver', () => {
  const resolver = new NpmDependencyResolver();

  it('parses a root package.json across all 4 source-keys with scoped names verbatim', async () => {
    const repoRoot = path.join(FIX_ROOT, 'npm-root-only');
    const manifests = await resolver.findManifests(repoRoot);
    expect(manifests).toHaveLength(1);

    const deps = await resolver.resolve(repoRoot, manifests[0]);

    // 3 dependencies + 2 devDependencies + 1 peerDependencies + 1 optionalDependencies = 7.
    expect(deps).toHaveLength(7);

    // Scoped name kept verbatim with `@scope/` prefix per locked contract.
    const scoped = deps.find((d) => d.name === '@scope/some-pkg')!;
    expect(scoped).toBeDefined();
    expect(scoped.version).toBe('1.2.3');
    // Pinned literal — versionRange stays undefined.
    expect(scoped.versionRange).toBeUndefined();
    expect(scoped.scope).toBe('dependencies');

    // ^18.2.0 — range detection populates versionRange while keeping version verbatim.
    const react = deps.find((d) => d.name === 'react')!;
    expect(react.version).toBe('^18.2.0');
    expect(react.versionRange).toBe('^18.2.0');
    expect(react.scope).toBe('dependencies');

    // Wildcard `*` is a range.
    const lodash = deps.find((d) => d.name === 'lodash')!;
    expect(lodash.version).toBe('*');
    expect(lodash.versionRange).toBe('*');

    // dev / peer / optional scopes are surfaced verbatim.
    const ts = deps.find((d) => d.name === 'typescript')!;
    expect(ts.scope).toBe('devDependencies');
    const reactDom = deps.find((d) => d.name === 'react-dom')!;
    expect(reactDom.scope).toBe('peerDependencies');
    const fsevents = deps.find((d) => d.name === 'fsevents')!;
    expect(fsevents.scope).toBe('optionalDependencies');
  });

  it('walks workspaces (3 package.jsons) and skips node_modules', async () => {
    const repoRoot = path.join(FIX_ROOT, 'npm-workspaces');
    const manifests = await resolver.findManifests(repoRoot);

    // Root + pkg-a + pkg-b = 3. The node_modules/some-pkg/package.json is
    // excluded by the walker.
    expect(manifests).toHaveLength(3);
    for (const m of manifests) {
      expect(m).not.toMatch(/node_modules/);
    }

    const coords = await Promise.all(
      manifests.map((m) => resolver.extractCoordinates(repoRoot, m)),
    );
    const names = coords.map((c) => c?.name).sort();
    expect(names).toEqual([
      '@example/pkg-a',
      '@example/pkg-b',
      '@example/workspace-root',
    ]);
  });
});
