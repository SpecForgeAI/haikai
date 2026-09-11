/**
 * Database discovery routes.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3 (test-connection),
 * Task Group 5 (full run-create wiring is Group 5's job).
 *
 * Group 3 wires ONLY `POST /discovery/db/test-connection`. The endpoint:
 *   1. Accepts a `DiscoveryRunDatabaseConfig` JSON body including
 *      `username` + `password`.
 *   2. Looks up the engine pack via `getDatabasePack(engineKey)`.
 *   3. Calls `pack.connect()` + `pack.testConnection()`, then `pack.close()`.
 *   4. Returns success / error to the caller.
 *
 * The endpoint does NOT create a discovery run row and does NOT persist
 * anything to AMS. It is a connectivity probe only.
 *
 * Group 5 extends this with `POST /discovery/db/runs` (the actual run-create
 * route) and wires the existing run-start path through the gateway. Group 3
 * keeps the scope tight per the spec.
 */

import { Router, Request, Response } from 'express';
import { registerDatabaseScanModeRoutes } from './databaseScanModes';
import { getDatabasePack } from '../services/databasePacks/databasePackFactory';
import {
  purgeForRun,
  storeForRun,
} from '../services/databasePacks/secretsStore';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  DatabaseEngine,
} from '../services/databasePacks/types';
import { isDatabaseEngine, DATABASE_ENGINE_CHOICES, DEFAULT_PORT_BY_ENGINE } from '../services/databasePacks/types';

const databaseRouter = Router({ mergeParams: true });

/**
 * Default config used when the caller leaves required-but-defaulted fields
 * out of the request body. Mirrors the spec's DTO field list.
 */
function withDefaults(
  body: Partial<DatabaseDiscoveryConfig>,
): DatabaseDiscoveryConfig {
  return {
    dbEngine: (body.dbEngine ?? 'postgres') as DatabaseEngine,
    host: body.host ?? '',
    port: body.port ?? DEFAULT_PORT_BY_ENGINE[(body.dbEngine ?? 'postgres') as DatabaseEngine] ?? 5432,
    databaseName: body.databaseName ?? '',
    catalogName: body.catalogName ?? null,
    schemaName: body.schemaName ?? null,
    includeSchemas: body.includeSchemas ?? null,
    excludeSchemas: body.excludeSchemas ?? null,
    includeTables: body.includeTables ?? null,
    excludeTables: body.excludeTables ?? null,
    profilingMode: body.profilingMode ?? 'standard',
    maxTablesToProfile: body.maxTablesToProfile ?? 100,
    maxRowsPerProfileQuery: body.maxRowsPerProfileQuery ?? 1000,
    queryTimeoutSeconds: body.queryTimeoutSeconds ?? 30,
    allowWorkloadLogUpload: body.allowWorkloadLogUpload ?? false,
    readOnlyConfirmed: body.readOnlyConfirmed ?? false,
    deepProfilingConfirmed: body.deepProfilingConfirmed ?? false,
    username: body.username,
    sybaseDriver: body.sybaseDriver ?? 'auto',
  };
}

/**
 * POST /discovery/db/test-connection
 *
 * Body: `DatabaseDiscoveryConfig` + `{ username, password }` (the password
 * lives only in the request body and the in-process secretsStore; it is
 * NEVER persisted to AMS).
 */
databaseRouter.post('/test-connection', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<DatabaseDiscoveryConfig> & {
    username?: string;
    password?: string;
  };

  if (!isDatabaseEngine(body.dbEngine)) {
    res.status(400).json({
      error: { code: 400, message: `dbEngine must be one of ${DATABASE_ENGINE_CHOICES}.` },
    });
    return;
  }
  if (!body.host || typeof body.host !== 'string' || body.host.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'host is required and must be a non-empty string.' },
    });
    return;
  }
  if (typeof body.port !== 'number' || body.port <= 0 || body.port > 65535) {
    res.status(400).json({
      error: { code: 400, message: 'port must be a positive integer 1-65535.' },
    });
    return;
  }
  if (!body.username || typeof body.username !== 'string') {
    res.status(400).json({
      error: { code: 400, message: 'username is required.' },
    });
    return;
  }
  if (!body.password || typeof body.password !== 'string') {
    res.status(400).json({
      error: { code: 400, message: 'password is required (request-body only; never persisted).' },
    });
    return;
  }

  const config = withDefaults(body);
  const credentials: DatabaseDiscoveryCredentials = {
    username: body.username,
    password: body.password,
  };

  const pack = getDatabasePack(config.dbEngine);
  if (!pack) {
    res.status(400).json({
      error: {
        code: 400,
        message:
          `No discovery pack registered for engine '${config.dbEngine}'. ` +
          `PostgreSQL is wired in Group 3; Sybase is wired in Group 4.`,
      },
    });
    return;
  }

  // Stash + purge the secret with a synthetic test-connection runId so the
  // contract in `secretsStore` (one-bundle-per-runId, always purged) holds.
  const probeRunId = `test-conn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    storeForRun(probeRunId, credentials);
  } catch (err) {
    // Should never collide on a fresh random runId, but be defensive.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[discovery/db/test-connection] secretsStore.storeForRun rejected. error='${message}'`,
    );
  }

  try {
    await pack.connect({
      config,
      credentials,
      runId: probeRunId,
      projectId: 'test-connection',
      architectureId: 'test-connection',
    });
    const result = await pack.testConnection({
      config,
      credentials,
      runId: probeRunId,
      projectId: 'test-connection',
      architectureId: 'test-connection',
    });
    res.json({
      success: true,
      engine: config.dbEngine,
      serverVersion: result.serverVersion ?? null,
      serverEdition: result.serverEdition ?? null,
      driverUsed: result.driverUsed ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Connection errors are EXPECTED for invalid credentials. Surface the
    // engine's error message verbatim so the UI can render it; do NOT log
    // at error level (this is a user-facing probe).
    console.warn(
      `[discovery/db/test-connection] testConnection failed. engine='${config.dbEngine}' ` +
        `host='${config.host}' error='${message}'`,
    );
    res.status(400).json({
      success: false,
      engine: config.dbEngine,
      error: { code: 400, message },
    });
  } finally {
    try {
      await pack.close();
    } catch (closeErr) {
      const closeMessage =
        closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.warn(
        `[discovery/db/test-connection] pack.close failed. error='${closeMessage}'`,
      );
    }
    purgeForRun(probeRunId);
  }
});


// Spec 2026-06-11 DB Schema + Data Migration Pack -- Tasks 4.2 / 4.3: the two
// model-write-free scan modes (verification-only + refresh-seeds) register
// onto this same router so they share the /discovery/db mount and the
// test-connection credential conventions.
registerDatabaseScanModeRoutes(databaseRouter);

export { databaseRouter };
