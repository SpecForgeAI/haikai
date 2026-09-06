/**
 * POST .../migrate-selected accepts a run base mode (2026-09-06).
 *
 * `/migrate` has accepted + validated `baseMode` since 2026-08-15; the subset
 * route never did, so a subset re-start after a halted stage could not ask
 * for `integration` and silently took the auto-derived mode. Both spellings
 * are accepted (`base_mode` matches this route's snake_case fields, `baseMode`
 * matches `/migrate`); the validated set is literal so neither route can
 * silently widen the other's contract; omitting it changes nothing.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../services/migrationExecutionDriver', () => ({
  ...jest.requireActual('../services/migrationExecutionDriver'),
  startMigration: jest.fn(),
  defaultMigrationDriverDeps: jest.fn(() => ({})),
}));

import express from 'express';
import request from 'supertest';
import { migrationExecutionRouter } from '../routes/migrationExecution';
import { startMigration } from '../services/migrationExecutionDriver';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', migrationExecutionRouter);
  return a;
}

const URL = '/api/v1/projects/p1/migration-books-of-work/book-1/migrate-selected';
const BASE_BODY = { company: 'acme', project: 'order-mig', selected_work_item_ids: ['wi-1', 'wi-2'] };

beforeEach(() => {
  jest.clearAllMocks();
  (startMigration as jest.Mock).mockResolvedValue({ status: 'started', runId: 'run-1' });
});

describe('POST migrate-selected base mode', () => {
  it('threads base_mode (snake_case) into the driver scope', async () => {
    const res = await request(app()).post(URL).send({ ...BASE_BODY, base_mode: 'integration' });
    expect(res.status).toBe(202);
    expect(startMigration).toHaveBeenCalledTimes(1);
    const scope = (startMigration as jest.Mock).mock.calls[0][0];
    expect(scope.baseMode).toBe('integration');
    expect(scope.selectedWorkItemIds).toEqual(['wi-1', 'wi-2']);
  });

  it('accepts the /migrate spelling (baseMode) too', async () => {
    const res = await request(app()).post(URL).send({ ...BASE_BODY, baseMode: 'fresh' });
    expect(res.status).toBe(202);
    expect((startMigration as jest.Mock).mock.calls[0][0].baseMode).toBe('fresh');
  });

  it('rejects an unknown base mode with 400 and never reaches the driver', async () => {
    const res = await request(app()).post(URL).send({ ...BASE_BODY, base_mode: 'yolo' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: 'error',
      message: 'base_mode must be one of chain|fresh|mr|integration',
    });
    expect(startMigration).not.toHaveBeenCalled();
  });

  it('omitting it changes nothing: scope.baseMode is null (auto-derived)', async () => {
    const res = await request(app()).post(URL).send(BASE_BODY);
    expect(res.status).toBe(202);
    expect((startMigration as jest.Mock).mock.calls[0][0].baseMode).toBeNull();
  });
});
