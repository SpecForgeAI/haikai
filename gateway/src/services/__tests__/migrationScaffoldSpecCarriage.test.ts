/**
 * Scaffold-story deterministic bootstrap carriage (2026-08-14). Pins:
 *   - the spec is assembled with NO LLM: verbatim manifest block embedded,
 *     decision-mapped bootstrap requirements each citing [decision:<code>],
 *     boot acceptance criteria pinned to the SAME serve derivation haibox uses;
 *   - captured values ride VERBATIM; absent bootstrap-critical codes are
 *     LISTED (DECISION_NOT_CAPTURED) — never guessed;
 *   - no confirmed manifest -> honest insufficient_context naming the upload
 *     remedy (the live failure: 11 specs, no runnable application).
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  architectureDecisionValues,
  buildScaffoldBootstrapSpecText,
  resolveDecisionDisplayValue,
  runScaffoldSpecCarriage,
} from '../migrationScaffoldSpecCarriage';
import { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from '../migrationShapeSpecGenerationHandler';

function decision(
  code: string,
  summary: string,
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: `d-${code}`,
    projectId: 'p1',
    targetArchitectureId: 'arch-1',
    decisionCode: code,
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: summary,
    answerSummary: summary,
    createdAt: '2026-08-01T00:00:00Z',
    createdByTask: 'architect-persona-conversation',
    ...overrides,
  };
}

const STORY = {
  id: 's-scaffold',
  title: 'Scaffold the service app and reproduce pom.xml exactly as confirmed, dependency-for-dependency.',
  description: 'seed',
} as unknown as LoadedBookOfWorkItem;

const BASE_ROW = {
  projectId: 'p1',
  workItemId: 'w-scaffold',
  bookOfWorkId: 'bow-1',
  bookItemId: 's-scaffold',
  status: 'failed',
} as MigrationStorySpecGenerationDto;

const ENRICHMENT_TEXT =
  '## SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST (do these before any other implementation)\n\n' +
  'Write `pom.xml` EXACTLY as shown at `pom.xml`.';

const FULL_DECISIONS: TargetStateCapturedDecision[] = [
  decision('service.framework', 'Spring Boot 4.0.0'),
  decision('service.language', 'Java 21'),
  decision('service.runtime', 'Eclipse Temurin 21.0.5'),
  decision('build.tool', 'Maven 3.9'),
  decision('service.config', 'Spring Cloud Config'),
  decision('service.healthcheck', 'Spring Actuator'),
  decision('db.engine', 'Postgres 18.0'),
  decision('db.driver', 'pgjdbc 42.7.4'),
  decision('db.connectionPool', 'HikariCP 5'),
  decision('db.migrations', 'Liquibase 4'),
  decision('api.protocol', 'REST over HTTP with JSON + XML payloads'),
  decision('api.contractFormat', 'Mixed JSON + XML'),
  decision('api.errorContract', 'Custom JSON error envelope'),
  decision('api.auth', 'Custom SSO'),
  decision('dto.style', 'Java records'),
  decision('validation.framework', 'Bean Validation'),
  decision('logging.framework', 'SLF4J + Logback JSON 1.5'),
  decision('tracing.framework', 'OpenTelemetry SDK 1.27'),
  decision('testing.unit', 'JUnit 5'),
  decision('testing.integration', 'Spring Boot Test + Testcontainers 3'),
  decision('ci.pipeline', 'GitLab CI'),
];

describe('resolveDecisionDisplayValue', () => {
  it('prefers answerSummary, unwraps envelopes, falls back verbatim', () => {
    expect(resolveDecisionDisplayValue(decision('x', 'Summary'))).toBe('Summary');
    expect(
      resolveDecisionDisplayValue(
        decision('x', '', {
          answerSummary: null,
          answerValue: JSON.stringify({ value: 'Envelope value' }),
        }),
      ),
    ).toBe('Envelope value');
    expect(
      resolveDecisionDisplayValue(
        decision('x', '', {
          answerSummary: null,
          answerValue: JSON.stringify({ value: { framework: 'Spring Boot', version: '4.0.0' } }),
        }),
      ),
    ).toBe('Spring Boot 4.0.0');
    expect(
      resolveDecisionDisplayValue(
        decision('x', '', { answerSummary: null, answerValue: 'raw text' }),
      ),
    ).toBe('raw text');
  });

  it('architectureDecisionValues ignores scoped overrides', () => {
    const map = architectureDecisionValues([
      decision('db.engine', 'Postgres 18.0'),
      decision('db.engine', 'Scoped override', {
        scopeKind: 'element',
        scopeRefId: 'el-1',
        scopeRefType: 'physical_data_entity',
      }),
    ]);
    expect(map.get('db.engine')).toBe('Postgres 18.0');
  });
});

describe('buildScaffoldBootstrapSpecText', () => {
  it('assembles the bootstrap spec: manifest block + cited requirements + boot acceptance', () => {
    const { text, warnings } = buildScaffoldBootstrapSpecText({
      story: STORY,
      enrichmentText: ENRICHMENT_TEXT,
      decisions: FULL_DECISIONS,
    });

    // Verbatim manifest block embedded.
    expect(text).toContain('SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST');
    // Decision-mapped requirements quote the captured values and cite codes.
    expect(text).toContain('Spring Boot 4.0.0 on Java 21');
    expect(text).toContain('[decision:service.framework]');
    expect(text).toContain('Postgres 18.0');
    expect(text).toContain('Liquibase 4');
    expect(text).toContain('Mixed JSON + XML');
    expect(text).toContain('Custom JSON error envelope');
    expect(text).toContain('[decision:ci.pipeline]');
    // The main class derives its package from the manifest's own coordinates.
    expect(text).toContain("group/artifact coordinates");
    // 2026-08-15: acceptance is STATIC + IN-TEST only. The old criterion
    // demanded a live boot "against the migrated target database" — an agent
    // stood up its own PostgreSQL cluster and ran a non-terminating server
    // to satisfy it. The serve contract is INFORMATIONAL, never a criterion.
    expect(text).toContain('GENERATION-TIME VERIFICATION IS STATIC + IN-TEST ONLY');
    expect(text).toContain('NEVER install');
    expect(text).toContain('boot smoke test');
    expect(text).toContain('IN-TEST');
    expect(text).toContain('Testcontainers');
    expect(text).toContain('Runtime verification (informational, NOT a criterion');
    expect(text).toContain('`mvn spring-boot:run`'); // informational serve note
    expect(text).toContain('/actuator/health');
    // The criteria list itself carries NO live-boot demand.
    const criteria = text.slice(
      text.indexOf('## Acceptance criteria'),
      text.indexOf('> Runtime verification')
    );
    expect(criteria).not.toContain('boots the application');
    expect(criteria).not.toContain('migrated target database');
    // MR-base Liquibase safety: pre-applied schema needs a changelogSync
    // baseline, never a boot-time re-apply.
    expect(text).toContain('changelogSync');
    expect(text).toContain('OUT-OF-BAND');
    // 2026-08-16: the migration tool must be ADDED + ENABLED when the seeded
    // manifest lacks it (live failure: decision said Liquibase, pom never
    // declared liquibase-core, spring.liquibase.enabled stayed off, nothing
    // could migrate) — and the pom wording is starting-point, never a freeze.
    expect(text).toContain('org.liquibase:liquibase-core');
    expect(text).toContain('spring.liquibase.enabled');
    expect(text).toContain('ADD it');
    expect(text).toContain('STARTING POINT, not a freeze');
    expect(text).not.toContain('NEVER add a dependency beyond the manifest');
    // Nothing missing → no warnings.
    expect(warnings).toEqual([]);
    expect(text).not.toContain('Decisions not captured');
  });

  it('lists absent bootstrap-critical codes instead of guessing', () => {
    const { text, warnings } = buildScaffoldBootstrapSpecText({
      story: STORY,
      enrichmentText: ENRICHMENT_TEXT,
      decisions: [
        decision('service.framework', 'Spring Boot 4.0.0'),
        decision('service.language', 'Java 21'),
        decision('build.tool', 'Maven 3.9'),
      ],
    });
    expect(text).toContain('Decisions not captured (do NOT guess)');
    expect(text).toContain('- `db.engine`');
    expect(text).toContain('- `db.migrations`');
    expect(text).toContain('- `testing.unit`');
    const codes = warnings.map((w) => w.decisionCode);
    expect(codes).toEqual(expect.arrayContaining(['db.engine', 'db.migrations', 'testing.unit']));
    expect(warnings.every((w) => w.code === 'DECISION_NOT_CAPTURED')).toBe(true);
  });

  it('makes the external-configuration toggle MANDATORY: optional import, off by default, env overrides (2026-09-06)', () => {
    const { text } = buildScaffoldBootstrapSpecText({
      story: STORY,
      enrichmentText: ENRICHMENT_TEXT,
      decisions: FULL_DECISIONS,
    });
    // Live failure: a scaffold-less build re-derived the config wiring and
    // chose fail-fast (a config-server import with `optional:` omitted and a
    // URI the environment did not have) -- the app threw at startup and the
    // deploy failed after a clean push + MR. The shape that works was already
    // in the pushed scaffold; it is now a stated requirement, not a judgement.
    const configReq = text.slice(
      text.indexOf('Wire configuration loading'),
      text.indexOf('[decision:service.config]'),
    );
    expect(configReq.length).toBeGreaterThan(0);
    expect(configReq).toContain('MUST be wired behind a boolean toggle');
    expect(configReq).toContain('defaults to OFF (disabled)');
    expect(configReq).toContain('import MUST be optional');
    expect(configReq).toContain('Spring Cloud Config server is reachable');
    expect(configReq).toContain('enabled=false, and a localhost URI');
    expect(configReq).toContain('HARD-FAILS on an unreachable configuration server is a defect');
  });

  it('demands app-wide 404 mapping for unmatched paths in the error skeleton (2026-08-17)', () => {
    const { text } = buildScaffoldBootstrapSpecText({
      story: STORY,
      enrichmentText: ENRICHMENT_TEXT,
      decisions: FULL_DECISIONS,
    });
    // Live failure: a browser's automatic /favicon.ico probe reached the
    // migrated app's catch-all advice and logged an ERROR "Unhandled error"
    // stack trace. The error-contract requirement must place the skeleton in
    // ONE app-wide @RestControllerAdvice and register a specific
    // NoResourceFoundException handler in that SAME class.
    expect(text).toContain('@RestControllerAdvice');
    expect(text).toContain('NoResourceFoundException');
    expect(text).toContain('/favicon.ico');
    expect(text).toContain('SAME advice class');
    expect(text).toContain('MUST NOT swallow');
    // And the acceptance criteria VERIFY it — an unmatched path returns 404,
    // never a 500 or an ERROR-level unhandled log.
    const criteria = text.slice(
      text.indexOf('## Acceptance criteria'),
      text.indexOf('> Runtime verification'),
    );
    expect(criteria).toContain('unmatched path');
    expect(criteria).toContain('returns 404');
    expect(criteria).toContain('never a 500');
  });

  it('cites the operator-chosen target database name in the datasource requirement (2026-08-17)', () => {
    const { text } = buildScaffoldBootstrapSpecText({
      story: STORY,
      enrichmentText: ENRICHMENT_TEXT,
      decisions: [...FULL_DECISIONS, decision('db.databaseName', 'acme_core')],
    });
    // The default configuration must point at the EXACT database the DB
    // plane creates — the spec names it and cites the decision.
    expect(text).toContain("database named 'acme_core'");
    expect(text).toContain('NEVER invent a different database name');
    expect(text).toContain('[decision:db.databaseName]');
  });
});

describe('runScaffoldSpecCarriage', () => {
  it('generates deterministically when the manifest block resolves', () => {
    const row = runScaffoldSpecCarriage({
      story: STORY,
      baseRow: BASE_ROW,
      enrichment: { text: ENRICHMENT_TEXT, carriedCount: 1, skipped: [] },
      decisions: FULL_DECISIONS,
    });
    expect(row.status).toBe('generated');
    expect(row.confidence).toBe('high');
    expect(row.generatedSpecText).toContain('Bootstrap the RUNNABLE target application');
    expect(row.missingInputsJson).toEqual([]);
    expect(row.focusedContextRefsJson).toMatchObject({
      source: 'scaffold_bootstrap_carriage',
      manifestBlocks: 1,
    });
  });

  it('downgrades to generated_with_warnings when critical decisions are uncaptured', () => {
    const row = runScaffoldSpecCarriage({
      story: STORY,
      baseRow: BASE_ROW,
      enrichment: { text: ENRICHMENT_TEXT, carriedCount: 1, skipped: [] },
      decisions: [],
    });
    expect(row.status).toBe('generated_with_warnings');
    expect(Array.isArray(row.warningsJson)).toBe(true);
  });

  it('returns HONEST insufficient_context naming the upload remedy when no manifest exists', () => {
    const row = runScaffoldSpecCarriage({
      story: STORY,
      baseRow: BASE_ROW,
      enrichment: { text: null, carriedCount: 0, skipped: [] },
      decisions: FULL_DECISIONS,
    });
    expect(row.status).toBe('insufficient_context');
    const missing = row.missingInputsJson as Array<Record<string, unknown>>;
    expect(missing[0].input).toBe('confirmed_target_build_manifest');
    expect(String(missing[0].reason)).toContain('Upload the target manifest');
    expect(String(missing[0].reason)).toContain('SAME target architecture');
  });
});
