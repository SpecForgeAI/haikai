/**
 * Architectures API Client -- Selective Copy helpers tests
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 6
 * Task 6.1: 2-6 focused tests for the three new helpers.
 *
 * Covers:
 *   1. Happy path inventory: getElementsInventory hits the right URL and
 *      returns the parsed ElementInventoryResponse on 200.
 *   2. Happy path preflight: selectiveCopyPreflight POSTs to the right URL
 *      with the right body and returns the parsed
 *      SelectiveCopyPreflightResponse on 200.
 *   3. Happy path commit: selectiveCopyCommit POSTs to the right URL with
 *      the right body and returns the parsed SelectiveCopyCommitResponse
 *      on 200.
 *   4. Error path: a mocked 422 `{code: "archived_source"}` response from
 *      selectiveCopyPreflight throws ArchitecturesApiError carrying
 *      `status: 422` and `body.code === "archived_source"`. Representative
 *      coverage for all the branches the wizard switches on (the same
 *      `parseError` helper handles every non-2xx for all three functions).
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming global.fetch (matches the existing
 *     architecturesApi.test.ts and architecturesApi.clone.test.ts pattern
 *     in this directory).
 *   - Kept in a separate file so the spec #7 tests are easy to scope
 *     independently of the spec #3 / spec #6 tests (per Task 6.3: run
 *     ONLY the tests written in 6.1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getElementsInventory,
  selectiveCopyPreflight,
  selectiveCopyCommit,
  ArchitecturesApiError,
  type ElementInventoryResponse,
  type SelectiveCopyPreflightResponse,
  type SelectiveCopyCommitResponse,
} from '../architecturesApi';

const PROJECT_ID = 'proj-uuid-123';
const SOURCE_ARCH_ID = 'src-arch-uuid-456';
const TARGET_ARCH_ID = 'tgt-arch-uuid-789';

describe('architecturesApi -- Selective Copy helpers (Task Group 6)', () => {
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
  // Test 1: getElementsInventory happy path -- GET hits the right URL and
  // returns the parsed ElementInventoryResponse on 200.
  // ---------------------------------------------------------------------------
  it('getElementsInventory GETs the right URL and returns the parsed inventory on 200', async () => {
    const inventory: ElementInventoryResponse = {
      domains: [
        {
          name: 'Applications',
          types: [
            {
              name: 'Application',
              entityType: 'application',
              instances: [
                { id: 'app-1', name: 'Customer Portal' },
                { id: 'app-2', name: 'Billing Service' },
              ],
            },
          ],
        },
        { name: 'Data', types: [] },
        { name: 'Business', types: [] },
        { name: 'UI', types: [] },
        { name: 'Behavioural', types: [] },
        { name: 'Diagrams', types: [] },
      ],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => inventory,
    });

    const result = await getElementsInventory(PROJECT_ID, SOURCE_ARCH_ID);

    expect(result).toEqual(inventory);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architectures/${SOURCE_ARCH_ID}/elements-inventory`
    );
    // GET -- no method override, no body, no Content-Type header.
    expect(options).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 2: selectiveCopyPreflight happy path -- POST hits the right URL
  // with the right body and returns the parsed preflight response on 200.
  // ---------------------------------------------------------------------------
  it('selectiveCopyPreflight POSTs to the right URL with the payload and returns the parsed response on 200', async () => {
    const preflight: SelectiveCopyPreflightResponse = {
      conflicts: [
        {
          elementId: 'app-1',
          elementType: 'application',
          name: 'Customer Portal',
          conflictReason: 'same_uuid',
        },
      ],
      autoIncluded: [
        {
          elementId: 'data-1',
          elementType: 'data_entity',
          name: 'Customer',
          includedBecause: 'Customer Portal',
        },
      ],
      summary: {
        totalSelected: 1,
        conflictCount: 1,
        autoIncludedCount: 1,
        willCopyCount: 1,
      },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => preflight,
    });

    const result = await selectiveCopyPreflight(PROJECT_ID, TARGET_ARCH_ID, {
      sourceArchitectureId: SOURCE_ARCH_ID,
      elementIds: ['app-1'],
    });

    expect(result).toEqual(preflight);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architectures/${TARGET_ARCH_ID}/selective-copy/preflight`
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      sourceArchitectureId: SOURCE_ARCH_ID,
      elementIds: ['app-1'],
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: selectiveCopyCommit happy path -- POST hits the right URL with
  // the right body and returns the parsed commit response on 200.
  // ---------------------------------------------------------------------------
  it('selectiveCopyCommit POSTs to the right URL with the payload and returns the parsed response on 200', async () => {
    const commit: SelectiveCopyCommitResponse = {
      copied: 3,
      skipped: 1,
      overwritten: 1,
      duplicated: 1,
      autoIncluded: 1,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => commit,
    });

    const result = await selectiveCopyCommit(PROJECT_ID, TARGET_ARCH_ID, {
      sourceArchitectureId: SOURCE_ARCH_ID,
      elementIds: ['app-1', 'app-2', 'data-1'],
      resolutions: [
        { elementId: 'app-1', action: 'skip' },
        { elementId: 'app-2', action: 'overwrite' },
      ],
    });

    expect(result).toEqual(commit);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architectures/${TARGET_ARCH_ID}/selective-copy/commit`
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({
      sourceArchitectureId: SOURCE_ARCH_ID,
      elementIds: ['app-1', 'app-2', 'data-1'],
      resolutions: [
        { elementId: 'app-1', action: 'skip' },
        { elementId: 'app-2', action: 'overwrite' },
      ],
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: selectiveCopyPreflight 422 archived_source throws an
  // ArchitecturesApiError carrying status + body.code so the wizard can
  // render the footer banner. Representative coverage for all the branches
  // the wizard switches on (same parseError helper handles every non-2xx).
  // ---------------------------------------------------------------------------
  it('selectiveCopyPreflight throws ArchitecturesApiError with status: 422 and body.code: "archived_source" on a 422 response', async () => {
    const errorBody = {
      code: 'archived_source',
      message: 'Cannot selectively copy from an archived architecture.',
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => errorBody,
    });

    let caught: unknown = null;
    try {
      await selectiveCopyPreflight(PROJECT_ID, TARGET_ARCH_ID, {
        sourceArchitectureId: SOURCE_ARCH_ID,
        elementIds: ['app-1'],
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
});
