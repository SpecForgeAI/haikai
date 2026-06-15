/**
 * Tests for useChatThread Hook Generalization (Bootstrap 2)
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 6, Task 6.1: Write 10 focused tests for hook generalization
 *
 * Tests verify:
 * 1. TASK_ARTIFACT_MAP contains entries for both task IDs with correct fields
 * 2. generateArtifact for roadmap task: roadmap-preview type with content
 * 3. generateArtifact for mission task: artifact-preview type with markdownContent
 * 4. generateArtifact failure for roadmap task: error uses "ROADMAP" name
 * 5. confirmArtifact for roadmap task: uses mapped artifactId, artifactName, completionMessage
 * 6. confirmArtifact for mission task: continues to use 'mission-md' and 'MISSION.MD'
 * 7. selectTask with roadmap + artifactExists.roadmap === true: shows roadmap warning
 * 8. selectTask with mission + artifactExists.mission === true: shows mission warning
 * 9. selectTask with roadmap + artifactExists.roadmap === false: no warning
 * 10. UseChatThreadOptions accepts artifactExists record
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatThread, TASK_ARTIFACT_MAP } from '../useChatThread';
import type { ThreadKey, Thread, ChatV2Response } from '../../api/chatV2Api';
import { createProvidersWrapper } from '../../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

// ============================================================================
// Mock the API module
// ============================================================================

vi.mock('../../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../../api/chatV2Api')>(
    '../../api/chatV2Api'
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

import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
} from '../../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);
const mockPostSaveArtifact = vi.mocked(postSaveArtifact);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

const emptyThread: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

/** Thread with an active PM roadmap task */
const threadWithRoadmapTask: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--roadmap',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

/** Thread with an active PM define-product task */
const threadWithMissionTask: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('useChatThread bootstrap 2 generalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: TASK_ARTIFACT_MAP contains entries for both task IDs
  // --------------------------------------------------------------------------
  it('TASK_ARTIFACT_MAP contains entries for both product-manager--define-product and product-manager--roadmap with correct fields', () => {
    // Mission entry
    const mission = TASK_ARTIFACT_MAP['product-manager--define-product'];
    expect(mission).toBeDefined();
    expect(mission.artifactId).toBe('mission-md');
    expect(mission.artifactName).toBe('MISSION.MD');
    expect(mission.artifactKey).toBe('mission');
    expect(mission.completionMessage).toBe('Product Definition complete.');
    expect(mission.warningText).toBe(
      'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.'
    );

    // Roadmap entry
    const roadmap = TASK_ARTIFACT_MAP['product-manager--roadmap'];
    expect(roadmap).toBeDefined();
    expect(roadmap.artifactId).toBe('roadmap');
    expect(roadmap.artifactName).toBe('ROADMAP');
    expect(roadmap.artifactKey).toBe('roadmap');
    expect(roadmap.completionMessage).toBe('Roadmap complete.');
    expect(roadmap.warningText).toBe(
      'A Roadmap already exists. Completing this conversation will update it.'
    );
  });

  // --------------------------------------------------------------------------
  // Test 2: generateArtifact for roadmap task appends roadmap-preview message
  // --------------------------------------------------------------------------
  it('generateArtifact for roadmap task calls postGenerateArtifact and appends assistant message with structuredResponse.type === "roadmap-preview" and content set to the roadmap JSON string', async () => {
    const roadmapJson = JSON.stringify({ initiatives: [{ title: 'Init 1', epics: [] }] });
    mockGetThreadHistory.mockResolvedValue(threadWithRoadmapTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: roadmapJson,
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });

    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostGenerateArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager',
      'product-manager--roadmap',
      undefined // allowedPersonaIds (not set in this test)
    );

    // Check that a roadmap-preview message was appended
    const previewMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'roadmap-preview';
    });
    expect(previewMsg).toBeDefined();
    expect(previewMsg!.role).toBe('assistant');
    expect(
      (previewMsg!.structuredResponse as { type: string; content: string }).content
    ).toBe(roadmapJson);

    // Check artifactPreview state
    expect(result.current.artifactPreview).toEqual({
      taskId: 'product-manager--roadmap',
      content: roadmapJson,
    });
  });

  // --------------------------------------------------------------------------
  // Test 3: generateArtifact for mission task appends artifact-preview message
  // --------------------------------------------------------------------------
  it('generateArtifact for mission task checks result.artifactContent (with fallback to result.missionMarkdown) and appends structuredResponse.type === "artifact-preview"', async () => {
    const missionMd = '# Mission\n\nBuild something amazing.';
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    // Test backward compatibility: uses missionMarkdown (no artifactContent)
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: missionMd,
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

    // Check that an artifact-preview message was appended
    const previewMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'artifact-preview';
    });
    expect(previewMsg).toBeDefined();
    expect(previewMsg!.role).toBe('assistant');
    expect(
      (previewMsg!.structuredResponse as { type: string; markdownContent: string }).markdownContent
    ).toBe(missionMd);

    // Check artifactPreview state
    expect(result.current.artifactPreview).toEqual({
      taskId: 'product-manager--define-product',
      content: missionMd,
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: generateArtifact failure for roadmap task uses artifact name "ROADMAP"
  // --------------------------------------------------------------------------
  it('generateArtifact failure for roadmap task appends system error message using artifact name "ROADMAP"', async () => {
    mockGetThreadHistory.mockResolvedValue(threadWithRoadmapTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: false,
      error: 'No proposedInitiatives found in thread',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });

    // Error message should use "ROADMAP" not "Mission"
    const errorMsg = result.current.messages.find(
      (m) => m.role === 'system' && m.content.includes('ROADMAP generation failed')
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain('No proposedInitiatives found in thread');
    expect(errorMsg!.content).not.toContain('Mission');

    // artifactPreview should NOT be set
    expect(result.current.artifactPreview).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 5: confirmArtifact for roadmap task uses mapped values
  // --------------------------------------------------------------------------
  it('confirmArtifact for roadmap task calls postSaveArtifact with artifactId "roadmap", inserts completion chip with artifactName "ROADMAP" and content "Roadmap complete.", and calls onArtifactSaved', async () => {
    const roadmapJson = JSON.stringify({ initiatives: [{ title: 'Init 1', epics: [] }] });
    mockGetThreadHistory.mockResolvedValue(threadWithRoadmapTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      artifactContent: roadmapJson,
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const onArtifactSaved = vi.fn();

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        onArtifactSaved,
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--roadmap');
    });

    // First, generate to set artifactPreview
    await act(async () => {
      await result.current.generateArtifact('product-manager--roadmap');
    });
    expect(result.current.artifactPreview).not.toBeNull();

    // Now confirm
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // postSaveArtifact called with roadmap artifactId
    expect(mockPostSaveArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--roadmap',
      'roadmap',
      roadmapJson,
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );

    // Completion chip with roadmap values
    const chipMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'completion-chip';
    });
    expect(chipMsg).toBeDefined();
    expect(chipMsg!.content).toBe('Roadmap complete.');
    expect(
      (chipMsg!.structuredResponse as { artifactId: string; artifactName: string }).artifactId
    ).toBe('roadmap');
    expect(
      (chipMsg!.structuredResponse as { artifactId: string; artifactName: string }).artifactName
    ).toBe('ROADMAP');

    // artifactPreview cleared
    expect(result.current.artifactPreview).toBeNull();

    // onArtifactSaved called
    expect(onArtifactSaved).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 6: confirmArtifact for mission task continues to use mission values
  // --------------------------------------------------------------------------
  it('confirmArtifact for mission task continues to use artifactId "mission-md" and artifactName "MISSION.MD"', async () => {
    const missionMd = '# Mission\n\nGreat product.';
    mockGetThreadHistory.mockResolvedValue(threadWithMissionTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: missionMd,
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // Generate
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });
    expect(result.current.artifactPreview).not.toBeNull();

    // Confirm
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // postSaveArtifact called with mission-md artifactId
    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--define-product',
      'mission-md',
      missionMd,
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );

    // Completion chip with mission values
    const chipMsg = result.current.messages.find((m) => {
      const sr = m.structuredResponse as { type?: string } | null;
      return sr?.type === 'completion-chip';
    });
    expect(chipMsg).toBeDefined();
    expect(chipMsg!.content).toBe('Product Definition complete.');
    expect(
      (chipMsg!.structuredResponse as { artifactId: string; artifactName: string }).artifactId
    ).toBe('mission-md');
    expect(
      (chipMsg!.structuredResponse as { artifactId: string; artifactName: string }).artifactName
    ).toBe('MISSION.MD');
  });

  // --------------------------------------------------------------------------
  // Test 7: selectTask with roadmap + artifactExists.roadmap === true: warning
  // --------------------------------------------------------------------------
  it('selectTask with taskId "product-manager--roadmap" and artifactExists.roadmap === true inserts warning message', async () => {
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    // Set up a ChatV2Response for the auto-sent "Selected task" message
    const taskResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--roadmap',
      assistant: { message: 'Welcome to the roadmap builder.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(taskResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        artifactExists: { mission: true, roadmap: true },
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Select roadmap task
    await act(async () => {
      result.current.selectTask('product-manager--roadmap');
    });

    // Wait for sendMessage to complete
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalled();
    });

    // Should have a warning message for roadmap
    const warningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content === 'A Roadmap already exists. Completing this conversation will update it.'
    );
    expect(warningMsg).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Test 8: selectTask with mission + artifactExists.mission === true: warning
  // --------------------------------------------------------------------------
  it('selectTask with taskId "product-manager--define-product" and artifactExists.mission === true shows mission warning', async () => {
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    const taskResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      assistant: { message: 'Welcome to the product definition.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(taskResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        artifactExists: { mission: true, roadmap: false },
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Select mission task
    await act(async () => {
      result.current.selectTask('product-manager--define-product');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalled();
    });

    // Should have a warning message for mission
    const warningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content ===
          'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.'
    );
    expect(warningMsg).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Test 9: selectTask with roadmap + artifactExists.roadmap === false: no warning
  // --------------------------------------------------------------------------
  it('selectTask with taskId "product-manager--roadmap" and artifactExists.roadmap === false does NOT insert warning', async () => {
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    const taskResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--roadmap',
      assistant: { message: 'Welcome to the roadmap builder.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(taskResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        artifactExists: { mission: true, roadmap: false },
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Select roadmap task
    await act(async () => {
      result.current.selectTask('product-manager--roadmap');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalled();
    });

    // Should NOT have a roadmap warning message
    const warningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content === 'A Roadmap already exists. Completing this conversation will update it.'
    );
    expect(warningMsg).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test 10: UseChatThreadOptions accepts artifactExists record
  // --------------------------------------------------------------------------
  it('UseChatThreadOptions accepts artifactExists?: Record<string, boolean> and the hook uses it for warning logic', async () => {
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    const taskResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--roadmap',
      assistant: { message: 'Roadmap builder ready.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(taskResponse);

    // Pass artifactExists with roadmap = true to verify the option is accepted
    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        artifactExists: { mission: false, roadmap: true },
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Select roadmap task -- warning should appear since artifactExists.roadmap is true
    await act(async () => {
      result.current.selectTask('product-manager--roadmap');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalled();
    });

    // Verify the warning was inserted using the artifactExists record
    const warningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content.includes('Roadmap already exists')
    );
    expect(warningMsg).toBeDefined();

    // Also verify no mission warning since artifactExists.mission is false
    const missionWarningMsg = result.current.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content.includes('Product Definition (MISSION.md) already exists')
    );
    expect(missionWarningMsg).toBeUndefined();
  });
});
