/**
 * Question Library Config — Target State Architect-Persona Conversation (Spec 3, Commit 1)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * The strongly-typed library of all 51 architect-conversation questions across groups A-J.
 * Each entry inlines the standards-driven cascade seed map per Q9 (hardcoded; no runtime
 * standards-registry call in v1 — future Spec 5 will swap this for a runtime lookup).
 *
 * Loader-time validation lives in `loadConfigs.ts`. Tests live in
 * `__tests__/questionLibrary.test.ts`.
 *
 * IMPORTANT: This is config only. No orchestration, no LLM, no I/O.
 */

import scopeRefTypeJson from './scopeRefType.json';

// ---------------------------------------------------------------------------
// Closed scope_ref_type set (per Q12)
//
// Spec 2026-05-26-low-priority-mechanical-cleanups (#14): the canonical
// member list now lives in `scopeRefType.json`. Both the
// `ALLOWED_SCOPE_REF_TYPES` runtime array and the `ScopeRefType`
// compile-time union are derived from that JSON file so we never declare
// the membership in TypeScript twice. Drift between this gateway-side
// derivation, the JSON file, and the frontend-side mirror in
// `architectConversationApi.ts` is enforced at test-time by
// `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`.
// ---------------------------------------------------------------------------

/**
 * Tuple type capturing the literal-string members declared in
 * `scopeRefType.json`. Listed here so the TS compiler can narrow the
 * JSON-imported `string[]` down to a literal-union-derivable tuple. If
 * this list and the JSON drift, the cross-package contract test catches
 * it (see `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`).
 */
type ScopeRefTypeTuple = readonly [
  'service',
  'interface',
  'endpoint',
  'physical_data_entity',
  'physical_data_attribute',
  'method',
  'class',
];

/**
 * The only `scope_ref_type` values accepted on a captured-decision row's
 * `scope_ref_type` field, on `allowedExceptionScopes` in the question library,
 * and on the exception sub-dialog entity picker. Sourced from
 * `scopeRefType.json` -- see that file's `_doc` for drift-detection guidance.
 *
 * Library-loader validation and the exception sub-dialog both reject anything
 * outside this set.
 */
export const ALLOWED_SCOPE_REF_TYPES =
  scopeRefTypeJson.values as unknown as ScopeRefTypeTuple;

export type ScopeRefType = ScopeRefTypeTuple[number];

// ---------------------------------------------------------------------------
// Expected answer shapes
// ---------------------------------------------------------------------------

export type ExpectedAnswerShape =
  | 'free-text'
  | 'single-choice'
  | 'multi-choice'
  | 'structured';

// ---------------------------------------------------------------------------
// Question group identifiers (per spec §"Question library config")
// A=Service runtime, B=API surface, C=Data persistence, D=Domain/DTO,
// E=Frontend (relevance-gated), F=Cross-cutting, G=Infrastructure,
// H=Inter-service comms, I=Testing, J=Cut-over.
// ---------------------------------------------------------------------------

export type QuestionGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

// ---------------------------------------------------------------------------
// Cascade entry shape (per Q9 — inline standards seed map)
// ---------------------------------------------------------------------------

export interface CascadeEntry {
  /** Downstream decision code this answer pre-fills. Must resolve to a real library entry. */
  decisionCode: string;
  /**
   * Map from this question's answer value (the trigger) to the proposed
   * downstream value. Hardcoded per Q9.
   */
  valueByTriggerValue: Record<string, unknown>;
  /**
   * Literal `sourceStandardId` recorded on the cascaded captured-decision row
   * via `standardsLookupRef` for audit continuity. Spec 5 will eventually look
   * these up dynamically; the contract here is stable.
   */
  sourceStandardId: string;
}

// ---------------------------------------------------------------------------
// Relevance predicate (per Q7)
// ---------------------------------------------------------------------------

/**
 * Minimal evaluation context the relevance predicate sees.
 *
 * Spec 2026-06-05-architect-tier-gating (Half B) replaced the single
 * `hasUiScreens` boolean with three TECHNOLOGY-tier flags so the conversation
 * can skip whole question groups that do not apply to a given migration:
 *
 *   - `hasUiTier`          — the target has at least one UI-tier component
 *                            (folds in the former `hasUiScreens`; Group E gate).
 *   - `hasServiceTier`     — the target has at least one Service-tier component
 *                            (gates Groups A, B, D, H).
 *   - `hasPersistenceTier` — the target has at least one Persistence-tier
 *                            component (gates Group C).
 *
 * All three default to `true` at the call sites (fail-open): a group is
 * skipped ONLY when its tier is confirmed ABSENT, never when the tier is
 * unknown.
 *
 * NOTE: this "tier" is the architectural TECHNOLOGY tier (UI / Service /
 * Persistence) derived from `app_component.tech_type`. It is UNRELATED to
 * `DiscoveryRunDto.tier`, which is the V3 discovery CONFIDENCE ladder (A/B/C).
 *
 * The context object is intentionally narrow — additional fields can be added
 * in future specs without breaking existing predicates.
 */
export interface RelevanceContext {
  /**
   * True when the target architecture has at least one UI-tier component
   * (frontend / screens). Gates Group E. Folds in the former `hasUiScreens`.
   */
  hasUiTier: boolean;
  /**
   * True when the target architecture has at least one Service-tier component.
   * Gates Groups A (Service runtime), B (API surface), D (Domain/DTO), and
   * H (Inter-service comms).
   */
  hasServiceTier: boolean;
  /**
   * True when the target architecture has at least one Persistence-tier
   * component. Gates Group C (Data persistence).
   */
  hasPersistenceTier: boolean;
}

export type RelevanceCondition = (ctx: RelevanceContext) => boolean;

// ---------------------------------------------------------------------------
// Library entry shape
// ---------------------------------------------------------------------------

export interface QuestionLibraryEntry {
  /** Stable decision code (e.g. `service.language`). Unique across the library. */
  code: string;
  /** Group bucket A-J. */
  group: QuestionGroup;
  /**
   * Ordinal within the group so the gateway can enforce A.1 → A.2 → A.3 per Q5.
   * Inter-group order is free.
   */
  orderInGroup: number;
  /**
   * Fixed prompt — never paraphrased by the LLM per Q17. If a `discoveryContextLead`
   * is supplied at runtime it is prepended, but the prompt string itself stays as-is.
   */
  prompt: string;
  /**
   * Curated framing paragraph rendered above the prompt in the UI to help the
   * architect orient before answering. Hand-authored per question; never
   * LLM-paraphrased. Distinct from `discoveryContextLead` which is reserved
   * for runtime-derived discovery context (currently unused; v2 candidate).
   */
  staticContextLeadIn?: string;
  /**
   * Optional pre-built lead-in slot. Populated deterministically at conversation
   * load time from discovery context (NOT inlined here — left as runtime contract).
   */
  discoveryContextLead?: string;
  /** Shape the LLM must parse the user's free-text into. */
  expectedAnswerShape: ExpectedAnswerShape;
  /** Allowed values when `expectedAnswerShape` is `single-choice` or `multi-choice`. */
  choices?: readonly string[];
  /** The "no change from current" value. Captured as a real row per F4. */
  defaultsWhenUnchanged: string;
  /** Inline standards seed-map cascades per Q9. */
  cascades: readonly CascadeEntry[];
  /** Optional gateway-side predicate for auto-skip per Q7. */
  relevanceCondition?: RelevanceCondition;
  /** Closed-set scope_ref_type values that may pin an exception for this code. */
  allowedExceptionScopes: readonly ScopeRefType[];
}

export type QuestionLibrary = readonly QuestionLibraryEntry[];

// ---------------------------------------------------------------------------
// Relevance predicates
// ---------------------------------------------------------------------------

/**
 * Per-tier auto-skip predicates (Spec 2026-06-05-architect-tier-gating).
 * A group whose tier flag is `false` is skipped; groups F/G/I/J carry no
 * predicate and are always relevant.
 *
 *   - Group E (Frontend)         -> `onlyWhenUiTier`
 *   - Groups A/B/D/H (Service)   -> `onlyWhenServiceTier`
 *   - Group C (Persistence)      -> `onlyWhenPersistenceTier`
 *
 * `onlyWhenUiTier` folds in the former `onlyWhenUiPresent`/`hasUiScreens`
 * gate verbatim, so Group E behaviour is identical when UI is present.
 */
const onlyWhenUiTier: RelevanceCondition = (ctx) => ctx.hasUiTier === true;
const onlyWhenServiceTier: RelevanceCondition = (ctx) =>
  ctx.hasServiceTier === true;
const onlyWhenPersistenceTier: RelevanceCondition = (ctx) =>
  ctx.hasPersistenceTier === true;

// ---------------------------------------------------------------------------
// The 51-entry library
//
// Mirrors spec.md Appendix A verbatim. Cascade seed maps are inlined per Q9.
// Source standard IDs (`std.runtime.v1`, etc.) are the literal audit pointers
// captured on cascaded decision rows; Spec 5 will eventually resolve them.
// ---------------------------------------------------------------------------

export const QUESTION_LIBRARY: QuestionLibrary = [
  // ===== Group A — Service runtime (6) =====

  {
    code: 'service.language',
    group: 'A',
    orderInGroup: 1,
    prompt: 'What language and major version should target services run on?',
    staticContextLeadIn:
      'The language and version each service runs on. Common modern picks: Java 21, Kotlin 2, Node 20, Python 3.12, Go 1.22, C# 12.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Java 21',
      'Java 17',
      'Kotlin 2.0',
      'C# 12',
      'TypeScript/Node 20',
      'Python 3.12',
      'Go 1.22',
    ],
    defaultsWhenUnchanged: 'current language + version',
    cascades: [
      {
        decisionCode: 'service.runtime',
        valueByTriggerValue: {
          'Java 21': 'Eclipse Temurin 21',
          'Java 17': 'Eclipse Temurin 21',
          'Kotlin 2.0': 'Eclipse Temurin 21',
          'TypeScript/Node 20': 'Node 20 LTS',
          'Python 3.12': 'CPython 3.12-slim',
          'Go 1.22': 'Go 1.22 alpine',
          'C# 12': '.NET 8',
        },
        sourceStandardId: 'std.runtime.v1',
      },
      {
        decisionCode: 'testing.unit',
        valueByTriggerValue: {
          'Java 21': 'JUnit 5',
          'Java 17': 'JUnit 5',
          'Kotlin 2.0': 'JUnit 5',
          'TypeScript/Node 20': 'Vitest',
          'Python 3.12': 'pytest',
          'Go 1.22': 'go test',
          'C# 12': 'NUnit 4',
        },
        sourceStandardId: 'std.testing.unit.v1',
      },
      {
        decisionCode: 'dto.style',
        valueByTriggerValue: {
          'Java 21': 'Java records',
          'Java 17': 'Java records',
          'Kotlin 2.0': 'Kotlin data classes',
          'TypeScript/Node 20': 'TypeScript interfaces',
        },
        sourceStandardId: 'std.dto.v1',
      },
      {
        decisionCode: 'build.tool',
        valueByTriggerValue: {
          'Java 21': 'Gradle 8',
          'Java 17': 'Gradle 8',
          'Kotlin 2.0': 'Gradle 8',
          'TypeScript/Node 20': 'npm + tsc',
          'Python 3.12': 'uv',
          'Go 1.22': 'go build',
          'C# 12': 'dotnet 8',
        },
        sourceStandardId: 'std.build.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'method', 'class'],
  },

  {
    code: 'service.framework',
    group: 'A',
    orderInGroup: 2,
    prompt: 'What application framework should target services use?',
    staticContextLeadIn:
      'The application framework hosting service code. Common modern picks: Spring Boot, Quarkus, Micronaut, NestJS, FastAPI, ASP.NET.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Spring Boot 3.4',
      'Quarkus 3',
      'Micronaut 4',
      'NestJS 10',
      'FastAPI 0.115',
      'Gin 1.10',
      'ASP.NET 8',
    ],
    defaultsWhenUnchanged: 'current framework + version',
    cascades: [
      {
        decisionCode: 'validation.framework',
        valueByTriggerValue: {
          'Spring Boot 3.4': 'Bean Validation 3',
          'Quarkus 3': 'Hibernate Validator',
          'NestJS 10': 'class-validator',
          'FastAPI 0.115': 'Pydantic v2',
        },
        sourceStandardId: 'std.validation.v1',
      },
      {
        decisionCode: 'logging.framework',
        valueByTriggerValue: {
          'Spring Boot 3.4': 'SLF4J + Logback JSON',
          'Quarkus 3': 'SLF4J + Logback JSON',
          'NestJS 10': 'pino',
          'FastAPI 0.115': 'structlog',
        },
        sourceStandardId: 'std.logging.v1',
      },
      {
        decisionCode: 'metrics.framework',
        valueByTriggerValue: {
          'Spring Boot 3.4': 'Micrometer',
          'Quarkus 3': 'Micrometer',
          'NestJS 10': 'prom-client',
          'FastAPI 0.115': 'OpenTelemetry metrics',
        },
        sourceStandardId: 'std.metrics.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'service.runtime',
    group: 'A',
    orderInGroup: 3,
    prompt: 'What runtime/JVM/container base should host the target services?',
    staticContextLeadIn:
      'The runtime or JVM/container base each service is packaged onto. Common modern picks: Temurin JRE, GraalVM, Node slim, Python slim, distroless.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Eclipse Temurin 21',
      'GraalVM 21',
      'Node 20 LTS',
      'CPython 3.12-slim',
      'Go 1.22 alpine',
      '.NET 8',
    ],
    defaultsWhenUnchanged: 'current runtime',
    cascades: [
      {
        decisionCode: 'container.baseImage',
        valueByTriggerValue: {
          'Eclipse Temurin 21': 'eclipse-temurin:21-jre',
          'GraalVM 21': 'eclipse-temurin:21-jre',
          'Node 20 LTS': 'node:20-slim',
          'CPython 3.12-slim': 'python:3.12-slim',
          'Go 1.22 alpine': 'distroless/static',
        },
        sourceStandardId: 'std.container.base.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'service.processModel',
    group: 'A',
    orderInGroup: 4,
    prompt: 'What process model should each target service use?',
    staticContextLeadIn:
      'Whether each service runs single-process, worker-pool, or event-loop. Modern services usually pick single-process or async event loop.',
    expectedAnswerShape: 'single-choice',
    choices: ['single-process', 'multi-process worker pool', 'async event loop'],
    defaultsWhenUnchanged: 'current process model',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'service.config',
    group: 'A',
    orderInGroup: 5,
    prompt: 'How should target services consume runtime configuration?',
    staticContextLeadIn:
      'How services consume runtime config. Common modern picks: env vars (12-factor), Spring Cloud Config, Consul KV, Kubernetes ConfigMaps.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'env vars + 12-factor',
      'Spring Cloud Config',
      'Consul KV',
      'ConfigMap-only',
    ],
    defaultsWhenUnchanged: 'current approach',
    cascades: [
      {
        decisionCode: 'secrets.management',
        valueByTriggerValue: {
          'env vars + 12-factor': 'Vault injector',
          'Spring Cloud Config': 'encrypted-properties',
        },
        sourceStandardId: 'std.secrets.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'service.healthcheck',
    group: 'A',
    orderInGroup: 6,
    prompt:
      'What liveness/readiness/startup check contract should services expose?',
    staticContextLeadIn:
      'The liveness/readiness/startup check contract services expose. Common modern picks: Spring Actuator, Kubernetes `/healthz` + `/readyz`, custom JSON.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Spring Actuator',
      'Kubernetes-style /healthz + /readyz',
      'custom JSON contract',
    ],
    defaultsWhenUnchanged: 'current healthcheck shape',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  // ===== Group B — API surface (6) =====

  {
    code: 'api.protocol',
    group: 'B',
    orderInGroup: 1,
    prompt: 'What protocol(s) should the target expose externally?',
    staticContextLeadIn:
      'The protocols services expose externally. Common modern picks: REST/JSON, gRPC, GraphQL, SOAP passthrough, AsyncAPI/Kafka.',
    expectedAnswerShape: 'multi-choice',
    choices: [
      'REST/JSON',
      'gRPC',
      'GraphQL',
      'SOAP-passthrough',
      'AsyncAPI/Kafka',
    ],
    defaultsWhenUnchanged: 'current protocol set',
    cascades: [
      {
        decisionCode: 'api.versioning',
        valueByTriggerValue: {
          'REST/JSON': 'URL path',
          gRPC: 'header-based',
          GraphQL: 'semantic field deprecation',
        },
        sourceStandardId: 'std.api.versioning.v1',
      },
      {
        decisionCode: 'api.contractFormat',
        valueByTriggerValue: {
          'REST/JSON': 'OpenAPI 3.1',
          gRPC: 'proto3',
          GraphQL: 'GraphQL SDL',
          'SOAP-passthrough': 'WSDL 1.1',
        },
        sourceStandardId: 'std.api.contract.v1',
      },
      {
        decisionCode: 'api.auth',
        valueByTriggerValue: {
          'REST/JSON': 'OAuth2 + JWT',
          gRPC: 'mTLS',
        },
        sourceStandardId: 'std.api.auth.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['interface', 'endpoint'],
  },

  {
    code: 'api.versioning',
    group: 'B',
    orderInGroup: 2,
    prompt: 'What versioning strategy for the target API surface?',
    staticContextLeadIn:
      'How API versions are signalled to consumers. Common modern picks: URL path, header-based, content negotiation, semantic field deprecation.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'URL path',
      'header-based',
      'content-negotiation',
      'semantic field deprecation',
    ],
    defaultsWhenUnchanged: 'current scheme',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['interface', 'endpoint'],
  },

  {
    code: 'api.contractFormat',
    group: 'B',
    orderInGroup: 3,
    prompt: 'What contract spec format owns the source of truth?',
    staticContextLeadIn:
      'The source-of-truth format for API contracts. Common modern picks: OpenAPI 3.1, proto3, GraphQL SDL, AsyncAPI 3, WSDL 1.1.',
    expectedAnswerShape: 'single-choice',
    choices: ['OpenAPI 3.1', 'proto3', 'GraphQL SDL', 'AsyncAPI 3', 'WSDL 1.1'],
    defaultsWhenUnchanged: 'current format',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['interface'],
  },

  {
    code: 'api.auth',
    group: 'B',
    orderInGroup: 4,
    prompt:
      'What authentication/authorization stack should the target API surface use?',
    staticContextLeadIn:
      'How callers authenticate to the API. Common modern picks: OAuth2 + JWT, mTLS, API keys, session cookies + CSRF.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'OAuth2 + JWT',
      'mTLS',
      'API keys',
      'session cookies + CSRF',
    ],
    defaultsWhenUnchanged: 'current scheme',
    cascades: [
      {
        decisionCode: 'secrets.management',
        valueByTriggerValue: {
          'OAuth2 + JWT': 'Vault injector',
          mTLS: 'Vault injector',
        },
        sourceStandardId: 'std.secrets.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['interface', 'endpoint'],
  },

  {
    code: 'api.errorContract',
    group: 'B',
    orderInGroup: 5,
    prompt: 'What error response contract should endpoints emit?',
    staticContextLeadIn:
      'The error envelope endpoints emit. Common modern picks: RFC 7807 Problem Details, custom JSON envelope, gRPC status, GraphQL errors[].',
    expectedAnswerShape: 'single-choice',
    choices: [
      'RFC 7807 Problem Details',
      'custom JSON envelope',
      'gRPC status',
      'GraphQL errors[]',
    ],
    defaultsWhenUnchanged: 'current contract',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['endpoint'],
  },

  {
    code: 'api.rateLimiting',
    group: 'B',
    orderInGroup: 6,
    prompt: 'What rate-limiting / throttling strategy on the target API edge?',
    staticContextLeadIn:
      'Where rate-limiting is enforced. Common modern picks: gateway-enforced, per-service in-process, or none.',
    expectedAnswerShape: 'single-choice',
    choices: ['gateway-enforced', 'per-service in-process', 'none'],
    defaultsWhenUnchanged: 'current approach',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['interface', 'endpoint'],
  },

  // ===== Group C — Data persistence (6) =====

  {
    code: 'db.engine',
    group: 'C',
    orderInGroup: 1,
    prompt: 'What primary database engine should the target use?',
    staticContextLeadIn:
      'The primary store for transactional workloads. Common modern picks: PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, DynamoDB.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Postgres 18',
      'MySQL 8.4',
      'MS SQL Server 2022',
      'Oracle 23ai',
      'Sybase ASE 16',
      'MongoDB 7',
      'DynamoDB',
    ],
    defaultsWhenUnchanged: 'current engine',
    cascades: [
      {
        decisionCode: 'db.migrations',
        valueByTriggerValue: {
          'Postgres 18': 'Flyway 10',
          'MySQL 8.4': 'Flyway 10',
          'MS SQL Server 2022': 'Flyway 10',
          'MongoDB 7': 'Mongock',
        },
        sourceStandardId: 'std.db.migrations.v1',
      },
      {
        decisionCode: 'db.connectionPool',
        valueByTriggerValue: {
          'Postgres 18': 'HikariCP',
          'MS SQL Server 2022': 'HikariCP',
          'MongoDB 7': 'native driver pool',
        },
        sourceStandardId: 'std.db.pool.v1',
      },
      {
        decisionCode: 'db.driver',
        valueByTriggerValue: {
          'Postgres 18': 'pgjdbc',
          'MySQL 8.4': 'mysql-connector-j',
          'MS SQL Server 2022': 'mssql-jdbc',
          'Oracle 23ai': 'oracle ojdbc11',
          'Sybase ASE 16': 'jtds',
          'MongoDB 7': 'mongo-java-driver',
          DynamoDB: 'dynamodb-enhanced',
        },
        sourceStandardId: 'std.db.driver.v1',
      },
    ],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['physical_data_entity', 'physical_data_attribute'],
  },

  {
    code: 'db.migrations',
    group: 'C',
    orderInGroup: 2,
    prompt: 'What schema-migration tool should manage target DDL?',
    staticContextLeadIn:
      'The tool managing DDL changes. Common modern picks: Flyway, Liquibase, Mongock, or app-managed.',
    expectedAnswerShape: 'single-choice',
    choices: ['Flyway 10', 'Liquibase 4', 'Mongock', 'none-managed-by-app'],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'db.connectionPool',
    group: 'C',
    orderInGroup: 3,
    prompt: 'What connection-pool implementation?',
    staticContextLeadIn:
      'The connection-pool library services use. Common modern picks: HikariCP, Agroal, native driver pool.',
    expectedAnswerShape: 'single-choice',
    choices: ['HikariCP', 'Agroal', 'native driver pool', 'none'],
    defaultsWhenUnchanged: 'current pool',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'db.transactionStrategy',
    group: 'C',
    orderInGroup: 4,
    prompt: 'What transactional boundary strategy for target services?',
    staticContextLeadIn:
      'Where transactional boundaries live. Common modern picks: per-request, saga-orchestrated, or no transactions (event-driven).',
    expectedAnswerShape: 'single-choice',
    choices: ['per-request', 'saga-orchestrated', 'no-transactions'],
    defaultsWhenUnchanged: 'current strategy',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['service', 'method'],
  },

  {
    code: 'db.readReplicaUsage',
    group: 'C',
    orderInGroup: 5,
    prompt: 'Should the target use read replicas for read-heavy paths?',
    staticContextLeadIn:
      'Whether read-heavy paths route to replicas. Common modern picks: routed via proxy, app-selected, or no replicas.',
    expectedAnswerShape: 'single-choice',
    choices: ['yes-routed', 'yes-app-selected', 'no'],
    defaultsWhenUnchanged: 'current usage',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['service', 'physical_data_entity'],
  },

  {
    code: 'db.driver',
    group: 'C',
    orderInGroup: 6,
    prompt: 'What database driver/adapter should target services use?',
    staticContextLeadIn:
      'The driver/adapter each service uses. Common modern picks: pgjdbc, mysql-connector-j, mssql-jdbc, oracle ojdbc, mongo-java-driver.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'pgjdbc',
      'mysql-connector-j',
      'mssql-jdbc',
      'oracle ojdbc11',
      'jtds',
      'mongo-java-driver',
      'dynamodb-enhanced',
    ],
    defaultsWhenUnchanged: 'current driver',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    allowedExceptionScopes: ['service'],
  },

  // ===== Group D — Domain / DTO style (4) =====

  {
    code: 'dto.style',
    group: 'D',
    orderInGroup: 1,
    prompt: 'What DTO style should the target adopt?',
    staticContextLeadIn:
      'The DTO style services adopt. Common modern picks: Java records, Kotlin data classes, TypeScript interfaces, Pydantic models, Go structs.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Java records',
      'Kotlin data classes',
      'Lombok @Value',
      'TypeScript interfaces',
      'Pydantic models',
      'Go structs with tags',
    ],
    defaultsWhenUnchanged: 'current style',
    cascades: [
      {
        decisionCode: 'validation.framework',
        valueByTriggerValue: {
          'Java records': 'Bean Validation 3',
          'Pydantic models': 'Pydantic v2',
          'TypeScript interfaces': 'class-validator',
        },
        sourceStandardId: 'std.validation.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'class'],
  },

  {
    code: 'validation.framework',
    group: 'D',
    orderInGroup: 2,
    prompt: 'What validation framework should target services use?',
    staticContextLeadIn:
      'The validation library on the input boundary. Common modern picks: Bean Validation, Hibernate Validator, class-validator, Pydantic v2.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Bean Validation 3',
      'Hibernate Validator',
      'class-validator',
      'Pydantic v2',
      'manual',
    ],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'method'],
  },

  {
    code: 'domain.mappingStrategy',
    group: 'D',
    orderInGroup: 3,
    prompt:
      'How should target services map between persistence entities and DTOs?',
    staticContextLeadIn:
      'How persistence entities map to DTOs. Common modern picks: MapStruct, manual mappers, ModelMapper, or direct entity exposure.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'MapStruct 1.6',
      'manual mapper classes',
      'ModelMapper',
      'none-direct-entity-exposure',
    ],
    defaultsWhenUnchanged: 'current strategy',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'class'],
  },

  {
    code: 'domain.errorModel',
    group: 'D',
    orderInGroup: 4,
    prompt:
      'How are domain errors propagated through the target service layer?',
    staticContextLeadIn:
      'How domain errors travel through service layers. Common modern picks: typed exceptions, Result/Either, error codes on the response envelope.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'typed exceptions',
      'Result/Either',
      'error codes on response envelope',
    ],
    defaultsWhenUnchanged: 'current model',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'method'],
  },

  // ===== Group E — Frontend (5 — relevance-gated per Q7) =====

  {
    code: 'ui.framework',
    group: 'E',
    orderInGroup: 1,
    prompt: 'What frontend framework should the target UI use?',
    staticContextLeadIn:
      'The framework powering the target UI. Common modern picks: React 18, Vue 3, Angular 17, Svelte 5, or server-rendered.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'React 18',
      'Vue 3',
      'Angular 17',
      'Svelte 5',
      'none-server-rendered',
    ],
    defaultsWhenUnchanged: 'current framework',
    cascades: [
      {
        decisionCode: 'ui.buildTool',
        valueByTriggerValue: {
          'React 18': 'Vite 5',
          'Vue 3': 'Vite 5',
          'Angular 17': 'Angular CLI',
        },
        sourceStandardId: 'std.ui.build.v1',
      },
      {
        decisionCode: 'ui.testing',
        valueByTriggerValue: {
          'React 18': 'Vitest + Testing Library',
          'Vue 3': 'Vitest + Testing Library',
          'Angular 17': 'Karma + Jasmine',
        },
        sourceStandardId: 'std.ui.testing.v1',
      },
      {
        decisionCode: 'ui.stateManagement',
        valueByTriggerValue: {
          'React 18': 'Redux Toolkit',
          'Vue 3': 'Pinia',
          'Angular 17': 'NgRx',
        },
        sourceStandardId: 'std.ui.state.v1',
      },
    ],
    relevanceCondition: onlyWhenUiTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'ui.buildTool',
    group: 'E',
    orderInGroup: 2,
    prompt: 'What build tool for the target UI?',
    staticContextLeadIn:
      'The bundler/build tool for the UI. Common modern picks: Vite 5, Webpack 5, esbuild, Angular CLI.',
    expectedAnswerShape: 'single-choice',
    choices: ['Vite 5', 'Webpack 5', 'esbuild', 'Angular CLI'],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'ui.testing',
    group: 'E',
    orderInGroup: 3,
    prompt: 'What testing stack for the target UI?',
    staticContextLeadIn:
      'The UI test framework. Common modern picks: Vitest + Testing Library, Jest + Testing Library, Karma + Jasmine, Playwright.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Vitest + Testing Library',
      'Jest + Testing Library',
      'Karma + Jasmine',
      'Playwright',
    ],
    defaultsWhenUnchanged: 'current stack',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'ui.stateManagement',
    group: 'E',
    orderInGroup: 4,
    prompt: 'What client-side state management for the target UI?',
    staticContextLeadIn:
      'The client state library. Common modern picks: Redux Toolkit, Zustand, Pinia, NgRx, MobX, or local-state-only.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Redux Toolkit',
      'Zustand',
      'Pinia',
      'NgRx',
      'MobX',
      'none-local-state-only',
    ],
    defaultsWhenUnchanged: 'current approach',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'ui.designSystem',
    group: 'E',
    orderInGroup: 5,
    prompt:
      'What design system / component library should the target UI use?',
    staticContextLeadIn:
      'The component library/design system. Common modern picks: MUI, Ant Design, Chakra, Tailwind + headless, in-house.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'MUI 6',
      'Ant Design 5',
      'Chakra v3',
      'Tailwind + headless components',
      'in-house',
    ],
    defaultsWhenUnchanged: 'current system',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    allowedExceptionScopes: ['service'],
  },

  // ===== Group F — Cross-cutting (5) =====

  {
    code: 'logging.framework',
    group: 'F',
    orderInGroup: 1,
    prompt: 'What logging stack should target services use?',
    staticContextLeadIn:
      'The logging library each service uses. Common modern picks: SLF4J + Logback JSON, Log4j 2, pino, structlog, zap.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'SLF4J + Logback JSON',
      'Log4j 2',
      'pino',
      'structlog',
      'zap',
    ],
    defaultsWhenUnchanged: 'current stack',
    cascades: [
      {
        decisionCode: 'logging.format',
        valueByTriggerValue: {
          'SLF4J + Logback JSON': 'JSON one-line',
          pino: 'JSON one-line',
          structlog: 'JSON one-line',
        },
        sourceStandardId: 'std.logging.format.v1',
      },
    ],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'logging.format',
    group: 'F',
    orderInGroup: 2,
    prompt: 'What log line format should target services emit?',
    staticContextLeadIn:
      'The on-the-wire log format. Common modern picks: JSON one-line, key=value, plain text.',
    expectedAnswerShape: 'single-choice',
    choices: ['JSON one-line', 'key=value', 'plain text'],
    defaultsWhenUnchanged: 'current format',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'metrics.framework',
    group: 'F',
    orderInGroup: 3,
    prompt: 'What metrics emission library should target services use?',
    staticContextLeadIn:
      'The metrics library services use. Common modern picks: Micrometer, prom-client, OpenTelemetry metrics.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Micrometer',
      'prom-client',
      'OpenTelemetry metrics',
      'none',
    ],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'tracing.framework',
    group: 'F',
    orderInGroup: 4,
    prompt: 'What distributed-tracing library?',
    staticContextLeadIn:
      'The distributed-tracing SDK. Common modern picks: OpenTelemetry SDK, Spring Cloud Sleuth, Zipkin Brave.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'OpenTelemetry SDK',
      'Spring Cloud Sleuth',
      'Zipkin Brave',
      'none',
    ],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'secrets.management',
    group: 'F',
    orderInGroup: 5,
    prompt: 'How should target services source secrets?',
    staticContextLeadIn:
      'Where services fetch secrets from. Common modern picks: Vault, AWS Secrets Manager, Azure Key Vault, env vars from CI.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Vault injector',
      'AWS Secrets Manager',
      'Azure Key Vault',
      'env vars from CI',
      'encrypted-properties',
    ],
    defaultsWhenUnchanged: 'current source',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  // ===== Group G — Infrastructure (5) =====

  {
    code: 'build.tool',
    group: 'G',
    orderInGroup: 1,
    prompt: 'What build tool should target services use?',
    staticContextLeadIn:
      'The build tool each service uses. Common modern picks: Gradle 8, Maven 3.9, npm + tsc, uv, go build, dotnet.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Gradle 8',
      'Maven 3.9',
      'npm + tsc',
      'uv',
      'go build',
      'dotnet 8',
    ],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'container.runtime',
    group: 'G',
    orderInGroup: 2,
    prompt: 'What container runtime / packaging?',
    staticContextLeadIn:
      'How services are packaged into containers. Common modern picks: OCI image via Docker, Buildpacks, Jib, or bare-metal.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'OCI image via Docker',
      'Buildpacks',
      'Jib',
      'none-bare-metal',
    ],
    defaultsWhenUnchanged: 'current runtime',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'container.baseImage',
    group: 'G',
    orderInGroup: 3,
    prompt: 'What container base image family?',
    staticContextLeadIn:
      'The base image family services derive from. Common modern picks: eclipse-temurin, node-slim, python-slim, distroless, ubi-minimal.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'eclipse-temurin:21-jre',
      'node:20-slim',
      'python:3.12-slim',
      'distroless/static',
      'ubi9-minimal',
    ],
    defaultsWhenUnchanged: 'current image',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'ci.pipeline',
    group: 'G',
    orderInGroup: 4,
    prompt: 'What CI system should run the target build pipeline?',
    staticContextLeadIn:
      'The CI system running the build pipeline. Common modern picks: GitHub Actions, GitLab CI, Jenkins, Azure DevOps Pipelines.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'GitHub Actions',
      'GitLab CI',
      'Jenkins',
      'Azure DevOps Pipelines',
    ],
    defaultsWhenUnchanged: 'current CI',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'deployment.target',
    group: 'G',
    orderInGroup: 5,
    prompt: 'What deployment target for the target services?',
    staticContextLeadIn:
      'Where services deploy. Common modern picks: Kubernetes, ECS Fargate, Cloud Run, on-prem VM, serverless functions.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Kubernetes 1.30',
      'ECS Fargate',
      'Cloud Run',
      'on-prem VM',
      'serverless functions',
    ],
    defaultsWhenUnchanged: 'current target',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  // ===== Group H — Inter-service communication (5) =====

  {
    code: 'interservice.syncProtocol',
    group: 'H',
    orderInGroup: 1,
    prompt: 'What synchronous inter-service call protocol?',
    staticContextLeadIn:
      'The protocol for synchronous service-to-service calls. Common modern picks: REST/JSON, gRPC, or async-only.',
    expectedAnswerShape: 'single-choice',
    choices: ['REST/JSON', 'gRPC', 'none-async-only'],
    defaultsWhenUnchanged: 'current protocol',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'interface'],
  },

  {
    code: 'interservice.asyncBus',
    group: 'H',
    orderInGroup: 2,
    prompt: 'What async messaging bus?',
    staticContextLeadIn:
      'The bus carrying async events between services. Common modern picks: Kafka, RabbitMQ, AWS SQS, Azure Service Bus, or none.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Kafka 3.7',
      'RabbitMQ 3.13',
      'AWS SQS',
      'Azure Service Bus',
      'none',
    ],
    defaultsWhenUnchanged: 'current bus',
    cascades: [
      {
        decisionCode: 'interservice.messageFormat',
        valueByTriggerValue: {
          'Kafka 3.7': 'Avro + Schema Registry',
          'RabbitMQ 3.13': 'JSON Schema',
          'AWS SQS': 'plain JSON',
        },
        sourceStandardId: 'std.async.format.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'interservice.messageFormat',
    group: 'H',
    orderInGroup: 3,
    prompt: 'What async message payload format?',
    staticContextLeadIn:
      'The on-the-wire format for async messages. Common modern picks: Avro + Schema Registry, JSON Schema, Protobuf, plain JSON.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Avro + Schema Registry',
      'JSON Schema',
      'Protobuf',
      'plain JSON',
    ],
    defaultsWhenUnchanged: 'current format',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'interface'],
  },

  {
    code: 'interservice.discoveryMechanism',
    group: 'H',
    orderInGroup: 4,
    prompt: 'How do target services discover each other?',
    staticContextLeadIn:
      'How services find each other at runtime. Common modern picks: Kubernetes DNS, Consul, Eureka, or hardcoded config URLs.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Kubernetes DNS',
      'Consul',
      'Eureka',
      'hardcoded URLs from config',
    ],
    defaultsWhenUnchanged: 'current mechanism',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'interservice.retryStrategy',
    group: 'H',
    orderInGroup: 5,
    prompt: 'What retry/backoff policy on inter-service calls?',
    staticContextLeadIn:
      'The retry/backoff policy on inter-service calls. Common modern picks: Resilience4j defaults, exponential with jitter, or fail-fast.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Resilience4j defaults',
      'exponential w/ jitter',
      'none-fail-fast',
    ],
    defaultsWhenUnchanged: 'current policy',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    allowedExceptionScopes: ['service', 'interface'],
  },

  // ===== Group I — Testing (5) =====

  {
    code: 'testing.unit',
    group: 'I',
    orderInGroup: 1,
    prompt: 'What unit-test framework should target services use?',
    staticContextLeadIn:
      'The unit-test framework for service code. Common modern picks: JUnit 5, Vitest, pytest, go test, NUnit 4.',
    expectedAnswerShape: 'single-choice',
    choices: ['JUnit 5', 'Vitest', 'pytest', 'go test', 'NUnit 4'],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    allowedExceptionScopes: ['service', 'class'],
  },

  {
    code: 'testing.integration',
    group: 'I',
    orderInGroup: 2,
    prompt: 'What integration-test framework?',
    staticContextLeadIn:
      'The integration-test framework. Common modern picks: Spring Boot Test + Testcontainers, Quarkus Test, Vitest + Testcontainers, pytest + testcontainers-python.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Spring Boot Test + Testcontainers',
      'Quarkus Test',
      'Vitest + Testcontainers',
      'pytest + testcontainers-python',
    ],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'testing.e2e',
    group: 'I',
    orderInGroup: 3,
    prompt: 'What end-to-end test framework?',
    staticContextLeadIn:
      'The end-to-end test framework. Common modern picks: Playwright, Cypress, REST Assured, Karate, or none.',
    expectedAnswerShape: 'single-choice',
    choices: ['Playwright', 'Cypress', 'REST Assured', 'Karate', 'none'],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },

  {
    code: 'testing.contractTesting',
    group: 'I',
    orderInGroup: 4,
    prompt: 'What consumer-driven contract test framework?',
    staticContextLeadIn:
      'The consumer-driven contract framework. Common modern picks: Pact, Spring Cloud Contract, or none.',
    expectedAnswerShape: 'single-choice',
    choices: ['Pact 4', 'Spring Cloud Contract', 'none'],
    defaultsWhenUnchanged: 'current approach',
    cascades: [],
    allowedExceptionScopes: ['interface'],
  },

  {
    code: 'testing.mocking',
    group: 'I',
    orderInGroup: 5,
    prompt: 'What mocking library should unit tests use?',
    staticContextLeadIn:
      'The mocking library for unit tests. Common modern picks: Mockito 5, MockK, vi.mock, pytest-mock, gomock.',
    expectedAnswerShape: 'single-choice',
    choices: ['Mockito 5', 'MockK', 'vi.mock', 'pytest-mock', 'gomock'],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    allowedExceptionScopes: ['service', 'class'],
  },

  // ===== Group J — Cut-over (4) =====

  {
    code: 'cutover.strategy',
    group: 'J',
    orderInGroup: 1,
    prompt: 'What cut-over strategy for migrating from current to target?',
    staticContextLeadIn:
      'How the migration moves traffic from current to target. Common modern picks: strangler fig, big-bang, blue-green, dark launch + shadow traffic.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'strangler fig',
      'big-bang',
      'blue-green',
      'dark launch + shadow traffic',
    ],
    defaultsWhenUnchanged: '(no current — required choice)',
    cascades: [],
    allowedExceptionScopes: ['service', 'interface'],
  },

  {
    code: 'cutover.dataMigration',
    group: 'J',
    orderInGroup: 2,
    prompt: 'How does data migrate from current to target persistence?',
    staticContextLeadIn:
      'How data moves from current to target persistence. Common modern picks: online dual-write + backfill, offline ETL with downtime, change-data-capture, shared DB.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'online dual-write + backfill',
      'offline ETL with downtime',
      'change-data-capture stream',
      'none-shared-db',
    ],
    defaultsWhenUnchanged: '(no current — required choice)',
    cascades: [],
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'cutover.rollback',
    group: 'J',
    orderInGroup: 3,
    prompt: 'What rollback plan if the cut-over fails?',
    staticContextLeadIn:
      'The rollback plan if cut-over fails. Common modern picks: DNS flip back, traffic-shaped percentage rollback, restore from backup + replay.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'DNS flip back',
      'traffic-shaped percentage rollback',
      'restore-from-backup + replay',
    ],
    defaultsWhenUnchanged: '(no current — required choice)',
    cascades: [],
    allowedExceptionScopes: ['service', 'interface'],
  },

  {
    code: 'cutover.parallelRunWindow',
    group: 'J',
    orderInGroup: 4,
    prompt:
      'How long should current and target run in parallel for verification?',
    staticContextLeadIn:
      'How long current and target run in parallel for verification. Common modern picks: no parallel run, hours, days, weeks.',
    expectedAnswerShape: 'single-choice',
    choices: ['no parallel run', 'hours', 'days', 'weeks'],
    defaultsWhenUnchanged: '(no current — required choice)',
    cascades: [],
    allowedExceptionScopes: ['service'],
  },
];
