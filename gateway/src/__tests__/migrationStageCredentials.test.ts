/**
 * Stage-scoped source + target registration (2026-07-31).
 *
 * Stage 1's Start modal registers the SOURCE database (previously only
 * reachable via the drift-watch route, whose baseline-context contract a DB
 * start cannot meet — the live run halted at the DB chain's inputs guard on
 * exactly that gap) alongside the target DB. Stage 2's modal registers the
 * SOURCE service (current system API) + the TARGET serve spec haibox
 * launches. All in-memory; source upserts must merge, never clobber.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import { migrationExecutionRouter } from '../routes/migrationExecution';
import { migrationTargetCredentialsStore } from '../services/migrationTargetCredentialsStore';
import {
  currentSystemCredentialsStore,
  runDriftTick,
} from '../services/baselineDriftScheduler';
import { serveSpecDefaultsFromAnswers } from '../services/migrationServeSpecDefaults';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', migrationExecutionRouter);
  return a;
}

const URL = '/api/v1/projects/p1/migration-execution-runs/run-1/target-credentials';

const TARGET_DB = {
  dbType: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'haikai_target',
  schema: 'public',
  username: 'postgres',
  password: 'pg-secret',
};
const SOURCE_DB = {
  dbType: 'sybase',
  host: 'src-host.example.com',
  port: 5000,
  database: 'legacy',
  schema: 'dbo',
  username: 'reader',
  password: 'syb-secret',
};

beforeEach(() => {
  migrationTargetCredentialsStore.clearAll();
  currentSystemCredentialsStore.delete('p1');
});

describe('POST .../target-credentials — stage-1 source + target DB', () => {
  it('registers BOTH databases in one call (target per-run, source per-project)', async () => {
    const res = await request(app())
      .post(URL)
      .send({ api: { type: 'none' }, db: TARGET_DB, source_db: SOURCE_DB });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      registered: true,
      dbRegistered: true,
      sourceDbRegistered: true,
      serviceRegistered: false,
    });
    expect(migrationTargetCredentialsStore.getDb('run-1')?.host).toBe('localhost');
    expect(currentSystemCredentialsStore.get('p1')?.db?.host).toBe('src-host.example.com');
    expect(currentSystemCredentialsStore.get('p1')?.db?.dbType).toBe('sybase');
  });

  it('rejects a partial source_db block whole-or-400', async () => {
    const res = await request(app())
      .post(URL)
      .send({ api: { type: 'none' }, source_db: { host: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('source_db');
    expect(currentSystemCredentialsStore.get('p1')).toBeUndefined();
  });

  it('a source-only registration MERGES into an existing drift watch (never clobbers)', async () => {
    currentSystemCredentialsStore.set({
      projectId: 'p1',
      architectureId: 'arch-1',
      sourceBaselineId: 'base-1',
      currentBaseUrl: 'http://legacy:8080',
      api: { type: 'none' },
    });

    const res = await request(app())
      .post(URL)
      .send({ api: { type: 'none' }, source_db: SOURCE_DB });

    expect(res.status).toBe(200);
    const watch = currentSystemCredentialsStore.get('p1');
    expect(watch?.db?.host).toBe('src-host.example.com');
    expect(watch?.sourceBaselineId).toBe('base-1'); // preserved
    expect(watch?.currentBaseUrl).toBe('http://legacy:8080'); // preserved
  });
});

describe('POST .../target-credentials — stage-2 source + target service', () => {
  const SERVICE = {
    command: 'mvn spring-boot:run',
    health_path: '/actuator/health',
    port_env: 'SERVER_PORT',
    readiness_timeout: 60,
    env: { SPRING_DATASOURCE_URL: 'jdbc:postgresql://localhost:5432/haikai_target' },
  };

  it('registers the serve spec per-run and the source API per-project', async () => {
    const res = await request(app())
      .post(URL)
      .send({
        api: { type: 'none' },
        service: SERVICE,
        source_api: { current_base_url: 'http://legacy:8080', api: { type: 'none' } },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ serviceRegistered: true, sourceApiRegistered: true });
    const spec = migrationTargetCredentialsStore.getService('run-1');
    expect(spec).toEqual({
      command: 'mvn spring-boot:run',
      healthPath: '/actuator/health',
      portEnv: 'SERVER_PORT',
      readinessTimeout: 60,
      env: { SPRING_DATASOURCE_URL: 'jdbc:postgresql://localhost:5432/haikai_target' },
    });
    expect(currentSystemCredentialsStore.get('p1')?.currentBaseUrl).toBe('http://legacy:8080');
  });

  it.each([
    ['empty command', { ...SERVICE, command: '  ' }],
    ['health path without a leading slash', { ...SERVICE, health_path: 'health' }],
    ['bad port env name', { ...SERVICE, port_env: '9BAD' }],
    ['non-string env value', { ...SERVICE, env: { A: 1 } }],
  ])('rejects %s with a 400', async (_label, service) => {
    const res = await request(app()).post(URL).send({ api: { type: 'none' }, service });
    expect(res.status).toBe(400);
    expect(migrationTargetCredentialsStore.getService('run-1')).toBeUndefined();
  });

  it('rejects a source_api without an http(s) base url', async () => {
    const res = await request(app())
      .post(URL)
      .send({ api: { type: 'none' }, source_api: { current_base_url: 'legacy:8080', api: { type: 'none' } } });
    expect(res.status).toBe(400);
  });
});

describe('drift tick vs creds-only entries', () => {
  it('skips a Start-modal source registration (no baseline context) entirely', async () => {
    currentSystemCredentialsStore.upsertDb('p1', {
      dbType: 'sybase',
      host: 'h',
      port: 5000,
      database: 'd',
      schema: null,
      username: 'u',
      password: 'p',
    });

    const result = await runDriftTick(
      { enabled: true, intervalMs: 1000, maxAgeDays: 14 },
      {
        gateReads: { listDiffsForBaseline: jest.fn() } as never,
        runDriftCheck: jest.fn() as never,
      }
    );

    expect(result.checked).toBe(0);
    expect(result.fired).toBe(0);
  });
});

describe('serveSpecDefaultsFromAnswers', () => {
  it('derives Spring + Maven', () => {
    const d = serveSpecDefaultsFromAnswers({
      framework: 'Spring Boot 3.3',
      buildTool: 'Maven',
    });
    expect(d).toMatchObject({
      command: 'mvn spring-boot:run',
      health_path: '/actuator/health',
      port_env: 'SERVER_PORT',
      source: 'derived',
    });
  });

  it('derives Spring + Gradle', () => {
    const d = serveSpecDefaultsFromAnswers({ framework: 'spring', buildTool: 'Gradle 8' });
    expect(d.command).toBe('./gradlew bootRun');
  });

  it('derives Node', () => {
    const d = serveSpecDefaultsFromAnswers({ runtime: 'Node.js 22', framework: 'Express' });
    expect(d).toMatchObject({ command: 'npm start', port_env: 'PORT', source: 'derived' });
  });

  it('falls back when nothing matches (command left for the operator)', () => {
    const d = serveSpecDefaultsFromAnswers({ language: 'COBOL' });
    expect(d).toMatchObject({ command: '', health_path: '/', source: 'fallback' });
    expect(d.runtime_hint).toBe('COBOL');
  });
});
