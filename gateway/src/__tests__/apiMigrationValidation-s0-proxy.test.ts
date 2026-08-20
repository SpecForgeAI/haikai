/**
 * S0-snapshot proxy tests (CSD, 2026-08-20 journey-audit fix).
 *
 * The capture-session screen's restore panel rides these thin pass-throughs:
 *   GET  /api/v1/api-migration-validation/s0-snapshot/latest   (query verbatim)
 *   POST /api/v1/api-migration-validation/s0-snapshot/restore  (body verbatim,
 *        carries the DB credentials — the proxy must forward untouched)
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    apiMigrationValidationServiceBaseUrl: 'http://localhost:8092',
    llmProvider: 'openai',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({ sendChatRequest: jest.fn() }),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import express from 'express';
import request from 'supertest';
import { apiMigrationValidationRouter } from '../routes/apiMigrationValidation';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 's0-proxy-test';
    next();
  });
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

beforeEach(() => {
  mockFetch.mockReset();
});

test('GET /s0-snapshot/latest forwards the query string verbatim as a bodiless GET', async () => {
  const manifest = {
    snapshot_id: 's0-1',
    created_at: '2026-08-19T10:00:00Z',
    tables: [{ table: 'orders', row_count: 12, checksum: 'x', file: 'orders.jsonl', note: null }],
  };
  mockFetch.mockResolvedValueOnce(jsonResponse(200, { snapshot: manifest }));

  const app = createTestApp();
  const res = await request(app).get(
    '/api/v1/api-migration-validation/s0-snapshot/latest?project_id=proj-1&architecture_id=arch-1',
  );

  expect(res.status).toBe(200);
  expect(res.body.snapshot.snapshot_id).toBe('s0-1');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8092/api-migration-validation/api/s0-snapshot/latest' +
      '?project_id=proj-1&architecture_id=arch-1',
  );
  expect(calledInit.method).toBe('GET');
  expect(calledInit.body).toBeUndefined();
});

test('POST /s0-snapshot/restore forwards the confirm-gated body (incl. credentials) verbatim', async () => {
  mockFetch.mockResolvedValueOnce(
    jsonResponse(200, {
      snapshot_id: 's0-1',
      report: { status: 'restored', tables: [], verification: { matches: 3, mismatches: [] } },
    }),
  );

  const body = {
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    snapshot_id: 's0-1',
    confirm: true,
    source_db: {
      db_type: 'sybase',
      host: 'db.internal',
      port: 5000,
      database: 'appdb',
      schema: null,
      username: 'writer',
      password: 'sekret',
    },
  };

  const app = createTestApp();
  const res = await request(app)
    .post('/api/v1/api-migration-validation/s0-snapshot/restore')
    .send(body);

  expect(res.status).toBe(200);
  expect(res.body.report.status).toBe('restored');

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    'http://localhost:8092/api-migration-validation/api/s0-snapshot/restore',
  );
  expect(calledInit.method).toBe('POST');
  expect(JSON.parse(String(calledInit.body))).toEqual(body);
});
