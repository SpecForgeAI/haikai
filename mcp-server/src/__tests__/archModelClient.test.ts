import { AxiosError } from 'axios';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('archModelClient - upsertProductDefinition', () => {
  // ============================================================================
  // Test 1: upsertProductDefinition calls PUT with correct URL and body,
  //         returns ProductDefinitionDto
  // ============================================================================
  describe('successful upsert', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT /api/projects/{projectId}/product with correct body and returns ProductDefinitionDto', async () => {
      const mockProductDefinition = {
        id: 'prod-def-001',
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        productName: 'My Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockProductDefinition });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.upsertProductDefinition(
        '550e8400-e29b-41d4-a716-446655440000',
        'My Product'
      );

      // Verify the PUT call was made with the correct URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        '/api/projects/550e8400-e29b-41d4-a716-446655440000/product',
        { productName: 'My Product' }
      );

      // Verify the returned data matches the mock
      expect(result).toEqual(mockProductDefinition);
      expect(result.id).toBe('prod-def-001');
      expect(result.projectId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.productName).toBe('My Product');
      expect(result.createdAt).toBe('2025-01-15T10:00:00.000Z');
      expect(result.updatedAt).toBe('2025-01-15T10:00:00.000Z');
    });
  });

  // ============================================================================
  // Test 2: upsertProductDefinition properly encodes projectId in URL
  //         via encodeURIComponent
  // ============================================================================
  describe('URL encoding of projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('properly encodes projectId in URL via encodeURIComponent', async () => {
      const mockProductDefinition = {
        id: 'prod-def-002',
        projectId: 'id-with-special/chars&more',
        productName: 'Test Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockProductDefinition });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.upsertProductDefinition(
        'id-with-special/chars&more',
        'Test Product'
      );

      // Verify the projectId was encoded in the URL
      const calledUrl = mockPut.mock.calls[0][0];
      expect(calledUrl).toBe(
        `/api/projects/${encodeURIComponent('id-with-special/chars&more')}/product`
      );
      // The encoded URL should contain %2F and %26 instead of / and &
      expect(calledUrl).toContain('id-with-special%2Fchars%26more');
      expect(calledUrl).not.toContain('id-with-special/chars&more');
    });
  });

  // ============================================================================
  // Test 3: upsertProductDefinition throws AxiosError when backend returns 500
  // ============================================================================
  describe('backend error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws AxiosError when backend returns 500 (error preserved for caller)', async () => {
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
      const mockPut = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Verify the error is thrown (not swallowed) and preserved for the caller
      await expect(
        archModelClient.upsertProductDefinition(
          '550e8400-e29b-41d4-a716-446655440000',
          'My Product'
        )
      ).rejects.toMatchObject({
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: {
          status: 500,
        },
      });
    });
  });
});
