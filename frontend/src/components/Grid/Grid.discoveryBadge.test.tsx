/**
 * Tests for Discovery-Origin Badge Rendering in Grid
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 6: Meta-Model Discovery-Origin Badges
 * Task 6.1: Write 3-4 focused tests for discovery-origin badge rendering
 *
 * Tests cover:
 * 1. Entities matching an origin mapping display a "Discovered" badge next to their name
 * 2. Entities without a matching origin mapping do not display a badge
 * 3. Badge data fetch failure results in no badges shown (non-blocking, no errors surfaced)
 * 4. Hook returns correct lookup map structure from API response
 *
 * Testing approach:
 * - Tests 1-2 render a simplified Grid with mocked dependencies, verifying
 *   badge presence/absence based on the discoveryOrigins prop
 * - Test 3 uses renderHook on useDiscoveryOrigins to verify graceful error handling
 * - Test 4 uses renderHook on useDiscoveryOrigins to verify map construction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

// ============================================================================
// Mock Setup: Grid has many heavy dependencies that need mocking
// ============================================================================

// Mock DnD libraries (Grid uses @dnd-kit)
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
  arrayMove: vi.fn(),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => ''),
    },
  },
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  GripVertical: () => <span data-testid="grip-icon">grip</span>,
}));

// Mock ArchitectureContext
const mockModel = {
  metaModel: {
    entities: {
      applications: [
        { id: 'app-1', name: 'OrderService', description: 'Handles orders', tags: '' },
        { id: 'app-2', name: 'PaymentService', description: 'Handles payments', tags: '' },
        { id: 'app-3', name: 'InventoryService', description: 'Handles inventory', tags: '' },
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
  useArchitectureDispatch: vi.fn(() => vi.fn()),
}));

// 2026-04-22: Grid now also consumes ProjectContext for the Start Discovery
// Run action; mock to a null active project so the action path stays inert.
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => null),
}));

// Mock AppConfigContext (used by GridCell)
vi.mock('../../contexts/AppConfigContext', () => ({
  useAppConfig: vi.fn(() => ({
    uiCharacteristicsUiCapabilityKeys: [],
    uiCharacteristicsInteractionComplexityKeys: [],
    uiCharacteristicsTechnicalShapeKeys: [],
  })),
}));

// Mock gridConfigs to return a simple columns config for applications
vi.mock('../../config/gridConfigs', () => ({
  gridConfigs: {
    applications: [
      { field: 'name', displayName: 'Name', cellType: 'text', width: '200px', required: true },
      { field: 'description', displayName: 'Description', cellType: 'text', width: '300px' },
    ],
  },
}));

// Mock validation
vi.mock('../../utils/validation', () => ({
  validateModel: vi.fn(() => []),
  getCellValidationError: vi.fn(() => null),
}));

// Mock idGenerator
vi.mock('../../utils/idGenerator', () => ({
  generateEntityId: vi.fn(() => 'new-entity-id'),
}));

// Mock child components that Grid renders (modals, context menu, etc.)
vi.mock('./GridRowContextMenu', () => ({
  GridRowContextMenu: () => null,
}));

vi.mock('../DiagramsView/AdvancedAddDialog', () => ({
  AdvancedAddDialog: () => null,
}));

vi.mock('../DiagramsView/modals/AttachBusinessLogicModal', () => ({
  AttachBusinessLogicModal: () => null,
}));

vi.mock('../DiagramsView/modals/AttachToApplicationPointModal', () => ({
  AttachToApplicationPointModal: () => null,
}));

vi.mock('../DiagramsView/modals/CreateBusinessLogicModal', () => ({
  CreateBusinessLogicModal: () => null,
}));

vi.mock('../MetaModelView/CreatePackageSetModal', () => ({
  CreatePackageSetModal: () => null,
}));

// Mock discoveryApi (used by useDiscoveryOrigins hook)
vi.mock('../../api/discoveryApi', () => ({
  getDiscoveryOriginEntities: vi.fn(),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { Grid } from './Grid';
import { useDiscoveryOrigins } from '../../hooks/useDiscoveryOrigins';
import type { DiscoveryOriginsMap } from '../../hooks/useDiscoveryOrigins';
import { getDiscoveryOriginEntities } from '../../api/discoveryApi';
import type { DiscoveryCandidateEntityMappingDto } from '../../api/discoveryApi';
import { renderWithRouter } from '../../test-utils/renderWithProviders';

// ============================================================================
// Tests
// ============================================================================

describe('Grid Discovery-Origin Badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: Entities matching an origin mapping display a "Discovered" badge
  // --------------------------------------------------------------------------
  it('renders "Discovered" badge next to entity names that have a discovery origin', () => {
    // Given: a discoveryOrigins map with app-1 and app-3 as discovered
    const discoveryOrigins: DiscoveryOriginsMap = new Map([
      ['applications', new Set(['app-1', 'app-3'])],
    ]);

    // When: Grid renders with discoveryOrigins prop
    renderWithRouter(
      <Grid entityType="applications" discoveryOrigins={discoveryOrigins} />
    );

    // Then: "Discovered" badges should appear
    const badges = screen.getAllByTestId('discovered-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Discovered');
    expect(badges[1]).toHaveTextContent('Discovered');
  });

  // --------------------------------------------------------------------------
  // Test 2: Entities without a matching origin mapping do not display a badge
  // --------------------------------------------------------------------------
  it('does not render "Discovered" badge for entities without discovery origin', () => {
    // Given: a discoveryOrigins map that only includes app-1
    const discoveryOrigins: DiscoveryOriginsMap = new Map([
      ['applications', new Set(['app-1'])],
    ]);

    // When: Grid renders with discoveryOrigins prop
    renderWithRouter(
      <Grid entityType="applications" discoveryOrigins={discoveryOrigins} />
    );

    // Then: only one badge should appear (for app-1)
    const badges = screen.getAllByTestId('discovered-badge');
    expect(badges).toHaveLength(1);

    // The badge-less entities (app-2, app-3) should NOT have badges
    // Total rows = 3, badges = 1
  });

  // --------------------------------------------------------------------------
  // Test 3: No badges shown when discoveryOrigins prop is undefined
  // --------------------------------------------------------------------------
  it('renders no badges when discoveryOrigins is undefined (e.g., fetch failure)', () => {
    // Given: no discoveryOrigins prop (simulates fetch failure producing empty map or undefined)
    // When: Grid renders without discoveryOrigins
    renderWithRouter(
      <Grid entityType="applications" />
    );

    // Then: no badges should be present
    const badges = screen.queryAllByTestId('discovered-badge');
    expect(badges).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 4: No badges when discoveryOrigins has entries for a different entity type
  // --------------------------------------------------------------------------
  it('renders no badges when discoveryOrigins has no entries for the current entityType', () => {
    // Given: discoveryOrigins only has data for 'services', not 'applications'
    const discoveryOrigins: DiscoveryOriginsMap = new Map([
      ['services', new Set(['svc-1', 'svc-2'])],
    ]);

    // When: Grid renders as applications with service-only origins
    renderWithRouter(
      <Grid entityType="applications" discoveryOrigins={discoveryOrigins} />
    );

    // Then: no badges should be present for the applications grid
    const badges = screen.queryAllByTestId('discovered-badge');
    expect(badges).toHaveLength(0);
  });
});

describe('useDiscoveryOrigins hook', () => {
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  // --------------------------------------------------------------------------
  // Test 5: Hook returns correct lookup map from API response
  // --------------------------------------------------------------------------
  it('builds a correct Map<entityType, Set<entityId>> from API response', async () => {
    // Given: API returns mappings for multiple entity types
    const mockMappings: DiscoveryCandidateEntityMappingDto[] = [
      {
        id: 'map-1',
        candidate_id: 'cand-1',
        run_id: 'run-1',
        entity_type: 'applications',
        entity_id: 'app-1',
        action: 'created',
        created_at: '2026-04-01T10:00:00Z',
      },
      {
        id: 'map-2',
        candidate_id: 'cand-2',
        run_id: 'run-1',
        entity_type: 'services',
        entity_id: 'svc-1',
        action: 'created',
        created_at: '2026-04-01T10:00:00Z',
      },
      {
        id: 'map-3',
        candidate_id: 'cand-3',
        run_id: 'run-1',
        entity_type: 'applications',
        entity_id: 'app-2',
        action: 'reused',
        created_at: '2026-04-01T10:00:00Z',
      },
    ];

    vi.mocked(getDiscoveryOriginEntities).mockResolvedValueOnce(mockMappings);

    // When: hook is called with a projectId
    const { result } = renderHook(() => useDiscoveryOrigins('proj-123', 'arch-uuid-default'));

    // Then: wait for the async fetch to complete
    await waitFor(() => {
      expect(result.current.size).toBeGreaterThan(0);
    });

    // Verify the map structure
    expect(result.current.has('applications')).toBe(true);
    expect(result.current.has('services')).toBe(true);
    expect(result.current.get('applications')!.has('app-1')).toBe(true);
    expect(result.current.get('applications')!.has('app-2')).toBe(true);
    expect(result.current.get('services')!.has('svc-1')).toBe(true);
    expect(result.current.get('applications')!.size).toBe(2);
    expect(result.current.get('services')!.size).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test 6: Hook handles fetch failure gracefully (non-blocking)
  // --------------------------------------------------------------------------
  it('returns empty map on fetch failure and logs a warning', async () => {
    // Given: API call rejects
    vi.mocked(getDiscoveryOriginEntities).mockRejectedValueOnce(new Error('Network error'));

    // When: hook is called
    const { result } = renderHook(() => useDiscoveryOrigins('proj-123', 'arch-uuid-default'));

    // Then: wait for the error to be handled
    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledWith(
        'Failed to fetch discovery origins, badges will not be shown:',
        expect.any(Error),
      );
    });

    // The map should be empty (not throw)
    expect(result.current.size).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Test 7: Hook returns empty map when projectId is undefined
  // --------------------------------------------------------------------------
  it('returns empty map when projectId is undefined', () => {
    // When: hook is called with undefined projectId
    const { result } = renderHook(() => useDiscoveryOrigins(undefined, undefined));

    // Then: no fetch should be called, map should be empty
    expect(getDiscoveryOriginEntities).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });
});
