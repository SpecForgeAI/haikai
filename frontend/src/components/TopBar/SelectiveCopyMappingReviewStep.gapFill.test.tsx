/**
 * SelectiveCopyMappingReviewStep -- gap-fill tests for Task Group 8.3.
 *
 * Spec: 2026-05-15 Create Target Baseline from Current State.
 *
 * The wizard-level test in `SelectiveCopyWizardModal.targetBaseline.test.tsx`
 * exercises happy-path edit + manual-add through the integrated wizard. The
 * three tests below fill three remaining cross-stack gaps that are scoped
 * to the Mapping Review step component itself:
 *
 *   1. Filter combinations: changing mapping_type + status filters together
 *      issues a re-fetch of `listArchitectureMappings` whose filter object
 *      contains BOTH narrowing fields (consolidated "filter combinations"
 *      gap from Task 8.3).
 *
 *   2. Element-name fallback: when `getElementsInventory` returns an
 *      inventory that does NOT contain a mapping row's `sourceElementId`
 *      / `targetElementId`, the row renders the spec-mandated
 *      "<type>:<id>" fallback rather than blanking out (per spec:
 *      "fall back to raw id with type prefix when a name cannot be
 *       resolved").
 *
 *   3. Duplicate-mapping toast / inline error: a 422 `duplicate_mapping`
 *      error from `createArchitectureMapping` (manual-add path) is surfaced
 *      inline in the manual-add row, with the body code visible to the user.
 *      This is the in-UI surface for the Gateway-pass-through proxy
 *      contract verified in `architectureMappingsProxy.test.ts`.
 *
 * Pattern: render the step component directly (not the wizard) so we can
 * mock the small surface of the API client and ArchitectureContext that
 * the step actually uses.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi',
  );
  return {
    ...actual,
    getElementsInventory: vi.fn(),
    listArchitectureMappings: vi.fn(),
    createArchitectureMapping: vi.fn(),
    updateArchitectureMapping: vi.fn(),
    deleteArchitectureMapping: vi.fn(),
  };
});

import {
  ArchitecturesApiError,
  createArchitectureMapping,
  getElementsInventory,
  listArchitectureMappings,
  type ArchitectureElementMappingDto,
  type ElementInventoryResponse,
} from '../../api/architecturesApi';
import { SelectiveCopyMappingReviewStep } from './SelectiveCopyMappingReviewStep';

const PROJECT_ID = 'proj-uuid-gap';
const SOURCE_ARCH_ID = 'arch-source-gap';
const TARGET_ARCH_ID = 'arch-target-gap';

function buildMapping(
  overrides: Partial<ArchitectureElementMappingDto> = {}
): ArchitectureElementMappingDto {
  return {
    id: 'mapping-gap-1',
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

function buildInventoryWith(
  instances: Array<{ id: string; name: string; entityType?: string }>
): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Service',
            entityType: 'application',
            instances: instances.map((i) => ({ id: i.id, name: i.name })),
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
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both arch inventories return one matching app each. Tests can
  // override per-call (vi.mocked(getElementsInventory).mockResolvedValueOnce).
  vi.mocked(getElementsInventory).mockResolvedValue(
    buildInventoryWith([{ id: 'app-1', name: 'App One' }])
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderStep() {
  return render(
    <SelectiveCopyMappingReviewStep
      projectId={PROJECT_ID}
      sourceArchitectureId={SOURCE_ARCH_ID}
      targetArchitectureId={TARGET_ARCH_ID}
    />
  );
}

describe('SelectiveCopyMappingReviewStep -- gap-fill (Task 8.3)', () => {
  // -------------------------------------------------------------------------
  // Test A: filter combinations -- mapping_type + status together.
  //
  // The component re-fetches via `listArchitectureMappings` on every filter
  // change; this test verifies the COMPOUND filter shape (both filters set
  // at the same time) is forwarded together so the AMS GET endpoint sees
  // the narrowing on both axes.
  // -------------------------------------------------------------------------
  it('Test A: changing mapping_type AND status filters issues a re-fetch with both filter fields set', async () => {
    vi.mocked(listArchitectureMappings).mockResolvedValue([buildMapping()]);
    renderStep();

    // Initial mount fetch.
    await waitFor(() => {
      expect(listArchitectureMappings).toHaveBeenCalled();
    });

    // Set mapping_type filter to "renamed".
    const mappingTypeSelect = screen.getByTestId(
      'mapping-review-filter-mapping-type'
    ) as HTMLSelectElement;
    fireEvent.change(mappingTypeSelect, { target: { value: 'renamed' } });

    // Set status filter to "needs_review".
    const statusSelect = screen.getByTestId(
      'mapping-review-filter-status'
    ) as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'needs_review' } });

    // Wait for the re-fetch that has BOTH filters set in the same call.
    await waitFor(() => {
      const compound = vi
        .mocked(listArchitectureMappings)
        .mock.calls.find(
          (call) =>
            call[1]?.mappingType === 'renamed' && call[1]?.status === 'needs_review'
        );
      expect(compound).toBeTruthy();
    });

    // The compound call MUST also carry the (source, target) arch pair.
    const compound = vi
      .mocked(listArchitectureMappings)
      .mock.calls.find(
        (call) =>
          call[1]?.mappingType === 'renamed' && call[1]?.status === 'needs_review'
      );
    expect(compound![0]).toBe(PROJECT_ID);
    expect(compound![1]?.sourceArchitectureId).toBe(SOURCE_ARCH_ID);
    expect(compound![1]?.targetArchitectureId).toBe(TARGET_ARCH_ID);
  });

  // -------------------------------------------------------------------------
  // Test B: element-name fallback when the inventory lookup misses.
  //
  // The mapping row references `app-missing` (not present in either
  // inventory). Per spec the rendered cell MUST be "<type>:<id>".
  // -------------------------------------------------------------------------
  it('Test B: element-name renders "<type>:<id>" fallback when ElementInventoryResponse lookup misses', async () => {
    // Source and target inventories DO NOT contain the mapping's element ids.
    vi.mocked(getElementsInventory)
      .mockResolvedValueOnce(buildInventoryWith([{ id: 'something-else', name: 'Other' }])) // source
      .mockResolvedValueOnce(buildInventoryWith([{ id: 'something-else-2', name: 'Other 2' }])); // target

    const orphan = buildMapping({
      id: 'mapping-orphan',
      sourceElementType: 'application',
      sourceElementId: 'app-missing',
      targetElementType: 'service',
      targetElementId: 'svc-missing',
    });
    vi.mocked(listArchitectureMappings).mockResolvedValue([orphan]);

    renderStep();

    await waitFor(() => {
      expect(
        screen.getByTestId(`mapping-review-row-${orphan.id}`)
      ).toBeInTheDocument();
    });

    const sourceCell = screen.getByTestId(
      `mapping-review-row-source-name-${orphan.id}`
    );
    const targetCell = screen.getByTestId(
      `mapping-review-row-target-name-${orphan.id}`
    );
    // Spec mandates "raw id with type prefix" -- format is "<type>:<id>".
    expect(sourceCell.textContent).toBe('application:app-missing');
    expect(targetCell.textContent).toBe('service:svc-missing');
  });

  // -------------------------------------------------------------------------
  // Test C: 422 duplicate_mapping from createArchitectureMapping surfaces
  // inline in the manual-add row (visible to the user).
  //
  // This is the in-UI consumer of the Gateway pass-through verified in
  // `architectureMappingsProxy.test.ts` test #2 (POST 422 round-trip).
  // -------------------------------------------------------------------------
  it('Test C: 422 duplicate_mapping from createArchitectureMapping surfaces inline in the manual-add row', async () => {
    vi.mocked(listArchitectureMappings).mockResolvedValue([]);
    // Both inventories have the two ids the manual-add row will pick.
    vi.mocked(getElementsInventory).mockResolvedValue(
      buildInventoryWith([
        { id: 'app-1', name: 'App One' },
        { id: 'app-2', name: 'App Two' },
      ])
    );

    // Construct an ArchitecturesApiError instance with the body shape the
    // gateway forwards on a 422 duplicate.
    const dupError = new ArchitecturesApiError(
      422,
      {
        code: 'duplicate_mapping',
        message: 'A mapping with these endpoints already exists.',
      }
    );
    vi.mocked(createArchitectureMapping).mockRejectedValue(dupError);

    renderStep();

    // Wait for inventory + initial empty mapping list to settle.
    await waitFor(() => {
      expect(screen.getByTestId('mapping-review-open-manual-add')).toBeInTheDocument();
    });

    // Open the manual-add row.
    fireEvent.click(screen.getByTestId('mapping-review-open-manual-add'));
    await waitFor(() => {
      expect(screen.getByTestId('mapping-review-manual-add-row')).toBeInTheDocument();
    });

    // Pick source + target endpoints.
    fireEvent.change(screen.getByTestId('mapping-review-manual-add-source'), {
      target: { value: 'app-1' },
    });
    fireEvent.change(screen.getByTestId('mapping-review-manual-add-target'), {
      target: { value: 'app-2' },
    });

    // Save -- this triggers the rejected createArchitectureMapping.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mapping-review-manual-add-save'));
    });

    // Inline error row appears with the duplicate_mapping code visible.
    await waitFor(() => {
      const errorRow = screen.getByTestId('mapping-review-manual-add-error');
      expect(errorRow).toBeInTheDocument();
      expect(errorRow.textContent).toContain('duplicate_mapping');
    });

    // The manual-add row stays open so the user can adjust their picks.
    expect(screen.getByTestId('mapping-review-manual-add-row')).toBeInTheDocument();
    // createArchitectureMapping was called exactly once (no auto-retry).
    expect(createArchitectureMapping).toHaveBeenCalledTimes(1);
  });
});
