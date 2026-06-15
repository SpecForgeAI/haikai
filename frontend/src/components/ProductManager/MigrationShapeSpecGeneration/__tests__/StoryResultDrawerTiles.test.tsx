/**
 * StoryResultDrawer + ImplementTabShapeSpecCard read-only tiles
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4),
 * Task Group 4.1.
 *
 * Coverage:
 *   - Drawer renders scope-in / scope-out / acceptance-criteria tiles parsed
 *     from the combined spec text, plus the unit/functional Test Pack tile
 *     sourced from `structuredTestsJson`, alongside confidence.
 *   - An `insufficient_context` row surfaces the gap (status + missing inputs)
 *     and renders NO populated Test Pack tile.
 *   - Editing remains combined-spec-text-only: the drawer exposes no inline
 *     tile editor; the only mutation affordance is regenerate (which routes the
 *     manual-edit-protected confirm through the existing path).
 *   - The Implement-tab card mirrors the same tiles for a generated story.
 *
 * These components touch neither Router nor app contexts, so they are rendered
 * with the plain `render` helper (matching the established sibling suites
 * StoryResultDrawer.test.tsx + ImplementTabShapeSpec.test.tsx).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationShapeSpecGeneration.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockFetchSpecsForWorkItem = vi.fn();

vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    fetchSpecGenerationsForWorkItem: (...args: unknown[]) =>
      mockFetchSpecsForWorkItem(...args),
  };
});

// The Implement-tab card pulls in the same shared CSS module via a different
// relative path; mock that too so the card renders under jsdom.
vi.mock(
  '../../../ProductManager/MigrationShapeSpecGeneration/MigrationShapeSpecGeneration.module.css',
  () => ({
    default: new Proxy(
      {},
      { get: (_t: object, prop: string | symbol) => String(prop) },
    ),
  }),
);

import { StoryResultDrawer } from '../StoryResultDrawer';
import { ImplementTabShapeSpecCard } from '../../../ProductView/ImplementTabShapeSpecCard';
import type { SpecGenerationRow } from '../../../../api/specGenerationApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

const SPEC_TEXT_WITH_SECTIONS = [
  '/agent-os:shape-spec',
  '',
  'Feature summary: Migrate the order lookup endpoint like-for-like.',
  '',
  'Scope in:',
  '- Port GET /orders/{id} to the new service',
  '- Preserve the existing response contract',
  '',
  'Scope out:',
  '- Any change to the response schema',
  '',
  'Acceptance criteria:',
  '- A request for a known order returns the same body as the legacy service',
  '- An unknown order returns 404',
  '',
  'Test Pack:',
  '- (unit) Maps the legacy row to the response DTO',
].join('\n');

const STRUCTURED_TESTS = [
  {
    title: 'Maps the legacy row to the response DTO',
    description: 'Given a legacy order row, the mapper produces the v2 DTO.',
    type: 'unit',
  },
  {
    title: 'Returns 404 for an unknown order',
    description: 'A GET for a missing id returns HTTP 404, like the legacy service.',
    type: 'functional',
  },
];

function makeRow(overrides: Partial<SpecGenerationRow>): SpecGenerationRow {
  return {
    id: 'row-1',
    projectId: PROJECT_ID,
    workItemId: 'wi-1',
    bookOfWorkId: BOOK_ID,
    bookItemId: 'bi-1',
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: SPEC_TEXT_WITH_SECTIONS,
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: 'product-manager--migration-shape-spec-generation',
    createdAt: null,
    updatedAt: null,
    storyTitle: 'Migrate order lookup',
    parentTitle: 'Order service migration',
    parentType: 'feature',
    workstream: 'order-service',
    structuredTestsJson: STRUCTURED_TESTS,
    coveredEndpointIds: ['endpoint-uuid-1'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSpecsForWorkItem.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Drawer tiles (Test 1)
// ----------------------------------------------------------------------------

describe('StoryResultDrawer - scope / AC / Test Pack tiles (Task 4.1 #1)', () => {
  it('renders scope-in, scope-out, acceptance-criteria and Test Pack tiles for a generated row', () => {
    render(
      <StoryResultDrawer
        row={makeRow({})}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // Scope-in tile reflects the parsed combined-spec section.
    const scopeIn = screen.getByTestId('msg-story-drawer-scope-in');
    expect(scopeIn).toHaveTextContent(/Port GET \/orders\/\{id\}/i);
    expect(scopeIn).toHaveTextContent(/Preserve the existing response contract/i);

    // Scope-out tile.
    const scopeOut = screen.getByTestId('msg-story-drawer-scope-out');
    expect(scopeOut).toHaveTextContent(/Any change to the response schema/i);

    // Acceptance-criteria tile.
    const ac = screen.getByTestId('msg-story-drawer-acceptance-criteria');
    expect(ac).toHaveTextContent(/returns the same body as the legacy service/i);
    expect(ac).toHaveTextContent(/unknown order returns 404/i);

    // Test Pack tile sourced from structuredTestsJson, with type chips.
    const testPack = screen.getByTestId('msg-story-drawer-test-pack');
    expect(testPack).toHaveTextContent(/Maps the legacy row to the response DTO/i);
    expect(testPack).toHaveTextContent(/Returns 404 for an unknown order/i);
    expect(testPack).toHaveTextContent(/Unit/);
    expect(testPack).toHaveTextContent(/Functional/);

    // Confidence is surfaced for readiness judgement.
    expect(screen.getByTestId('msg-story-drawer-confidence')).toHaveTextContent(
      /high/i,
    );
  });

  it('does NOT render a populated Test Pack tile and surfaces the gap for an insufficient_context row', () => {
    render(
      <StoryResultDrawer
        row={makeRow({
          status: 'insufficient_context',
          confidence: 'low',
          predictedReadiness: 'needs_focused_context',
          generatedSpecText: null,
          structuredTestsJson: [],
          coveredEndpointIds: [],
          missingInputs: [
            { field: 'mappings', reason: 'No DB column mappings supplied' },
          ],
          recommendedNextAction: 'Provide DB column mappings, then regenerate.',
        })}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // The insufficient-context gap is visible (status + the insufficient flag).
    expect(screen.getByTestId('msg-story-drawer-status')).toHaveTextContent(
      /insufficient context/i,
    );
    expect(
      screen.getByTestId('msg-story-drawer-insufficient-flag'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('msg-story-drawer-missing-inputs'),
    ).toHaveTextContent(/No DB column mappings supplied/i);

    // No populated Test Pack tile (the story is not ready-to-implement).
    expect(
      screen.queryByTestId('msg-story-drawer-test-pack'),
    ).not.toBeInTheDocument();
  });

  it('keeps editing combined-spec-text-only: no inline tile editor, only the regenerate affordance mutates', () => {
    render(
      <StoryResultDrawer
        row={makeRow({})}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // The scope/AC/Test Pack tiles expose no editable controls.
    const scopeIn = screen.getByTestId('msg-story-drawer-scope-in');
    expect(scopeIn.querySelector('textarea')).toBeNull();
    expect(scopeIn.querySelector('input')).toBeNull();
    const testPack = screen.getByTestId('msg-story-drawer-test-pack');
    expect(testPack.querySelector('textarea')).toBeNull();
    expect(testPack.querySelector('button')).toBeNull();

    // The combined spec text remains visible (the editable artifact lives in
    // the existing manual-edit path, not in the tiles).
    expect(
      screen.getByTestId('msg-story-drawer-spec-text'),
    ).toHaveTextContent(/Port GET \/orders\/\{id\}/i);
  });
});

// ----------------------------------------------------------------------------
// Implement-tab card tiles (Test 2)
// ----------------------------------------------------------------------------

describe('ImplementTabShapeSpecCard - mirrored tiles (Task 4.1 #2)', () => {
  it('renders scope / acceptance-criteria / Test Pack / confidence tiles for a generated story', async () => {
    mockFetchSpecsForWorkItem.mockResolvedValue([makeRow({})]);

    render(
      <ImplementTabShapeSpecCard projectId={PROJECT_ID} workItemId="wi-1" />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('msg-implement-spec-card-chip'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('msg-implement-spec-card-scope-in'),
    ).toHaveTextContent(/Port GET \/orders\/\{id\}/i);
    expect(
      screen.getByTestId('msg-implement-spec-card-acceptance-criteria'),
    ).toHaveTextContent(/unknown order returns 404/i);
    const testPack = screen.getByTestId('msg-implement-spec-card-test-pack');
    expect(testPack).toHaveTextContent(/Maps the legacy row to the response DTO/i);
    expect(testPack).toHaveTextContent(/Functional/);
    expect(
      screen.getByTestId('msg-implement-spec-card-confidence'),
    ).toHaveTextContent(/high/i);
  });

  it('omits the Test Pack tile for an insufficient_context row', async () => {
    mockFetchSpecsForWorkItem.mockResolvedValue([
      makeRow({
        status: 'insufficient_context',
        confidence: 'low',
        generatedSpecText: null,
        structuredTestsJson: [],
        coveredEndpointIds: [],
      }),
    ]);

    render(
      <ImplementTabShapeSpecCard projectId={PROJECT_ID} workItemId="wi-1" />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('msg-implement-spec-card-status'),
      ).toHaveTextContent(/insufficient context/i);
    });
    expect(
      screen.queryByTestId('msg-implement-spec-card-test-pack'),
    ).not.toBeInTheDocument();
  });
});
