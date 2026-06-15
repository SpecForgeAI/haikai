/**
 * Tests for Organisation Routes
 *
 * Tests that the gateway properly proxies organisation requests to the
 * architecture-model-service.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Task Group 4: Gateway Layer - Gateway Proxy Routes
 */

import request from 'supertest';
import nock from 'nock';
import { app } from '../server';

describe('Organisation Routes', () => {
  const MODEL_SERVICE_URL = 'http://localhost:8080';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  describe('GET /api/v1/organisations', () => {
    it('proxies to model-service and returns list of organisations', async () => {
      const mockOrganisations = [
        { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Alpha Corp' },
        { id: '123e4567-e89b-12d3-a456-426614174001', name: 'Beta Inc' },
      ];

      nock(MODEL_SERVICE_URL)
        .get('/api/v1/organisations')
        .reply(200, mockOrganisations);

      const response = await request(app)
        .get('/api/v1/organisations')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual(mockOrganisations);
      expect(response.body).toHaveLength(2);
    });

    it('returns empty array when no organisations exist', async () => {
      nock(MODEL_SERVICE_URL)
        .get('/api/v1/organisations')
        .reply(200, []);

      const response = await request(app)
        .get('/api/v1/organisations')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('forwards 503 when model-service is unavailable', async () => {
      nock(MODEL_SERVICE_URL)
        .get('/api/v1/organisations')
        .replyWithError('Connection refused');

      const response = await request(app)
        .get('/api/v1/organisations')
        .expect(503);

      expect(response.body.message).toContain('unavailable');
    });
  });

  describe('GET /api/v1/organisations/by-name/:name', () => {
    it('proxies with path param and returns organisation when found', async () => {
      const mockOrganisation = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Org',
        description: 'Test description',
      };

      nock(MODEL_SERVICE_URL)
        .get('/api/v1/organisations/by-name/Test%20Org')
        .reply(200, mockOrganisation);

      const response = await request(app)
        .get('/api/v1/organisations/by-name/Test%20Org')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual(mockOrganisation);
    });

    it('forwards 404 when organisation not found', async () => {
      const errorResponse = {
        message: 'Organisation not found with name: Non-Existent',
      };

      nock(MODEL_SERVICE_URL)
        .get('/api/v1/organisations/by-name/Non-Existent')
        .reply(404, errorResponse);

      const response = await request(app)
        .get('/api/v1/organisations/by-name/Non-Existent')
        .expect(404);

      expect(response.body.message).toContain('not found');
    });
  });

  describe('POST /api/v1/organisations', () => {
    it('proxies request body and returns 201 on success', async () => {
      const requestBody = {
        name: 'New Org',
        description: 'A new organisation',
      };
      const mockCreated = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'New Org',
        description: 'A new organisation',
      };

      nock(MODEL_SERVICE_URL)
        .post('/api/v1/organisations', requestBody)
        .reply(201, mockCreated);

      const response = await request(app)
        .post('/api/v1/organisations')
        .send(requestBody)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toEqual(mockCreated);
    });

    it('forwards 400 for blank name', async () => {
      const requestBody = {
        name: '',
        description: 'Description',
      };
      const errorResponse = {
        message: 'Organisation name is required',
      };

      nock(MODEL_SERVICE_URL)
        .post('/api/v1/organisations', requestBody)
        .reply(400, errorResponse);

      const response = await request(app)
        .post('/api/v1/organisations')
        .send(requestBody)
        .expect(400);

      expect(response.body.message).toContain('required');
    });

    it('forwards 409 for duplicate name', async () => {
      const requestBody = {
        name: 'Existing Org',
        description: 'Description',
      };
      const errorResponse = {
        message: "Organisation with name 'Existing Org' already exists",
      };

      nock(MODEL_SERVICE_URL)
        .post('/api/v1/organisations', requestBody)
        .reply(409, errorResponse);

      const response = await request(app)
        .post('/api/v1/organisations')
        .send(requestBody)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });
  });
});
