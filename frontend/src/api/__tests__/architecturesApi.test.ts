/**
 * Architectures API Client -- CRUD function tests
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 3
 * Task 3.1: 2-8 focused tests for the API client + context.
 *
 * Covers:
 *   1. createArchitecture POSTs to the right URL with the right JSON body
 *      and returns the parsed Architecture DTO on 201.
 *   2. updateArchitecture PATCHes to the right URL with the full
 *      {name, description, tags} payload and returns the parsed DTO on 200.
 *   3. archiveArchitecture POSTs to the .../archive URL and returns the
 *      parsed DTO with archived: true on 200.
 *   4. ArchitecturesApiError thrown on 409 carries `status: 409` and
 *      `body.code === "duplicate_name"` so modals can branch for inline
 *      validation (safety property a foundation).
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming global.fetch (matches the existing
 *     productDefinitionApi.test.ts pattern in this directory).
 *   - vi.resetModules() between tests so the API_BASE constant is
 *     re-evaluated against the current import.meta.env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createArchitecture,
  updateArchitecture,
  archiveArchitecture,
  ArchitecturesApiError,
  type Architecture,
} from '../architecturesApi';

const PROJECT_ID = 'proj-uuid-123';
const ARCH_ID = 'arch-uuid-456';

function buildArchitectureFixture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: ARCH_ID,
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
    ...overrides,
  };
}

describe('architecturesApi -- CRUD functions (Task Group 3)', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: createArchitecture happy path
  // ---------------------------------------------------------------------------
  it('createArchitecture POSTs to the right URL with the right body and returns the DTO', async () => {
    const created = buildArchitectureFixture({
      name: 'Target State',
      description: 'desired future architecture',
      tags: ['target-state'],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => created,
    });

    const result = await createArchitecture(PROJECT_ID, {
      name: 'Target State',
      description: 'desired future architecture',
      tags: ['target-state'],
    });

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/architectures`);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      name: 'Target State',
      description: 'desired future architecture',
      tags: ['target-state'],
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: updateArchitecture happy path -- PATCH carries the full payload
  // (safety property c foundation: name + description + tags atomic)
  // ---------------------------------------------------------------------------
  it('updateArchitecture PATCHes the right URL with the full {name, description, tags} payload', async () => {
    const updated = buildArchitectureFixture({
      name: 'Renamed',
      description: 'new description',
      tags: ['x', 'y'],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => updated,
    });

    const result = await updateArchitecture(PROJECT_ID, ARCH_ID, {
      name: 'Renamed',
      description: 'new description',
      tags: ['x', 'y'],
    });

    expect(result).toEqual(updated);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/architectures/${ARCH_ID}`);
    expect(options.method).toBe('PATCH');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      name: 'Renamed',
      description: 'new description',
      tags: ['x', 'y'],
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: archiveArchitecture happy path
  // ---------------------------------------------------------------------------
  it('archiveArchitecture POSTs to the /archive URL and returns the DTO with archived: true', async () => {
    const archived = buildArchitectureFixture({ archived: true });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => archived,
    });

    const result = await archiveArchitecture(PROJECT_ID, ARCH_ID);

    expect(result).toEqual(archived);
    expect(result.archived).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/architectures/${ARCH_ID}/archive`);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    // POST /archive carries no body -- the architecture id in the URL is the
    // only input the server needs.
    expect(options.body).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 4 (safety property a foundation): 409 Conflict throws an
  // ArchitecturesApiError carrying status + body.code so the modal can
  // render the duplicate-name message inline next to the Name field.
  // ---------------------------------------------------------------------------
  it('throws ArchitecturesApiError carrying status: 409 and body.code: "duplicate_name" on a 409 response', async () => {
    const errorBody = {
      code: 'duplicate_name',
      field: 'name',
      message: "An architecture named 'Default' already exists in this project.",
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => errorBody,
    });

    let caught: unknown = null;
    try {
      await createArchitecture(PROJECT_ID, { name: 'Default' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArchitecturesApiError);
    const err = caught as ArchitecturesApiError;
    expect(err.status).toBe(409);
    expect(err.body.code).toBe('duplicate_name');
    expect(err.body.field).toBe('name');
    expect(err.body.message).toContain('already exists');
  });
});
