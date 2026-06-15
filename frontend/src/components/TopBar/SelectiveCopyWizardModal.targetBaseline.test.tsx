/**
 * SelectiveCopyWizardModal -- Target Baseline extension tests
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 * Task 6.1: focused tests for the wizard's autoMap checkbox + Mapping
 * Review step.
 *
 * Scoped to the wizard component itself. The companion file
 * `ManageArchitecturesModal.createTargetBaseline.test.tsx` covers the new
 * entry-point button (test 6 of the 6.1 suite) -- separated because that
 * test mocks the wizard child, which would break the wizard tests below.
 *
 * Coverage:
 *   1. autoMap checkbox renders, defaults to its initialAutoMap prop
 *      value, and toggling it changes what the wizard sends to commit.
 *   2. On commit success with autoMap=true, the wizard transitions to
 *      step 4 (Mapping Review), does NOT close, and seeds the table
 *      from listArchitectureMappings.
 *   3. Closing the Mapping Review step does NOT trigger any rollback
 *      API call; the success toast remains.
 *   4. Mapping Review supports inline edit -> updateArchitectureMapping
 *      -> re-fetch.
 *   5. Manual-add row sends confidence=null by default and reaches
 *      createArchitectureMapping with the right shape.
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
    selectiveCopyPreflight: vi.fn(),
    selectiveCopyCommit: vi.fn(),
    listArchitectureMappings: vi.fn(),
    createArchitectureMapping: vi.fn(),
    updateArchitectureMapping: vi.fn(),
    deleteArchitectureMapping: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

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

vi.mock('./SelectiveCopyElementPicker', () => {
  const SelectiveCopyElementPicker = (props: {
    inventory: {
      domains: Array<{
        name: string;
        types: Array<{
          name: string;
          instances: Array<{ id: string; name: string }>;
        }>;
      }>;
    };
    selectedIds: Set<string>;
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
        {allInstances.map((i) => (
          <button
            type="button"
            key={i.id}
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
        ))}
      </div>
    );
  };
  return { SelectiveCopyElementPicker };
});

vi.mock('./SelectiveCopyConflictResolution', () => ({
  SelectiveCopyConflictResolution: () => <div data-testid="mock-resolution">resolution</div>,
}));

import {
  createArchitectureMapping,
  getElementsInventory,
  listArchitectureMappings,
  selectiveCopyCommit,
  selectiveCopyPreflight,
  updateArchitectureMapping,
  type Architecture,
  type ArchitectureElementMappingDto,
  type ElementInventoryResponse,
  type SelectiveCopyCommitResponse,
  type SelectiveCopyPreflightResponse,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { SelectiveCopyWizardModal } from './SelectiveCopyWizardModal';

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
            entityType: 'application',
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

function buildPreflight(): SelectiveCopyPreflightResponse {
  return {
    conflicts: [],
    autoIncluded: [],
    summary: {
      totalSelected: 1,
      conflictCount: 0,
      autoIncludedCount: 0,
      willCopyCount: 1,
    },
  };
}

function buildCommit(createdMappingCount = 0): SelectiveCopyCommitResponse {
  return {
    copied: 1,
    skipped: 0,
    overwritten: 0,
    duplicated: 0,
    autoIncluded: 0,
    createdMappingCount,
  };
}

function buildMapping(
  overrides: Partial<ArchitectureElementMappingDto> = {}
): ArchitectureElementMappingDto {
  return {
    id: 'mapping-1',
    projectId: PROJECT_ID,
    sourceArchitectureId: SOURCE_ID,
    targetArchitectureId: TARGET_ID,
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

let refreshArchitecturesMock: ReturnType<typeof vi.fn>;
let invalidateArchitectureModelCacheMock: ReturnType<typeof vi.fn>;
let showToastMock: ReturnType<typeof vi.fn>;
let onCloseMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  refreshArchitecturesMock = vi.fn().mockResolvedValue(undefined);
  invalidateArchitectureModelCacheMock = vi.fn();
  showToastMock = vi.fn();
  onCloseMock = vi.fn();

  vi.mocked(useArchitectureContext).mockReturnValue({
    refreshArchitectures: refreshArchitecturesMock,
    setActiveArchitecture: vi.fn(),
    architectures: [],
    activeArchitectureId: TARGET_ID,
    invalidateArchitectureModelCache: invalidateArchitectureModelCacheMock,
    setArchitectureModelCacheInvalidator: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);

  vi.mocked(useToast).mockReturnValue({ showToast: showToastMock });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWizard(props: { initialAutoMap?: boolean } = {}) {
  const source = buildArchitecture({ id: SOURCE_ID, name: 'Source Architecture' });
  const target = buildArchitecture({ id: TARGET_ID, name: 'Target Architecture' });
  return render(
    <SelectiveCopyWizardModal
      open={true}
      onClose={onCloseMock}
      projectId={PROJECT_ID}
      source={source}
      target={target}
      initialAutoMap={props.initialAutoMap}
    />,
  );
}

async function advanceToResolve() {
  await waitFor(() => expect(screen.getByTestId('mock-picker')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
  });
  await waitFor(() => expect(screen.getByTestId('mock-resolution')).toBeInTheDocument());
}

describe('SelectiveCopyWizardModal -- Target Baseline extension (Task 6.1)', () => {
  it('Test 1: autoMap checkbox defaults to initialAutoMap and toggling changes the value passed to commit', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(0));

    renderWizard({ initialAutoMap: true });
    await advanceToResolve();

    const checkbox = screen.getByTestId(
      'selective-copy-wizard-auto-map-checkbox'
    ) as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
    expect(screen.getByTestId('selective-copy-wizard-auto-map-helper')).toHaveTextContent(
      'append-only'
    );

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });

    expect(selectiveCopyCommit).toHaveBeenCalledTimes(1);
    const commitArgs = vi.mocked(selectiveCopyCommit).mock.calls[0];
    expect(commitArgs[2].autoMap).toBe(false);
  });

  it('Test 2: commit with autoMap=true transitions to Mapping Review and seeds from listArchitectureMappings', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(2));
    vi.mocked(listArchitectureMappings).mockResolvedValue([
      buildMapping({ id: 'm-1' }),
      buildMapping({
        id: 'm-2',
        sourceElementId: 'app-2',
        targetElementId: 'app-2-tgt',
      }),
    ]);

    renderWizard({ initialAutoMap: true });
    await advanceToResolve();

    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('selective-copy-wizard-mapping-review')
      ).toBeInTheDocument()
    );
    expect(onCloseMock).not.toHaveBeenCalled();

    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining('2 mappings created'),
      'success'
    );

    expect(listArchitectureMappings).toHaveBeenCalled();
    const seedCall = vi.mocked(listArchitectureMappings).mock.calls.find(
      (call) =>
        call[0] === PROJECT_ID &&
        call[1]?.sourceArchitectureId === SOURCE_ID &&
        call[1]?.targetArchitectureId === TARGET_ID
    );
    expect(seedCall).toBeTruthy();
  });

  it('Test 3: closing Mapping Review does NOT trigger any rollback API call', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(1));
    vi.mocked(listArchitectureMappings).mockResolvedValue([buildMapping()]);

    renderWizard({ initialAutoMap: true });
    await advanceToResolve();
    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('selective-copy-wizard-mapping-review')
      ).toBeInTheDocument()
    );

    const commitCallsBefore = vi.mocked(selectiveCopyCommit).mock.calls.length;
    const preflightCallsBefore = vi.mocked(selectiveCopyPreflight).mock.calls.length;

    fireEvent.click(screen.getByTestId('selective-copy-wizard-mapping-review-close'));

    expect(onCloseMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(selectiveCopyCommit).mock.calls.length).toBe(commitCallsBefore);
    expect(vi.mocked(selectiveCopyPreflight).mock.calls.length).toBe(preflightCallsBefore);
    // Toast was fired exactly once on commit success and is not re-fired or
    // cleared on Close (closing is NOT a rollback).
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining('1 mappings created'),
      'success'
    );
  });

  it('Test 4: Mapping Review supports inline edit -> updateArchitectureMapping -> re-fetch', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(1));
    const mapping = buildMapping({ id: 'm-edit-1' });
    vi.mocked(listArchitectureMappings).mockResolvedValue([mapping]);
    vi.mocked(updateArchitectureMapping).mockResolvedValue({
      ...mapping,
      status: 'rejected',
    });

    renderWizard({ initialAutoMap: true });
    await advanceToResolve();
    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });
    await waitFor(() =>
      expect(screen.getByTestId(`mapping-review-row-${mapping.id}`)).toBeInTheDocument()
    );

    vi.mocked(listArchitectureMappings).mockClear();
    vi.mocked(listArchitectureMappings).mockResolvedValue([
      { ...mapping, status: 'rejected' },
    ]);

    const statusSelect = screen.getByTestId(
      `mapping-review-row-status-${mapping.id}`
    ) as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'rejected' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`mapping-review-row-save-${mapping.id}`));
    });

    expect(updateArchitectureMapping).toHaveBeenCalledTimes(1);
    expect(updateArchitectureMapping).toHaveBeenCalledWith(
      PROJECT_ID,
      mapping.id,
      expect.objectContaining({ status: 'rejected' })
    );
    await waitFor(() => {
      expect(listArchitectureMappings).toHaveBeenCalled();
    });
  });

  it('Test 5: manual-add row sends confidence=null by default and reaches createArchitectureMapping', async () => {
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(0));
    vi.mocked(listArchitectureMappings).mockResolvedValue([]);
    vi.mocked(createArchitectureMapping).mockResolvedValue(buildMapping());

    renderWizard({ initialAutoMap: true });
    await advanceToResolve();
    await act(async () => {
      fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('selective-copy-wizard-mapping-review')
      ).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId('mapping-review-open-manual-add'));
    await waitFor(() =>
      expect(screen.getByTestId('mapping-review-manual-add-row')).toBeInTheDocument()
    );

    const confidenceInput = screen.getByTestId(
      'mapping-review-manual-add-confidence'
    ) as HTMLInputElement;
    expect(confidenceInput.value).toBe('');

    const sourceSelect = screen.getByTestId(
      'mapping-review-manual-add-source'
    ) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: 'app-1' } });
    const targetSelect = screen.getByTestId(
      'mapping-review-manual-add-target'
    ) as HTMLSelectElement;
    fireEvent.change(targetSelect, { target: { value: 'app-2' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('mapping-review-manual-add-save'));
    });

    expect(createArchitectureMapping).toHaveBeenCalledTimes(1);
    const [projectIdArg, body] = vi.mocked(createArchitectureMapping).mock.calls[0];
    expect(projectIdArg).toBe(PROJECT_ID);
    expect(body.confidence).toBeNull();
    expect(body.sourceArchitectureId).toBe(SOURCE_ID);
    expect(body.targetArchitectureId).toBe(TARGET_ID);
    expect(body.sourceElementId).toBe('app-1');
    expect(body.targetElementId).toBe('app-2');
  });
});
