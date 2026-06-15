/**
 * TopBar Save Gating Tests
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — TopBar wire-up of pending
 * resolutions store into the existing FileMenu Save flow.
 *
 * Covers:
 * - Save is disabled in the FileMenu when any row has a repoCrossCheck conflict.
 * - Clicking Save with a conflict surfaces the "Resolve tech hints conflicts
 *   before saving." error message and does NOT call saveModelToBackend.
 * - Clicking Save with in-flight resolve promises awaits Promise.allSettled
 *   before calling saveModelToBackend, and the whole-model PUT still fires
 *   after settlement.
 * - A rejected individual resolve promise does not block Save — the PUT
 *   still fires for the rest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pendingResolutionsStore } from '../../stores/pendingResolutionsStore';

vi.mock('../../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
}));
vi.mock('../../utils/excelOperations', () => ({
  exportMetaModelToExcel: vi.fn(),
  importMetaModelFromExcel: vi.fn(),
}));
vi.mock('../../utils/fileOperations', () => ({
  sanitizeFilename: vi.fn((name: string) => name),
  triggerDownload: vi.fn(),
}));

const saveModelToBackendMock = vi.fn();
vi.mock('../../utils/saveUtils', () => ({
  saveModelToBackend: (...args: unknown[]) => saveModelToBackendMock(...args),
}));

const mockDispatch = vi.fn();
const mockState = {
  model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
  loadedFileName: 'Project A' as string | null,
  currentView: 'metamodel' as const,
  selectedTab: 'Users',
  selectedDiagramId: null,
  validationErrors: [],
  isPalettePanelCollapsed: false,
  sectionExpandStates: {},
  paletteSearchQuery: '',
  isInspectorPanelCollapsed: false,
  selectedDomain: 'business',
  relationshipCellLabels: {},
};

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
  useArchitectureContext: () => ({
    state: mockState,
    dispatch: mockDispatch,
    architectures: [
      { id: 'arch-1', name: 'Architecture 1', archived: false, createdAt: '2026-01-01T00:00:00Z' },
    ],
  }),
}));
vi.mock('../../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => true,
  useIncludeDatabase: () => true,
}));
// Spec 2026-05-11: the architecture-scoped save requires an active project
// (and architecture id) before saveModelToBackend fires, so the mock must
// supply one.
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project A' }),
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Capture the props FileMenu receives so the test can drive Save + observe
// saveDisabled directly.
const capturedFileMenuProps: {
  onSave?: () => void;
  saveDisabled?: boolean;
} = {};

vi.mock('./FileMenu', () => ({
  FileMenu: (props: { visible: boolean; onSave: () => void; saveDisabled: boolean }) => {
    capturedFileMenuProps.onSave = props.onSave;
    capturedFileMenuProps.saveDisabled = props.saveDisabled;
    return props.visible ? (
      <div data-testid="file-menu">
        <button
          data-testid="menu-save"
          onClick={() => !props.saveDisabled && props.onSave()}
          disabled={props.saveDisabled}
        >
          Save
        </button>
      </div>
    ) : null;
  },
}));

vi.mock('../Project/CreateProjectModal', () => ({ CreateProjectModal: () => null }));
vi.mock('../Project/ImportProjectSnapshotModal', () => ({ ImportProjectSnapshotModal: () => null }));
vi.mock('../Project/DeleteProjectModal', () => ({ DeleteProjectModal: () => null }));
vi.mock('../Project/GenerateProjectStandardsModal', () => ({ GenerateProjectStandardsModal: () => null }));
vi.mock('../Import/ImportModeModal', () => ({ ImportModeModal: () => null }));
vi.mock('../Import/ImportDecisionModal', () => ({ ImportDecisionModal: () => null }));
vi.mock('../Import/CherryPickMergeModal', () => ({ CherryPickMergeModal: () => null }));
vi.mock('../file/ModelFileDialog', () => ({
  ModelFileDialog: () => null,
  isOpenProjectResult: () => false,
}));
vi.mock('../common/Modal', () => ({
  ErrorModal: ({ isOpen, errors }: { isOpen: boolean; errors: string[] }) =>
    isOpen ? <div data-testid="error-modal">{(errors ?? []).join('|')}</div> : null,
}));
vi.mock('../common/ImportSummaryModal', () => ({ ImportSummaryModal: () => null }));
vi.mock('../Export/ExportProjectNameModal', () => ({ ExportProjectNameModal: () => null }));
vi.mock('../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));
vi.mock('../../api/projectsApi', () => ({
  activateProject: vi.fn(),
  deactivateAllProjects: vi.fn(),
}));

import { TopBar } from './TopBar';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

function openMenu() {
  fireEvent.click(screen.getByTestId('project-menu-trigger'));
}

describe('TopBar Save Gating — pending tech hints resolutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveModelToBackendMock.mockResolvedValue({ success: true });
    pendingResolutionsStore._resetForTests();
    mockState.loadedFileName = 'Project A';
    capturedFileMenuProps.onSave = undefined;
    capturedFileMenuProps.saveDisabled = undefined;
  });

  afterEach(() => {
    pendingResolutionsStore._resetForTests();
  });

  it('disables Save in FileMenu when a row has a repoCrossCheck conflict', async () => {
    renderWithRouter(<TopBar />);
    openMenu();

    // Baseline: Save enabled (project loaded, no conflicts, no pending).
    await waitFor(() => {
      expect(capturedFileMenuProps.saveDisabled).toBe(false);
    });

    // Flip conflict in the store.
    pendingResolutionsStore.setConflict('svc-row-1', true);

    // FileMenu re-renders with saveDisabled true.
    await waitFor(() => {
      expect(capturedFileMenuProps.saveDisabled).toBe(true);
    });
  });

  it('shows error modal and does NOT save when Save fires with a conflict', async () => {
    renderWithRouter(<TopBar />);
    openMenu();

    // A conflict is in the store BEFORE click. We bypass the disabled guard in
    // the mock to prove the handler's own guard blocks the save path.
    pendingResolutionsStore.setConflict('svc-row-1', true);

    // Drive the captured handler directly (bypasses the mock's disabled gate).
    capturedFileMenuProps.onSave?.();

    await waitFor(() => {
      expect(screen.getByTestId('error-modal')).toHaveTextContent(
        'Resolve tech hints conflicts before saving.'
      );
    });
    expect(saveModelToBackendMock).not.toHaveBeenCalled();
  });

  it('awaits in-flight resolve promises via Promise.allSettled before calling saveModelToBackend', async () => {
    renderWithRouter(<TopBar />);
    openMenu();

    // One pending resolve, with a deferred promise we control.
    let releaseResolve: (v: unknown) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    pendingResolutionsStore.start(
      'svc-row-1',
      pendingPromise as Promise<never>,
      new AbortController()
    );

    // Fire Save.
    capturedFileMenuProps.onSave?.();

    // saveModelToBackend MUST NOT have been called yet — Save is awaiting the
    // pending promise.
    await Promise.resolve(); // flush microtasks
    expect(saveModelToBackendMock).not.toHaveBeenCalled();

    // Release the pending promise — Save should now proceed.
    releaseResolve(null);
    pendingResolutionsStore.settle('svc-row-1');

    await waitFor(() => {
      expect(saveModelToBackendMock).toHaveBeenCalledTimes(1);
    });
  });

  it('still fires saveModelToBackend when an individual resolve rejects', async () => {
    renderWithRouter(<TopBar />);
    openMenu();

    let rejectResolve: (err: unknown) => void = () => {};
    const rejectingPromise = new Promise((_resolve, reject) => {
      rejectResolve = reject;
    });
    // Pre-attach catch so Node doesn't log the unhandled rejection during the
    // await Promise.allSettled window.
    (rejectingPromise as Promise<unknown>).catch(() => {});
    pendingResolutionsStore.start(
      'svc-row-1',
      rejectingPromise as Promise<never>,
      new AbortController()
    );

    capturedFileMenuProps.onSave?.();

    rejectResolve(new Error('resolve failed'));
    pendingResolutionsStore.settle('svc-row-1');

    await waitFor(() => {
      expect(saveModelToBackendMock).toHaveBeenCalledTimes(1);
    });
  });
});
