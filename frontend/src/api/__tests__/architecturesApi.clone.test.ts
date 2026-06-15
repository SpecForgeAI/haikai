/**
 * Architectures API Client -- cloneArchitecture tests
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 5
 * Task 5.1: 2-4 focused tests for the new `cloneArchitecture` helper.
 *
 * Covers:
 *   1. Happy path: cloneArchitecture POSTs to the right URL with the right
 *      JSON body and returns the parsed Architecture DTO on 201.
 *   2. 422 archived_source: throws ArchitecturesApiError carrying
 *      `status: 422` and `body.code === "archived_source"` so the
 *      CloneArchitectureModal (Group 6) can render the footer banner.
 *   3. 409 duplicate_name: throws ArchitecturesApiError carrying
 *      `status: 409`, `body.code === "duplicate_name"`, and
 *      `body.field === "name"` so the modal can render the inline
 *      error under the Name field.
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming global.fetch (same pattern as the
 *     companion `architecturesApi.test.ts` file in this directory).
 *   - Kept in a separate file so the spec #6 tests are easy to scope
 *     independently of the spec #3 CRUD tests (per Task 5.3: run ONLY
 *     the tests written in 5.1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  cloneArchitecture,
  ArchitecturesApiError,
  type Architecture,
} from '../architecturesApi';

const PROJECT_ID = 'proj-uuid-123';
const SOURCE_ARCH_ID = 'src-arch-uuid-456';
const NEW_ARCH_ID = 'new-arch-uuid-789';

function buildArchitectureFixture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: NEW_ARCH_ID,
    projectId: PROJECT_ID,
    name: 'Copy of Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('architecturesApi -- cloneArchitecture (Task Group 5)', () => {
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
  // Test 1: happy path -- POST hits the right URL with the right body and
  // returns the parsed Architecture DTO on 201.
  // ---------------------------------------------------------------------------
  it('POSTs to /api/projects/.../architectures/.../clone with the payload and returns the new Architecture on 201', async () => {
    const cloned = buildArchitectureFixture({
      name: 'Copy of Current State',
      description: 'cloned baseline',
      tags: ['target-state'],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => cloned,
    });

    const result = await cloneArchitecture(PROJECT_ID, SOURCE_ARCH_ID, {
      name: 'Copy of Current State',
      description: 'cloned baseline',
      tags: ['target-state'],
    });

    expect(result).toEqual(cloned);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architectures/${SOURCE_ARCH_ID}/clone`
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      name: 'Copy of Current State',
      description: 'cloned baseline',
      tags: ['target-state'],
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2 (safety property d): 422 archived_source throws an
  // ArchitecturesApiError carrying status + body.code so the modal can
  // render the footer banner.
  // ---------------------------------------------------------------------------
  it('throws ArchitecturesApiError with status: 422 and body.code: "archived_source" on a 422 response', async () => {
    const errorBody = {
      code: 'archived_source',
      message: 'Cannot clone an archived architecture.',
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => errorBody,
    });

    let caught: unknown = null;
    try {
      await cloneArchitecture(PROJECT_ID, SOURCE_ARCH_ID, {
        name: 'Copy of Archived',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArchitecturesApiError);
    const err = caught as ArchitecturesApiError;
    expect(err.status).toBe(422);
    expect(err.body.code).toBe('archived_source');
    expect(err.body.message).toContain('archived');
  });

  // ---------------------------------------------------------------------------
  // Test 3 (safety property e foundation): 409 duplicate_name throws an
  // ArchitecturesApiError carrying status + body.code + body.field so the
  // modal can render the inline error under the Name field.
  // ---------------------------------------------------------------------------
  it('throws ArchitecturesApiError with status: 409, body.code: "duplicate_name", body.field: "name" on a 409 response', async () => {
    const errorBody = {
      code: 'duplicate_name',
      field: 'name',
      message: "An architecture named 'Copy of Default' already exists in this project.",
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => errorBody,
    });

    let caught: unknown = null;
    try {
      await cloneArchitecture(PROJECT_ID, SOURCE_ARCH_ID, {
        name: 'Copy of Default',
      });
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
