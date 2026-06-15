/**
 * Tests for discovery-service archModelClient deleteCandidatesByRunId method.
 *
 * Spec: Phase 1d Candidate Generation (Increment 10)
 * Task Group 7: archModelClient Candidate Delete Method
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4):
 * URLs now embed /architectures/{architectureId}/ between /projects/{projectId}/
 * and the resource path. The registry binding (mocked here) supplies the id.
 *
 * Tests that deleteCandidatesByRunId sends DELETE to the correct URL
 * and returns the count from the response body.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const ARCH_ID = 'arch-uuid-test';

jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('archModelClient - deleteCandidatesByRunId', () => {
  describe('sends DELETE to the correct architecture-scoped URL', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      jest.mock('../services/runArchitectureRegistry', () => ({
        ...jest.requireActual('../services/runArchitectureRegistry'),
        getRunArchitectureId: jest.fn(() => ARCH_ID),
      }));
    });

    it('calls DELETE to /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidates', async () => {
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

      await archModelClient.deleteCandidatesByRunId(projectId, runId);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/candidates`
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

      const result = await archModelClient.deleteCandidatesByRunId(projectId, runId);

      expect(result).toBe(12);
      expect(typeof result).toBe('number');
    });
  });
});
