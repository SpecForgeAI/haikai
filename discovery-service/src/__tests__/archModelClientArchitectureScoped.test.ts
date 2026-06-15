/**
 * Tests for discovery-service archModelClient architecture-scoped behaviour.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing — Task Group 5.
 *
 * Covers:
 * 1. The three entity-fetch helpers (getService / getApplication / getAppComponent)
 *    embed `/architectures/{architectureId}/` between `/projects/{projectId}/`
 *    and `/entities/...` in the upstream URL.
 * 2. `resolveDefaultArchitectureId(projectId)` calls
 *    `GET /api/projects/{projectId}/architectures` and returns the oldest
 *    non-archived architecture's id (skipping archived ones even if older).
 * 3. The resolver caches per-project for the duration of a run — a second call
 *    for the same `projectId` issues no additional upstream HTTP request.
 *    `resetDefaultArchitectureCache()` re-arms the cache so the next call
 *    issues a fresh request.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios so axios.create returns our spy-able instance
jest.mock('axios');

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ARCH_ID_DEFAULT = '11111111-1111-1111-1111-111111111111';
const ARCH_ID_NEWER = '22222222-2222-2222-2222-222222222222';
const ARCH_ID_ARCHIVED_OLDEST = '33333333-3333-3333-3333-333333333333';

describe('archModelClient — architecture-scoped entity fetches (spec 2026-05-01)', () => {
  // ==========================================================================
  // Test 1: getService embeds /architectures/{architectureId}/ in URL
  // ==========================================================================
  describe('getService', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET with /projects/{projectId}/architectures/{architectureId}/entities/services/{serviceId}', async () => {
      const serviceId = 'svc-uuid-001';
      const mockResponse = { id: serviceId, name: 'orders-service' };

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockInterceptors = { response: { use: jest.fn() } };
      axios.create = jest.fn().mockReturnValue({
        get: mockGet,
        interceptors: mockInterceptors,
      });

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getService(PROJECT_ID, ARCH_ID_DEFAULT, serviceId);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID_DEFAULT)}/entities/services/${encodeURIComponent(serviceId)}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  // ==========================================================================
  // Test 2: getApplication embeds /architectures/{architectureId}/ in URL
  // ==========================================================================
  describe('getApplication', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET with /projects/{projectId}/architectures/{architectureId}/entities/applications/{applicationId}', async () => {
      const appId = 'app-uuid-001';
      const mockResponse = { id: appId, name: 'orders-app' };

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockInterceptors = { response: { use: jest.fn() } };
      axios.create = jest.fn().mockReturnValue({
        get: mockGet,
        interceptors: mockInterceptors,
      });

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getApplication(PROJECT_ID, ARCH_ID_DEFAULT, appId);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID_DEFAULT)}/entities/applications/${encodeURIComponent(appId)}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  // ==========================================================================
  // Test 3: getAppComponent embeds /architectures/{architectureId}/ in URL
  // ==========================================================================
  describe('getAppComponent', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls GET with /projects/{projectId}/architectures/{architectureId}/entities/app_components/{appComponentId}', async () => {
      const compId = 'comp-uuid-001';
      const mockResponse = { id: compId, name: 'payments-component' };

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockInterceptors = { response: { use: jest.fn() } };
      axios.create = jest.fn().mockReturnValue({
        get: mockGet,
        interceptors: mockInterceptors,
      });

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getAppComponent(PROJECT_ID, ARCH_ID_DEFAULT, compId);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID_DEFAULT)}/entities/app_components/${encodeURIComponent(compId)}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  // ==========================================================================
  // Test 4: resolveDefaultArchitectureId hits the list endpoint and picks the
  // oldest non-archived (skipping an even-older archived row).
  // ==========================================================================
  describe('resolveDefaultArchitectureId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls the list endpoint and returns the oldest non-archived architecture id', async () => {
      // Backend returns three architectures:
      //   - archived (oldest by created_at) — must be skipped
      //   - non-archived (middle) — this is the expected `Default`
      //   - non-archived (newest) — should NOT be picked
      const listResponse = [
        {
          id: ARCH_ID_ARCHIVED_OLDEST,
          project_id: PROJECT_ID,
          name: 'Old Archived',
          description: null,
          tags: [],
          archived: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: ARCH_ID_DEFAULT,
          project_id: PROJECT_ID,
          name: 'Default',
          description: null,
          tags: [],
          archived: false,
          created_at: '2024-06-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
        },
        {
          id: ARCH_ID_NEWER,
          project_id: PROJECT_ID,
          name: 'Target State',
          description: null,
          tags: [],
          archived: false,
          created_at: '2025-02-01T00:00:00Z',
          updated_at: '2025-02-01T00:00:00Z',
        },
      ];

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: listResponse });
      const mockInterceptors = { response: { use: jest.fn() } };
      axios.create = jest.fn().mockReturnValue({
        get: mockGet,
        interceptors: mockInterceptors,
      });

      const { archModelClient } = require('../services/archModelClient');

      const resolved = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/projects/${encodeURIComponent(PROJECT_ID)}/architectures`
      );
      expect(resolved).toBe(ARCH_ID_DEFAULT);
    });
  });

  // ==========================================================================
  // Test 5: per-run cache — second call for same projectId issues no
  // additional upstream HTTP request; resetDefaultArchitectureCache re-arms.
  // ==========================================================================
  describe('resolveDefaultArchitectureId — per-run cache', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('caches per-project for the run; reset re-arms', async () => {
      const listResponse = [
        {
          id: ARCH_ID_DEFAULT,
          project_id: PROJECT_ID,
          name: 'Default',
          description: null,
          tags: [],
          archived: false,
          created_at: '2024-06-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
        },
      ];

      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: listResponse });
      const mockInterceptors = { response: { use: jest.fn() } };
      axios.create = jest.fn().mockReturnValue({
        get: mockGet,
        interceptors: mockInterceptors,
      });

      const { archModelClient } = require('../services/archModelClient');

      // First call — issues upstream request.
      const first = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);
      // Second call — should be served from cache (no extra upstream request).
      const second = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);

      expect(first).toBe(ARCH_ID_DEFAULT);
      expect(second).toBe(ARCH_ID_DEFAULT);
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Reset between runs — third call MUST hit the upstream again.
      archModelClient.resetDefaultArchitectureCache();
      const third = await archModelClient.resolveDefaultArchitectureId(PROJECT_ID);

      expect(third).toBe(ARCH_ID_DEFAULT);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });
});
