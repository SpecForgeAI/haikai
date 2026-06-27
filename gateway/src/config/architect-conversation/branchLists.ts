/**
 * Deterministic branch-lists — Target-conversation tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR2 + FR3
 * deterministic half).
 *
 * PURE DATA + PURE RESOLVERS. No I/O, no LLM, no orchestration in this file.
 *
 * Two structures live here:
 *
 *   1. `BRANCH_LISTS` — for each `hard-dependent` question, the compatible
 *      subset of that question's `choices` keyed on the foundational answer(s)
 *      (primarily `service.language`; `db.engine` / `ui.framework` /
 *      `api.protocol` key their own groups). This is the deterministic filter
 *      the runtime (Task Group 4) reads to HIDE incompatible choices. The
 *      LOCKED worked example holds: `service.language = "Java 21"` =>
 *      `service.framework` yields ONLY `Spring Boot 3.4` / `Quarkus 3` /
 *      `Micronaut 4` and excludes `FastAPI` / `NestJS` / `Gin` / `ASP.NET`.
 *
 *   2. `COMPATIBILITY_MATRIX` — for the `grey` questions whose compatibility is
 *      CLEAR-CUT, a deterministic keep/hide verdict so the LLM-judge (Task
 *      Group 3) only ever sees the genuinely ambiguous residue
 *      (`undecided`). This is the code-pre-filter half of the
 *      code-pre-filter-then-LLM pattern.
 *
 * Both are validated at load time by `validateQuestionLibrary` in
 * `loadConfigs.ts`: every `hard-dependent` / `grey` entry must have branch-list
 * OR matrix coverage, else the loader throws at startup.
 *
 * These structures sit ALONGSIDE the existing `cascades` seed map — they
 * RESTRICT the offered set; `cascades` PROPOSES a default. Neither replaces the
 * other (FR7).
 */

// ---------------------------------------------------------------------------
// Foundational answer "buckets"
//
// A foundational answer (e.g. `service.language = "Java 21"`) is collapsed to a
// coarse bucket (e.g. `jvm`) so a branch-list is authored once per family
// rather than once per exact version string. The bucketing is pure data.
// ---------------------------------------------------------------------------

/** Language family derived from a `service.language` answer. */
export type LanguageBucket =
  | 'jvm' // Java / Kotlin
  | 'node' // TypeScript / Node
  | 'python'
  | 'go'
  | 'dotnet';

/**
 * Map an exact `service.language` choice value to its coarse language bucket.
 * Returns `undefined` for an unrecognised value (e.g. an `Other (advanced)`
 * free-text), which the runtime treats as "no deterministic narrowing" — the
 * full set is offered (fail-open).
 */
export function languageBucketOf(
  serviceLanguage: string | undefined | null
): LanguageBucket | undefined {
  if (!serviceLanguage) return undefined;
  const v = serviceLanguage.trim().toLowerCase();
  if (v.startsWith('java') || v.startsWith('kotlin')) return 'jvm';
  if (v.startsWith('typescript') || v.startsWith('node')) return 'node';
  if (v.startsWith('python')) return 'python';
  if (v.startsWith('go')) return 'go';
  if (v.startsWith('c#') || v.startsWith('.net') || v.startsWith('dotnet'))
    return 'dotnet';
  return undefined;
}

/** Runtime family derived from a `service.runtime` answer (a refiner of A). */
export type RuntimeBucket = 'jvm' | 'node' | 'python' | 'go' | 'dotnet';

export function runtimeBucketOf(
  serviceRuntime: string | undefined | null
): RuntimeBucket | undefined {
  if (!serviceRuntime) return undefined;
  const v = serviceRuntime.trim().toLowerCase();
  if (v.includes('temurin') || v.includes('graalvm')) return 'jvm';
  if (v.includes('node')) return 'node';
  if (v.includes('cpython') || v.includes('python')) return 'python';
  if (v.includes('go ')) return 'go';
  if (v.includes('.net') || v.includes('dotnet')) return 'dotnet';
  return undefined;
}

/** Engine family derived from a `db.engine` answer (sub-foundational for C). */
export type EngineBucket = 'sql' | 'mongo' | 'dynamo';

export function engineBucketOf(
  dbEngine: string | undefined | null
): EngineBucket | undefined {
  if (!dbEngine) return undefined;
  const v = dbEngine.trim().toLowerCase();
  if (v.includes('mongo')) return 'mongo';
  if (v.includes('dynamo')) return 'dynamo';
  if (
    v.includes('postgres') ||
    v.includes('mysql') ||
    v.includes('sql server') ||
    v.includes('ms sql') ||
    v.includes('oracle') ||
    v.includes('sybase')
  )
    return 'sql';
  return undefined;
}

/** UI framework family derived from a `ui.framework` answer (foundational for E). */
export type UiBucket = 'react' | 'vue' | 'angular' | 'svelte' | 'none';

export function uiBucketOf(
  uiFramework: string | undefined | null
): UiBucket | undefined {
  if (!uiFramework) return undefined;
  const v = uiFramework.trim().toLowerCase();
  if (v.startsWith('react')) return 'react';
  if (v.startsWith('vue')) return 'vue';
  if (v.startsWith('angular')) return 'angular';
  if (v.startsWith('svelte')) return 'svelte';
  if (v.includes('server-rendered') || v.startsWith('none')) return 'none';
  return undefined;
}

/** API protocol family derived from a multi-choice `api.protocol` answer. */
export type ProtocolBucket = 'rest' | 'grpc' | 'graphql' | 'soap' | 'async';

export function protocolBucketsOf(
  apiProtocol: string | readonly string[] | undefined | null
): ProtocolBucket[] {
  if (!apiProtocol) return [];
  const raw = Array.isArray(apiProtocol) ? apiProtocol : [apiProtocol];
  const out = new Set<ProtocolBucket>();
  for (const item of raw) {
    const v = String(item).trim().toLowerCase();
    if (v.includes('rest')) out.add('rest');
    if (v.includes('grpc')) out.add('grpc');
    if (v.includes('graphql')) out.add('graphql');
    if (v.includes('soap')) out.add('soap');
    if (v.includes('asyncapi') || v.includes('kafka')) out.add('async');
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Branch-list table (hard-dependent questions)
//
// Shape: questionCode -> foundationalKey -> bucket -> compatible choice subset.
// `foundationalKey` is the decision code whose answer keys the branch (one of
// the question's `foundationalInputs`). The runtime resolver looks up the
// FIRST foundational input it has an answer for. Subsets are EXACT members of
// the question's `choices` array in `questionLibrary.ts`.
// ---------------------------------------------------------------------------

export interface BranchList {
  /** The decision code whose answer keys this branch-list. */
  readonly foundationalCode: string;
  /** bucket -> compatible subset of the question's `choices`. */
  readonly byBucket: Readonly<Record<string, readonly string[]>>;
}

/**
 * Deterministic branch-lists for every `hard-dependent` question. Keyed first
 * by the question's own `code`, then carries the foundational code + the
 * per-bucket compatible subset.
 */
export const BRANCH_LISTS: Readonly<Record<string, BranchList>> = {
  // --- Group A ---
  'service.framework': {
    foundationalCode: 'service.language',
    byBucket: {
      // LOCKED worked example: Java/Kotlin (jvm) => JVM-only frameworks.
      jvm: ['Spring Boot', 'Quarkus', 'Micronaut'],
      node: ['NestJS'],
      python: ['FastAPI'],
      go: ['Gin'],
      dotnet: ['ASP.NET'],
    },
  },
  'service.runtime': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Eclipse Temurin', 'GraalVM'],
      node: ['Node 20 LTS'],
      python: ['CPython'],
      go: ['Go 1.22 alpine'],
      dotnet: ['.NET'],
    },
  },

  // --- Group C ---
  'db.migrations': {
    foundationalCode: 'db.engine',
    byBucket: {
      sql: ['Flyway', 'Liquibase', 'none-managed-by-app'],
      mongo: ['Mongock', 'none-managed-by-app'],
      dynamo: ['none-managed-by-app'],
    },
  },
  'db.driver': {
    foundationalCode: 'db.engine',
    byBucket: {
      // Drivers are engine-specific. (They are also language-flavoured; the
      // engine narrows to the single compatible driver, language refines no
      // further for the curated v1 set.)
      sql: [
        'pgjdbc',
        'mysql-connector-j',
        'mssql-jdbc',
        'oracle ojdbc11',
        'jtds',
      ],
      mongo: ['mongo-java-driver'],
      dynamo: ['dynamodb-enhanced'],
    },
  },

  // --- Group D ---
  'dto.style': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Java records', 'Kotlin data classes', 'Lombok @Value'],
      node: ['TypeScript interfaces'],
      python: ['Pydantic models'],
      go: ['Go structs with tags'],
      dotnet: ['Go structs with tags'], // C# records not in the v1 set; closest record-style is exposed via Other (advanced).
    },
  },
  'validation.framework': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Bean Validation', 'Hibernate Validator', 'manual'],
      node: ['class-validator', 'manual'],
      python: ['Pydantic v2', 'manual'],
      go: ['manual'],
      dotnet: ['manual'],
    },
  },

  // --- Group E (keyed on ui.framework) ---
  'ui.buildTool': {
    foundationalCode: 'ui.framework',
    byBucket: {
      react: ['Vite', 'Webpack', 'esbuild'],
      vue: ['Vite', 'Webpack', 'esbuild'],
      svelte: ['Vite', 'Webpack', 'esbuild'],
      angular: ['Angular CLI'],
    },
  },
  'ui.testing': {
    foundationalCode: 'ui.framework',
    byBucket: {
      react: ['Vitest + Testing Library', 'Jest + Testing Library', 'Playwright'],
      vue: ['Vitest + Testing Library', 'Jest + Testing Library', 'Playwright'],
      svelte: ['Vitest + Testing Library', 'Playwright'],
      angular: ['Karma + Jasmine', 'Playwright'],
    },
  },
  'ui.stateManagement': {
    foundationalCode: 'ui.framework',
    byBucket: {
      react: ['Redux Toolkit', 'Zustand', 'MobX', 'none-local-state-only'],
      vue: ['Pinia', 'none-local-state-only'],
      angular: ['NgRx', 'none-local-state-only'],
      svelte: ['none-local-state-only'],
    },
  },

  // --- Group G ---
  'build.tool': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Gradle', 'Maven'],
      node: ['npm + tsc'],
      python: ['uv'],
      go: ['go build'],
      dotnet: ['dotnet'],
    },
  },
  'container.baseImage': {
    // Base-image family follows the runtime (which itself follows language).
    foundationalCode: 'service.runtime',
    byBucket: {
      jvm: ['eclipse-temurin:21-jre', 'distroless/static', 'ubi9-minimal'],
      node: ['node:20-slim', 'distroless/static', 'ubi9-minimal'],
      python: ['python:3.12-slim', 'distroless/static', 'ubi9-minimal'],
      go: ['distroless/static', 'ubi9-minimal'],
      dotnet: ['ubi9-minimal', 'distroless/static'],
    },
  },

  // --- Group I (keyed on service.language) ---
  'testing.unit': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['JUnit'],
      node: ['Vitest'],
      python: ['pytest'],
      go: ['go test'],
      dotnet: ['NUnit'],
    },
  },
  'testing.integration': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Spring Boot Test + Testcontainers', 'Quarkus Test'],
      node: ['Vitest + Testcontainers'],
      python: ['pytest + testcontainers-python'],
      // go / dotnet have no curated v1 integration choice; Other (advanced).
      go: [],
      dotnet: [],
    },
  },
  'testing.mocking': {
    foundationalCode: 'service.language',
    byBucket: {
      jvm: ['Mockito', 'MockK'],
      node: ['vi.mock'],
      python: ['pytest-mock'],
      go: ['gomock'],
      dotnet: ['Mockito'], // no curated .NET mock in v1 set; Other (advanced) covers Moq.
    },
  },

  // --- Group B (keyed on api.protocol) ---
  'api.contractFormat': {
    foundationalCode: 'api.protocol',
    byBucket: {
      rest: ['OpenAPI'],
      grpc: ['proto3'],
      graphql: ['GraphQL SDL'],
      async: ['AsyncAPI'],
      soap: ['WSDL'],
    },
  },
};

// ---------------------------------------------------------------------------
// Branch-list resolver (pure)
// ---------------------------------------------------------------------------

/**
 * Resolve the compatible subset of `allChoices` for a hard-dependent question,
 * given the foundational answers gathered so far.
 *
 * - Returns `undefined` when there is no branch-list for the code, or no
 *   recognised foundational answer (=> the caller offers the FULL set;
 *   fail-open, no silent narrowing).
 * - Otherwise returns the EXACT subset for the resolved bucket (which may be
 *   empty, signalling "no curated choice for this combination" — the caller
 *   then relies on the `Other (advanced)` escape hatch).
 *
 * The resolver bucketises by the question's `foundationalCode`. Refiner inputs
 * (e.g. `service.runtime` for `service.framework`) narrow no further in v1;
 * the headline language/engine/ui/protocol filter is sufficient.
 */
export function resolveBranchSubset(
  questionCode: string,
  foundationalAnswers: Readonly<Record<string, string | readonly string[]>>
): readonly string[] | undefined {
  const list = BRANCH_LISTS[questionCode];
  if (!list) return undefined;

  const answer = foundationalAnswers[list.foundationalCode];
  let bucket: string | undefined;
  switch (list.foundationalCode) {
    case 'service.language':
      bucket = languageBucketOf(typeof answer === 'string' ? answer : undefined);
      break;
    case 'service.runtime':
      bucket = runtimeBucketOf(typeof answer === 'string' ? answer : undefined);
      break;
    case 'db.engine':
      bucket = engineBucketOf(typeof answer === 'string' ? answer : undefined);
      break;
    case 'ui.framework':
      bucket = uiBucketOf(typeof answer === 'string' ? answer : undefined);
      break;
    case 'api.protocol': {
      // Multi-choice: union the per-protocol subsets.
      const buckets = protocolBucketsOf(answer);
      if (buckets.length === 0) return undefined;
      const union = new Set<string>();
      for (const b of buckets) {
        for (const c of list.byBucket[b] ?? []) union.add(c);
      }
      return [...union];
    }
    default:
      bucket = undefined;
  }

  if (bucket === undefined) return undefined;
  return list.byBucket[bucket];
}

/** True iff this question has a deterministic branch-list. */
export function hasBranchList(questionCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(BRANCH_LISTS, questionCode);
}
