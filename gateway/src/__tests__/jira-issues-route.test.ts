/**
 * Tests for Jira Issues Gateway Route
 *
 * Tests that the gateway properly proxies Jira issue requests to the
 * jira-service, forwards query parameters, handles errors, and loads
 * configuration correctly.
 *
 * Spec 2026-02-05: Jira Service (Spring Boot) -- GET /jira/issues
 * Task Group 6: Gateway Proxy Route, Config, and Wiring
 */

import request from 'supertest';
import nock from 'nock';
import { app } from '../server';

describe('Jira Issues Routes', () => {
  const JIRA_SERVICE_URL = 'http://localhost:8078';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  // ---- Test 1: GET /api/v1/jira/issues proxies to jira-service and forwards query params ----

  describe('GET /api/v1/jira/issues', () => {
    it('proxies to jira-service and forwards query params', async () => {
      const mockWorkItems = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          project_id: 'my-project',
          type: 'FEATURE',
          parent_id: null,
          title: 'Test Issue',
          description: 'Test description',
          status: 'To Do',
          sort_order: null,
          priority: 3,
          target_window: null,
          tags: null,
          external_system: 'JIRA',
          external_key: 'PROJ-123',
          created_at: '2026-01-15T10:30:00Z',
          updated_at: '2026-01-20T14:00:00Z',
        },
      ];

      nock(JIRA_SERVICE_URL)
        .get('/jira/issues')
        .query({
          jiraProjectKey: 'PROJ',
          toolProjectId: 'my-project',
          maxResults: '50',
          expandChildren: 'true',
        })
        .reply(200, mockWorkItems);

      const response = await request(app)
        .get('/api/v1/jira/issues')
        .query({
          jiraProjectKey: 'PROJ',
          toolProjectId: 'my-project',
          maxResults: '50',
          expandChildren: 'true',
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual(mockWorkItems);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].external_system).toBe('JIRA');
      expect(response.body[0].external_key).toBe('PROJ-123');
    });

    // ---- Test 2: GET /api/v1/jira/issues returns 503 when jira-service is unavailable ----

    it('returns 503 when jira-service is unavailable', async () => {
      nock(JIRA_SERVICE_URL)
        .get('/jira/issues')
        .query(true)
        .replyWithError('Connection refused');

      const response = await request(app)
        .get('/api/v1/jira/issues')
        .query({
          jiraProjectKey: 'PROJ',
          toolProjectId: 'my-project',
        })
        .expect(503);

      expect(response.body.message).toContain('unavailable');
    });
  });
});

// ---- Test 3: Config loads jiraServiceBaseUrl from JIRA_SERVICE_URL env var with correct default ----

describe('Jira Service Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads jiraServiceBaseUrl from JIRA_SERVICE_URL env var with correct default', () => {
    // Set required env var
    process.env.OPENAI_API_KEY = 'test-api-key';
    // Clear JIRA_SERVICE_URL to test default
    delete process.env.JIRA_SERVICE_URL;

    const { loadConfig } = require('../config');
    const config = loadConfig();

    expect(config.jiraServiceBaseUrl).toBe('http://localhost:8078');

    // Now set a custom value
    process.env.JIRA_SERVICE_URL = 'http://custom-jira:9999';

    const { loadConfig: loadConfig2 } = require('../config');
    const config2 = loadConfig2();

    expect(config2.jiraServiceBaseUrl).toBe('http://custom-jira:9999');
  });
});
