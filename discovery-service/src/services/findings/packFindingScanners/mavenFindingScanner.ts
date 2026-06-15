/**
 * Maven pack finding scanner.
 *
 * Spec: 2026-05-16 Wire Java + Spring + Maven Findings (Task Group 6).
 *
 * Pure function that consumes the Maven resolver's `DeclaredDependency[]`
 * output PLUS the sibling {@link parsePomMetadataFromFile} per-POM metadata
 * (properties / parent / plugins / dependencyManagement) and emits seven
 * deterministic finding types:
 *
 *  - `java_version_detected` (dependency / info or medium or high) -- one per POM.
 *  - `spring_version_detected` (dependency / info, medium, or high) -- one per POM
 *     that declares a Spring signal.
 *  - `risky_dependency` (dependency / per-rule severity) -- one per matched dep.
 *  - `database_driver_detected` (dependency / medium) -- one per detected driver.
 *  - `maven_build_plugin_risk` (migration_risk / per-rule severity) -- one per
 *     matched plugin.
 *  - `dependency_version_conflict` (dependency / medium) -- one per (groupId:artifactId)
 *     that appears with multiple distinct versions in the SAME POM, OR per
 *     unresolved `${propname}` reference left in a dep version.
 *  - `test_build_gap` (testability / medium) -- one per POM with no test deps
 *     AND no surefire/failsafe plugin configuration AND/OR `<skipTests>true</skipTests>`.
 *
 * All findings carry `source = 'maven-dependency-pack'`,
 * `createdByStage = 'deterministic_maven_analysis'`, and the spec'd
 * `detail_json` keys (pomPath, groupId, artifactId, version, scope,
 * plugin, propertyName, resolvedValue, unresolvedValue, riskReason,
 * migrationConcern, confidence).
 *
 * Per D7 the scanner enforces `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` for
 * each new finding_type. Info-severity `java_version_detected` is gated
 * by `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION` (default true).
 *
 * Soft-fail at per-POM granularity: a per-POM detection failure logs a
 * warning and continues with the remaining POMs.
 */

import type { DeclaredDependency } from '../../dependencyResolvers/types';
import type { PomMetadata, PomPlugin } from '../../dependencyResolvers/maven/mavenPomMetadataParser';
import { resolvePropertyRef } from '../../dependencyResolvers/maven/mavenPomMetadataParser';
import type { FindingEmitInput } from '../FindingEmitter';
import {
  RISKY_DEPENDENCY_RULES,
  RISKY_PLUGIN_RULES,
  lookupDatabaseDriver,
  parseVersionTriple,
} from './riskyDependencyRules';
import {
  MAX_FINDINGS_PER_TYPE_PER_RUN,
  EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION,
} from './constants';

const FINDING_SOURCE = 'maven-dependency-pack';
const CREATED_BY_STAGE = 'deterministic_maven_analysis';

/**
 * One POM's resolver output bundled with the extracted metadata. The
 * scanner receives an array of these (one per pom.xml found in the repo).
 */
export interface MavenPomScannerInput {
  /** Repo-relative POM path. */
  pomPath: string;
  /** All `<dependency>` entries emitted by the resolver. */
  dependencies: DeclaredDependency[];
  /** Metadata extracted by the sibling parser (properties / parent / plugins / dm). */
  metadata: PomMetadata;
}

/**
 * Top-level scanner input. Carries the Maven-resolver output plus
 * the per-POM metadata per pom.xml.
 */
export interface MavenFindingScannerInput {
  /** Discovery run id (for forward compatibility with caller logging). */
  runId: string;
  /** Per-POM bundles. */
  poms: MavenPomScannerInput[];
}

// ---------------------------------------------------------------------------
// Cap helpers (shared shape with other pack scanners)
// ---------------------------------------------------------------------------

function underCap(counts: Map<string, number>, findingType: string): boolean {
  const cur = counts.get(findingType) ?? 0;
  return cur < MAX_FINDINGS_PER_TYPE_PER_RUN;
}

function bumpCap(counts: Map<string, number>, findingType: string): void {
  counts.set(findingType, (counts.get(findingType) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// java_version_detected
// ---------------------------------------------------------------------------

/**
 * Resolve the project's Java version using the canonical signal priority:
 *   1. `maven.compiler.release` (preferred, Java 9+)
 *   2. `maven.compiler.target`
 *   3. `maven.compiler.source`
 *   4. `<source>...</source>` inside maven-compiler-plugin <configuration>
 *
 * Each signal is resolved through `${prop}` references against the
 * POM's <properties> block.
 *
 * Returns null when no signal is present. The returned string is the
 * resolved version literal (e.g. "17", "1.8", "21-ea").
 */
function detectJavaVersionForPom(pom: MavenPomScannerInput): {
  version: string;
  signalKey: string;
} | null {
  const propKeys = [
    'maven.compiler.release',
    'maven.compiler.target',
    'maven.compiler.source',
  ];
  for (const key of propKeys) {
    const raw = pom.metadata.properties[key];
    if (raw == null) continue;
    const resolved = resolvePropertyRef(raw, pom.metadata.properties);
    if (resolved == null) continue;
    return { version: resolved, signalKey: key };
  }
  // Plugin-config fallback.
  const compilerPlugin = pom.metadata.plugins.find(
    (p) => p.artifactId === 'maven-compiler-plugin',
  );
  if (compilerPlugin && compilerPlugin.configSummary) {
    const cfg = compilerPlugin.configSummary;
    const m = cfg.match(/<release>\s*([^<\s]+)\s*<\/release>/i) ||
              cfg.match(/<target>\s*([^<\s]+)\s*<\/target>/i) ||
              cfg.match(/<source>\s*([^<\s]+)\s*<\/source>/i);
    if (m) {
      const resolved = resolvePropertyRef(m[1], pom.metadata.properties);
      if (resolved != null) {
        return { version: resolved, signalKey: 'maven-compiler-plugin/<configuration>' };
      }
    }
  }
  return null;
}

/**
 * Map a parsed Java version to a severity per D5:
 *   >=17 -> info
 *   11-16 -> medium
 *   8 -> medium
 *   <8 -> high
 *
 * `1.8` parses as `{major:1, minor:8}` -- normalise to major=8 before comparing.
 * Returns null when the version cannot be parsed (no finding emitted).
 */
function severityForJavaVersion(
  version: string,
): { severity: 'info' | 'medium' | 'high'; normalisedMajor: number } | null {
  const t = parseVersionTriple(version);
  if (t === null) return null;
  // `1.8` is Java 8 in legacy notation.
  const normalisedMajor = t.major === 1 ? t.minor : t.major;
  if (normalisedMajor >= 17) return { severity: 'info', normalisedMajor };
  if (normalisedMajor >= 11) return { severity: 'medium', normalisedMajor };
  if (normalisedMajor === 8) return { severity: 'medium', normalisedMajor };
  return { severity: 'high', normalisedMajor };
}

function buildJavaVersionFinding(args: {
  pomPath: string;
  version: string;
  normalisedMajor: number;
  signalKey: string;
  severity: 'info' | 'medium' | 'high';
}): FindingEmitInput {
  return {
    findingType: 'java_version_detected',
    category: 'dependency',
    severity: args.severity,
    title: `Java ${args.normalisedMajor} detected: ${args.pomPath}`,
    summary:
      `Java compiler version '${args.version}' detected via '${args.signalKey}' ` +
      `in ${args.pomPath}.`,
    detailJson: {
      pomPath: args.pomPath,
      propertyName: args.signalKey,
      resolvedValue: args.version,
      normalisedJavaMajor: args.normalisedMajor,
      riskReason: args.severity === 'info'
        ? 'Modern Java; flagged for visibility.'
        : args.severity === 'medium'
          ? 'Java version is older than current LTS (17). Migration recommended.'
          : 'Java version is end-of-life and unsupported on current JDK runtimes.',
      migrationConcern:
        args.severity === 'info'
          ? 'No migration action required.'
          : 'Upgrade to Java 17 or later (jakarta namespace) to stay on a supported runtime.',
      confidence: 0.95,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// spring_version_detected
// ---------------------------------------------------------------------------

const SPRING_DEPENDENCY_ARTIFACTS = new Set([
  'spring-core',
  'spring-context',
  'spring-webmvc',
  'spring-web',
  'spring-beans',
  'spring-aop',
]);

const SPRING_BOOT_PARENT_ARTIFACTS = new Set([
  'spring-boot-starter-parent',
  'spring-boot-dependencies',
]);

/**
 * Walk a POM and decide whether it carries a Spring signal. Returns the
 * resolved Spring version + the source of the signal, or null when no
 * Spring artifact is present.
 *
 * Spring Boot's parent POM is the strongest signal in real projects:
 * Spring Boot 3.x => Spring Framework 6.x; Spring Boot 2.x => Spring 5.x.
 * We translate Spring Boot major -> Spring Framework major before
 * comparing against the D5 cutoffs.
 */
function detectSpringVersionForPom(pom: MavenPomScannerInput): {
  springMajor: number;
  resolvedVersion: string;
  signalKey: string;
} | null {
  // 1. spring-boot-starter-parent / spring-boot-dependencies parent POM.
  const parent = pom.metadata.parent;
  if (parent && parent.artifactId && SPRING_BOOT_PARENT_ARTIFACTS.has(parent.artifactId) && parent.version) {
    const resolved = resolvePropertyRef(parent.version, pom.metadata.properties);
    if (resolved != null) {
      const t = parseVersionTriple(resolved);
      if (t !== null) {
        // Spring Boot major maps directly to Spring Framework major:
        //   Spring Boot 3.x -> Spring 6.x
        //   Spring Boot 2.x -> Spring 5.x
        //   Spring Boot 1.x -> Spring 4.x
        const springMajor =
          t.major === 3 ? 6 :
          t.major === 2 ? 5 :
          t.major === 1 ? 4 :
          t.major; // future versions: assume direct mapping
        return {
          springMajor,
          resolvedVersion: resolved,
          signalKey: `parent:${parent.artifactId}`,
        };
      }
    }
  }
  // 2. Top-level spring-core/spring-context dep with explicit version.
  for (const dep of pom.dependencies) {
    const [groupId, artifactId] = dep.name.split(':');
    if (groupId !== 'org.springframework') continue;
    if (!SPRING_DEPENDENCY_ARTIFACTS.has(artifactId)) continue;
    const resolved = resolvePropertyRef(dep.version ?? null, pom.metadata.properties);
    if (resolved == null) continue;
    const t = parseVersionTriple(resolved);
    if (t === null) continue;
    return {
      springMajor: t.major,
      resolvedVersion: resolved,
      signalKey: `dependency:${dep.name}`,
    };
  }
  // 3. dependencyManagement override (less common but real).
  for (const dm of pom.metadata.dependencyManagement) {
    if (dm.groupId !== 'org.springframework') continue;
    if (dm.artifactId == null || !SPRING_DEPENDENCY_ARTIFACTS.has(dm.artifactId)) continue;
    const resolved = resolvePropertyRef(dm.version, pom.metadata.properties);
    if (resolved == null) continue;
    const t = parseVersionTriple(resolved);
    if (t === null) continue;
    return {
      springMajor: t.major,
      resolvedVersion: resolved,
      signalKey: `dependencyManagement:${dm.groupId}:${dm.artifactId}`,
    };
  }
  return null;
}

function severityForSpringMajor(springMajor: number): 'info' | 'medium' | 'high' {
  if (springMajor >= 6) return 'info';
  if (springMajor === 5) return 'medium';
  return 'high'; // 4.x or older
}

function buildSpringVersionFinding(args: {
  pomPath: string;
  springMajor: number;
  resolvedVersion: string;
  signalKey: string;
}): FindingEmitInput {
  const severity = severityForSpringMajor(args.springMajor);
  return {
    findingType: 'spring_version_detected',
    category: 'dependency',
    severity,
    title: `Spring ${args.springMajor}.x detected: ${args.pomPath}`,
    summary:
      `Spring (signal: ${args.signalKey}) resolved to version '${args.resolvedVersion}' ` +
      `(framework major ${args.springMajor}) in ${args.pomPath}.`,
    detailJson: {
      pomPath: args.pomPath,
      propertyName: args.signalKey,
      resolvedValue: args.resolvedVersion,
      springFrameworkMajor: args.springMajor,
      riskReason:
        severity === 'info'
          ? 'Spring Framework 6.x is on the current major; flagged for visibility.'
          : severity === 'medium'
            ? 'Spring Framework 5.x is supported but the next major is 6.x (jakarta namespace).'
            : 'Spring Framework 4.x or older is end-of-life and incompatible with modern Java runtimes.',
      migrationConcern:
        severity === 'info'
          ? 'No migration action required for the framework version.'
          : 'Plan migration to Spring Framework 6.x / Spring Boot 3.x (jakarta namespace).',
      confidence: 0.95,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// risky_dependency
// ---------------------------------------------------------------------------

function buildRiskyDependencyFinding(args: {
  pomPath: string;
  groupId: string;
  artifactId: string;
  declaredVersion: string | null;
  resolvedVersion: string | null;
  scope: string | null;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}): FindingEmitInput {
  return {
    findingType: 'risky_dependency',
    category: 'dependency',
    severity: args.severity,
    title: `Risky dependency: ${args.groupId}:${args.artifactId}`,
    summary:
      `${args.groupId}:${args.artifactId}` +
      (args.resolvedVersion ? `:${args.resolvedVersion}` : '') +
      ` flagged in ${args.pomPath}: ${args.reason}`,
    detailJson: {
      pomPath: args.pomPath,
      groupId: args.groupId,
      artifactId: args.artifactId,
      version: args.declaredVersion,
      resolvedValue: args.resolvedVersion,
      scope: args.scope,
      riskReason: args.reason,
      migrationConcern: args.reason,
      confidence: 0.9,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// database_driver_detected
// ---------------------------------------------------------------------------

function buildDatabaseDriverFinding(args: {
  pomPath: string;
  groupId: string;
  artifactId: string;
  version: string | null;
  databaseVendor: string;
}): FindingEmitInput {
  return {
    findingType: 'database_driver_detected',
    category: 'dependency',
    severity: 'medium',
    title: `Database driver detected (${args.databaseVendor}): ${args.groupId}:${args.artifactId}`,
    summary:
      `Detected JDBC driver for '${args.databaseVendor}' ` +
      `(${args.groupId}:${args.artifactId}` +
      (args.version ? `:${args.version}` : '') +
      `) in ${args.pomPath}.`,
    detailJson: {
      pomPath: args.pomPath,
      groupId: args.groupId,
      artifactId: args.artifactId,
      version: args.version,
      databaseVendor: args.databaseVendor,
      riskReason:
        `Database vendor lock-in: ${args.databaseVendor} driver pinned in dependency declaration.`,
      migrationConcern:
        `Database migration / multi-vendor strategy must include re-evaluating the '${args.databaseVendor}' driver dependency.`,
      confidence: 0.95,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// maven_build_plugin_risk
// ---------------------------------------------------------------------------

function buildMavenPluginRiskFinding(args: {
  pomPath: string;
  groupId: string;
  artifactId: string;
  version: string | null;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  isManaged: boolean;
}): FindingEmitInput {
  return {
    findingType: 'maven_build_plugin_risk',
    category: 'migration_risk',
    severity: args.severity,
    title: `Maven plugin risk: ${args.groupId}:${args.artifactId}`,
    summary:
      `${args.groupId}:${args.artifactId}` +
      (args.version ? `:${args.version}` : '') +
      ` flagged in ${args.pomPath}: ${args.reason}`,
    detailJson: {
      pomPath: args.pomPath,
      plugin: `${args.groupId}:${args.artifactId}`,
      groupId: args.groupId,
      artifactId: args.artifactId,
      version: args.version,
      isManaged: args.isManaged,
      riskReason: args.reason,
      migrationConcern: args.reason,
      confidence: 0.9,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// dependency_version_conflict
// ---------------------------------------------------------------------------

function buildDependencyVersionConflictFinding(args: {
  pomPath: string;
  groupId: string;
  artifactId: string;
  versions?: string[];
  unresolvedValue?: string;
  riskReason: string;
}): FindingEmitInput {
  return {
    findingType: 'dependency_version_conflict',
    category: 'dependency',
    severity: 'medium',
    title: `Dependency version conflict: ${args.groupId}:${args.artifactId}`,
    summary:
      `Conflict detected for ${args.groupId}:${args.artifactId} in ${args.pomPath}: ${args.riskReason}`,
    detailJson: {
      pomPath: args.pomPath,
      groupId: args.groupId,
      artifactId: args.artifactId,
      versions: args.versions,
      unresolvedValue: args.unresolvedValue,
      riskReason: args.riskReason,
      migrationConcern:
        'Conflicting / unresolved versions hide which artifact will actually be on the classpath at runtime; resolve before migration planning.',
      confidence: 0.85,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// test_build_gap
// ---------------------------------------------------------------------------

const TEST_FRAMEWORK_GROUP_IDS = new Set([
  'org.junit.jupiter',
  'org.junit.vintage',
  'junit',
  'org.testng',
  'org.mockito',
  'org.hamcrest',
  'org.assertj',
]);

const TEST_FRAMEWORK_ARTIFACT_HINTS = ['junit', 'mockito', 'testng', 'assertj', 'hamcrest'];

function buildTestBuildGapFinding(args: {
  pomPath: string;
  hasTestDeps: boolean;
  hasTestPlugin: boolean;
  skipTests: boolean;
}): FindingEmitInput {
  const reasons: string[] = [];
  if (!args.hasTestDeps) reasons.push('no test-scoped test-framework dependencies declared');
  if (!args.hasTestPlugin) reasons.push('no maven-surefire-plugin / maven-failsafe-plugin configuration found');
  if (args.skipTests) reasons.push('<skipTests>true</skipTests> is set');
  return {
    findingType: 'test_build_gap',
    category: 'testability',
    severity: 'medium',
    title: `Test/build gap: ${args.pomPath}`,
    summary:
      `Test coverage / build gap detected in ${args.pomPath}: ${reasons.join('; ')}.`,
    detailJson: {
      pomPath: args.pomPath,
      hasTestDeps: args.hasTestDeps,
      hasTestPlugin: args.hasTestPlugin,
      skipTests: args.skipTests,
      riskReason: reasons.join('; '),
      migrationConcern:
        'Without a working test build it is unsafe to claim post-migration parity. Re-establish test execution before changing dependencies.',
      confidence: 0.85,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
  };
}

// ---------------------------------------------------------------------------
// Per-POM scan
// ---------------------------------------------------------------------------

function isTestFrameworkDep(dep: DeclaredDependency): boolean {
  const [groupId, artifactId] = dep.name.split(':');
  if (TEST_FRAMEWORK_GROUP_IDS.has(groupId)) return true;
  const lc = artifactId.toLowerCase();
  return TEST_FRAMEWORK_ARTIFACT_HINTS.some((h) => lc.includes(h));
}

function pluginMatches(plugin: PomPlugin, artifactIds: string[]): boolean {
  return plugin.artifactId !== null && artifactIds.includes(plugin.artifactId);
}

function scanSinglePom(
  pom: MavenPomScannerInput,
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];

  // -------------------- java_version_detected --------------------
  const javaSignal = detectJavaVersionForPom(pom);
  if (javaSignal && underCap(counts, 'java_version_detected')) {
    const sev = severityForJavaVersion(javaSignal.version);
    if (sev !== null) {
      const allowEmit =
        sev.severity !== 'info' || EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION;
      if (allowEmit) {
        out.push(
          buildJavaVersionFinding({
            pomPath: pom.pomPath,
            version: javaSignal.version,
            normalisedMajor: sev.normalisedMajor,
            signalKey: javaSignal.signalKey,
            severity: sev.severity,
          }),
        );
        bumpCap(counts, 'java_version_detected');
      }
    }
  }

  // -------------------- spring_version_detected --------------------
  const springSignal = detectSpringVersionForPom(pom);
  if (springSignal && underCap(counts, 'spring_version_detected')) {
    const sev = severityForSpringMajor(springSignal.springMajor);
    const allowEmit =
      sev !== 'info' || EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION;
    if (allowEmit) {
      out.push(
        buildSpringVersionFinding({
          pomPath: pom.pomPath,
          springMajor: springSignal.springMajor,
          resolvedVersion: springSignal.resolvedVersion,
          signalKey: springSignal.signalKey,
        }),
      );
      bumpCap(counts, 'spring_version_detected');
    }
  }

  // -------------------- risky_dependency + database_driver_detected --------------------
  // Walk dependencies once; each dep can produce up to ONE risky_dependency
  // finding (first matching rule wins) AND up to ONE database_driver_detected.
  for (const dep of pom.dependencies) {
    const colon = dep.name.indexOf(':');
    if (colon < 0) continue;
    const groupId = dep.name.slice(0, colon);
    const artifactId = dep.name.slice(colon + 1);
    const declaredVersion = dep.version ?? null;
    const resolvedVersion = resolvePropertyRef(declaredVersion, pom.metadata.properties);

    // risky_dependency rule match
    try {
      const rule = RISKY_DEPENDENCY_RULES.find(
        (r) =>
          r.groupId === groupId &&
          r.artifactId === artifactId &&
          r.versionPredicate(resolvedVersion),
      );
      if (rule && underCap(counts, 'risky_dependency')) {
        out.push(
          buildRiskyDependencyFinding({
            pomPath: pom.pomPath,
            groupId,
            artifactId,
            declaredVersion,
            resolvedVersion,
            scope: dep.scope ?? null,
            reason: rule.reason,
            severity: rule.severity,
          }),
        );
        bumpCap(counts, 'risky_dependency');
      }
    } catch (err) {
      // Soft-fail per dep: a busted predicate must not kill the rest.
      console.warn(
        `[mavenFindingScanner] risky_dependency predicate threw for ${dep.name} in ${pom.pomPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // database_driver_detected
    try {
      const vendor = lookupDatabaseDriver(groupId, artifactId);
      if (vendor !== null && underCap(counts, 'database_driver_detected')) {
        out.push(
          buildDatabaseDriverFinding({
            pomPath: pom.pomPath,
            groupId,
            artifactId,
            version: resolvedVersion,
            databaseVendor: vendor,
          }),
        );
        bumpCap(counts, 'database_driver_detected');
      }
    } catch (err) {
      console.warn(
        `[mavenFindingScanner] database_driver lookup threw for ${dep.name} in ${pom.pomPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -------------------- maven_build_plugin_risk --------------------
  for (const plugin of pom.metadata.plugins) {
    if (!plugin.groupId || !plugin.artifactId) continue;
    const resolvedPluginVersion = resolvePropertyRef(plugin.version, pom.metadata.properties);
    try {
      const rule = RISKY_PLUGIN_RULES.find(
        (r) =>
          r.groupId === plugin.groupId &&
          r.artifactId === plugin.artifactId &&
          r.versionPredicate(resolvedPluginVersion),
      );
      if (rule && underCap(counts, 'maven_build_plugin_risk')) {
        out.push(
          buildMavenPluginRiskFinding({
            pomPath: pom.pomPath,
            groupId: plugin.groupId,
            artifactId: plugin.artifactId,
            version: resolvedPluginVersion,
            reason: rule.reason,
            severity: rule.severity,
            isManaged: plugin.isManaged,
          }),
        );
        bumpCap(counts, 'maven_build_plugin_risk');
      }
    } catch (err) {
      console.warn(
        `[mavenFindingScanner] maven_build_plugin_risk predicate threw for ${plugin.groupId}:${plugin.artifactId} in ${pom.pomPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -------------------- dependency_version_conflict --------------------
  // (a) Same (groupId:artifactId) declared twice with different versions in
  // the same POM. (b) An unresolved ${propname} left after resolution.
  const seenVersions = new Map<string, Set<string>>(); // key -> distinct versions seen
  for (const dep of pom.dependencies) {
    const declared = dep.version ?? null;
    const resolved = resolvePropertyRef(declared, pom.metadata.properties);
    // Unresolved placeholder?
    if (declared !== null && declared.startsWith('${') && declared === resolved) {
      if (underCap(counts, 'dependency_version_conflict')) {
        const colon = dep.name.indexOf(':');
        const groupId = colon >= 0 ? dep.name.slice(0, colon) : dep.name;
        const artifactId = colon >= 0 ? dep.name.slice(colon + 1) : '';
        out.push(
          buildDependencyVersionConflictFinding({
            pomPath: pom.pomPath,
            groupId,
            artifactId,
            unresolvedValue: declared,
            riskReason: `Version placeholder '${declared}' could not be resolved against <properties>.`,
          }),
        );
        bumpCap(counts, 'dependency_version_conflict');
      }
    }
    if (resolved == null) continue;
    const set = seenVersions.get(dep.name);
    if (set) {
      set.add(resolved);
    } else {
      seenVersions.set(dep.name, new Set([resolved]));
    }
  }
  for (const [name, versions] of seenVersions) {
    if (versions.size <= 1) continue;
    if (!underCap(counts, 'dependency_version_conflict')) break;
    const colon = name.indexOf(':');
    const groupId = colon >= 0 ? name.slice(0, colon) : name;
    const artifactId = colon >= 0 ? name.slice(colon + 1) : '';
    out.push(
      buildDependencyVersionConflictFinding({
        pomPath: pom.pomPath,
        groupId,
        artifactId,
        versions: Array.from(versions).sort(),
        riskReason:
          `Multiple distinct versions declared in the same POM (${Array.from(versions).sort().join(', ')}).`,
      }),
    );
    bumpCap(counts, 'dependency_version_conflict');
  }

  // -------------------- test_build_gap --------------------
  if (underCap(counts, 'test_build_gap')) {
    const testDeps = pom.dependencies.filter(
      (d) => d.scope === 'test' && isTestFrameworkDep(d),
    );
    const hasTestDeps = testDeps.length > 0;
    const hasTestPlugin = pom.metadata.plugins.some((p) =>
      pluginMatches(p, ['maven-surefire-plugin', 'maven-failsafe-plugin']),
    );
    const skipTests = (() => {
      const v = pom.metadata.properties['skipTests'] ?? pom.metadata.properties['maven.test.skip'];
      return typeof v === 'string' && v.toLowerCase() === 'true';
    })();
    if (!hasTestDeps || !hasTestPlugin || skipTests) {
      out.push(
        buildTestBuildGapFinding({
          pomPath: pom.pomPath,
          hasTestDeps,
          hasTestPlugin,
          skipTests,
        }),
      );
      bumpCap(counts, 'test_build_gap');
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Maven pack finding scanner entry point. Pure: takes resolver output +
 * per-POM metadata, returns FindingEmitInputs. Caller passes the result
 * to `findingEmitter.emitFindings`.
 *
 * Soft-fail at per-POM granularity: one POM failing logs a warning and
 * continues with the rest. Per-dep and per-plugin predicate failures
 * are caught inside `scanSinglePom`.
 */
export function runMavenFindingScanner(
  input: MavenFindingScannerInput,
): FindingEmitInput[] {
  const start = Date.now();
  console.log(`[diag-pack] scanner=maven start files=${input.poms.length}`);
  const collected: FindingEmitInput[] = [];
  const counts = new Map<string, number>();
  let softFailPoms = 0;
  for (const pom of input.poms) {
    try {
      collected.push(...scanSinglePom(pom, counts));
    } catch (err) {
      softFailPoms += 1;
      console.warn(
        `[mavenFindingScanner] Failed on POM '${pom.pomPath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      // Structured diag: category only, never the POM path.
      console.warn(`[diag-pack] scanner=maven soft_fail=true category=parse_error`);
    }
  }
  for (const [type, count] of counts) {
    if (count >= MAX_FINDINGS_PER_TYPE_PER_RUN) {
      console.warn(`[diag-pack] scanner=maven cap_hit=true type=${type} at=${count}`);
    }
  }
  // by_type summary -- top 8 types by count, stable order.
  const byTypeCounts = new Map<string, number>();
  for (const f of collected) {
    const k = (f.findingType || 'unknown').toLowerCase();
    byTypeCounts.set(k, (byTypeCounts.get(k) ?? 0) + 1);
  }
  const byType = Array.from(byTypeCounts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([t, c]) => `${t}:${c}`)
    .join(',');
  console.log(
    `[diag-pack] scanner=maven elapsed_ms=${Date.now() - start} ` +
      `emitted_total=${collected.length} by_type=${byType}` +
      (softFailPoms > 0 ? ` soft_fail_files=${softFailPoms}` : ''),
  );
  return collected;
}
