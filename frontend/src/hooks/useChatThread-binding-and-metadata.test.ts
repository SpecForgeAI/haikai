/**
 * Strategic gap-fill: useChatThread `bindingError` synthesis + bound-architecture
 * metadata lifecycle.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 11
 * (test review + cross-tier gap fill).
 *
 * Why this test exists:
 *   - Group 6 covers the gateway side: chatV2 returns `bindingError` on the
 *     ChatV2Response payload.
 *   - Group 10 covers the panel side: the message stream renders inline
 *     system messages (the test asserts on the rendered message bubble).
 *   - Neither group covers the hook-internal step in between: when the
 *     gateway returns `response.bindingError`, the hook must SYNTHESISE a
 *     code-specific inline system message and append it to `messages` so the
 *     panel can render it. This is the load-bearing wire between the gateway
 *     contract and the panel's render surface.
 *
 *   Group 10 also wired the hook to read `Thread.metadata.boundArchitectureId`
 *   and `boundArchitectureName` on history load and expose them on the hook
 *   return so the chat panel can mount the invalidation banner. The Group 10
 *   tests assert on the panel's mount decision but never verify the upstream
 *   read from `Thread.metadata`. This file fills that gap.
 *
 * Test inventory (4 tests):
 *   1. bindingError(`archived_architecture`) -> hook appends a system message
 *      with the spec-mandated copy and a `binding-error` structuredResponse.
 *   2. bindingError(`unsupported_binding_type`) -> code-specific copy.
 *   3. bindingError(`lookup_failed`) -> code-specific copy.
 *   4. Thread.metadata.boundArchitectureId/Name on history load -> hook
 *      surfaces both fields on its return so the chat panel can mount the
 *      invalidation banner immediately on first render for already-bound
 *      conversations (no extra round-trip required).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- Mock the API module (mirror useChatThread.test.ts pattern) ----
vi.mock('../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../api/chatV2Api')>('../api/chatV2Api');
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
  };
});

// Spec #5 Group 7 added useActiveArchitectureId() to the hook -- stub it.
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => null),
}));

import { useChatThread } from './useChatThread';
import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  type Thread,
  type ThreadKey,
  type ChatV2Response,
  type ChatV2BindingError,
} from '../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);

const projectId = 'proj-binding-and-metadata';
const hubKey: ThreadKey = { type: 'hub', projectId };

function buildThreadWithTask(taskId: string, metadata?: Record<string, unknown>): Thread {
  const t: Thread = {
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
  if (metadata) {
    (t as Thread & { metadata?: Record<string, unknown> }).metadata = metadata;
  }
  return t;
}

function buildResponseWithBindingError(
  taskId: string,
  bindingError: ChatV2BindingError
): ChatV2Response {
  return {
    threadKey: `project:${projectId}:hub`,
    personaId: 'architect',
    taskId,
    assistant: { message: 'OK' },
    structuredResponse: null,
    bindingError,
  };
}

describe('useChatThread bindingError synthesis + metadata lifecycle (Spec #5 TG11 gap-fill)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: archived_architecture bindingError -> code-specific inline system
  //          message appended; structuredResponse carries `binding-error` shape.
  // --------------------------------------------------------------------------
  it('synthesises an inline system message for archived_architecture bindingError', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('architect--oas-spec'));
    mockPostChatV2.mockResolvedValue(
      buildResponseWithBindingError('architect--oas-spec', {
        status: 422,
        code: 'archived_architecture',
        message: 'Cannot bind to archived architecture: Old State',
      })
    );

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--oas-spec');
    });

    await act(async () => {
      await result.current.sendMessage('Bind to the archived interface.');
    });

    // The hook appended: optimistic user msg + assistant msg + binding-error system msg.
    const systemMessages = result.current.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    const sysMsg = systemMessages[0];
    expect(sysMsg.content).toMatch(/Cannot bind to archived architecture/);
    expect(sysMsg.content).toContain('Cannot bind to archived architecture: Old State');
    // Carries structuredResponse so future renderers can branch on it.
    expect(sysMsg.structuredResponse).toMatchObject({
      type: 'binding-error',
      code: 'archived_architecture',
      status: 422,
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: unsupported_binding_type -> code-specific copy.
  // --------------------------------------------------------------------------
  it('synthesises an inline system message for unsupported_binding_type bindingError', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('architect--oas-spec'));
    mockPostChatV2.mockResolvedValue(
      buildResponseWithBindingError('architect--oas-spec', {
        status: 422,
        code: 'unsupported_binding_type',
        message: "derived-from-context V1 only supports entityType 'interface' (received 'service')",
      })
    );

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--oas-spec');
    });

    await act(async () => {
      await result.current.sendMessage('Bind to a service.');
    });

    const systemMessages = result.current.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toMatch(/entity type isn't supported/i);
    expect(systemMessages[0].structuredResponse).toMatchObject({
      type: 'binding-error',
      code: 'unsupported_binding_type',
    });
  });

  // --------------------------------------------------------------------------
  // Test 3: lookup_failed -> code-specific copy.
  // --------------------------------------------------------------------------
  it('synthesises an inline system message for lookup_failed bindingError', async () => {
    mockGetThreadHistory.mockResolvedValue(buildThreadWithTask('architect--oas-spec'));
    mockPostChatV2.mockResolvedValue(
      buildResponseWithBindingError('architect--oas-spec', {
        status: 422,
        code: 'lookup_failed',
        message: 'Upstream binding lookup failed unexpectedly',
      })
    );

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('architect--oas-spec');
    });

    await act(async () => {
      await result.current.sendMessage('Bind to a missing entity.');
    });

    const systemMessages = result.current.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toMatch(/Failed to look up architecture/);
    expect(systemMessages[0].structuredResponse).toMatchObject({
      type: 'binding-error',
      code: 'lookup_failed',
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: Thread.metadata.boundArchitectureId/Name on history load -> hook
  //          surfaces both fields on its return so the chat panel can mount
  //          the invalidation banner immediately on first render.
  //
  // This covers the upstream read step that Group 10's panel-wiring tests
  // implicitly depend on (the test there mocks the hook return directly,
  // so the actual metadata->state lift was never asserted).
  // --------------------------------------------------------------------------
  it('lifts Thread.metadata.boundArchitectureId/Name into hook state on history load', async () => {
    mockGetThreadHistory.mockResolvedValue(
      buildThreadWithTask('architect--oas-spec', {
        boundArchitectureId: 'arch-uuid-bound',
        boundArchitectureName: 'Bound Architecture',
        boundEntityType: 'interface',
        boundEntityId: 'iface-uuid-bound',
      })
    );

    const { result } = renderHook(() =>
      useChatThread(hubKey, { initialPersonaId: 'architect' })
    );

    await waitFor(() => {
      expect(result.current.boundArchitectureId).toBe('arch-uuid-bound');
    });
    expect(result.current.boundArchitectureName).toBe('Bound Architecture');
  });
});
