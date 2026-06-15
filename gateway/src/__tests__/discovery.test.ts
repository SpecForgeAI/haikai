/**
 * Tests for Discovery Route
 *
 * Tests that the gateway exposes a minimal discovery capability descriptor
 * at GET /api/v1/discovery.
 *
 * Spec 2026-04-04: Legacy Discovery Capability Skeleton
 * Task Group 5: Minimal Gateway Awareness
 */

import request from 'supertest';
import { app } from '../server';

describe('Discovery Route', () => {
  describe('GET /api/v1/discovery', () => {
    it('returns 200 with discovery capability descriptor', async () => {
      const response = await request(app)
        .get('/api/v1/discovery')
        .expect(200);

      expect(response.body).toEqual({
        capability: 'discovery',
        status: 'registered',
        version: '0.1.0',
      });
    });

    it('returns response with Content-Type application/json', async () => {
      await request(app)
        .get('/api/v1/discovery')
        .expect('Content-Type', /application\/json/);
    });
  });
});
