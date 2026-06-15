/**
 * MigrationDeliveryStoryDrawer tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 11.3 -- Story detail drawer + Missing inputs subsection.
 *
 * Tests in this file (matching spec.md tests 31-32):
 *   1. (test 31 / integration test 37 frontend half)
 *      "Missing inputs" subsection groups entries by `kind`, shows full
 *      `id` + `reason` per row, no truncation. Drawer body scrolls on
 *      overflow.
 *   2. (test 32) Drawer dismisses via Esc / backdrop click / X button.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock getMigrationDeliveryDashboard so any incidental import does not hit fetch.
const mockGetDashboard = vi.fn();
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
  };
});

import { MigrationDeliveryStoryDrawer } from '../MigrationDeliveryStoryDrawer';
import type {
  MigrationDeliveryHierarchyNodeDto,
  MigrationDeliveryNeedsAttentionItemDto,
} from '../../../../api/migrationDeliveryDashboardApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> = {},
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: 'story-1',
    parentId: 'feature-1',
    type: 'story',
    title: 'Migrate order-service create endpoint',
    workstream: 'order-service',
    sequenceOrder: 1,
    workItemId: 'wi-1',
    backlogStatus: 'saved',
    specGenerationStatus: 'insufficient_context',
    specGenerationConfidence: 'low',
    implementationStatus: 'not_started',
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 1,
    missingInputsCount: 12,
    children: [],
    ...overrides,
  };
}

function makeNeedsAttentionItem(
  overrides: Partial<MigrationDeliveryNeedsAttentionItemDto> = {},
): MigrationDeliveryNeedsAttentionItemDto {
  return {
    bookItemId: 'bi-1',
    workItemId: 'wi-1',
    type: 'insufficient_context',
    priorityRank: 2,
    title: 'Migrate order-service create endpoint',
    workstream: 'order-service',
    specGenerationStatus: 'insufficient_context',
    specGenerationConfidence: 'low',
    implementationStatus: 'not_started',
    reason: 'Generated spec has insufficient context',
    missingInputs: [
      // 4 mappings
      {
        kind: 'mapping',
        id: 'map-1',
        reason: 'Order entity mapping missing from current architecture',
      },
      {
        kind: 'mapping',
        id: 'map-2',
        reason: 'Customer entity mapping missing - long reason that should NOT be truncated even when it gets really verbose with details about the missing input source',
      },
      {
        kind: 'mapping',
        id: 'map-3',
        reason: 'Order line item mapping missing',
      },
      {
        kind: 'mapping',
        id: 'map-4',
        reason: 'Pricing mapping missing',
      },
      // 3 baselines
      {
        kind: 'baseline',
        id: 'baseline-1',
        reason: 'POST /orders baseline missing',
      },
      {
        kind: 'baseline',
        id: 'baseline-2',
        reason: 'GET /orders/{id} baseline missing',
      },
      {
        kind: 'baseline',
        id: null,
        reason: 'No baseline contract found for delete endpoint',
      },
      // 5 contracts
      {
        kind: 'contract',
        id: 'contract-1',
        reason: 'OrderCreated event contract missing',
      },
      {
        kind: 'contract',
        id: 'contract-2',
        reason: 'OrderUpdated event contract missing',
      },
      {
        kind: 'contract',
        id: 'contract-3',
        reason: 'OrderDeleted event contract missing',
      },
      {
        kind: 'contract',
        id: 'contract-4',
        reason: 'OrderShipped event contract missing',
      },
      {
        kind: 'contract',
        id: 'contract-5',
        reason: 'OrderCancelled event contract missing',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ----------------------------------------------------------------------------
// Test 1 (spec.md test 31 / integration test 37 frontend half): Missing
// inputs subsection groups entries by kind, full id+reason, no truncation,
// drawer body scrolls on overflow.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- Missing inputs subsection (test 31, Addition C)', () => {
  it('groups missingInputs by kind and renders header counts', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={vi.fn()}
      />,
    );

    // Header reports the total count (12 entries).
    const title = screen.getByTestId('mdd-story-drawer-missing-inputs-title');
    expect(title).toHaveTextContent(/Missing inputs \(12\)/);

    // Each kind group has a header with the per-kind count.
    expect(
      screen.getByTestId('mdd-story-drawer-missing-inputs-group-mapping-title'),
    ).toHaveTextContent(/Mappings \(4\)/);
    expect(
      screen.getByTestId('mdd-story-drawer-missing-inputs-group-baseline-title'),
    ).toHaveTextContent(/Baselines \(3\)/);
    expect(
      screen.getByTestId('mdd-story-drawer-missing-inputs-group-contract-title'),
    ).toHaveTextContent(/Contracts \(5\)/);
  });

  it('renders each entry with full id + reason, no truncation', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={vi.fn()}
      />,
    );

    // The very long reason in mapping entry #1 is rendered in full
    // (no ellipsis, no clipped text).
    const longReason = screen.getByTestId(
      'mdd-story-drawer-missing-inputs-group-mapping-entry-1-reason',
    );
    expect(longReason).toHaveTextContent(
      'Customer entity mapping missing - long reason that should NOT be truncated even when it gets really verbose with details about the missing input source',
    );

    // Ids are rendered (and null ids fall back to a "-" sentinel).
    expect(
      screen.getByTestId(
        'mdd-story-drawer-missing-inputs-group-mapping-entry-0-id',
      ),
    ).toHaveTextContent('map-1');
    expect(
      screen.getByTestId(
        'mdd-story-drawer-missing-inputs-group-baseline-entry-2-id',
      ),
    ).toHaveTextContent('-');
  });

  it('drawer body has overflow-y: auto so it scrolls on overflow (Q-9)', () => {
    const { container } = render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={vi.fn()}
      />,
    );

    const body = screen.getByTestId('mdd-story-drawer-body');
    // CSS module is proxied to className=`drawerBody`; the actual CSS rule
    // (overflow-y: auto) lives in the module file. We check the class is
    // applied so the rule does take effect. jsdom does not run styles, so
    // we rely on the class being present.
    expect(body.className).toContain('drawerBody');
    expect(container).toBeTruthy();
  });

  it('omits the missing-inputs subsection for non-insufficient stories', () => {
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory({
          specGenerationStatus: 'generated',
          missingInputsCount: 0,
        })}
        needsAttentionItem={null}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('mdd-story-drawer-missing-inputs-title'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdd-story-drawer-missing-inputs'),
    ).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// Test 2 (spec.md test 32): drawer dismisses via Esc / backdrop / X button.
// ----------------------------------------------------------------------------

describe('MigrationDeliveryStoryDrawer -- dismissal (test 32)', () => {
  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('mdd-story-drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={onClose}
      />,
    );
    const backdrop = screen.getByTestId('mdd-story-drawer-backdrop');
    // Click the backdrop element itself (e.target === e.currentTarget).
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when the drawer panel is clicked', () => {
    const onClose = vi.fn();
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={onClose}
      />,
    );
    // Clicking the drawer body should not dismiss; only the backdrop
    // element itself does.
    fireEvent.click(screen.getByTestId('mdd-story-drawer-body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <MigrationDeliveryStoryDrawer
        story={makeStory()}
        needsAttentionItem={makeNeedsAttentionItem()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
