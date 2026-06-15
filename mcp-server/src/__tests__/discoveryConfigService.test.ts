// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('discoveryConfigService', () => {
  // ============================================================================
  // Test 5: Service returns { projectId, status } for valid JSON config
  // ============================================================================
  describe('saveDiscoveryConfig - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns { projectId, status } for a valid JSON config', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Test Project' }],
        }),
        put: jest.fn().mockResolvedValue({
          data: {
            id: 'db-uuid-123',
            project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            config_payload: { repos: [], techHints: [] },
            status: 'DRAFT',
            created_at: '2026-04-04T10:00:00Z',
            updated_at: '2026-04-04T10:00:00Z',
          },
        }),
      });

      // Import the service
      const { saveDiscoveryConfig } = require('../services/discoveryConfigService');

      const validConfig = {
        repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
        techHints: [{ language: 'Java' }],
      };

      const result = await saveDiscoveryConfig(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        JSON.stringify(validConfig)
      );

      expect(result).toEqual({
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'DRAFT',
      });
    });
  });

  // ============================================================================
  // Test 6: Service throws 400 for invalid JSON string
  // ============================================================================
  describe('saveDiscoveryConfig - invalid JSON', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 for invalid JSON string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service
      const { saveDiscoveryConfig } = require('../services/discoveryConfigService');

      try {
        await saveDiscoveryConfig(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          'not-valid-json{{'
        );
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Invalid JSON');
      }
    });
  });

  // ============================================================================
  // Test 7: Service throws 400 for payload exceeding 500KB
  // ============================================================================
  describe('saveDiscoveryConfig - payload size limit', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 when discoveryConfigJson exceeds 500KB', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service
      const { saveDiscoveryConfig } = require('../services/discoveryConfigService');

      // Create a payload that exceeds 500KB (500 * 1024 = 512000 bytes)
      const largeString = 'x'.repeat(500 * 1024 + 1);
      const oversizedPayload = JSON.stringify({ repos: largeString });

      try {
        await saveDiscoveryConfig(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          oversizedPayload
        );
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('exceeds maximum size of 500KB');
      }
    });
  });

  // ============================================================================
  // Gap Test 2 (Task Group 7): Service rejects JSON array input
  // ============================================================================
  describe('saveDiscoveryConfig - rejects JSON array', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 when discoveryConfigJson is a JSON array instead of object', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service
      const { saveDiscoveryConfig } = require('../services/discoveryConfigService');

      // A JSON array is valid JSON but not a valid discovery config
      // (the service requires a non-null object, not an array)
      try {
        await saveDiscoveryConfig(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          '[1,2,3]'
        );
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('must be a JSON object');
      }
    });
  });
});
