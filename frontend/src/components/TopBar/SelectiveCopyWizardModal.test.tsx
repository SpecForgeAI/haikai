/**
 * SelectiveCopyWizardModal Tests
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 9 (Task 9.1)
 *
 * Coverage matrix (5 focused tests, within the 4-8 budget):
 *   1. Step 1 -- inventory fetch + Next button enable/disable based on
 *      selection.
 *   2. Step 2 -- preflight runs on Next click; resolution component receives
 *      conflicts + autoIncluded + summary + initial Skip resolutions; the
 *      auto-included element is merged into the working selection.
 *   3. Step 3 happy path -- Commit calls selectiveCopyCommit with the
 *      resolved payload; success triggers refreshArchitectures + toast +
 *      onClose.
 *   4. 422 archived_source -> footer error rendered; modal stays open.
 *   5. 422 same_architecture -> footer error rendered; modal stays open.
 *
 * Test strategy:
 *   - Vitest with `vi.mock()` per project memory.
 *   - architecturesApi mocked: getElementsInventory / selectiveCopyPreflight /
 *     selectiveCopyCommit are vi.fn() each. ArchitecturesApiError is the
 *     real class so the typed branches in the modal work.
 *   - ArchitectureContext + ToastContext mocked so we don't need the full
 *     provider machinery.
 *   - Children (SelectiveCopyElementPicker / SelectiveCopyConflictResolution)
 *     are mocked to keep the focus on wizard orchestration -- the real
 *     children have their own focused test files.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ============================================================================
// Mocks (declared before imports per Vitest's hoisting semantics).
// ============================================================================

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi',
  );
  return {
    ...actual,
    getElementsInventory: vi.fn(),
    selectiveCopyPreflight: vi.fn(),
    selectiveCopyCommit: vi.fn(),
    // Spec 2026-05-15 Group 6: the wizard now seeds the Mapping Review step
    // from this list call after a successful autoMap commit. The existing
    // tests use autoMap=false so this mock is only needed to satisfy the
    // module's named-export contract -- it is never invoked here.
    listArchitectureMappings: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
  // Spec 2026-05-15 Group 7: the wizard dispatches LOAD_MODEL on the
  // same-arch cache-refresh path; the dispatch mock is invoked but the
  // existing tests do not assert on it.
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

// Spec 2026-05-15 Group 7: mock loadModelByProjectId because the wizard's
// same-arch cache-refresh path calls it on commit success. Returns a
// minimal model object; the dispatch is also mocked so nothing else
// observes the payload.
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({
    diagrams: [],
    business_actors: [],
    business_processes: [],
    business_capabilities: [],
    business_information_assets: [],
    organisations: [],
    application_components: [],
    application_collaborations: [],
    application_components_users: [],
    application_interfaces: [],
    application_interface_invocations: [],
    application_interface_collaborations: [],
    logical_data_entities: [],
    physical_data_entities: [],
    interactions: [],
    relationships: [],
  }),
}));

// Mock the picker so the wizard tests don't depend on the picker's tri-state
// internals. The mock exposes a single button per instance that toggles
// selection -- enough to drive the wizard's Next/Commit logic.
vi.mock('./SelectiveCopyElementPicker', () => {
  const SelectiveCopyElementPicker = (props: {
    inventory: { domains: Array<{ name: string; types: Array<{ name: string; instances: Array<{ id: string; name: string }> }> }> };
    selectedIds: Set<string>;
    autoIncluded?: Array<{ elementId: string; name: string; includedBecause: string }>;
    onSelectionChange: (newSelection: Set<string>) => void;
  }) => {
    const allInstances: Array<{ id: string; name: string }> = [];
    for (const d of props.inventory.domains) {
      for (const t of d.types) {
        for (const i of t.instances) allInstances.push(i);
      }
    }
    return (
      <div data-testid="mock-picker">
        <div data-testid="mock-picker-selected-count">{props.selectedIds.size}</div>
        <div data-testid="mock-picker-auto-included-count">
          {(props.autoIncluded ?? []).length}
        </div>
        <ul>
          {allInstances.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                data-testid={`mock-picker-toggle-${i.id}`}
                onClick={() => {
                  const next = new Set(props.selectedIds);
                  if (next.has(i.id)) next.delete(i.id);
                  else next.add(i.id);
                  props.onSelectionChange(next);
                }}
              >
                {i.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return { SelectiveCopyElementPicker };
});

// Mock the conflict resolution component so we can assert what the wizard
// passes in (conflicts + autoIncluded + summary + resolutions) without
// re-testing the table internals.
vi.mock('./SelectiveCopyConflictResolution', () => {
  const SelectiveCopyConflictResolution = (props: {
    conflicts: Array<{ elementId: string; name: string }>;
    autoIncluded: Array<{ elementId: string; name: string }>;
    summary: { totalSelected: number; conflictCount: number; autoIncludedCount: number; willCopyCount: number };
    resolutions: Record<string, 'skip' | 'overwrite' | 'duplicate'>;
    onResolutionsChange: (r: Record<string, 'skip' | 'overwrite' | 'duplicate'>) => void;
  }) => {
    return (
      <div data-testid="mock-resolution">
        <div data-testid="mock-resolution-summary">
          total={props.summary.totalSelected};conflicts={props.summary.conflictCount};auto=
          {props.summary.autoIncludedCount};will={props.summary.willCopyCount}
        </div>
        <div data-testid="mock-resolution-conflicts-count">{props.conflicts.length}</div>
        <div data-testid="mock-resolution-auto-count">{props.autoIncluded.length}</div>
        <div data-testid="mock-resolution-resolutions-json">
          {JSON.stringify(props.resolutions)}
        </div>
        {/* Provide an inline "set this conflict to overwrite" hook so test 3 can
         * exercise per-row mutation upstream into the wizard. */}
        {props.conflicts.map((c) => (
          <button
            key={c.elementId}
            type="button"
            data-testid={`mock-resolution-set-overwrite-${c.elementId}`}
            onClick={() =>
              props.onResolutionsChange({
                ...props.resolutions,
                [c.elementId]: 'overwrite',
              })
            }
          >
            Overwrite {c.name}
          </button>
        ))}
      </div>
    );
  };
  return { SelectiveCopyConflictResolution };
});

import {
  ArchitecturesApiError,
  getElementsInventory,
  selectiveCopyCommit,
  selectiveCopyPreflight,
  type Architecture,
  type ElementInventoryResponse,
  type SelectiveCopyCommitResponse,
  type SelectiveCopyPreflightResponse,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { SelectiveCopyWizardModal } from './SelectiveCopyWizardModal';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-uuid-123';
const SOURCE_ID = 'arch-source-456';
const TARGET_ID = 'arch-target-789';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: SOURCE_ID,
    projectId: PROJECT_ID,
    name: 'Source Architecture',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildInventory(): ElementInventoryResponse {
  return {
    domains: [
      {
        name: 'Applications',
        types: [
          {
            name: 'Service',
            instances: [
              { id: 'app-1', name: 'Service One' },
              { id: 'app-2', name: 'Service Two' },
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
}

function buildPreflightResponse(): SelectiveCopyPreflightResponse {
  return {
    conflicts: [
      {
        elementId: 'app-1',
        elementType: 'application',
        name: 'Service One',
        conflictReason: 'same_uuid',
      },
    ],
    autoIncluded: [
      {
        elementId: 'auto-included-1',
        elementType: 'data_entity',
        name: 'Linked Data',
        includedBecause: 'Service One',
      },
    ],
    summary: {
      totalSelected: 1,
      conflictCount: 1,
      autoIncludedCount: 1,
      willCopyCount: 1,
    },
  };
}

function buildCommitResponse(): SelectiveCopyCommitResponse {
  return {
    copied: 3,
    skipped: 1,
    overwritten: 0,
    duplicated: 0,
    autoIncluded: 1,
    // Spec 2026-05-15 Group 6: required field on the wire shape; 0 for
    // the existing autoMap=false tests so the toast helper does not
    // append the extra mappings segment.
    createdMappingCount: 0,
  };
}

// ============================================================================
// Test setup helpers
// ============================================================================

let refreshArchitecturesMock: ReturnType<typeof vi.fn>;
let setActiveArchitectureMock: ReturnType<typeof vi.fn>;
let showToastMock: ReturnType<typeof vi.fn>;
let onCloseMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  refreshArchitecturesMock = vi.fn().mockResolvedValue(undefined);
  setActiveArchitectureMock = vi.fn();
  showToastMock = vi.fn();
  onCloseMock = vi.fn();

  vi.mocked(useArchitectureContext).mockReturnValue({
    refreshArchitectures: refreshArchitecturesMock,
    setActiveArchitecture: setActiveArchitectureMock,
    architectures: [],
    activeArchitectureId: TARGET_ID,
    // Spec 2026-05-15 Group 7: the wizard reads these off the context
    // value after every successful copy. The cross-arch case calls the
    // invalidator; the same-arch case (which these tests exercise) takes
    // the LOAD_MODEL dispatch branch instead -- we still provide a
    // no-op stub so the destructure does not throw.
    invalidateArchitectureModelCache: vi.fn(),
    setArchitectureModelCacheInvalidator: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);

  vi.mocked(useToast).mockReturnValue({ showToast: showToastMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWizard(props: { open?: boolean; source?: Architecture; target?: Architecture } = {}) {
  const source = props.source ?? buildArchitecture({ id: SOURCE_ID, name: 'Source Architecture' });
  const target =
    props.target ??
    buildArchitecture({ id: TARGET_ID, name: 'Target Architecture' });
  return render(
    <SelectiveCopyWizardModal
      open={props.open ?? true}
      onClose={onCloseMock}
      projectId={PROJECT_ID}
      source={source}
      target={target}
    />,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('SelectiveCopyWizardModal (Task 9.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Step 1 -- inventory fetched on mount; Next disabled with empty
  //         selection, enabled with at least one element selected.
  // --------------------------------------------------------------------------
  it('Step 1: fetches inventory on open; Next button is disabled with empty selection and enabled after a selection', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());

    renderWizard();

    // Header announces direction unambiguously.
    expect(
      screen.getByTestId('selective-copy-wizard-modal-title'),
    ).toHaveTextContent('Copy from Source Architecture into Target Architecture');

    // Inventory fetch fired with (projectId, source.id).
    await waitFor(() => {
      expect(getElementsInventory).toHaveBeenCalledTimes(1);
    });
    expect(getElementsInventory).toHaveBeenCalledWith(PROJECT_ID, SOURCE_ID);

    // Picker rendered.
    await waitFor(() => {
      expect(screen.getByTestId('mock-picker')).toBeInTheDocument();
    });

    // Next button starts disabled (zero selection).
    const nextBtn = screen.getByTestId('selective-copy-wizard-next') as HTMLButtonElement;
    expect(nextBtn).toBeDisabled();

    // Toggle one element on.
    fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));

    // Next is now enabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId('selective-copy-wizard-next') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: Step 2 -- clicking Next runs preflight; resolution component
  //         receives the right props (summary, conflicts, autoIncluded,
  //         initial Skip resolutions). The auto-included element is merged
  //         back into the working selection.
  // --------------------------------------------------------------------------
  it('Step 2: clicking Next runs preflight, advances to resolution, seeds Skip resolutions, and merges auto-included into selection', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflightResponse());

    renderWizard();

    await waitFor(() => expect(screen.getByTestId('mock-picker')).toBeInTheDocument());

    // Select app-1.
    fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));

    // Click Next -> preflight.
    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
    });

    // Preflight called with the right payload (only the user-selected ids).
    expect(selectiveCopyPreflight).toHaveBeenCalledTimes(1);
    expect(selectiveCopyPreflight).toHaveBeenCalledWith(PROJECT_ID, TARGET_ID, {
      sourceArchitectureId: SOURCE_ID,
      elementIds: ['app-1'],
    });

    // Resolution component is now visible with the right props.
    await waitFor(() => {
      expect(screen.getByTestId('mock-resolution')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-resolution-summary')).toHaveTextContent(
      'total=1;conflicts=1;auto=1;will=1',
    );
    expect(screen.getByTestId('mock-resolution-conflicts-count')).toHaveTextContent('1');
    expect(screen.getByTestId('mock-resolution-auto-count')).toHaveTextContent('1');
    // Initial resolutions seed every conflict to 'skip'.
    expect(screen.getByTestId('mock-resolution-resolutions-json')).toHaveTextContent(
      JSON.stringify({ 'app-1': 'skip' }),
    );

    // Stepper indicates we are now on step 2.
    // (No explicit aria role beyond the testids -- assert presence + state.)
    expect(screen.getByTestId('selective-copy-wizard-step-resolve')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 3: Step 3 happy path -- Commit calls selectiveCopyCommit with the
  //         resolved payload (including the auto-included id merged into
  //         elementIds and the per-row resolution overrides). On success:
  //         refreshArchitectures + toast (safety property k) + onClose.
  // --------------------------------------------------------------------------
  it('Commit happy path: calls selectiveCopyCommit with the resolved payload, then refresh + toast + onClose', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflightResponse());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommitResponse());

    renderWizard();

    await waitFor(() => expect(screen.getByTestId('mock-picker')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
    });
    await waitFor(() => expect(screen.getByTestId('mock-resolution')).toBeInTheDocument());

    // Override the conflict from skip -> overwrite via the mock-resolution
    // hook so the commit payload reflects user input.
    fireEvent.click(screen.getByTestId('mock-resolution-set-overwrite-app-1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });

    // Commit called with the merged elementIds (user-selected + auto-included)
    // and the user's resolution map.
    expect(selectiveCopyCommit).toHaveBeenCalledTimes(1);
    const commitArgs = vi.mocked(selectiveCopyCommit).mock.calls[0];
    expect(commitArgs[0]).toBe(PROJECT_ID);
    expect(commitArgs[1]).toBe(TARGET_ID);
    expect(commitArgs[2].sourceArchitectureId).toBe(SOURCE_ID);
    expect(new Set(commitArgs[2].elementIds)).toEqual(
      new Set(['app-1', 'auto-included-1']),
    );
    expect(commitArgs[2].resolutions).toEqual([
      { elementId: 'app-1', action: 'overwrite' },
    ]);

    // Post-success pipeline.
    await waitFor(() => expect(refreshArchitecturesMock).toHaveBeenCalledTimes(1));

    // Toast text matches safety property (k) shape EXACTLY.
    expect(showToastMock).toHaveBeenCalledWith(
      'Copied 3 elements from Source Architecture (skipped: 1, overwrote: 0, duplicated: 0)',
      'success',
    );

    // Modal closed.
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 4: 422 archived_source from preflight -> footer error rendered;
  //         modal stays open.
  // --------------------------------------------------------------------------
  it('422 archived_source on preflight: footer error rendered, modal stays open', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockRejectedValue(
      new ArchitecturesApiError(422, {
        code: 'archived_source',
        message: 'Source archived.',
      }),
    );

    renderWizard();

    await waitFor(() => expect(screen.getByTestId('mock-picker')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
    });

    // Footer error rendered with the spec'd copy.
    await waitFor(() => {
      expect(screen.getByTestId('selective-copy-wizard-error')).toHaveTextContent(
        'Source architecture is archived; cannot copy.',
      );
    });

    // Modal stays open; no close call; no commit fired.
    expect(screen.getByTestId('selective-copy-wizard-modal')).toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(selectiveCopyCommit).not.toHaveBeenCalled();
    expect(refreshArchitecturesMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 5: 422 same_architecture from preflight -> footer error rendered;
  //         modal stays open.
  // --------------------------------------------------------------------------
  it('422 same_architecture on preflight: footer error rendered, modal stays open', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockRejectedValue(
      new ArchitecturesApiError(422, {
        code: 'same_architecture',
        message: 'Cannot selectively copy into the same architecture',
      }),
    );

    renderWizard();

    await waitFor(() => expect(screen.getByTestId('mock-picker')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selective-copy-wizard-error')).toHaveTextContent(
        'Cannot copy into the same architecture.',
      );
    });

    // Modal stays open; no further pipeline ran.
    expect(screen.getByTestId('selective-copy-wizard-modal')).toBeInTheDocument();
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(selectiveCopyCommit).not.toHaveBeenCalled();
  });
});
