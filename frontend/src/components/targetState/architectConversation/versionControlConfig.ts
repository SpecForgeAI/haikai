/**
 * Version-control configuration + enrichment seam — Target-conversation
 * tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR5 / FR6 / FR8;
 * extended by Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux,
 * FR1 / FR2 — bare-stem chips, 24 versioned codes, stem-keyed defaults).
 *
 * PURE DATA + a SWAPPABLE, FAIL-OPEN enrichment-client interface. No network
 * calls happen in this module; the default enrichment client is a graceful
 * no-op so the version control is FULLY USABLE OFFLINE on free-text +
 * recommended default. A host (or a future Spec 2-style proxy/CA-aware client)
 * swaps in a real client to AUGMENT the typeahead suggestion list only.
 */

/**
 * The 24 `versioned` decision codes. Each renders the decoupled
 * framework+version control (bare-stem chips + a separate version axis) instead
 * of plain single-select chips. Mirrors the gateway
 * `QuestionLibraryEntry.versioned === true` set EXACTLY (the existing 7 plus the
 * 17 added by the bare-stem-UX spec); kept as a frontend constant because
 * `PendingQuestion` does not (yet) carry the flag and this set is stable/closed.
 * The cross-package guard-rail test asserts this list equals the gateway
 * `versioned: true` codes so any drift goes RED in CI.
 */
export const VERSIONED_DECISION_CODES: readonly string[] = [
  // Existing 7 (FR5).
  'service.language',
  'service.framework',
  'service.runtime',
  'db.engine',
  'db.driver',
  'ui.framework',
  'build.tool',
  // New 17 (bare-stem-UX spec).
  'db.migrations',
  'db.connectionPool',
  'validation.framework',
  'domain.mappingStrategy',
  'logging.framework',
  'metrics.framework',
  'tracing.framework',
  'ui.buildTool',
  'ui.stateManagement',
  'ui.designSystem',
  'ui.testing',
  'testing.unit',
  'testing.integration',
  'testing.e2e',
  'testing.contractTesting',
  'testing.mocking',
  'interservice.asyncBus',
];

/** True iff a decision code renders the decoupled framework+version control. */
export function isVersionedCode(decisionCode: string): boolean {
  return VERSIONED_DECISION_CODES.includes(decisionCode);
}

/**
 * Curated recommended-default version PER framework BARE STEM (FR2). Keyed by
 * the bare stem (e.g. `Java`, `Spring Boot`, `Maven`), NOT the version-laden
 * choice string — the stem is what `dedupeBareStemChoices` renders as a chip and
 * what a cascade seeds. This is the version PRE-SELECTED in the dedicated version
 * control; enrichment NEVER changes it. A stem with no entry here pre-selects
 * nothing (the architect types a free-text exact version, FR6 source (a)).
 *
 * VERSION-LESS stems (`none` / `manual` / `in-house` / `native`-style choices,
 * see `isVersionLessStem`) intentionally carry NO entry: they capture no version
 * field and render as the stem only. This is the explicit exception the
 * guard-rail allows.
 *
 * These are conservative, widely-used versions at spec-authoring time; they are
 * the offline fallback, not a guarantee — the inline Spec 4 nudge (rendered via
 * the nudge slot) is where vulnerability-driven version steering lives.
 */
export const RECOMMENDED_VERSION_BY_FRAMEWORK: Readonly<Record<string, string>> = {
  // service.language ('Java 21' + 'Java 17' collapse to one 'Java' stem).
  Java: '21.0.5',
  Kotlin: '2.0.21',
  'C#': '12.0',
  'TypeScript/Node': '20.18.0',
  Python: '3.12.7',
  Go: '1.22.8',
  // service.framework (Spring Boot default raised to 4.0 per FR2).
  'Spring Boot': '4.0',
  Quarkus: '3.17.4',
  Micronaut: '4.7.1',
  NestJS: '10.4.7',
  FastAPI: '0.115.5',
  Gin: '1.10.0',
  'ASP.NET': '8.0.11',
  // service.runtime.
  'Eclipse Temurin': '21.0.5',
  GraalVM: '21.0.5',
  'Node 20 LTS': '20.18.0',
  CPython: '3.12.7',
  'Go 1.22 alpine': '1.22.8',
  '.NET': '8.0.11',
  // db.engine.
  Postgres: '18.0',
  MySQL: '8.4.3',
  'MS SQL Server': '2022-CU15',
  Oracle: '23.6',
  'Sybase ASE': '16.0',
  MongoDB: '7.0.15',
  DynamoDB: 'latest',
  // db.migrations.
  Flyway: '10',
  Liquibase: '4',
  Mongock: '5',
  // db.connectionPool.
  HikariCP: '5',
  Agroal: '2',
  // db.driver.
  pgjdbc: '42.7.4',
  'mysql-connector-j': '9.1.0',
  'mssql-jdbc': '12.8.1',
  'oracle ojdbc11': '23.6.0.0',
  jtds: '1.3.1',
  'mongo-java-driver': '5.2.1',
  'dynamodb-enhanced': '2.29.0',
  // validation.framework.
  'Bean Validation': '3',
  'Hibernate Validator': '8',
  'class-validator': '0.14',
  'Pydantic v2': '2.9',
  // domain.mappingStrategy.
  MapStruct: '1.6',
  ModelMapper: '3',
  // ui.framework.
  React: '18.3.1',
  Vue: '3.5.13',
  Angular: '17.3.12',
  Svelte: '5.2.0',
  // ui.buildTool.
  Vite: '5',
  Webpack: '5',
  esbuild: '0.24',
  'Angular CLI': '17',
  // ui.testing.
  'Vitest + Testing Library': '2',
  'Jest + Testing Library': '29',
  'Karma + Jasmine': '6',
  Playwright: '1.48',
  // ui.stateManagement.
  'Redux Toolkit': '2',
  Zustand: '5',
  Pinia: '2',
  NgRx: '18',
  MobX: '6',
  // ui.designSystem.
  MUI: '6',
  'Ant Design': '5',
  'Chakra v3': '3.2',
  'Tailwind + headless components': '3',
  // logging.framework.
  'SLF4J + Logback JSON': '1.5',
  Log4j: '2',
  pino: '9',
  structlog: '24',
  zap: '1',
  // metrics.framework.
  Micrometer: '1.13',
  'prom-client': '15',
  'OpenTelemetry metrics': '1.27',
  // tracing.framework.
  'OpenTelemetry SDK': '1.27',
  'Spring Cloud Sleuth': '3',
  'Zipkin Brave': '6',
  // build.tool (bare-stemmed: stem + the version stated in its choice, fixing
  // the old doubled `{ framework:'Maven 3.9', version:'Maven 3.9' }` envelope).
  Gradle: '8',
  Maven: '3.9',
  'npm + tsc': '10.9.0',
  uv: '0.5.4',
  'go build': '1.22.8',
  dotnet: '8',
  // interservice.asyncBus.
  Kafka: '3.7',
  RabbitMQ: '3.13',
  'AWS SQS': 'latest',
  'Azure Service Bus': 'latest',
  // testing.unit.
  JUnit: '5',
  Vitest: '2',
  pytest: '8',
  'go test': '1.22.8',
  NUnit: '4',
  // testing.integration.
  'Spring Boot Test + Testcontainers': '3',
  'Quarkus Test': '3',
  'Vitest + Testcontainers': '2',
  'pytest + testcontainers-python': '8',
  // testing.e2e (Playwright shared with ui.testing — one entry, same default).
  Cypress: '13',
  'REST Assured': '5',
  Karate: '1.5',
  // testing.contractTesting.
  Pact: '4',
  'Spring Cloud Contract': '4',
  // testing.mocking.
  Mockito: '5',
  MockK: '1.13',
  'vi.mock': '2',
  'pytest-mock': '3',
  gomock: '1',
};

/** The recommended-default version for a framework STEM, or null when uncurated. */
export function recommendedVersionFor(framework: string): string | null {
  return RECOMMENDED_VERSION_BY_FRAMEWORK[framework] ?? null;
}

// ---------------------------------------------------------------------------
// Bare-stem dedup (FR1) — the SEAM between a question's version-LADEN `choices`
// (e.g. ['Java 21','Java 17',...]) and the BARE-STEM chip set the
// `VersionedAnswerControl` renders (['Java',...]). `ConversationMainPane` passes
// `frameworkChoices={choices}` verbatim, so this dedup must run BETWEEN the
// question's choices and the chips. Each unique stem carries its curated default
// version (or null when the stem is version-less).
// ---------------------------------------------------------------------------

/** A deduped bare-stem framework chip + its curated default version. */
export interface BareStemChoice {
  /** The bare-stem chip label (e.g. `Java`, `Spring Boot`, `Maven`, `pgjdbc`). */
  stem: string;
  /**
   * The curated default version for this stem (e.g. `4.0` for `Spring Boot`), or
   * null when the stem is version-less (`none` / `manual` / `in-house` /
   * `native`-style) — no version field, no default, chip text is the stem only.
   */
  defaultVersion: string | null;
}

/** Leading tokens that mark a genuinely VERSION-LESS stem (no version axis). */
const VERSION_LESS_STEM_PREFIXES = ['none', 'manual', 'in-house', 'native'] as const;

/**
 * True iff a chip stem is genuinely version-less — a `none` / `manual` /
 * `in-house` / `native`-style choice that carries NO version field and NO
 * curated default (Q5). Its chip text is the stem only (e.g.
 * `none-managed-by-app`, `manual mapper classes`, `native driver pool`). Reserve
 * the `(version unknown)` parenthetical for the genuine version-unknown case,
 * never for these.
 */
export function isVersionLessStem(stem: string): boolean {
  const s = stem.trim().toLowerCase();
  return VERSION_LESS_STEM_PREFIXES.some(
    (p) => s === p || s.startsWith(`${p} `) || s.startsWith(`${p}-`),
  );
}

/**
 * Derive the BARE STEM of a single version-laden choice string by stripping a
 * trailing VERSION token (a whitespace-separated final token that begins with a
 * digit, e.g. `Java 21` -> `Java`, `Spring Boot 3.4` -> `Spring Boot`,
 * `Maven 3.9` -> `Maven`, `MS SQL Server 2022` -> `MS SQL Server`). A choice with
 * no trailing numeric token is already a bare stem and is returned verbatim
 * (e.g. `pgjdbc`, `Node 20 LTS`, `Pydantic v2`, `native driver pool`), which
 * keeps it in lock-step with the gateway cascade trigger/seed keys.
 */
export function deriveBareStem(choice: string): string {
  const trimmed = choice.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return trimmed;
  const lastToken = trimmed.slice(lastSpace + 1);
  // Strip ONLY when the final token is a VERSION token (starts with a digit).
  if (/^[0-9]/.test(lastToken)) {
    return trimmed.slice(0, lastSpace).trim();
  }
  return trimmed;
}

/**
 * Collapse a question's version-laden `choices` into the deduped BARE-STEM chip
 * set the `VersionedAnswerControl` renders, preserving first-seen order. Choices
 * that split one stem across versions (e.g. `Java 21` + `Java 17`) collapse to a
 * single `Java` chip; each unique stem carries its curated default version
 * (`recommendedVersionFor`) or null when version-less.
 *
 * This is the seam consumed by the control (Group 4) AND the source of the
 * `build.tool` de-doubling: `Maven 3.9` -> `{ stem:'Maven', defaultVersion:'3.9' }`
 * so the captured value is `{ framework:'Maven', version:'3.9' }` (chip
 * `Maven 3.9`), never the old `{ framework:'Maven 3.9', version:'Maven 3.9' }`.
 */
export function dedupeBareStemChoices(
  choices: readonly string[],
): BareStemChoice[] {
  const out: BareStemChoice[] = [];
  const seen = new Set<string>();
  for (const choice of choices) {
    const stem = deriveBareStem(choice);
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push({
      stem,
      defaultVersion: isVersionLessStem(stem) ? null : recommendedVersionFor(stem),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Capture-value builder (FR5 capture half) — the EXISTING captured-decision
// envelope, built frontend-side so the versioned answer rides the unchanged
// `/capture` path with NO gateway change. The capture route stores a string
// `value` verbatim into `answer_value`, so we hand it the JSON-stringified
// envelope and pass the resolved chip as `answerText` (=> `answer_summary`).
//
// This mirrors the gateway `buildFrameworkVersionEnvelope`
// (gateway/src/config/architect-conversation/frameworkVersionShape.ts) shape
// exactly: `{ value: { framework, version }, sourceQuote, sourceFile }`.
// ---------------------------------------------------------------------------

/**
 * Build the verbatim `value` string the `/capture` endpoint persists into
 * `answer_value` for a versioned answer. `sourceQuote` / `sourceFile` default to
 * null for a manual conversation answer (Spec 3 manifest auto-answer passes the
 * manifest provenance through the same shape).
 */
export function buildFrameworkVersionCaptureValue(args: {
  framework: string;
  version: string;
  sourceQuote?: string | null;
  sourceFile?: string | null;
}): string {
  const { framework, version, sourceQuote = null, sourceFile = null } = args;
  return JSON.stringify({
    value: { framework, version },
    sourceQuote,
    sourceFile,
  });
}

// ---------------------------------------------------------------------------
// Enrichment seam (FR6 source (c)) — swappable, fail-open, NON-BLOCKING.
//
// Reuses Spec 2's egress DISCIPLINE: any real client honours HTTP(S)_PROXY +
// a custom CA, is swappable for an offline mirror, and degrades gracefully. The
// control NEVER awaits this on the critical submission path — it is consulted to
// AUGMENT the typeahead list only, after the recommended default is already
// pre-selected. A failure/timeout/empty result is non-fatal and surfaces the
// quiet "enrichment unavailable" affordance.
// ---------------------------------------------------------------------------

export interface VersionEnrichmentResult {
  /** Extra version strings to merge into the typeahead suggestion list. */
  versions: string[];
}

/**
 * A swappable version-enrichment client. Given a versioned decision code + the
 * chosen framework, returns extra candidate version strings for the typeahead.
 * MUST be non-blocking and fail-open: implementations should resolve to an empty
 * list (or reject) rather than ever block submission. The control treats a
 * rejection identically to an empty result (quiet affordance).
 */
export interface VersionEnrichmentClient {
  /**
   * Fetch extra version suggestions for `framework` under `decisionCode`. The
   * optional `signal` lets the control abort an in-flight enrichment when the
   * framework selection changes or the control unmounts.
   */
  fetchVersions(
    decisionCode: string,
    framework: string,
    signal?: AbortSignal,
  ): Promise<VersionEnrichmentResult>;
}

/**
 * The default enrichment client: a graceful OFFLINE no-op. It resolves to an
 * empty suggestion list so the control works fully offline on free-text +
 * recommended default, and surfaces the "enrichment unavailable" affordance.
 * Swap in a real proxy/CA-aware client (Spec 2 discipline) to populate the
 * typeahead; doing so NEVER changes the recommended default nor gates submission.
 */
export const offlineNoopEnrichmentClient: VersionEnrichmentClient = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchVersions(): Promise<VersionEnrichmentResult> {
    return { versions: [] };
  },
};
