/**
 * Implementation-Ready Migration Spec Generation -- Group 5 end-to-end seams
 * (frontend wire read-back).
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4),
 * Task Group 5 (test review + gap analysis).
 *
 * Gap closed: the Group 4 tile tests build a `SpecGenerationRow` directly in
 * camelCase, so they never exercise the snake_case AMS wire -> camelCase
 * read-back in `mapRowDtoToRow` (the row mapper inside `specGenerationApi.ts`).
 * AMS + the gateway emit `structured_tests_json` / `covered_endpoint_ids`
 * (snake_case, D6/D9); the frontend reads them back through this mapper. These
 * tests pin that wire-agreement seam end-to-end, including:
 *   - the populated case + the EMPTY `covered_endpoint_ids` (non-endpoint story);
 *   - the manual-add path (nullable `book_of_work_id`, D7) -- both new fields
 *     still surface through the SAME mapper;
 *   - the read-back -> UI seam: a row produced by the REAL wire mapper renders
 *     the Test Pack tile in `StoryResultDrawer`.
 *
 * `mapRowDtoToRow` is module-private; it is exercised through the public
 * `fetchSpecGenerationsForWorkItem`, with `globalThis.fetch` returning the exact
 * snake_case AMS wire shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom (the
// StoryResultDrawer render in the UI-seam test below pulls it in).
vi.mock('../MigrationShapeSpecGeneration.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { fetchSpecGenerationsForWorkItem } from '../../../../api/specGenerationApi';
import { StoryResultDrawer } from '../StoryResultDrawer';

const PROJECT_ID = 'proj-1';
const WORK_ITEM_ID = 'wi-1';

/** The exact snake_case AMS wire shape for a persisted spec-generation row. */
function amsWireRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'row-1',
    project_id: PROJECT_ID,
    work_item_id: WORK_ITEM_ID,
    book_of_work_id: 'book-1',
    book_item_id: 'bi-1',
    status: 'generated',
    confidence: 'high',
    predicted_readiness: 'ready_for_spec',
    generated_spec_text:
      '/agent-os:shape-spec\n\nScope in:\n- Port GET /orders/{id}\n\n' +
      'Acceptance criteria:\n- Known order returns the legacy body\n\n' +
      'Test Pack:\n- (unit) Maps the legacy row to the response DTO',
    warnings_json: [],
    missing_inputs_json: [],
    evidence_refs_json: [],
    generation_attempt_number: 1,
    created_by_task: 'product-manager--migration-shape-spec-generation',
    // The two fields under test (Implementation-Ready spec, D6 + D9).
    structured_tests_json: [
      {
        title: 'Maps the legacy row to the response DTO',
        description: 'Given a legacy order row, the mapper produces the v2 DTO.',
        type: 'unit',
      },
      {
        title: 'Returns 404 for an unknown order',
        description: 'A GET for a missing id returns HTTP 404.',
        type: 'functional',
      },
    ],
    covered_endpoint_ids: ['endpoint-uuid-1', 'endpoint-uuid-2'],
    ...overrides,
  };
}

function mockFetchReturning(rows: Array<Record<string, unknown>>): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => rows,
  } as unknown as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Implementation-ready wire read-back (Task Group 5)', () => {
  it('mapRowDtoToRow reads structured_tests_json + covered_endpoint_ids (snake_case) into camelCase row fields', async () => {
    mockFetchReturning([amsWireRow()]);

    const rows = await fetchSpecGenerationsForWorkItem(PROJECT_ID, WORK_ITEM_ID);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.structuredTestsJson).toEqual([
      {
        title: 'Maps the legacy row to the response DTO',
        description: 'Given a legacy order row, the mapper produces the v2 DTO.',
        type: 'unit',
      },
      {
        title: 'Returns 404 for an unknown order',
        description: 'A GET for a missing id returns HTTP 404.',
        type: 'functional',
      },
    ]);
    expect(row.coveredEndpointIds).toEqual([
      'endpoint-uuid-1',
      'endpoint-uuid-2',
    ]);
  });

  it('an EMPTY covered_endpoint_ids array (non-endpoint story, D9) reads back as an empty array', async () => {
    mockFetchReturning([amsWireRow({ covered_endpoint_ids: [] })]);

    const rows = await fetchSpecGenerationsForWorkItem(PROJECT_ID, WORK_ITEM_ID);

    expect(rows[0].coveredEndpointIds).toEqual([]);
    // The test pack still surfaces -- a non-endpoint story still has tests.
    expect(rows[0].structuredTestsJson).toHaveLength(2);
  });

  it('manual-add path (nullable book_of_work_id, D7) still surfaces both new fields through the same mapper', async () => {
    mockFetchReturning([
      amsWireRow({ book_of_work_id: null, book_item_id: null }),
    ]);

    const rows = await fetchSpecGenerationsForWorkItem(PROJECT_ID, WORK_ITEM_ID);

    const row = rows[0];
    expect(row.bookOfWorkId).toBeNull();
    expect(row.structuredTestsJson).toHaveLength(2);
    expect(row.coveredEndpointIds).toEqual([
      'endpoint-uuid-1',
      'endpoint-uuid-2',
    ]);
  });

  it('read-back -> UI seam: a row produced by the real wire mapper renders the Test Pack tile in StoryResultDrawer', async () => {
    mockFetchReturning([amsWireRow()]);
    const rows = await fetchSpecGenerationsForWorkItem(PROJECT_ID, WORK_ITEM_ID);

    render(
      <StoryResultDrawer
        row={rows[0]}
        projectId={PROJECT_ID}
        bookOfWorkId="book-1"
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // The Test Pack tile is sourced from the wire-mapped structuredTestsJson.
    const testPack = screen.getByTestId('msg-story-drawer-test-pack');
    expect(testPack).toHaveTextContent(/Maps the legacy row to the response DTO/i);
    expect(testPack).toHaveTextContent(/Returns 404 for an unknown order/i);
    expect(testPack).toHaveTextContent(/Unit/);
    expect(testPack).toHaveTextContent(/Functional/);
    // Confidence rides through for the readiness judgement.
    expect(screen.getByTestId('msg-story-drawer-confidence')).toHaveTextContent(
      /high/i,
    );
  });
});
