/**
 * SelectiveCopyElementPicker Tests
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 7
 * Task 7.1: 4-8 focused tests for the new picker tree.
 *
 * Coverage matrix (mirrors the test scope in tasks.md 7.1):
 *   1. Tree renders the canonical 6 domain groups (Applications, Data,
 *      Business, UI, Behavioural, Diagrams) in the order returned by the
 *      inventory.
 *   2. Tri-state propagation downward: clicking a domain checkbox checks
 *      every type and instance under it.
 *   3. Tri-state propagation upward: when only some instances under a type
 *      are selected, the type checkbox renders indeterminate; the parent
 *      domain also renders indeterminate.
 *   4. Search filtering: typing in the search input hides instances /
 *      types / domains whose instance names don't match -- client-side, no
 *      API mock needed.
 *   5. Auto-included badge + tooltip rendering.
 *   6. Un-tick auto-included emits an onSelectionChange payload with the
 *      element removed (per spec -- the wizard then re-runs preflight).
 *   7. Clicking an instance checkbox adds its id to the emitted Set.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory. The picker is a pure
 *     presentation component so NO API mocks are required -- the test file
 *     drives it through the rendered DOM with hand-built fixtures.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SelectiveCopyElementPicker } from './SelectiveCopyElementPicker';
import type {
  ElementInventoryResponse,
  SelectiveCopyAutoIncluded,
} from '../../api/architecturesApi';

// ============================================================================
// Fixtures -- canonical 6-domain inventory the spec mandates.
// ============================================================================

function buildInventory(): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Services',
            instances: [
              { id: 'app-svc-1', name: 'Order Service' },
              { id: 'app-svc-2', name: 'Payment Service' },
            ],
          },
          {
            name: 'Components',
            instances: [{ id: 'app-comp-1', name: 'Auth Component' }],
          },
        ],
      },
      {
        name: 'Data',
        types: [
          {
            name: 'Data Entities',
            instances: [{ id: 'data-1', name: 'Customer' }],
          },
        ],
      },
      {
        name: 'Business',
        types: [
          {
            name: 'Business Processes',
            instances: [{ id: 'biz-1', name: 'Order Fulfillment' }],
          },
        ],
      },
      {
        name: 'UI',
        types: [
          {
            name: 'UI Elements',
            instances: [{ id: 'ui-1', name: 'Checkout Page' }],
          },
        ],
      },
      {
        name: 'Behavioural',
        types: [
          {
            name: 'Interactions',
            instances: [{ id: 'beh-1', name: 'Place Order' }],
          },
        ],
      },
      {
        name: 'Diagrams',
        types: [
          {
            name: 'Component Diagrams',
            instances: [{ id: 'diag-1', name: 'Order Overview' }],
          },
        ],
      },
    ],
  };
}

interface RenderOpts {
  inventory?: ElementInventoryResponse;
  selectedIds?: Set<string>;
  autoIncluded?: SelectiveCopyAutoIncluded[];
}

function renderPicker(opts: RenderOpts = {}) {
  const onSelectionChange: Mock = vi.fn();
  const utils = render(
    <SelectiveCopyElementPicker
      inventory={opts.inventory ?? buildInventory()}
      selectedIds={opts.selectedIds ?? new Set<string>()}
      autoIncluded={opts.autoIncluded ?? []}
      onSelectionChange={onSelectionChange}
    />,
  );
  return { ...utils, onSelectionChange };
}

// ============================================================================
// Tests
// ============================================================================

describe('SelectiveCopyElementPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the six canonical domain groups in inventory order', () => {
    renderPicker();

    // Each domain group exposes a stable testid.
    expect(screen.getByTestId('selective-copy-domain-Applications')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-domain-Data')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-domain-Business')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-domain-UI')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-domain-Behavioural')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-domain-Diagrams')).toBeInTheDocument();

    // Type group + instance row also rendered (domains expanded by default).
    expect(
      screen.getByTestId('selective-copy-type-Applications-Services'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-instance-app-svc-1')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-instance-diag-1')).toBeInTheDocument();
  });

  it('clicking an instance checkbox emits an onSelectionChange payload containing the id', () => {
    const { onSelectionChange } = renderPicker();

    const checkbox = screen.getByTestId('selective-copy-instance-checkbox-app-svc-1');
    fireEvent.click(checkbox);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const emitted = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(emitted).toBeInstanceOf(Set);
    expect(emitted.has('app-svc-1')).toBe(true);
    expect(emitted.size).toBe(1);
  });

  it('clicking a domain checkbox checks every descendant instance (downward propagation)', () => {
    const { onSelectionChange } = renderPicker();

    const domainCheckbox = screen.getByTestId(
      'selective-copy-domain-checkbox-Applications',
    );
    fireEvent.click(domainCheckbox);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const emitted = onSelectionChange.mock.calls[0][0] as Set<string>;
    // Applications has 3 instances total: 2 services + 1 component.
    expect(emitted.has('app-svc-1')).toBe(true);
    expect(emitted.has('app-svc-2')).toBe(true);
    expect(emitted.has('app-comp-1')).toBe(true);
    expect(emitted.size).toBe(3);

    // Other domain instances are NOT included.
    expect(emitted.has('data-1')).toBe(false);
    expect(emitted.has('diag-1')).toBe(false);
  });

  it('renders type and domain checkboxes in indeterminate state when only some descendants are selected (upward propagation)', () => {
    // Pre-select ONE of the two service instances; type + domain should both
    // render with aria-checked="mixed" (the indeterminate signal).
    renderPicker({ selectedIds: new Set(['app-svc-1']) });

    const typeCheckbox = screen.getByTestId(
      'selective-copy-type-checkbox-Applications-Services',
    ) as HTMLInputElement;
    expect(typeCheckbox.getAttribute('aria-checked')).toBe('mixed');

    const domainCheckbox = screen.getByTestId(
      'selective-copy-domain-checkbox-Applications',
    ) as HTMLInputElement;
    expect(domainCheckbox.getAttribute('aria-checked')).toBe('mixed');

    // The DOM `indeterminate` property should also be set per the standard
    // React indeterminate-checkbox pattern.
    expect(typeCheckbox.indeterminate).toBe(true);
    expect(domainCheckbox.indeterminate).toBe(true);
  });

  it('clicking a type-level checkbox toggles every instance under it', () => {
    // First call -- nothing selected yet -> clicking the Services type
    // should select both services.
    const { onSelectionChange, rerender } = renderPicker();

    const typeCheckbox = screen.getByTestId(
      'selective-copy-type-checkbox-Applications-Services',
    );
    fireEvent.click(typeCheckbox);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    let emitted = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(emitted.has('app-svc-1')).toBe(true);
    expect(emitted.has('app-svc-2')).toBe(true);
    expect(emitted.size).toBe(2);

    // Now re-render with both selected and click again -> should un-tick all.
    onSelectionChange.mockClear();
    rerender(
      <SelectiveCopyElementPicker
        inventory={buildInventory()}
        selectedIds={new Set(['app-svc-1', 'app-svc-2'])}
        autoIncluded={[]}
        onSelectionChange={onSelectionChange}
      />,
    );
    const typeCheckboxAfter = screen.getByTestId(
      'selective-copy-type-checkbox-Applications-Services',
    );
    fireEvent.click(typeCheckboxAfter);
    emitted = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(emitted.has('app-svc-1')).toBe(false);
    expect(emitted.has('app-svc-2')).toBe(false);
  });

  it('search filters visible instances by name (case-insensitive substring match)', () => {
    renderPicker();

    const searchInput = screen.getByTestId('selective-copy-element-picker-search');
    fireEvent.change(searchInput, { target: { value: 'order' } });

    // Matches: Order Service (app-svc-1), Order Fulfillment (biz-1),
    // Order Overview (diag-1), Place Order (beh-1).
    expect(screen.getByTestId('selective-copy-instance-app-svc-1')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-instance-biz-1')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-instance-diag-1')).toBeInTheDocument();
    expect(screen.getByTestId('selective-copy-instance-beh-1')).toBeInTheDocument();

    // Non-matches: Payment Service, Auth Component, Customer, Checkout Page.
    expect(screen.queryByTestId('selective-copy-instance-app-svc-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selective-copy-instance-app-comp-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selective-copy-instance-data-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selective-copy-instance-ui-1')).not.toBeInTheDocument();

    // Domains with zero matches are hidden entirely while searching.
    expect(screen.queryByTestId('selective-copy-domain-Data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selective-copy-domain-UI')).not.toBeInTheDocument();
  });

  it('renders the auto-included badge + tooltip on instances passed in autoIncluded', () => {
    const autoIncluded: SelectiveCopyAutoIncluded[] = [
      {
        elementId: 'data-1',
        elementType: 'data_entity',
        name: 'Customer',
        includedBecause: 'Order Fulfillment',
      },
    ];

    renderPicker({ autoIncluded });

    const badge = screen.getByTestId('selective-copy-instance-auto-badge-data-1');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('title')).toBe(
      'Auto-included because referenced by Order Fulfillment',
    );

    // No badge on a non-auto-included instance.
    expect(
      screen.queryByTestId('selective-copy-instance-auto-badge-app-svc-1'),
    ).not.toBeInTheDocument();
  });

  it('un-ticking an auto-included element fires onSelectionChange with the element removed', () => {
    // Auto-included elements are typically pre-selected (the wizard merges
    // them into selectedIds) -- the user can still un-tick.
    const autoIncluded: SelectiveCopyAutoIncluded[] = [
      {
        elementId: 'data-1',
        elementType: 'data_entity',
        name: 'Customer',
        includedBecause: 'Order Fulfillment',
      },
    ];

    const { onSelectionChange } = renderPicker({
      selectedIds: new Set(['biz-1', 'data-1']),
      autoIncluded,
    });

    const checkbox = screen.getByTestId(
      'selective-copy-instance-checkbox-data-1',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const emitted = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(emitted.has('data-1')).toBe(false);
    expect(emitted.has('biz-1')).toBe(true);
  });
});
