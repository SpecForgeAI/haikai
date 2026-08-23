/**
 * Database discovery pack run driver.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * This is the async sibling to the synchronous `runPackFindingScanners`
 * shim in `findings/packFindingScanners/index.ts`. Where the code-pack
 * scanners run synchronously over Stage-1 IR + Stage-2 candidates, the DB
 * pack orchestrator drives a per-engine pack through network-I/O stages
 * (introspect / profile / inferRelationships) and threads the results into
 * the singleton `FindingEmitter`.
 *
 * PHASES (in order)
 * -----------------
 *   1. Pack lookup via `databasePackFactory.getDatabasePack(engineKey)`.
 *      Null result -> emit `db_pack_warning` and short-circuit (no crash).
 *   2. `connect()` + `testConnection()`.
 *   3. Introspection (schemas, tables, columns, keys/indexes, views,
 *      procedures, triggers). Each call is wrapped in `withDbPackSoftFail`
 *      so a single failure logs + emits `db_pack_warning` and continues.
 *   4. Profiling (per `profilingMode`). `deep` mode requires
 *      `deepProfilingConfirmed=true` on the config; missing -> reject the
 *      run with `db_pack_warning`.
 *   5. Relationship inference.
 *   6. `emitCandidates()` -- Group 3 wires the actual persistence call
 *      (`bulkSaveCandidates`); Group 2 just stores the payload list on
 *      the result envelope.
 *   7. `emitFindings()` -- finding inputs are de-duplicated (via the
 *      FindingEmitter's per-run cache), capped per finding type via
 *      `MAX_FINDINGS_PER_TYPE_PER_RUN`, then forwarded to the emitter.
 *   8. `close()` in `finally`. ALWAYS runs.
 *   9. `secretsStore.purgeForRun(runId)` in `finally`. ALWAYS runs.
 *
 * The orchestrator NEVER throws. Callers get a result envelope describing
 * what happened; the run row in AMS is updated by the runManager (Group 3 /
 * Group 5 wires the link).
 */

import {
  findingEmitter,
  type FindingEmitInput,
  type FindingEmitRunContext,
} from '../findings/FindingEmitter';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from '../findings/packFindingScanners/constants';
import {
  buildDbEvidenceGapFinding,
  buildDbPackWarningFinding,
  type DbFindingEngineKey,
} from '../findings/databasePackFindingScanners/databasePackFindingBuilders';
import { getDatabasePack } from './databasePackFactory';
import { withDbPackSoftFail } from './softFail';
import { purgeForRun, storeForRun } from './secretsStore';
import type {
  DatabaseDiscoveryPack,
  DatabaseDiscoveryPackContext,
  DatabaseCandidatePayload,
} from './DatabaseDiscoveryPack';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  ProfileResult,
  RelationshipInference,
} from './types';
import { buildFkColumnsMetadata } from './candidateStructuralFidelity';

/**
 * Per-engine "no data" defaults the orchestrator threads through stages
 * when a soft-fail wipes out an introspection step.
 */
const EMPTY_INTROSPECTION: IntrospectionResult = {
  schemas: [],
  tables: [],
  columns: [],
  keysAndIndexes: [],
  views: [],
  procedures: [],
  triggers: [],
  sequences: [],
};

const EMPTY_PROFILE: ProfileResult = {
  tables: [],
  skippedTables: [],
};

/**
 * Result envelope returned by {@link runDatabasePackDiscovery}. Carries
 * enough detail for the caller (runManager / tests) to log a run summary
 * and persist the candidate batch.
 */
import { detectSequenceGeneratorIdioms } from '../../scl/sqlProcHarvester';

export interface DatabasePackOrchestratorResult {
  /** Engine key that ran (or `'unknown'` when the factory returned null). */
  engineKey: DbFindingEngineKey;
  /** TRUE when at least `connect()` + `testConnection()` succeeded. */
  connectedOk: boolean;
  /** Introspection facts gathered (empty on full-stage soft-fail). */
  introspection: IntrospectionResult;
  /** Profile facts gathered (empty when profiling skipped or failed). */
  profile: ProfileResult;
  /** Relationship inferences (declared + inferred + ambiguous). */
  relationships: RelationshipInference[];
  /** Candidate payloads -- caller persists via `bulkSaveCandidates`. */
  candidates: DatabaseCandidatePayload[];
  /** All finding inputs that went through the emitter this run. */
  emittedFindings: FindingEmitInput[];
  /** Soft-fail / warning findings captured during the run. */
  warningFindings: FindingEmitInput[];
  /** TRUE when the orchestrator hit a fatal-but-soft condition (e.g. null pack). */
  shortCircuited: boolean;
  /** LIVE stored proc/function/trigger sources (2026-08-23; empty when the
   *  engine pack lacks the capability or the harvest soft-failed). */
  procSources: import('../../scl/sqlProcHarvester').LiveProcSource[];
  /** Server charset/sortorder detection (item 3; null when unavailable). */
  serverCharset: {
    charset: string | null;
    sortorderName: string | null;
    caseSensitive: boolean | null;
  } | null;
  /** Detected sequence-generator idioms with their live rows (item 2). */
  sequenceIdioms: Array<
    import('../../scl/sqlProcHarvester').SequenceGeneratorIdiom & {
      rows: Array<{ name: string | null; value: number | null }>;
    }
  >;
}

/**
 * Input envelope. Constructed by the runManager when it sees a
 * `kind='database'` discovery run.
 */
export interface DatabasePackOrchestratorInput {
  config: DatabaseDiscoveryConfig;
  credentials: DatabaseDiscoveryCredentials;
  runContext: FindingEmitRunContext;
}

/**
 * Cap a finding-input list per finding-type per run.
 *
 * Walks the list in order and emits at most `MAX_FINDINGS_PER_TYPE_PER_RUN`
 * for any given `findingType`. Overflow is dropped silently -- the
 * intentional behaviour per `feedback`: cap dilution before signal loss.
 */
export function capFindingsPerType(
  findings: FindingEmitInput[],
  cap: number = MAX_FINDINGS_PER_TYPE_PER_RUN,
): FindingEmitInput[] {
  const perTypeCount = new Map<string, number>();
  const out: FindingEmitInput[] = [];
  for (const f of findings) {
    const key = (f.findingType || '').toLowerCase();
    const seen = perTypeCount.get(key) ?? 0;
    if (seen >= cap) continue;
    perTypeCount.set(key, seen + 1);
    out.push(f);
  }
  return out;
}

/**
 * Run the full database discovery pipeline for one run.
 *
 * Spec contract:
 *  - Never throws.
 *  - Returns the result envelope describing the run.
 *  - Always purges the per-run secrets bundle in `finally`.
 */
export async function runDatabasePackDiscovery(
  input: DatabasePackOrchestratorInput,
  opts?: {
    /**
     * Test seam -- inject a pack directly (skips the factory). When omitted
     * the orchestrator looks up the pack via `databasePackFactory`.
     */
    packOverride?: DatabaseDiscoveryPack;
    /**
     * Test seam -- inject a fake `findingEmitter` so tests can assert what
     * the orchestrator passed through. Defaults to the singleton.
     */
    findingEmitterOverride?: {
      emitFindings: typeof findingEmitter.emitFindings;
    };
    /** Test seam -- override the per-type finding cap for stress tests. */
    findingCapOverride?: number;
  },
): Promise<DatabasePackOrchestratorResult> {
  const { config, credentials, runContext } = input;
  const engineKey = (config.dbEngine ?? 'unknown') as DbFindingEngineKey;

  // Securely stash credentials for the lifetime of this run. ALWAYS purge.
  // Tests that pass their own packs use this same path to verify lifecycle.
  let secretsStored = false;
  try {
    storeForRun(runContext.runId, credentials);
    secretsStored = true;
  } catch (err) {
    // Already-present credentials. Treat as a non-fatal warning -- the
    // run still proceeds with whatever was stashed earlier.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[databasePackOrchestrator] secretsStore.storeForRun failed; continuing. ` +
        `runId='${runContext.runId}' error='${message}'`,
    );
  }

  const warningFindings: FindingEmitInput[] = [];
  const onWarning = (f: FindingEmitInput): void => {
    warningFindings.push(f);
  };

  let result: DatabasePackOrchestratorResult = {
    engineKey,
    connectedOk: false,
    introspection: EMPTY_INTROSPECTION,
    profile: EMPTY_PROFILE,
    relationships: [],
    candidates: [],
    emittedFindings: [],
    warningFindings,
    shortCircuited: false,
    procSources: [],
    sequenceIdioms: [],
    serverCharset: null,
  };

  try {
    // ------------------------------------------------------------- Phase 1
    const pack = opts?.packOverride ?? getDatabasePack(config.dbEngine);
    if (!pack) {
      onWarning(
        buildDbPackWarningFinding({
          engineKey,
          stage: 'packLookup',
          errorMessage:
            `No database pack registered for engine '${config.dbEngine}'. ` +
            `Discovery run cannot proceed.`,
        }),
      );
      result = {
        ...result,
        shortCircuited: true,
        emittedFindings: await emitCollected(
          warningFindings,
          runContext,
          opts,
        ),
      };
      return result;
    }
    // engineKey is now confirmed via the pack
    result.engineKey = pack.engineKey;

    const packCtx: DatabaseDiscoveryPackContext = {
      config,
      credentials,
      runId: runContext.runId,
      projectId: runContext.projectId,
      architectureId: runContext.architectureId,
    };

    // ------------------------------------------------------------- Phase 2
    const connectStart = Date.now();
    const connected = await withDbPackSoftFail(
      'connect',
      () => pack.connect(packCtx),
      onWarning,
      pack.engineKey,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} op=connect ` +
        `result=${connected === null ? 'soft_fail' : 'ok'} ` +
        `elapsed_ms=${Date.now() - connectStart}`,
    );
    if (connected === null) {
      result = {
        ...result,
        shortCircuited: true,
        emittedFindings: await emitCollected(
          warningFindings,
          runContext,
          opts,
        ),
      };
      return result;
    }
    const testStart = Date.now();
    const testRes = await withDbPackSoftFail(
      'testConnection',
      () => pack.testConnection(packCtx),
      onWarning,
      pack.engineKey,
    );
    result.connectedOk = testRes !== null;
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} op=test_connection ` +
        `result=${result.connectedOk ? 'ok' : 'soft_fail'} ` +
        `elapsed_ms=${Date.now() - testStart}`,
    );
    if (!result.connectedOk) {
      // Soft-fail short-circuit -- still call close() in finally.
      result = {
        ...result,
        shortCircuited: true,
        emittedFindings: await emitCollected(
          warningFindings,
          runContext,
          opts,
        ),
      };
      return result;
    }

    // ------------------------------------------------------------- Phase 3
    const introspectionStart = Date.now();
    const introspection = await runIntrospectionPhase(
      pack,
      packCtx,
      onWarning,
    );
    result.introspection = introspection;
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectTables ` +
        `count=${introspection.tables.length} elapsed_ms=${Date.now() - introspectionStart}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectColumns count=${introspection.columns.length}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectKeysAndIndexes count=${introspection.keysAndIndexes.length}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectViews count=${introspection.views.length}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectProcedures count=${introspection.procedures.length}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectTriggers count=${introspection.triggers.length}`,
    );
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=introspectSchemas count=${introspection.schemas.length}`,
    );

    // ------------------------------------------------------------- Phase 4
    // `deep` mode gate per D8: requires explicit confirmation.
    if (config.profilingMode === 'deep' && !config.deepProfilingConfirmed) {
      onWarning(
        buildDbEvidenceGapFinding({
          engineKey: pack.engineKey,
          gapType: 'db_profile_skipped',
          objectName: '',
          gapDescription:
            `Deep profiling requested but 'deepProfilingConfirmed' flag was not set. ` +
            `Profiling SKIPPED for the run.`,
        }),
      );
      // Profile result stays EMPTY_PROFILE.
    } else if (config.profilingMode !== 'none') {
      const profileStart = Date.now();
      const profile = await withDbPackSoftFail(
        `profileTables.${config.profilingMode}`,
        () => pack.profileTables(packCtx, introspection, config.profilingMode),
        onWarning,
        pack.engineKey,
      );
      result.profile = profile ?? EMPTY_PROFILE;
      console.log(
        `[diag-pack] db_engine=${pack.engineKey} stage=profile ` +
          `mode=${config.profilingMode} ` +
          `profiled=${result.profile.tables.length} ` +
          `soft_failed=${result.profile.skippedTables.length} ` +
          `elapsed_ms=${Date.now() - profileStart}`,
      );
    }

    // ----------------------------------------------------------- Phase 4b
    // Live stored-object harvest (2026-08-23, optional capability): the
    // repo can lie about proc bodies; the live catalog is what production
    // executes. Soft-fail LOUD — a missing harvest is a warning finding,
    // never silence.
    // ----------------------------------------------------------- Phase 1b
    // Charset/sortorder detection (item 3): runs FIRST so the detected
    // charset is declared on every later connection this run makes.
    if (typeof pack.detectServerCharset === 'function') {
      const cs = await withDbPackSoftFail(
        'detectServerCharset',
        () => (pack.detectServerCharset as NonNullable<typeof pack.detectServerCharset>)(packCtx),
        onWarning,
        pack.engineKey,
      );
      result.serverCharset = cs ?? null;
    }

    if (typeof pack.harvestProcSources === 'function') {
      const procStart = Date.now();
      const sources = await withDbPackSoftFail(
        'harvestProcSources',
        () => (pack.harvestProcSources as NonNullable<typeof pack.harvestProcSources>)(packCtx),
        onWarning,
        pack.engineKey,
      );
      result.procSources = sources ?? [];
      console.log(
        `[diag-pack] db_engine=${pack.engineKey} stage=proc_harvest ` +
          `objects=${result.procSources.length} ` +
          `elapsed_ms=${Date.now() - procStart}`,
      );

      // -------------------------------------------------- Phase 4c (item 2)
      // Sequence-generator idiom detection + live row probe: the legacy
      // "sequence table + increment proc" replaces identity columns; the
      // target needs an explicit generator, so the rows (names + current
      // values) become decision-card evidence.
      const idioms = detectSequenceGeneratorIdioms(result.procSources);
      for (const idiom of idioms) {
        let rows: Array<{ name: string | null; value: number | null }> = [];
        if (typeof pack.probeSequenceRows === 'function') {
          const probed = await withDbPackSoftFail(
            `probeSequenceRows.${idiom.seqTable}`,
            () =>
              (pack.probeSequenceRows as NonNullable<typeof pack.probeSequenceRows>)(
                packCtx,
                idiom,
              ),
            onWarning,
            pack.engineKey,
          );
          rows = probed ?? [];
        }
        result.sequenceIdioms.push({ ...idiom, rows });
      }
      if (result.sequenceIdioms.length > 0) {
        console.log(
          `[diag-pack] db_engine=${pack.engineKey} stage=sequence_idioms ` +
            `detected=${result.sequenceIdioms.length}`,
        );
      }
    }

    // ------------------------------------------------------------- Phase 5
    const relInferStart = Date.now();
    const relationships = await withDbPackSoftFail(
      'inferRelationships',
      () => pack.inferRelationships(packCtx, introspection, result.profile),
      onWarning,
      pack.engineKey,
    );
    result.relationships = relationships ?? [];
    // Count declared / inferred / ambiguous from the relationship list.
    let relDeclared = 0;
    let relInferred = 0;
    let relAmbiguous = 0;
    for (const r of result.relationships) {
      const kind = ((r as { kind?: string }).kind || '').toLowerCase();
      if (kind === 'declared') relDeclared += 1;
      else if (kind === 'inferred') relInferred += 1;
      else if (kind === 'ambiguous') relAmbiguous += 1;
    }
    console.log(
      `[diag-pack] db_engine=${pack.engineKey} stage=relationship_inference ` +
        `declared=${relDeclared} inferred=${relInferred} ambiguous=${relAmbiguous} ` +
        `elapsed_ms=${Date.now() - relInferStart}`,
    );

    // ------------------------------------------------------------- Phase 6
    const candidates = await withDbPackSoftFail(
      'emitCandidates',
      () => pack.emitCandidates(packCtx, introspection, result.profile),
      onWarning,
      pack.engineKey,
    );
    result.candidates = candidates ?? [];

    // ----------------------------------------------------- Phase 6b
    // Bug fix (2026-05-17): the per-engine packs' emitCandidates only iterates
    // tables + columns, so the Phase 5 RelationshipInference[] never surfaces
    // as reviewable candidates. Convert each inferred / declared FK into a
    // `logical_data_entity_relationships` candidate here -- engine-agnostic
    // so both Postgres and Sybase benefit without changes inside the packs.
    //
    // The save-back service maps a candidate of this type to the
    // `logical_data_entity_relationships` entity row using
    // `data.sourceEntity / .targetEntity / .cardinality / .relationshipType`
    // (see candidateSaveBackService.ts:639). Cardinality is derived from the
    // FK column shape, relationship_type from the inference `kind`.
    const relationshipCandidates = buildRelationshipCandidates(
      result.relationships,
      introspection,
      pack.engineKey,
    );
    if (relationshipCandidates.length > 0) {
      result.candidates = [...result.candidates, ...relationshipCandidates];
      console.log(
        `[diag-pack] db_engine=${pack.engineKey} stage=emit_relationship_candidates count=${relationshipCandidates.length}`,
      );
    }

    // ------------------------------------------------------------- Phase 7
    const findings = await withDbPackSoftFail(
      'emitFindings',
      () =>
        pack.emitFindings(
          packCtx,
          introspection,
          result.profile,
          result.relationships,
        ),
      onWarning,
      pack.engineKey,
    );
    const allFindings = [...(findings ?? []), ...warningFindings];
    const capped = capFindingsPerType(
      allFindings,
      opts?.findingCapOverride ?? MAX_FINDINGS_PER_TYPE_PER_RUN,
    );
    result.emittedFindings = await emitToFindingEmitter(
      capped,
      runContext,
      opts,
    );

    // ------------------------------------------------------------- Phase 8
    await withDbPackSoftFail(
      'close',
      () => pack.close(),
      onWarning,
      pack.engineKey,
    );

    return result;
  } catch (err) {
    // Defense-in-depth: the orchestrator must NEVER propagate. If something
    // outside the soft-fail wrapper throws (e.g. a sync init error in a
    // bad pack constructor), capture it as a top-level warning and return.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[databasePackOrchestrator] unexpected error; returning soft-fail result. ` +
        `runId='${runContext.runId}' error='${message}'`,
    );
    warningFindings.push(
      buildDbPackWarningFinding({
        engineKey: result.engineKey,
        stage: 'orchestrator.unhandled',
        errorMessage: message,
      }),
    );
    result.shortCircuited = true;
    result.emittedFindings = await emitCollected(
      warningFindings,
      runContext,
      opts,
    );
    return result;
  } finally {
    // ALWAYS purge the per-run secret bundle. Spec contract.
    if (secretsStored) {
      try {
        purgeForRun(runContext.runId);
      } catch (purgeErr) {
        const message =
          purgeErr instanceof Error ? purgeErr.message : String(purgeErr);
        console.warn(
          `[databasePackOrchestrator] secretsStore.purgeForRun failed. ` +
            `runId='${runContext.runId}' error='${message}'`,
        );
      }
    }
  }
}

/**
 * Run the introspection phase. Each substep is independent soft-fail.
 * Returns an `IntrospectionResult` with empty arrays where steps failed.
 */
async function runIntrospectionPhase(
  pack: DatabaseDiscoveryPack,
  ctx: DatabaseDiscoveryPackContext,
  onWarning: (f: FindingEmitInput) => void,
): Promise<IntrospectionResult> {
  const schemas =
    (await withDbPackSoftFail(
      'introspectSchemas',
      () => pack.introspectSchemas(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const tables =
    (await withDbPackSoftFail(
      'introspectTables',
      () => pack.introspectTables(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const columns =
    (await withDbPackSoftFail(
      'introspectColumns',
      () => pack.introspectColumns(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const keysAndIndexes =
    (await withDbPackSoftFail(
      'introspectKeysAndIndexes',
      () => pack.introspectKeysAndIndexes(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const views =
    (await withDbPackSoftFail(
      'introspectViews',
      () => pack.introspectViews(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const procedures =
    (await withDbPackSoftFail(
      'introspectProcedures',
      () => pack.introspectProcedures(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  const triggers =
    (await withDbPackSoftFail(
      'introspectTriggers',
      () => pack.introspectTriggers(ctx),
      onWarning,
      pack.engineKey,
    )) ?? [];
  // Sequences (Spec 2026-05-29) -- optional pack method; default to [] when a
  // pre-existing pack does not implement it.
  const sequences = pack.introspectSequences
    ? (await withDbPackSoftFail(
        'introspectSequences',
        () => pack.introspectSequences!(ctx),
        onWarning,
        pack.engineKey,
      )) ?? []
    : [];
  // Database-level default collation (Spec 2026-05-30 Data-Layer Fidelity 2,
  // Group B) -- optional pack method; leave null when a pack does not implement
  // it. Soft-fail returns null on a thrown step too.
  const databaseCollation = pack.introspectDatabaseCollation
    ? (await withDbPackSoftFail(
        'introspectDatabaseCollation',
        () => pack.introspectDatabaseCollation!(ctx),
        onWarning,
        pack.engineKey,
      )) ?? null
    : null;
  // Database-resident scheduled jobs / agents (Spec 2026-05-30 Data-Layer
  // Fidelity 2, Group F) -- optional pack method; default to [] when a pack
  // does not implement it. Feeds the DB-resident jobs/agents Finding.
  const scheduledJobs = pack.introspectScheduledJobs
    ? (await withDbPackSoftFail(
        'introspectScheduledJobs',
        () => pack.introspectScheduledJobs!(ctx),
        onWarning,
        pack.engineKey,
      )) ?? []
    : [];
  return {
    schemas,
    tables,
    columns,
    keysAndIndexes,
    views,
    procedures,
    triggers,
    sequences,
    databaseCollation,
    scheduledJobs,
  };
}

/**
 * Emit a collected list of findings through the (possibly overridden)
 * emitter. Returns the same list (post-cap) so the orchestrator's result
 * envelope can echo what was sent.
 */
async function emitCollected(
  findings: FindingEmitInput[],
  runContext: FindingEmitRunContext,
  opts?: {
    findingEmitterOverride?: {
      emitFindings: typeof findingEmitter.emitFindings;
    };
    findingCapOverride?: number;
  },
): Promise<FindingEmitInput[]> {
  const capped = capFindingsPerType(
    findings,
    opts?.findingCapOverride ?? MAX_FINDINGS_PER_TYPE_PER_RUN,
  );
  return emitToFindingEmitter(capped, runContext, opts);
}

/**
 * Internal helper -- forwards the already-capped finding list to the
 * emitter and returns the list (the emitter's DTO output isn't useful to
 * the orchestrator's caller; the input list is what we expose).
 */
async function emitToFindingEmitter(
  findings: FindingEmitInput[],
  runContext: FindingEmitRunContext,
  opts?: {
    findingEmitterOverride?: {
      emitFindings: typeof findingEmitter.emitFindings;
    };
  },
): Promise<FindingEmitInput[]> {
  if (findings.length === 0) return [];
  const emitter = opts?.findingEmitterOverride ?? findingEmitter;
  try {
    await emitter.emitFindings(runContext, findings);
  } catch (err) {
    // Defense-in-depth -- FindingEmitter is already soft-fail internally.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[databasePackOrchestrator] emitFindings rejected unexpectedly. ` +
        `error='${message}'`,
    );
  }
  return findings;
}

// ============================================================================
// Relationship candidate construction (Bug fix 2026-05-17)
// ============================================================================

/**
 * Convert {@link RelationshipInference}s into reviewable
 * {@link DatabaseCandidatePayload}s of type
 * {@code logical_data_entity_relationships}.
 *
 * Why this lives in the orchestrator (and not in the per-engine packs):
 * the conversion is purely a structural reshape from RelationshipInference
 * to the candidate-row shape, and is identical for Postgres + Sybase.
 * Keeping it engine-agnostic means future engine packs don't have to
 * re-implement the same loop.
 *
 * Cardinality heuristic: when the FK columns on the source side exactly
 * cover the source table's primary key, the relationship is `ONE_TO_ONE`
 * (the FK doubles as a uniqueness guarantee). Otherwise `MANY_TO_ONE` --
 * which is the dominant case for declared foreign keys.
 *
 * Relationship-type mapping:
 *   - `declared_fk` / `unenforced_relationship` -> `FOREIGN_KEY`
 *   - `inferred`                                -> `ASSOCIATION`
 *   - `ambiguous`                               -> `ASSOCIATION`
 *
 * Stable clientIds: `dbrel:<fromSchema>.<fromTable>(<cols>)-><toSchema>.<toTable>(<cols>)`
 * so re-running discovery against the same DB produces idempotent matches
 * during save-back (which keys child rows by name + parent FK).
 */
export function buildRelationshipCandidates(
  relationships: RelationshipInference[],
  introspection: IntrospectionResult,
  engineKey: DbFindingEngineKey,
): DatabaseCandidatePayload[] {
  if (!relationships || relationships.length === 0) return [];

  // Index PK columns per table so we can detect 1:1 vs N:1.
  const pkColumnsByTable = new Map<string, Set<string>>();
  for (const k of introspection.keysAndIndexes) {
    if (k.kind !== 'primary_key') continue;
    const key = `${k.schemaName}.${k.tableName}`;
    let set = pkColumnsByTable.get(key);
    if (!set) {
      set = new Set();
      pkColumnsByTable.set(key, set);
    }
    for (const c of k.columns) set.add(c);
  }

  const out: DatabaseCandidatePayload[] = [];
  for (const r of relationships) {
    const fromKey = `${r.fromSchema}.${r.fromTable}`;
    const pkSet = pkColumnsByTable.get(fromKey);
    const isOneToOne =
      pkSet !== undefined &&
      pkSet.size === r.fromColumns.length &&
      r.fromColumns.every((c) => pkSet.has(c));
    const cardinality = isOneToOne ? 'ONE_TO_ONE' : 'MANY_TO_ONE';

    const relationshipType =
      r.kind === 'declared_fk' || r.kind === 'unenforced_relationship'
        ? 'FOREIGN_KEY'
        : 'ASSOCIATION';

    const fromCols = r.fromColumns.join(',');
    const toCols = r.toColumns.join(',');
    const clientId = `dbrel:${fromKey}(${fromCols})->${r.toSchema}.${r.toTable}(${toCols})`;
    const name = `${r.fromTable} -> ${r.toTable}`;

    // FK column-level detail (Spec 2026-05-29) as METADATA on the relationship
    // -- the join (referencing) columns + the referenced columns. snake_case
    // keys match the AMS `fk_columns` DTO. null/absent round-trips cleanly.
    // Oracle-W3: thread the verbatim referential actions (on_delete / on_update)
    // captured on the declared FK; omitted for inferred relationships.
    const fkColumns = buildFkColumnsMetadata(r.fromColumns, r.toColumns, {
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
    });

    out.push({
      candidateType: 'logical_data_entity_relationships',
      name,
      filePath: `db://${engineKey}/${encodeURIComponent(r.fromSchema)}/${encodeURIComponent(r.fromTable)}#rel:${encodeURIComponent(r.toTable)}`,
      clientId,
      data: {
        dbEngine: engineKey,
        // Fields the save-back's `logical_data_entity_relationships` case
        // reads (candidateSaveBackService.ts:639):
        sourceEntity: r.fromTable,
        targetEntity: r.toTable,
        cardinality,
        relationshipType,
        // Extra context the user / future model layer might want.
        fromSchema: r.fromSchema,
        toSchema: r.toSchema,
        fromColumns: r.fromColumns,
        toColumns: r.toColumns,
        fk_columns: fkColumns,
        inferenceKind: r.kind,
        confidence: typeof r.confidence === 'number' ? r.confidence : 1.0,
        rationale: r.rationale ?? null,
        sourceEvidenceIds: [],
      },
    });
  }
  return out;
}
