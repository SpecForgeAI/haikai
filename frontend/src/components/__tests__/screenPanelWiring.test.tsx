/**
 * Screen-Level Panel Wiring Tests
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 4, Task 4.1: Write 6 focused tests for screen-level wiring
 *
 * Tests verify:
 * 1. DashboardView passes `defaultOpen={true}` to UnifiedChatPanel
 * 2. ProductPage passes `onArtifactSaved` callback and `artifactExists` record
 * 3. ProductRoadmapPage passes `onArtifactSaved` callback and `artifactExists` record
 * 4. MetaModelView passes `onArtifactSaved` callback (no `artifactExists`)
 * 5. ProductPage includes `allowedPersonaIds={['product-manager']}` (already present, verify unchanged)
 * 6. MetaModelView includes `allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}` (already present, verify unchanged)
 *
 * Strategy: Mock UnifiedChatPanel to capture props passed to it, then assert
 * the expected props are present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import React from 'react';
import { Routes, Route } from 'react-router-dom';

// ============================================================================
// Capture variable for UnifiedChatPanel props
// ============================================================================

let capturedPanelProps: Record<string, unknown> | null = null;

// ============================================================================
// Mocks: Must be declared before component imports
// ============================================================================

// Mock UnifiedChatPanel to capture props
vi.mock('../UnifiedChat', () => ({
  UnifiedChatPanel: (props: Record<string, unknown>) => {
    capturedPanelProps = props;
    return <div data-testid="mock-unified-chat-panel" />;
  },
}));

// Mock dashboardApi
const mockGetDashboardSummary = vi.fn();
vi.mock('../../api/dashboardApi', () => ({
  getDashboardSummary: (...args: unknown[]) => mockGetDashboardSummary(...args),
}));

// Mock modelApi
const mockLoadModelByProjectId = vi.fn();
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: (...args: unknown[]) => mockLoadModelByProjectId(...args),
}));

// Mock ProjectContext
const mockActiveProject = { id: 'proj-1', name: 'Test Project', projectParentFolder: '/test', projectHierarchy: null, organisationId: null, isActive: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useProjectLoading: () => false,
}));

// Mock ArchitectureContext
const mockDispatch = vi.fn();
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: () => ({
    model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
    currentView: 'metamodel',
    selectedTab: 'Users',
    selectedDiagramId: null,
    loadedFileName: 'test-project',
    validationErrors: [],
    isPalettePanelCollapsed: false,
    sectionExpandStates: {},
    paletteSearchQuery: '',
    isInspectorPanelCollapsed: false,
    selectedDomain: 'business',
    relationshipCellLabels: {},
  }),
  useArchitectureDispatch: () => mockDispatch,
  useActiveArchitectureId: () => 'arch-default-id',
}));

// Mock ProductUiStateContext (required by ProductRoadmapPage)
vi.mock('../../contexts/ProductUiStateContext', () => ({
  useProductExpansion: () => ({
    expandedIds: new Set<string>(),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
  deriveProjectKey: () => 'test-project-key',
}));

// Mock workItemsApi
vi.mock('../../api/workItemsApi', () => ({
  fetchWorkItems: vi.fn().mockResolvedValue([]),
}));

// Mock roadmapApi
vi.mock('../../api/roadmapApi', () => ({
  importRoadmap: vi.fn(),
  fetchLatestArtifactMetadata: vi.fn().mockResolvedValue(null),
}));

// Mock workItemTreeBuilder
vi.mock('../../utils/workItemTreeBuilder', () => ({
  buildWorkItemTree: () => ({ roots: [], orphans: [] }),
}));

// Mock Grid, RelationshipGrid, DomainSelector, PackageSetsView (MetaModelView deps)
vi.mock('../Grid/Grid', () => ({ Grid: () => <div data-testid="mock-grid" /> }));
vi.mock('../Grid/RelationshipGrid', () => ({ RelationshipGrid: () => <div data-testid="mock-relationship-grid" /> }));
vi.mock('../MetaModelView/DomainSelector', () => ({ DomainSelector: () => <div data-testid="mock-domain-selector" /> }));
vi.mock('../MetaModelView/PackageSetsView', () => ({ PackageSetsView: () => <div data-testid="mock-package-sets" /> }));

// Mock gridConfigs and relationshipDefinitions (MetaModelView deps)
vi.mock('../../config/gridConfigs', () => ({
  tabToEntityType: {},
  relationshipTabToType: {},
  domainGroupings: { business: ['Users'] },
}));
vi.mock('../../config/relationshipDefinitions', () => ({
  getOrderedRelationshipDisplayNamesForDomain: () => [],
}));

// Mock shared components (ProductRoadmapPage deps)
vi.mock('../shared/ResizableSplitPane', () => ({
  ResizableSplitPane: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="mock-resizable-split-pane">{left}{right}</div>
  ),
}));
vi.mock('../ProductView/WorkItemTree', () => ({
  WorkItemTree: () => <div data-testid="mock-work-item-tree" />,
}));

// Mock DashboardSkeleton (DashboardView dep)
vi.mock('../DashboardView/DashboardSkeleton', () => ({
  DashboardSkeleton: () => <div data-testid="mock-skeleton" />,
}));

// ============================================================================
// Sample dashboard summary data
// ============================================================================

const sampleDashboardSummary = {
  header: {
    projectName: 'Test Project',
    generatedAt: '2026-03-03T00:00:00Z',
    initiativesCount: 3,
    epicsCount: 10,
    activeEpicsCount: 5,
    storiesInProgressCount: 2,
    lastUpdatedLabel: '2 hours ago',
    mode: 'GREENFIELD',
    headerInsight: null,
  },
  strategicFoundation: {
    productDefinition: {
      missionExists: { label: 'Mission Exists', value: true },
      lastUpdatedLabel: { label: 'Last Updated', value: '01/03/2026' },
    },
    roadmap: {
      initiativesCount: { label: 'Initiatives', value: 3 },
      epics: { label: 'Epics', value: 10 },
      completed: { label: 'Completed', value: 2 },
    },
    usersAndInteractions: {
      userRoles: { label: 'User Roles', value: 0 },
      businessActivities: { label: 'Business Activities', value: 0 },
      uiScreens: { label: 'UI Screens', value: 'No UI' },
    },
    highLevelArchitecture: {
      overall: { label: 'Overall', value: 5 },
      applications: { label: 'Applications', value: 2 },
      services: { label: 'Services', value: 3 },
      interfaces: { label: 'Interfaces', value: 4 },
      dataStores: { label: 'Data Stores', value: 1 },
    },
    standards: {
      orgTechStack: { label: 'Org Tech Stack', value: 'Generated' },
      productTechStack: { label: 'Product Tech Stack', value: 'Generated' },
    },
    testStrategy: {
      exists: { label: 'Exists', value: true },
      lastUpdated: { label: 'Last Updated', value: '08/03/2026' },
    },
    summaryInsight: { enabled: false, message: null },
  },
  scope: { type: 'NEXT_5_EPICS', label: 'Next 5 Epics', scopeValue: null },
  detailedDefinitionAndDelivery: {
    preCoding: {
      backlog: {
        epicsInScope: { label: 'Epics in Scope', value: 5 },
        featuresCount: { label: 'Features', value: 10 },
        storiesCount: { label: 'Stories', value: 30 },
        storiesWithAcceptanceCriteriaCount: { label: 'With AC', value: 25 },
      },
      detailedArchitecture: {
        overall: { label: 'Overall', value: 10 },
        processActivities: { label: 'Process Activities', value: 5 },
        interfaceEndpoints: { label: 'Endpoints', value: 3 },
        logicalDataEntities: { label: 'Logical', value: 4 },
        physicalDataEntities: { label: 'Physical', value: 3 },
      },
      testingSuite: {
        endToEndTestCount: { label: 'E2E Tests', value: 5 },
        functionalTestCount: { label: 'Functional Tests', value: 10 },
      },
    },
    postCoding: {
      implementation: {
        featuresInProgress: { label: 'Features in Progress', value: 0 },
        storiesInProgress: { label: 'Stories in Progress', value: 0 },
        storiesComplete: { label: 'Stories Complete', value: 0 },
      },
      verification: {
        storiesVerifiedCount: { label: 'Verified', value: 0 },
        pendingReviewCount: { label: 'Pending', value: 0 },
      },
      summaryInsight: { enabled: false, message: null },
    },
  },
};

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { DashboardView } from '../DashboardView/DashboardView';
import { ProductPage } from '../ProductView/ProductPage';
import { ProductRoadmapPage } from '../ProductView/ProductRoadmapPage';
import { MetaModelView } from '../MetaModelView/MetaModelView';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

// ============================================================================
// Tests
// ============================================================================

describe('Screen-Level Panel Wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPanelProps = null;
    mockGetDashboardSummary.mockResolvedValue(sampleDashboardSummary);
    mockLoadModelByProjectId.mockResolvedValue({
      metaModel: { entities: {}, relationships: {} },
      diagrams: [],
    });
  });

  // --------------------------------------------------------------------------
  // Test 1: DashboardView passes `defaultOpen={true}` to UnifiedChatPanel
  // --------------------------------------------------------------------------

  it('DashboardView passes defaultOpen={true} to UnifiedChatPanel', async () => {
    renderWithRouter(<DashboardView />);

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
    });

    expect(capturedPanelProps!.defaultOpen).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 2: ProductPage passes `onArtifactSaved` callback and `artifactExists` record
  // --------------------------------------------------------------------------

  it('ProductPage passes onArtifactSaved callback and artifactExists record', async () => {
    renderWithRouter(<ProductPage />);

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
      expect(capturedPanelProps!.artifactExists).toBeDefined();
    });

    // onArtifactSaved should be a function
    expect(typeof capturedPanelProps!.onArtifactSaved).toBe('function');

    // artifactExists should contain mission and roadmap keys
    const artifactExists = capturedPanelProps!.artifactExists as Record<string, boolean>;
    expect(artifactExists).toHaveProperty('mission');
    expect(artifactExists).toHaveProperty('roadmap');

    // With sample data, mission should be true (missionExists.value === 1)
    expect(artifactExists.mission).toBe(true);
    // With sample data, roadmap should be true (roadmap.state.value === 3 > 0)
    expect(artifactExists.roadmap).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 3: ProductRoadmapPage passes `onArtifactSaved` callback and `artifactExists` record
  // --------------------------------------------------------------------------

  it('ProductRoadmapPage passes onArtifactSaved callback and artifactExists record', async () => {
    renderWithRouter(
      <ProductRoadmapPage
        onNavigateToBacklog={vi.fn()}
        onControlStateChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
      expect(capturedPanelProps!.artifactExists).toBeDefined();
    });

    // onArtifactSaved should be a function
    expect(typeof capturedPanelProps!.onArtifactSaved).toBe('function');

    // artifactExists should contain mission and roadmap keys
    const artifactExists = capturedPanelProps!.artifactExists as Record<string, boolean>;
    expect(artifactExists).toHaveProperty('mission');
    expect(artifactExists).toHaveProperty('roadmap');
  });

  // --------------------------------------------------------------------------
  // Test 4: MetaModelView passes `onArtifactSaved` callback (no `artifactExists`)
  // --------------------------------------------------------------------------

  it('MetaModelView passes onArtifactSaved callback but no artifactExists', async () => {
    // Spec 2026-05-04: MetaModelView is a route layout reading `:domain`.
    renderWithRouter(
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/metamodel/:domain"
          element={<MetaModelView />}
        />
      </Routes>,
      { initialEntries: ['/projects/proj-1/architectures/arch-default-id/metamodel/application'] }
    );

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
    });

    // onArtifactSaved should be a function
    expect(typeof capturedPanelProps!.onArtifactSaved).toBe('function');

    // artifactExists should NOT be provided (per spec: omit for MetaModel)
    expect(capturedPanelProps!.artifactExists).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 5: ProductPage includes `allowedPersonaIds={['product-manager']}`
  // --------------------------------------------------------------------------

  it('ProductPage includes allowedPersonaIds with product-manager', async () => {
    renderWithRouter(<ProductPage />);

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
    });

    expect(capturedPanelProps!.allowedPersonaIds).toEqual(['product-manager']);
  });

  // --------------------------------------------------------------------------
  // Test 6: MetaModelView includes `allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}`
  // --------------------------------------------------------------------------

  it('MetaModelView includes allowedPersonaIds with architect, ux-designer, test-engineer', async () => {
    renderWithRouter(
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/metamodel/:domain"
          element={<MetaModelView />}
        />
      </Routes>,
      { initialEntries: ['/projects/proj-1/architectures/arch-default-id/metamodel/application'] }
    );

    await waitFor(() => {
      expect(capturedPanelProps).not.toBeNull();
    });

    expect(capturedPanelProps!.allowedPersonaIds).toEqual(['architect', 'ux-designer', 'test-engineer']);
  });
});
