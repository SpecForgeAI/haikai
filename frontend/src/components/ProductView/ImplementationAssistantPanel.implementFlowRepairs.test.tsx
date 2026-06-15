/**
 * Implement-Flow Repairs Tests
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 5: Retire executeOrchestration, retry bug fix, poller upgrade,
 * git outcome surfacing + persistence.
 *
 * Covers:
 * - Retry path sends the spec FOLDER name as spec_name (not the composed
 *   part-payload string) — the previous behaviour was a contract violation
 * - Poller surfaces step-level progress while the job is queued/running
 * - Completion renders the git outcome defensively from the untyped result
 *   and persists branch/PR/logs onto the AMS work item
 * - A persisted outcome on the work item renders again on revisit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImplementationAssistantPanel } from './ImplementationAssistantPanel';
import type { ContextState } from '../../utils/contextStorage';
import type { ChatMessage, PlannerResponse } from '../../api/chatApi';

// ============================================================================
// Mock Setup
// ============================================================================

const mockActiveProject = {
  id: 'project-123',
  name: 'Test Project',
  organisationId: 'org-456',
  projectParentFolder: '/path/to/project',
  description: null,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => mockActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Configurable stored chat state returned by the (mocked) UI-state context.
// IMPORTANT: the context method identities must be STABLE across renders —
// the panel's hydration effect depends on getImplementChatState, and a fresh
// vi.fn() per render combined with a non-null stored state causes an infinite
// re-hydration loop (new Map() fallbacks -> state change -> re-render -> ...).
let mockStoredState: Record<string, unknown> | null = null;
const mockGetImplementChatState = vi.fn(() => mockStoredState);
const mockSetImplementChatState = vi.fn();

vi.mock('../../contexts/ProductUiStateContext', () => ({
  useProductUiState: () => ({
    getImplementChatState: mockGetImplementChatState,
    setImplementChatState: mockSetImplementChatState,
  }),
  deriveProjectKey: (id: string) => id,
}));

const mockGetOrganisationById = vi.fn();
vi.mock('../../api/organisationsApi', async () => {
  const actual = await vi.importActual('../../api/organisationsApi');
  return {
    ...actual,
    getOrganisationById: () => mockGetOrganisationById(),
  };
});

vi.mock('../../api/chatApi', async () => {
  const actual = await vi.importActual('../../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
    getImplementConversation: vi.fn(() => Promise.resolve({ exists: false, messages: [] })),
    getImplementState: vi.fn(() => Promise.resolve({ exists: false, state: null })),
    putImplementState: vi.fn(() => Promise.resolve()),
    convertMessageEntryToChatMessage: vi.fn(),
  };
});

const mockStartOrchestrationJob = vi.fn();
const mockPollJobStatus = vi.fn();
vi.mock('../../api/orchestrationApi', async () => {
  const actual = await vi.importActual('../../api/orchestrationApi');
  return {
    ...actual,
    startOrchestrationJob: (...args: unknown[]) => mockStartOrchestrationJob(...args),
    pollJobStatus: (...args: unknown[]) => mockPollJobStatus(...args),
  };
});

const mockFetchWorkItems = vi.fn();
const mockUpdateWorkItem = vi.fn();
vi.mock('../../api/workItemsApi', async () => {
  const actual = await vi.importActual('../../api/workItemsApi');
  return {
    ...actual,
    fetchWorkItems: (...args: unknown[]) => mockFetchWorkItems(...args),
    updateWorkItem: (...args: unknown[]) => mockUpdateWorkItem(...args),
    createWorkItem: vi.fn(),
  };
});

vi.mock('../../utils/formatArchitectureContext', async () => {
  const actual = await vi.importActual('../../utils/formatArchitectureContext');
  return {
    ...actual,
    fetchArchitectureExplainer: vi.fn(() => Promise.resolve(null)),
  };
});

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContextState(): ContextState {
  return {
    version: 1,
    entity_refs: [],
    diagram_refs: [],
    relationship_refs: [],
  };
}

/** Split implementation plan so PartsListSection (with Retry buttons) renders. */
function createSplitPlannerResponse(): PlannerResponse {
  return {
    schemaVersion: '1.1',
    message: 'Implementation plan with parts',
    featureUnderstanding: 'Test feature understanding',
    scope: { in: ['Item 1'], out: [] },
    acceptanceCriteria: ['AC 1'],
    assumptions: [],
    openQuestions: [],
    // false so the auto implementation-planning trigger stays quiet
    plannerReadyForSpec: false,
    implementationPlan: {
      planTitle: 'Test Implementation Plan',
      isSplit: true,
      increments: [
        { id: 'INC-1', partIndex: 1, title: 'Part One', intent: 'Do part one' },
        { id: 'INC-2', partIndex: 2, title: 'Part Two', intent: 'Do part two' },
      ],
    },
  } as PlannerResponse;
}

const storedMessage: ChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  content: 'Previous conversation message',
  timestamp: new Date(),
  persona: 'Software Developer',
};

/**
 * Stored UI state hydrated by the panel: Part 1 FAILED (so the Retry button
 * renders), spec folder name available from the shape-spec stream, all
 * auto-trigger flags satisfied so no background flows fire.
 */
function createStoredStateWithFailedPart(): Record<string, unknown> {
  return {
    sessionId: 'sess-1',
    messages: [storedMessage],
    generatedSpecs: null,
    error: null,
    inputDraft: '',
    hasBootstrapped: true,
    hasPlan: true,
    hasTestPlan: true,
    latestPlannerResponse: createSplitPlannerResponse(),
    partStatuses: new Map([
      [1, 'FAILED'],
      [2, 'COMPLETED'],
    ]),
    activePartIndex: 1,
    latestFolder: 'spec-folder-abc',
    shapeSpecSessionId: 'shape-sess-1',
  };
}

const baseWorkItem = {
  id: 'work-item-1',
  projectId: 'proj-uuid-1',
  type: 'STORY',
  parentId: 'feature-1',
  title: 'Test Work Item',
  description: 'Test description',
  status: 'IN_PROGRESS',
  sortOrder: 1,
  priority: null,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  externalUrl: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  implementationBranch: null,
  implementationPrUrl: null,
  implementationLogsUrl: null,
};

const defaultProps = {
  workItemId: 'work-item-1',
  workItemTitle: 'Test Work Item',
  workItemType: 'STORY',
  workItemDescription: 'Test description',
  projectId: 'test-project',
  projectUuid: 'proj-uuid-1',
  contextState: createTestContextState(),
};

describe('ImplementationAssistantPanel - Implement-Flow Repairs (Spec 2026-06-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoredState = createStoredStateWithFailedPart();
    // restoreAllMocks in afterEach wipes vi.fn implementations — re-establish
    mockGetImplementChatState.mockImplementation(() => mockStoredState);
    mockGetOrganisationById.mockResolvedValue({
      id: 'org-456',
      name: 'Test Organisation',
      description: null,
    });
    mockFetchWorkItems.mockResolvedValue([{ ...baseWorkItem }]);
    mockUpdateWorkItem.mockResolvedValue({ ...baseWorkItem });
    mockStartOrchestrationJob.mockResolvedValue({ jobId: 'job-1' });
    mockPollJobStatus.mockResolvedValue({ status: 'running' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retry sends the spec FOLDER name as spec_name, not the composed part payload', async () => {
    render(<ImplementationAssistantPanel {...defaultProps} />);

    const retryButton = await screen.findByTestId('retry-orchestration-1');
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockStartOrchestrationJob).toHaveBeenCalledTimes(1);
    });

    const [company, project, specIntents] = mockStartOrchestrationJob.mock.calls[0];
    expect(company).toBe('Test Organisation');
    expect(project).toBe('Test Project');
    expect(specIntents).toEqual([
      { spec_name: 'spec-folder-abc', session_id: 'shape-sess-1' },
    ]);
  });

  it('surfaces job progress (step description and percentage) while the job is running', async () => {
    mockPollJobStatus.mockResolvedValue({
      status: 'running',
      progress: {
        current_step: 2,
        total_steps: 5,
        step_description: 'Implementing tasks',
        percentage: 40,
      },
    });

    render(<ImplementationAssistantPanel {...defaultProps} />);

    fireEvent.click(await screen.findByTestId('retry-orchestration-1'));

    const indicator = await screen.findByTestId('job-progress-indicator');
    expect(indicator.textContent).toContain('Implementing Part 1');
    expect(indicator.textContent).toContain('step 2/5');
    expect(indicator.textContent).toContain('Implementing tasks');
    expect(indicator.textContent).toContain('(40%)');
  });

  it('on completion renders the git outcome defensively and persists it onto the work item', async () => {
    mockPollJobStatus.mockResolvedValue({
      status: 'completed',
      result: {
        feature_branch: 'feature/spec-folder-abc',
        pr_url: 'https://git.example/pr/42',
        anything_else: { nested: true },
      },
      logs_url: 'https://logs.example/job-1',
    });

    render(<ImplementationAssistantPanel {...defaultProps} />);

    fireEvent.click(await screen.findByTestId('retry-orchestration-1'));

    // Persists branch/PR/logs onto the AMS work item (snake_case handled by the API mapper)
    await waitFor(() => {
      expect(mockUpdateWorkItem).toHaveBeenCalledWith(
        'proj-uuid-1',
        'work-item-1',
        expect.objectContaining({
          implementationBranch: 'feature/spec-folder-abc',
          implementationPrUrl: 'https://git.example/pr/42',
          implementationLogsUrl: 'https://logs.example/job-1',
        }),
      );
    });

    // Renders the outcome panel (no generic "completed successfully" only)
    const panel = await screen.findByTestId('implementation-outcome-panel');
    expect(panel.textContent).toContain('feature/spec-folder-abc');
    expect(screen.getByTestId('implementation-outcome-pr').textContent).toContain(
      'https://git.example/pr/42',
    );
    expect(screen.getByTestId('implementation-outcome-logs').textContent).toContain(
      'https://logs.example/job-1',
    );
  });

  it('tolerates a result with no recognisable git keys (completion still succeeds, nothing persisted)', async () => {
    mockPollJobStatus.mockResolvedValue({
      status: 'completed',
      result: { totally: 'unrelated', items: [1, 2, 3] },
    });

    render(<ImplementationAssistantPanel {...defaultProps} />);

    fireEvent.click(await screen.findByTestId('retry-orchestration-1'));

    // The part transitions to COMPLETED without errors...
    await waitFor(() => {
      expect(screen.getByTestId('part-status-chip-1').textContent).toMatch(/completed/i);
    });
    // ...and no work-item update is attempted when there is no outcome to store
    expect(mockUpdateWorkItem).not.toHaveBeenCalled();
    expect(screen.queryByTestId('implementation-outcome-panel')).toBeNull();
  });

  it('surfaces a visible error and returns the part to FAILED when the job submission is rejected (e.g. gateway 400) (Task Group 6 gap analysis)', async () => {
    mockStartOrchestrationJob.mockRejectedValue(
      new Error('Failed to start orchestration job: 400'),
    );

    render(<ImplementationAssistantPanel {...defaultProps} />);

    fireEvent.click(await screen.findByTestId('retry-orchestration-1'));

    // A visible error message lands in the chat -- never a silent failure.
    await waitFor(() => {
      expect(
        screen.getByText(/Failed to retry orchestration for Part 1/),
      ).toBeInTheDocument();
    });
    // The part transitions back to FAILED (so Retry stays available)...
    expect(screen.getByTestId('part-status-chip-1').textContent).toMatch(/failed/i);
    expect(screen.getByTestId('retry-orchestration-1')).toBeInTheDocument();
    // ...and no polling or work-item write ever starts for the dead job.
    expect(mockPollJobStatus).not.toHaveBeenCalled();
    expect(mockUpdateWorkItem).not.toHaveBeenCalled();
  });

  it('renders the persisted git outcome from the work item on revisit', async () => {
    mockFetchWorkItems.mockResolvedValue([
      {
        ...baseWorkItem,
        implementationBranch: 'feature/persisted-branch',
        implementationPrUrl: 'https://git.example/pr/7',
        implementationLogsUrl: 'https://logs.example/job-7',
      },
    ]);

    render(<ImplementationAssistantPanel {...defaultProps} />);

    const panel = await screen.findByTestId('implementation-outcome-panel');
    expect(panel.textContent).toContain('feature/persisted-branch');

    const prLink = screen.getByTestId('implementation-outcome-pr').querySelector('a');
    expect(prLink?.getAttribute('href')).toBe('https://git.example/pr/7');
    const logsLink = screen.getByTestId('implementation-outcome-logs').querySelector('a');
    expect(logsLink?.getAttribute('href')).toBe('https://logs.example/job-7');
  });
});
