/**
 * librarySourceResolver tests.
 *
 * Spec 2026-05-20 Discovery Library-Scoped Run Fixes — Task Group 2a.
 *
 * Fixture layouts (under
 * `discovery-service/src/__tests__/fixtures/librarySourceResolver/`):
 *
 *   maven-siblings/
 *     root-repo/pom.xml            <-- the root entity's repo
 *     hifi-core/pom.xml            <-- sibling, groupId+artifactId match
 *     hifi-db/pom.xml              <-- sibling, groupId+artifactId match
 *     unrelated/pom.xml            <-- sibling, NO match
 *
 *   npm-siblings/
 *     root-app/package.json        <-- the root entity's repo
 *     pkg-shared/package.json      <-- sibling, name match
 *     unrelated/package.json       <-- sibling, NO match
 *
 *   maven-subfolder/
 *     root-repo/pom.xml            <-- the root entity's repo
 *     root-repo/internal-lib/pom.xml  <-- subfolder, expected match
 *
 *   maven-multi-match/
 *     root-repo/pom.xml
 *     dup-a/pom.xml                <-- both siblings declare the same
 *     dup-b/pom.xml                <-- groupId:artifactId coordinate
 */

import * as path from 'path';
import { resolveLibrarySource } from '../../services/librarySourceResolver';

const FIX_ROOT = path.join(__dirname, '..', 'fixtures', 'librarySourceResolver');

describe('resolveLibrarySource', () => {
  // ---------------------------------------------------------------
  // Maven: sibling-folder fallback
  // ---------------------------------------------------------------
  it('Maven: resolves a sibling folder by groupId+artifactId match', async () => {
    const rootRepo = path.join(FIX_ROOT, 'maven-siblings', 'root-repo');
    const result = await resolveLibrarySource(
      'com.rbs.mib.risk.hifi:hifi-core',
      '', // subfolder hint absent — sibling fallback path
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchKind).toBe('sibling-folder');
    expect(path.basename(result[0].sourceDir)).toBe('hifi-core');
    expect(result[0].manifestPath).toMatch(/hifi-core[\\/]+pom\.xml$/);
  });

  it('Maven: does NOT false-match a sibling whose <dependencies> include the target coordinate', async () => {
    // hifi-core/pom.xml declares org.springframework:spring-core as a
    // dependency. A naive regex match would surface hifi-core as a match
    // when querying for spring-core; the scrubber must prevent that.
    const rootRepo = path.join(FIX_ROOT, 'maven-siblings', 'root-repo');
    const result = await resolveLibrarySource(
      'org.springframework:spring-core',
      '',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(0);
  });

  it('Maven: returns empty array when no sibling matches', async () => {
    const rootRepo = path.join(FIX_ROOT, 'maven-siblings', 'root-repo');
    const result = await resolveLibrarySource(
      'com.nothing:not-here',
      '',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(0);
  });

  it('Maven: returns ALL matches when multiple siblings declare the same coordinate', async () => {
    const rootRepo = path.join(FIX_ROOT, 'maven-multi-match', 'root-repo');
    const result = await resolveLibrarySource(
      'com.example:duplicated',
      '',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.matchKind === 'sibling-folder')).toBe(true);
    const names = result.map((r) => path.basename(r.sourceDir)).sort();
    expect(names).toEqual(['dup-a', 'dup-b']);
  });

  // ---------------------------------------------------------------
  // NPM: sibling-folder fallback
  // ---------------------------------------------------------------
  it('NPM: resolves a sibling folder by package.json name match', async () => {
    const rootRepo = path.join(FIX_ROOT, 'npm-siblings', 'root-app');
    const result = await resolveLibrarySource(
      '@org/pkg-shared',
      '',
      rootRepo,
      'NPM',
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchKind).toBe('sibling-folder');
    expect(path.basename(result[0].sourceDir)).toBe('pkg-shared');
    expect(result[0].manifestPath).toMatch(/pkg-shared[\\/]+package\.json$/);
  });

  it('NPM: returns empty array when no sibling has a matching name', async () => {
    const rootRepo = path.join(FIX_ROOT, 'npm-siblings', 'root-app');
    const result = await resolveLibrarySource(
      '@org/not-here',
      '',
      rootRepo,
      'NPM',
    );
    expect(result).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Subfolder-first behaviour
  // ---------------------------------------------------------------
  it('Maven: subfolder-first wins when <rootRepoDir>/<repoSubfolder>/pom.xml exists', async () => {
    const rootRepo = path.join(FIX_ROOT, 'maven-subfolder', 'root-repo');
    const result = await resolveLibrarySource(
      'com.example:internal-lib',
      'internal-lib',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchKind).toBe('subfolder');
    expect(path.basename(result[0].sourceDir)).toBe('internal-lib');
  });

  it('Maven: subfolder hint pointing at a nonexistent path falls through to sibling fallback', async () => {
    // maven-siblings has no `nonexistent-sub` subfolder; the fallback
    // should still locate hifi-core.
    const rootRepo = path.join(FIX_ROOT, 'maven-siblings', 'root-repo');
    const result = await resolveLibrarySource(
      'com.rbs.mib.risk.hifi:hifi-core',
      'nonexistent-sub',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchKind).toBe('sibling-folder');
    expect(path.basename(result[0].sourceDir)).toBe('hifi-core');
  });

  // ---------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------
  it('Maven: malformed coordinate (no colon) returns empty array', async () => {
    const rootRepo = path.join(FIX_ROOT, 'maven-siblings', 'root-repo');
    const result = await resolveLibrarySource(
      'malformed-no-colon',
      '',
      rootRepo,
      'MAVEN',
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty array when the parent directory does not exist', async () => {
    // A rootRepoDir like 'C:/nope/never' has no parent on disk; resolver
    // must not throw and must return an empty array.
    const result = await resolveLibrarySource(
      'com.example:whatever',
      '',
      '/definitely-not-a-real-path-12345/root-repo',
      'MAVEN',
    );
    expect(result).toHaveLength(0);
  });
});
