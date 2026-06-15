/**
 * Tests for Projects API Client - Organisation ID parameter and mapping
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Task Group 2: Update projectsApi.ts with organisationId parameter
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Task Group 1: Update ProjectDto to Include organisationId mapping
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createProject, listProjects, ProjectDto } from '../api/projectsApi';

describe('projectsApi - organisationId parameter', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Sample project response (snake_case from API)
  const sampleProjectSnake = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Project',
    project_parent_folder: '/projects/test',
    project_hierarchy: null,
    organisation_id: null,
    is_active: true,
    created_at: '2026-01-18T12:00:00Z',
    updated_at: '2026-01-18T12:00:00Z',
  };

  it('includes organisation_id in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleProjectSnake,
    });

    const organisationId = 'org-550e8400-e29b-41d4-a716-446655440000';
    await createProject('Test Project', '/projects/test', undefined, organisationId);

    // Verify fetch was called with correct URL and method
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/projects');
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers).toEqual({ 'Content-Type': 'application/json' });

    // Parse the body and verify it contains organisation_id (order-independent)
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody).toEqual({
      name: 'Test Project',
      project_parent_folder: '/projects/test',
      project_hierarchy: null,
      set_active: true,
      organisation_id: organisationId,
    });
  });

  it('omits organisation_id when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleProjectSnake,
    });

    await createProject('Test Project', '/projects/test');

    // Verify fetch was called without organisation_id in body
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    expect(requestBody).not.toHaveProperty('organisation_id');
    expect(requestBody).toEqual({
      name: 'Test Project',
      project_parent_folder: '/projects/test',
      project_hierarchy: null,
      set_active: true,
    });
  });

  it('returns mapped ProjectDto with correct fields including organisationId', async () => {
    const projectWithOrg = {
      ...sampleProjectSnake,
      organisation_id: 'org-id-123',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => projectWithOrg,
    });

    const result = await createProject(
      'Test Project',
      '/projects/test',
      'ClientA',
      'org-id-123'
    );

    // Verify response is correctly mapped to camelCase including organisationId
    expect(result).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test Project',
      projectParentFolder: '/projects/test',
      projectHierarchy: null,
      organisationId: 'org-id-123',
      repoUrl: null,
      isActive: true,
      createdAt: '2026-01-18T12:00:00Z',
      updatedAt: '2026-01-18T12:00:00Z',
      // Newer optional project settings default to null in the mapper
      perStoryContextTokenCap: null,
      crossStoryContextTokenCap: null,
      autoRunPass2: null,
      maxContractUploadFileSizeMb: null,
      // Spec 2026-06-12: implementation-service init/repo-map fields
      implementationInitSuccess: null,
      implementationMode: null,
      implementationProjectDir: null,
      implementationRepos: [],
    });
  });
});

/**
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Task Group 1: Update ProjectDto to Include organisationId mapping
 */
describe('projectsApi - organisationId mapping in listProjects', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps organisation_id to organisationId from API response', async () => {
    const snakeCaseResponse = [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: 'ClientA',
        organisation_id: 'org-123-abc',
        is_active: true,
        created_at: '2026-01-18T12:00:00Z',
        updated_at: '2026-01-18T12:00:00Z',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => snakeCaseResponse,
    });

    const result = await listProjects();

    expect(result).toHaveLength(1);
    expect(result[0].organisationId).toBe('org-123-abc');
  });

  it('maps null organisation_id to null organisationId', async () => {
    const snakeCaseResponse = [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Orphan Project',
        project_parent_folder: '/projects/orphan',
        project_hierarchy: null,
        organisation_id: null,
        is_active: false,
        created_at: '2026-01-18T12:00:00Z',
        updated_at: '2026-01-18T12:00:00Z',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => snakeCaseResponse,
    });

    const result = await listProjects();

    expect(result).toHaveLength(1);
    expect(result[0].organisationId).toBeNull();
  });

  it('preserves all existing ProjectDto fields after mapping with organisationId', async () => {
    const snakeCaseResponse = [
      {
        id: 'proj-id-456',
        name: 'Complete Project',
        project_parent_folder: '/projects/complete',
        project_hierarchy: 'Hierarchy A',
        organisation_id: 'org-789',
        is_active: true,
        created_at: '2026-01-15T10:00:00Z',
        updated_at: '2026-01-18T14:30:00Z',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => snakeCaseResponse,
    });

    const result = await listProjects();
    const project: ProjectDto = result[0];

    // Verify all fields are correctly mapped
    expect(project.id).toBe('proj-id-456');
    expect(project.name).toBe('Complete Project');
    expect(project.projectParentFolder).toBe('/projects/complete');
    expect(project.projectHierarchy).toBe('Hierarchy A');
    expect(project.organisationId).toBe('org-789');
    expect(project.isActive).toBe(true);
    expect(project.createdAt).toBe('2026-01-15T10:00:00Z');
    expect(project.updatedAt).toBe('2026-01-18T14:30:00Z');
  });
});
