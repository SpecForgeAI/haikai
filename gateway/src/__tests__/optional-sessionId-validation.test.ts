/**
 * Tests for optional sessionId validation in chat endpoints
 * Task Group 2: Gateway Optional SessionId Validation
 */

import express, { Express } from 'express';
import request from 'supertest';
import {
  validateChatRequestMiddleware,
  validateStreamRequestMiddleware,
  requestIdMiddleware,
  errorHandler,
} from '../middleware';
import { validateChatRequest, validateSessionId } from '../types';

// Mock the config and logger
jest.mock('../config', () => ({
  getConfig: () => ({
    maxMessageBytes: 32768,
    maxOasBytes: 2097152,
    allowedOrigins: ['http://localhost:5173'],
  }),
}));

jest.mock('../services/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Optional SessionId Validation', () => {
  const MAX_MESSAGE_BYTES = 32768;
  const MAX_OAS_BYTES = 2097152;

  describe('POST /api/chat validation', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(requestIdMiddleware);
      app.post('/api/chat', validateChatRequestMiddleware, (req, res) => {
        // Simulate response with sessionId (will be generated in real handler)
        res.json({
          ok: true,
          sessionId: req.body.sessionId || 'generated-session-id',
        });
      });
      app.use(errorHandler);
    });

    it('should accept request without sessionId', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should accept request with valid sessionId', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'valid-session-123',
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.sessionId).toBe('valid-session-123');
    });

    it('should reject request with empty sessionId (whitespace only)', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: '   ',
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('sessionId');
    });

    it('should still require message when sessionId is missing', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('message');
    });
  });

  describe('GET /api/chat/stream validation', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(requestIdMiddleware);
      app.get('/api/chat/stream', validateStreamRequestMiddleware, (req, res) => {
        // Simulate response with sessionId
        res.json({
          ok: true,
          sessionId: req.query.sessionId || 'generated-session-id',
        });
      });
      app.use(errorHandler);
    });

    it('should accept request without sessionId query param', async () => {
      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should accept request with valid sessionId query param', async () => {
      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          sessionId: 'valid-session-456',
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.sessionId).toBe('valid-session-456');
    });

    it('should reject request with empty sessionId query param (whitespace only)', async () => {
      const response = await request(app)
        .get('/api/chat/stream')
        .query({
          sessionId: '   ',
          message: 'Hello, this is a test message',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('sessionId');
    });
  });

  describe('validateChatRequest function', () => {
    it('should pass validation when sessionId is missing', () => {
      const result = validateChatRequest(
        { message: 'Hello' },
        MAX_MESSAGE_BYTES,
        MAX_OAS_BYTES
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass validation when sessionId is provided and valid', () => {
      const result = validateChatRequest(
        { sessionId: 'session-abc-123', message: 'Hello' },
        MAX_MESSAGE_BYTES,
        MAX_OAS_BYTES
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when sessionId is provided but empty after trim', () => {
      const result = validateChatRequest(
        { sessionId: '   ', message: 'Hello' },
        MAX_MESSAGE_BYTES,
        MAX_OAS_BYTES
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'sessionId',
        message: 'sessionId must be a non-empty string if provided',
      });
    });
  });
});
