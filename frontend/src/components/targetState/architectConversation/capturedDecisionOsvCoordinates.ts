/**
 * Inverse `(decisionCode, framework) -> { coordinate, ecosystem }` map for the
 * conversational vulnerability-reduction sourcing path — FRONTEND MIRROR.
 *
 * Spec: 2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging (Spec C) —
 * Task Group 5.
 *
 * WHAT THIS IS
 * ------------
 * A faithful FRONTEND MIRROR of the gateway module
 * `gateway/src/services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts`
 * (authored by Task Group 3). The frontend cannot import gateway code, so this is
 * a hand-copied subset covering the same unambiguous `(decisionCode, framework)`
 * pairs, used so the Architect Conversation can resolve a conversationally-captured
 * versioned answer (`{ framework, version }`) to its single canonical OSV
 * `{ coordinate, ecosystem }` BEFORE merging it into the reduction's target set.
 *
 * KEEP IN SYNC: the framework labels here MUST stay byte-identical to the gateway
 * map / `manifestCodeMapping.ts` (`Spring Boot`, `Quarkus`, `Micronaut`, `NestJS`,
 * `pgjdbc`, `mysql-connector-j`, `React`, `Vue`, `Angular`, `Svelte`, ...). The
 * gateway side is the authority + carries the drift guardrail test against the
 * real `ALL_COORDINATE_RULE_ANSWERS`; this mirror exists only so the client can
 * pre-resolve a coordinate without a round-trip. A captured pair that is not in
 * this allow-list is SILENTLY SKIPPED by the caller (count-only console.debug;
 * NEVER guessed, NEVER sent to OSV).
 *
 * PURE DATA + a pure resolver. No I/O, no network.
 */

/** OSV-style ecosystem (mirrors the gateway `OsvEcosystem`). */
export type OsvEcosystem = 'Maven' | 'npm';

/** A single resolved OSV coordinate + its ecosystem (OSV style: `Maven` | `npm`). */
export interface CapturedDecisionCoordinate {
  /** `groupId:artifactId` (Maven) / full package name incl. `@scope/` (npm). */
  coordinate: string;
  /** OSV ecosystem (`Maven` | `npm`). */
  ecosystem: OsvEcosystem;
}

/**
 * The explicit inverse allow-list, keyed `decisionCode -> framework label ->
 * { coordinate, ecosystem }`. Byte-identical to the gateway map; only unambiguous,
 * single-ecosystem, single-canonical-coordinate pairs appear.
 */
const CAPTURED_DECISION_OSV_COORDINATES: Readonly<
  Record<string, Readonly<Record<string, CapturedDecisionCoordinate>>>
> = {
  // --- service.framework (application framework) ---------------------------
  'service.framework': {
    'Spring Boot': { coordinate: 'org.springframework.boot:spring-boot', ecosystem: 'Maven' },
    Quarkus: { coordinate: 'io.quarkus:quarkus-core', ecosystem: 'Maven' },
    Micronaut: { coordinate: 'io.micronaut:micronaut-core', ecosystem: 'Maven' },
    NestJS: { coordinate: '@nestjs/core', ecosystem: 'npm' },
  },

  // --- db.driver (JDBC / native driver coordinates) -----------------------
  'db.driver': {
    pgjdbc: { coordinate: 'org.postgresql:postgresql', ecosystem: 'Maven' },
    'mysql-connector-j': { coordinate: 'com.mysql:mysql-connector-j', ecosystem: 'Maven' },
    'mssql-jdbc': { coordinate: 'com.microsoft.sqlserver:mssql-jdbc', ecosystem: 'Maven' },
    'oracle ojdbc11': { coordinate: 'com.oracle.database.jdbc:ojdbc11', ecosystem: 'Maven' },
    jtds: { coordinate: 'net.sourceforge.jtds:jtds', ecosystem: 'Maven' },
    'mongo-java-driver': { coordinate: 'org.mongodb:mongodb-driver-sync', ecosystem: 'Maven' },
    'dynamodb-enhanced': { coordinate: 'software.amazon.awssdk:dynamodb-enhanced', ecosystem: 'Maven' },
  },

  // --- db.migrations (runtime migration library) --------------------------
  'db.migrations': {
    Flyway: { coordinate: 'org.flywaydb:flyway-core', ecosystem: 'Maven' },
    Liquibase: { coordinate: 'org.liquibase:liquibase-core', ecosystem: 'Maven' },
  },

  // --- db.connectionPool --------------------------------------------------
  'db.connectionPool': {
    HikariCP: { coordinate: 'com.zaxxer:HikariCP', ecosystem: 'Maven' },
  },

  // --- validation.framework -----------------------------------------------
  'validation.framework': {
    'Hibernate Validator': { coordinate: 'org.hibernate.validator:hibernate-validator', ecosystem: 'Maven' },
    'Bean Validation': { coordinate: 'jakarta.validation:jakarta.validation-api', ecosystem: 'Maven' },
  },

  // --- domain.mappingStrategy ---------------------------------------------
  'domain.mappingStrategy': {
    MapStruct: { coordinate: 'org.mapstruct:mapstruct', ecosystem: 'Maven' },
    ModelMapper: { coordinate: 'org.modelmapper:modelmapper', ecosystem: 'Maven' },
  },

  // --- logging.framework --------------------------------------------------
  'logging.framework': {
    'SLF4J + Logback JSON': { coordinate: 'ch.qos.logback:logback-classic', ecosystem: 'Maven' },
    Log4j: { coordinate: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' },
    pino: { coordinate: 'pino', ecosystem: 'npm' },
  },

  // --- metrics.framework --------------------------------------------------
  'metrics.framework': {
    Micrometer: { coordinate: 'io.micrometer:micrometer-core', ecosystem: 'Maven' },
    'prom-client': { coordinate: 'prom-client', ecosystem: 'npm' },
  },

  // --- tracing.framework --------------------------------------------------
  'tracing.framework': {
    'OpenTelemetry SDK': { coordinate: 'io.opentelemetry:opentelemetry-sdk', ecosystem: 'Maven' },
    'Spring Cloud Sleuth': { coordinate: 'org.springframework.cloud:spring-cloud-starter-sleuth', ecosystem: 'Maven' },
    'Zipkin Brave': { coordinate: 'io.zipkin.brave:brave', ecosystem: 'Maven' },
  },

  // --- ui.framework (frontend framework) ----------------------------------
  'ui.framework': {
    React: { coordinate: 'react', ecosystem: 'npm' },
    Vue: { coordinate: 'vue', ecosystem: 'npm' },
    Angular: { coordinate: '@angular/core', ecosystem: 'npm' },
    Svelte: { coordinate: 'svelte', ecosystem: 'npm' },
  },

  // --- ui.stateManagement -------------------------------------------------
  'ui.stateManagement': {
    'Redux Toolkit': { coordinate: '@reduxjs/toolkit', ecosystem: 'npm' },
    Zustand: { coordinate: 'zustand', ecosystem: 'npm' },
    Pinia: { coordinate: 'pinia', ecosystem: 'npm' },
    NgRx: { coordinate: '@ngrx/store', ecosystem: 'npm' },
    MobX: { coordinate: 'mobx', ecosystem: 'npm' },
  },

  // --- ui.designSystem ----------------------------------------------------
  'ui.designSystem': {
    MUI: { coordinate: '@mui/material', ecosystem: 'npm' },
    'Ant Design': { coordinate: 'antd', ecosystem: 'npm' },
    'Chakra v3': { coordinate: '@chakra-ui/react', ecosystem: 'npm' },
    'Tailwind + headless components': { coordinate: 'tailwindcss', ecosystem: 'npm' },
  },
};

/**
 * Resolve a captured `(decisionCode, framework)` pair to its single canonical OSV
 * `{ coordinate, ecosystem }`, or `null` when the pair is not in the allow-list
 * (unmapped => the caller SILENTLY SKIPS it — count-only log, never guessed).
 *
 * Pure; deterministic; case-sensitive on both the code and the framework label
 * (the labels are the conversation's canonical chip stems).
 */
export function coordinateForCapturedVersion(
  decisionCode: string,
  framework: string,
): CapturedDecisionCoordinate | null {
  const byFramework = CAPTURED_DECISION_OSV_COORDINATES[decisionCode];
  if (!byFramework) return null;
  return byFramework[framework] ?? null;
}
