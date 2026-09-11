/**
 * Model-write-free database scan modes.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack --
 * Task Group 4 (Tasks 4.2 verification-only scan, 4.3 refresh-seeds scan).
 *
 * Two narrow endpoints, both mounted onto the existing `databaseRouter`
 * (`/discovery/db/...`), both following the `test-connection` precedent:
 *
 *   POST /discovery/db/verification-scan
 *     Runs the Postgres structural introspection against the TARGET database
 *     and returns the normalized actual-schema snapshot (the gateway diffs it
 *     against the migration pack's expected-schema JSON).
 *
 *   POST /discovery/db/refresh-seeds-scan
 *     Re-reads ONLY sequence/identity current values over the SOURCE engine's
 *     pack/sidecar path and returns them (the gateway regenerates ONLY the
 *     pack's sequences-seed changeset from the values). The source engine
 *     comes from the request body (`dbEngine`), defaulting to `sybase` for
 *     back-compat with callers written before SQL Server was a source.
 *     VERIFICATION-ONLY stays hardcoded to `postgres`: it reads the TARGET,
 *     and the target of every supported pair is PostgreSQL.
 *
 * HARD CONTRACT (both endpoints):
 *   - NOTHING is written to the model: no candidates, no findings, no
 *     discovery-run rows. These handlers never import `archModelClient`,
 *     the `FindingEmitter`, or the database-pack orchestrator.
 *   - Credentials are PER-INVOCATION: request body -> in-process
 *     `secretsStore` bundle -> purged in `finally`. Never persisted, never
 *     logged (only the synthetic scan id is logged).
 */

import { Request, Response, Router } from 'express';
import { getDatabasePack } from '../services/databasePacks/databasePackFactory';
import {
  purgeForRun,
  storeForRun,
} from '../services/databasePacks/secretsStore';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
} from '../services/databasePacks/types';
import {
  DEFAULT_PORT_BY_ENGINE,
  isDatabaseEngine,
  type DatabaseEngine,
} from '../services/databasePacks/types';

/**
 * Source engines the refresh-seeds scan can read. PostgreSQL is deliberately
 * absent: it is the TARGET of every supported pair, and re-seeding is a
 * source-side read.
 */
const REFRESH_SEED_SOURCE_ENGINES: ReadonlyArray<DatabaseEngine> = [
  'sybase',
  'mssql',
];

const REFRESH_SEED_ENGINE_CHOICES = REFRESH_SEED_SOURCE_ENGINES.map(
  (e) => `"${e}"`,
).join(', ');

/**
 * Shared body validation for the two scan modes. Returns the validation
 * error message, or null when valid.
 */
function validateScanBody(body: {
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
}): string | null {
  if (!body.host || typeof body.host !== 'string' || body.host.trim() === '') {
    return 'host is required and must be a non-empty string.';
  }
  if (typeof body.port !== 'number' || body.port <= 0 || body.port > 65535) {
    return 'port must be a positive integer 1-65535.';
  }
  if (!body.username || typeof body.username !== 'string') {
    return 'username is required.';
  }
  if (!body.password || typeof body.password !== 'string') {
    return 'password is required (request-body only; never persisted).';
  }
  return null;
}

/**
 * Build the full `DatabaseDiscoveryConfig` from a scan request body.
 * Profiling is ALWAYS `none` -- these scans are structural reads only.
 */
function scanConfig(
  body: Partial<DatabaseDiscoveryConfig>,
  engine: DatabaseEngine,
): DatabaseDiscoveryConfig {
  return {
    dbEngine: engine,
    host: body.host ?? '',
    port: body.port ?? DEFAULT_PORT_BY_ENGINE[engine],
    databaseName: body.databaseName ?? '',
    catalogName: body.catalogName ?? null,
    schemaName: body.schemaName ?? null,
    includeSchemas: body.includeSchemas ?? null,
    excludeSchemas: body.excludeSchemas ?? null,
    includeTables: body.includeTables ?? null,
    excludeTables: body.excludeTables ?? null,
    profilingMode: 'none',
    maxTablesToProfile: 0,
    maxRowsPerProfileQuery: 0,
    queryTimeoutSeconds: body.queryTimeoutSeconds ?? 30,
    allowWorkloadLogUpload: false,
    readOnlyConfirmed: true,
    deepProfilingConfirmed: false,
    username: body.username,
    sybaseDriver: body.sybaseDriver ?? 'auto',
    mssqlAuth: body.mssqlAuth,
  };
}

/**
 * Register the two scan-mode endpoints onto the given router (the
 * `databaseRouter` from `database.ts`).
 */
export function registerDatabaseScanModeRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // POST /verification-scan  (Task 4.2)
  // -------------------------------------------------------------------------
  router.post('/verification-scan', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<DatabaseDiscoveryConfig> & {
      username?: string;
      password?: string;
      scope?: { schemas?: string[]; tables?: string[] } | null;
    };

    const validationError = validateScanBody(body);
    if (validationError) {
      res.status(400).json({ error: { code: 400, message: validationError } });
      return;
    }

    // The optional scope filter supports per-area re-verification; it maps
    // onto the introspection's includeSchemas / includeTables SQL filters.
    // Schema-qualified table entries are reduced to the table segment (the
    // schema side is constrained by scope.schemas).
    const scopeSchemas = (body.scope?.schemas ?? []).filter(
      (s) => typeof s === 'string' && s.length > 0,
    );
    const scopeTables = (body.scope?.tables ?? []).filter(
      (t) => typeof t === 'string' && t.length > 0,
    );
    const config = scanConfig(
      {
        ...body,
        includeSchemas:
          scopeSchemas.length > 0 ? scopeSchemas : body.includeSchemas ?? null,
        includeTables:
          scopeTables.length > 0
            ? scopeTables.map((t) => t.split('.').pop() as string)
            : body.includeTables ?? null,
      },
      'postgres',
    );
    const credentials: DatabaseDiscoveryCredentials = {
      username: body.username as string,
      password: body.password as string,
    };

    const pack = getDatabasePack('postgres');
    if (!pack || typeof pack.runVerificationOnlyScan !== 'function') {
      res.status(400).json({
        error: {
          code: 400,
          message:
            'The postgres discovery pack does not support the verification-only scan mode.',
        },
      });
      return;
    }

    const scanId = `verify-scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      storeForRun(scanId, credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[discovery/db/verification-scan] secretsStore.storeForRun rejected. error='${message}'`,
      );
    }

    const ctx = {
      config,
      credentials,
      runId: scanId,
      projectId: 'verification-scan',
      architectureId: 'verification-scan',
    };
    try {
      await pack.connect(ctx);
      const snapshot = await pack.runVerificationOnlyScan(ctx);
      console.log(
        `[discovery/db/verification-scan] ok tables=${snapshot.tables.length} ` +
          `columns=${snapshot.columns.length} (no model writes by contract)`,
      );
      res.json({
        success: true,
        engine: 'postgres',
        scan_mode: 'verification_only',
        scope: {
          schemas: scopeSchemas.length > 0 ? scopeSchemas : null,
          tables: scopeTables.length > 0 ? scopeTables : null,
        },
        snapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[discovery/db/verification-scan] scan failed. host='${config.host}' error='${message}'`,
      );
      res.status(400).json({
        success: false,
        engine: 'postgres',
        error: { code: 400, message },
      });
    } finally {
      try {
        await pack.close();
      } catch (closeErr) {
        const closeMessage =
          closeErr instanceof Error ? closeErr.message : String(closeErr);
        console.warn(
          `[discovery/db/verification-scan] pack.close failed. error='${closeMessage}'`,
        );
      }
      purgeForRun(scanId);
    }
  });

  // -------------------------------------------------------------------------
  // POST /refresh-seeds-scan  (Task 4.3)
  // -------------------------------------------------------------------------
  router.post('/refresh-seeds-scan', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<DatabaseDiscoveryConfig> & {
      username?: string;
      password?: string;
    };

    const validationError = validateScanBody(body);
    if (validationError) {
      res.status(400).json({ error: { code: 400, message: validationError } });
      return;
    }

    // The SOURCE engine drives which pack re-reads the seeds. Absent =>
    // `sybase`, which is what every caller written before SQL Server became a
    // source engine sends.
    const requestedEngine = body.dbEngine ?? 'sybase';
    if (
      !isDatabaseEngine(requestedEngine) ||
      !REFRESH_SEED_SOURCE_ENGINES.includes(requestedEngine)
    ) {
      res.status(400).json({
        error: {
          code: 400,
          message:
            `dbEngine must be one of ${REFRESH_SEED_ENGINE_CHOICES} for a ` +
            `refresh-seeds scan (it reads the migration SOURCE).`,
        },
      });
      return;
    }
    const engine: DatabaseEngine = requestedEngine;

    const config = scanConfig(body, engine);
    const credentials: DatabaseDiscoveryCredentials = {
      username: body.username as string,
      password: body.password as string,
    };

    const pack = getDatabasePack(engine);
    if (!pack) {
      res.status(400).json({
        error: {
          code: 400,
          message: `No discovery pack registered for engine '${engine}'.`,
        },
      });
      return;
    }

    const scanId = `seed-scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      storeForRun(scanId, credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[discovery/db/refresh-seeds-scan] secretsStore.storeForRun rejected. error='${message}'`,
      );
    }

    const ctx = {
      config,
      credentials,
      runId: scanId,
      projectId: 'refresh-seeds-scan',
      architectureId: 'refresh-seeds-scan',
    };
    try {
      await pack.connect(ctx);
      // ONLY sequence/identity current values: sequences from the engine
      // catalog, plus the identity columns (with any backing-sequence
      // linkage) so the caller can re-seed identity restarts. No profiling,
      // no candidates, no findings, no run rows.
      const sequences = pack.introspectSequences
        ? await pack.introspectSequences(ctx)
        : [];
      const columns = await pack.introspectColumns(ctx);
      const identityColumns = columns
        .filter((c) => c.isIdentity === true)
        .map((c) => ({
          schemaName: c.schemaName,
          tableName: c.tableName,
          columnName: c.columnName,
          sequenceName: c.sequenceName ?? null,
        }));
      console.log(
        `[discovery/db/refresh-seeds-scan] ok engine=${engine} ` +
          `sequences=${sequences.length} ` +
          `identity_columns=${identityColumns.length} (no model writes by contract)`,
      );
      res.json({
        success: true,
        engine,
        scan_mode: 'refresh_seeds',
        sequences,
        identity_columns: identityColumns,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[discovery/db/refresh-seeds-scan] scan failed. engine='${engine}' ` +
          `host='${config.host}' error='${message}'`,
      );
      res.status(400).json({
        success: false,
        engine,
        error: { code: 400, message },
      });
    } finally {
      try {
        await pack.close();
      } catch (closeErr) {
        const closeMessage =
          closeErr instanceof Error ? closeErr.message : String(closeErr);
        console.warn(
          `[discovery/db/refresh-seeds-scan] pack.close failed. error='${closeMessage}'`,
        );
      }
      purgeForRun(scanId);
    }
  });
}
