/**
 * RepoLookupTableBuilder tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 3.
 */

import * as path from 'path';
import { buildRepoLookupTable } from '../../services/repoLookupTableBuilder';
import { clearRegistry, registerDependencyResolver } from '../../services/dependencyResolverRegistry';
import { mavenDependencyResolver } from '../../services/dependencyResolvers/maven/MavenDependencyResolver';
import { npmDependencyResolver } from '../../services/dependencyResolvers/npm/NpmDependencyResolver';

const FIX_ROOT = path.join(__dirname, '..', 'fixtures', 'dependencyResolvers');

describe('buildRepoLookupTable', () => {
  beforeEach(() => {
    clearRegistry();
    registerDependencyResolver(mavenDependencyResolver);
    registerDependencyResolver(npmDependencyResolver);
  });

  afterAll(() => {
    clearRegistry();
  });

  it('builds 1 maven entry from a single-module Maven repo', async () => {
    const table = await buildRepoLookupTable(path.join(FIX_ROOT, 'maven-single-module'));
    expect(table.maven.size).toBe(1);
    expect(table.maven.get('com.example:my-service')).toBe('');
    expect(table.npm.size).toBe(0);
  });

  it('builds 3 maven entries from a multi-module aggregator (parent + 2 modules)', async () => {
    const table = await buildRepoLookupTable(path.join(FIX_ROOT, 'maven-multi-module'));
    expect(table.maven.size).toBe(3);
    expect(table.maven.get('com.example:aggregator')).toBe('');
    expect(table.maven.get('com.example:module-a')).toBe('module-a');
    expect(table.maven.get('com.example:module-b')).toBe('module-b');
  });

  it('builds 3 npm entries from a workspace-style repo and skips node_modules', async () => {
    const table = await buildRepoLookupTable(path.join(FIX_ROOT, 'npm-workspaces'));
    expect(table.npm.size).toBe(3);
    expect(table.npm.has('@example/workspace-root')).toBe(true);
    expect(table.npm.has('@example/pkg-a')).toBe(true);
    expect(table.npm.has('@example/pkg-b')).toBe(true);
    // node_modules/some-pkg/package.json must NOT be in the table.
    expect(table.npm.has('some-pkg')).toBe(false);
    expect(table.maven.size).toBe(0);
  });
});
