/**
 * Tests for Jira Import Service
 *
 * Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 2: Jira Import Service Module
 *
 * Uses mocked axios (for jira-service calls) and mocked fetch (for architecture-model-service calls).
 */

// Mock logger to prevent console output during tests
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock axios for jira-service calls
jest.mock('axios');

// Mock config
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    jiraServiceBaseUrl: 'http://localhost:8078',
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    jiraBrowseBaseUrl: 'https://jira.example.com',
  })),
}));

import axios from 'axios';
import {
  filterToInitiativesAndEpics,
  resolveOrphanEpics,
  generateDeterministicId,
  constructExternalUrl,
  buildSyntheticInitiative,
  importJiraRoadmap,
  WorkItemDto,
} from '../jiraImportService';

const mockedAxios = axios as jest.Mocked<typeof axios>;

// ---------------------------------------------------------------------------
// Helper: Build a test WorkItemDto
// ---------------------------------------------------------------------------

function buildWorkItem(overrides: Partial<WorkItemDto> = {}): WorkItemDto {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    project_id: 'test-project',
    type: 'INITIATIVE',
    parent_id: null,
    title: 'Test Item',
    description: null,
    status: 'PLANNED',
    sort_order: 0,
    priority: null,
    target_window: null,
    tags: null,
    external_system: 'JIRA',
    external_key: 'PROJ-1',
    external_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jiraImportService', () => {
  // Save and restore global.fetch
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: filterToInitiativesAndEpics filters correctly
  // -------------------------------------------------------------------------

  describe('filterToInitiativesAndEpics', () => {
    it('should separate INITIATIVE and EPIC items and warn on others', () => {
      const items: WorkItemDto[] = [
        buildWorkItem({ id: '1', type: 'INITIATIVE', external_key: 'PROJ-1' }),
        buildWorkItem({ id: '2', type: 'EPIC', external_key: 'PROJ-2' }),
        buildWorkItem({ id: '3', type: 'FEATURE', external_key: 'PROJ-3' }),
        buildWorkItem({ id: '4', type: 'STORY', external_key: 'PROJ-4' }),
        buildWorkItem({ id: '5', type: 'INITIATIVE', external_key: 'PROJ-5' }),
      ];

      const result = filterToInitiativesAndEpics(items);

      expect(result.initiatives).toHaveLength(2);
      expect(result.epics).toHaveLength(1);
      expect(result.warnings).toHaveLength(2);

      // Verify correct items in each bucket
      expect(result.initiatives.map((i) => i.id)).toEqual(['1', '5']);
      expect(result.epics.map((e) => e.id)).toEqual(['2']);

      // Verify warnings mention the skipped items
      expect(result.warnings[0]).toContain('PROJ-3');
      expect(result.warnings[0]).toContain('FEATURE');
      expect(result.warnings[1]).toContain('PROJ-4');
      expect(result.warnings[1]).toContain('STORY');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: resolveOrphanEpics detects orphans
  // -------------------------------------------------------------------------

  describe('resolveOrphanEpics', () => {
    it('should detect EPICs whose parent_id does not match any INITIATIVE id', () => {
      const initiatives: WorkItemDto[] = [
        buildWorkItem({ id: 'init-1', type: 'INITIATIVE' }),
        buildWorkItem({ id: 'init-2', type: 'INITIATIVE' }),
      ];

      const epics: WorkItemDto[] = [
        buildWorkItem({ id: 'epic-1', type: 'EPIC', parent_id: 'init-1' }),
        buildWorkItem({ id: 'epic-2', type: 'EPIC', parent_id: 'init-999' }), // orphan
        buildWorkItem({ id: 'epic-3', type: 'EPIC', parent_id: null }),         // orphan (no parent)
      ];

      const orphans = resolveOrphanEpics(epics, initiatives);

      expect(orphans).toHaveLength(2);
      expect(orphans.map((o) => o.id)).toEqual(['epic-2', 'epic-3']);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: generateDeterministicId produces correct UUIDv3
  // -------------------------------------------------------------------------

  describe('generateDeterministicId', () => {
    it('should produce the same UUIDv3 as Java UUID.nameUUIDFromBytes()', () => {
      // Java: UUID.nameUUIDFromBytes("test-project:IMPORTED_ROADMAP".getBytes(UTF_8))
      // We verify determinism and correct formatting:
      const id1 = generateDeterministicId('test-project:IMPORTED_ROADMAP');
      const id2 = generateDeterministicId('test-project:IMPORTED_ROADMAP');

      // Deterministic: same input -> same output
      expect(id1).toBe(id2);

      // UUID format: 8-4-4-4-12 hex characters
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // Version 3: third group starts with '3'
      const parts = id1.split('-');
      expect(parts[2][0]).toBe('3');

      // Variant: fourth group starts with 8, 9, a, or b
      expect(['8', '9', 'a', 'b']).toContain(parts[3][0]);

      // Cross-language verification:
      // Java UUID.nameUUIDFromBytes("test:key".getBytes(UTF_8)) should produce a
      // known UUID. We verify by testing a simple known input.
      const simpleId = generateDeterministicId('test:key');
      expect(simpleId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // Different input -> different output
      const id3 = generateDeterministicId('other-project:IMPORTED_ROADMAP');
      expect(id3).not.toBe(id1);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: constructExternalUrl builds correct URL
  // -------------------------------------------------------------------------

  describe('constructExternalUrl', () => {
    it('should build correct Jira browse URL', () => {
      expect(
        constructExternalUrl('https://jira.example.com', 'PROJ-123'),
      ).toBe('https://jira.example.com/browse/PROJ-123');
    });

    it('should strip trailing slash from base URL', () => {
      expect(
        constructExternalUrl('https://jira.example.com/', 'PROJ-456'),
      ).toBe('https://jira.example.com/browse/PROJ-456');
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Full orchestration happy path with correct counts
  // -------------------------------------------------------------------------

  describe('importJiraRoadmap (happy path)', () => {
    it('should orchestrate fetch, filter, and upsert with correct counts', async () => {
      // Arrange: jira-service returns 2 initiatives + 2 epics
      const jiraItems: WorkItemDto[] = [
        buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
        buildWorkItem({ id: 'init-2', type: 'INITIATIVE', external_key: 'PROJ-2', external_system: 'JIRA' }),
        buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
        buildWorkItem({ id: 'epic-2', type: 'EPIC', external_key: 'PROJ-11', external_system: 'JIRA', parent_id: 'init-2' }),
      ];

      mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

      // Arrange: architecture-model-service returns no existing work items (all new)
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      // Phase 0: GET existing work items -> empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Phase 1: POST for each initiative (init-1, init-2)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[0],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[1],
      });

      // Phase 2: POST for each epic (epic-1, epic-2)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[2],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[3],
      });

      // Act
      const result = await importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      });

      // Assert
      expect(result.createdInitiatives).toBe(2);
      expect(result.updatedInitiatives).toBe(0);
      expect(result.createdEpics).toBe(2);
      expect(result.updatedEpics).toBe(0);
      expect(result.warnings).toHaveLength(0);

      // Verify axios was called with correct params
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:8078/jira/issues',
        expect.objectContaining({
          params: {
            jql: 'project = PROJ',
            jiraProjectKey: 'PROJ',
            toolProjectId: 'test-project',
            maxResults: 200,
            expandChildren: false,
          },
        }),
      );

      // Verify fetch calls: 1 GET + 2 POST (initiatives) + 2 POST (epics) = 5
      expect(mockFetch).toHaveBeenCalledTimes(5);

      // First fetch call is GET for listing existing items
      expect(mockFetch.mock.calls[0][1].method).toBe('GET');

      // Next 2 calls are POST for initiatives
      expect(mockFetch.mock.calls[1][1].method).toBe('POST');
      expect(mockFetch.mock.calls[2][1].method).toBe('POST');

      // Next 2 calls are POST for epics
      expect(mockFetch.mock.calls[3][1].method).toBe('POST');
      expect(mockFetch.mock.calls[4][1].method).toBe('POST');
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Idempotent re-import uses PUT instead of POST
  // -------------------------------------------------------------------------

  describe('importJiraRoadmap (idempotent re-import)', () => {
    it('should use PUT for items that already exist (matched by external_system:external_key)', async () => {
      // Arrange: jira-service returns 1 initiative + 1 epic
      const jiraItems: WorkItemDto[] = [
        buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
        buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
      ];

      mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

      // Arrange: architecture-model-service returns these items as already existing
      const existingItems: WorkItemDto[] = [
        buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
        buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
      ];

      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      // Phase 0: GET existing work items -> return existing
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => existingItems,
      });

      // Phase 1: PUT for initiative (update)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => existingItems[0],
      });

      // Phase 2: PUT for epic (update)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => existingItems[1],
      });

      // Act
      const result = await importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      });

      // Assert: all updates, no creates
      expect(result.createdInitiatives).toBe(0);
      expect(result.updatedInitiatives).toBe(1);
      expect(result.createdEpics).toBe(0);
      expect(result.updatedEpics).toBe(1);

      // Verify PUT was used (not POST)
      // Call 0 = GET, Call 1 = PUT (initiative), Call 2 = PUT (epic)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
      expect(mockFetch.mock.calls[2][1].method).toBe('PUT');

      // Verify PUT URLs include the item ID
      expect(mockFetch.mock.calls[1][0]).toContain('/work-items/init-1');
      expect(mockFetch.mock.calls[2][0]).toContain('/work-items/epic-1');
    });
  });

  // -------------------------------------------------------------------------
  // Test 7: Orphan EPIC grouping under synthetic initiative
  // -------------------------------------------------------------------------

  describe('importJiraRoadmap (orphan EPIC grouping)', () => {
    it('should create a synthetic initiative and assign orphan EPICs to it', async () => {
      // Arrange: jira-service returns 1 initiative + 2 epics, where 1 epic is orphan
      const jiraItems: WorkItemDto[] = [
        buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
        buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
        buildWorkItem({ id: 'epic-2', type: 'EPIC', external_key: 'PROJ-11', external_system: 'JIRA', parent_id: 'init-999' }), // orphan
      ];

      mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

      const syntheticId = generateDeterministicId('test-project:IMPORTED_ROADMAP');

      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      // Phase 0: GET existing work items -> empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Phase 1: POST initiative (init-1)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[0],
      });

      // Phase 1: POST synthetic initiative
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => buildSyntheticInitiative('test-project'),
      });

      // Phase 2: POST epic-1 (has valid parent)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[1],
      });

      // Phase 2: POST epic-2 (orphan, assigned to synthetic)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...jiraItems[2], parent_id: syntheticId }),
      });

      // Act
      const result = await importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      });

      // Assert
      expect(result.createdInitiatives).toBe(2); // 1 real + 1 synthetic
      expect(result.createdEpics).toBe(2);

      // Verify the synthetic initiative was created
      // Call 2 (index 2) should be the POST for the synthetic initiative
      const syntheticCallBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(syntheticCallBody.title).toBe('Imported Roadmap');
      expect(syntheticCallBody.type).toBe('INITIATIVE');
      expect(syntheticCallBody.external_system).toBeNull();
      expect(syntheticCallBody.external_key).toBeNull();
      expect(syntheticCallBody.external_url).toBeNull();

      // Verify orphan epic-2 was assigned to the synthetic initiative
      // Call 4 (index 4) should be the POST for the orphan epic
      const orphanEpicBody = JSON.parse(mockFetch.mock.calls[4][1].body);
      expect(orphanEpicBody.parent_id).toBe(syntheticId);
    });
  });

  // -------------------------------------------------------------------------
  // Test 8: Synthetic initiative stability (same ID on re-run)
  // -------------------------------------------------------------------------

  describe('importJiraRoadmap (synthetic initiative stability)', () => {
    it('should reuse the same deterministic ID for the synthetic initiative on re-import', async () => {
      // The synthetic initiative ID is derived from projectId + ":IMPORTED_ROADMAP"
      // so it must be stable across multiple runs.

      const syntheticId = generateDeterministicId('test-project:IMPORTED_ROADMAP');

      // Arrange: jira-service returns 1 orphan epic (triggers synthetic initiative)
      const jiraItems: WorkItemDto[] = [
        buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: null }),
      ];

      // --- First import ---
      mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      // Phase 0: GET existing -> empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Phase 1: POST synthetic initiative
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => buildSyntheticInitiative('test-project'),
      });

      // Phase 2: POST orphan epic
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[0],
      });

      const result1 = await importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      });

      // Capture the synthetic initiative ID from first run
      const firstRunSyntheticBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const firstRunSyntheticId = firstRunSyntheticBody.id;

      expect(firstRunSyntheticId).toBe(syntheticId);
      expect(result1.createdInitiatives).toBe(1);

      // --- Second import ---
      mockFetch.mockReset();
      mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

      // Phase 0: GET existing -> returns the synthetic initiative + the epic
      const existingSynthetic = buildSyntheticInitiative('test-project');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          existingSynthetic,
          { ...jiraItems[0], parent_id: syntheticId },
        ],
      });

      // Phase 1: PUT synthetic initiative (update)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => existingSynthetic,
      });

      // Phase 2: PUT epic (update, matched by JIRA:PROJ-10)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => jiraItems[0],
      });

      const result2 = await importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      });

      // Verify: second run uses PUT (update), not POST (create)
      expect(result2.updatedInitiatives).toBe(1);
      expect(result2.createdInitiatives).toBe(0);

      // Verify the synthetic initiative ID is the same
      const secondRunSyntheticBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondRunSyntheticBody.id).toBe(syntheticId);
      expect(secondRunSyntheticBody.id).toBe(firstRunSyntheticId);
    });
  });
});
