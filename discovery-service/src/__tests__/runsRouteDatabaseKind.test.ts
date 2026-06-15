/**
 * Tests for POST /discovery/runs database-kind branch.
 *
 * Spec: 2026-05-16 Database Discovery Packs (Sybase + PostgreSQL) -- route
 * wiring follow-up to Group 6's flagged gap. The route handler must extract
 * `discovery_kind`, `database_config`, `database_credentials` from the
 * request body and forward them through `archModelClient.createDiscoveryRun`
 * + `runManager.startRun` so the runManager's dispatch on
 * `options.discoveryKind === 'database'` is reachable end-to-end.
 *
 * These tests verify:
 *   1. Happy path: a valid database-kind request reaches both archmodel
 *      (with `discoveryKind: 'database'`) and runManager.startRun (with
 *      both the config + the credentials).
 *   2. Validation: missing `database_config` or `database_credentials`
 *      returns 400 without touching archmodel or runManager.
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    createDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getDiscoveryConfig: jest.fn(),
    getService: jest.fn(),
  },
}));

jest.mock('../services/runManager', () => {
  const actual = jest.requireActual('../services/runManager');
  return {
    ...actual,
    startRun: jest.fn().mockResolvedValue(undefined),
    resumeRun: jest.fn().mockResolvedValue(undefined),
  };
});

import express from 'express';
import supertest from 'supertest';
import { archModelClient } from '../services/archModelClient';
import { startRun } from '../services/runManager';

const mockArchModelClient = archModelClient as jest.Mocked<typeof archModelClient>;
const mockStartRun = startRun as jest.MockedFunction<typeof startRun>;

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ARCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeCreatedDbRun() {
  return {
    id: 'db-run-0001',
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    service_id: null,
    mode: null,
    status: 'PENDING',
    current_step: null,
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    created_at: '2026-05-16T10:00:00Z',
    updated_at: '2026-05-16T10:00:00Z',
    discovery_kind: 'database',
  };
}

function buildApp() {
  const { runsRouter } = require('../routes/runs');
  const app = express();
  app.use(express.json());
  app.use('/discovery/projects/:projectId/architectures/:architectureId/runs', runsRouter);
  return app;
}

const SAMPLE_DB_CONFIG = {
  dbEngine: 'postgres' as const,
  host: 'db.example.test',
  port: 5432,
  databaseName: 'orders',
  schemaName: 'public',
  profilingMode: 'standard' as const,
  maxTablesToProfile: 50,
  maxRowsPerProfileQuery: 1000,
  queryTimeoutSeconds: 30,
  allowWorkloadLogUpload: false,
};
const SAMPLE_DB_CREDS = { username: 'readonly_user', password: 'r3dacted-but-real' };

describe('POST /discovery/runs -- database-kind branch (Spec 2026-05-16)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArchModelClient.createDiscoveryRun.mockResolvedValue(makeCreatedDbRun() as never);
    mockStartRun.mockResolvedValue(undefined as never);
  });

  test('forwards discovery_kind, database_config, and database_credentials through to archmodel + startRun', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({
        discovery_kind: 'database',
        database_config: SAMPLE_DB_CONFIG,
        database_credentials: SAMPLE_DB_CREDS,
      });

    expect(res.status).toBe(200);
    expect(res.body.discovery_kind).toBe('database');

    // archmodel called with discoveryKind='database' -- the only option set.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledTimes(1);
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      undefined,
      { discoveryKind: 'database' },
    );

    // runManager.startRun called with the full DB option bundle including
    // credentials -- the test pins the wiring contract.
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'db-run-0001',
      ARCH_ID,
      undefined,
      {
        discoveryKind: 'database',
        databaseConfig: SAMPLE_DB_CONFIG,
        databaseCredentials: SAMPLE_DB_CREDS,
      },
    );

    // Critical: archmodel did NOT receive credentials anywhere.
    const archCallBody = mockArchModelClient.createDiscoveryRun.mock.calls[0][3];
    expect(JSON.stringify(archCallBody)).not.toContain('r3dacted-but-real');
    expect(JSON.stringify(archCallBody)).not.toContain('readonly_user');
  });

  // Spec 2026-06-06 regression: the database branch must forward the request's
  // serviceId to createDiscoveryRun + startRun. It was hardcoded `undefined`,
  // so the run persisted with NULL service_id and the Review Room grouped a
  // Persistence-Tier DB scan under "Unassigned scans" instead of its service.
  test('forwards serviceId so the DB run associates with its service (regression)', async () => {
    const SERVICE_ID = '22222222-2222-2222-2222-222222222222';
    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({
        serviceId: SERVICE_ID,
        discovery_kind: 'database',
        database_config: SAMPLE_DB_CONFIG,
        database_credentials: SAMPLE_DB_CREDS,
      });

    expect(res.status).toBe(200);

    // service_id flows to archmodel as the 3rd positional arg -> persisted FK.
    expect(mockArchModelClient.createDiscoveryRun).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SERVICE_ID,
      { discoveryKind: 'database' },
    );
    // ...and to startRun so the runtime is service-scoped too.
    expect(mockStartRun).toHaveBeenCalledWith(
      PROJECT_ID,
      'db-run-0001',
      ARCH_ID,
      SERVICE_ID,
      {
        discoveryKind: 'database',
        databaseConfig: SAMPLE_DB_CONFIG,
        databaseCredentials: SAMPLE_DB_CREDS,
      },
    );
  });

  test('returns 400 when discovery_kind=database but database_config is missing', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({
        discovery_kind: 'database',
        database_credentials: SAMPLE_DB_CREDS,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('database_config');
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  test('returns 400 when discovery_kind=database but database_credentials is missing', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post(`/discovery/projects/${PROJECT_ID}/architectures/${ARCH_ID}/runs`)
      .send({
        discovery_kind: 'database',
        database_config: SAMPLE_DB_CONFIG,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('database_credentials');
    expect(mockArchModelClient.createDiscoveryRun).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });
});
