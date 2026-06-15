/**
 * Tests for chatV2 request-side `architectureId` threading.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 7
 *
 * The frontend `useChatThread` hook decides per-turn whether to include the
 * URL-active `architectureId` on a chatV2 request, based on the active task's
 * declared `saveTargetResolution` mode (mirrored client-side in
 * `frontend/src/config/taskConfig.ts`).
 *
 * Test inventory (kept to <=8, focused on the task-specified properties):
 *   1. `architect--define-architecture` (bound-by-system-prompt) + active arch X
 *      -> chatV2 request body contains `architectureId: X`.
 *   2. `architect--oas-spec` (derived-from-context) + active arch X -> chatV2
 *      request body contains `architectureId: X`.
 *   3. `ux-designer--users-interactions` (clarify-at-save) -> chatV2 request
 *      body OMITS `architectureId` (the picker handles save-time selection).
 *   4. Project-level / unmapped task (`product-manager--define-product`) ->
 *      chatV2 request body OMITS `architectureId`.
 *
 * Mocking strategy:
 *   - vi.mock the `chatV2Api` module to capture postChatV2 calls (mirrors the
 *     pattern in `useChatThread.test.ts`).
 *   - vi.mock the `ArchitectureContext` module so `useActiveArchitectureId()`
 *     returns a deterministic value per test (no Provider needed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- Mock the chatV2Api module ----
vi.mock('../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../api/chatV2Api')>('../api/chatV2Api');
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
  };
});

// ---- Mock ArchitectureContext so useActiveArchitectureId returns the test arch ----
const ACTIVE_ARCH_ID = 'arch-uuid-active-X';
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => ACTIVE_ARCH_ID,
}));

// ---- Imports (after mocks) ----
import { useChatThread } from '../hooks/useChatThread';
import { postChatV2, getThreadHistory, postHandoff } from '../api/chatV2Api';
import type { ThreadKey, Thread, ChatV2Response } from '../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);

// ---- Test fixtures ----

const projectId = 'proj-arch-id-threading';

function buildThreadWithTask(taskId: string): Thread {
  return {
    threadKey: `project:${projectId}:hub`,
    projectId,
    messages: [],
    activePersonaId: 'architect',
    activeTaskId: taskId,
    summary: null,
    summarisedUpToIndex: 0,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function buildResponse(taskId: string): ChatV2Response {
  return {
    threadKey: `project:${projectId}:hub`,
    personaId: 'architect',
    taskId,
    assistant: { message: 'OK' },
    structuredResponse: null,
  };
}

const hubKey: ThreadKey = { type: 'hub', projectId };

describe('chatV2 architectureId threading by task saveTargetResolution (Spec #5 TG7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: bound-by-system-prompt (architect--define-architecture)
  //          -> request body contains architectureId: X
  // --------------------------------------------------------------------------
  it('includes architectureId in chatV2 request body for bound-by-system-prompt task (architect--define-architecture)', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('architect--define-architecture'));
    mockPostChatV2.mockResolvedValue(buildResponse('architect--define-architecture'));

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--define-architecture');
    });

    await act(async () => {
      await result.current.sendMessage('Define the target architecture.');
    });

    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'architect--define-architecture',
        architectureId: ACTIVE_ARCH_ID,
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 2: derived-from-context (architect--oas-spec)
  //          -> request body contains architectureId: X
  //
  // Threading the URL-active id for derived mode keeps the request shape
  // symmetric and lets future server-side validation flag URL/entity
  // mismatches without a frontend change. (V1 resolver derives from the
  // entity, but the field is still sent.)
  // --------------------------------------------------------------------------
  it('includes architectureId in chatV2 request body for derived-from-context task (architect--oas-spec)', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('architect--oas-spec'));
    mockPostChatV2.mockResolvedValue(buildResponse('architect--oas-spec'));

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--oas-spec');
    });

    await act(async () => {
      await result.current.sendMessage('I want to spec the orders interface.');
    });

    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'architect--oas-spec',
        architectureId: ACTIVE_ARCH_ID,
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: clarify-at-save (ux-designer--users-interactions)
  //          -> request body OMITS architectureId
  //
  // The picker modal handles save-time selection -- the chat turn does not
  // need a thread-time binding.
  // --------------------------------------------------------------------------
  it('OMITS architectureId in chatV2 request body for clarify-at-save task (ux-designer--users-interactions)', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('ux-designer--users-interactions'));
    mockPostChatV2.mockResolvedValue(buildResponse('ux-designer--users-interactions'));

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'ux-designer' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('ux-designer--users-interactions');
    });

    await act(async () => {
      await result.current.sendMessage('Walk me through the user journey.');
    });

    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    const sentRequest = mockPostChatV2.mock.calls[0][0];
    expect(sentRequest.taskId).toBe('ux-designer--users-interactions');
    expect(sentRequest).not.toHaveProperty('architectureId');
  });

  // --------------------------------------------------------------------------
  // Test 4: project-level / unmapped task (product-manager--define-product)
  //          -> request body OMITS architectureId
  //
  // Project-level tasks (PM/TE/Assistant) write project-scoped artefacts
  // (mission, roadmap, backlog, tech-stack docs, test-strategy) and have no
  // architecture binding. They are absent from `TASK_SAVE_TARGET_RESOLUTION`,
  // and `shouldSendArchitectureIdForTask` returns false for them.
  // --------------------------------------------------------------------------
  it('OMITS architectureId in chatV2 request body for project-level task (product-manager--define-product)', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('product-manager--define-product'));
    mockPostChatV2.mockResolvedValue(buildResponse('product-manager--define-product'));

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'product-manager' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.sendMessage('Help me draft the product mission.');
    });

    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    const sentRequest = mockPostChatV2.mock.calls[0][0];
    expect(sentRequest.taskId).toBe('product-manager--define-product');
    expect(sentRequest).not.toHaveProperty('architectureId');
  });
});
