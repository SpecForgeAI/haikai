import express from 'express';
import request from 'supertest';
import { apiMigrationValidationRouter } from '../routes';

/**
 * Health route smoke test. Mirrors `discovery-service/src/__tests__/
 * routes.test.ts` -- builds a tiny Express app with the same shape as the
 * production entry point and asserts `GET /health` returns the expected
 * payload.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
 * sub-task 4.1.
 */

function createTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api-migration-validation', apiMigrationValidationRouter);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  return app;
}

describe('api-migration-validation-service health route', () => {
  it('GET /health returns 200 with { status: "ok", timestamp: <ISO string> }', async () => {
    const app = createTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
    // Round-trip through Date to confirm the timestamp is a real ISO-8601 string.
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});
