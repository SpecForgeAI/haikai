/**
 * POST .../migration-execution-runs/:runId/retry-deploy (2026-09-06): the
 * operator's "retry the deploy only" door. Maps the driver's outcome to
 * 200 / 409 / 404 and refuses a body without the workspace identifiers.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/migrationExecutionDriver', () => ({
  ...jest.requireActual('../services/migrationExecutionDriver'),
  retryRunDeploy: jest.fn(),
  defaultMigrationDriverDeps: jest.fn(() => ({})),
}));

import express from 'express';
import request from 'supertest';
import { migrationExecutionRouter } from '../routes/migrationExecution';
import { retryRunDeploy } from '../services/migrationExecutionDriver';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', migrationExecutionRouter);
  return a;
}

const URL = '/api/v1/projects/p1/migration-execution-runs/run-1/retry-deploy';
const BODY = { company: 'acme', project: 'order-mig', book_id: 'book-1' };

beforeEach(() => jest.clearAllMocks());

describe('POST retry-deploy', () => {
  it('400 without the workspace identifiers; the driver is never reached', async () => {
    const res = await request(app()).post(URL).send({ company: 'acme' });
    expect(res.status).toBe(400);
    expect(retryRunDeploy).not.toHaveBeenCalled();
  });

  it('200 { deploying, jobId, itemsReset } when the replay is accepted', async () => {
    (retryRunDeploy as jest.Mock).mockResolvedValue({ status: 'deploying', runId: 'run-1', jobId: 'job-batch', itemsReset: 2 });
    const res = await request(app()).post(URL).send(BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deploying: true, jobId: 'job-batch', itemsReset: 2 });
    const [scope, runId] = (retryRunDeploy as jest.Mock).mock.calls[0];
    expect(scope).toMatchObject({ projectId: 'p1', bookId: 'book-1', company: 'acme', project: 'order-mig' });
    expect(runId).toBe('run-1');
  });

  it('409 { allowed: false, reason } when not retryable (reason verbatim)', async () => {
    (retryRunDeploy as jest.Mock).mockResolvedValue({ status: 'not_retryable', reason: 'run status is \'dispatching\'' });
    const res = await request(app()).post(URL).send(BODY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ allowed: false, reason: "run status is 'dispatching'" });
  });

  it('404 for an unknown run', async () => {
    (retryRunDeploy as jest.Mock).mockResolvedValue({ status: 'not_found' });
    const res = await request(app()).post(URL).send(BODY);
    expect(res.status).toBe(404);
  });

  it('500 with a generic message when the driver throws', async () => {
    (retryRunDeploy as jest.Mock).mockRejectedValue(new Error('AMS down'));
    const res = await request(app()).post(URL).send(BODY);
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });
});
