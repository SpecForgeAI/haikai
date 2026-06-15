/**
 * Hand-curated risky-dependency + risky-plugin rule set.
 *
 * Spec: 2026-05-16 Wire Java + Spring + Maven Findings (D4 + D5).
 *
 * Two arrays, both hand-curated TypeScript:
 *   - {@link RISKY_DEPENDENCY_RULES} -- matched by the Maven scanner's
 *     `risky_dependency` emission per (groupId, artifactId, version).
 *   - {@link RISKY_PLUGIN_RULES}     -- matched by the Maven scanner's
 *     `maven_build_plugin_risk` emission per (groupId, artifactId, version).
 *
 * Version predicates are plain TypeScript closures over `(version: string|null)`.
 * `null` indicates the POM declares no explicit version (e.g. inherited
 * from parent / pluginManagement). Rules that should match an "any-version"
 * coordinate (e.g. `commons-logging` -- the artifact is superseded full-stop)
 * accept any value INCLUDING null.
 *
 * Per-rule `severity` is the literal severity the Maven scanner emits when
 * the rule matches. No central severity table -- each rule names its own.
 *
 * No JSON / YAML config in v1. Adding / tweaking entries is a code review.
 */

export interface RiskyDependencyRule {
  groupId: string;
  artifactId: string;
  /** Predicate over the declared version. Receives null when no <version>. */
  versionPredicate: (version: string | null) => boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface RiskyPluginRule {
  groupId: string;
  artifactId: string;
  versionPredicate: (version: string | null) => boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Version-predicate helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Maven-ish version string into (major, minor, patch). Tolerates
 * suffixes like `-RC1`, `.RELEASE`, `${prop}`. Returns null on
 * unresolvable input (e.g. an unresolved `${propname}` reference).
 */
export function parseVersionTriple(
  v: string | null,
): { major: number; minor: number; patch: number } | null {
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  // Reject unresolved property references.
  if (trimmed.startsWith('${')) return null;
  // Reject Maven ranges (we cannot compare against a range without a resolver).
  if (/^[\[(]/.test(trimmed)) return null;
  const m = trimmed.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: m[2] !== undefined ? parseInt(m[2], 10) : 0,
    patch: m[3] !== undefined ? parseInt(m[3], 10) : 0,
  };
}

/**
 * True when `version` parses successfully and the parsed major is strictly
 * less than `cutoff`. False on unresolvable input (we cannot positively flag
 * what we cannot read).
 */
export function majorLessThan(version: string | null, cutoff: number): boolean {
  const t = parseVersionTriple(version);
  return t !== null && t.major < cutoff;
}

/**
 * True when `version` parses successfully and (major, minor) < (cutoffMajor, cutoffMinor).
 */
export function majorMinorLessThan(
  version: string | null,
  cutoffMajor: number,
  cutoffMinor: number,
): boolean {
  const t = parseVersionTriple(version);
  if (t === null) return false;
  if (t.major < cutoffMajor) return true;
  if (t.major > cutoffMajor) return false;
  return t.minor < cutoffMinor;
}

const anyVersion = (_v: string | null) => true;

// ---------------------------------------------------------------------------
// Risky dependency rules (~20-30 seed entries)
// ---------------------------------------------------------------------------

export const RISKY_DEPENDENCY_RULES: RiskyDependencyRule[] = [
  // --- Logging frameworks ---
  {
    groupId: 'log4j',
    artifactId: 'log4j',
    versionPredicate: anyVersion,
    reason: 'log4j 1.x is end-of-life. Migrate to log4j 2.x or logback.',
    severity: 'high',
  },
  {
    groupId: 'org.apache.logging.log4j',
    artifactId: 'log4j-core',
    versionPredicate: (v) => majorMinorLessThan(v, 2, 17),
    reason: 'log4j-core < 2.17 carries the Log4Shell family of vulnerabilities.',
    severity: 'high',
  },
  {
    groupId: 'commons-logging',
    artifactId: 'commons-logging',
    versionPredicate: anyVersion,
    reason: 'commons-logging is superseded by slf4j/logback for new code.',
    severity: 'medium',
  },

  // --- Apache Commons legacy artifacts ---
  {
    groupId: 'commons-lang',
    artifactId: 'commons-lang',
    versionPredicate: anyVersion,
    reason: 'commons-lang (2.x) is superseded by commons-lang3 (org.apache.commons:commons-lang3).',
    severity: 'medium',
  },
  {
    groupId: 'commons-httpclient',
    artifactId: 'commons-httpclient',
    versionPredicate: anyVersion,
    reason: 'commons-httpclient 3.x is end-of-life. Migrate to org.apache.httpcomponents.client5:httpclient5.',
    severity: 'high',
  },
  {
    groupId: 'commons-collections',
    artifactId: 'commons-collections',
    versionPredicate: anyVersion,
    reason: 'commons-collections 3.x has known deserialisation vulnerabilities. Migrate to commons-collections4.',
    severity: 'high',
  },

  // --- HTTP clients ---
  {
    groupId: 'org.apache.httpcomponents',
    artifactId: 'httpclient',
    versionPredicate: (v) => majorLessThan(v, 4),
    reason: 'Apache httpclient 3.x is end-of-life.',
    severity: 'high',
  },

  // --- JSON / serialisation ---
  {
    groupId: 'com.fasterxml.jackson.core',
    artifactId: 'jackson-databind',
    versionPredicate: (v) => majorMinorLessThan(v, 2, 13),
    reason: 'jackson-databind < 2.13 carries multiple known CVEs. Upgrade to >= 2.16.',
    severity: 'high',
  },
  {
    groupId: 'com.google.code.gson',
    artifactId: 'gson',
    versionPredicate: (v) => majorMinorLessThan(v, 2, 8),
    reason: 'Gson < 2.8 has known security issues; upgrade to the latest 2.x.',
    severity: 'medium',
  },
  {
    groupId: 'org.codehaus.jackson',
    artifactId: 'jackson-mapper-asl',
    versionPredicate: anyVersion,
    reason: 'org.codehaus.jackson is the abandoned Jackson 1.x; migrate to com.fasterxml.jackson.core.',
    severity: 'high',
  },

  // --- Servlet / Jakarta migration ---
  {
    groupId: 'javax.servlet',
    artifactId: 'servlet-api',
    versionPredicate: anyVersion,
    reason: 'javax.servlet is superseded by jakarta.servlet (Jakarta EE 9+, Spring 6+).',
    severity: 'high',
  },
  {
    groupId: 'javax.servlet',
    artifactId: 'javax.servlet-api',
    versionPredicate: anyVersion,
    reason: 'javax.servlet is superseded by jakarta.servlet (Jakarta EE 9+, Spring 6+).',
    severity: 'high',
  },
  {
    groupId: 'javax.persistence',
    artifactId: 'persistence-api',
    versionPredicate: anyVersion,
    reason: 'javax.persistence is superseded by jakarta.persistence (Jakarta EE 9+, Hibernate 6+).',
    severity: 'high',
  },
  {
    groupId: 'javax.annotation',
    artifactId: 'javax.annotation-api',
    versionPredicate: anyVersion,
    reason: 'javax.annotation is superseded by jakarta.annotation (Jakarta EE 9+).',
    severity: 'medium',
  },

  // --- Date / time ---
  {
    groupId: 'joda-time',
    artifactId: 'joda-time',
    versionPredicate: anyVersion,
    reason: 'joda-time is superseded by java.time (JSR-310, Java 8+).',
    severity: 'low',
  },

  // --- Database drivers (legacy) ---
  {
    groupId: 'com.sybase.jdbc3.jdbc',
    artifactId: 'jconn3',
    versionPredicate: anyVersion,
    reason: 'Sybase jConn3 is end-of-life. Migrate to jConnect 7+ or a modern equivalent.',
    severity: 'high',
  },
  {
    groupId: 'com.sybase.jdbc4.jdbc',
    artifactId: 'jconn4',
    versionPredicate: anyVersion,
    reason: 'Sybase jConn4 is end-of-life. Migrate to jConnect 7+ or a modern equivalent.',
    severity: 'medium',
  },

  // --- Test stack ---
  {
    groupId: 'junit',
    artifactId: 'junit',
    versionPredicate: (v) => majorLessThan(v, 5),
    reason: 'JUnit 3/4 (group `junit`) is superseded by JUnit Jupiter (org.junit.jupiter).',
    severity: 'medium',
  },
  {
    groupId: 'org.mockito',
    artifactId: 'mockito-all',
    versionPredicate: anyVersion,
    reason: 'mockito-all is superseded by mockito-core; latest versions are not published as mockito-all.',
    severity: 'medium',
  },
  {
    groupId: 'org.mockito',
    artifactId: 'mockito-core',
    versionPredicate: (v) => majorLessThan(v, 4),
    reason: 'mockito-core < 4 does not support modern JDK 17 features (e.g. inline mocking on records).',
    severity: 'medium',
  },

  // --- Spring (very old) ---
  {
    groupId: 'org.springframework',
    artifactId: 'spring-core',
    versionPredicate: (v) => majorLessThan(v, 5),
    reason: 'Spring Framework < 5 is end-of-life and incompatible with Java 17 (jakarta namespace).',
    severity: 'high',
  },

  // --- XML / SOAP ---
  {
    groupId: 'org.apache.axis',
    artifactId: 'axis',
    versionPredicate: anyVersion,
    reason: 'Apache Axis 1.x is end-of-life. Migrate to Apache CXF or Spring WS.',
    severity: 'high',
  },
  {
    groupId: 'xerces',
    artifactId: 'xercesImpl',
    versionPredicate: anyVersion,
    reason: 'xerces is bundled with the JDK; explicit dependency is rarely needed and shadows the platform parser.',
    severity: 'low',
  },

  // --- Validation API ---
  {
    groupId: 'javax.validation',
    artifactId: 'validation-api',
    versionPredicate: anyVersion,
    reason: 'javax.validation is superseded by jakarta.validation (Jakarta EE 9+, Bean Validation 3+).',
    severity: 'medium',
  },

  // --- Misc ---
  {
    groupId: 'org.apache.struts',
    artifactId: 'struts2-core',
    versionPredicate: anyVersion,
    reason: 'Apache Struts has a long history of remote-code-execution CVEs. Avoid for new code.',
    severity: 'high',
  },
];

// ---------------------------------------------------------------------------
// Risky plugin rules (D5)
// ---------------------------------------------------------------------------

export const RISKY_PLUGIN_RULES: RiskyPluginRule[] = [
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-compiler-plugin',
    versionPredicate: (v) => majorLessThan(v, 3),
    reason: 'maven-compiler-plugin < 3.0 lacks support for modern Java release / source flags.',
    severity: 'high',
  },
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-compiler-plugin',
    versionPredicate: (v) => {
      const t = parseVersionTriple(v);
      if (t === null) return false;
      // 3.0 <= v < 3.8.0  ->  medium
      if (t.major !== 3) return false;
      return t.minor < 8;
    },
    reason: 'maven-compiler-plugin < 3.8.0 cannot resolve `--release` correctly on Java 9+.',
    severity: 'medium',
  },
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-surefire-plugin',
    versionPredicate: (v) => majorLessThan(v, 3),
    reason: 'maven-surefire-plugin < 3.0 does not support JUnit 5 natively.',
    severity: 'medium',
  },
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-failsafe-plugin',
    versionPredicate: (v) => majorLessThan(v, 3),
    reason: 'maven-failsafe-plugin < 3.0 does not support JUnit 5 natively.',
    severity: 'medium',
  },
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-jar-plugin',
    versionPredicate: (v) => majorLessThan(v, 3),
    reason: 'maven-jar-plugin < 3.0 cannot emit modular JARs.',
    severity: 'low',
  },
  {
    groupId: 'org.apache.maven.plugins',
    artifactId: 'maven-war-plugin',
    versionPredicate: (v) => majorLessThan(v, 3),
    reason: 'maven-war-plugin < 3.0 may fail on modern Servlet 5 / Jakarta containers.',
    severity: 'medium',
  },
];

// ---------------------------------------------------------------------------
// Database driver coordinates (D4 -- not version-gated; presence-only)
// ---------------------------------------------------------------------------

export interface DatabaseDriverRule {
  groupId: string;
  artifactId: string;
  databaseVendor: string;
}

/**
 * Known database driver coordinates. Used by the `database_driver_detected`
 * scanner emission. NOT version-gated -- presence-only; the scanner emits
 * one finding per detected driver.
 */
export const DATABASE_DRIVER_RULES: DatabaseDriverRule[] = [
  // Sybase / SAP ASE
  { groupId: 'com.sybase.jdbc3.jdbc', artifactId: 'jconn3', databaseVendor: 'Sybase' },
  { groupId: 'com.sybase.jdbc4.jdbc', artifactId: 'jconn4', databaseVendor: 'Sybase' },
  { groupId: 'com.sybase', artifactId: 'jconn4', databaseVendor: 'Sybase' },
  { groupId: 'com.sybase', artifactId: 'jconnect', databaseVendor: 'Sybase' },
  { groupId: 'net.sourceforge.jtds', artifactId: 'jtds', databaseVendor: 'Sybase/SQL Server' },

  // PostgreSQL
  { groupId: 'org.postgresql', artifactId: 'postgresql', databaseVendor: 'PostgreSQL' },

  // Oracle
  { groupId: 'com.oracle.database.jdbc', artifactId: 'ojdbc8', databaseVendor: 'Oracle' },
  { groupId: 'com.oracle.database.jdbc', artifactId: 'ojdbc11', databaseVendor: 'Oracle' },
  { groupId: 'com.oracle.ojdbc', artifactId: 'ojdbc8', databaseVendor: 'Oracle' },
  { groupId: 'com.oracle.jdbc', artifactId: 'ojdbc8', databaseVendor: 'Oracle' },

  // SQL Server
  { groupId: 'com.microsoft.sqlserver', artifactId: 'mssql-jdbc', databaseVendor: 'SQL Server' },

  // MySQL / MariaDB
  { groupId: 'mysql', artifactId: 'mysql-connector-java', databaseVendor: 'MySQL' },
  { groupId: 'com.mysql', artifactId: 'mysql-connector-j', databaseVendor: 'MySQL' },
  { groupId: 'org.mariadb.jdbc', artifactId: 'mariadb-java-client', databaseVendor: 'MariaDB' },

  // DB2
  { groupId: 'com.ibm.db2', artifactId: 'jcc', databaseVendor: 'DB2' },
  { groupId: 'com.ibm.db2.jcc', artifactId: 'db2jcc', databaseVendor: 'DB2' },

  // H2 / HSQLDB (embedded)
  { groupId: 'com.h2database', artifactId: 'h2', databaseVendor: 'H2' },
  { groupId: 'org.hsqldb', artifactId: 'hsqldb', databaseVendor: 'HSQLDB' },
];

/**
 * Look up the database vendor for a (groupId, artifactId) pair. Returns
 * the vendor name on match, or null when the artifact is not a known
 * driver. Comparison is case-sensitive (Maven coordinates are case-sensitive).
 */
export function lookupDatabaseDriver(
  groupId: string | null,
  artifactId: string | null,
): string | null {
  if (groupId == null || artifactId == null) return null;
  const hit = DATABASE_DRIVER_RULES.find(
    (r) => r.groupId === groupId && r.artifactId === artifactId,
  );
  return hit ? hit.databaseVendor : null;
}
