/**
 * Version-control configuration + enrichment seam — Target-conversation
 * tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR5 / FR6 / FR8).
 *
 * PURE DATA + a SWAPPABLE, FAIL-OPEN enrichment-client interface. No network
 * calls happen in this module; the default enrichment client is a graceful
 * no-op so the version control is FULLY USABLE OFFLINE on free-text +
 * recommended default. A host (or a future Spec 2-style proxy/CA-aware client)
 * swaps in a real client to AUGMENT the typeahead suggestion list only.
 */

/**
 * The seven `versioned` decision codes (FR5). Each renders the decoupled
 * framework+version control instead of plain single-select chips. Mirrors the
 * gateway `QuestionLibraryEntry.versioned === true` set exactly; kept as a
 * frontend constant because `PendingQuestion` does not (yet) carry the flag and
 * this set is stable/closed.
 */
export const VERSIONED_DECISION_CODES: readonly string[] = [
  'service.language',
  'service.framework',
  'service.runtime',
  'db.engine',
  'db.driver',
  'ui.framework',
  'build.tool',
];

/** True iff a decision code renders the decoupled framework+version control. */
export function isVersionedCode(decisionCode: string): boolean {
  return VERSIONED_DECISION_CODES.includes(decisionCode);
}

/**
 * Curated recommended-default version PER framework chip (FR6 source (b)). Keyed
 * by the exact framework choice string from `questionLibrary.ts`. This is the
 * version PRE-SELECTED in the dedicated version control; enrichment NEVER changes
 * it. A framework with no entry here pre-selects nothing (the architect types a
 * free-text exact version, FR6 source (a)).
 *
 * These are conservative, widely-used patch versions at spec-authoring time;
 * they are the offline fallback, not a guarantee — the inline Spec 4 nudge
 * (rendered via the nudge slot) is where vulnerability-driven version steering
 * lives.
 */
export const RECOMMENDED_VERSION_BY_FRAMEWORK: Readonly<Record<string, string>> = {
  // service.language
  'Java 21': '21.0.5',
  'Java 17': '17.0.13',
  'Kotlin 2.0': '2.0.21',
  'C# 12': '12.0',
  'TypeScript/Node 20': '20.18.0',
  'Python 3.12': '3.12.7',
  'Go 1.22': '1.22.8',
  // service.framework
  'Spring Boot 3.4': '3.4.1',
  'Quarkus 3': '3.17.4',
  'Micronaut 4': '4.7.1',
  'NestJS 10': '10.4.7',
  'FastAPI 0.115': '0.115.5',
  'Gin 1.10': '1.10.0',
  'ASP.NET 8': '8.0.11',
  // service.runtime
  'Eclipse Temurin 21': '21.0.5',
  'GraalVM 21': '21.0.5',
  'Node 20 LTS': '20.18.0',
  'CPython 3.12-slim': '3.12.7',
  'Go 1.22 alpine': '1.22.8',
  '.NET 8': '8.0.11',
  // db.engine
  'Postgres 18': '18.0',
  'MySQL 8.4': '8.4.3',
  'MS SQL Server 2022': '2022-CU15',
  'Oracle 23ai': '23.6',
  'Sybase ASE 16': '16.0',
  'MongoDB 7': '7.0.15',
  DynamoDB: 'latest',
  // db.driver
  pgjdbc: '42.7.4',
  'mysql-connector-j': '9.1.0',
  'mssql-jdbc': '12.8.1',
  'oracle ojdbc11': '23.6.0.0',
  jtds: '1.3.1',
  'mongo-java-driver': '5.2.1',
  'dynamodb-enhanced': '2.29.0',
  // ui.framework
  'React 18': '18.3.1',
  'Vue 3': '3.5.13',
  'Angular 17': '17.3.12',
  'Svelte 5': '5.2.0',
  // build.tool
  'Gradle 8': '8.11.1',
  'Maven 3.9': '3.9.9',
  'npm + tsc': '10.9.0',
  uv: '0.5.4',
  'go build': '1.22.8',
  'dotnet 8': '8.0.404',
};

/** The recommended-default version for a framework chip, or null when uncurated. */
export function recommendedVersionFor(framework: string): string | null {
  return RECOMMENDED_VERSION_BY_FRAMEWORK[framework] ?? null;
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
