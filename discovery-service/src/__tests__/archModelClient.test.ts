/**
 * Tests for discovery-service archModelClient methods.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 3: archModelClient for Discovery Service
 *
 * Tests the createDiscoveryRun, updateDiscoveryRun, getDiscoveryRun,
 * and getDiscoveryConfig methods.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4):
 * Every Discovery* URL embeds /architectures/{architectureId} between
 * /projects/{projectId} and the resource path. URL templates updated.
 */

import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

const ARCH_ID = 'arch-uuid-001';

// Mock runArchitectureRegistry to control _resolveArchitectureForRun behavior
// for run-scoped methods that internally resolve via the registry.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('archModelClient - discovery-service', () => {
  // ==========================================================================
  // Test 1: createDiscoveryRun calls POST to correct URL and returns the run DTO
  // ==========================================================================
  describe('createDiscoveryRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST to architecture-scoped URL and returns the run DTO', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      const mockResponse = {
        id: 'run-uuid-001',
        project_id: projectId,
        service_id: null,
        status: 'PENDING',
        current_step: null,
        config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
        steps_payload: {
          '1a': { status: 'pending' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
        error_message: null,
        created_at: '2026-04-04T10:00:00Z',
        updated_at: '2026-04-04T10:00:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        post: mockPost,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Re-mock runArchitectureRegistry after resetModules
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.createDiscoveryRun(projectId, ARCH_ID);

      // Verify POST was called with the correct architecture-scoped URL
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs`,
        undefined
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe('run-uuid-001');
      expect(result.project_id).toBe(projectId);
      expect(result.status).toBe('PENDING');
      expect(result.steps_payload).toEqual({
        '1a': { status: 'pending' },
        '1b': { status: 'pending' },
        '1c': { status: 'pending' },
        '1d': { status: 'pending' },
      });
    });
  });

  // ==========================================================================
  // Test 2: updateDiscoveryRun calls PUT to correct URL with body and returns updated DTO
  // ==========================================================================
  describe('updateDiscoveryRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT to architecture-scoped URL with body and returns updated DTO', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const payload = {
        status: 'RUNNING',
        current_step: '1a',
        steps_payload: {
          '1a': { status: 'running' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
      };

      const mockResponse = {
        id: runId,
        project_id: projectId,
        service_id: null,
        status: 'RUNNING',
        current_step: '1a',
        config_snapshot: { repos: [{ url: 'https://github.com/example/repo' }] },
        steps_payload: {
          '1a': { status: 'running' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
        error_message: null,
        created_at: '2026-04-04T10:00:00Z',
        updated_at: '2026-04-04T10:01:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        put: mockPut,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Re-mock runArchitectureRegistry after resetModules
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.updateDiscoveryRun(projectId, runId, payload);

      // Verify PUT was called with the correct architecture-scoped URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}`,
        payload
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe(runId);
      expect(result.status).toBe('RUNNING');
      expect(result.current_step).toBe('1a');
    });
  });

  // ==========================================================================
  // Test 3: getDiscoveryRun calls GET and returns DTO; returns null on 404
  // ==========================================================================
  describe('getDiscoveryRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET architecture-scoped URL when explicit architectureId passed', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      const mockResponse = {
        id: runId,
        project_id: projectId,
        service_id: null,
        status: 'COMPLETED',
        current_step: null,
        config_snapshot: { repos: [] },
        steps_payload: {},
        error_message: null,
        created_at: '2026-04-04T10:00:00Z',
        updated_at: '2026-04-04T10:05:00Z',
      };

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));

      const { archModelClient } = require('../services/archModelClient');

      // Pass architectureId explicitly to verify URL uses it verbatim.
      const result = await archModelClient.getDiscoveryRun(projectId, runId, ARCH_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}`
      );
      expect(result).toEqual(mockResponse);
    });

    it('returns null when backend returns 404 (run not found)', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'nonexistent-run-id';

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

      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getDiscoveryRun(projectId, runId, ARCH_ID);
      expect(result).toBeNull();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}`
      );
    });
  });

  // ==========================================================================
  // Test 4: getDiscoveryConfig calls GET to config endpoint and returns config DTO; returns null on 404
  // ==========================================================================
  describe('getDiscoveryConfig', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET architecture-scoped config URL', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      const mockResponse = {
        id: 'config-uuid-001',
        project_id: projectId,
        service_id: null,
        config_payload: {
          repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
          techHints: [{ language: 'Java' }],
        },
        status: 'COMPLETE',
        created_at: '2026-04-04T09:00:00Z',
        updated_at: '2026-04-04T09:30:00Z',
      };

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getDiscoveryConfig(projectId, ARCH_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/config`
      );

      expect(result).toEqual(mockResponse);
      expect(result!.id).toBe('config-uuid-001');
      expect(result!.project_id).toBe(projectId);
      expect(result!.status).toBe('COMPLETE');
    });

    it('returns null when backend returns 404 (config not found)', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

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

      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getDiscoveryConfig(projectId, ARCH_ID);
      expect(result).toBeNull();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/config`
      );
    });
  });
});
