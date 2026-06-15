import express from 'express';
import request from 'supertest';
import { discoveryRouter } from '../routes';
import { initializeAnalyzerRegistry } from '../services/analyzerRegistry';

/**
 * Route Tests for Discovery Service
 *
 * Creates a test Express app with the same middleware and route setup
 * as the production entry point, without calling app.listen().
 */

// Create a test Express app mirroring the production setup
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mount discovery router at /discovery
  app.use('/discovery', discoveryRouter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

describe('Discovery Service Routes', () => {
  let app: express.Express;

  beforeAll(() => {
    initializeAnalyzerRegistry();
    app = createTestApp();
  });

  // --------------------------------------------------------------------------
  // Health Check
  // --------------------------------------------------------------------------

  test('GET /health returns 200 with { status: "ok", timestamp: <ISO string> } shape', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
    // Verify timestamp is a valid ISO string
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  // --------------------------------------------------------------------------
  // Phase 0 Routes
  // --------------------------------------------------------------------------

  test('POST /discovery/phase0/frame with valid projectId returns 200 with stub response', async () => {
    const res = await request(app)
      .post('/discovery/phase0/frame')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      phase: 'phase0',
      step: 'frame',
      status: 'stub',
      projectId: 'p1',
    });
  });

  test('POST /discovery/phase0/frame with missing/empty projectId returns 400', async () => {
    const res = await request(app)
      .post('/discovery/phase0/frame')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(400);
    expect(res.body.error.message).toBe('projectId is required');
  });

  // --------------------------------------------------------------------------
  // Phase 1 Routes
  // --------------------------------------------------------------------------

  test('POST /discovery/phase1/1a with valid projectId returns 200 with stub response', async () => {
    const res = await request(app)
      .post('/discovery/phase1/1a')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      phase: 'phase1',
      step: '1a',
      status: 'stub',
      projectId: 'p1',
    });
  });

  test('POST /discovery/phase1/1d with valid projectId returns 200 (boundary test for last valid step)', async () => {
    const res = await request(app)
      .post('/discovery/phase1/1d')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      phase: 'phase1',
      step: '1d',
      status: 'stub',
      projectId: 'p1',
    });
  });

  test('POST /discovery/phase1/2a (invalid step) returns 400', async () => {
    const res = await request(app)
      .post('/discovery/phase1/2a')
      .send({ projectId: 'p1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(400);
    expect(res.body.error.message).toBe('Invalid step. Must be one of: 1a, 1b, 1c, 1d');
  });

  test('POST /discovery/phase1/1b with missing projectId returns 400', async () => {
    const res = await request(app)
      .post('/discovery/phase1/1b')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(400);
    expect(res.body.error.message).toBe('projectId is required');
  });
});
