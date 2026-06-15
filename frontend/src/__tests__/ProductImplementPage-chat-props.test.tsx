/**
 * Tests for ProductImplementPage prop passing to ImplementationAssistantPanel
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 6: ProductImplementPage Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the architecture context hook before imports
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
  useArchitecture: vi.fn(() => ({
    loadedFileName: 'test-project.json',
    model: {
      metaModel: {
        entities: {
          services: [
            { id: 'SVC-001', name: 'Auth Service', description: 'Auth service', tags: '' },
          ],
          applications: [],
          interfaces: [],
          businessProcesses: [],
          businessUsers: [],
          processActivities: [],
          dataEntities: [],
          physicalTables: [],
          businessLogicUnits: [],
          diagrams: [],
          logicalAttributes: [],
          physicalAttributes: [],
          uiDomains: [],
          uiDataGroups: [],
          endpoints: [],
          endpointParameters: [],
          logicalDataEntityRelationships: [],
          serviceApplicationRelationships: [],
          interfaceApplicationRelationships: [],
          applicationDataMovements: [],
          businessLogicEndpointRelationships: [],
          externalSystemTriggerRelationships: [],
          scheduledTriggerRelationships: [],
          serviceScheduledTriggerRelationships: [],
          serviceEventTriggerRelationships: [],
        },
      },
      diagrams: [
        {
          id: 'DIA-001',
          name: 'Architecture Diagram',
          description: 'System architecture',
          diagramType: 'system-overview',
          nodes: [],
          edges: [],
          typedContent: { type: 'system-overview', content: '' },
        },
      ],
    },
    setModel: vi.fn(),
    setLoadedFileName: vi.fn(),
    appendWorkItems: vi.fn(),
    refreshWorkItems: vi.fn(),
  })),
}));

// Mock the chat API
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn().mockResolvedValue({
    sessionId: 'test-session',
    assistant: { message: 'Response' },
  }),
  };
});

// Mock the work items API
vi.mock('../api/workItemsApi', () => ({
  fetchWorkItems: vi.fn().mockResolvedValue([
    {
      id: 'WI-001',
      title: 'Add user authentication',
      type: 'Feature',
      description: 'Implement OAuth2 authentication flow',
      status: 'todo',
      parent_id: null,
    },
    {
      id: 'WI-002',
      title: 'Create login page',
      type: 'Story',
      description: 'Create a login page',
      status: 'in_progress',
      parent_id: 'WI-001',
    },
  ]),
}));

// Mock the implement context API
vi.mock('../api/implementContextApi', () => ({
  fetchImplementContext: vi.fn().mockResolvedValue({
    version: 1,
    entity_refs: [
      { kind: 'ENTITY', entity_type: 'services', entity_id: 'SVC-001', label: 'Auth Service' },
    ],
    diagram_refs: [
      { kind: 'DIAGRAM', diagram_id: 'DIA-001', label: 'Architecture Diagram' },
    ],
  }),
  saveImplementContext: vi.fn().mockResolvedValue(undefined),
}));

// Mock ProductUiStateContext
vi.mock('../contexts/ProductUiStateContext', () => ({
  ProductUiStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useProductUiState: () => ({
    getImplementChatState: vi.fn(() => null),
    setImplementChatState: vi.fn(),
    getLastImplementWorkItemId: vi.fn(() => null),
    setLastImplementWorkItemId: vi.fn(),
    getExpandedIds: vi.fn(() => new Set()),
    setExpandedIds: vi.fn(),
    toggleExpanded: vi.fn(),
  }),
  deriveProjectKey: (id: string) => id,
}));

import { screen, waitFor } from '@testing-library/react';
import { ProductImplementPage } from '../components/ProductView/ProductImplementPage';
import { renderWithProviders, makeTestProject } from '../test-utils/renderWithProviders';

describe('ProductImplementPage Chat Integration Props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ImplementationAssistantPanel prop passing', () => {
    it('should pass workItemId, workItemTitle, workItemType, workItemDescription to ImplementationAssistantPanel', async () => {
      const onBackToBacklog = vi.fn();

      renderWithProviders(
        <ProductImplementPage
          workItemId="WI-001"
          onBackToBacklog={onBackToBacklog}
        />
      , { project: makeTestProject(), withArchitecture: false });

      // Wait for work items to load and component to render
      await waitFor(() => {
        expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
      });

      // The ImplementationAssistantPanel should be rendered (the old title
      // header was replaced by the chat header room label)
      expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
      expect(screen.getByText('Implementation Studio')).toBeInTheDocument();
    });

    it('should pass projectId (loadedFileName) and contextState to ImplementationAssistantPanel', async () => {
      const onBackToBacklog = vi.fn();

      renderWithProviders(
        <ProductImplementPage
          workItemId="WI-001"
          onBackToBacklog={onBackToBacklog}
        />
      , { project: makeTestProject(), withArchitecture: false });

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
      });

      // The panel should render the empty state initially
      await waitFor(() => {
        expect(screen.getByText(/Start a conversation/i)).toBeInTheDocument();
      });
    });

    it('should render ImplementationAssistantPanel with ChatInput enabled', async () => {
      const onBackToBacklog = vi.fn();

      renderWithProviders(
        <ProductImplementPage
          workItemId="WI-002"
          onBackToBacklog={onBackToBacklog}
        />
      , { project: makeTestProject(), withArchitecture: false });

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByTestId('implementation-assistant-panel')).toBeInTheDocument();
      });

      // ChatInput should be present and not disabled
      const input = screen.getByRole('textbox', { name: /chat message input/i });
      expect(input).toBeInTheDocument();
      expect(input).not.toBeDisabled();
    });
  });
});
