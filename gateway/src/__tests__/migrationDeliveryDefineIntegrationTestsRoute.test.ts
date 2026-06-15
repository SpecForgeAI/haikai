/**
 * Holistic Integration/E2E TEST Work Items (Spec 2026-06-14, Spec 2 of 4) --
 * focused route-wiring test for the per-feature/epic "Define Integration/E2E
 * Tests" action (Task Group 2.7).
 *
 * The route invokes the headless `runHolisticTestDefinitions` handler. The
 * handler module is mocked here so this test stays a pure route-wiring check
 * (request shape -> handler input; handler result -> 200 body; handler throw ->
 * 500 envelope). The handler's own behaviour is covered by
 * `holisticTestDefinitions.test.ts`.
 */

jest.mock('../config', () => ({
  getConfig: () => ({ architectureModelServiceBaseUrl: 'http://localhost:8080' }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockRunHolisticTestDefinitions = jest.fn();
jest.mock('../services/holisticTestDefinitionHandler', () => ({
  runHolisticTestDefinitions: (...args: unknown[]) =>
    mockRunHolisticTestDefinitions(...args),
}));

import express from 'express';
import request from 'supertest';
import { migrationDeliveryDashboardRouter } from '../routes/migrationDeliveryDashboard';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as unknown as { requestId: string }).requestId = 'define-integration-tests-test';
    next();
  });
  app.use('/api', migrationDeliveryDashboardRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST .../items/:bookItemId/define-integration-tests', () => {
  it('passes the node selection to the handler and returns its result (200)', async () => {
    const handlerResult = {
      level: 'feature',
      nodeBookItemId: 'F1',
      nodeWorkItemId: 'wi-F1',
      testPlan: [{ title: 't', description: 'd', type: 'integration' }],
      skippedChildren: [{ bookItemId: 'S2', workItemId: 'wi-S2', title: 'S2', reason: 'insufficient_context' }],
      specCompleteChildCount: 1,
      createdTestItems: [
        { workItemId: 'wi-test-1', bookItemId: 'T1', title: 't', type: 'integration', sequenceOrder: 3, specPersisted: true, implementStateWritten: true },
      ],
      failedTestItems: [],
      emptyPlan: false,
    };
    mockRunHolisticTestDefinitions.mockResolvedValueOnce(handlerResult);

    const res = await request(createTestApp())
      .post('/api/projects/p-1/migration-books-of-work/book-1/items/F1/define-integration-tests')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(handlerResult);
    expect(mockRunHolisticTestDefinitions).toHaveBeenCalledWith({
      projectId: 'p-1',
      bookOfWorkId: 'book-1',
      nodeBookItemId: 'F1',
    });
  });

  it('returns 200 with the warning payload even when the plan is empty (never blocks)', async () => {
    mockRunHolisticTestDefinitions.mockResolvedValueOnce({
      level: 'feature',
      nodeBookItemId: 'F1',
      nodeWorkItemId: 'wi-F1',
      testPlan: [],
      skippedChildren: [{ bookItemId: 'S1', workItemId: null, title: 'S1', reason: 'not_generated' }],
      specCompleteChildCount: 0,
      createdTestItems: [],
      failedTestItems: [],
      emptyPlan: true,
    });

    const res = await request(createTestApp())
      .post('/api/projects/p-1/migration-books-of-work/book-1/items/F1/define-integration-tests')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.emptyPlan).toBe(true);
    expect(res.body.skippedChildren).toHaveLength(1);
  });

  it('maps an unexpected handler error to a 500 envelope', async () => {
    mockRunHolisticTestDefinitions.mockRejectedValueOnce(new Error('node not found'));

    const res = await request(createTestApp())
      .post('/api/projects/p-1/migration-books-of-work/book-1/items/BAD/define-integration-tests')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(500);
    expect(res.body.error.details).toContain('node not found');
  });
});
