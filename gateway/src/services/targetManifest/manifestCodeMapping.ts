/**
 * Manifest coordinate -> dependency-answerable decision-code mapping.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 3
 * (origin), expanded by 2026-06-26-target-dependency-manifest-auto-answer-
 * comprehensive (Spec 2) — Task Group 2 (union answer shape + closed-choice
 * witness coverage).
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
 * dependency-answerable decision code and maps them to a UNION answer:
 *
 *   - `{ kind: 'framework-version', framework }` — a BARE STEM (e.g. `Spring
 *     Boot`, `Flyway`, `Maven`) for any of Spec 1's 24 `versioned: true` codes.
 *     The version is supplied SEPARATELY by the caller from the resolved
 *     {@link ResolvedDependency} (so a `version-unknown` resolution flows
 *     through unchanged). Aligns with Spec 1's bare-stem `{ framework, version }`
 *     capture envelope.
 *   - `{ kind: 'single-choice', value }` — the EXACT `questionLibrary.choices`
 *     string for the genuinely-non-versioned residue (e.g.
 *     `interservice.discoveryMechanism` => `Eureka` / `Consul`).
 *
 * WHY ONLY THESE CODES
 * --------------------
 * Spec 6's per-question dependency matrix (encoded on every `questionLibrary.ts`
 * entry via `dependencyClass` / `foundationalInputs` / `versioned`) defines the
 * dependency-answerable subset. This module covers the codes a SINGLE manifest
 * coordinate can STRONGLY and UNAMBIGUOUSLY witness (closed-choice coverage per
 * code — NOT "top-N popular libraries"): the application framework, the driver,
 * the UI framework, migrations / connection-pool / validation / logging /
 * metrics / tracing / mapping / async-bus / discovery / the testing.* family,
 * and the ui.* tooling family. Ambiguous / combo codes (e.g. which Vitest+TL vs
 * Jest+TL flavour, Playwright shared between e2e + ui.testing) are deliberately
 * LEFT to the LLM gap-fill (a later group).
 *
 * Non-dependency codes (cutover, auth policy, rate limiting, secrets,
 * logging.format, container.*, ci.pipeline, deployment.*, ...) are deliberately
 * ABSENT — a manifest cannot deterministically resolve them, and the spec
 * forbids attempting them.
 *
 * `service.language` (from `<properties>` java.version / kotlin.version),
 * `db.migrations` (from a flyway/liquibase `maven-plugin`), `db.engine` and
 * `service.runtime` (INFERRED) are resolved elsewhere — the property/plugin
 * extractors (`manifestFactExtractors.ts`) and the inference layer — because a
 * single dependency coordinate does not DIRECTLY witness them.
 *
 * The framework label emitted here is the conversation's canonical chip stem
 * (e.g. "Spring Boot"); the caller pairs it with the resolved version to form the
 * structured `{ framework, version }` value and the single resolved chip.
 */

import { ManifestEcosystem } from './manifestDependencyResolvers';
import { ResolvedDependency } from './manifestVersionResolution';

/**
 * The answer a witness yields. Either a bare-stem framework-version answer (the
 * version is supplied separately from the resolved dependency) for a Spec-1
 * versioned code, OR a plain single-choice value (the EXACT questionLibrary
 * choice string) for the genuinely-non-versioned residue.
 */
export type ManifestCoordinateAnswer =
  | { kind: 'framework-version'; framework: string }
  | { kind: 'single-choice'; value: string };

/**
 * One dependency-answerable mapping produced from a resolved coordinate: the
 * target decision code plus the union answer. For the `framework-version` kind
 * the version comes from the {@link ResolvedDependency}; for the `single-choice`
 * kind the `value` is the verbatim choice string.
 */
export type ManifestCodeMatch = { decisionCode: string } & ManifestCoordinateAnswer;

/**
 * A coordinate matcher rule. `test` decides whether a coordinate name matches;
 * `decisionCode` + `answer` are emitted on a hit. Rules are evaluated in
 * declaration order and the FIRST matching rule wins for a given coordinate.
 */
interface CoordinateRule {
  decisionCode: string;
  answer: ManifestCoordinateAnswer;
  test: (coordinateName: string) => boolean;
}

const startsWithAny = (name: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => name.startsWith(p));

const equalsAny = (name: string, names: readonly string[]): boolean =>
  names.some((n) => name === n);

/** Bare-stem framework-version answer (version supplied separately by the caller). */
const fwAnswer = (framework: string): ManifestCoordinateAnswer => ({
  kind: 'framework-version',
  framework,
});

/** Single-choice answer — `value` MUST be a verbatim `questionLibrary.choices` member. */
const scAnswer = (value: string): ManifestCoordinateAnswer => ({
  kind: 'single-choice',
  value,
});

// ---------------------------------------------------------------------------
// Maven coordinate rules (name = `groupId:artifactId`)
// ---------------------------------------------------------------------------

const MAVEN_RULES: readonly CoordinateRule[] = [
  // --- service.framework (application framework) ---
  {
    decisionCode: 'service.framework',
    answer: fwAnswer('Spring Boot'),
    test: (n) => n.startsWith('org.springframework.boot:spring-boot'),
  },
  {
    decisionCode: 'service.framework',
    answer: fwAnswer('Quarkus'),
    test: (n) => n.startsWith('io.quarkus:'),
  },
  {
    decisionCode: 'service.framework',
    answer: fwAnswer('Micronaut'),
    test: (n) => n.startsWith('io.micronaut:'),
  },

  // --- db.driver (JDBC / native driver coordinates) ---
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('pgjdbc'),
    test: (n) => n === 'org.postgresql:postgresql',
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('mysql-connector-j'),
    test: (n) =>
      n === 'com.mysql:mysql-connector-j' || n === 'mysql:mysql-connector-java',
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('mssql-jdbc'),
    test: (n) => n === 'com.microsoft.sqlserver:mssql-jdbc',
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('oracle ojdbc11'),
    test: (n) => startsWithAny(n, ['com.oracle.database.jdbc:ojdbc']),
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('jtds'),
    test: (n) => n === 'net.sourceforge.jtds:jtds',
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('mongo-java-driver'),
    test: (n) =>
      startsWithAny(n, [
        'org.mongodb:mongodb-driver',
        'org.mongodb:mongo-java-driver',
      ]),
  },
  {
    decisionCode: 'db.driver',
    answer: fwAnswer('dynamodb-enhanced'),
    test: (n) => n === 'software.amazon.awssdk:dynamodb-enhanced',
  },

  // --- db.migrations (runtime migration library; the build-PLUGIN variant is
  //     resolved by the plugin extractor in manifestFactExtractors.ts) ---
  {
    decisionCode: 'db.migrations',
    answer: fwAnswer('Flyway'),
    test: (n) => startsWithAny(n, ['org.flywaydb:flyway']),
  },
  {
    decisionCode: 'db.migrations',
    answer: fwAnswer('Liquibase'),
    test: (n) => startsWithAny(n, ['org.liquibase:liquibase']),
  },
  {
    decisionCode: 'db.migrations',
    answer: fwAnswer('Mongock'),
    test: (n) =>
      startsWithAny(n, ['io.mongock:', 'com.github.cloudyrock.mongock:']),
  },

  // --- db.connectionPool ---
  {
    decisionCode: 'db.connectionPool',
    answer: fwAnswer('HikariCP'),
    test: (n) => n === 'com.zaxxer:HikariCP',
  },
  {
    decisionCode: 'db.connectionPool',
    answer: fwAnswer('Agroal'),
    test: (n) => startsWithAny(n, ['io.agroal:']),
  },

  // --- validation.framework ---
  {
    decisionCode: 'validation.framework',
    answer: fwAnswer('Hibernate Validator'),
    test: (n) => n === 'org.hibernate.validator:hibernate-validator',
  },
  {
    decisionCode: 'validation.framework',
    answer: fwAnswer('Bean Validation'),
    test: (n) => n === 'jakarta.validation:jakarta.validation-api',
  },

  // --- domain.mappingStrategy ---
  {
    decisionCode: 'domain.mappingStrategy',
    answer: fwAnswer('MapStruct'),
    test: (n) =>
      n === 'org.mapstruct:mapstruct' || n === 'org.mapstruct:mapstruct-processor',
  },
  {
    decisionCode: 'domain.mappingStrategy',
    answer: fwAnswer('ModelMapper'),
    test: (n) => n === 'org.modelmapper:modelmapper',
  },

  // --- logging.framework ---
  {
    decisionCode: 'logging.framework',
    answer: fwAnswer('SLF4J + Logback JSON'),
    test: (n) => startsWithAny(n, ['ch.qos.logback:logback']),
  },
  {
    decisionCode: 'logging.framework',
    answer: fwAnswer('Log4j'),
    test: (n) => startsWithAny(n, ['org.apache.logging.log4j:log4j']),
  },

  // --- metrics.framework ---
  {
    decisionCode: 'metrics.framework',
    answer: fwAnswer('Micrometer'),
    test: (n) => startsWithAny(n, ['io.micrometer:micrometer']),
  },

  // --- tracing.framework ---
  {
    decisionCode: 'tracing.framework',
    answer: fwAnswer('OpenTelemetry SDK'),
    test: (n) => startsWithAny(n, ['io.opentelemetry:opentelemetry-sdk']),
  },
  {
    decisionCode: 'tracing.framework',
    answer: fwAnswer('Spring Cloud Sleuth'),
    test: (n) =>
      startsWithAny(n, [
        'org.springframework.cloud:spring-cloud-starter-sleuth',
        'org.springframework.cloud:spring-cloud-sleuth',
      ]),
  },
  {
    decisionCode: 'tracing.framework',
    answer: fwAnswer('Zipkin Brave'),
    test: (n) => startsWithAny(n, ['io.zipkin.brave:brave']),
  },

  // --- interservice.asyncBus ---
  {
    decisionCode: 'interservice.asyncBus',
    answer: fwAnswer('Kafka'),
    test: (n) =>
      n === 'org.apache.kafka:kafka-clients' ||
      n === 'org.springframework.kafka:spring-kafka',
  },
  {
    decisionCode: 'interservice.asyncBus',
    answer: fwAnswer('RabbitMQ'),
    test: (n) =>
      n === 'com.rabbitmq:amqp-client' ||
      n === 'org.springframework.amqp:spring-rabbit',
  },

  // --- interservice.discoveryMechanism (NON-versioned => single-choice value) ---
  {
    decisionCode: 'interservice.discoveryMechanism',
    answer: scAnswer('Eureka'),
    test: (n) =>
      startsWithAny(n, [
        'org.springframework.cloud:spring-cloud-starter-netflix-eureka',
      ]),
  },
  {
    decisionCode: 'interservice.discoveryMechanism',
    answer: scAnswer('Consul'),
    test: (n) =>
      startsWithAny(n, ['org.springframework.cloud:spring-cloud-starter-consul']),
  },

  // --- testing.unit ---
  {
    decisionCode: 'testing.unit',
    answer: fwAnswer('JUnit'),
    test: (n) => startsWithAny(n, ['org.junit.jupiter:junit-jupiter']),
  },

  // --- testing.e2e (Playwright is shared with ui.testing => ambiguous => LLM) ---
  {
    decisionCode: 'testing.e2e',
    answer: fwAnswer('REST Assured'),
    test: (n) => startsWithAny(n, ['io.rest-assured:']),
  },
  {
    decisionCode: 'testing.e2e',
    answer: fwAnswer('Karate'),
    test: (n) => startsWithAny(n, ['com.intuit.karate:karate']),
  },

  // --- testing.contractTesting ---
  {
    decisionCode: 'testing.contractTesting',
    answer: fwAnswer('Pact'),
    test: (n) => startsWithAny(n, ['au.com.dius.pact', 'au.com.dius:pact']),
  },
  {
    decisionCode: 'testing.contractTesting',
    answer: fwAnswer('Spring Cloud Contract'),
    test: (n) =>
      startsWithAny(n, [
        'org.springframework.cloud:spring-cloud-starter-contract',
        'org.springframework.cloud:spring-cloud-contract',
      ]),
  },

  // --- testing.mocking ---
  {
    decisionCode: 'testing.mocking',
    answer: fwAnswer('Mockito'),
    test: (n) => startsWithAny(n, ['org.mockito:mockito']),
  },
  {
    decisionCode: 'testing.mocking',
    answer: fwAnswer('MockK'),
    test: (n) => n === 'io.mockk:mockk',
  },
];

// ---------------------------------------------------------------------------
// npm coordinate rules (name = full package name incl. `@scope/`)
// ---------------------------------------------------------------------------

const NPM_RULES: readonly CoordinateRule[] = [
  // --- service.framework (Node application framework) ---
  {
    decisionCode: 'service.framework',
    answer: fwAnswer('NestJS'),
    test: (n) => n === '@nestjs/core' || n.startsWith('@nestjs/'),
  },

  // --- ui.framework (frontend framework). `@angular/cli` is excluded so it
  //     falls through to the ui.buildTool rule below. ---
  {
    decisionCode: 'ui.framework',
    answer: fwAnswer('React'),
    test: (n) => equalsAny(n, ['react', 'react-dom']),
  },
  {
    decisionCode: 'ui.framework',
    answer: fwAnswer('Vue'),
    test: (n) => n === 'vue',
  },
  {
    decisionCode: 'ui.framework',
    answer: fwAnswer('Angular'),
    test: (n) => n.startsWith('@angular/') && n !== '@angular/cli',
  },
  {
    decisionCode: 'ui.framework',
    answer: fwAnswer('Svelte'),
    test: (n) => n === 'svelte',
  },

  // --- ui.buildTool ---
  {
    decisionCode: 'ui.buildTool',
    answer: fwAnswer('Vite'),
    test: (n) => n === 'vite',
  },
  {
    decisionCode: 'ui.buildTool',
    answer: fwAnswer('Webpack'),
    test: (n) => n === 'webpack',
  },
  {
    decisionCode: 'ui.buildTool',
    answer: fwAnswer('esbuild'),
    test: (n) => n === 'esbuild',
  },
  {
    decisionCode: 'ui.buildTool',
    answer: fwAnswer('Angular CLI'),
    test: (n) => n === '@angular/cli',
  },

  // --- ui.stateManagement ---
  {
    decisionCode: 'ui.stateManagement',
    answer: fwAnswer('Redux Toolkit'),
    test: (n) => n === '@reduxjs/toolkit',
  },
  {
    decisionCode: 'ui.stateManagement',
    answer: fwAnswer('Zustand'),
    test: (n) => n === 'zustand',
  },
  {
    decisionCode: 'ui.stateManagement',
    answer: fwAnswer('Pinia'),
    test: (n) => n === 'pinia',
  },
  {
    decisionCode: 'ui.stateManagement',
    answer: fwAnswer('NgRx'),
    test: (n) => n === '@ngrx/store' || n.startsWith('@ngrx/'),
  },
  {
    decisionCode: 'ui.stateManagement',
    answer: fwAnswer('MobX'),
    test: (n) => n === 'mobx',
  },

  // --- ui.designSystem ---
  {
    decisionCode: 'ui.designSystem',
    answer: fwAnswer('MUI'),
    test: (n) => n === '@mui/material',
  },
  {
    decisionCode: 'ui.designSystem',
    answer: fwAnswer('Ant Design'),
    test: (n) => n === 'antd',
  },
  {
    decisionCode: 'ui.designSystem',
    answer: fwAnswer('Chakra v3'),
    test: (n) => n === '@chakra-ui/react',
  },
  {
    decisionCode: 'ui.designSystem',
    answer: fwAnswer('Tailwind + headless components'),
    test: (n) => n === 'tailwindcss',
  },

  // --- ui.testing (Karma uniquely identifies the Karma + Jasmine choice) ---
  {
    decisionCode: 'ui.testing',
    answer: fwAnswer('Karma + Jasmine'),
    test: (n) => n === 'karma',
  },

  // --- logging.framework ---
  {
    decisionCode: 'logging.framework',
    answer: fwAnswer('pino'),
    test: (n) => n === 'pino',
  },

  // --- metrics.framework ---
  {
    decisionCode: 'metrics.framework',
    answer: fwAnswer('prom-client'),
    test: (n) => n === 'prom-client',
  },

  // --- interservice.asyncBus ---
  {
    decisionCode: 'interservice.asyncBus',
    answer: fwAnswer('Kafka'),
    test: (n) => n === 'kafkajs',
  },

  // --- testing.e2e ---
  {
    decisionCode: 'testing.e2e',
    answer: fwAnswer('Cypress'),
    test: (n) => n === 'cypress',
  },

  // --- testing.contractTesting ---
  {
    decisionCode: 'testing.contractTesting',
    answer: fwAnswer('Pact'),
    test: (n) => n === '@pact-foundation/pact',
  },
];

/**
 * The set of decision codes this module can auto-answer DIRECTLY from a
 * coordinate (excludes `build.tool`, which is derived from the ecosystem). Used
 * by the selection boundary so a non-dependency code is never attempted.
 */
export const COORDINATE_ANSWERABLE_CODES: ReadonlySet<string> = new Set(
  [...MAVEN_RULES, ...NPM_RULES].map((r) => r.decisionCode),
);

/**
 * Every (decisionCode, answer) pair the coordinate registry CAN emit -- a flat
 * projection of MAVEN_RULES + NPM_RULES. Exported as the drift-proof enumeration
 * source for the R10 guard-rail contract test (manifestCodeMapping.guardrail.
 * test.ts): every single-choice value it lists must be a verbatim
 * questionLibrary.choices member, and every bare-stem framework it lists must be
 * a real bare stem of that code's choices. Reading the REAL rules (not a fixture
 * copy) is what makes registry/choice drift go RED in CI. Declaration order kept.
 */
export const ALL_COORDINATE_RULE_ANSWERS: readonly ManifestCodeMatch[] = [
  ...MAVEN_RULES,
  ...NPM_RULES,
].map((rule) => ({ decisionCode: rule.decisionCode, ...rule.answer }));

/** The build-tool code is answered from the ecosystem, not a coordinate. */
export const BUILD_TOOL_CODE = 'build.tool';

/**
 * The full dependency-answerable code subset this module owns (coordinate
 * matches + the ecosystem-derived build tool). Anything outside this set is a
 * non-dependency code and is NEVER auto-answered (the spec selection boundary).
 * NOTE: `service.language` + `db.migrations` are ALSO answerable via the
 * property/plugin extractors (`manifestFactExtractors.ts`); they are not part of
 * THIS coordinate set but are within the broader manifest-answerable surface.
 */
export const DEPENDENCY_ANSWERABLE_CODES: ReadonlySet<string> = new Set([
  ...COORDINATE_ANSWERABLE_CODES,
  BUILD_TOOL_CODE,
]);

/**
 * Map a single resolved coordinate to its dependency-answerable decision code +
 * union answer (bare-stem framework-version, or single-choice value), or `null`
 * when the coordinate witnesses no dependency-answerable code (the common case —
 * most coordinates are ordinary libraries that do not pin one of the curated
 * decision codes).
 *
 * Pure; deterministic; first-matching-rule-wins.
 */
export function matchManifestCoordinate(
  dep: ResolvedDependency,
): ManifestCodeMatch | null {
  const rules = dep.ecosystem === 'MAVEN' ? MAVEN_RULES : NPM_RULES;
  for (const rule of rules) {
    if (rule.test(dep.name)) {
      return { decisionCode: rule.decisionCode, ...rule.answer };
    }
  }
  return null;
}

/**
 * The canonical `build.tool` answer for a manifest ecosystem. A manifest's mere
 * existence witnesses its build tool deterministically. `build.tool` is one of
 * Spec 1's `versioned: true` codes, so the answer is a BARE-STEM
 * `{ framework, version }` (NOT the old doubled `Maven 3.9` label):
 *   - a `pom.xml`      => `{ framework: 'Maven', version: '3.9' }` (chip `Maven 3.9`).
 *   - a `package.json` => `{ framework: 'npm + tsc', version: '10.9.0' }`.
 *
 * The versions are the curated defaults aligned with Spec 1's
 * `RECOMMENDED_VERSION_BY_FRAMEWORK` stems (a pom/package.json does not itself
 * declare the build-tool version). Returns `null` for an unrecognised ecosystem
 * (defensive — never happens for the two supported ecosystems).
 */
export function buildToolAnswerForEcosystem(
  ecosystem: ManifestEcosystem,
): { framework: string; version: string } | null {
  if (ecosystem === 'MAVEN') return { framework: 'Maven', version: '3.9' };
  if (ecosystem === 'NPM') return { framework: 'npm + tsc', version: '10.9.0' };
  return null;
}
