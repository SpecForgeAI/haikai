/**
 * Tests for the Maven pack finding scanner + risky-dependency ruleset
 * (Spec 2026-05-16 Wire Java + Spring + Maven Findings -- Task Group 6,
 * sub-task 6.1).
 *
 * Coverage scope (8 focused cases):
 *  - `emitsJavaVersionDetectedWithSeverityByCutoff`: parameterised over
 *    the four cutoff bands (17 -> info; 11 -> medium; 8 -> medium;
 *    1.7 -> high).
 *  - `emitsSpringVersionDetectedWithSeverityByMajor`: 6.x -> info;
 *    5.x -> medium; 4.x -> high.
 *  - `emitsRiskyDependencyFromRuleset`: log4j 1.x in deps produces ONE
 *    `risky_dependency` finding with severity from the rule entry.
 *  - `emitsDatabaseDriverDetected`: Sybase jconn3 dep -> one
 *    `database_driver_detected` finding with `databaseVendor` populated.
 *  - `emitsMavenBuildPluginRisk`: maven-compiler-plugin 3.6 -> medium;
 *    2.5 -> high.
 *  - `emitsDependencyVersionConflict`: same artifact declared twice with
 *    different versions -> one `dependency_version_conflict` finding.
 *  - `emitsTestBuildGap`: POM with no test deps and no surefire/failsafe
 *    -> one `test_build_gap` finding.
 *  - `mavenScannerEnforcesCap`: many risky deps -> capped at
 *    MAX_FINDINGS_PER_TYPE_PER_RUN (50).
 */

import {
  runMavenFindingScanner,
  type MavenPomScannerInput,
} from '../services/findings/packFindingScanners/mavenFindingScanner';
import { parsePomMetadataFromString } from '../services/dependencyResolvers/maven/mavenPomMetadataParser';
import type { DeclaredDependency } from '../services/dependencyResolvers/types';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from '../services/findings/packFindingScanners/constants';

const RUN_ID = 'run-maven-scan-001';

function makePomInput(
  pomPath: string,
  pomXml: string,
  dependencies: DeclaredDependency[],
): MavenPomScannerInput {
  return {
    pomPath,
    dependencies,
    metadata: parsePomMetadataFromString(pomPath, pomXml),
  };
}

function makeDep(
  name: string,
  version?: string,
  scope: string = 'compile',
): DeclaredDependency {
  return {
    name,
    version,
    scope,
    manifestPath: 'pom.xml',
    manifestLine: 1,
  };
}

// ============================================================================
// java_version_detected severity by cutoff
// ============================================================================

describe('mavenFindingScanner -- java_version_detected', () => {
  it.each([
    ['17', 'info'],
    ['11', 'medium'],
    ['8', 'medium'],
    ['1.7', 'high'],
  ])('java compiler source %s -> severity %s', (version, expectedSeverity) => {
    const xml = `<project><properties><maven.compiler.source>${version}</maven.compiler.source></properties></project>`;
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, [])],
    });
    const java = out.filter((f) => f.findingType === 'java_version_detected');
    expect(java).toHaveLength(1);
    expect(java[0].severity).toBe(expectedSeverity);
    expect(java[0].source).toBe('maven-dependency-pack');
    expect(java[0].createdByStage).toBe('deterministic_maven_analysis');
    const detail = java[0].detailJson as Record<string, unknown>;
    expect(detail.pomPath).toBe('pom.xml');
    expect(detail.resolvedValue).toBe(version);
  });

  it('falls back to maven-compiler-plugin <configuration> when properties are absent', () => {
    const xml = `
      <project>
        <build>
          <plugins>
            <plugin>
              <groupId>org.apache.maven.plugins</groupId>
              <artifactId>maven-compiler-plugin</artifactId>
              <version>3.11.0</version>
              <configuration>
                <release>21</release>
              </configuration>
            </plugin>
          </plugins>
        </build>
      </project>
    `;
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, [])],
    });
    const java = out.filter((f) => f.findingType === 'java_version_detected');
    expect(java).toHaveLength(1);
    expect(java[0].severity).toBe('info');
    const detail = java[0].detailJson as Record<string, unknown>;
    expect(detail.resolvedValue).toBe('21');
  });
});

// ============================================================================
// spring_version_detected severity by major
// ============================================================================

describe('mavenFindingScanner -- spring_version_detected', () => {
  it('Spring Boot 3.x parent -> Spring 6 / info', () => {
    const xml = `
      <project>
        <parent>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-starter-parent</artifactId>
          <version>3.2.0</version>
        </parent>
      </project>
    `;
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, [])],
    });
    const spring = out.filter((f) => f.findingType === 'spring_version_detected');
    expect(spring).toHaveLength(1);
    expect(spring[0].severity).toBe('info');
    const detail = spring[0].detailJson as Record<string, unknown>;
    expect(detail.springFrameworkMajor).toBe(6);
  });

  it('spring-core 5.x dependency -> medium', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('org.springframework:spring-core', '5.3.20')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const spring = out.filter((f) => f.findingType === 'spring_version_detected');
    expect(spring).toHaveLength(1);
    expect(spring[0].severity).toBe('medium');
  });

  it('spring-core 4.x dependency -> high', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('org.springframework:spring-core', '4.3.30.RELEASE')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const spring = out.filter((f) => f.findingType === 'spring_version_detected');
    expect(spring).toHaveLength(1);
    expect(spring[0].severity).toBe('high');
  });
});

// ============================================================================
// risky_dependency from ruleset
// ============================================================================

describe('mavenFindingScanner -- risky_dependency', () => {
  it('emits a risky_dependency for log4j 1.x with the rule severity', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('log4j:log4j', '1.2.17')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const risky = out.filter((f) => f.findingType === 'risky_dependency');
    expect(risky).toHaveLength(1);
    expect(risky[0].severity).toBe('high');
    expect(risky[0].title).toContain('log4j:log4j');
    const detail = risky[0].detailJson as Record<string, unknown>;
    expect(detail.groupId).toBe('log4j');
    expect(detail.artifactId).toBe('log4j');
    expect(detail.resolvedValue).toBe('1.2.17');
    expect(detail.riskReason).toMatch(/log4j 1\.x/);
  });

  it('does NOT emit risky_dependency for a non-risky version (jackson-databind 2.16)', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('com.fasterxml.jackson.core:jackson-databind', '2.16.1')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const risky = out.filter((f) => f.findingType === 'risky_dependency');
    expect(risky).toHaveLength(0);
  });
});

// ============================================================================
// database_driver_detected
// ============================================================================

describe('mavenFindingScanner -- database_driver_detected', () => {
  it('Sybase jConn3 dep -> one database_driver_detected with vendor populated', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('com.sybase.jdbc3.jdbc:jconn3', '7.7')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const driver = out.filter((f) => f.findingType === 'database_driver_detected');
    expect(driver).toHaveLength(1);
    expect(driver[0].severity).toBe('medium');
    const detail = driver[0].detailJson as Record<string, unknown>;
    expect(detail.databaseVendor).toBe('Sybase');
    expect(detail.groupId).toBe('com.sybase.jdbc3.jdbc');
    expect(detail.artifactId).toBe('jconn3');
  });
});

// ============================================================================
// maven_build_plugin_risk
// ============================================================================

describe('mavenFindingScanner -- maven_build_plugin_risk', () => {
  it('maven-compiler-plugin 3.6.0 -> medium', () => {
    const xml = `
      <project>
        <build>
          <plugins>
            <plugin>
              <groupId>org.apache.maven.plugins</groupId>
              <artifactId>maven-compiler-plugin</artifactId>
              <version>3.6.0</version>
            </plugin>
          </plugins>
        </build>
      </project>
    `;
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, [])],
    });
    const plugins = out.filter((f) => f.findingType === 'maven_build_plugin_risk');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].severity).toBe('medium');
  });

  it('maven-compiler-plugin 2.5 -> high', () => {
    const xml = `
      <project>
        <build>
          <plugins>
            <plugin>
              <groupId>org.apache.maven.plugins</groupId>
              <artifactId>maven-compiler-plugin</artifactId>
              <version>2.5</version>
            </plugin>
          </plugins>
        </build>
      </project>
    `;
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, [])],
    });
    const plugins = out.filter((f) => f.findingType === 'maven_build_plugin_risk');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].severity).toBe('high');
  });
});

// ============================================================================
// dependency_version_conflict
// ============================================================================

describe('mavenFindingScanner -- dependency_version_conflict', () => {
  it('same artifact declared twice with different versions -> one conflict finding', () => {
    const xml = `<project></project>`;
    const deps = [
      makeDep('org.example:lib', '1.0.0'),
      makeDep('org.example:lib', '2.0.0', 'test'),
    ];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const conflicts = out.filter((f) => f.findingType === 'dependency_version_conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('medium');
    const detail = conflicts[0].detailJson as Record<string, unknown>;
    expect(detail.versions).toEqual(['1.0.0', '2.0.0']);
  });

  it('unresolved ${propname} reference -> one conflict finding', () => {
    const xml = `<project></project>`; // no <properties>
    const deps = [makeDep('org.example:lib', '${unresolved.version}')];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const conflicts = out.filter((f) => f.findingType === 'dependency_version_conflict');
    expect(conflicts).toHaveLength(1);
    const detail = conflicts[0].detailJson as Record<string, unknown>;
    expect(detail.unresolvedValue).toBe('${unresolved.version}');
  });
});

// ============================================================================
// test_build_gap
// ============================================================================

describe('mavenFindingScanner -- test_build_gap', () => {
  it('no test deps and no surefire/failsafe -> one test_build_gap finding', () => {
    const xml = `<project></project>`;
    const deps = [makeDep('org.example:lib', '1.0.0')]; // no test deps
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const gap = out.filter((f) => f.findingType === 'test_build_gap');
    expect(gap).toHaveLength(1);
    expect(gap[0].severity).toBe('medium');
    const detail = gap[0].detailJson as Record<string, unknown>;
    expect(detail.hasTestDeps).toBe(false);
    expect(detail.hasTestPlugin).toBe(false);
  });

  it('test deps and surefire present -> no test_build_gap', () => {
    const xml = `
      <project>
        <build>
          <plugins>
            <plugin>
              <groupId>org.apache.maven.plugins</groupId>
              <artifactId>maven-surefire-plugin</artifactId>
              <version>3.1.2</version>
            </plugin>
          </plugins>
        </build>
      </project>
    `;
    const deps = [
      makeDep('org.example:lib', '1.0.0'),
      makeDep('org.junit.jupiter:junit-jupiter', '5.10.0', 'test'),
    ];
    const out = runMavenFindingScanner({
      runId: RUN_ID,
      poms: [makePomInput('pom.xml', xml, deps)],
    });
    const gap = out.filter((f) => f.findingType === 'test_build_gap');
    expect(gap).toHaveLength(0);
  });
});

// ============================================================================
// Cap enforcement
// ============================================================================

describe('mavenFindingScanner -- caps', () => {
  it('caps risky_dependency at MAX_FINDINGS_PER_TYPE_PER_RUN', () => {
    // Generate 60 distinct risky deps (all match the commons-logging
    // any-version rule by using the same artifact across many POMs).
    const poms: MavenPomScannerInput[] = [];
    for (let i = 0; i < 60; i++) {
      poms.push(
        makePomInput(
          `module-${i}/pom.xml`,
          `<project></project>`,
          [makeDep('commons-logging:commons-logging', '1.1.1')],
        ),
      );
    }
    const out = runMavenFindingScanner({ runId: RUN_ID, poms });
    const risky = out.filter((f) => f.findingType === 'risky_dependency');
    expect(risky).toHaveLength(MAX_FINDINGS_PER_TYPE_PER_RUN);
    expect(MAX_FINDINGS_PER_TYPE_PER_RUN).toBe(50);
  });
});

// ============================================================================
// runManager wiring (Group 6 sub-task: mavenScannerCallSiteAfterBuildRepoLookupTable)
// ============================================================================
//
// This is a lightweight static-source assertion: parsing the wiring with a
// full mock of runManager + its many dependencies would dwarf the test
// value. Asserting on the source string keeps the regression guard scoped
// to "the maven findings scanner is invoked from runManager.ts after
// buildRepoLookupTable" without coupling to the surrounding orchestration.
//
// The scanner call now lives inside the `runMavenPackFindingsForRun` helper
// (defined once near the top of the file, invoked from both the code-scoped
// and service-scoped flows). The meaningful ordering invariant is therefore
// the service-scoped *call site* of that helper relative to the library-walker
// `buildRepoLookupTable` build -- not the first textual occurrence of the inner
// `runMavenFindingScanner(` call, which sits in the early helper definition.

import * as fsSync from 'fs';
import * as pathMod from 'path';

describe('mavenFindingScanner -- runManager wiring', () => {
  it('runManager.ts invokes the maven findings helper after buildRepoLookupTable (service-scoped flow)', () => {
    const runManagerPath = pathMod.join(
      __dirname,
      '..',
      'services',
      'runManager.ts',
    );
    const src = fsSync.readFileSync(runManagerPath, 'utf-8');
    const idxLookup = src.indexOf('await buildRepoLookupTable');
    // The inner scanner is wrapped by runMavenPackFindingsForRun; the
    // service-scoped flow invokes that helper after the repo lookup table is
    // built, so assert on the *last* helper call site (lastIndexOf).
    const idxMavenHelperCall = src.lastIndexOf('await runMavenPackFindingsForRun(');
    // Sanity: the inner scanner is still referenced by the helper.
    const idxInnerScanner = src.indexOf('runMavenFindingScanner(');
    expect(idxLookup).toBeGreaterThan(-1);
    expect(idxInnerScanner).toBeGreaterThan(-1);
    expect(idxMavenHelperCall).toBeGreaterThan(-1);
    expect(idxMavenHelperCall).toBeGreaterThan(idxLookup);
  });
});

