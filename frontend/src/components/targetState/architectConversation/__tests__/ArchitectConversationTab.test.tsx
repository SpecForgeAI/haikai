/**
 * Tests for Surface 1 -- Architect Conversation tab renders inside the
 * Target State sub-tab.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.1)
 *
 * Covers (4 tests):
 *   1. Tab renders as a peer to "Table editor" + "Compare with current"
 *      inside the Target State sub-tab.
 *   2. Tab is selectable and renders the active content area
 *      (`data-testid="architect-conversation-tab"`).
 *   3. Tab hides when the user is not on the Target State sub-tab (rendered
 *      via the Architecture Design page; navigating away unmounts the tab).
 *   4. Tab label and ordering match the design (3rd peer after Table editor +
 *      Compare with current).
 *
 * Mock surface mirrors the existing colocated workspace tests
 * (`TargetArchitectureWorkspace.test.tsx`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
// ---------------------------------------------------------------------------

vi.mock('../../../../api/targetArchitecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/targetArchitecturesApi')
  >('../../../../api/targetArchitecturesApi');
  return {
    ...actual,
    listTargetArchitectures: vi.fn(),
    listUnmappedCurrentElements: vi.fn(),
  };
});

vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    getElementsInventory: vi.fn().mockResolvedValue({ domains: [] }),
    updateArchitecture: vi.fn(),
  };
});

vi.mock('../../../../api/architectConversationApi', () => ({
  loadConversation: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  answerQuestion: vi.fn(),
  acceptCascadeBatch: vi.fn(),
  overrideCascade: vi.fn(),
  revisePriorAnswer: vi.fn(),
  pinException: vi.fn(),
  getActiveTargetArchitectureId: vi.fn(),
  ALLOWED_SCOPE_REF_TYPES: [
    'service',
    'interface',
    'endpoint',
    'physical_data_entity',
    'physical_data_attribute',
    'method',
    'class',
  ],
  ArchitectConversationApiError: class extends Error {},
}));

vi.mock('../../../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({
    metaModel: { entities: {}, relationships: {} },
    diagrams: [],
  }),
}));

vi.mock('../../../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../../../../contexts/ArchitectureContext', () => ({
  // Spec 2026-06-05-architect-tier-gating (Half B): the tab derives the
  // default tier set via useArchitecture(); empty entities -> fail-open.
  useArchitecture: (() => {
    // Stable reference so the tab's tier-derivation useMemo deps don't churn
    // across renders (a fresh object each call re-fires the next-question effect).
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  useArchitectureContext: vi.fn(),
  useActiveArchitectureId: vi.fn(),
  useArchitectureDispatch: vi.fn(),
}));

// Imports AFTER mocks
import { ArchitectureDesignTargetStatePage } from '../../../Architecture/ArchitectureDesignTargetStatePage';
import {
  listTargetArchitectures,
  listUnmappedCurrentElements,
  type TargetArchitectureDto,
} from '../../../../api/targetArchitecturesApi';
import { loadConversation } from '../../../../api/architectConversationApi';
import { useProject } from '../../../../contexts/ProjectContext';
import {
  useArchitectureContext,
  useActiveArchitectureId,
  useArchitectureDispatch,
} from '../../../../contexts/ArchitectureContext';

const PROJECT_ID = 'proj-arch-conv-1';
const ACTIVE_ARCH_ID = 'arch-active-conv-1';

const draft: TargetArchitectureDto = {
  id: 'draft-conv-1',
  projectId: PROJECT_ID,
  name: 'Target draft for conversation test',
  description: null,
  tags: [],
  kind: 'target',
  draftState: 'active',
  archived: false,
  createdAt: '2026-05-24T08:00:00Z',
  updatedAt: '2026-05-24T08:00:00Z',
elementCount: null,
};

const invalidateCacheMock = vi.fn();
const dispatchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Test project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ACTIVE_ARCH_ID);
  vi.mocked(useArchitectureDispatch).mockReturnValue(dispatchMock);
  vi.mocked(useArchitectureContext).mockReturnValue({
    invalidateArchitectureModelCache: invalidateCacheMock,
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(listTargetArchitectures).mockResolvedValue([draft]);
  vi.mocked(listUnmappedCurrentElements).mockResolvedValue([]);
  // Default loadConversation: no current session yet -> Start CTA renders.
  vi.mocked(loadConversation).mockResolvedValue({
    threadId: 'thr-conv-1',
    turns: [],
    currentSession: null,
    capturedDecisions: [],
  });
});

afterEach(() => {
  cleanup();
});

function renderAtTargetStateRoute() {
  const url =
    `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}` +
    `/architecture-design/target-state`;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/architecture-design/target-state"
          element={<ArchitectureDesignTargetStatePage />}
        />
        <Route
          path="/projects/:projectId/architectures/:architectureId/metamodel"
          element={<div data-testid="harness-current-state-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ArchitectConversationTab (Spec 3, Commit 5, Surface 1)', () => {
  it('renders as a peer to Table editor + Compare with current inside the Target State sub-tab', async () => {
    renderAtTargetStateRoute();

    // The three view-mode tabs all render inside the workspace.
    expect(await screen.findByTestId('target-arch-view-tab-table')).toBeInTheDocument();
    expect(screen.getByTestId('target-arch-view-tab-compare')).toBeInTheDocument();
    expect(
      screen.getByTestId('target-arch-view-tab-conversation'),
    ).toBeInTheDocument();
  });

  it('is selectable and renders the active content area', async () => {
    renderAtTargetStateRoute();

    const convTab = await screen.findByTestId('target-arch-view-tab-conversation');
    fireEvent.click(convTab);

    await waitFor(() => {
      expect(convTab.getAttribute('aria-selected')).toBe('true');
    });

    // The conversation tab content area is rendered (the start CTA branch).
    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-tab'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('architect-conversation-start-button'),
    ).toBeInTheDocument();
  });

  it('hides when the user is not on the Target State sub-tab', () => {
    // Render at the Current State route -- the architecture-design/target-state
    // route never mounts so the workspace never appears and no conversation
    // tab is on the page.
    const url = `/projects/${PROJECT_ID}/architectures/${ACTIVE_ARCH_ID}/metamodel`;
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/projects/:projectId/architectures/:architectureId/architecture-design/target-state"
            element={<ArchitectureDesignTargetStatePage />}
          />
          <Route
            path="/projects/:projectId/architectures/:architectureId/metamodel"
            element={<div data-testid="harness-current-state-page" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('target-arch-view-tab-conversation')).toBeNull();
    expect(screen.queryByTestId('architect-conversation-tab')).toBeNull();
    expect(screen.getByTestId('harness-current-state-page')).toBeInTheDocument();
  });

  it('renders Architect Conversation as the 3rd peer with the spec label', async () => {
    renderAtTargetStateRoute();

    const viewTabsContainer = await screen.findByTestId('target-arch-view-tabs');
    const buttons = viewTabsContainer.querySelectorAll('button[role="tab"]');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toBe('Table editor');
    expect(buttons[1].textContent).toBe('Compare with current');
    expect(buttons[2].textContent).toBe('Architect Conversation');
  });
});
