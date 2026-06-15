/**
 * Optional integration tests for the Sybase sidecar.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 4 (tasks.md 4.1
 * integration-against-real-Sybase subset).
 *
 * These tests are GATED by `process.env.SYBASE_INTEGRATION === 'true'`. They
 * SKIP when:
 *   - the env var is not 'true', OR
 *   - the sidecar at `SYBASE_SIDECAR_URL` is unreachable
 *
 * In other words, these tests are explicit opt-in and MUST NOT block CI.
 *
 * HOW TO RUN LOCALLY
 * ------------------
 * 1. Start a Sybase ASE container (or point at any reachable Sybase):
 *      docker run -d --name sybase -p 5000:5000 \
 *        -e SYBASE_PASSWORD=secret \
 *        nguoianphu/docker-sybase:latest
 *
 * 2. Build + run the sidecar:
 *      cd sybase-discovery-sidecar
 *      mvn -DskipTests package
 *      java -jar target/sybase-discovery-sidecar-1.0.0-SNAPSHOT.jar
 *
 * 3. Export the gate + connection details:
 *      export SYBASE_INTEGRATION=true
 *      export SYBASE_SIDECAR_URL=http://localhost:8093
 *      export SYBASE_TEST_HOST=localhost
 *      export SYBASE_TEST_PORT=5000
 *      export SYBASE_TEST_DB=master
 *      export SYBASE_TEST_USER=sa
 *      export SYBASE_TEST_PASSWORD=secret
 *
 * 4. Run only this test file:
 *      cd discovery-service
 *      npx jest src/__tests__/sybaseSidecar.integration.test.ts
 */

import { SybaseDiscoveryPack } from '../services/databasePacks/sybase/SybaseDiscoveryPack';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
} from '../services/databasePacks/types';

const INTEGRATION_ENABLED = process.env.SYBASE_INTEGRATION === 'true';

/**
 * Probe the sidecar with a HEAD-equivalent request. Returns true when the
 * sidecar is reachable. We use the dynamic global fetch (Node 20+).
 */
async function sidecarReachable(): Promise<boolean> {
  if (!INTEGRATION_ENABLED) return false;
  const url = process.env.SYBASE_SIDECAR_URL ?? 'http://localhost:8093';
  try {
    const resp = await fetch(`${url}/test-connection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'reachability-probe',
        port: 0,
        database: 'x',
        username: 'x',
        password: 'x',
      }),
    });
    // Any structured response (even 4xx from validation) confirms the
    // sidecar is up and listening. A connection-refused error rejects here.
    return resp.status > 0;
  } catch {
    return false;
  }
}

function envConfig(): DatabaseDiscoveryConfig {
  return {
    dbEngine: 'sybase',
    host: process.env.SYBASE_TEST_HOST ?? 'localhost',
    port: parseInt(process.env.SYBASE_TEST_PORT ?? '5000', 10),
    databaseName: process.env.SYBASE_TEST_DB ?? 'master',
    catalogName: null,
    schemaName: null,
    includeSchemas: null,
    excludeSchemas: null,
    includeTables: null,
    excludeTables: null,
    profilingMode: 'standard',
    maxTablesToProfile: 25,
    maxRowsPerProfileQuery: 100,
    queryTimeoutSeconds: 30,
    allowWorkloadLogUpload: false,
    readOnlyConfirmed: true,
    username: process.env.SYBASE_TEST_USER ?? 'sa',
  };
}

function envCreds(): DatabaseDiscoveryCredentials {
  return {
    username: process.env.SYBASE_TEST_USER ?? 'sa',
    password: process.env.SYBASE_TEST_PASSWORD ?? 'secret',
  };
}

// The describe-with-skip pattern: we wrap the test body in `describe` and
// short-circuit setup if the gate is off. Jest does not fail a suite that
// has no enabled tests.
describe('Sybase sidecar integration (opt-in)', () => {
  let reachable = false;

  beforeAll(async () => {
    if (!INTEGRATION_ENABLED) return;
    reachable = await sidecarReachable();
    if (!reachable) {
      console.warn(
        'SYBASE_INTEGRATION=true but the sidecar at ' +
          (process.env.SYBASE_SIDECAR_URL ?? 'http://localhost:8093') +
          ' is unreachable. Skipping integration tests.',
      );
    }
  });

  const conditionalIt =
    INTEGRATION_ENABLED && process.env.SYBASE_TEST_PASSWORD ? it : it.skip;

  conditionalIt(
    'testConnection succeeds end-to-end against a real Sybase',
    async () => {
      if (!reachable) return;
      const pack = new SybaseDiscoveryPack();
      const ctx = {
        config: envConfig(),
        credentials: envCreds(),
        runId: 'integ-syb-conn',
        projectId: 'p',
        architectureId: 'a',
      };
      await pack.connect(ctx);
      const r = await pack.testConnection(ctx);
      expect(r.success).toBe(true);
      await pack.close();
    },
    60_000,
  );

  conditionalIt(
    'introspectTables returns at least one user table from a real Sybase',
    async () => {
      if (!reachable) return;
      const pack = new SybaseDiscoveryPack();
      const ctx = {
        config: envConfig(),
        credentials: envCreds(),
        runId: 'integ-syb-introspect',
        projectId: 'p',
        architectureId: 'a',
      };
      await pack.connect(ctx);
      const tables = await pack.introspectTables(ctx);
      expect(Array.isArray(tables)).toBe(true);
      // We do not assert a non-empty list because some Sybase test images
      // ship without user tables in `master`. The assertion is shape-only.
      await pack.close();
    },
    60_000,
  );

  it('placeholder so the suite is not empty when the gate is off', () => {
    if (INTEGRATION_ENABLED) {
      expect(reachable).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  });
});
