/**
 * Tests for Jira Import Route Handler
 *
 * Tests that POST /api/roadmap/jira/import validates input, delegates to
 * importJiraRoadmap, returns correct response shapes, and handles errors.
 *
 * Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 3: Import Route Handler + Config
 */

import request from 'supertest';
import express from 'express';

// Mock logger to avoid console output during tests
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock importJiraRoadmap from the service
const mockImportJiraRoadmap = jest.fn();
jest.mock('../../services/jiraImportService', () => ({
  importJiraRoadmap: (...args: unknown[]) => mockImportJiraRoadmap(...args),
}));

// Mock config to prevent environment dependency
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    jiraServiceBaseUrl: 'http://localhost:8078',
    jiraBrowseBaseUrl: 'https://jira.example.com',
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  })),
}));

import { jiraImportRouter } from '../jiraImport';

describe('POST /api/roadmap/jira/import (Jira Import Route Handler)', () => {
  let app: express.Application;

  const validRequest = {
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    jql: 'project = PROJ AND type in (Initiative, Epic)',
    jiraProjectKey: 'PROJ',
    maxResults: 100,
  };

  const mockSuccessResult = {
    createdInitiatives: 2,
    updatedInitiatives: 1,
    createdEpics: 5,
    updatedEpics: 3,
    warnings: [],
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Simulate requestId middleware
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/roadmap/jira', jiraImportRouter);
    mockImportJiraRoadmap.mockReset();
  });

  // ---- Test 1: Valid request returns 200 with correct JiraImportResult shape ----

  it('should return 200 with correct JiraImportResult shape for a valid request', async () => {
    mockImportJiraRoadmap.mockResolvedValueOnce(mockSuccessResult);

    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send(validRequest)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual(mockSuccessResult);
    expect(response.body).toHaveProperty('createdInitiatives');
    expect(response.body).toHaveProperty('updatedInitiatives');
    expect(response.body).toHaveProperty('createdEpics');
    expect(response.body).toHaveProperty('updatedEpics');
    expect(response.body).toHaveProperty('warnings');
    expect(Array.isArray(response.body.warnings)).toBe(true);

    // Verify importJiraRoadmap was called with correct args
    expect(mockImportJiraRoadmap).toHaveBeenCalledTimes(1);
    expect(mockImportJiraRoadmap).toHaveBeenCalledWith({
      projectId: validRequest.projectId,
      jql: validRequest.jql,
      jiraProjectKey: validRequest.jiraProjectKey,
      maxResults: validRequest.maxResults,
    });
  });

  // ---- Test 2: Missing projectId returns 400 ----

  it('should return 400 when projectId is missing', async () => {
    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send({
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      })
      .expect('Content-Type', /json/)
      .expect(400);

    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('field', 'projectId');
    expect(response.body.message).toContain('projectId');
    expect(mockImportJiraRoadmap).not.toHaveBeenCalled();
  });

  // ---- Test 3: Missing/empty jql returns 400 ----

  it('should return 400 when jql is empty string', async () => {
    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        jql: '',
        jiraProjectKey: 'PROJ',
      })
      .expect('Content-Type', /json/)
      .expect(400);

    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('field', 'jql');
    expect(response.body.message).toContain('jql');
    expect(mockImportJiraRoadmap).not.toHaveBeenCalled();
  });

  // ---- Test 4: Missing jiraProjectKey returns 400 ----

  it('should return 400 when jiraProjectKey is missing', async () => {
    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send({
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        jql: 'project = PROJ',
      })
      .expect('Content-Type', /json/)
      .expect(400);

    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('field', 'jiraProjectKey');
    expect(response.body.message).toContain('jiraProjectKey');
    expect(mockImportJiraRoadmap).not.toHaveBeenCalled();
  });

  // ---- Test 5: Service error (jira-service upstream) returns 502/503 ----

  it('should return 502 when jira-service returns an upstream error', async () => {
    // Simulate an axios error with a response (upstream returned error)
    const axiosError = new Error('Request failed with status code 500') as any;
    axiosError.isAxiosError = true;
    axiosError.response = {
      status: 500,
      data: { message: 'Internal Server Error from jira-service' },
    };

    // We need to make axios.isAxiosError return true for this error
    // The route uses axios.isAxiosError() which checks for the isAxiosError property
    mockImportJiraRoadmap.mockRejectedValueOnce(axiosError);

    // Since the route handler uses axios.isAxiosError() which checks error.isAxiosError,
    // we need to make sure the mock error has that property. But the actual check
    // in the route is `axios.isAxiosError(error)` which checks `error.isAxiosError === true`.
    // Let's use the actual axios module to create a proper error.
    const axios = require('axios');
    const properAxiosError = new axios.AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status: 500,
        data: { message: 'Internal Server Error from jira-service' },
      },
    );

    mockImportJiraRoadmap.mockReset();
    mockImportJiraRoadmap.mockRejectedValueOnce(properAxiosError);

    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send(validRequest)
      .expect('Content-Type', /json/);

    // Upstream 500 is forwarded as 502
    expect(response.status).toBe(502);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('Jira service');
  });

  it('should return 503 when jira-service is unavailable (network error)', async () => {
    const axios = require('axios');
    const networkError = new axios.AxiosError(
      'connect ECONNREFUSED 127.0.0.1:8078',
      'ECONNREFUSED',
      undefined,
      undefined,
      undefined, // no response = network error
    );

    mockImportJiraRoadmap.mockRejectedValueOnce(networkError);

    const response = await request(app)
      .post('/api/roadmap/jira/import')
      .send(validRequest)
      .expect('Content-Type', /json/);

    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('unavailable');
  });

  // ---- Test 6: maxResults defaults to 200 when not provided ----

  it('should default maxResults to 200 when not provided in request body', async () => {
    mockImportJiraRoadmap.mockResolvedValueOnce(mockSuccessResult);

    const requestWithoutMaxResults = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      jql: 'project = PROJ AND type in (Initiative, Epic)',
      jiraProjectKey: 'PROJ',
    };

    await request(app)
      .post('/api/roadmap/jira/import')
      .send(requestWithoutMaxResults)
      .expect(200);

    expect(mockImportJiraRoadmap).toHaveBeenCalledTimes(1);
    expect(mockImportJiraRoadmap).toHaveBeenCalledWith(
      expect.objectContaining({
        maxResults: 200,
      }),
    );
  });
});
