/**
 * Task Group 2 tests — Layered version resolution + "version-unknown".
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), task 2.1.
 *
 * Scope (2-8 focused tests):
 *   (a) a ${propname} version resolves via resolvePropertyRef against <properties>;
 *   (b) a versionless <dependency> recovers its managed version from
 *       <dependencyManagement> AND a Spring-managed starter recovers from <parent>;
 *   (c) an unmanaged ${...} / no-managed-match → "version-unknown" (no guessing);
 *   (d) an npm dep pins to its EXACT lockfile version when present, and an open
 *       range / latest / dist-tag WITHOUT a lockfile → "version-unknown".
 *
 * Exhaustive Maven/npm permutation coverage is intentionally skipped.
 */

import { logger } from '../../logger';
import {
  resolveMavenVersions,
  resolveNpmVersions,
  buildLockfileIndex,
  resolveManifestVersions,
  VERSION_UNKNOWN,
} from '../manifestVersionResolution';
import { resolveMavenManifest, resolveNpmManifest } from '../manifestDependencyResolvers';
import { ParsedManifest } from '../parsedManifestModel';

function byName(rows: { name: string }[]): Record<string, any> {
  return Object.fromEntries(rows.map((r) => [r.name, r]));
}

describe('layered version resolution (Group 2)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });
  afterEach(() => warnSpy.mockRestore());

  it('(a) resolves a ${propname} version via <properties>', () => {
    const pom = `<project>
      <properties><jackson.version>2.17.1</jackson.version></properties>
      <dependencies>
        <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>
      </dependencies>
    </project>`;
    const declared = resolveMavenManifest(pom, 'pom.xml');
    const resolved = byName(resolveMavenVersions(declared, pom, 'pom.xml', 'svc'));
    const j = resolved['com.fasterxml.jackson.core:jackson-databind'];
    expect(j.resolvedVersion).toBe('2.17.1');
    expect(j.source).toBe('property');
    expect(j.versionUnknown).toBe(false);
    expect(j.evidence).toBe('com.fasterxml.jackson.core:jackson-databind 2.17.1');
  });

  it('(b) recovers a versionless dep from <dependencyManagement> and a Spring starter from <parent>', () => {
    const pom = `<project>
      <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.4.1</version>
      </parent>
      <dependencyManagement><dependencies>
        <dependency><groupId>com.example</groupId><artifactId>lib</artifactId><version>4.5.6</version></dependency>
      </dependencies></dependencyManagement>
      <dependencies>
        <dependency><groupId>com.example</groupId><artifactId>lib</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
      </dependencies>
    </project>`;
    const declared = resolveMavenManifest(pom, 'pom.xml');
    const resolved = byName(resolveMavenVersions(declared, pom, 'pom.xml', 'svc'));

    // Managed recovery from <dependencyManagement>.
    expect(resolved['com.example:lib'].resolvedVersion).toBe('4.5.6');
    expect(resolved['com.example:lib'].source).toBe('dependency-management');

    // Spring starter (no managed entry, no declared version) → parent version.
    const web = resolved['org.springframework.boot:spring-boot-starter-web'];
    expect(web.resolvedVersion).toBe('3.4.1');
    expect(web.source).toBe('parent');
    expect(web.versionUnknown).toBe(false);
  });

  it('(c) marks an unmanaged ${...} and a no-managed-match versionless dep as version-unknown (no guessing)', () => {
    const pom = `<project>
      <dependencies>
        <dependency><groupId>org.x</groupId><artifactId>unmanaged-prop</artifactId><version>\${missing.version}</version></dependency>
        <dependency><groupId>org.y</groupId><artifactId>no-version</artifactId></dependency>
      </dependencies>
    </project>`;
    const declared = resolveMavenManifest(pom, 'pom.xml');
    const resolved = byName(resolveMavenVersions(declared, pom, 'pom.xml', 'svc'));

    const unmanaged = resolved['org.x:unmanaged-prop'];
    expect(unmanaged.resolvedVersion).toBe(VERSION_UNKNOWN);
    expect(unmanaged.versionUnknown).toBe(true);
    expect(unmanaged.source).toBe('version-unknown');
    expect(unmanaged.evidence).toBe('org.x:unmanaged-prop (version unknown)');

    const noVer = resolved['org.y:no-version'];
    expect(noVer.resolvedVersion).toBe(VERSION_UNKNOWN);
    expect(noVer.versionUnknown).toBe(true);

    // version-unknown degradations are logged (no silent drop).
    expect(warnSpy).toHaveBeenCalled();
  });

  it('(d) pins npm deps to exact lockfile versions when present; degrades open ranges to version-unknown without a lockfile', () => {
    const pkg = JSON.stringify({
      name: 'web',
      dependencies: { react: '^18.2.0', axios: '1.6.2', left: 'latest' },
    });
    const declared = resolveNpmManifest(pkg, 'package.json');

    // With a lockfile (lockfileVersion 3 `packages` map): exact pin.
    const lock = JSON.stringify({
      name: 'web',
      lockfileVersion: 3,
      packages: {
        '': { name: 'web' },
        'node_modules/react': { version: '18.2.0' },
        'node_modules/axios': { version: '1.6.2' },
        'node_modules/left': { version: '0.3.0' },
      },
    });
    const withLock = byName(resolveNpmVersions(declared, lock, 'package.json', 'web-ui'));
    expect(withLock['react'].resolvedVersion).toBe('18.2.0');
    expect(withLock['react'].source).toBe('lockfile');
    expect(withLock['left'].resolvedVersion).toBe('0.3.0'); // 'latest' pinned exactly
    expect(withLock['left'].versionUnknown).toBe(false);

    // Without a lockfile: open range + dist-tag → version-unknown; concrete pin kept.
    const noLock = byName(resolveNpmVersions(declared, null, 'package.json', 'web-ui'));
    expect(noLock['react'].resolvedVersion).toBe(VERSION_UNKNOWN); // ^18.2.0 is an open range
    expect(noLock['react'].versionUnknown).toBe(true);
    expect(noLock['left'].resolvedVersion).toBe(VERSION_UNKNOWN); // 'latest' dist-tag
    expect(noLock['axios'].resolvedVersion).toBe('1.6.2'); // concrete literal kept
    expect(noLock['axios'].source).toBe('declared');
  });

  it('(e) buildLockfileIndex reads lockfileVersion 1 legacy dependencies tree', () => {
    const v1 = JSON.stringify({
      name: 'web',
      lockfileVersion: 1,
      dependencies: { react: { version: '18.2.0' }, axios: { version: '1.6.2' } },
    });
    const idx = buildLockfileIndex(v1);
    expect(idx.get('react')).toBe('18.2.0');
    expect(idx.get('axios')).toBe('1.6.2');
  });
});

describe('pomMetadata carry-through (Spec 2 Group 1)', () => {
  const MAVEN_POM = `<project>
    <properties>
      <java.version>21</java.version>
    </properties>
    <dependencies>
      <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency>
    </dependencies>
    <build><plugins>
      <plugin>
        <groupId>org.flywaydb</groupId>
        <artifactId>flyway-maven-plugin</artifactId>
        <version>10.17.0</version>
      </plugin>
    </plugins></build>
  </project>`;

  it('(g) the MAVEN path carries the parsed pomMetadata (<properties> + <plugins>)', () => {
    const parsed: ParsedManifest = {
      status: 'parsed', ecosystem: 'MAVEN', kind: 'pom.xml', tag: 'svc',
      manifestPath: 'services/orders/pom.xml',
      declaredDependencies: resolveMavenManifest(MAVEN_POM, 'services/orders/pom.xml'),
      rawPomContent: MAVEN_POM, packageLockContent: null,
    };
    const resolved = resolveManifestVersions(parsed);

    expect(resolved.pomMetadata).not.toBeNull();
    expect(resolved.pomMetadata!.properties['java.version']).toBe('21');
    const flyway = resolved.pomMetadata!.plugins.find(
      (p) => p.artifactId === 'flyway-maven-plugin',
    );
    expect(flyway).toBeDefined();
    expect(flyway!.groupId).toBe('org.flywaydb');

    // Additive only: the resolver rows are unchanged by the new field.
    const pg = resolved.resolvedDependencies.find(
      (d) => d.name === 'org.postgresql:postgresql',
    );
    expect(pg!.resolvedVersion).toBe('42.7.4');
    expect(resolved.resolvedDependencies).toHaveLength(1);
  });

  it('(h) the NPM path carries no pomMetadata (null) and resolution is undisturbed', () => {
    const pkg = JSON.stringify({ name: 'web', dependencies: { react: '18.2.0' } });
    const parsed: ParsedManifest = {
      status: 'parsed', ecosystem: 'NPM', kind: 'package.json', tag: 'web-ui',
      manifestPath: 'apps/web/package.json',
      declaredDependencies: resolveNpmManifest(pkg, 'apps/web/package.json'),
      rawPomContent: null, packageLockContent: null,
    };
    const resolved = resolveManifestVersions(parsed);
    expect(resolved.pomMetadata).toBeNull();
    expect(resolved.resolvedDependencies[0].name).toBe('react');
  });
});
