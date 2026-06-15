import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCHITECTURE_ID = '770e8400-e29b-41d4-a716-446655440002';

describe('archModelClient - save_architecture_baseline methods', () => {
  // ============================================================================
  // Test 1: getProjectById calls GET /api/projects and returns matching project
  // ============================================================================
  describe('getProjectById - successful lookup', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET /api/projects and returns the matching project object with its name field', async () => {
      const mockProjects = [
        { id: PROJECT_ID, name: 'My Architecture Project', status: 'active' },
        { id: '660e8400-e29b-41d4-a716-446655440001', name: 'Another Project', status: 'active' },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockProjects });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getProjectById(PROJECT_ID);

      // Verify the GET call was made to /api/projects
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith('/api/projects');

      // Verify the returned project matches
      expect(result).toEqual(mockProjects[0]);
      expect(result.id).toBe(PROJECT_ID);
      expect(result.name).toBe('My Architecture Project');
    });
  });

  // ============================================================================
  // Test 2: getProjectById throws when no project matches
  // ============================================================================
  describe('getProjectById - project not found', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws an error with descriptive message when no project matches the given projectId', async () => {
      const mockProjects = [
        { id: '660e8400-e29b-41d4-a716-446655440001', name: 'Another Project', status: 'active' },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockProjects });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Verify the error is thrown with a descriptive message
      await expect(
        archModelClient.getProjectById('nonexistent-project-id')
      ).rejects.toThrow('Project not found: nonexistent-project-id');
    });
  });

  // ============================================================================
  // Test 3: getModel hits the architecture-scoped URL with filename query param
  // ============================================================================
  describe('getModel - successful fetch', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET /api/model/projects/{projectId}/architectures/{architectureId} with filename query param', async () => {
      const mockModelDto = {
        metaModel: {
          entities: {
            services: [{ id: 'svc-123', name: 'OrderService' }],
            applications: [],
          },
          relationships: {
            data_movements: [],
          },
        },
        diagrams: [],
      };

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockModelDto });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getModel(PROJECT_ID, ARCHITECTURE_ID, 'My Architecture Project');

      // Verify the GET call was made with the architecture-scoped URL + filename param
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}`,
        {
          params: { filename: 'My Architecture Project' },
        }
      );

      // Verify the returned data matches the mock
      expect(result).toEqual(mockModelDto);
      expect(result.metaModel.entities.services).toHaveLength(1);
      expect(result.metaModel.entities.services[0].name).toBe('OrderService');
    });
  });

  // ============================================================================
  // Test 4: getModel returns null on 404
  // ============================================================================
  describe('getModel - 404 handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns null when backend returns 404 (model does not exist yet)', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: { message: 'Model not found' },
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      } as AxiosError;

      // Setup axios mock to reject with 404
      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getModel(PROJECT_ID, ARCHITECTURE_ID, 'NonExistent Project');

      // Verify null is returned on 404
      expect(result).toBeNull();

      // Verify the GET call was still made
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}`,
        {
          params: { filename: 'NonExistent Project' },
        }
      );
    });
  });

  // ============================================================================
  // Test 5: putModel hits the architecture-scoped URL with filename query param
  // ============================================================================
  describe('putModel - successful save', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT /api/model/projects/{projectId}/architectures/{architectureId} with filename query param and DTO body', async () => {
      const mockDto = {
        metaModel: {
          entities: {
            services: [{ id: 'svc-abc', name: 'OrderService' }],
            applications: [{ id: 'app-xyz', name: 'Core Application' }],
          },
          relationships: {
            data_movements: [],
          },
        },
        diagrams: [],
      };

      const mockResponseData = { success: true };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponseData });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.putModel(PROJECT_ID, ARCHITECTURE_ID, 'My Architecture Project', mockDto);

      // Verify the PUT call was made with the correct URL, body, and params
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCHITECTURE_ID)}`,
        mockDto,
        {
          params: { filename: 'My Architecture Project' },
        }
      );

      // Verify the returned data
      expect(result).toEqual(mockResponseData);
    });
  });

  // ============================================================================
  // Test 6: putModel throws AxiosError when backend returns 500
  // ============================================================================
  describe('putModel - backend error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws AxiosError when backend returns 500 (error preserved for caller handling)', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: { message: 'Internal Server Error' },
          statusText: 'Internal Server Error',
          headers: {},
          config: {},
        },
      } as AxiosError;

      const mockDto = {
        metaModel: {
          entities: { services: [] },
          relationships: {},
        },
        diagrams: [],
      };

      // Setup axios mock to reject with the error
      const axios = require('axios');
      const mockPut = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Verify the error is thrown (not swallowed) and preserved for the caller
      await expect(
        archModelClient.putModel(PROJECT_ID, ARCHITECTURE_ID, 'My Architecture Project', mockDto)
      ).rejects.toMatchObject({
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: {
          status: 500,
        },
      });
    });
  });

  // ============================================================================
  // Test 7: putModel throws loud-failure error when architectureId is missing
  // ============================================================================
  describe('putModel - loud failure on missing architectureId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws with a descriptive error when architectureId is empty', async () => {
      const mockDto = {
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      };

      const axios = require('axios');
      const mockPut = jest.fn();
      axios.create = jest.fn().mockReturnValue({ put: mockPut });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.putModel(PROJECT_ID, '', 'X', mockDto)
      ).rejects.toThrow(/architectureId is required/);

      // No HTTP call should have been made.
      expect(mockPut).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 8: getModel throws loud-failure error when architectureId is missing
  // ============================================================================
  describe('getModel - loud failure on missing architectureId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws with a descriptive error when architectureId is empty', async () => {
      const axios = require('axios');
      const mockGet = jest.fn();
      axios.create = jest.fn().mockReturnValue({ get: mockGet });

      const { archModelClient } = require('../services/archModelClient');

      await expect(
        archModelClient.getModel(PROJECT_ID, '', 'X')
      ).rejects.toThrow(/architectureId is required/);

      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
