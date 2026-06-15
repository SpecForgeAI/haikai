/**
 * Tests for discovery-service archModelClient deleteClustersByRunId method.
 *
 * Spec: Phase 1c Clustering and Cluster Adjudication (Increment 9)
 * Task Group 7: archModelClient Cluster Delete Method
 * Task Group 11: Gap test for encodeURIComponent with special characters
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4):
 * URLs now embed /architectures/{architectureId}/ between /projects/{projectId}/
 * and the resource path. The registry binding (mocked here) supplies the id.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const ARCH_ID = 'arch-uuid-test';

jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('archModelClient - deleteClustersByRunId', () => {
  describe('sends DELETE to the correct architecture-scoped URL', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));
    });

    it('calls DELETE to /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      const mockResponse = { deleted: 5 };

      const axios = require('axios');
      const mockDelete = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        delete: mockDelete,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.deleteClustersByRunId(projectId, runId);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/clusters`
      );
    });
  });

  describe('returns the deleted count from the response body', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));
    });

    it('extracts and returns the deleted count from the response', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-002';

      const mockResponse = { deleted: 12 };

      const axios = require('axios');
      const mockDelete = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        delete: mockDelete,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.deleteClustersByRunId(projectId, runId);

      expect(result).toBe(12);
      expect(typeof result).toBe('number');
    });
  });

  describe('encodeURIComponent on special characters', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));
    });

    it('correctly encodes path params with spaces, slashes, and special characters', async () => {
      const projectId = 'project with spaces/slashes';
      const runId = 'run-id+special&chars';

      const mockResponse = { deleted: 3 };

      const axios = require('axios');
      const mockDelete = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        delete: mockDelete,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.deleteClustersByRunId(projectId, runId);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      const calledUrl = mockDelete.mock.calls[0][0] as string;

      // Verify the URL contains encoded special characters, not raw ones
      expect(calledUrl).toContain(encodeURIComponent(projectId));
      expect(calledUrl).toContain(encodeURIComponent(runId));
      // Raw special characters should not appear in the URL
      expect(calledUrl).not.toContain('project with spaces');
      expect(calledUrl).not.toContain('special&chars');

      expect(result).toBe(3);
    });
  });
});
