// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock the validator
jest.mock('../services/temporaryArchitectureDiagramValidator');

describe('temporaryArchitectureDiagramService', () => {
  // ============================================================================
  // Test 1: Service returns { id, status: "saved", createdAt } for valid request
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns { id, status: "saved", createdAt } for a valid request', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Test Project' }],
        }),
        put: jest.fn().mockResolvedValue({
          data: {
            id: 'db-uuid-123',
            temporary_diagram_id: 'diagram-001',
            project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            diagram_payload: {},
            created_at: '2026-03-26T10:00:00Z',
            updated_at: '2026-03-26T10:00:00Z',
          },
        }),
      });

      // Setup validator mock to return no errors
      const validator = require('../services/temporaryArchitectureDiagramValidator');
      validator.validateTemporaryArchitectureDiagram = jest.fn().mockReturnValue([]);

      // Import the service
      const { saveTemporaryArchitectureDiagram } = require('../services/temporaryArchitectureDiagramService');

      const validDiagram = {
        id: 'diagram-001',
        name: 'Test ER Diagram',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: 1,
        nodes: [],
        edges: [],
      };

      const result = await saveTemporaryArchitectureDiagram(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        JSON.stringify(validDiagram)
      );

      expect(result).toEqual({
        id: 'diagram-001',
        status: 'saved',
        createdAt: '2026-03-26T10:00:00Z',
      });
    });
  });

  // ============================================================================
  // Test 2: Service throws 400 when diagramJson is not valid JSON
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - invalid JSON', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 when diagramJson is not valid JSON', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service
      const { saveTemporaryArchitectureDiagram } = require('../services/temporaryArchitectureDiagramService');

      try {
        await saveTemporaryArchitectureDiagram(
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
  // Test 3: Service throws 400 when parsed diagram fails validation
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - validation failure', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 when parsed diagram fails validation (e.g., missing required fields)', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Setup validator mock to return errors
      const validator = require('../services/temporaryArchitectureDiagramValidator');
      validator.validateTemporaryArchitectureDiagram = jest.fn().mockReturnValue([
        'id is required and must be a non-empty string',
        'name is required and must be a non-empty string',
      ]);

      // Import the service
      const { saveTemporaryArchitectureDiagram } = require('../services/temporaryArchitectureDiagramService');

      try {
        await saveTemporaryArchitectureDiagram(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          JSON.stringify({ incomplete: true })
        );
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('id is required');
        expect(error.message).toContain('name is required');
      }
    });
  });

  // ============================================================================
  // Gap-fill Test: Service rejects diagramJson exceeding 500KB
  // ============================================================================
  describe('saveTemporaryArchitectureDiagram - payload size limit', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 when diagramJson exceeds 500KB', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service
      const { saveTemporaryArchitectureDiagram } = require('../services/temporaryArchitectureDiagramService');

      // Create a payload that exceeds 500KB (500 * 1024 = 512000 bytes)
      // Use a valid JSON string that is larger than 500KB
      const largeString = 'x'.repeat(500 * 1024 + 1);
      const oversizedPayload = JSON.stringify({ id: 'diagram-001', data: largeString });

      try {
        await saveTemporaryArchitectureDiagram(
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
});
