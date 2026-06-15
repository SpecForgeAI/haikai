import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('archModelClient - work-item methods', () => {
  // ============================================================================
  // Test 1: listWorkItems calls GET and returns array
  // ============================================================================
  describe('listWorkItems - successful fetch', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET /api/model/projects/{projectId}/work-items and returns array of WorkItemDto', async () => {
      const mockWorkItems = [
        {
          id: 'wi-001',
          project_id: 'proj-123',
          type: 'INITIATIVE',
          parent_id: null,
          title: 'Initiative Alpha',
          description: 'First initiative',
          status: 'PLANNED',
          sort_order: 0,
          priority: null,
          target_window: null,
          tags: null,
          external_system: null,
          external_key: null,
          external_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: null,
        },
        {
          id: 'wi-002',
          project_id: 'proj-123',
          type: 'EPIC',
          parent_id: 'wi-001',
          title: 'Epic Beta',
          description: null,
          status: 'PLANNED',
          sort_order: 0,
          priority: null,
          target_window: null,
          tags: null,
          external_system: 'JIRA',
          external_key: 'PROJ-42',
          external_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: null,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockWorkItems });
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.listWorkItems('proj-123');

      // Verify the GET call was made to the correct URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith('/api/model/projects/proj-123/work-items');

      // Verify the returned data matches
      expect(result).toEqual(mockWorkItems);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Initiative Alpha');
      expect(result[1].type).toBe('EPIC');
    });
  });

  // ============================================================================
  // Test 2: listWorkItems propagates AxiosError on non-200
  // ============================================================================
  describe('listWorkItems - error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('propagates AxiosError when backend returns non-200 response', async () => {
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

      // Setup axios mock to reject with the error
      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Verify the error is thrown (not swallowed) and preserved for the caller
      await expect(
        archModelClient.listWorkItems('proj-123')
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
  // Test 3: createWorkItem sends POST with correct body
  // ============================================================================
  describe('createWorkItem - successful creation', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls POST /api/model/projects/{projectId}/work-items with correct body and returns created WorkItemDto', async () => {
      const createDto = {
        type: 'INITIATIVE',
        title: 'New Initiative',
        description: 'A new initiative',
        status: 'PLANNED',
        sort_order: 0,
        parent_id: null,
      };

      const mockCreated = {
        id: 'wi-new-001',
        project_id: 'proj-456',
        type: 'INITIATIVE',
        parent_id: null,
        title: 'New Initiative',
        description: 'A new initiative',
        status: 'PLANNED',
        sort_order: 0,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        external_url: null,
        created_at: '2026-02-16T00:00:00Z',
        updated_at: null,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: mockCreated });
      const mockAxiosInstance = {
        post: mockPost,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.createWorkItem('proj-456', createDto);

      // Verify the POST call was made with the correct URL and body
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/model/projects/proj-456/work-items',
        createDto
      );

      // Verify the returned data
      expect(result).toEqual(mockCreated);
      expect(result.id).toBe('wi-new-001');
      expect(result.title).toBe('New Initiative');
    });
  });

  // ============================================================================
  // Test 4: updateWorkItem sends PUT with correct path params and body
  // ============================================================================
  describe('updateWorkItem - successful update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT /api/model/projects/{projectId}/work-items/{workItemId} with correct body and returns updated WorkItemDto', async () => {
      const updateDto = {
        title: 'Updated Initiative Title',
        description: 'Updated description',
        sort_order: 2,
      };

      const mockUpdated = {
        id: 'wi-existing-001',
        project_id: 'proj-789',
        type: 'INITIATIVE',
        parent_id: null,
        title: 'Updated Initiative Title',
        description: 'Updated description',
        status: 'IN_PROGRESS',
        sort_order: 2,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        external_url: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-02-16T00:00:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockUpdated });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.updateWorkItem('proj-789', 'wi-existing-001', updateDto);

      // Verify the PUT call was made with the correct URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        '/api/model/projects/proj-789/work-items/wi-existing-001',
        updateDto
      );

      // Verify the returned data
      expect(result).toEqual(mockUpdated);
      expect(result.title).toBe('Updated Initiative Title');
      expect(result.sort_order).toBe(2);
    });
  });

  // ============================================================================
  // Test 5: encodeURIComponent is applied to path params
  // ============================================================================
  describe('encodeURIComponent applied to path params', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('encodes special characters in projectId and workItemId path parameters', async () => {
      const specialProjectId = 'proj/with spaces&special=chars';
      const specialWorkItemId = 'wi/item&id=123';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const mockPost = jest.fn().mockResolvedValue({ data: { id: 'created-id', title: 'Test', type: 'INITIATIVE', project_id: specialProjectId, parent_id: null } });
      const mockPut = jest.fn().mockResolvedValue({ data: { id: specialWorkItemId, title: 'Test', type: 'INITIATIVE', project_id: specialProjectId, parent_id: null } });
      const mockAxiosInstance = {
        get: mockGet,
        post: mockPost,
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Test listWorkItems encodes projectId
      await archModelClient.listWorkItems(specialProjectId);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(specialProjectId)}/work-items`
      );

      // Test createWorkItem encodes projectId
      await archModelClient.createWorkItem(specialProjectId, { title: 'Test' });
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(specialProjectId)}/work-items`,
        { title: 'Test' }
      );

      // Test updateWorkItem encodes both projectId and workItemId
      await archModelClient.updateWorkItem(specialProjectId, specialWorkItemId, { title: 'Test' });
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(specialProjectId)}/work-items/${encodeURIComponent(specialWorkItemId)}`,
        { title: 'Test' }
      );
    });
  });
});
