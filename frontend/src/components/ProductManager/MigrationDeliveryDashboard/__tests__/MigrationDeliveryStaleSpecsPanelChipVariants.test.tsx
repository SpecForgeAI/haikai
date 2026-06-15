/**
 * MigrationDeliveryStaleSpecsPanel chip-variant rendering tests.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 8.3.
 *
 * The gap this test closes
 * ------------------------
 * The cross-spec coupling between this spec and 2026-05-20-target-architecture-
 * authoring-flow expresses staleness through a single `stale` boolean plus a
 * discriminating `stale_reason` ("target_architecture_changed" vs
 * "resolution_reset"). The dashboard's stale-specs panel renders DIFFERENT
 * chip labels depending on the reason, but none of the existing Vitest tests
 * pin those labels (the panel's three existing tests cover counts, list
 * joining, and the regenerate-batch wiring).
 *
 * After the cleanup-C change AMS surfaces `staleReason` on every hierarchy
 * node DTO; the panel now derives the reason lookup by walking the hierarchy
 * prop it receives. This test verifies BOTH chip variants render with the
 * spec-prescribed labels, AND that a node with a null/absent `staleReason`
 * (older AMS build / not-stale row included in the count) falls back to
 * "target arch changed".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { vi } from 'vitest';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryStaleSpecsPanel } from '../MigrationDeliveryStaleSpecsPanel';
import type {
  MigrationDeliveryHierarchyNodeDto,
  StaleSpecSummary,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-chip';
const BOOK_ID = 'book-chip';

function makeNode(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto>,
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: overrides.id ?? 'node-x',
    parentId: null,
    type: 'story',
    title: 'A story',
    workstream: null,
    sequenceOrder: null,
    workItemId: null,
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: null,
    implementationStatus: null,
    evidenceStatus: 'no_coverage',
    needsAttentionCount: 0,
    missingInputsCount: null,
    staleReason: null,
    children: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MigrationDeliveryStaleSpecsPanel -- stale-reason chip variants', () => {
  it('renders distinct chips sourced from hierarchy node staleReason and falls back when missing', () => {
    // Three stale WorkItems, each backed by a hierarchy node with a different
    // staleReason posture.
    const staleIds = ['wi-resolution', 'wi-targetarch', 'wi-missing'];
    const summary: StaleSpecSummary = {
      staleCount: staleIds.length,
      staleWorkItemIds: staleIds,
    };
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'node-resolution',
        workItemId: 'wi-resolution',
        staleReason: 'resolution_reset',
      }),
      makeNode({
        id: 'node-targetarch',
        workItemId: 'wi-targetarch',
        staleReason: 'target_architecture_changed',
      }),
      // `wi-missing` has a hierarchy node but staleReason is null --
      // the panel must fall back to "target arch changed".
      makeNode({
        id: 'node-missing',
        workItemId: 'wi-missing',
        staleReason: null,
      }),
    ];

    render(
      <MigrationDeliveryStaleSpecsPanel
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        staleSummary={summary}
        hierarchy={hierarchy}
        onRegenerated={() => undefined}
      />,
    );

    // The panel renders the count button; click to reveal the per-WorkItem
    // list (where the chips live).
    fireEvent.click(screen.getByTestId('mdd-summary-card-stale-specs-value'));

    // ----- Assertion 1: resolution_reset ⇒ "stale: input resolution reset"
    const resolutionChip = screen.getByTestId(
      'mdd-stale-specs-list-item-reason-wi-resolution',
    );
    expect(resolutionChip).toHaveTextContent('stale: input resolution reset');

    // ----- Assertion 2: target_architecture_changed ⇒ "stale: target arch changed"
    const targetArchChip = screen.getByTestId(
      'mdd-stale-specs-list-item-reason-wi-targetarch',
    );
    expect(targetArchChip).toHaveTextContent('stale: target arch changed');

    // ----- Assertion 3: missing reason ⇒ falls back to "stale: target arch changed"
    const fallbackChip = screen.getByTestId(
      'mdd-stale-specs-list-item-reason-wi-missing',
    );
    expect(fallbackChip).toHaveTextContent('stale: target arch changed');

    // ----- Assertion 4: the two reason variants render DIFFERENT labels.
    // This guards against a future refactor accidentally collapsing the
    // branches in `labelForStaleReason`.
    expect(resolutionChip.textContent).not.toBe(targetArchChip.textContent);
  });

  it('walks nested children so deep stories surface their staleReason chip', () => {
    // Nested-tree fixture: epic -> feature -> story; only the story carries
    // a workItemId + staleReason. This pins the recursive walk in
    // collectStaleReasonsFromHierarchy.
    const story = makeNode({
      id: 'node-deep-story',
      type: 'story',
      workItemId: 'wi-deep',
      staleReason: 'resolution_reset',
    });
    const feature = makeNode({
      id: 'node-feature',
      type: 'feature',
      children: [story],
    });
    const epic = makeNode({
      id: 'node-epic',
      type: 'epic',
      children: [feature],
    });

    render(
      <MigrationDeliveryStaleSpecsPanel
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        staleSummary={{ staleCount: 1, staleWorkItemIds: ['wi-deep'] }}
        hierarchy={[epic]}
        onRegenerated={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-summary-card-stale-specs-value'));

    const chip = screen.getByTestId(
      'mdd-stale-specs-list-item-reason-wi-deep',
    );
    expect(chip).toHaveTextContent('stale: input resolution reset');
  });
});
