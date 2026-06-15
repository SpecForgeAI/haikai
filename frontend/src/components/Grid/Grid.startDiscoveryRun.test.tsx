/**
 * Tests for the "Start Discovery Run" services-grid context-menu action.
 *
 * 2026-04-22
 *
 * Covers (updated 2026-06-12 for the StartDiscoveryRunModal flow — the
 * context-menu click no longer POSTs directly; the "No Libraries" item
 * opens StartDiscoveryRunModal whose Start button performs the POST, and
 * navigation is react-router `useNavigate` to the run-detail URL, not the
 * old SET_VIEW dispatch / sessionStorage handoff):
 *   1. Right-click on a services row opens the context menu with the
 *      "Start Discovery Run" item (no item on non-services grids).
 *   2. Clicking Start in the modal POSTs `(projectId, architectureId,
 *      serviceId, confirmLlmSolo=false)`, fires a success toast and
 *      navigates to the run-detail route.
 *   3. On 409 `TECH_HINTS_UNRESOLVED`, the pack surfaces a toast and
 *      does NOT navigate.
 *   4. On 409 `LLM_SOLO_CONFIRMATION_REQUIRED`, the confirm modal opens;
 *      clicking Continue re-POSTs with `confirmLlmSolo: true`.
 *   5. Clicking Cancel on the confirm modal does NOT retry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  verticalListSortingStrategy: 'vertical',
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
  arrayMove: vi.fn((a) => a),
}));
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: vi.fn() } } }));

const mockDispatch = vi.fn();
const mockModel = {
  metaModel: {
    entities: {
      services: [
        { id: 'svc-abc', name: 'Orders UI', application_id: 'app-1' },
        { id: 'svc-def', name: 'Reports UI', application_id: 'app-1' },
      ],
    },
    relationships: {},
  },
};

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({
    model: mockModel,
    selectedTab: 'Applications',
    selectedDomain: 'Application',
  })),
  useArchitectureDispatch: vi.fn(() => mockDispatch),
  // ArchitectureRunTargetPicker (inside the Tier-C confirm modal) reads the
  // architectures list from the context.
  useArchitectureContext: vi.fn(() => ({
    architectures: [
      { id: 'arch-1', name: 'Architecture 1', archived: false, createdAt: '2026-01-01T00:00:00Z' },
    ],
  })),
}));

// Production navigation is react-router useNavigate (the SET_VIEW dispatch
// was removed by spec 2026-05-04). Spy on navigate.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual: any = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({ id: 'proj-1', name: 'Test Project' })),
}));

vi.mock('../../contexts/AppConfigContext', () => ({
  useAppConfig: vi.fn(() => ({
    uiCharacteristicsUiCapabilityKeys: [],
    uiCharacteristicsInteractionComplexityKeys: [],
    uiCharacteristicsTechnicalShapeKeys: [],
  })),
}));

vi.mock('../../config/gridConfigs', () => ({
  gridConfigs: {
    services: [
      { field: 'name', displayName: 'Name', cellType: 'text', width: '200px', required: true },
    ],
  },
}));

vi.mock('../../utils/validation', () => ({
  validateModel: vi.fn(() => []),
  getCellValidationError: vi.fn(() => null),
}));
vi.mock('../../utils/idGenerator', () => ({ generateEntityId: vi.fn(() => 'new-id') }));

vi.mock('../DiagramsView/AdvancedAddDialog', () => ({ AdvancedAddDialog: () => null }));
vi.mock('../DiagramsView/modals/AttachBusinessLogicModal', () => ({ AttachBusinessLogicModal: () => null }));
vi.mock('../DiagramsView/modals/AttachToApplicationPointModal', () => ({ AttachToApplicationPointModal: () => null }));
vi.mock('../DiagramsView/modals/CreateBusinessLogicModal', () => ({ CreateBusinessLogicModal: () => null }));
vi.mock('../MetaModelView/CreatePackageSetModal', () => ({ CreatePackageSetModal: () => null }));
vi.mock('../../api/discoveryApi', () => ({ getDiscoveryOriginEntities: vi.fn() }));

// Gateway client — the unit under integration test. We mock its
// startDiscoveryRun so we can drive every response shape (success, two
// 409 codes, generic error) without hitting a real backend.
const mockStartDiscoveryRun = vi.fn();
vi.mock('../../services/gatewayClient', async () => {
  const actual: any = await vi.importActual('../../services/gatewayClient');
  return {
    ...actual,
    startDiscoveryRun: (...args: any[]) => mockStartDiscoveryRun(...args),
  };
});

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { Grid } from './Grid';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

// ============================================================================
// Helpers
// ============================================================================

function renderServicesGrid() {
  return renderWithRouter(<Grid entityType="services" />);
}

function rightClickFirstServiceRow() {
  const rows = screen.getAllByRole('row');
  // First row is the header; the first data row is index 1.
  const dataRow = rows.find((r) => r.textContent?.includes('Orders UI'));
  if (!dataRow) throw new Error('service row not found');
  fireEvent.contextMenu(dataRow, { clientX: 200, clientY: 120 });
}

/**
 * Drive the current production flow up to the run-create POST: the
 * "Start Discovery Run (No Libraries)" context-menu item opens
 * StartDiscoveryRunModal; its Start button performs the POST.
 */
async function openModalAndClickStart() {
  rightClickFirstServiceRow();
  fireEvent.click(
    screen.getByTestId('grid-row-context-menu-start-discovery-run-no-libraries'),
  );
  await waitFor(() => {
    expect(screen.getByTestId('start-discovery-run-modal')).toBeInTheDocument();
  });
  fireEvent.click(screen.getByTestId('start-discovery-run-modal-start-button'));
}

// ============================================================================
// Tests
// ============================================================================

describe('Grid — Start Discovery Run (services context menu)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('right-click on a service row shows the Start Discovery Run context menu item', () => {
    renderServicesGrid();
    rightClickFirstServiceRow();
    const item = screen.getByTestId('grid-row-context-menu-start-discovery-run');
    expect(item).toBeInTheDocument();
    expect(item.textContent).toContain('Start Discovery Run');
  });

  it('clicking Start in the modal POSTs with confirmLlmSolo=false and fires success toast + navigation', async () => {
    mockStartDiscoveryRun.mockResolvedValueOnce({
      id: 'run-xyz',
      project_id: 'proj-1',
      service_id: 'svc-abc',
      tier: 'A',
      mode: 'pack-supervised',
      status: 'PENDING',
    });
    renderServicesGrid();
    await openModalAndClickStart();

    await waitFor(() => {
      expect(mockStartDiscoveryRun).toHaveBeenCalledWith('proj-1', 'arch-1', 'svc-abc', false);
    });
    // Success toast visible (the grid uses a custom testid on its toast)
    await waitFor(() => {
      const toast = screen.getByTestId('grid-start-run-toast');
      expect(toast).toBeInTheDocument();
      expect(toast.textContent).toContain('Discovery run started');
    });
    // react-router navigation straight to the run-detail URL (the old
    // SET_VIEW dispatch + sessionStorage handoff are gone).
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/projects/proj-1/architectures/arch-1/discovery/runs/run-xyz',
      );
    });
  });

  it('409 TECH_HINTS_UNRESOLVED surfaces an error toast and does NOT navigate', async () => {
    const err: any = new Error('Resolve tech hints before starting discovery.');
    err.name = 'StartDiscoveryRunError';
    err.status = 409;
    err.code = 'TECH_HINTS_UNRESOLVED';
    mockStartDiscoveryRun.mockRejectedValueOnce(err);

    renderServicesGrid();
    await openModalAndClickStart();

    await waitFor(() => {
      const toast = screen.getByTestId('grid-start-run-toast');
      expect(toast).toBeInTheDocument();
      expect(toast.textContent).toContain('Resolve tech hints before starting discovery');
    });
    // No navigation.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('409 LLM_SOLO_CONFIRMATION_REQUIRED opens the confirm modal; Continue retries with true', async () => {
    const err: any = new Error('Tier C (LLM-only) runs require explicit opt-in.');
    err.name = 'StartDiscoveryRunError';
    err.status = 409;
    err.code = 'LLM_SOLO_CONFIRMATION_REQUIRED';
    err.warnings = ['Discovery will run in LLM-only mode.'];
    mockStartDiscoveryRun
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({
        id: 'run-llm-solo',
        project_id: 'proj-1',
        service_id: 'svc-abc',
        tier: 'C',
        mode: 'llm-solo',
        status: 'PENDING',
      });

    renderServicesGrid();
    await openModalAndClickStart();

    // Tier-C confirm modal appears
    await waitFor(() => {
      expect(screen.getByTestId('start-discovery-run-confirm-modal')).toBeInTheDocument();
    });
    // Warnings surfaced verbatim
    expect(screen.getByTestId('llm-solo-warnings').textContent).toContain('LLM-only mode');

    // Click Continue -> retry with confirmLlmSolo=true, bound to the
    // picker's chosen architecture id.
    fireEvent.click(screen.getByTestId('modal-continue-button'));
    await waitFor(() => {
      expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(2);
    });
    expect(mockStartDiscoveryRun).toHaveBeenLastCalledWith('proj-1', 'arch-1', 'svc-abc', true);
    // Run-detail navigation on final success
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/projects/proj-1/architectures/arch-1/discovery/runs/run-llm-solo',
      );
    });
  });

  it('Cancel on the LLM-only confirm modal does NOT retry the POST', async () => {
    const err: any = new Error('Tier C (LLM-only) runs require explicit opt-in.');
    err.name = 'StartDiscoveryRunError';
    err.status = 409;
    err.code = 'LLM_SOLO_CONFIRMATION_REQUIRED';
    mockStartDiscoveryRun.mockRejectedValueOnce(err);

    renderServicesGrid();
    await openModalAndClickStart();

    await waitFor(() => {
      expect(screen.getByTestId('start-discovery-run-confirm-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('modal-cancel-button'));

    // Modal closed, no retry.
    await waitFor(() => {
      expect(screen.queryByTestId('start-discovery-run-confirm-modal')).not.toBeInTheDocument();
    });
    expect(mockStartDiscoveryRun).toHaveBeenCalledTimes(1);
  });
});
