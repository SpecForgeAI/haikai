/**
 * Standalone shakedown entrypoint for the data-migration runner (Spec Y).
 *
 * Reads connection + pack config from the environment, executes the Phase-2
 * bulk load, and self-scores it as EXEC.DATA.* predicates on the shared trace
 * log. Credentials are read from the environment ONLY — never persisted, never
 * logged (the config header emits presence booleans). The phased executor
 * (Spec W) will call runDataMigration() directly; this CLI exists so the runner
 * can be exercised on the work machine (HAIKAI_TRACE=summary) before W lands.
 *
 * Not unit-tested here — it needs a live Sybase source + PostgreSQL target
 * (work-machine shakedown). The library it wires (buildLoadPlan / runDataMigration
 * / emitDataMigrationPredicates / forwardTransformRow) is fully covered.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createTracer } from '../../trace';
import { pairRulesetForSource } from '../../migrationPairRules';
import { DbConnectionConfig, DbType, isDbType, DB_TYPE_CHOICES } from '../../types/db';
import { PostgresAdapter } from '../db/PostgresAdapter';
import { SybaseAdapter } from '../db/SybaseAdapter';
import { PostgresTargetLoader } from './targetLoader';
import { buildLoadPlan } from './buildLoadPlan';
import { runDataMigration } from './dataMigrationRunner';
import { emitDataMigrationPredicates } from './dataMigrationPredicates';

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : v;
}
function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const SOURCE_DEFAULT_PORT: Record<DbType, number> = { postgres: 5432, sybase: 5000, mssql: 1433 };

function sourceConfig(): DbConnectionConfig {
  const rawType = env('SOURCE_DB_TYPE') || 'sybase';
  if (!isDbType(rawType)) {
    throw new Error(`SOURCE_DB_TYPE must be one of ${DB_TYPE_CHOICES} (got '${rawType}')`);
  }
  return {
    dbType: rawType,
    host: env('SOURCE_DB_HOST'),
    port: intEnv('SOURCE_DB_PORT', SOURCE_DEFAULT_PORT[rawType]),
    database: env('SOURCE_DB_NAME'),
    username: env('SOURCE_DB_USER'),
    password: env('SOURCE_DB_PASSWORD'),
  };
}
function targetConfig(): DbConnectionConfig {
  return {
    dbType: 'postgres',
    host: env('TARGET_DB_HOST'),
    port: intEnv('TARGET_DB_PORT', 5432),
    database: env('TARGET_DB_NAME'),
    username: env('TARGET_DB_USER'),
    password: env('TARGET_DB_PASSWORD'),
  };
}

async function main(): Promise<number> {
  const tracer = createTracer('data-migrate');
  const corr: { run?: string; project?: string; arch?: string } = {
    run: env('HAIKAI_RUN') || undefined,
    project: env('HAIKAI_PROJECT') || undefined,
    arch: env('HAIKAI_ARCH') || undefined,
  };
  const ruleset = pairRulesetForSource(sourceConfig().dbType);
  const packRoot = env('DATA_MIGRATION_PACK_ROOT');

  tracer.configHeader(
    {
      service: 'data-migrate',
      pair: ruleset?.pair_id ?? 'none',
      source_creds_present: !!env('SOURCE_DB_PASSWORD'),
      target_creds_present: !!env('TARGET_DB_PASSWORD'),
      pack_root_present: !!packRoot,
    },
    corr,
  );

  if (!packRoot) {
    tracer.fail('data migration ABORTED — DATA_MIGRATION_PACK_ROOT not set', corr);
    return 1;
  }

  let mainManifest: unknown;
  try {
    mainManifest = JSON.parse(
      readFileSync(join(packRoot, env('DATA_MIGRATION_MANIFEST', 'manifest.json')), 'utf8'),
    );
  } catch (e) {
    tracer.fail(`data migration ABORTED — cannot read pack manifest: ${(e as Error).message}`, corr);
    return 1;
  }
  let bulkManifest: unknown;
  try {
    bulkManifest = JSON.parse(readFileSync(join(packRoot, 'data', 'bulk-load-manifest.json'), 'utf8'));
  } catch {
    bulkManifest = undefined; // optional
  }

  const plan = buildLoadPlan(mainManifest, bulkManifest);
  if (plan.tables.length === 0) {
    tracer.warn(`data migration: empty load plan (${plan.issues.join('; ') || 'no tables'})`, corr);
  }

  const bulkCharset =
    ((bulkManifest as { source_charset?: { charset?: string | null } } | null)?.source_charset
      ?.charset ?? null) || process.env.SOURCE_DB_CHARSET || null;
  const source = new SybaseAdapter({ ...sourceConfig(), charset: bulkCharset });
  const target = new PostgresAdapter(targetConfig());
  const targetLoader = new PostgresTargetLoader(targetConfig(), {
    batchRows: intEnv('DATA_MIGRATION_BATCH_ROWS', 500),
  });
  try {
    const report = await runDataMigration({
      source,
      target,
      targetLoader,
      plan,
      ruleset,
      knobs: {
        // 0 = uncapped (2026-08-07): read_cap is an explicit operator valve
        // only; the paginated load handles any table size.
        readCap: intEnv('DATA_MIGRATION_READ_CAP', 0),
        pageRows: Math.min(10_000, Math.max(1, intEnv('DATA_MIGRATION_PAGE_ROWS', 5000))),
        timeoutSeconds: intEnv('DATA_MIGRATION_TIMEOUT_SECONDS', 120),
      },
    });
    emitDataMigrationPredicates(report, tracer, corr);
    tracer.ok(
      `data migration COMPLETED — status=${report.summary.status} ` +
        `loaded=${report.summary.loaded}/${report.summary.tables} rows=${report.summary.rows_loaded}`,
      corr,
    );
    return report.summary.status === 'clean' || report.summary.status === 'empty' ? 0 : 1;
  } finally {
    await Promise.allSettled([source.dispose(), target.dispose(), targetLoader.dispose()]);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
