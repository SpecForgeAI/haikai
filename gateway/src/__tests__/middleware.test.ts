/**
 * Tests for Express middleware
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import {
  createCorsMiddlewareWithOrigins,
  createRateLimitMiddlewareWithLimits,
  requestIdMiddleware,
  errorHandler,
  createValidationError,
  validateChatRequestMiddleware,
} from '../middleware';

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

describe('Middleware', () => {
  describe('CORS Middleware', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(createCorsMiddlewareWithOrigins(['http://localhost:5173', 'http://localhost:3000']));
      app.get('/test', (req, res) => res.json({ ok: true }));
    });

    it('should allow requests from configured origins', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://localhost:5173');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('should reject requests from unauthorized origins', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'http://evil.com');

      expect(response.status).toBe(500);
      expect(response.text).toContain('not allowed by CORS');
    });

    it('should allow requests without origin header', async () => {
      const response = await request(app)
        .get('/test');

      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limit Middleware', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      // Very low limit for testing (3 requests per window)
      app.use(createRateLimitMiddlewareWithLimits(3, 60000));
      app.get('/test', (req, res) => res.json({ ok: true }));
    });

    it('should allow requests within rate limit', async () => {
      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
    });

    it('should return 429 after rate limit exceeded', async () => {
      // Make requests up to the limit
      await request(app).get('/test');
      await request(app).get('/test');
      await request(app).get('/test');

      // This should exceed the limit
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe(429);
      expect(response.body.error.message).toContain('Too many requests');
    });
  });

  describe('Request ID Middleware', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(requestIdMiddleware);
      app.get('/test', (req, res) => {
        res.json({ requestId: req.requestId });
      });
    });

    it('should add X-Request-ID header to response', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should use client-provided X-Request-ID if present', async () => {
      const clientRequestId = 'client-request-123';

      const response = await request(app)
        .get('/test')
        .set('X-Request-ID', clientRequestId);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBe(clientRequestId);
      expect(response.body.requestId).toBe(clientRequestId);
    });
  });

  describe('Error Handler Middleware', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(requestIdMiddleware);

      // Route that throws an error
      app.get('/error', (req, res, next) => {
        next(createValidationError('Test validation error'));
      });

      // Route that throws internal error
      app.get('/internal-error', (req, res, next) => {
        const error = new Error('Internal details that should not be exposed');
        next(error);
      });

      // Apply error handler
      app.use(errorHandler);
    });

    it('should return safe error messages without stack traces', async () => {
      const response = await request(app).get('/error');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(400);
      expect(response.body.error.message).toBe('Test validation error');
      expect(response.body.error.requestId).toBeDefined();
      // Should NOT contain stack trace
      expect(response.body.stack).toBeUndefined();
    });

    it('should not expose internal error details', async () => {
      const response = await request(app).get('/internal-error');

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe('Internal server error');
      // Should NOT contain the actual error message
      expect(response.body.error.message).not.toContain('Internal details');
    });
  });

  describe('Validation Middleware', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(requestIdMiddleware);
      app.post('/api/chat', validateChatRequestMiddleware, (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    it('should accept valid request', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'session-123',
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should accept request without sessionId (optional)', async () => {
      // sessionId is now optional - handler will generate one
      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Hello',
        });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should reject request with whitespace-only sessionId', async () => {
      // If sessionId is provided but only whitespace, it should be rejected
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: '   ',
          message: 'Hello',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('sessionId');
    });

    it('should reject request with invalid preferredFormat', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'session-123',
          message: 'Hello',
          context: {
            preferredFormat: 'xml',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('preferredFormat');
    });
  });
});
