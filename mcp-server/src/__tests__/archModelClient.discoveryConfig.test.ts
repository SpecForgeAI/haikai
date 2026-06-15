/**
 * Tests for archModelClient discovery config methods.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 5: MCP Save Tool and archModelClient Methods
 *
 * Tests the saveDiscoveryConfig, getDiscoveryConfig, and createProjectArtifact
 * methods that were added to archModelClient.
 */

import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('archModelClient - discovery config methods', () => {
  // ==========================================================================
  // Test 8: saveDiscoveryConfig calls PUT with correct URL and body
  // ==========================================================================
  describe('saveDiscoveryConfig', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT with correct URL and body, returns DiscoveryConfigResponseDto', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const configPayload = {
        repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
        techHints: [{ language: 'Java' }],
      };
      const status = 'DRAFT';

      const mockResponse = {
        id: 'db-uuid-456',
        project_id: projectId,
        config_payload: configPayload,
        status: 'DRAFT',
        created_at: '2026-04-04T10:00:00Z',
        updated_at: '2026-04-04T10:00:00Z',
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

      const result = await archModelClient.saveDiscoveryConfig(
        projectId,
        configPayload,
        status
      );

      // Verify PUT was called with the correct URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/discovery/config`,
        { config_payload: configPayload, status }
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe('db-uuid-456');
      expect(result.project_id).toBe(projectId);
      expect(result.status).toBe('DRAFT');
      expect(result.created_at).toBe('2026-04-04T10:00:00Z');
    });
  });

  // ==========================================================================
  // Test 9: getDiscoveryConfig returns null on 404
  // ==========================================================================
  describe('getDiscoveryConfig', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns null when backend returns 404 (config not found)', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

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

      const result = await archModelClient.getDiscoveryConfig(projectId);

      // Verify null is returned on 404
      expect(result).toBeNull();

      // Verify the GET call was made with the correct URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/discovery/config`
      );
    });
  });

  // ==========================================================================
  // Gap Test 3 (Task Group 7): createProjectArtifact calls POST with correct
  // URL and body
  // ==========================================================================
  describe('createProjectArtifact', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST with correct URL and body, returns artifact response', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const artifactType = 'DISCOVERY_BRIEF_MD';
      const content = '# Discovery Brief\n\nThis is the discovery brief for the project.';
      const source = 'discovery-assistant';

      const mockResponse = {
        id: 'artifact-uuid-789',
        project_id: projectId,
        artifact_type: artifactType,
        content,
        source,
        revision: 1,
        created_at: '2026-04-04T12:00:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        post: mockPost,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.createProjectArtifact(
        projectId,
        artifactType,
        content,
        source
      );

      // Verify POST was called with the correct URL and body
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactType)}`,
        { content, source }
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe('artifact-uuid-789');
      expect(result.project_id).toBe(projectId);
      expect(result.artifact_type).toBe(artifactType);
      expect(result.revision).toBe(1);
    });
  });
});
