/**
 * Scaffold-story DETERMINISTIC spec carriage (2026-08-14) — the application
 * bootstrap spec, assembled with NO LLM.
 *
 * The dedicated `seed_build_files` scaffold story previously generated through
 * the description-grounded LLM path (a one-line planner description) with the
 * verbatim manifest block appended afterwards. The live consequence: eleven
 * service-plane specs and NOT ONE of them asked for a runnable application —
 * the implementer received route tables into an empty repository.
 *
 * For this ONE story every input is already a literal artifact:
 *
 *   1. the CONFIRMED target build manifest (verbatim bytes — parent, language
 *      level, every dependency version, and the coordinates the main class
 *      derives from);
 *   2. the captured target-state decisions (framework, runtime, build tool,
 *      datasource, migrations, logging, testing, CI — each with a code to cite);
 *   3. the serve contract the execution driver will boot the app with
 *      (`serveSpecDefaultsFromAnswers` — the SAME derivation haibox uses).
 *
 * There is nothing missing for an LLM to supply — only opportunities to
 * paraphrase the manifest, re-pin a version, or invent a config idiom that
 * contradicts a captured decision (the exact failure class that made the
 * DB-pack review specs deterministic, Spec 2026-07-23). So the spec is
 * assembled deterministically: decision-mapped bootstrap requirements, each
 * citing its `[decision:<code>]`, with the boot acceptance criteria pinned to
 * the derived serve command. Captured free-text values ride VERBATIM into the
 * requirement text; absent decisions are LISTED as not-captured (never
 * guessed).
 */

import {
  LoadedBookOfWorkItem,
  MigrationStorySpecGenerationDto,
} from './migrationShapeSpecGenerationHandler';
import { SeedBuildFilesEnrichment } from './migrationSeedBuildFilesEnrichment';
import { TargetStateCapturedDecision } from './targetStateCapturedDecisionsClient';
import { serveSpecDefaultsFromAnswers } from './migrationServeSpecDefaults';

// ---------------------------------------------------------------------------
// Decision-value resolution — shared with the target-stack spec section
// (2026-08-14: the helpers live in migrationTargetStackSpecSection so both
// modules read decision values identically; re-exported here for callers).
// ---------------------------------------------------------------------------

import {
  architectureDecisionValues,
  buildTargetStackSpecSection,
  appendTargetStackSection,
} from './migrationTargetStackSpecSection';

export {
  architectureDecisionValues,
  resolveDecisionDisplayValue,
} from './migrationTargetStackSpecSection';

// ---------------------------------------------------------------------------
// Deterministic requirement recipes
// ---------------------------------------------------------------------------

/** One bootstrap requirement derived from captured decisions. */
interface RequirementRecipe {
  /** Codes whose PRESENCE gates the requirement (first absent → skipped). */
  needs: string[];
  /** Extra codes woven in when present (absence does not skip). */
  optional?: string[];
  render: (v: (code: string) => string | null) => string;
}

const cite = (...codes: string[]) => codes.map((c) => `[decision:${c}]`).join('');

/**
 * The decision-mapped bootstrap surface. Every line QUOTES the captured value
 * — the recipes phrase the work, the decisions supply every technology name.
 */
const BOOTSTRAP_RECIPES: RequirementRecipe[] = [
  {
    needs: ['service.framework', 'service.language', 'build.tool'],
    optional: ['service.runtime', 'service.processModel'],
    render: (v) =>
      `Create the application entry point (main class) and source layout for ` +
      `${v('service.framework')} on ${v('service.language')}` +
      (v('service.runtime') ? ` (runtime: ${v('service.runtime')})` : '') +
      `, built with ${v('build.tool')}. Derive the root package from the seeded build ` +
      `manifest's own group/artifact coordinates — NEVER invent a different package root. ` +
      `The application must compile and start with zero endpoints implemented. ` +
      cite('service.framework', 'service.language', 'build.tool'),
  },
  {
    needs: ['service.config'],
    render: (v) =>
      `Wire configuration loading per the captured decision: ${v('service.config')}. ` +
      `Configuration must load and validate at startup, BEFORE any handler registers ` +
      `(the environment-wiring foundation story extends this abstraction — create it here). ` +
      cite('service.config'),
  },
  {
    needs: ['service.healthcheck'],
    render: (v) =>
      `Expose the health surface per the captured decision: ${v('service.healthcheck')}. ` +
      `The health endpoint is the boot acceptance probe and the serve contract's readiness ` +
      `check — it must report healthy against the migrated target database. ` +
      cite('service.healthcheck'),
  },
  {
    needs: ['db.engine'],
    optional: ['db.driver', 'db.connectionPool', 'db.schemaMapping', 'db.databaseName'],
    render: (v) =>
      `Configure the datasource against the target database: ${v('db.engine')}` +
      (v('db.driver') ? `, driver ${v('db.driver')}` : '') +
      (v('db.connectionPool') ? `, pooled via ${v('db.connectionPool')}` : '') +
      `. Connection settings come from configuration (never hardcoded credentials).` +
      (v('db.schemaMapping')
        ? ` Schema naming follows the captured mapping: ${v('db.schemaMapping')}.`
        : '') +
      (v('db.databaseName')
        ? ` The DEFAULT configuration's datasource MUST point at the database named ` +
          `'${v('db.databaseName')}' — the exact database the DB plane creates and ` +
          `loads; NEVER invent a different database name. ${cite('db.databaseName')}`
        : '') +
      ` ${cite('db.engine')}`,
  },
  {
    needs: ['db.migrations'],
    render: (v) =>
      `Wire the schema-migration tool per the captured decision (${v('db.migrations')}) ` +
      `and ENABLE it: if the seeded build manifest does not yet declare the tool's ` +
      `dependency (e.g. \`org.liquibase:liquibase-core\`), ADD it — minimal entry, ` +
      `version-less where the platform BOM manages it — citing this decision; a ` +
      `migration tool that is declared in the decisions but absent from the classpath ` +
      `silently disables schema migration (\`spring.liquibase.enabled\` defaults off ` +
      `with no dependency). ` +
      `IF the repository already contains the DB plane's changelog (a run based on the ` +
      `DB Merge Request carries \`liquibase/db.changelog-master.xml\` and its ` +
      `changesets), point the tool's configuration at that EXISTING master changelog — ` +
      `NEVER create a second/parallel changelog beside it. CRITICAL for that case: the ` +
      `migration tool applies the schema to the target database OUT-OF-BAND, so the ` +
      `database has the objects but NO changelog-tracking table — boot-time migration ` +
      `against it would RE-APPLY every changeset and fail on existing objects. Provide ` +
      `and document a one-time baseline step (e.g. \`mvn liquibase:changelogSync\`) ` +
      `that records the existing changesets as applied WITHOUT executing them, and ` +
      `make the boot-time wiring safe to run only after that baseline (document the ` +
      `order in the README — never assume a fresh database). Only when the repository ` +
      `has no changelog at all (a fresh-from-main run), create an EMPTY skeleton that ` +
      `applies cleanly on boot. The DB plane owns the schema content either way. ` +
      cite('db.migrations'),
  },
  {
    needs: ['api.protocol'],
    optional: ['api.contractFormat'],
    render: (v) =>
      `Stand up the HTTP layer for the captured protocol: ${v('api.protocol')}.` +
      (v('api.contractFormat')
        ? ` Register message converters for EVERY captured payload format ` +
          `(${v('api.contractFormat')}) so interface stories inherit working ` +
          `serialization for each format.`
        : '') +
      ` ${cite('api.protocol')}`,
  },
  {
    needs: ['api.errorContract'],
    render: (v) =>
      `Create the shared error-handling skeleton implementing the captured error ` +
      `contract: ${v('api.errorContract')}. One application-wide handler; the ` +
      `serialization/error-mapping foundation story fills in the per-status mappings. ` +
      cite('api.errorContract'),
  },
  {
    needs: ['api.auth'],
    render: (v) =>
      `Create the authentication hook point for the captured scheme (${v('api.auth')}) ` +
      `as a registered-but-permissive filter/interceptor skeleton. The security/auth ` +
      `foundation story completes the enforcement — this story guarantees the seam exists. ` +
      cite('api.auth'),
  },
  {
    needs: ['dto.style'],
    optional: ['validation.framework', 'domain.mappingStrategy', 'domain.errorModel'],
    render: (v) =>
      `Establish the domain conventions in the skeleton: DTOs as ${v('dto.style')}` +
      (v('validation.framework') ? `, validated with ${v('validation.framework')}` : '') +
      (v('domain.mappingStrategy') ? `, mapped via ${v('domain.mappingStrategy')}` : '') +
      (v('domain.errorModel') ? `, errors modelled as ${v('domain.errorModel')}` : '') +
      `. Create the package homes for each so interface stories drop code into an ` +
      `established structure. ${cite('dto.style')}`,
  },
  {
    needs: ['logging.framework'],
    optional: ['logging.format'],
    render: (v) =>
      `Configure logging per the captured decisions: ${v('logging.framework')}` +
      (v('logging.format') ? ` with ${v('logging.format')} output` : '') +
      `. ${cite('logging.framework')}`,
  },
  {
    needs: ['tracing.framework'],
    optional: ['metrics.framework'],
    render: (v) =>
      `Wire observability per the captured decisions ` +
      `(tracing: ${v('tracing.framework')}` +
      (v('metrics.framework') ? `; metrics: ${v('metrics.framework')}` : '') +
      `). Prefer dependencies the seeded manifest already declares; when a captured ` +
      `decision requires one the manifest lacks, add the minimal entry citing the ` +
      `decision — never invent tooling no decision names. ` +
      cite('tracing.framework'),
  },
  {
    needs: ['testing.unit'],
    optional: ['testing.integration'],
    render: (v) =>
      `Bootstrap the test harness: ${v('testing.unit')} for unit tests` +
      (v('testing.integration') ? `, ${v('testing.integration')} for integration tests` : '') +
      `, plus ONE boot smoke test that starts the application context and asserts the ` +
      `health surface — the proof the repository has a RUNNABLE test suite from the ` +
      `first commit. ${cite('testing.unit')}`,
  },
  {
    needs: ['ci.pipeline'],
    render: (v) =>
      `Extend the repository's CI pipeline (${v('ci.pipeline')}) with build + test ` +
      `stages so every subsequent story's commit compiles and runs the suite. Keep any ` +
      `existing pipeline stages (e.g. security scanning) intact. ` +
      cite('ci.pipeline'),
  },
];

/** Codes whose absence is worth a warning (the bootstrap-critical set). */
const CRITICAL_CODES = [
  'service.framework',
  'service.language',
  'build.tool',
  'db.engine',
  'db.migrations',
  'testing.unit',
];

// ---------------------------------------------------------------------------
// Spec-text assembly
// ---------------------------------------------------------------------------

export interface ScaffoldSpecAssembly {
  text: string;
  warnings: Array<Record<string, unknown>>;
}

/**
 * Assemble the deterministic application-bootstrap spec text. `enrichmentText`
 * is the already-assembled verbatim seed-build-files block (exact-write pom /
 * package.json instructions) — embedded as the FIRST work.
 */
export function buildScaffoldBootstrapSpecText(args: {
  story: Pick<LoadedBookOfWorkItem, 'title' | 'description'>;
  enrichmentText: string;
  decisions: readonly TargetStateCapturedDecision[];
}): ScaffoldSpecAssembly {
  const { story, enrichmentText, decisions } = args;
  const byCode = architectureDecisionValues(decisions);
  const v = (code: string): string | null => byCode.get(code) ?? null;
  const warnings: Array<Record<string, unknown>> = [];

  const lines: string[] = [];
  lines.push(`# ${story.title}`);
  lines.push('');
  lines.push(
    'This spec was assembled DETERMINISTICALLY from the confirmed target build ' +
      'manifest and the captured target-state decisions. Reproduce it faithfully — ' +
      'never re-derive, substitute, upgrade, or "improve" any pinned value.'
  );
  lines.push('');
  lines.push('## Objective');
  lines.push('');
  lines.push(
    'Bootstrap the RUNNABLE target application. This is the FIRST story of the ' +
      'service plane: every later story (foundations, interface implementations, ' +
      'internal processing) implements its work INSIDE the application this story ' +
      'creates. When this story is done the repository holds a real application that ' +
      'builds and runs a green test suite (including an in-test context boot) — with ' +
      'zero business endpoints implemented yet.'
  );
  lines.push('');
  lines.push(
    '**GENERATION-TIME VERIFICATION IS STATIC + IN-TEST ONLY.** Never run the ' +
      'server as a foreground process to satisfy a criterion, and NEVER install, ' +
      'start, or configure databases, brokers, or any other infrastructure — not ' +
      'locally, not in containers outside the test suite, not anywhere. (A live ' +
      'incident: an agent stood up its own PostgreSQL cluster with trust auth to ' +
      'satisfy a runtime criterion, then wedged the job running a non-terminating ' +
      'server.) Runtime verification against the migrated target database is the ' +
      'EXECUTION DRIVER’s job at deploy time, via the registered serve ' +
      'contract — never this story’s.'
  );
  lines.push('');
  lines.push(enrichmentText.trim());
  lines.push('');

  // Decision-mapped bootstrap requirements.
  lines.push('## Application bootstrap requirements (derived from captured decisions)');
  lines.push('');
  let emitted = 0;
  for (const recipe of BOOTSTRAP_RECIPES) {
    if (recipe.needs.some((code) => v(code) === null)) continue;
    emitted += 1;
    lines.push(`${emitted}. ${recipe.render(v)}`);
  }
  if (emitted === 0) {
    lines.push(
      '_No architecture-wide technology decisions are captured yet — the seeded build ' +
        'manifest above is the only bootstrap authority. Capture the target-state ' +
        'decisions (architect conversation / target manifest upload) and regenerate ' +
        'this spec for the full requirement set._'
    );
  }
  lines.push('');

  // Acceptance criteria (2026-08-15 — STATIC + IN-TEST only): a criterion
  // that demanded a live boot "against the migrated target database" invited
  // an agent to stand up its own database and run a non-terminating server —
  // the exact live failure. Runtime boot belongs to the execution driver.
  const serve = serveSpecDefaultsFromAnswers({
    framework: v('service.framework') ?? undefined,
    language: v('service.language') ?? undefined,
    runtime: v('service.runtime') ?? undefined,
    buildTool: v('build.tool') ?? undefined,
  });
  lines.push('## Acceptance criteria');
  lines.push('');
  lines.push(
    '1. The seeded build file(s) exist at EXACTLY their stated paths and every ' +
      'entry they declared survives unchanged (same coordinates, same versions). ' +
      'Additions the requirements above demanded (each citing its ' +
      '`[decision:<code>]`) are expected and welcome — the seeded file is the ' +
      'authoritative STARTING POINT, not a freeze.'
  );
  lines.push('2. The application builds cleanly from a fresh clone.');
  lines.push(
    '3. The test suite runs green, including the boot smoke test: a Spring ' +
      'Boot Test starts the application context and asserts the health ' +
      'surface IN-TEST. If a real database is wanted in-test, use ' +
      'Testcontainers (declared in the manifest) — NEVER an external or ' +
      'hand-started database, and NEVER a live foreground server.'
  );
  lines.push('');
  if (serve.command && serve.command.trim().length > 0) {
    lines.push(
      `> Runtime verification (informational, NOT a criterion of this story): ` +
        `the execution driver boots the app at deploy time with ` +
        `\`${serve.command}\`` +
        (serve.health_path ? ` and probes \`${serve.health_path}\`` : '') +
        ` against the migrated target database. This story only has to keep ` +
        `that contract bootable — never to execute it.`
    );
    lines.push('');
  }

  lines.push('## Explicitly out of scope');
  lines.push('');
  lines.push(
    '- Business endpoints, jobs, and behaviour parity — owned by the interface / ' +
      'internal-processing stories that build on this scaffold.'
  );
  lines.push(
    '- Schema content — the DB plane owns table DDL; this story only proves the ' +
      'migration tool wiring runs.'
  );
  lines.push(
    '- Containerisation and deployment manifests — applied by the deployment flow, ' +
      'not this story.'
  );
  lines.push('');

  // Not-captured codes: listed loudly, never guessed.
  const missingCritical = CRITICAL_CODES.filter((code) => v(code) === null);
  if (missingCritical.length > 0) {
    for (const code of missingCritical) {
      warnings.push({
        code: 'DECISION_NOT_CAPTURED',
        decisionCode: code,
        message:
          `No architecture-wide '${code}' decision is captured; the corresponding ` +
          `bootstrap requirement was omitted rather than guessed.`,
      });
    }
    lines.push('## Decisions not captured (do NOT guess)');
    lines.push('');
    lines.push(
      'The following bootstrap-critical decision codes have no captured ' +
        'architecture-wide answer. Their requirements were OMITTED above — do not ' +
        'invent them; capture the decisions and regenerate this spec:'
    );
    lines.push('');
    for (const code of missingCritical) {
      lines.push(`- \`${code}\``);
    }
    lines.push('');
  }

  // The full grouped stack reference (the same section every service-plane
  // spec carries) — the bootstrap requirements above consume it; later
  // stories cite it.
  const text = appendTargetStackSection(
    lines.join('\n'),
    buildTargetStackSpecSection(decisions),
  );

  return { text, warnings };
}

// ---------------------------------------------------------------------------
// Per-story carriage entry point (mirrors the other deterministic carriages)
// ---------------------------------------------------------------------------

/**
 * Produce the scaffold story's spec-generation row. NEVER calls the LLM.
 *
 * No confirmed manifest (enrichment.text null) → HONEST `insufficient_context`
 * naming the exact remedy — the one thing this story cannot proceed without is
 * the authoritative build file.
 */
export function runScaffoldSpecCarriage(args: {
  story: LoadedBookOfWorkItem;
  baseRow: MigrationStorySpecGenerationDto;
  enrichment: SeedBuildFilesEnrichment;
  decisions: readonly TargetStateCapturedDecision[];
}): MigrationStorySpecGenerationDto {
  const { story, baseRow, enrichment, decisions } = args;

  if (!enrichment.text) {
    return {
      ...baseRow,
      status: 'insufficient_context',
      missingInputsJson: [
        {
          input: 'confirmed_target_build_manifest',
          reason:
            'No confirmed target build manifest (pom.xml / package.json) is persisted ' +
            'for this plan’s target architecture — the scaffold spec cannot pin the ' +
            'authoritative build file. Upload the target manifest on the Target State ' +
            'screen (against the SAME target architecture this plan is bound to), then ' +
            'regenerate this spec.',
        },
      ],
      errorMessage: null,
    };
  }

  const { text, warnings } = buildScaffoldBootstrapSpecText({
    story,
    enrichmentText: enrichment.text,
    decisions,
  });

  return {
    ...baseRow,
    status: warnings.length > 0 ? 'generated_with_warnings' : 'generated',
    confidence: 'high',
    generatedSpecText: text,
    warningsJson: warnings.length > 0 ? warnings : null,
    missingInputsJson: [],
    focusedContextRefsJson: {
      source: 'scaffold_bootstrap_carriage',
      manifestBlocks: enrichment.carriedCount,
      decisionCount: decisions.length,
    },
    generatedAt: new Date().toISOString(),
    errorMessage: null,
  };
}
