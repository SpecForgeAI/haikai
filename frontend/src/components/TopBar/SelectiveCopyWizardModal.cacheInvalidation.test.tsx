/**
 * SelectiveCopyWizardModal -- Cache invalidation tests
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 7
 * Task 7.1: focused tests for the AppShell per-(project, architecture) model
 * cache fix.
 *
 * Per `project_appshell_model_cache.md`: backend writes that bypass the
 * frontend dispatch path leave the AppShell `cacheRef` stale. After a
 * successful copy + auto-map (or copy alone), the wizard MUST:
 *   - same-arch  (target == active): call loadModelByProjectId AND dispatch
 *                                     LOAD_MODEL.
 *   - cross-arch (target != active): call invalidateArchitectureModelCache
 *                                     for the target architecture.
 *
 * Source-side cache is untouched in v1.
 *
 * Coverage:
 *   1. Same-arch case: dispatch is called with type 'LOAD_MODEL' and
 *      loadModelByProjectId fires for the target architecture. Cross-arch
 *      invalidator is NOT called.
 *   2. Cross-arch case: invalidateArchitectureModelCache is called with the
 *      target architecture id; loadModelByProjectId / dispatch are NOT
 *      invoked for the target. Source-arch cache is NOT touched.
 *   3. Both cases: NO source-side cache invalidation (source arch id is
 *      never passed to invalidateArchitectureModelCache).
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
    listArchitectureMappings: vi.fn().mockResolvedValue([]),
    createArchitectureMapping: vi.fn(),
    updateArchitectureMapping: vi.fn(),
    deleteArchitectureMapping: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
  useArchitectureDispatch: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn(),
}));

vi.mock('./SelectiveCopyElementPicker', () => {
  const SelectiveCopyElementPicker = (props: {
    inventory: { domains: Array<{ name: string; types: Array<{ name: string; instances: Array<{ id: string; name: string }> }> }> };
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
  SelectiveCopyConflictResolution: () => (
    <div data-testid="mock-resolution">resolution</div>
  ),
}));

vi.mock('./SelectiveCopyMappingReviewStep', () => ({
  SelectiveCopyMappingReviewStep: () => (
    <div data-testid="mock-mapping-review-step">mapping review</div>
  ),
}));

import {
  getElementsInventory,
  selectiveCopyCommit,
  selectiveCopyPreflight,
  type Architecture,
  type ElementInventoryResponse,
  type SelectiveCopyCommitResponse,
  type SelectiveCopyPreflightResponse,
} from '../../api/architecturesApi';
import {
  useArchitectureContext,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import { loadModelByProjectId } from '../../api/modelApi';
import { SelectiveCopyWizardModal } from './SelectiveCopyWizardModal';

const PROJECT_ID = 'proj-uuid-cache';
const SOURCE_ID = 'arch-source-cache';
const TARGET_ID = 'arch-target-cache';
const OTHER_ARCH_ID = 'arch-other-active';

function buildArch(id: string, name: string): Architecture {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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
            instances: [{ id: 'app-1', name: 'Service One' }],
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

let dispatchMock: ReturnType<typeof vi.fn>;
let invalidateMock: ReturnType<typeof vi.fn>;
let refreshMock: ReturnType<typeof vi.fn>;
let onCloseMock: ReturnType<typeof vi.fn>;

const FAKE_MODEL = {
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
};

function setupContext(opts: { activeArchitectureId: string | null }) {
  vi.mocked(useArchitectureContext).mockReturnValue({
    refreshArchitectures: refreshMock,
    setActiveArchitecture: vi.fn(),
    architectures: [],
    activeArchitectureId: opts.activeArchitectureId,
    invalidateArchitectureModelCache: invalidateMock,
    setArchitectureModelCacheInvalidator: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatchMock = vi.fn();
  invalidateMock = vi.fn();
  refreshMock = vi.fn().mockResolvedValue(undefined);
  onCloseMock = vi.fn();

  vi.mocked(useToast).mockReturnValue({ showToast: vi.fn() });
  vi.mocked(loadModelByProjectId).mockResolvedValue(FAKE_MODEL as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWizard(opts: { initialAutoMap?: boolean } = {}) {
  return render(
    <SelectiveCopyWizardModal
      open={true}
      onClose={onCloseMock}
      projectId={PROJECT_ID}
      source={buildArch(SOURCE_ID, 'Source')}
      target={buildArch(TARGET_ID, 'Target')}
      initialAutoMap={opts.initialAutoMap}
    />
  );
}

async function driveToCommit() {
  await waitFor(() =>
    expect(screen.getByTestId('mock-picker')).toBeInTheDocument()
  );
  fireEvent.click(screen.getByTestId('mock-picker-toggle-app-1'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('selective-copy-wizard-next'));
  });
  await waitFor(() =>
    expect(screen.getByTestId('mock-resolution')).toBeInTheDocument()
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('selective-copy-wizard-commit'));
  });
}

describe('SelectiveCopyWizardModal -- cache invalidation (Task 7.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Same-arch case -- target == active.
  // --------------------------------------------------------------------------
  it('Test 1: same-arch (target == active) dispatches LOAD_MODEL and calls loadModelByProjectId', async () => {
    setupContext({ activeArchitectureId: TARGET_ID });
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(0));

    renderWizard({ initialAutoMap: false });
    await driveToCommit();

    // loadModelByProjectId fired for the target architecture.
    await waitFor(() => {
      expect(loadModelByProjectId).toHaveBeenCalledWith(PROJECT_ID, TARGET_ID);
    });

    // dispatch was called with a LOAD_MODEL action carrying the model.
    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL'
    );
    expect(loadModelDispatches).toHaveLength(1);
    expect(loadModelDispatches[0][0].payload).toBe(FAKE_MODEL);

    // Cross-arch invalidator was NOT called -- this is the same-arch path.
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 2: Cross-arch case -- target != active.
  // --------------------------------------------------------------------------
  it('Test 2: cross-arch (target != active) calls invalidateArchitectureModelCache(targetId)', async () => {
    setupContext({ activeArchitectureId: OTHER_ARCH_ID });
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(0));

    renderWizard({ initialAutoMap: false });
    await driveToCommit();

    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalledWith(TARGET_ID);
    });
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    // Same-arch dispatch path was NOT taken.
    expect(loadModelByProjectId).not.toHaveBeenCalled();
    const loadModelDispatches = dispatchMock.mock.calls.filter(
      ([action]) => action?.type === 'LOAD_MODEL'
    );
    expect(loadModelDispatches).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 3: NO source-side cache invalidation in v1.
  // --------------------------------------------------------------------------
  it('Test 3: NO source-side cache invalidation -- the source architecture id is never passed to invalidateArchitectureModelCache', async () => {
    // Run BOTH branches to ensure the source id is untouched by either
    // path. First the cross-arch branch (which DOES call the invalidator).
    setupContext({ activeArchitectureId: OTHER_ARCH_ID });
    vi.mocked(getElementsInventory).mockResolvedValue(buildInventory());
    vi.mocked(selectiveCopyPreflight).mockResolvedValue(buildPreflight());
    vi.mocked(selectiveCopyCommit).mockResolvedValue(buildCommit(0));

    renderWizard({ initialAutoMap: false });
    await driveToCommit();

    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalled();
    });
    // Every recorded invocation MUST be for the target id, never the source.
    for (const call of invalidateMock.mock.calls) {
      expect(call[0]).toBe(TARGET_ID);
      expect(call[0]).not.toBe(SOURCE_ID);
    }
  });
});
