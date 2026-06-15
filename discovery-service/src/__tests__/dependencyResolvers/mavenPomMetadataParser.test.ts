/**
 * Tests for the Maven POM metadata parser (Spec 2026-05-16 Wire Java +
 * Spring + Maven Findings -- Task Group 5).
 *
 * Coverage scope (6 focused cases):
 *  - `parsesPropertiesBlock`: `<properties>` key/value map captured.
 *  - `parsesBuildPlugins`: plugin entries under `<build><plugins>` and
 *    `<build><pluginManagement><plugins>` captured with isManaged flag.
 *  - `parsesParentVersion`: `<parent>` groupId/artifactId/version captured.
 *  - `parsesDependencyManagement`: entries appear distinct from top-level
 *    `<dependency>` blocks.
 *  - `resolvesPropertyReferences`: `${name}` resolved against properties.
 *  - `existingDependencyOutputUnchangedForRepresentativeFixture`:
 *    regression guard that MavenDependencyResolver produces the same
 *    dependency shape on the maven-single-module fixture as it did
 *    before this commit (i.e. parser additions are non-invasive).
 */

import * as path from 'path';
import {
  parsePomMetadataFromString,
  parsePomMetadataFromFile,
  resolvePropertyRef,
} from '../../services/dependencyResolvers/maven/mavenPomMetadataParser';
import { MavenDependencyResolver } from '../../services/dependencyResolvers/maven/MavenDependencyResolver';

const FIX_ROOT = path.join(
  __dirname,
  '..',
  'fixtures',
  'dependencyResolvers',
);

describe('mavenPomMetadataParser -- parsesPropertiesBlock', () => {
  it('extracts <properties> entries into a key/value map', () => {
    const xml = `
      <project>
        <properties>
          <maven.compiler.source>17</maven.compiler.source>
          <maven.compiler.target>17</maven.compiler.target>
          <jackson.version>2.15.2</jackson.version>
          <spring.version>6.0.10</spring.version>
        </properties>
      </project>
    `;
    const meta = parsePomMetadataFromString('pom.xml', xml);
    expect(meta.properties['maven.compiler.source']).toBe('17');
    expect(meta.properties['maven.compiler.target']).toBe('17');
    expect(meta.properties['jackson.version']).toBe('2.15.2');
    expect(meta.properties['spring.version']).toBe('6.0.10');
  });
});

describe('mavenPomMetadataParser -- parsesBuildPlugins', () => {
  it('captures <build><plugins> AND <build><pluginManagement><plugins> with isManaged flag', () => {
    const xml = `
      <project>
        <build>
          <pluginManagement>
            <plugins>
              <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.1.2</version>
              </plugin>
            </plugins>
          </pluginManagement>
          <plugins>
            <plugin>
              <groupId>org.apache.maven.plugins</groupId>
              <artifactId>maven-compiler-plugin</artifactId>
              <version>3.11.0</version>
              <configuration>
                <source>17</source>
                <target>17</target>
                <release>17</release>
              </configuration>
            </plugin>
          </plugins>
        </build>
      </project>
    `;
    const meta = parsePomMetadataFromString('pom.xml', xml);
    expect(meta.plugins).toHaveLength(2);
    const compiler = meta.plugins.find((p) => p.artifactId === 'maven-compiler-plugin')!;
    expect(compiler).toBeDefined();
    expect(compiler.groupId).toBe('org.apache.maven.plugins');
    expect(compiler.version).toBe('3.11.0');
    expect(compiler.isManaged).toBe(false);
    expect(compiler.configSummary).toContain('<source>17</source>');
    const surefire = meta.plugins.find((p) => p.artifactId === 'maven-surefire-plugin')!;
    expect(surefire).toBeDefined();
    expect(surefire.version).toBe('3.1.2');
    expect(surefire.isManaged).toBe(true);
  });
});

describe('mavenPomMetadataParser -- parsesParentVersion', () => {
  it('extracts <parent> coordinates including version', () => {
    const xml = `
      <project>
        <parent>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-starter-parent</artifactId>
          <version>3.2.0</version>
        </parent>
      </project>
    `;
    const meta = parsePomMetadataFromString('pom.xml', xml);
    expect(meta.parent).not.toBeNull();
    expect(meta.parent!.groupId).toBe('org.springframework.boot');
    expect(meta.parent!.artifactId).toBe('spring-boot-starter-parent');
    expect(meta.parent!.version).toBe('3.2.0');
  });

  it('returns null parent when not declared', () => {
    const xml = `<project><groupId>x</groupId></project>`;
    const meta = parsePomMetadataFromString('pom.xml', xml);
    expect(meta.parent).toBeNull();
  });
});

describe('mavenPomMetadataParser -- parsesDependencyManagement', () => {
  it('captures <dependencyManagement> entries separately from top-level deps', () => {
    const xml = `
      <project>
        <dependencyManagement>
          <dependencies>
            <dependency>
              <groupId>org.springframework</groupId>
              <artifactId>spring-core</artifactId>
              <version>6.0.10</version>
            </dependency>
            <dependency>
              <groupId>com.fasterxml.jackson.core</groupId>
              <artifactId>jackson-databind</artifactId>
              <version>2.15.2</version>
              <scope>compile</scope>
            </dependency>
          </dependencies>
        </dependencyManagement>
        <dependencies>
          <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-core</artifactId>
          </dependency>
        </dependencies>
      </project>
    `;
    const meta = parsePomMetadataFromString('pom.xml', xml);
    expect(meta.dependencyManagement).toHaveLength(2);
    const spring = meta.dependencyManagement.find((d) => d.artifactId === 'spring-core')!;
    expect(spring).toBeDefined();
    expect(spring.version).toBe('6.0.10');
    const jackson = meta.dependencyManagement.find((d) => d.artifactId === 'jackson-databind')!;
    expect(jackson.version).toBe('2.15.2');
    expect(jackson.scope).toBe('compile');
  });
});

describe('mavenPomMetadataParser -- resolvesPropertyReferences', () => {
  it('resolves ${name} placeholders against the properties map', () => {
    const props = { 'jackson.version': '2.15.2', 'java.version': '17' };
    expect(resolvePropertyRef('${jackson.version}', props)).toBe('2.15.2');
    expect(resolvePropertyRef('${java.version}', props)).toBe('17');
    expect(resolvePropertyRef('5.3.20', props)).toBe('5.3.20');
    expect(resolvePropertyRef('${unresolved}', props)).toBe('${unresolved}');
    expect(resolvePropertyRef(null, props)).toBeNull();
  });

  it('reads metadata from the on-disk single-module fixture and resolves jackson.version', async () => {
    const repoRoot = path.join(FIX_ROOT, 'maven-single-module');
    const pomAbs = path.join(repoRoot, 'pom.xml');
    const meta = await parsePomMetadataFromFile('pom.xml', pomAbs);
    expect(meta.properties['jackson.version']).toBe('2.15.2');
    expect(resolvePropertyRef('${jackson.version}', meta.properties)).toBe('2.15.2');
  });
});

describe('mavenPomMetadataParser -- regression guard for resolver output', () => {
  it('does not change MavenDependencyResolver dependency output on the single-module fixture', async () => {
    const resolver = new MavenDependencyResolver();
    const repoRoot = path.join(FIX_ROOT, 'maven-single-module');
    const manifests = await resolver.findManifests(repoRoot);
    expect(manifests).toHaveLength(1);

    const deps = await resolver.resolve(repoRoot, manifests[0]);
    // The locked contract from spec 2026-05-06: 6 deps, exact names + versions
    // unchanged after this commit's parser additions.
    expect(deps).toHaveLength(6);
    const byName = new Map(deps.map((d) => [d.name, d]));
    expect(byName.get('org.springframework:spring-core')!.version).toBe('5.3.20');
    expect(byName.get('org.springframework:spring-core')!.scope).toBe('compile');
    expect(byName.get('com.fasterxml.jackson.core:jackson-databind')!.version).toBe('${jackson.version}');
    expect(byName.get('junit:junit')!.scope).toBe('test');
    expect(byName.get('javax.servlet:servlet-api')!.scope).toBe('provided');
    expect(byName.get('org.example:optional-lib')!.scope).toBe('optional');
    expect(byName.get('org.example:ranged-lib')!.versionRange).toBe('[1.0,2.0)');
    expect(byName.get('org.example:ranged-lib')!.version).toBeUndefined();
  });
});
