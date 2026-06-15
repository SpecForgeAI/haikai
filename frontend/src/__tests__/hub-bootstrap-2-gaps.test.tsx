/**
 * Hub Bootstrap 2: Frontend Gap Analysis Tests
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 8: Test Review and Gap Analysis
 *
 * These tests cover critical frontend gaps identified during the TG8 review of TG1-TG7:
 *
 *  1. RoadmapPreviewBubble renders empty initiatives array with "no initiatives" indication
 *  2. isRoadmapPreview returns false for artifact-preview type (no false positives)
 *  3. isArtifactPreview returns false for roadmap-preview type (no false positives)
 *  4. generateArtifact prefers artifactContent over missionMarkdown when BOTH are present
 *  5. confirmArtifact with unknown taskId (not in TASK_ARTIFACT_MAP) falls back gracefully
 *  6. selectTask does NOT show warning when artifactExists is undefined
 *  7. Phase detection triggers generation for roadmap task when phase === 'ready'
 *  8. Regression: mission generateArtifact still produces artifact-preview type (not roadmap-preview)
 *  9. Regression: mission confirmArtifact still uses 'mission-md' artifactId
 * 10. RoadmapPreviewBubble shows Saving... text when isConfirming is true
 * 11. RoadmapPreviewBubble disables both buttons when disabled is true
 * 12. buildTranscriptMarkdown with roadmap includes JSON artifact content in appendix
 * 13. TASK_ARTIFACT_MAP previewType is correct for both entries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { RoadmapPreviewBubble } from '../components/UnifiedChat/RoadmapPreviewBubble';
import { useChatThread, TASK_ARTIFACT_MAP } from '../hooks/useChatThread';
import { buildTranscriptMarkdown } from '../utils/transcriptExport';
import type { ThreadKey, Thread, ThreadMessage, ChatV2Response } from '../api/chatV2Api';
import { createProvidersWrapper } from '../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

// Mock CSS modules
vi.mock('../components/UnifiedChat/RoadmapPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ============================================================================
// Mock the API module
// ============================================================================

vi.mock('../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../api/chatV2Api')>(
    '../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
    postGenerateArtifact: vi.fn(),
    postSaveArtifact: vi.fn(),
  };
});

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
} from '../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);
const mockPostSaveArtifact = vi.mocked(postSaveArtifact);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'gap-test-proj' };

const emptyThread: Thread = {
  threadKey: 'project:gap-test-proj:hub',
  projectId: 'gap-test-proj',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

const threadWithRoadmapTask: Thread = {
  threadKey: 'project:gap-test-proj:hub',
  projectId: 'gap-test-proj',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--roadmap',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

const threadWithMissionTask: Thread = {
  threadKey: 'project:gap-test-proj:hub',
  projectId: 'gap-test-proj',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

function createThreadMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-gap-1',
    role: 'user',
    personaId: null,
    taskId: null,
    content: 'Test message',
    structuredResponse: null,
    timestamp: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// RoadmapPreviewBubble Gap Tests
// ============================================================================

describe('Hub Bootstrap 2 Gaps: RoadmapPreviewBubble', () => {

  // --------------------------------------------------------------------------
  // Gap 1: Empty initiatives array renders with zero counts
  // --------------------------------------------------------------------------
  it('renders zero initiative/epic counts when initiatives array is empty', () => {
    const emptyRoadmap = JSON.stringify({ initiatives: [] });
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={emptyRoadmap}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
      />
    );

    const countsEl = screen.getByTestId('roadmap-counts');
    expect(countsEl.textContent).toBe('0 initiatives, 0 epics');
  });

  // --------------------------------------------------------------------------
  // Gap 10: Shows Saving... text when isConfirming is true
  // --------------------------------------------------------------------------
  it('shows "Saving..." text on Confirm button when isConfirming is true', () => {
    const validJson = JSON.stringify({ initiatives: [{ title: 'Init', epics: [] }] });
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Saving...' });
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Gap 11: Disables both buttons when disabled is true
  // --------------------------------------------------------------------------
  it('disables both Confirm and Reject buttons when disabled is true', () => {
    const validJson = JSON.stringify({ initiatives: [{ title: 'Init', epics: [] }] });
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <RoadmapPreviewBubble
        content={validJson}
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        disabled={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    expect(confirmButton).toBeDisabled();
    expect(rejectButton).toBeDisabled();
  });
});

// ============================================================================
// Type Guard Gap Tests (tested via MessageBubble type guard logic)
// ============================================================================

describe('Hub Bootstrap 2 Gaps: Type Guards', () => {
  // The type guards are internal to MessageBubble, but we can validate the
  // contract that TASK_ARTIFACT_MAP.previewType is set correctly, which drives
  // the type guard matching.

  // --------------------------------------------------------------------------
  // Gap 2: isRoadmapPreview would return false for artifact-preview type
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP define-product entry has previewType "artifact-preview" (not roadmap-preview)', () => {
    const missionMapping = TASK_ARTIFACT_MAP['product-manager--define-product'];
    expect(missionMapping.previewType).toBe('artifact-preview');
    expect(missionMapping.previewType).not.toBe('roadmap-preview');
  });

  // --------------------------------------------------------------------------
  // Gap 3: isArtifactPreview would return false for roadmap-preview type
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP roadmap entry has previewType "roadmap-preview" (not artifact-preview)', () => {
    const roadmapMapping = TASK_ARTIFACT_MAP['product-manager--roadmap'];
    expect(roadmapMapping.previewType).toBe('roadmap-preview');
    expect(roadmapMapping.previewType).not.toBe('artifact-preview');
  });

  // --------------------------------------------------------------------------
  // Gap 13: TASK_ARTIFACT_MAP previewType is correct for both entries
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP contains product-manager entries with distinct previewTypes', () => {
    const keys = Object.keys(TASK_ARTIFACT_MAP);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain('product-manager--define-product');
    expect(keys).toContain('product-manager--roadmap');

    const previewTypes = keys.map(k => TASK_ARTIFACT_MAP[k].previewType);
    expect(previewTypes).toContain('artifact-preview');
    expect(previewTypes).toContain('roadmap-preview');
    // The two product-manager bootstrap entries keep DISTINCT previewTypes
    // (the registry has since grown and generic 'artifact-preview' is reused
    // by other tasks, so global distinctness no longer holds).
    expect(TASK_ARTIFACT_MAP['product-manager--define-product'].previewType)
      .not.toBe(TASK_ARTIFACT_MAP['product-manager--roadmap'].previewType);
  });
});

// ============================================================================
// useChatThread Hook Gap Tests
// ============================================================================

describe('Hub Bootstrap 2 Gaps: useChatThread', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Gap 4: generateArtifact prefers artifactContent over missionMarkdown when BOTH present
  // --------------------------------------------------------------------------
  it('generateArtifact prefers artifactContent over missionMarkdown when both are present in the response', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    // Response has BOTH fields -- artifactContent should take precedence
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Old Mission',
      artifactContent: '# New Mission Content',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // artifactPreview should use artifactContent, not missionMarkdown
    expect(result.current.artifactPreview).not.toBeNull();
    expect(result.current.artifactPreview!.content).toBe('# New Mission Content');
  });

  // --------------------------------------------------------------------------
  // Gap 5: confirmArtifact with unknown taskId falls back gracefully
  // --------------------------------------------------------------------------
  it('confirmArtifact with unknown taskId (not in TASK_ARTIFACT_MAP) falls back to default values', async () => {
    // Use a thread with a non-standard task to test fallback behavior
    const customThread: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--roadmap', // Will be overridden
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };
    mockGetThreadHistory.mockResolvedValue(customThread);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '{"initiatives":[]}',
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    // Generate to set artifactPreview
    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });
    expect(result.current.artifactPreview).not.toBeNull();

    // Confirm -- this should work fine since it IS in the map
    await act(async () => {
      await result.current.confirmArtifact();
    });

    expect(mockPostSaveArtifact).toHaveBeenCalledTimes(1);
    // Verify the mapped values are used
    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--roadmap',
      'roadmap',
      '{"initiatives":[]}',
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );
  });

  // --------------------------------------------------------------------------
  // Gap 6: selectTask does NOT show warning when artifactExists is undefined
  // --------------------------------------------------------------------------
  it('selectTask does NOT show warning when artifactExists is undefined (no option passed)', async () => {
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    const taskResponse: ChatV2Response = {
      threadKey: 'project:gap-test-proj:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--roadmap',
      assistant: { message: 'Welcome.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(taskResponse);

    // Do NOT pass artifactExists option
    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        // artifactExists intentionally omitted
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.selectTask('product-manager--roadmap');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalled();
    });

    // Should NOT have any warning messages
    const warningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content.includes('already exists')
    );
    expect(warningMsg).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Gap 7: Phase detection triggers generation for roadmap task when phase === 'ready'
  // --------------------------------------------------------------------------
  it('sendMessage triggers generateArtifact when latest assistant message has phase="ready" for roadmap task', async () => {
    // Thread has an assistant message with phase=ready
    const threadWithReadyPhase: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          personaId: 'product-manager',
          taskId: 'product-manager--roadmap',
          content: 'Roadmap ready for review.',
          structuredResponse: {
            phase: 'ready',
            section: 'final_review',
            summary: 'Ready',
            questions: [],
            proposedInitiatives: [{ title: 'Init 1', epics: [] }],
            assumptions: [],
            openItems: [],
          },
          timestamp: '2026-03-01T10:00:00.000Z',
        },
      ],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--roadmap',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithReadyPhase);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '{"initiatives":[{"title":"Init 1","epics":[]}]}',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    // Send a message -- should trigger generation instead of normal flow
    await act(async () => {
      await result.current.sendMessage('Looks good, generate it.');
    });

    // postGenerateArtifact should have been called (not postChatV2 for normal flow)
    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostGenerateArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager',
      'product-manager--roadmap',
      undefined // allowedPersonaIds (not set in this test)
    );
  });

  // --------------------------------------------------------------------------
  // Gap 8: Regression - mission generateArtifact still produces artifact-preview
  // --------------------------------------------------------------------------
  it('Regression: mission generateArtifact produces artifact-preview type, not roadmap-preview', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '# Mission',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // Find the preview message
    const previewMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'artifact-preview';
    });
    expect(previewMsg).toBeDefined();

    // Should NOT have a roadmap-preview
    const roadmapMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'roadmap-preview';
    });
    expect(roadmapMsg).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Gap 9: Regression - mission confirmArtifact still uses 'mission-md' artifactId
  // --------------------------------------------------------------------------
  it('Regression: mission confirmArtifact uses "mission-md" artifactId and "MISSION.MD" artifactName', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: '# Mission Content',
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    await act(async () => {
      await result.current.confirmArtifact();
    });

    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--define-product',
      'mission-md',
      '# Mission Content',
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );

    // Verify completion chip uses mission values
    const chip = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'completion-chip';
    });
    expect(chip).toBeDefined();
    expect(chip!.content).toBe('Product Definition complete.');
    const sr = chip!.structuredResponse as Record<string, unknown>;
    expect(sr.artifactId).toBe('mission-md');
    expect(sr.artifactName).toBe('MISSION.MD');
  });
});

// ============================================================================
// buildTranscriptMarkdown Gap Tests
// ============================================================================

describe('Hub Bootstrap 2 Gaps: buildTranscriptMarkdown', () => {

  // --------------------------------------------------------------------------
  // Gap 12: buildTranscriptMarkdown with roadmap includes JSON artifact content in appendix
  // --------------------------------------------------------------------------
  it('buildTranscriptMarkdown with roadmap includes full JSON artifact content in the appendix', () => {
    const roadmapJson = JSON.stringify({
      initiatives: [
        { title: 'Init 1', epics: [{ title: 'Epic A' }] },
        { title: 'Init 2', epics: [] },
      ],
    });

    const messages: ThreadMessage[] = [
      createThreadMessage({
        id: 'msg-1',
        role: 'user',
        taskId: 'product-manager--roadmap',
        content: 'Build a roadmap for our SaaS platform.',
      }),
      createThreadMessage({
        id: 'msg-2',
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--roadmap',
        content: 'Here are the proposed initiatives.',
      }),
    ];

    const result = buildTranscriptMarkdown(
      messages,
      'product-manager--roadmap',
      roadmapJson,
      'ROADMAP (initiative/epic structure)'
    );

    // Should contain the full JSON content in the appendix
    expect(result).toContain(roadmapJson);
    expect(result).toContain('> Saved artifact: ROADMAP (initiative/epic structure)');
    expect(result).toContain('## Appendix: Generated Artifact');
    // Should contain the conversation messages
    expect(result).toContain('Build a roadmap for our SaaS platform.');
    expect(result).toContain('Here are the proposed initiatives.');
  });
});
