/**
 * Gap-fill tests for archModelClient temporary diagram methods.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 6: Test Review and Critical Gap Analysis
 *
 * Tests the saveTemporaryDiagram and getTemporaryDiagram methods
 * that were added to archModelClient in Task Group 3.
 */

import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('archModelClient - temporary diagram methods', () => {
  // ==========================================================================
  // Gap-fill Test 1: saveTemporaryDiagram calls PUT with correct URL and body
  // ==========================================================================
  describe('saveTemporaryDiagram', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT with correct URL and body, returns TemporaryDiagramResponseDto', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const architectureId = '660e8400-e29b-41d4-a716-446655440001';
      const temporaryDiagramId = 'diagram-001';
      const diagramPayload = {
        id: 'diagram-001',
        name: 'Test ER Diagram',
        diagram_kind: 'ER',
        source_architecture_domain: 'DATA',
        view_mode: 'LOGICAL',
        version: 1,
        nodes: [],
        edges: [],
      };

      const mockResponse = {
        id: 'db-uuid-123',
        temporary_diagram_id: 'diagram-001',
        project_id: projectId,
        diagram_payload: diagramPayload,
        created_at: '2026-03-26T10:00:00Z',
        updated_at: '2026-03-26T10:00:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.saveTemporaryDiagram(
        projectId,
        architectureId,
        temporaryDiagramId,
        diagramPayload
      );

      // Verify PUT was called with the architecture-scoped URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`,
        { diagram_payload: diagramPayload }
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe('db-uuid-123');
      expect(result.temporary_diagram_id).toBe('diagram-001');
      expect(result.created_at).toBe('2026-03-26T10:00:00Z');
    });
  });

  // ==========================================================================
  // Gap-fill Test 2: getTemporaryDiagram returns null on 404
  // ==========================================================================
  describe('getTemporaryDiagram', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns null when backend returns 404 (diagram not found)', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const architectureId = '660e8400-e29b-41d4-a716-446655440001';
      const temporaryDiagramId = 'nonexistent-diagram';

      // Create a 404 AxiosError
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: { message: 'Not Found' },
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      } as AxiosError;

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getTemporaryDiagram(projectId, architectureId, temporaryDiagramId);

      // Verify null is returned on 404
      expect(result).toBeNull();

      // Verify the GET call was made with the architecture-scoped URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`
      );
    });
  });
});
