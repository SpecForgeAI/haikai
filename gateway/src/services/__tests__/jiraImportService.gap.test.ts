/**
 * Gap Tests for Jira Import Service
 *
 * Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
 * Task Group 4: Integration Tests & Gap Analysis
 *
 * These tests fill coverage gaps identified in TG4 review of TG1-TG3 tests.
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
  importJiraRoadmap,
  generateDeterministicId,
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
// Gap Tests
// ---------------------------------------------------------------------------

describe('jiraImportService -- gap tests (TG4)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Gap 1: Two-phase ordering -- INITIATIVEs must be persisted before EPICs
  // -------------------------------------------------------------------------

  it('should upsert all INITIATIVEs before any EPICs (two-phase ordering)', async () => {
    // Arrange: 1 initiative + 1 epic, both new
    const jiraItems: WorkItemDto[] = [
      buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
      buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    // Phase 1: POST initiative
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => jiraItems[0],
    });

    // Phase 2: POST epic
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => jiraItems[1],
    });

    await importJiraRoadmap({
      projectId: 'test-project',
      jql: 'project = PROJ',
      jiraProjectKey: 'PROJ',
    });

    // Verify ordering: call[0] is GET, call[1] is POST initiative, call[2] is POST epic
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Extract POST bodies in order and verify initiative comes before epic
    const call1Body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const call2Body = JSON.parse(mockFetch.mock.calls[2][1].body);

    expect(call1Body.type).toBe('INITIATIVE');
    expect(call2Body.type).toBe('EPIC');

    // Verify call[1] (initiative POST) happened before call[2] (epic POST)
    // by checking invocation order from the mock
    expect(mockFetch.mock.invocationCallOrder[1]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[2],
    );
  });

  // -------------------------------------------------------------------------
  // Gap 2: Parent_id update -- when EPIC's parent changes, PUT uses new parent
  // -------------------------------------------------------------------------

  it('should update parent_id when an EPIC parent changes between imports', async () => {
    // Arrange: EPIC previously had parent init-1, now has parent init-2
    const jiraItems: WorkItemDto[] = [
      buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
      buildWorkItem({ id: 'init-2', type: 'INITIATIVE', external_key: 'PROJ-2', external_system: 'JIRA' }),
      buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-2' }),
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> epic already exists with old parent_id=init-1
    const existingItems: WorkItemDto[] = [
      buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
      buildWorkItem({ id: 'init-2', type: 'INITIATIVE', external_key: 'PROJ-2', external_system: 'JIRA' }),
      buildWorkItem({ id: 'epic-1', type: 'EPIC', external_key: 'PROJ-10', external_system: 'JIRA', parent_id: 'init-1' }),
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => existingItems,
    });

    // Phase 1: PUT for init-1 (update)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => existingItems[0],
    });

    // Phase 1: PUT for init-2 (update)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => existingItems[1],
    });

    // Phase 2: PUT for epic-1 (update with new parent)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...existingItems[2], parent_id: 'init-2' }),
    });

    const result = await importJiraRoadmap({
      projectId: 'test-project',
      jql: 'project = PROJ',
      jiraProjectKey: 'PROJ',
    });

    // Verify the epic was updated (not created)
    expect(result.updatedEpics).toBe(1);
    expect(result.createdEpics).toBe(0);

    // Verify the PUT body for the epic includes the new parent_id (init-2)
    // call[0] = GET, call[1] = PUT init-1, call[2] = PUT init-2, call[3] = PUT epic-1
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const epicPutBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(epicPutBody.parent_id).toBe('init-2');
  });

  // -------------------------------------------------------------------------
  // Gap 3: Null external_key items excluded from lookup map
  // -------------------------------------------------------------------------

  it('should exclude items with null external_key from lookup map (no false matches)', async () => {
    // Arrange: jira-service returns 1 initiative
    const jiraItems: WorkItemDto[] = [
      buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> includes an item with null external_key
    // This should NOT match anything and should NOT cause errors
    const existingItems: WorkItemDto[] = [
      buildWorkItem({
        id: 'existing-no-key',
        type: 'INITIATIVE',
        external_key: null,
        external_system: null,
        title: 'Manual Initiative',
      }),
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => existingItems,
    });

    // Phase 1: POST for init-1 (should be created, not matched to existing-no-key)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => jiraItems[0],
    });

    const result = await importJiraRoadmap({
      projectId: 'test-project',
      jql: 'project = PROJ',
      jiraProjectKey: 'PROJ',
    });

    // The INITIATIVE should be created, not updated (the null-key item should not match)
    expect(result.createdInitiatives).toBe(1);
    expect(result.updatedInitiatives).toBe(0);

    // Verify POST was used (not PUT)
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
  });

  // -------------------------------------------------------------------------
  // Gap 4: Empty JQL result (0 items) returns all counts 0
  // -------------------------------------------------------------------------

  it('should return all counts as 0 when jira-service returns an empty array', async () => {
    // Arrange: jira-service returns no items
    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> empty (still fetched)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const result = await importJiraRoadmap({
      projectId: 'test-project',
      jql: 'project = PROJ AND issuetype = None',
      jiraProjectKey: 'PROJ',
    });

    // All counts should be 0
    expect(result.createdInitiatives).toBe(0);
    expect(result.updatedInitiatives).toBe(0);
    expect(result.createdEpics).toBe(0);
    expect(result.updatedEpics).toBe(0);
    expect(result.warnings).toHaveLength(0);

    // Only 1 fetch call: the GET for listing existing items (no POST/PUT calls needed)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
  });

  // -------------------------------------------------------------------------
  // Gap 5: Architecture-model-service 500 during upsert propagates as error
  // -------------------------------------------------------------------------

  it('should propagate architecture-model-service 500 error during upsert as an error', async () => {
    // Arrange: jira-service returns 1 initiative
    const jiraItems: WorkItemDto[] = [
      buildWorkItem({ id: 'init-1', type: 'INITIATIVE', external_key: 'PROJ-1', external_system: 'JIRA' }),
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    // Phase 1: POST initiative -> architecture-model-service returns 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Database connection failed',
    });

    // Act & Assert: the error should propagate
    await expect(
      importJiraRoadmap({
        projectId: 'test-project',
        jql: 'project = PROJ',
        jiraProjectKey: 'PROJ',
      }),
    ).rejects.toThrow(/Failed to create work item.*500/);
  });

  // -------------------------------------------------------------------------
  // Gap 6: jiraBrowseBaseUrl enriches external_url on POSTed bodies
  // -------------------------------------------------------------------------

  it('should enrich work items with correct external_url from jiraBrowseBaseUrl config', async () => {
    // Arrange: jira-service returns 1 initiative without external_url set
    const jiraItems: WorkItemDto[] = [
      buildWorkItem({
        id: 'init-1',
        type: 'INITIATIVE',
        external_key: 'PROJ-99',
        external_system: 'JIRA',
        external_url: null,
      }),
    ];

    mockedAxios.get.mockResolvedValueOnce({ data: jiraItems });

    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Phase 0: GET existing -> empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    // Phase 1: POST initiative
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => jiraItems[0],
    });

    await importJiraRoadmap({
      projectId: 'test-project',
      jql: 'project = PROJ',
      jiraProjectKey: 'PROJ',
    });

    // Verify the POST body includes the correctly constructed external_url
    // The mock config has jiraBrowseBaseUrl = 'https://jira.example.com'
    const postBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(postBody.external_url).toBe('https://jira.example.com/browse/PROJ-99');
  });
});
