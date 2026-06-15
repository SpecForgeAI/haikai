/**
 * Tests for Temporary Diagram API Client
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 1: Frontend API Client for Temporary Diagrams
 * Task 1.1: Write 4 focused tests for the API client
 *
 * Tests verify:
 * 1. Correct URL construction and successful response parsing
 * 2. Descriptive error on HTTP failure (404, 500)
 * 3. Validation error when diagram_payload fails isTemporaryArchitectureDiagram() type guard
 * 4. Validation error when diagram_payload passes type guard but fails isValidERDiagram()
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task 6.3
 *   fetchTemporaryDiagram now requires architectureId as a path segment
 *   between projectId and temporaryDiagramId.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTemporaryDiagram } from './temporaryDiagramApi';
import type { TemporaryArchitectureDiagram } from '../types/temporaryArchitectureDiagram';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const ARCHITECTURE_ID = 'arch-uuid-789';

/**
 * Helper: builds a valid TemporaryArchitectureDiagram payload for test fixtures.
 */
function buildValidERDiagramPayload(
  overrides?: Partial<TemporaryArchitectureDiagram>
): TemporaryArchitectureDiagram {
  return {
    id: 'diag-001',
    name: 'Test ER Diagram',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

/**
 * Helper: builds a valid TemporaryDiagramResponseDto wrapping a diagram payload.
 */
function buildResponseDto(diagramPayload: unknown) {
  return {
    id: 'db-uuid-123',
    temporary_diagram_id: 'temp-diag-abc',
    project_id: 'proj-uuid-456',
    diagram_payload: diagramPayload,
    created_at: '2026-03-26T10:00:00Z',
    updated_at: '2026-03-26T10:00:00Z',
  };
}

describe('temporaryDiagramApi', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: fetchTemporaryDiagram constructs the correct URL
   * /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}
   * and returns the validated TemporaryArchitectureDiagram from diagram_payload.
   */
  it('constructs the correct URL and returns the validated TemporaryArchitectureDiagram from diagram_payload', async () => {
    // Given
    const projectId = 'proj-uuid-456';
    const temporaryDiagramId = 'temp-diag-abc';
    const validPayload = buildValidERDiagramPayload();
    const responseDto = buildResponseDto(validPayload);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseDto),
    });

    // When
    const result = await fetchTemporaryDiagram(projectId, ARCHITECTURE_ID, temporaryDiagramId);

    // Then - verify URL construction (architecture-scoped path-segment)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `/api/projects/proj-uuid-456/architectures/${ARCHITECTURE_ID}/temporary-diagrams/temp-diag-abc`
    );

    // Then - verify the returned diagram matches the payload
    expect(result).toEqual(validPayload);
    expect(result.id).toBe('diag-001');
    expect(result.name).toBe('Test ER Diagram');
    expect(result.diagram_kind).toBe('ER');
    expect(result.view_mode).toBe('LOGICAL');
  });

  /**
   * Test 2: fetchTemporaryDiagram throws a descriptive error when the HTTP response
   * is not ok (e.g., 404, 500).
   */
  it('throws a descriptive error when the HTTP response is not ok', async () => {
    // Given - 404 response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    // When/Then
    await expect(
      fetchTemporaryDiagram('proj-uuid-456', ARCHITECTURE_ID, 'temp-diag-missing')
    ).rejects.toThrow(
      'Failed to fetch temporary diagram "temp-diag-missing" for project "proj-uuid-456": 404'
    );

    // Given - 500 response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    // When/Then
    await expect(
      fetchTemporaryDiagram('proj-uuid-456', ARCHITECTURE_ID, 'temp-diag-error')
    ).rejects.toThrow(
      'Failed to fetch temporary diagram "temp-diag-error" for project "proj-uuid-456": 500'
    );
  });

  /**
   * Test 3: fetchTemporaryDiagram throws a validation error when diagram_payload
   * fails the isTemporaryArchitectureDiagram() type guard.
   */
  it('throws a validation error when diagram_payload fails the isTemporaryArchitectureDiagram type guard', async () => {
    // Given - payload missing required fields (e.g., no "id", "name", "nodes", "edges")
    const invalidPayload = {
      some_random_field: 'not a diagram',
    };
    const responseDto = buildResponseDto(invalidPayload);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseDto),
    });

    // When/Then
    await expect(
      fetchTemporaryDiagram('proj-uuid-456', ARCHITECTURE_ID, 'temp-diag-bad-structure')
    ).rejects.toThrow(
      'failed structural validation (isTemporaryArchitectureDiagram)'
    );
  });

  /**
   * Test 4: fetchTemporaryDiagram throws a validation error when diagram_payload
   * passes the type guard but fails isValidERDiagram() (e.g., diagram_kind is not 'ER').
   */
  it('throws a validation error when diagram_payload passes the type guard but fails isValidERDiagram', async () => {
    // Given - payload has correct structure but diagram_kind is 'Sequence' (not 'ER')
    const nonERPayload = buildValidERDiagramPayload({
      diagram_kind: 'Sequence',
      view_mode: 'LOGICAL',
    });
    const responseDto = buildResponseDto(nonERPayload);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(responseDto),
    });

    // When/Then
    await expect(
      fetchTemporaryDiagram('proj-uuid-456', ARCHITECTURE_ID, 'temp-diag-not-er')
    ).rejects.toThrow(
      'failed ER validation (isValidERDiagram)'
    );
  });
});
