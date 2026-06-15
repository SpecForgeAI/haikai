/**
 * MavenDependencyResolver tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * Fixture-based: every fixture lives under
 * `discovery-service/src/__tests__/fixtures/dependencyResolvers/`.
 */

import * as path from 'path';
import { MavenDependencyResolver } from '../../services/dependencyResolvers/maven/MavenDependencyResolver';

const FIX_ROOT = path.join(
  __dirname,
  '..',
  'fixtures',
  'dependencyResolvers',
);

describe('MavenDependencyResolver', () => {
  const resolver = new MavenDependencyResolver();

  it('parses a single-module pom.xml — names, scopes, default-compile, ${propname}, ranges', async () => {
    const repoRoot = path.join(FIX_ROOT, 'maven-single-module');
    const manifests = await resolver.findManifests(repoRoot);
    expect(manifests).toHaveLength(1);

    const deps = await resolver.resolve(repoRoot, manifests[0]);

    // Verify all 6 declared deps are emitted (none in dependencyManagement here).
    expect(deps).toHaveLength(6);

    // Spring core: default scope = compile, version verbatim.
    const spring = deps.find((d) => d.name === 'org.springframework:spring-core')!;
    expect(spring).toBeDefined();
    expect(spring.version).toBe('5.3.20');
    expect(spring.versionRange).toBeUndefined();
    expect(spring.scope).toBe('compile');

    // Jackson: ${propname} stored verbatim per locked contract — NO resolution.
    const jackson = deps.find(
      (d) => d.name === 'com.fasterxml.jackson.core:jackson-databind',
    )!;
    expect(jackson.version).toBe('${jackson.version}');
    expect(jackson.versionRange).toBeUndefined();

    // junit: explicit test scope.
    const junit = deps.find((d) => d.name === 'junit:junit')!;
    expect(junit.scope).toBe('test');

    // servlet-api: explicit provided scope.
    const servlet = deps.find((d) => d.name === 'javax.servlet:servlet-api')!;
    expect(servlet.scope).toBe('provided');

    // optional-lib: <optional>true</optional> → scope='optional'.
    const optional = deps.find((d) => d.name === 'org.example:optional-lib')!;
    expect(optional.scope).toBe('optional');

    // ranged-lib: [1.0,2.0) → versionRange verbatim, version undefined.
    const ranged = deps.find((d) => d.name === 'org.example:ranged-lib')!;
    expect(ranged.version).toBeUndefined();
    expect(ranged.versionRange).toBe('[1.0,2.0)');
  });

  it('walks a multi-module aggregator — finds 3 poms and emits coordinates per pom', async () => {
    const repoRoot = path.join(FIX_ROOT, 'maven-multi-module');
    const manifests = await resolver.findManifests(repoRoot);
    expect(manifests.sort()).toHaveLength(3);

    const coords = await Promise.all(
      manifests.map((m) => resolver.extractCoordinates(repoRoot, m)),
    );
    const names = coords.map((c) => c?.name).sort();

    // Aggregator + 2 modules. module-a / module-b inherit groupId from <parent>.
    expect(names).toEqual([
      'com.example:aggregator',
      'com.example:module-a',
      'com.example:module-b',
    ]);

    // module-a's coordinates should report `module-a` as the subfolder.
    const moduleA = coords.find((c) => c?.name === 'com.example:module-a')!;
    expect(moduleA.subfolder).toBe('module-a');
  });

  it('skips manifests inside excluded dirs (target, node_modules, .gradle)', async () => {
    const repoRoot = path.join(FIX_ROOT, 'maven-exclusions');
    const manifests = await resolver.findManifests(repoRoot);

    // Only the root pom.xml — the 3 inside excluded dirs must NOT be returned.
    expect(manifests).toHaveLength(1);
    expect(manifests[0].endsWith('pom.xml')).toBe(true);
    expect(manifests[0]).not.toMatch(/target/);
    expect(manifests[0]).not.toMatch(/node_modules/);
    expect(manifests[0]).not.toMatch(/\.gradle/);
  });
});
