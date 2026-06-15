/**
 * DiagramsView Temporary Diagram Integration Tests
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 4, Task 4.1: 5 focused tests for DiagramsView temporary diagram integration
 *
 * Test 1: When temporaryDiagramState.active is true and data is loaded,
 *          TemporaryDiagramRenderer is rendered instead of the normal Canvas
 * Test 2: When in temporary diagram mode, PalettePanel, InspectorPanel,
 *          DiagramSelector, editing toolbar, and context menus are hidden/suppressed
 * Test 3: The temporary diagram banner displays the diagram name from
 *          TemporaryArchitectureDiagram.name and includes a close/back action
 * Test 4: Clicking the close/back action clears temporaryDiagramState and returns to normal diagram view
 * Test 5: When the API fetch fails, an error state is displayed with the error message and a close action
 *
 * Task Group 6: Gap-fill tests
 * Gap 7: Activating a second temporary diagram while one is already displayed replaces the first
 * Gap 8: Banner close fully clears state and restores all normal UI elements including palette
 *
 * Spec 2026-03-27: Deterministic Diagram Auto-Mapping (Increment 5)
 * Task Group 7: Integration into DiagramsView Component
 * Test 1: When data is loaded and meta-model is available, mapTemporaryDiagram is called and mappingResult is populated
 * Test 2: When data is null (not yet loaded), mapTemporaryDiagram is NOT called
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import type { TemporaryArchitectureDiagram } from '../../../types/temporaryArchitectureDiagram';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the ArchitectureContext
const mockDispatch = vi.fn();
const mockState = {
  model: {
    diagrams: [
      {
        id: 'diag-1',
        name: 'Test Diagram',
        description: '',
        diagram_type: 'General',
        settings: {},
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
      },
    ],
    metaModel: null,
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    business_user_business_points: [],
    application_point_business_points: [],
    interface_logical_entities: [],
    data_movements: [],
    package_sets: [],
    packages: [],
  },
  currentView: 'diagrams',
  selectedTab: 'Users',
  selectedDiagramId: 'diag-1',
  loadedFileName: 'test-file.json',
  validationErrors: [],
  isPalettePanelCollapsed: false,
  sectionExpandStates: {},
  paletteSearchQuery: '',
  isInspectorPanelCollapsed: false,
  selectedDomain: 'business',
  relationshipCellLabels: {},
};

// Harness: DiagramsView reads useUserJourneyReviewContext() (journey-review
// feature); stub an inactive session so no UserJourneyReviewProvider is needed.
vi.mock('../../../contexts/UserJourneyReviewContext', () => ({
  useUserJourneyReviewContext: vi.fn(() => ({
    active: false,
    projectId: '',
    sourceTaskId: '',
    journeys: [],
    overviews: [],
    selectedIndex: null,
    loading: false,
    error: null,
    previousView: '',
    savedIndices: new Set(),
    activateReviewSession: vi.fn(),
    selectItem: vi.fn(),
    selectNext: vi.fn(),
    selectPrevious: vi.fn(),
    returnToChooser: vi.fn(),
    markSaved: vi.fn(),
    closeReviewSession: vi.fn(),
    totalCount: 0,
    isOverview: false,
  })),
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Harness: DiagramsView also reads useUserJourneyOverviewReviewContext();
// stub an inactive overview-review session.
vi.mock('../../../contexts/UserJourneyOverviewReviewContext', () => ({
  useUserJourneyOverviewReviewContext: vi.fn(() => ({
    active: false,
    projectId: '',
    overviewDiagram: null,
    saved: false,
    previousView: '',
    activateOverviewReview: vi.fn(),
    markOverviewSaved: vi.fn(),
    closeOverviewReview: vi.fn(),
  })),
}));

// Harness: DiagramsView subtree reads useProject(); stub the hook so no
// ProjectProvider/AppConfigProvider chain is needed.
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({ id: 'proj-1', name: 'Test Project' })),
}));

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useUndo: vi.fn(() => ({ undo: vi.fn(), canUndo: false })),
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: () => mockState,
  useArchitectureDispatch: () => mockDispatch,
}));

// Mock TemporaryDiagramContext - we control this per test
let mockTemporaryDiagramRequest: { projectId: string; temporaryDiagramId: string } | null = null;
const mockClearTemporaryDiagramRequest = vi.fn();

vi.mock('../../../contexts/TemporaryDiagramContext', () => ({
  useTemporaryDiagramContext: () => ({
    temporaryDiagramRequest: mockTemporaryDiagramRequest,
    clearTemporaryDiagramRequest: mockClearTemporaryDiagramRequest,
  }),
}));

// Mock fetchTemporaryDiagram API - use deferred promise pattern for precise control
let fetchResolve: (value: TemporaryArchitectureDiagram) => void;
let fetchReject: (reason: Error) => void;
const mockFetchTemporaryDiagram = vi.fn(() => {
  return new Promise<TemporaryArchitectureDiagram>((resolve, reject) => {
    fetchResolve = resolve;
    fetchReject = reject;
  });
});

vi.mock('../../../api/temporaryDiagramApi', () => ({
  fetchTemporaryDiagram: (...args: any[]) => mockFetchTemporaryDiagram(...args),
}));

// Spec 2026-03-27 Task 7.1: Mock the mapping engine to verify it is called with correct arguments
const mockMapTemporaryDiagram = vi.fn(() => ({
  nodes: [],
  attributes: [],
  edges: [],
  summary: {
    nodes: { total: 0, matched: 0, unmatched: 0 },
    attributes: { total: 0, matched: 0, unmatched: 0 },
    edges: { total: 0, matched: 0, unmatched: 0 },
  },
  overallStatus: 'no_matches',
}));
vi.mock('../../../utils/temporaryDiagramMapping', () => ({
  mapTemporaryDiagram: (...args: any[]) => mockMapTemporaryDiagram(...args),
  DiagramMappingResult: {},
}));

// Mock heavy child components to avoid complex dependency chains
vi.mock('../Canvas', () => ({
  Canvas: (props: any) => <div data-testid="mock-canvas">Canvas for {props.diagramId}</div>,
}));

vi.mock('../PalettePanel', () => ({
  PalettePanel: () => <div data-testid="mock-palette-panel">PalettePanel</div>,
  initialActivityFlowCreationMode: { active: false },
  ActivityFlowCreationMode: {},
  buildWrappedNodeHierarchy: vi.fn(),
}));

vi.mock('../InspectorPanel', () => ({
  InspectorPanel: () => <div data-testid="mock-inspector-panel">InspectorPanel</div>,
  DecorationAddMode: {},
}));

vi.mock('../DecorationsPanel', () => ({
  DecorationsPanel: () => <div data-testid="mock-decorations-panel">DecorationsPanel</div>,
}));

vi.mock('../DiagramSelector', () => ({
  DiagramSelector: () => <div data-testid="mock-diagram-selector">DiagramSelector</div>,
}));

vi.mock('../SequenceEditorPanel', () => ({
  SequenceEditorPanel: () => <div data-testid="mock-sequence-editor">SequenceEditorPanel</div>,
}));

vi.mock('../UIScreenDiagramEditorPanel', () => ({
  UIScreenDiagramEditorPanel: () => <div data-testid="mock-uiscreen-editor">UIScreenEditor</div>,
}));

vi.mock('../UIScreenDiagramRenderer', () => ({
  UIScreenDiagramRenderer: () => <div data-testid="mock-uiscreen-renderer">UIScreenRenderer</div>,
}));

vi.mock('../TimeNavigationControls', () => ({
  TimeNavigationControls: () => <div data-testid="mock-time-nav">TimeNav</div>,
}));

vi.mock('../ElementContextMenu', () => ({
  ElementContextMenu: () => <div data-testid="mock-context-menu">ContextMenu</div>,
  ZIndexAction: {},
}));

vi.mock('../modals/AddLinkModal', () => ({
  AddLinkModal: () => null,
}));

vi.mock('../AdvancedAddDialog', () => ({
  AdvancedAddDialog: () => null,
  buildTreeData: vi.fn(),
  buildOrderedNodeListFromLeaves: vi.fn(),
  getAncestorKeys: vi.fn(),
}));

vi.mock('../modals/EditActivityFlowConditionModal', () => ({
  EditActivityFlowConditionModal: () => null,
  isDecisionActivityKind: vi.fn(),
}));

vi.mock('../../common/Modal', () => ({
  ErrorModal: () => null,
}));

vi.mock('../../../utils/activityFlowCreation', () => ({
  exitActivityFlowCreationMode: vi.fn(),
  setActivityFlowSourceNode: vi.fn(),
  createActivityFlowEntity: vi.fn(),
  createActivityFlowDiagramEdge: vi.fn(),
}));

vi.mock('../../../utils/stateTransitionCreation', () => ({
  TransitionCreationMode: {},
  initialTransitionCreationMode: { active: false },
  exitTransitionCreationMode: vi.fn(),
  setTransitionSourceState: vi.fn(),
  createStateTransitionEntity: vi.fn(),
  createTransitionDiagramEdge: vi.fn(),
}));

vi.mock('../../../utils/uiWorkflowTransitionCreation', () => ({
  WorkflowTransitionCreationMode: {},
  createIdleWorkflowTransitionMode: () => ({ step: 'idle' }),
  advanceToTargetSelection: vi.fn(),
  isValidUIScreenNode: vi.fn(),
  createUIWorkflowTransition: vi.fn(),
  createUIWorkflowTransitionEdge: vi.fn(),
}));

vi.mock('../../../utils/rendering', () => ({
  validateDiagramNodes: vi.fn(() => []),
  calculateDiagramFitZoom: vi.fn(() => ({ zoom: 1 })),
  getEntityLabel: vi.fn(() => ''),
  getDescendantNodes: vi.fn(() => []),
  getEntityColor: vi.fn(() => ({ background: '#FFF3E0', border: '#F57C00' })),
}));

vi.mock('../../../utils/interfaceCompositeBuilder', () => ({
  buildInterfaceCompositeNodes: vi.fn(() => []),
  DataEntityIdsForInterface: {},
}));

vi.mock('../../../utils/quarterUtils', () => ({
  getDefaultViewQuarter: () => 'Q1-2026',
}));

vi.mock('../../../utils/zIndexUtils', () => ({
  getZIndexBounds: vi.fn(() => ({ min: 0, max: 100 })),
  calculateNewZIndex: vi.fn(() => 50),
  isShapeDecoration: vi.fn(() => false),
  Z_INDEX_DEFAULTS: { SHAPE_MIN: -100, SHAPE_MAX: -1, ELEMENT_MIN: 0, ELEMENT_MAX: 100 },
}));

vi.mock('../../../utils/viewportUtils', () => ({
  getViewportCenterFromRaw: vi.fn(() => ({ x: 500, y: 500 })),
  DEFAULT_CANVAS_CENTER: { x: 1250, y: 2000 },
  GetViewportCenterFn: {},
}));

vi.mock('../../../types/diagramType', () => ({
  getDiagramType: vi.fn(() => 'General'),
}));

vi.mock('../../../api/modelApi', () => ({
  exportDiagramAsSvg: vi.fn(),
  exportAllDiagramsAsZip: vi.fn(),
  parseContentDispositionFilename: vi.fn(),
}));

// Mock TemporaryDiagramRenderer
vi.mock('../TemporaryDiagramRenderer', () => ({
  default: (props: any) => (
    <g data-testid="mock-temporary-diagram-renderer">
      <text>{props.diagram?.name}</text>
    </g>
  ),
}));

// Spec 2026-03-27 Increment 6 Task 4.1: Mock MappingConfirmationModal
let capturedMappingModalProps: any = null;
vi.mock('../MappingConfirmationModal', () => ({
  MappingConfirmationModal: (props: any) => {
    capturedMappingModalProps = props;
    if (!props.isOpen) return null;
    return (
      <div data-testid="mock-mapping-confirmation-modal">
        <span data-testid="modal-is-open">{String(props.isOpen)}</span>
        <button data-testid="mock-modal-confirm" onClick={() => props.onConfirm({ completedNodes: [], completedAttributes: [], completedEdges: [], sourceTemporaryDiagram: props.temporaryDiagram, viewMode: props.temporaryDiagram?.view_mode || 'LOGICAL' })}>Confirm</button>
        <button data-testid="mock-modal-cancel" onClick={props.onClose}>Cancel</button>
      </div>
    );
  },
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDiagram(overrides?: Partial<TemporaryArchitectureDiagram>): TemporaryArchitectureDiagram {
  return {
    id: 'temp-diag-1',
    name: 'ER Data Model Preview',
    diagram_kind: 'ER',
    source_architecture_domain: 'DATA',
    view_mode: 'LOGICAL',
    version: 1,
    nodes: [
      {
        id: 'node-1',
        node_kind: 'ENTITY',
        semantic_type: 'LOGICAL_DATA_ENTITY',
        ref_name: 'Customer',
        display_name: 'Customer',
        pos_x: 100,
        pos_y: 100,
        width: 200,
        height: 150,
      },
    ],
    edges: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

// Import must be dynamic because vi.mock hoists
import { DiagramsView } from '../DiagramsView';
import { renderWithRouter } from '../../../test-utils/renderWithProviders';

describe('DiagramsView - Temporary Diagram Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTemporaryDiagramRequest = null;
    // Reset the mock to use deferred promise pattern
    mockFetchTemporaryDiagram.mockClear();
    mockFetchTemporaryDiagram.mockImplementation(() => {
      return new Promise<TemporaryArchitectureDiagram>((resolve, reject) => {
        fetchResolve = resolve;
        fetchReject = reject;
      });
    });
  });

  // Test 1: When temporaryDiagramState.active is true and data is loaded,
  //          TemporaryDiagramRenderer is rendered instead of the normal Canvas
  it('renders TemporaryDiagramRenderer instead of Canvas when temporary diagram is active with loaded data', async () => {
    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    // Render the component - this triggers the context consumption effect
    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Verify the fetch was called
    expect(mockFetchTemporaryDiagram).toHaveBeenCalledWith('proj-1', 'arch-1', 'temp-diag-1');

    // Loading state should be visible
    expect(screen.getByTestId('temporary-diagram-loading')).toBeTruthy();

    // Resolve the fetch promise
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Now the renderer should appear
    expect(screen.getByTestId('mock-temporary-diagram-renderer')).toBeTruthy();

    // Canvas should NOT be rendered
    expect(screen.queryByTestId('mock-canvas')).toBeNull();
  });

  // Test 2: When in temporary diagram mode, PalettePanel, InspectorPanel,
  //          DiagramSelector, editing toolbar, and context menus are hidden/suppressed
  it('hides PalettePanel, InspectorPanel, DiagramSelector, and context menus in temporary diagram mode', async () => {
    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Resolve the fetch
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Verify the renderer is present
    expect(screen.getByTestId('mock-temporary-diagram-renderer')).toBeTruthy();

    // PalettePanel should be hidden
    expect(screen.queryByTestId('mock-palette-panel')).toBeNull();

    // InspectorPanel should be hidden
    expect(screen.queryByTestId('mock-inspector-panel')).toBeNull();

    // DiagramSelector should be hidden (replaced by banner)
    expect(screen.queryByTestId('mock-diagram-selector')).toBeNull();

    // Context menu should be hidden
    expect(screen.queryByTestId('mock-context-menu')).toBeNull();
  });

  // Test 3: The temporary diagram banner displays the diagram name from
  //          TemporaryArchitectureDiagram.name and includes a close/back action
  it('displays the temporary diagram banner with diagram name and close action', async () => {
    const diagramData = createTestDiagram({ name: 'My Custom ER Preview' });
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Resolve the fetch with the named diagram
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Banner container should be present
    const bannerEl = screen.getByTestId('temporary-diagram-banner');
    expect(bannerEl).toBeTruthy();

    // Banner should show the diagram name (scoped to banner to avoid duplicate with mock renderer)
    expect(within(bannerEl).getByText('My Custom ER Preview')).toBeTruthy();

    // Banner should show the "Preview" label
    expect(screen.getByText('Preview')).toBeTruthy();

    // Banner should have a close button
    const closeButton = screen.getByTestId('temporary-diagram-close-button');
    expect(closeButton).toBeTruthy();
    expect(closeButton.textContent).toBe('Back to Diagrams');
  });

  // Test 4: Clicking the close/back action clears temporaryDiagramState and returns to normal diagram view
  it('clicking close/back returns to normal diagram view', async () => {
    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Resolve the fetch
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Verify we're in temporary mode
    expect(screen.getByTestId('mock-temporary-diagram-renderer')).toBeTruthy();

    // Canvas should NOT be visible while in temp mode
    expect(screen.queryByTestId('mock-canvas')).toBeNull();

    // Click the close button
    await act(async () => {
      fireEvent.click(screen.getByTestId('temporary-diagram-close-button'));
    });

    // After clicking close, the normal Canvas should be rendered again
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();

    // TemporaryDiagramRenderer should be gone
    expect(screen.queryByTestId('mock-temporary-diagram-renderer')).toBeNull();

    // Banner should be gone
    expect(screen.queryByTestId('temporary-diagram-banner')).toBeNull();

    // DiagramSelector should be visible again
    expect(screen.getByTestId('mock-diagram-selector')).toBeTruthy();
  });

  // Test 5: When the API fetch fails, an error state is displayed with the error message and a close action
  it('displays error state with message and close action when API fetch fails', async () => {
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Reject the fetch promise with an error
    await act(async () => {
      fetchReject(new Error('Failed to fetch temporary diagram "temp-diag-1" for project "proj-1": 404'));
    });

    // Error state should be displayed
    expect(screen.getByTestId('temporary-diagram-error')).toBeTruthy();

    // Error message should be displayed
    expect(screen.getByText(/Failed to fetch temporary diagram/)).toBeTruthy();

    // Error close button should be present
    const errorCloseButton = screen.getByTestId('temporary-diagram-error-close');
    expect(errorCloseButton).toBeTruthy();

    // TemporaryDiagramRenderer should NOT be rendered
    expect(screen.queryByTestId('mock-temporary-diagram-renderer')).toBeNull();

    // Click the error close button to return to normal
    await act(async () => {
      fireEvent.click(errorCloseButton);
    });

    // After clicking close, should return to normal mode
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();
    expect(screen.queryByTestId('temporary-diagram-error')).toBeNull();
  });
});

// ============================================================================
// Task Group 6: Gap-Fill Tests -- DiagramsView Integration
// ============================================================================

describe('DiagramsView - Temporary Diagram Gap-Fill Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTemporaryDiagramRequest = null;
    mockFetchTemporaryDiagram.mockClear();
    mockFetchTemporaryDiagram.mockImplementation(() => {
      return new Promise<TemporaryArchitectureDiagram>((resolve, reject) => {
        fetchResolve = resolve;
        fetchReject = reject;
      });
    });
  });

  /**
   * Gap 7: Activating a second temporary diagram while one is already displayed.
   * Verifies that the first diagram is replaced: the close action returns to normal,
   * then activating a new request fetches and displays the second diagram.
   */
  it('replacing the first temporary diagram with a second via close-then-reactivate', async () => {
    const diagramA = createTestDiagram({ id: 'temp-diag-A', name: 'First ER Preview' });
    const diagramB = createTestDiagram({ id: 'temp-diag-B', name: 'Second ER Preview' });

    // Step 1: Activate first temporary diagram
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-A' };

    const { unmount } = await act(async () => {
      return renderWithRouter(<DiagramsView />);
    });

    // Resolve first fetch
    await act(async () => {
      fetchResolve(diagramA);
    });

    // First diagram should be displayed
    expect(screen.getByTestId('mock-temporary-diagram-renderer')).toBeTruthy();
    const bannerEl = screen.getByTestId('temporary-diagram-banner');
    expect(within(bannerEl).getByText('First ER Preview')).toBeTruthy();

    // Step 2: Close the first diagram
    await act(async () => {
      fireEvent.click(screen.getByTestId('temporary-diagram-close-button'));
    });

    // Normal view should be restored
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();
    expect(screen.queryByTestId('mock-temporary-diagram-renderer')).toBeNull();

    // Step 3: Unmount and remount with a new request (simulates navigating back from chat with second diagram)
    unmount();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-B' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Second fetch should be triggered
    expect(mockFetchTemporaryDiagram).toHaveBeenCalledWith('proj-1', 'arch-1', 'temp-diag-B');

    // Resolve second fetch
    await act(async () => {
      fetchResolve(diagramB);
    });

    // Second diagram should be displayed
    expect(screen.getByTestId('mock-temporary-diagram-renderer')).toBeTruthy();
    const bannerEl2 = screen.getByTestId('temporary-diagram-banner');
    expect(within(bannerEl2).getByText('Second ER Preview')).toBeTruthy();
  });

  /**
   * Gap 8: Banner close fully clears state and restores all normal UI elements.
   * Goes beyond Test 4 by verifying that PalettePanel and InspectorPanel
   * are also restored (not just Canvas and DiagramSelector).
   */
  it('closing temporary diagram mode fully restores PalettePanel and InspectorPanel', async () => {
    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Resolve the fetch
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Verify panels are hidden in temporary mode
    expect(screen.queryByTestId('mock-palette-panel')).toBeNull();
    expect(screen.queryByTestId('mock-inspector-panel')).toBeNull();
    expect(screen.queryByTestId('mock-canvas')).toBeNull();

    // Click the close button
    await act(async () => {
      fireEvent.click(screen.getByTestId('temporary-diagram-close-button'));
    });

    // All normal UI elements should be restored
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();
    expect(screen.getByTestId('mock-diagram-selector')).toBeTruthy();
    // PalettePanel and InspectorPanel should be visible again
    expect(screen.getByTestId('mock-palette-panel')).toBeTruthy();
    expect(screen.getByTestId('mock-inspector-panel')).toBeTruthy();
    // Banner and renderer should be gone
    expect(screen.queryByTestId('temporary-diagram-banner')).toBeNull();
    expect(screen.queryByTestId('mock-temporary-diagram-renderer')).toBeNull();
    expect(screen.queryByTestId('temporary-diagram-loading')).toBeNull();
    expect(screen.queryByTestId('temporary-diagram-error')).toBeNull();
  });
});

// ============================================================================
// Spec 2026-03-27: Deterministic Diagram Auto-Mapping (Increment 5)
// Task Group 7: Integration into DiagramsView Component
// ============================================================================

describe('DiagramsView - Temporary Diagram Mapping Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTemporaryDiagramRequest = null;
    mockFetchTemporaryDiagram.mockClear();
    mockFetchTemporaryDiagram.mockImplementation(() => {
      return new Promise<TemporaryArchitectureDiagram>((resolve, reject) => {
        fetchResolve = resolve;
        fetchReject = reject;
      });
    });
    mockMapTemporaryDiagram.mockClear();
    mockMapTemporaryDiagram.mockReturnValue({
      nodes: [],
      attributes: [],
      edges: [],
      summary: {
        nodes: { total: 0, matched: 0, unmatched: 0 },
        attributes: { total: 0, matched: 0, unmatched: 0 },
        edges: { total: 0, matched: 0, unmatched: 0 },
      },
      overallStatus: 'no_matches',
    });
  });

  /**
   * Task 7.1 Test 1: When temporaryDiagramState.data is set and the meta-model is available,
   * mapTemporaryDiagram is called and mappingResult is populated on the state (not null).
   */
  it('calls mapTemporaryDiagram with loaded data and available meta-model, populating mappingResult', async () => {
    // Given - a meta-model is available in the architecture state
    const testMetaModel = {
      entities: {
        logical_data_entities: [{ id: 'ent-1', name: 'Customer' }],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
      relationships: {
        logical_data_entity_relationships: [],
      },
    };
    // Set metaModel on the mock state (mutable object)
    const previousMetaModel = mockState.model.metaModel;
    (mockState.model as any).metaModel = testMetaModel;

    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // Resolve the fetch with diagram data
    await act(async () => {
      fetchResolve(diagramData);
    });

    // Then - mapTemporaryDiagram should have been called with the diagram data and the meta-model
    expect(mockMapTemporaryDiagram).toHaveBeenCalledTimes(1);
    expect(mockMapTemporaryDiagram).toHaveBeenCalledWith(diagramData, testMetaModel);

    // Restore previous metaModel for other tests
    (mockState.model as any).metaModel = previousMetaModel;
  });

  /**
   * Task 7.1 Test 2: When temporaryDiagramState.data is null (not yet loaded),
   * mapTemporaryDiagram is NOT called and mappingResult remains null.
   */
  it('does not call mapTemporaryDiagram when diagram data is null (not yet loaded)', async () => {
    // Given - activate temporary diagram mode but do NOT resolve the fetch
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    // The fetch was triggered but not resolved - data is still null, loading state shown
    expect(screen.getByTestId('temporary-diagram-loading')).toBeTruthy();

    // Then - mapTemporaryDiagram should NOT have been called since data is not loaded
    expect(mockMapTemporaryDiagram).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Spec 2026-03-27: Mapping Confirmation Modal Framework (Increment 6)
// Task Group 4: DiagramsView Integration and Modal Trigger
// ============================================================================

describe('DiagramsView - Mapping Confirmation Modal Integration', () => {
  const testMetaModel = {
    entities: {
      logical_data_entities: [{ id: 'ent-1', name: 'Customer' }],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
    },
    relationships: {
      logical_data_entity_relationships: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTemporaryDiagramRequest = null;
    capturedMappingModalProps = null;
    mockFetchTemporaryDiagram.mockClear();
    mockFetchTemporaryDiagram.mockImplementation(() => {
      return new Promise<TemporaryArchitectureDiagram>((resolve, reject) => {
        fetchResolve = resolve;
        fetchReject = reject;
      });
    });
    mockMapTemporaryDiagram.mockClear();
  });

  /**
   * Task 4.1 Test 1: Modal does NOT open when mappingResult.overallStatus is 'fully_matched'.
   */
  it('does not open the mapping confirmation modal when overallStatus is fully_matched', async () => {
    // Given - mapping engine returns fully_matched
    mockMapTemporaryDiagram.mockReturnValue({
      nodes: [{ temporaryNodeId: 'n1', matchedEntityId: 'ent-1', status: 'matched' }],
      attributes: [],
      edges: [],
      summary: {
        nodes: { total: 1, matched: 1, unmatched: 0 },
        attributes: { total: 0, matched: 0, unmatched: 0 },
        edges: { total: 0, matched: 0, unmatched: 0 },
      },
      overallStatus: 'fully_matched',
    });

    const previousMetaModel = mockState.model.metaModel;
    (mockState.model as any).metaModel = testMetaModel;

    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    await act(async () => {
      fetchResolve(diagramData);
    });

    // Then - modal should NOT be rendered
    expect(screen.queryByTestId('mock-mapping-confirmation-modal')).toBeNull();

    // Restore metaModel
    (mockState.model as any).metaModel = previousMetaModel;
  });

  /**
   * Task 4.1 Test 2: Modal opens automatically when mappingResult.overallStatus is 'partially_matched'.
   */
  it('opens the mapping confirmation modal when overallStatus is partially_matched', async () => {
    // Given - mapping engine returns partially_matched
    mockMapTemporaryDiagram.mockReturnValue({
      nodes: [
        { temporaryNodeId: 'n1', matchedEntityId: 'ent-1', status: 'matched' },
        { temporaryNodeId: 'n2', matchedEntityId: null, status: 'unmatched', reasonCode: 'no_entity_match' },
      ],
      attributes: [],
      edges: [],
      summary: {
        nodes: { total: 2, matched: 1, unmatched: 1 },
        attributes: { total: 0, matched: 0, unmatched: 0 },
        edges: { total: 0, matched: 0, unmatched: 0 },
      },
      overallStatus: 'partially_matched',
    });

    const previousMetaModel = mockState.model.metaModel;
    (mockState.model as any).metaModel = testMetaModel;

    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    await act(async () => {
      fetchResolve(diagramData);
    });

    // Then - modal should be rendered
    expect(screen.getByTestId('mock-mapping-confirmation-modal')).toBeTruthy();

    // Restore metaModel
    (mockState.model as any).metaModel = previousMetaModel;
  });

  /**
   * Task 4.1 Test 3: Modal opens automatically when mappingResult.overallStatus is 'no_matches'.
   */
  it('opens the mapping confirmation modal when overallStatus is no_matches', async () => {
    // Given - mapping engine returns no_matches
    mockMapTemporaryDiagram.mockReturnValue({
      nodes: [
        { temporaryNodeId: 'n1', matchedEntityId: null, status: 'unmatched', reasonCode: 'no_entity_match' },
      ],
      attributes: [],
      edges: [],
      summary: {
        nodes: { total: 1, matched: 0, unmatched: 1 },
        attributes: { total: 0, matched: 0, unmatched: 0 },
        edges: { total: 0, matched: 0, unmatched: 0 },
      },
      overallStatus: 'no_matches',
    });

    const previousMetaModel = mockState.model.metaModel;
    (mockState.model as any).metaModel = testMetaModel;

    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    await act(async () => {
      fetchResolve(diagramData);
    });

    // Then - modal should be rendered
    expect(screen.getByTestId('mock-mapping-confirmation-modal')).toBeTruthy();

    // Restore metaModel
    (mockState.model as any).metaModel = previousMetaModel;
  });

  /**
   * Task 4.1 Test 4: Modal only opens once per mapping result (re-render does not re-trigger).
   * After cancelling the modal, it should not re-open automatically on subsequent re-renders.
   */
  it('opens modal only once per mapping result; cancelling does not re-trigger it', async () => {
    // Given - mapping engine returns partially_matched
    mockMapTemporaryDiagram.mockReturnValue({
      nodes: [
        { temporaryNodeId: 'n1', matchedEntityId: null, status: 'unmatched', reasonCode: 'no_entity_match' },
      ],
      attributes: [],
      edges: [],
      summary: {
        nodes: { total: 1, matched: 0, unmatched: 1 },
        attributes: { total: 0, matched: 0, unmatched: 0 },
        edges: { total: 0, matched: 0, unmatched: 0 },
      },
      overallStatus: 'partially_matched',
    });

    const previousMetaModel = mockState.model.metaModel;
    (mockState.model as any).metaModel = testMetaModel;

    const diagramData = createTestDiagram();
    mockTemporaryDiagramRequest = { projectId: 'proj-1', temporaryDiagramId: 'temp-diag-1' };

    await act(async () => {
      renderWithRouter(<DiagramsView />);
    });

    await act(async () => {
      fetchResolve(diagramData);
    });

    // Modal should be open
    expect(screen.getByTestId('mock-mapping-confirmation-modal')).toBeTruthy();

    // Cancel the modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-modal-cancel'));
    });

    // Modal should be closed
    expect(screen.queryByTestId('mock-mapping-confirmation-modal')).toBeNull();

    // The modal should NOT re-appear on its own (the guard ref prevents re-trigger)
    // Force a re-render by waiting
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Still closed - the open-once guard prevents re-triggering
    expect(screen.queryByTestId('mock-mapping-confirmation-modal')).toBeNull();

    // Restore metaModel
    (mockState.model as any).metaModel = previousMetaModel;
  });
});
