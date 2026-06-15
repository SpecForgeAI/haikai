/**
 * Discovery Review Gateway Error Forwarding Tests
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 6, Task 6.5: Gap-fill tests for transparent error code forwarding
 *
 * Tests:
 * 1. PATCH review route forwards 400 status code from backend (invalid review_status)
 * 2. PATCH review route forwards 404 status code from backend (candidate not found)
 * 3. POST save-approved route forwards non-200 status codes from MCP server
 * 4. PATCH review route forwards backend error body transparently
 *
 * These tests verify that the gateway proxy does not swallow backend error
 * responses and transparently forwards both status codes and error bodies.
 */

import request from 'supertest';
import express from 'express';
import { discoveryRouter } from '../routes/discovery';
import { resetConfig } from '../config';

// Mock fetch globally for proxying
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock logger to avoid console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Discovery Review Error Forwarding (Spec 2026-04-05, Task Group 6 Gap-Fill)', () => {
  let app: express.Application;

  const projectId = '550e8400-e29b-41d4-a716-446655440000';
  const architectureId = 'arch-test-default';
  const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const candidateId = 'cand-0001-0002-0003-000000000001';

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/v1/discovery', discoveryRouter);
    mockFetch.mockReset();
    resetConfig();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // =========================================================================
  // Test 1: PATCH review forwards 400 from backend (invalid review_status)
  // =========================================================================
  it('forwards 400 Bad Request when backend returns 400 for invalid review_status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid review_status: garbage. Must be one of: approved, rejected, deferred',
      }),
    });

    const response = await request(app)
      .patch(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/review`)
      .send({ review_status: 'garbage' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'Invalid review_status: garbage. Must be one of: approved, rejected, deferred'
    );
  });

  // =========================================================================
  // Test 2: PATCH review forwards 404 from backend (candidate not found)
  // =========================================================================
  it('forwards 404 Not Found when backend returns 404 for non-existent candidate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: `Candidate not found: ${candidateId}`,
      }),
    });

    const response = await request(app)
      .patch(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/review`)
      .send({ review_status: 'approved', reviewed_by: 'alice' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(`Candidate not found: ${candidateId}`);
  });

  // =========================================================================
  // Test 3: POST save-approved forwards non-200 status from MCP server
  // =========================================================================
  it('forwards non-200 status code from MCP server for save-approved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'Internal MCP error: model save failed',
      }),
    });

    const response = await request(app)
      .post(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/save-approved`);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal MCP error: model save failed');
  });

  // =========================================================================
  // Test 4: PATCH review route forwards full error body transparently
  // =========================================================================
  it('forwards the complete backend error body including all fields', async () => {
    const detailedError = {
      error: 'Candidate not found: cand-xyz',
      timestamp: '2026-04-05T14:00:00Z',
      path: `/api/model/projects/${projectId}/architectures/${architectureId}/discovery/runs/${runId}/candidates/cand-xyz/review`,
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => detailedError,
    });

    const response = await request(app)
      .patch(`/api/v1/discovery/projects/${projectId}/architectures/${architectureId}/runs/${runId}/candidates/${candidateId}/review`)
      .send({ review_status: 'approved' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Candidate not found: cand-xyz');
    expect(response.body.timestamp).toBe('2026-04-05T14:00:00Z');
    expect(response.body.path).toBeDefined();
  });
});
