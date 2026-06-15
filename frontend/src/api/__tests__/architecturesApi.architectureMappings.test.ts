/**
 * Architectures API Client -- Architecture Element Mapping helpers tests
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 5
 * Task 5.1: 2-8 focused tests for the four new mapping helpers + the
 * extended SelectiveCopyCommitRequest/Response shapes.
 *
 * Coverage:
 *   1. listArchitectureMappings -- builds the URL with filter querystring
 *      (omitting undefined values) and parses the response on 200.
 *   2. createArchitectureMapping -- POSTs the body verbatim to the right
 *      URL and returns the parsed DTO on 201.
 *   3. updateArchitectureMapping -- PUTs to the right URL with mappingId.
 *   4. deleteArchitectureMapping -- DELETEs to the right URL and resolves
 *      void on 204 (no body parse).
 *   5. All four helpers throw ArchitecturesApiError on non-2xx with
 *      body.code populated (representative: createArchitectureMapping
 *      surfaces 422 {code: "duplicate_mapping"}; the same parseError
 *      helper handles every helper's non-2xx, so one branch is sufficient
 *      coverage for the shared path).
 *
 * Test strategy:
 *   - Vitest with vi.fn() shimming global.fetch (matches the existing
 *     architecturesApi.test.ts and architecturesApi.selectiveCopy.test.ts
 *     pattern in this directory).
 *   - Kept in a separate file so the spec 2026-05-15 tests are easy to
 *     scope independently of earlier specs (per Task 5.4: run ONLY the
 *     tests written in 5.1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  listArchitectureMappings,
  createArchitectureMapping,
  updateArchitectureMapping,
  deleteArchitectureMapping,
  ArchitecturesApiError,
  type ArchitectureElementMappingDto,
  type CreateArchitectureElementMappingRequest,
  type UpdateArchitectureElementMappingRequest,
} from '../architecturesApi';

const PROJECT_ID = 'proj-uuid-123';
const SOURCE_ARCH_ID = 'src-arch-uuid-456';
const TARGET_ARCH_ID = 'tgt-arch-uuid-789';
const MAPPING_ID = 'mapping-uuid-001';

function buildMapping(
  overrides: Partial<ArchitectureElementMappingDto> = {}
): ArchitectureElementMappingDto {
  return {
    id: MAPPING_ID,
    projectId: PROJECT_ID,
    sourceArchitectureId: SOURCE_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    sourceElementType: 'application',
    sourceElementId: 'app-1',
    targetElementType: 'application',
    targetElementId: 'app-1-target',
    mappingType: 'equivalent',
    status: 'confirmed',
    createdByTask: 'selective-copy-with-auto-map',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    notes: null,
    confidence: 1.0,
    ...overrides,
  };
}

describe('architecturesApi -- Architecture Element Mapping helpers (Task Group 5)', () => {
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
  // Test 1: listArchitectureMappings -- builds the URL with the right
  // querystring (omitting undefined values), GETs it, and returns the parsed
  // DTO array on 200.
  // ---------------------------------------------------------------------------
  it('listArchitectureMappings GETs the right URL with filter querystring and returns the parsed DTOs on 200', async () => {
    const mappings: ArchitectureElementMappingDto[] = [
      buildMapping(),
      buildMapping({ id: 'mapping-uuid-002', sourceElementId: 'app-2', targetElementId: 'app-2-target' }),
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mappings,
    });

    const result = await listArchitectureMappings(PROJECT_ID, {
      sourceArchitectureId: SOURCE_ARCH_ID,
      targetArchitectureId: TARGET_ARCH_ID,
      // Provide a couple of undefined fields to verify they are omitted from
      // the querystring (the helper must defensively skip them so the URL
      // stays clean and the AMS controller does not see empty params).
      sourceElementType: undefined,
      targetElementType: undefined,
      mappingType: 'equivalent',
      status: undefined,
      q: 'customer',
    });

    expect(result).toEqual(mappings);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    // Querystring contains only the defined fields, in URLSearchParams iteration
    // order (matches the helper's loop over Object.entries).
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architecture-mappings?sourceArchitectureId=${SOURCE_ARCH_ID}&targetArchitectureId=${TARGET_ARCH_ID}&mappingType=equivalent&q=customer`
    );
    // GET -- no method override, no body, no Content-Type header.
    expect(options).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 2: createArchitectureMapping -- POSTs to the right URL with the
  // body verbatim and returns the parsed DTO on 201.
  // ---------------------------------------------------------------------------
  it('createArchitectureMapping POSTs to the right URL with the payload and returns the parsed DTO on 201', async () => {
    const request: CreateArchitectureElementMappingRequest = {
      sourceArchitectureId: SOURCE_ARCH_ID,
      targetArchitectureId: TARGET_ARCH_ID,
      sourceElementType: 'application',
      sourceElementId: 'app-1',
      targetElementType: 'application',
      targetElementId: 'app-1-target',
      mappingType: 'renamed',
      status: 'proposed',
      notes: 'renamed for clarity',
      // Per spec: manual-add MUST default confidence to null (NOT 1.0).
      confidence: null,
    };
    const created = buildMapping({
      mappingType: 'renamed',
      status: 'proposed',
      createdByTask: 'mapping-review-modal-add',
      notes: 'renamed for clarity',
      confidence: null,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => created,
    });

    const result = await createArchitectureMapping(PROJECT_ID, request);

    expect(result).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/architecture-mappings`);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual(request);
  });

  // ---------------------------------------------------------------------------
  // Test 3: updateArchitectureMapping -- PUTs to the right URL with the
  // mappingId in the path and the body verbatim, returns the parsed DTO on
  // 200. Verifies that confidence: null is preserved on the wire (PATCH
  // semantics on a boxed Double -- per project_primitive_double_dto_overwrite).
  // ---------------------------------------------------------------------------
  it('updateArchitectureMapping PUTs to the right URL and returns the parsed DTO on 200', async () => {
    const request: UpdateArchitectureElementMappingRequest = {
      mappingType: 'replaced_by',
      status: 'needs_review',
      notes: 'investigate replacement plan',
      confidence: null,
    };
    const updated = buildMapping({
      mappingType: 'replaced_by',
      status: 'needs_review',
      createdByTask: 'mapping-review-modal-edit',
      notes: 'investigate replacement plan',
      confidence: null,
      updatedAt: '2026-05-15T11:00:00Z',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => updated,
    });

    const result = await updateArchitectureMapping(PROJECT_ID, MAPPING_ID, request);

    expect(result).toEqual(updated);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architecture-mappings/${MAPPING_ID}`
    );
    expect(options.method).toBe('PUT');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    // confidence: null must round-trip verbatim so the boxed Double on the
    // entity preserves null instead of silently wiping to 0.
    expect(JSON.parse(options.body)).toEqual(request);
  });

  // ---------------------------------------------------------------------------
  // Test 4: deleteArchitectureMapping -- DELETEs to the right URL and
  // resolves void on 204 (no body parse).
  // ---------------------------------------------------------------------------
  it('deleteArchitectureMapping DELETEs to the right URL and resolves void on 204', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      // 204 has no body; the helper must not call res.json() on success.
    });

    await expect(
      deleteArchitectureMapping(PROJECT_ID, MAPPING_ID)
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `/api/projects/${PROJECT_ID}/architecture-mappings/${MAPPING_ID}`
    );
    expect(options.method).toBe('DELETE');
  });

  // ---------------------------------------------------------------------------
  // Test 5: All four helpers throw ArchitecturesApiError on non-2xx with
  // body.code populated. Representative coverage: createArchitectureMapping
  // surfaces 422 {code: "duplicate_mapping"} (the unique-constraint path).
  // The same parseError helper handles every helper's non-2xx, so one
  // branch is sufficient -- but we also assert each of the other three
  // helpers throws ArchitecturesApiError on a generic 500 to lock in the
  // shared error-shape contract the wizard / Mapping Review surface relies
  // on for `body.code` branching.
  // ---------------------------------------------------------------------------
  it('all four helpers throw ArchitecturesApiError on non-2xx with body.code populated', async () => {
    // (a) createArchitectureMapping with 422 duplicate_mapping.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({
        code: 'duplicate_mapping',
        message: 'A mapping with these endpoints already exists.',
      }),
    });

    let caught: unknown = null;
    try {
      await createArchitectureMapping(PROJECT_ID, {
        sourceArchitectureId: SOURCE_ARCH_ID,
        targetArchitectureId: TARGET_ARCH_ID,
        sourceElementType: 'application',
        sourceElementId: 'app-1',
        targetElementType: 'application',
        targetElementId: 'app-1-target',
        mappingType: 'equivalent',
        status: 'confirmed',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArchitecturesApiError);
    const dupErr = caught as ArchitecturesApiError;
    expect(dupErr.status).toBe(422);
    expect(dupErr.body.code).toBe('duplicate_mapping');
    expect(dupErr.body.message).toContain('already exists');

    // (b) listArchitectureMappings on 500 -- generic error envelope.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'AMS down' }),
    });
    await expect(listArchitectureMappings(PROJECT_ID)).rejects.toBeInstanceOf(
      ArchitecturesApiError
    );

    // (c) updateArchitectureMapping on 404.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'mapping not found' }),
    });
    await expect(
      updateArchitectureMapping(PROJECT_ID, MAPPING_ID, { status: 'rejected' })
    ).rejects.toBeInstanceOf(ArchitecturesApiError);

    // (d) deleteArchitectureMapping on 404.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'mapping not found' }),
    });
    await expect(
      deleteArchitectureMapping(PROJECT_ID, MAPPING_ID)
    ).rejects.toBeInstanceOf(ArchitecturesApiError);
  });
});
