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
// Per-question dependency classification (Spec 2026-06-24-target-conversation-
// tech-stack-constraints, FR1)
//
// Encodes the FINALIZED per-question dependency matrix (spec.md
// "Per-Question Dependency Matrix", Groups A-J) as typed metadata ALONGSIDE
// the existing `cascades` seed map (never replacing it).
//
//   - `hard-dependent` (H) — the offered `choices` branch on a foundational
//     answer (e.g. Java 21 => only JVM frameworks). 15 such questions.
//   - `grey`           (G) — clear-cut compatibility is resolved by the
//     deterministic compatibility matrix; only the genuinely ambiguous
//     residue is adjudicated by the LLM-judge. 9 such questions.
//   - `independent`    (I) — a constant, never-filtered set (cutover, auth
//     policy, rate limiting, secrets, tracing, the freely-chosen branchers
//     `db.engine` / `ui.framework`, ...). 27 such questions.
//
// Tally LOCKED at 15 H / 9 G / 27 I (= 51) per the decisions doc. Under API
// like-for-like (FR9) a fourth RUNTIME treatment `L` supersedes H/I/G for the
// Group B set; that treatment is layered in a later task group and does NOT
// erase the underlying `dependencyClass` recorded here.
// ---------------------------------------------------------------------------

export type DependencyClass = 'hard-dependent' | 'grey' | 'independent';

// ---------------------------------------------------------------------------
// API like-for-like lock (Spec 2026-06-24-target-conversation-tech-stack-
// constraints, FR9 / FR1 `L` treatment)
//
// `L` (locked / auto-answered from source) is a fourth RUNTIME treatment that
// supersedes H/I/G for the API-surface set (the whole of Group B) while the
// migration mode `api.surfaceMode` resolves to `like_for_like`. It is NOT a
// `dependencyClass`: each Group B row keeps its underlying H/I/G class on the
// entry (the `L` treatment is computed at runtime by `apiSurfaceLock.ts`, it
// does not erase the base class). The only metadata the library carries for it
// is the per-entry `lockableFromSource` flag below.
//
// `TreatmentClass` is the runtime-effective class an entry resolves to: its
// `dependencyClass` UNLESS the like-for-like lock has superseded it with
// `'locked'`. The canonical `api.surfaceMode` enum + the `'locked'` marker
// member live in the shared `apiSurfaceMode.json` source-of-truth (mirrored
// into the frontend, drift-guarded by a contract test).
// ---------------------------------------------------------------------------

export type TreatmentClass = DependencyClass | 'locked';

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
  /**
   * Dependency classification from the finalized per-question matrix (FR1):
   * `hard-dependent` branches on a foundational answer, `grey` is
   * deterministic-matrix-then-LLM-judge, `independent` is never filtered.
   * Populated on every one of the 51 entries; sits ALONGSIDE `cascades`.
   */
  dependencyClass: DependencyClass;
  /**
   * Decision code(s) the runtime filter keys on for this question. `[]` for
   * `independent` rows (and for `service.language`, the primary brancher,
   * which is narrowed by nothing). Each code resolves to a real library
   * entry; the loader validates this (FR1 validation).
   */
  foundationalInputs: readonly string[];
  /**
   * Renders the FR5 decoupled framework+version control (one resolved chip).
   * True for the seven versioned codes: `service.language`,
   * `service.framework`, `service.runtime`, `db.engine`, `db.driver`,
   * `ui.framework`, `build.tool`.
   */
  versioned: boolean;
  /**
   * API like-for-like lock metadata (FR9). `true` for EXACTLY the six Group B
   * (API-surface) codes -- `api.protocol`, `api.versioning`,
   * `api.contractFormat`, `api.auth`, `api.errorContract`, `api.rateLimiting`.
   * When the migration mode `api.surfaceMode` resolves to `like_for_like`,
   * these questions are auto-answered + LOCKED from the source contract /
   * baseline (runtime treatment `L`, superseding the underlying
   * `dependencyClass`) and NOT asked. `false`/absent on every other entry.
   * Additive: the underlying H/I/G `dependencyClass` is still recorded; `L`
   * supersedes it only while like-for-like is active.
   */
  lockableFromSource?: boolean;
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
      'Java',
      'Kotlin',
      'C#',
      'TypeScript/Node',
      'Python',
      'Go',
    ],
    defaultsWhenUnchanged: 'current language + version',
    cascades: [
      {
        decisionCode: 'service.runtime',
        valueByTriggerValue: {
          'Java': 'Eclipse Temurin',
          'Kotlin': 'Eclipse Temurin',
          'TypeScript/Node': 'Node 20 LTS',
          'Python': 'CPython',
          'Go': 'Go 1.22 alpine',
          'C#': '.NET',
        },
        sourceStandardId: 'std.runtime.v1',
      },
      {
        decisionCode: 'testing.unit',
        valueByTriggerValue: {
          'Java': 'JUnit',
          'Kotlin': 'JUnit',
          'TypeScript/Node': 'Vitest',
          'Python': 'pytest',
          'Go': 'go test',
          'C#': 'NUnit',
        },
        sourceStandardId: 'std.testing.unit.v1',
      },
      {
        decisionCode: 'dto.style',
        valueByTriggerValue: {
          'Java': 'Java records',
          'Kotlin': 'Kotlin data classes',
          'TypeScript/Node': 'TypeScript interfaces',
        },
        sourceStandardId: 'std.dto.v1',
      },
      {
        decisionCode: 'build.tool',
        valueByTriggerValue: {
          'Java': 'Gradle',
          'Kotlin': 'Gradle',
          'TypeScript/Node': 'npm + tsc',
          'Python': 'uv',
          'Go': 'go build',
          'C#': 'dotnet',
        },
        sourceStandardId: 'std.build.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: [],
    versioned: true,
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
      'Spring Boot',
      'Quarkus',
      'Micronaut',
      'NestJS',
      'FastAPI',
      'Gin',
      'ASP.NET',
    ],
    defaultsWhenUnchanged: 'current framework + version',
    cascades: [
      {
        decisionCode: 'validation.framework',
        valueByTriggerValue: {
          'Spring Boot': 'Bean Validation',
          'Quarkus': 'Hibernate Validator',
          'NestJS': 'class-validator',
          'FastAPI': 'Pydantic v2',
        },
        sourceStandardId: 'std.validation.v1',
      },
      {
        decisionCode: 'logging.framework',
        valueByTriggerValue: {
          'Spring Boot': 'SLF4J + Logback JSON',
          'Quarkus': 'SLF4J + Logback JSON',
          'NestJS': 'pino',
          'FastAPI': 'structlog',
        },
        sourceStandardId: 'std.logging.v1',
      },
      {
        decisionCode: 'metrics.framework',
        valueByTriggerValue: {
          'Spring Boot': 'Micrometer',
          'Quarkus': 'Micrometer',
          'NestJS': 'prom-client',
          'FastAPI': 'OpenTelemetry metrics',
        },
        sourceStandardId: 'std.metrics.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language', 'service.runtime'],
    versioned: true,
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
      'Eclipse Temurin',
      'GraalVM',
      'Node 20 LTS',
      'CPython',
      'Go 1.22 alpine',
      '.NET',
    ],
    defaultsWhenUnchanged: 'current runtime',
    cascades: [
      {
        decisionCode: 'container.baseImage',
        valueByTriggerValue: {
          'Eclipse Temurin': 'eclipse-temurin:21-jre',
          'GraalVM': 'eclipse-temurin:21-jre',
          'Node 20 LTS': 'node:20-slim',
          'CPython': 'python:3.12-slim',
          'Go 1.22 alpine': 'distroless/static',
        },
        sourceStandardId: 'std.container.base.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'grey',
    foundationalInputs: ['service.framework'],
    versioned: false,
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
          'REST/JSON': 'OpenAPI',
          gRPC: 'proto3',
          GraphQL: 'GraphQL SDL',
          'SOAP-passthrough': 'WSDL',
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    lockableFromSource: true,
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
    dependencyClass: 'grey',
    foundationalInputs: ['api.protocol'],
    versioned: false,
    lockableFromSource: true,
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
    choices: ['OpenAPI', 'proto3', 'GraphQL SDL', 'AsyncAPI', 'WSDL'],
    defaultsWhenUnchanged: 'current format',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['api.protocol'],
    versioned: false,
    lockableFromSource: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    lockableFromSource: true,
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
    dependencyClass: 'grey',
    foundationalInputs: ['api.protocol'],
    versioned: false,
    lockableFromSource: true,
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
    choices: ['gateway-enforced', 'per-service in-process'],
    defaultsWhenUnchanged: 'current approach',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    lockableFromSource: true,
    allowedExceptionScopes: ['interface', 'endpoint'],
  },

  // ===== Group C — Data persistence (10) =====

  {
    code: 'db.engine',
    group: 'C',
    orderInGroup: 1,
    prompt: 'What primary database engine should the target use?',
    staticContextLeadIn:
      'The primary store for transactional workloads. Common modern picks: PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, DynamoDB.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'Postgres',
      'MySQL',
      'MS SQL Server',
      'Oracle',
      'Sybase ASE',
      'MongoDB',
      'DynamoDB',
    ],
    defaultsWhenUnchanged: 'current engine',
    cascades: [
      {
        decisionCode: 'db.migrations',
        valueByTriggerValue: {
          'Postgres': 'Flyway',
          'MySQL': 'Flyway',
          'MS SQL Server': 'Flyway',
          'MongoDB': 'Mongock',
        },
        sourceStandardId: 'std.db.migrations.v1',
      },
      {
        decisionCode: 'db.connectionPool',
        valueByTriggerValue: {
          'Postgres': 'HikariCP',
          'MS SQL Server': 'HikariCP',
          'MongoDB': 'native driver pool',
        },
        sourceStandardId: 'std.db.pool.v1',
      },
      {
        decisionCode: 'db.driver',
        valueByTriggerValue: {
          'Postgres': 'pgjdbc',
          'MySQL': 'mysql-connector-j',
          'MS SQL Server': 'mssql-jdbc',
          'Oracle': 'oracle ojdbc11',
          'Sybase ASE': 'jtds',
          'MongoDB': 'mongo-java-driver',
          DynamoDB: 'dynamodb-enhanced',
        },
        sourceStandardId: 'std.db.driver.v1',
      },
    ],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    choices: ['Flyway', 'Liquibase', 'Mongock', 'none-managed-by-app'],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['db.engine'],
    versioned: true,
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
    choices: ['HikariCP', 'Agroal', 'native driver pool'],
    defaultsWhenUnchanged: 'current pool',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['db.engine', 'service.language'],
    versioned: true,
    allowedExceptionScopes: ['service'],
  },

  // ---- Persistence-tier migration policy questions (Spec A,
  // 2026-07-02-a-target-inputs-and-pack-wiring). All four are independent /
  // non-versioned so they need no branch-list coverage and no frontend
  // versioned-code registration; mappingMutationRules covers them via the
  // notes-only fallback automatically. ----

  {
    code: 'db.schemaMapping',
    group: 'C',
    orderInGroup: 7,
    prompt: 'How should source database schemas map to target schemas?',
    staticContextLeadIn:
      'How source schema names carry over in a cross-engine migration. Common modern picks: map the default source schema (e.g. dbo) to public, keep source schema names, or consolidate to a single schema.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'map-default-schema-to-public',
      'keep-source-schema-names',
      'consolidate-to-single-schema',
    ],
    defaultsWhenUnchanged: 'map-default-schema-to-public',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'db.extensions',
    group: 'C',
    orderInGroup: 8,
    prompt: 'Which database extensions are permitted on the target?',
    staticContextLeadIn:
      'The extension policy constrains schema-migration options (e.g. citext enables case-insensitive columns; pg_cron enables in-database scheduled jobs). Common modern picks: citext, pg_cron, uuid-ossp, pgcrypto — or a restricted no-extensions policy.',
    expectedAnswerShape: 'multi-choice',
    choices: [
      'citext',
      'pg_cron',
      'uuid-ossp',
      'pgcrypto',
      'none-restricted-policy',
    ],
    defaultsWhenUnchanged: 'citext, pg_cron',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'db.jobsRehoming',
    group: 'C',
    orderInGroup: 9,
    prompt: 'Where should database-resident scheduled jobs run on the target?',
    staticContextLeadIn:
      'Source engines often host scheduled jobs inside the database (e.g. Sybase Job Scheduler). Common modern picks: pg_cron in-database, an external scheduler, application-level scheduling, or decommission.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'pg_cron',
      'external-scheduler',
      'application-scheduled',
      'decommission-jobs',
    ],
    defaultsWhenUnchanged: 'pg_cron',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'db.migrationWindow',
    group: 'C',
    orderInGroup: 10,
    prompt:
      'What migration window / downtime tolerance applies to the data migration?',
    staticContextLeadIn:
      'Drives the bulk-vs-incremental shape of the data migration. Common modern picks: a weekend bulk load with daily incremental sync until swap-over, an extended-outage big bang, or near-zero downtime via CDC.',
    expectedAnswerShape: 'single-choice',
    choices: [
      'weekend-bulk-plus-daily-incremental-sync',
      'extended-outage-big-bang',
      'near-zero-downtime-cdc',
      'flexible-no-constraint',
    ],
    defaultsWhenUnchanged: 'weekend-bulk-plus-daily-incremental-sync',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['physical_data_entity'],
  },

  {
    code: 'db.databaseName',
    group: 'C',
    orderInGroup: 11,
    prompt: 'What should the target database be named?',
    staticContextLeadIn:
      'The physical database name the migration creates and every configuration references: ' +
      'the schema-apply seed CREATES this database, the data migration loads into it, and the ' +
      "migrated services' default configuration (e.g. the application.yml datasource URL) must " +
      'point at exactly this name. Lowercase letters, digits and underscores (a safe ' +
      'PostgreSQL identifier). Default: haikai_target.',
    expectedAnswerShape: 'free-text',
    choices: [],
    defaultsWhenUnchanged: 'haikai_target',
    cascades: [],
    relevanceCondition: onlyWhenPersistenceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['physical_data_entity'],
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
          'Java records': 'Bean Validation',
          'Pydantic models': 'Pydantic v2',
          'TypeScript interfaces': 'class-validator',
        },
        sourceStandardId: 'std.validation.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: false,
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
      'Bean Validation',
      'Hibernate Validator',
      'class-validator',
      'Pydantic v2',
      'manual',
    ],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
      'MapStruct',
      'manual mapper classes',
      'ModelMapper',
      'none-direct-entity-exposure',
    ],
    defaultsWhenUnchanged: 'current strategy',
    cascades: [],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'grey',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
      'React',
      'Vue',
      'Angular',
      'Svelte',
      'none-server-rendered',
    ],
    defaultsWhenUnchanged: 'current framework',
    cascades: [
      {
        decisionCode: 'ui.buildTool',
        valueByTriggerValue: {
          'React': 'Vite',
          'Vue': 'Vite',
          'Angular': 'Angular CLI',
        },
        sourceStandardId: 'std.ui.build.v1',
      },
      {
        decisionCode: 'ui.testing',
        valueByTriggerValue: {
          'React': 'Vitest + Testing Library',
          'Vue': 'Vitest + Testing Library',
          'Angular': 'Karma + Jasmine',
        },
        sourceStandardId: 'std.ui.testing.v1',
      },
      {
        decisionCode: 'ui.stateManagement',
        valueByTriggerValue: {
          'React': 'Redux Toolkit',
          'Vue': 'Pinia',
          'Angular': 'NgRx',
        },
        sourceStandardId: 'std.ui.state.v1',
      },
    ],
    relevanceCondition: onlyWhenUiTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    choices: ['Vite', 'Webpack', 'esbuild', 'Angular CLI'],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['ui.framework'],
    versioned: true,
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
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['ui.framework'],
    versioned: true,
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
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['ui.framework'],
    versioned: true,
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
      'MUI',
      'Ant Design',
      'Chakra v3',
      'Tailwind + headless components',
      'in-house',
    ],
    defaultsWhenUnchanged: 'current system',
    cascades: [],
    relevanceCondition: onlyWhenUiTier,
    dependencyClass: 'grey',
    foundationalInputs: ['ui.framework'],
    versioned: true,
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
      'Log4j',
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
    dependencyClass: 'grey',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    ],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    dependencyClass: 'grey',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    ],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
      'Gradle',
      'Maven',
      'npm + tsc',
      'uv',
      'go build',
      'dotnet',
    ],
    defaultsWhenUnchanged: 'current tool',
    cascades: [],
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
      'Kubernetes',
      'ECS Fargate',
      'Cloud Run',
      'on-prem VM',
      'serverless functions',
    ],
    defaultsWhenUnchanged: 'current target',
    cascades: [],
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
      'Kafka',
      'RabbitMQ',
      'AWS SQS',
      'Azure Service Bus',
    ],
    defaultsWhenUnchanged: 'current bus',
    cascades: [
      {
        decisionCode: 'interservice.messageFormat',
        valueByTriggerValue: {
          'Kafka': 'Avro + Schema Registry',
          'RabbitMQ': 'JSON Schema',
          'AWS SQS': 'plain JSON',
        },
        sourceStandardId: 'std.async.format.v1',
      },
    ],
    relevanceCondition: onlyWhenServiceTier,
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    dependencyClass: 'grey',
    foundationalInputs: ['interservice.asyncBus'],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'grey',
    foundationalInputs: ['service.language'],
    versioned: false,
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
    choices: ['JUnit', 'Vitest', 'pytest', 'go test', 'NUnit'],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    choices: ['Playwright', 'Cypress', 'REST Assured', 'Karate'],
    defaultsWhenUnchanged: 'current framework',
    cascades: [],
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    choices: ['Pact', 'Spring Cloud Contract'],
    defaultsWhenUnchanged: 'current approach',
    cascades: [],
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: true,
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
    choices: ['Mockito', 'MockK', 'vi.mock', 'pytest-mock', 'gomock'],
    defaultsWhenUnchanged: 'current library',
    cascades: [],
    dependencyClass: 'hard-dependent',
    foundationalInputs: ['service.language'],
    versioned: true,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
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
    dependencyClass: 'independent',
    foundationalInputs: [],
    versioned: false,
    allowedExceptionScopes: ['service'],
  },
];
