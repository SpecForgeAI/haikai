/**
 * Manifest coordinate -> dependency-answerable decision-code mapping.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 3
 * (task 3.2: "Select the dependency-answerable code subset").
 *
 * PURE DATA + PURE RESOLVERS. No I/O, no LLM, no network, no orchestration.
 *
 * WHAT THIS IS
 * ------------
 * A manifest yields raw coordinates (`org.springframework.boot:spring-boot-
 * starter-web`, `react`, `org.postgresql:postgresql`, ...). The architect
 * conversation's `questionLibrary.ts` codes are ABSTRACT choices (`service.
 * framework` = "Spring Boot 3.4", `db.driver` = "pgjdbc", ...). This module is
 * the deterministic bridge: it recognises the DISTINCTIVE coordinate(s) for a
 * dependency-answerable decision code and maps them to a canonical framework
 * label, leaving the version to flow from Group 2's resolved value (concrete or
 * `version-unknown`).
 *
 * WHY ONLY THESE CODES
 * --------------------
 * Spec 6's per-question dependency matrix (encoded on every `questionLibrary.ts`
 * entry via `dependencyClass` / `foundationalInputs` / `versioned`) defines the
 * dependency-answerable subset as the framework, libraries, build-tool and
 * driver codes — "the codes a manifest can DETERMINISTICALLY resolve". This
 * module consumes that classification (it does NOT re-derive it): every target
 * code here is one of the seven `versioned: true` codes AND is one a single
 * manifest coordinate can deterministically witness:
 *
 *   - `service.framework`  — the application framework (Spring Boot / Quarkus /
 *                            Micronaut / NestJS / ...), witnessed by its
 *                            starter/core coordinate.
 *   - `db.driver`          — the JDBC/native driver, witnessed by the driver
 *                            coordinate.
 *   - `ui.framework`       — the frontend framework (React / Vue / Angular /
 *                            Svelte), witnessed by its npm package.
 *   - `build.tool`         — derived from the manifest ECOSYSTEM itself
 *                            (pom.xml => Maven, package.json => npm + tsc); see
 *                            `buildToolAnswerForEcosystem`.
 *
 * Non-dependency codes (cutover, auth policy, rate limiting, secrets, ...) are
 * deliberately ABSENT — a manifest cannot deterministically resolve them, and
 * Spec 3 forbids attempting them.
 *
 * `service.language` / `service.runtime` / `db.engine` are versioned codes too,
 * but a manifest does not DIRECTLY witness them (the language is implied by the
 * ecosystem, the engine only INFERRED from a driver). To honour the "no
 * guessing" rule we do NOT auto-answer them from an inference; they remain for
 * the user / the LLM tech-stack pre-fill.
 *
 * The framework label emitted here is the conversation's canonical chip stem
 * (e.g. "Spring Boot"); Group 3 pairs it with the resolved version to form the
 * structured `{ framework, version }` value and the single resolved chip.
 */

import { ManifestEcosystem } from './manifestDependencyResolvers';
import { ResolvedDependency } from './manifestVersionResolution';

/**
 * One dependency-answerable mapping produced from a resolved coordinate: the
 * target decision code + the canonical framework label. The version is supplied
 * separately by the caller from the {@link ResolvedDependency} (so a
 * `version-unknown` resolution flows through unchanged).
 */
export interface ManifestCodeMatch {
  decisionCode: string;
  /** Canonical framework label / chip stem (e.g. "Spring Boot", "pgjdbc"). */
  framework: string;
}

/**
 * A coordinate matcher rule. `test` decides whether a coordinate name matches;
 * `decisionCode` + `framework` are emitted on a hit. Rules are evaluated in
 * declaration order and the FIRST matching rule wins for a given coordinate.
 */
interface CoordinateRule {
  decisionCode: string;
  framework: string;
  test: (coordinateName: string) => boolean;
}

const startsWithAny = (name: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => name.startsWith(p));

const equalsAny = (name: string, names: readonly string[]): boolean =>
  names.some((n) => name === n);

// ---------------------------------------------------------------------------
// Maven coordinate rules (name = `groupId:artifactId`)
// ---------------------------------------------------------------------------

const MAVEN_RULES: readonly CoordinateRule[] = [
  // --- service.framework (application framework) ---
  {
    decisionCode: 'service.framework',
    framework: 'Spring Boot',
    test: (n) => n.startsWith('org.springframework.boot:spring-boot'),
  },
  {
    decisionCode: 'service.framework',
    framework: 'Quarkus',
    test: (n) => n.startsWith('io.quarkus:'),
  },
  {
    decisionCode: 'service.framework',
    framework: 'Micronaut',
    test: (n) => n.startsWith('io.micronaut:'),
  },

  // --- db.driver (JDBC / native driver coordinates) ---
  {
    decisionCode: 'db.driver',
    framework: 'pgjdbc',
    test: (n) => n === 'org.postgresql:postgresql',
  },
  {
    decisionCode: 'db.driver',
    framework: 'mysql-connector-j',
    test: (n) =>
      n === 'com.mysql:mysql-connector-j' || n === 'mysql:mysql-connector-java',
  },
  {
    decisionCode: 'db.driver',
    framework: 'mssql-jdbc',
    test: (n) => n === 'com.microsoft.sqlserver:mssql-jdbc',
  },
  {
    decisionCode: 'db.driver',
    framework: 'oracle ojdbc11',
    test: (n) => startsWithAny(n, ['com.oracle.database.jdbc:ojdbc']),
  },
  {
    decisionCode: 'db.driver',
    framework: 'jtds',
    test: (n) => n === 'net.sourceforge.jtds:jtds',
  },
  {
    decisionCode: 'db.driver',
    framework: 'mongo-java-driver',
    test: (n) =>
      startsWithAny(n, [
        'org.mongodb:mongodb-driver',
        'org.mongodb:mongo-java-driver',
      ]),
  },
];

// ---------------------------------------------------------------------------
// npm coordinate rules (name = full package name incl. `@scope/`)
// ---------------------------------------------------------------------------

const NPM_RULES: readonly CoordinateRule[] = [
  // --- service.framework (Node application framework) ---
  {
    decisionCode: 'service.framework',
    framework: 'NestJS',
    test: (n) => n === '@nestjs/core' || n.startsWith('@nestjs/'),
  },

  // --- ui.framework (frontend framework) ---
  {
    decisionCode: 'ui.framework',
    framework: 'React',
    test: (n) => equalsAny(n, ['react', 'react-dom']),
  },
  {
    decisionCode: 'ui.framework',
    framework: 'Vue',
    test: (n) => n === 'vue',
  },
  {
    decisionCode: 'ui.framework',
    framework: 'Angular',
    test: (n) => n === '@angular/core' || n.startsWith('@angular/'),
  },
  {
    decisionCode: 'ui.framework',
    framework: 'Svelte',
    test: (n) => n === 'svelte',
  },
];

/**
 * The set of decision codes this module can auto-answer DIRECTLY from a
 * coordinate (excludes `build.tool`, which is derived from the ecosystem). Used
 * by Group 3's selection boundary so a non-dependency code is never attempted.
 */
export const COORDINATE_ANSWERABLE_CODES: ReadonlySet<string> = new Set(
  [...MAVEN_RULES, ...NPM_RULES].map((r) => r.decisionCode),
);

/** The build-tool code is answered from the ecosystem, not a coordinate. */
export const BUILD_TOOL_CODE = 'build.tool';

/**
 * The full dependency-answerable code subset this module owns (coordinate
 * matches + the ecosystem-derived build tool). Anything outside this set is a
 * non-dependency code and is NEVER auto-answered (Spec 3 selection boundary).
 */
export const DEPENDENCY_ANSWERABLE_CODES: ReadonlySet<string> = new Set([
  ...COORDINATE_ANSWERABLE_CODES,
  BUILD_TOOL_CODE,
]);

/**
 * Map a single resolved coordinate to its dependency-answerable decision code +
 * canonical framework label, or `null` when the coordinate witnesses no
 * dependency-answerable code (the common case — most coordinates are ordinary
 * libraries that do not pin one of the curated decision codes).
 *
 * Pure; deterministic; first-matching-rule-wins.
 */
export function matchManifestCoordinate(
  dep: ResolvedDependency,
): ManifestCodeMatch | null {
  const rules = dep.ecosystem === 'MAVEN' ? MAVEN_RULES : NPM_RULES;
  for (const rule of rules) {
    if (rule.test(dep.name)) {
      return { decisionCode: rule.decisionCode, framework: rule.framework };
    }
  }
  return null;
}

/**
 * The canonical `build.tool` framework label for a manifest ecosystem. A
 * manifest's mere existence witnesses its build tool deterministically:
 *   - a `pom.xml`        => Maven (`Maven 3.9`, the curated chip).
 *   - a `package.json`   => npm + tsc (`npm + tsc`, the curated chip).
 *
 * Returns `null` for an unrecognised ecosystem (defensive — never happens for
 * the two supported ecosystems).
 */
export function buildToolFrameworkForEcosystem(
  ecosystem: ManifestEcosystem,
): string | null {
  if (ecosystem === 'MAVEN') return 'Maven 3.9';
  if (ecosystem === 'NPM') return 'npm + tsc';
  return null;
}
