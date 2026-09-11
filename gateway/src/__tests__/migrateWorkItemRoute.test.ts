/**
 * POST .../migrate-work-item + GET .../plan-order-frontier (2026-09-11).
 *
 * Start-from-work-item: the route derives the selection SERVER-SIDE from the
 * plan-order frontier (the not-yet-implemented leaves beneath the item) and
 * refuses, 409 blocked-shaped, any item that is not the next one in plan
 * order. The UI's greyed menu is a courtesy; this is the rule.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const fetchBookOfWork = jest.fn();
const fetchWorkItems = jest.fn();
jest.mock('../services/migrationExecutionDriver', () => ({
  ...jest.requireActual('../services/migrationExecutionDriver'),
  startMigration: jest.fn(),
  defaultMigrationDriverDeps: jest.fn(() => ({ fetchBookOfWork, fetchWorkItems })),
}));
jest.mock('../services/migrationExecutionRunClient', () => ({
  ...jest.requireActual('../services/migrationExecutionRunClient'),
  getMigrationExecutionRunsForBook: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import { migrationExecutionRouter } from '../routes/migrationExecution';
import { startMigration } from '../services/migrationExecutionDriver';
import { getMigrationExecutionRunsForBook } from '../services/migrationExecutionRunClient';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', migrationExecutionRouter);
  return a;
}

const BASE = '/api/v1/projects/p1/migration-books-of-work/book-1';
const BODY = { company: 'acme', project: 'order-mig' };

function book() {
  return {
    id: 'book-1',
    book_of_work_json: {
      items: [
        { id: 'F1', parentId: null, type: 'feature', title: 'Orders Feature', sequenceOrder: 0, workItemId: 'wi-F1' },
        { id: 's1', parentId: 'F1', type: 'story', title: 'S1', sequenceOrder: 0, workItemId: 'wi-1', workstream: 'service_implementation' },
        { id: 's2', parentId: 'F1', type: 'story', title: 'S2', sequenceOrder: 1, workItemId: 'wi-2', workstream: 'service_implementation' },
        { id: 'F2', parentId: null, type: 'feature', title: 'Next Feature', sequenceOrder: 1, workItemId: 'wi-F2' },
        { id: 's3', parentId: 'F2', type: 'story', title: 'S3', sequenceOrder: 0, workItemId: 'wi-3', workstream: 'service_implementation' },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchBookOfWork.mockResolvedValue(book());
  fetchWorkItems.mockResolvedValue([]);
  (getMigrationExecutionRunsForBook as jest.Mock).mockResolvedValue([
    {
      id: 'r1',
      created_at: '2026-09-10T10:00:00Z',
      status: 'implemented',
      items: [{ id: 'i1', work_item_id: 'wi-1', status: 'implemented', outcome: 'implemented', pr_url: 'https://git/mr/7', updated_at: '2026-09-10T11:00:00Z' }],
    },
  ]);
  (startMigration as jest.Mock).mockResolvedValue({ status: 'started', runId: 'run-2', itemCount: 1 });
});

describe('GET plan-order-frontier', () => {
  it('reports durable outcomes and the next item', async () => {
    const res = await request(app()).get(`${BASE}/plan-order-frontier`);
    expect(res.status).toBe(200);
    expect(res.body.frontierBookItemId).toBe('s2');
    expect(res.body.outcomesByWorkItem['wi-1'].status).toBe('implemented');
    expect(res.body.outcomesByWorkItem['wi-1'].prUrl).toBe('https://git/mr/7');
    expect(res.body.nodes.F1.doneCount).toBe(1);
    expect(res.body.nodes.F1.startable).toBe(true);
    expect(res.body.nodes.F2.startable).toBe(false);
    expect(res.body.nodes.F2.reason).toBe('blocked_by_preceding');
  });

  it('404 when the book does not exist', async () => {
    fetchBookOfWork.mockResolvedValue(null);
    const res = await request(app()).get(`${BASE}/plan-order-frontier`);
    expect(res.status).toBe(404);
  });
});

describe('POST migrate-work-item', () => {
  it('starts the REMAINING specs beneath the item as one implement-only batch (default completion)', async () => {
    const res = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'F1' });
    expect(res.status).toBe(202);
    expect(res.body.completion).toBe('implement_mr');
    expect(startMigration).toHaveBeenCalledTimes(1);
    const scope = (startMigration as jest.Mock).mock.calls[0][0];
    // s1 is already implemented: only s2 is dispatched.
    expect(scope.selectedWorkItemIds).toEqual(['wi-2']);
    expect(scope.completionMode).toBe('implement_mr');
    expect(scope.batchName).toMatch(/^orders-feature-/);
    expect(scope.baseMode).toBeNull();
  });

  it("'deploy' completion + base mode thread through to the driver scope", async () => {
    const res = await request(app())
      .post(`${BASE}/migrate-work-item`)
      .send({ ...BODY, bookItemId: 's2', completion: 'deploy', base_mode: 'integration' });
    expect(res.status).toBe(202);
    const scope = (startMigration as jest.Mock).mock.calls[0][0];
    expect(scope.selectedWorkItemIds).toEqual(['wi-2']);
    expect(scope.completionMode).toBe('deploy');
    expect(scope.baseMode).toBe('integration');
  });

  it('refuses an item AHEAD of the frontier with 409 blocked, naming the reason; the driver is never reached', async () => {
    const res = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'F2' });
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('blocked');
    expect(res.body.reasons[0].code).toBe('plan_order_blocked_by_preceding');
    expect(res.body.reasons[0].message).toContain('"S2"');
    expect(res.body.frontierBookItemId).toBe('s2');
    expect(startMigration).not.toHaveBeenCalled();
  });

  it('refuses an already-implemented story and any start while a run is in flight', async () => {
    const done = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 's1' });
    expect(done.status).toBe(409);
    expect(done.body.reasons[0].code).toBe('plan_order_all_implemented');

    (getMigrationExecutionRunsForBook as jest.Mock).mockResolvedValue([
      { id: 'r2', created_at: '2026-09-11T10:00:00Z', status: 'dispatching', items: [{ id: 'i2', work_item_id: 'wi-2', status: 'submitted' }] },
    ]);
    const busy = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'F2' });
    expect(busy.status).toBe(409);
    expect(busy.body.reasons[0].code).toBe('plan_order_run_in_flight');
    expect(startMigration).not.toHaveBeenCalled();
  });

  it('validates the body: book_item_id, completion and base_mode', async () => {
    expect((await request(app()).post(`${BASE}/migrate-work-item`).send(BODY)).status).toBe(400);
    const badCompletion = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'F1', completion: 'yolo' });
    expect(badCompletion.status).toBe(400);
    expect(badCompletion.body.message).toBe('completion must be one of implement_mr|deploy');
    const badBase = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'F1', base_mode: 'nope' });
    expect(badBase.status).toBe(400);
    const unknown = await request(app()).post(`${BASE}/migrate-work-item`).send({ ...BODY, book_item_id: 'zzz' });
    expect(unknown.status).toBe(404);
    expect(startMigration).not.toHaveBeenCalled();
  });
});
